import zlib from "zlib";
import sharp from "sharp";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { formatSwissPostLabel, normalizeReturnLabelDigits } from "./mapReturn";

const SWISS_POST_LABEL_RE = /\b(\d{2}\.\d{2}\.\d{6}\.\d{8})\b/;

function inflatePdfStream(raw: Buffer): Buffer | null {
  try {
    return zlib.inflateSync(raw);
  } catch {
    try {
      return zlib.inflateRawSync(raw);
    } catch {
      return null;
    }
  }
}

function extractPdfStreams(pdf: Buffer): Buffer[] {
  const text = pdf.toString("binary");
  const out: Buffer[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    out.push(Buffer.from(match[1], "binary"));
  }
  return out;
}

function extractPdfTextStrings(pdf: Buffer): string[] {
  const strings: string[] = [];
  for (const stream of extractPdfStreams(pdf)) {
    const dec = inflatePdfStream(stream);
    if (!dec) continue;
    const str = dec.toString("latin1");
    for (const m of str.matchAll(/\((?:\\.|[^\\)])*?\)\s*Tj/g)) {
      const inner = m[0].slice(1, m[0].lastIndexOf(")"));
      strings.push(
        inner.replace(/\\([nrt\\()])/g, (_, c) => {
          if (c === "n") return "\n";
          if (c === "r") return "\r";
          if (c === "t") return "\t";
          return c;
        })
      );
    }
    for (const m of str.matchAll(/\((?:\\.|[^\\)])*?\)/g)) {
      const inner = m[0].slice(1, -1);
      if (inner.length >= 8) strings.push(inner);
    }
  }
  return strings;
}

function pickBestSwissPostLabel(candidates: string[]): string | null {
  const normalized = candidates
    .map((c) => {
      const dotted = c.match(SWISS_POST_LABEL_RE)?.[1];
      if (dotted) return dotted;
      const digits = normalizeReturnLabelDigits(c);
      return digits ? formatSwissPostLabel(digits) : null;
    })
    .filter((v): v is string => Boolean(v));

  if (!normalized.length) return null;
  // Prefer shop franking-style 99.60.* over generic 99.01.* product codes when both exist.
  return normalized.find((v) => v.startsWith("99.60.")) ?? normalized[0];
}

type PdfImage = { width: number; height: number; rgb: Buffer };

function extractPdfRgbImages(pdf: Buffer): PdfImage[] {
  const images: PdfImage[] = [];
  const asBinary = pdf.toString("binary");
  const re =
    /\/Subtype\s*\/Image[\s\S]{0,400}?\/Width\s+(\d+)[\s\S]{0,200}?\/Height\s+(\d+)[\s\S]{0,400}?stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(asBinary))) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    const raw = Buffer.from(match[3], "binary");
    const dec = inflatePdfStream(raw);
    if (!dec || !width || !height) continue;
    const expected = width * height * 3;
    if (dec.length < expected) continue;
    images.push({ width, height, rgb: dec.subarray(0, expected) });
  }
  return images;
}

function decodeBarcodeFromRgb(image: PdfImage): string | null {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);

  const luminance = new Uint8ClampedArray(image.width * image.height);
  for (let i = 0, p = 0; i < luminance.length; i += 1, p += 3) {
    luminance[i] = (image.rgb[p] * 299 + image.rgb[p + 1] * 587 + image.rgb[p + 2] * 114) / 1000;
  }
  const prevError = console.error;
  const prevWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const source = new RGBLuminanceSource(
      luminance as unknown as Uint8ClampedArray,
      image.width,
      image.height
    );
    const result = reader.decode(new BinaryBitmap(new HybridBinarizer(source)));
    return result?.getText() ?? null;
  } catch {
    return null;
  } finally {
    console.error = prevError;
    console.warn = prevWarn;
  }
}

/**
 * Extract Decathlon/Swiss Post return label number from SYSTEM_RETURN_LABEL PDF bytes.
 * Text layer first (`99.60…` / `99.01…`), then Code128 in embedded RGB image.
 */
export async function extractReturnLabelNumberFromPdf(pdf: Buffer): Promise<string | null> {
  const fromText = pickBestSwissPostLabel(extractPdfTextStrings(pdf));
  if (fromText) return fromText;

  const images = extractPdfRgbImages(pdf);
  const decoded: string[] = [];
  for (const image of images) {
    for (const angle of [0, 90, 180, 270] as const) {
      const { data, info } = await sharp(image.rgb, {
        raw: { width: image.width, height: image.height, channels: 3 },
      })
        .rotate(angle)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const code = decodeBarcodeFromRgb({
        width: info.width,
        height: info.height,
        rgb: data,
      });
      if (code) decoded.push(code);
    }
  }
  return pickBestSwissPostLabel(decoded);
}

export function pickReturnLabelDocumentId(ret: any): number | null {
  const docs = Array.isArray(ret?.documents) ? ret.documents : [];
  const label = docs.find((d: any) => {
    const type = String(d?.type ?? "").toUpperCase();
    return type === "SYSTEM_RETURN_LABEL" || type === "RETURN_LABEL";
  });
  const n = Number(label?.id);
  return Number.isFinite(n) ? n : null;
}
