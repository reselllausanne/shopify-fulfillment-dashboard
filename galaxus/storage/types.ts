export type StoredFile = {
  storageUrl: string;
  publicUrl?: string | null;
};

export type StorageFileResult = {
  content: Buffer;
};

export interface StorageAdapter {
  uploadPdf: (key: string, content: Buffer) => Promise<StoredFile>;
  getPdf: (storageUrl: string) => Promise<StorageFileResult>;
  uploadBinary?: (key: string, content: Buffer, contentType: string) => Promise<StoredFile>;
}
