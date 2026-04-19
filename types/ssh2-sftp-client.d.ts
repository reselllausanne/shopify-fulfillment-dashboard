declare module "ssh2-sftp-client" {
  export default class SftpClient {
    connect(config: any): Promise<void>;
    end(): Promise<void>;
    list(path: string): Promise<Array<{ name: string; type: string; size: number; modifyTime?: number }>>;
    get(path: string): Promise<Buffer>;
    put(data: Buffer | string, path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    delete(path: string): Promise<void>;
  }
}
