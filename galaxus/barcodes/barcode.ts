import bwipjs from "bwip-js";

export function normalizeSscc(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const base = digits.slice(0, 17).padEnd(17, "0");
  const check = calculateGs1CheckDigit(base);
  return `${base}${check}`;
}

export async function createSsccBarcodeDataUrl(sscc: string): Promise<string> {
  const text = `(00)${normalizeSscc(sscc)}`;
  const buffer = await bwipjs.toBuffer({
    bcid: "gs1-128",
    text,
    scale: 2,
    height: 10,
    includetext: true,
    textxalign: "center",
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function calculateGs1CheckDigit(base17: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = base17.length - 1; i >= 0; i -= 1) {
    sum += Number(base17[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}
