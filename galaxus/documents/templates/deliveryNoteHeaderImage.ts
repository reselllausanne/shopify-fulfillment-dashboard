import fs from "fs";
import path from "path";

let cachedHeaderImageDataUri: string | null | undefined;
let cachedCalibriDataUri: string | null | undefined;

export function getDeliveryNoteHeaderImageDataUri(): string | null {
  if (cachedHeaderImageDataUri !== undefined) {
    return cachedHeaderImageDataUri;
  }

  const imagePath = path.join(
    process.cwd(),
    "galaxus",
    "documents",
    "templates",
    "assets",
    "lieferschein_kopf_neutral.png"
  );

  if (!fs.existsSync(imagePath)) {
    cachedHeaderImageDataUri = null;
    return cachedHeaderImageDataUri;
  }

  const content = fs.readFileSync(imagePath);
  cachedHeaderImageDataUri = `data:image/png;base64,${content.toString("base64")}`;
  return cachedHeaderImageDataUri;
}

export function getDeliveryNoteCalibriDataUri(): string | null {
  if (cachedCalibriDataUri !== undefined) {
    return cachedCalibriDataUri;
  }

  const fontPath = path.join(
    process.cwd(),
    "galaxus",
    "documents",
    "templates",
    "assets",
    "Calibri.ttf"
  );

  if (!fs.existsSync(fontPath)) {
    cachedCalibriDataUri = null;
    return cachedCalibriDataUri;
  }

  const content = fs.readFileSync(fontPath);
  cachedCalibriDataUri = `data:font/ttf;base64,${content.toString("base64")}`;
  return cachedCalibriDataUri;
}
