import fs from "fs/promises";
import path from "path";
import { GALAXUS_DOCS_LOCAL_DIR } from "../config";
import type { StorageAdapter, StoredFile, StorageFileResult } from "./types";

export function createLocalStorage(baseDir = GALAXUS_DOCS_LOCAL_DIR): StorageAdapter {
  return {
    async uploadPdf(key: string, content: Buffer): Promise<StoredFile> {
      const filePath = path.join(baseDir, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      return { storageUrl: `file://${filePath}` };
    },

    async getPdf(storageUrl: string): Promise<StorageFileResult> {
      const filePath = storageUrl.replace("file://", "");
      const content = await fs.readFile(filePath);
      return { content };
    },
  };
}
