import bwipjs from "bwip-js";

export async function createSsccBarcodeDataUrl(sscc: string): Promise<string> {
  const text = `(00)${sscc}`;
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
