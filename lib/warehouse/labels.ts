import bwipjs from "bwip-js";
import { unitShortRef } from "./codes";

/**
 * Label rendering — pure, deterministic, no I/O.
 *
 * One layout (primitives in millimetres) feeds two outputs with the SAME data:
 *   - a vector PDF at exact media size (sent to the station printer through the existing QZ chain,
 *     or downloaded as the manual fallback);
 *   - an SVG preview for the screen.
 * The QR encodes only the registered text (`<uuid>-<site>` or the location code): no URL, no
 * domain, no rack address on a pair label.
 */

export type PairLabelPayload = {
  kind: "PAIR";
  code: string;
  unitId: string;
  title: string;
  sizeLabel: string | null;
  styleCode: string | null;
  isReprint?: boolean;
};
export type LocationLabelPayload = { kind: "LOCATION"; code: string; shortCode: string; locationKind: string };
export type TestLabelPayload = { kind: "TEST"; text: string; stationCode: string; printerName: string };
export type LabelPayload = PairLabelPayload | LocationLabelPayload | TestLabelPayload;

export const LABEL_PROFILES = {
  PAIR: { widthMm: 50, heightMm: 30 },
  LOCATION: { widthMm: 100, heightMm: 50 },
  TEST: { widthMm: 50, heightMm: 30 },
  /** Reserved for the existing carrier circuit (not printed by this module in lot 1). */
  SHIPPING: { widthMm: 102, heightMm: 150 },
} as const;

type Rect = { x: number; y: number; w: number; h: number };
type Text = { x: number; y: number; sizePt: number; text: string; bold: boolean };
export type LabelLayout = { widthMm: number; heightMm: number; rects: Rect[]; texts: Text[] };

const MM_PER_PT = 25.4 / 72;
/** Conservative average glyph width of Helvetica (bold / regular) in em. */
const glyphEm = (bold: boolean) => (bold ? 0.6 : 0.54);
const textWidthMm = (text: string, sizePt: number, bold: boolean) => text.length * sizePt * glyphEm(bold) * MM_PER_PT;

function fit(text: string, sizePt: number, bold: boolean, maxMm: number): string {
  const max = Math.max(1, Math.floor(maxMm / (sizePt * glyphEm(bold) * MM_PER_PT)));
  if (text.length <= max) return text;
  return max <= 1 ? text.slice(0, 1) : `${text.slice(0, max - 1)}…`;
}

/** Largest size (pt) at which `text` fits in `maxMm`, clamped. */
function fitSize(text: string, bold: boolean, maxMm: number, maxPt: number, minPt: number): number {
  const size = maxMm / (Math.max(1, text.length) * glyphEm(bold) * MM_PER_PT);
  return Math.max(minPt, Math.min(maxPt, Math.floor(size * 10) / 10));
}

/** Latin-1 printable text only (base-14 PDF font); anything else becomes "?". */
function sanitize(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\x20-\x7e\xa0-\xff…]/g, "?");
}

export function qrMatrix(text: string): { size: number; dark: boolean[] } {
  const raw = (bwipjs as any).raw("qrcode", text, { eclevel: "Q" });
  const m = Array.isArray(raw) ? raw[0] : raw;
  if (!m?.pixs || m.pixx !== m.pixy) throw new Error("QR generation failed");
  return { size: m.pixx as number, dark: (m.pixs as number[]).map((v) => v === 1) };
}

function qrRects(text: string, x: number, y: number, sideMm: number): Rect[] {
  const { size, dark } = qrMatrix(text);
  // 4-module quiet zone inside the reserved square.
  const module = sideMm / (size + 8);
  const rects: Rect[] = [];
  for (let row = 0; row < size; row += 1) {
    let runStart = -1;
    for (let col = 0; col <= size; col += 1) {
      const on = col < size && dark[row * size + col];
      if (on && runStart < 0) runStart = col;
      if (!on && runStart >= 0) {
        // Merge horizontal runs: fewer objects, no hairline gaps between modules.
        rects.push({ x: x + (4 + runStart) * module, y: y + (4 + row) * module, w: (col - runStart) * module, h: module });
        runStart = -1;
      }
    }
  }
  return rects;
}

export function layoutLabel(payload: LabelPayload, widthMm: number, heightMm: number): LabelLayout {
  const rects: Rect[] = [];
  const texts: Text[] = [];
  const pad = Math.max(1, Math.min(widthMm, heightMm) * 0.04);

  if (payload.kind === "PAIR") {
    const footer = 3.2;
    const qrSide = Math.min(heightMm - footer - pad, widthMm * 0.52);
    rects.push(...qrRects(payload.code, pad * 0.5, pad * 0.5, qrSide));
    const tx = pad * 0.5 + qrSide + 0.8;
    const tw = widthMm - tx - pad;
    const shortRef = unitShortRef(payload.unitId);
    const refSize = fitSize(shortRef, true, tw, 12, 6);
    let y = pad + refSize * MM_PER_PT;
    texts.push({ x: tx, y, sizePt: refSize, text: shortRef, bold: true });
    if (payload.sizeLabel) {
      const size = sanitize(payload.sizeLabel);
      const sizePt = fitSize(size, true, tw, 15, 7);
      y += sizePt * MM_PER_PT + 1.2;
      texts.push({ x: tx, y, sizePt, text: fit(size, sizePt, true, tw), bold: true });
    }
    const title = sanitize(payload.title);
    const linePt = 5.6;
    const perLine = Math.max(4, Math.floor(tw / (linePt * glyphEm(false) * MM_PER_PT)));
    const words = title.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const w of words) {
      if ((current ? `${current} ${w}` : w).length <= perLine) current = current ? `${current} ${w}` : w;
      else {
        if (current) lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
    const maxLines = Math.max(1, Math.floor((heightMm - footer - y - 1) / (linePt * MM_PER_PT * 1.15)));
    for (const line of lines.slice(0, Math.min(3, maxLines))) {
      y += linePt * MM_PER_PT * 1.15;
      texts.push({ x: tx, y, sizePt: linePt, text: fit(line, linePt, false, tw), bold: false });
    }
    if (payload.styleCode && y + linePt * MM_PER_PT * 1.15 < heightMm - footer) {
      y += linePt * MM_PER_PT * 1.15;
      texts.push({ x: tx, y, sizePt: linePt, text: fit(sanitize(payload.styleCode), linePt, true, tw), bold: true });
    }
    // Full code in clear text: the label stays usable if the QR is damaged.
    const codePt = fitSize(payload.code, false, widthMm - 2 * pad, 5, 3.2);
    texts.push({ x: pad, y: heightMm - 1, sizePt: codePt, text: payload.code, bold: false });
    return { widthMm, heightMm, rects, texts };
  }

  if (payload.kind === "LOCATION") {
    const footer = Math.max(3.5, heightMm * 0.12);
    const qrSide = Math.min(heightMm - footer - pad, widthMm * 0.42);
    rects.push(...qrRects(payload.code, pad * 0.5, pad * 0.5, qrSide));
    const tx = pad * 0.5 + qrSide + 1.5;
    const tw = widthMm - tx - pad;
    const short = sanitize(payload.shortCode);
    const shortPt = fitSize(short, true, tw, Math.min(64, (heightMm * 0.5) / MM_PER_PT), 8);
    texts.push({ x: tx, y: pad + shortPt * MM_PER_PT, sizePt: shortPt, text: short, bold: true });
    const kindPt = Math.max(5, Math.min(9, heightMm * 0.16));
    texts.push({ x: tx, y: pad + shortPt * MM_PER_PT + kindPt * MM_PER_PT + 1.5, sizePt: kindPt, text: sanitize(payload.locationKind), bold: false });
    const codePt = fitSize(payload.code, true, widthMm - 2 * pad, Math.min(11, footer / MM_PER_PT - 1), 4);
    texts.push({ x: pad, y: heightMm - 1.2, sizePt: codePt, text: payload.code, bold: true });
    return { widthMm, heightMm, rects, texts };
  }

  // TEST: a real QR + a frame at the media edge, to check size, alignment and scanner readability.
  const qrSide = Math.min(heightMm - 2 * pad, widthMm * 0.5);
  rects.push(...qrRects(payload.text, pad * 0.5, pad * 0.5, qrSide));
  const t = 0.3;
  rects.push({ x: 0, y: 0, w: widthMm, h: t }, { x: 0, y: heightMm - t, w: widthMm, h: t }, { x: 0, y: 0, w: t, h: heightMm }, { x: widthMm - t, y: 0, w: t, h: heightMm });
  const tx = pad * 0.5 + qrSide + 1;
  const tw = widthMm - tx - pad;
  const lines = ["TEST", sanitize(payload.stationCode), sanitize(payload.printerName), `${widthMm} x ${heightMm} mm`];
  let y = pad;
  lines.forEach((line, i) => {
    const pt = i === 0 ? 11 : 6;
    y += pt * MM_PER_PT * 1.2;
    texts.push({ x: tx, y, sizePt: pt, text: fit(line, pt, i === 0, tw), bold: i === 0 });
  });
  return { widthMm, heightMm, rects, texts };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

export function renderLabelSvg(payload: LabelPayload, widthMm: number, heightMm: number): string {
  const l = layoutLabel(payload, widthMm, heightMm);
  const rects = l.rects.map((r) => `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"/>`).join("");
  const texts = l.texts
    .map(
      (t) =>
        `<text x="${n(t.x)}" y="${n(t.y)}" font-size="${n(t.sizePt * MM_PER_PT)}" font-family="Helvetica, Arial, sans-serif"${t.bold ? ' font-weight="700"' : ""}>${esc(t.text)}</text>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="0 0 ${n(widthMm)} ${n(heightMm)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}${texts}</g></svg>`;
}

function pdfString(text: string): string {
  const latin = text.replace(/…/g, "...");
  let out = "";
  for (const ch of latin) {
    const code = ch.charCodeAt(0);
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else if (code > 0x7e) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return out;
}

/**
 * Multi-page vector PDF, one label per page at the exact media size (no scaling needed at the
 * printer: the page IS the label). Hand-built to avoid a PDF dependency; base-14 Helvetica.
 */
export function renderLabelsPdf(labels: { payload: LabelPayload; widthMm: number; heightMm: number }[]): Buffer {
  if (labels.length === 0) throw new Error("No label to render");
  const PT = 72 / 25.4;
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add("");
  const pagesId = add("");
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];

  for (const label of labels) {
    const l = layoutLabel(label.payload, label.widthMm, label.heightMm);
    const W = l.widthMm * PT;
    const H = l.heightMm * PT;
    const ops: string[] = ["0 0 0 rg"];
    for (const r of l.rects) {
      ops.push(`${n(r.x * PT)} ${n(H - (r.y + r.h) * PT)} ${n(r.w * PT)} ${n(r.h * PT)} re`);
    }
    if (l.rects.length) ops.push("f");
    for (const t of l.texts) {
      ops.push(`BT /${t.bold ? "F2" : "F1"} ${n(t.sizePt)} Tf ${n(t.x * PT)} ${n(H - t.y * PT)} Td (${pdfString(t.text)}) Tj ET`);
    }
    const stream = ops.join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`
      )
    );
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
