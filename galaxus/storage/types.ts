export type StoredFile = {
  storageUrl: string;
};

export type StorageFileResult = {
  content: Buffer;
};

export interface StorageAdapter {
  uploadPdf: (key: string, content: Buffer) => Promise<StoredFile>;
  getPdf: (storageUrl: string) => Promise<StorageFileResult>;
}
