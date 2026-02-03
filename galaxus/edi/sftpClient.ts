import "server-only";
import SftpClient from "ssh2-sftp-client";

type SftpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
};

export type RemoteFile = {
  name: string;
  path: string;
  size: number;
  modifyTime?: number;
};

export async function withSftp<T>(
  config: SftpConfig,
  handler: (client: SftpClient) => Promise<T>
): Promise<T> {
  const client = new SftpClient();
  try {
    await client.connect(config);
    return await handler(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function listRemoteFiles(
  client: SftpClient,
  remoteDir: string
): Promise<RemoteFile[]> {
  const entries = await client.list(remoteDir);
  return entries
    .filter((entry) => entry.type === "-")
    .map((entry) => ({
      name: entry.name,
      path: `${remoteDir.replace(/\/$/, "")}/${entry.name}`,
      size: entry.size,
      modifyTime: entry.modifyTime,
    }));
}

export async function downloadRemoteFile(client: SftpClient, remotePath: string): Promise<string> {
  const buffer = await client.get(remotePath);
  return buffer.toString();
}

export async function uploadTempThenRename(
  client: SftpClient,
  remoteDir: string,
  filename: string,
  content: string | Buffer
): Promise<void> {
  const dir = remoteDir.replace(/\/$/, "");
  const tempName = `tmp_${filename}`;
  const tempPath = `${dir}/${tempName}`;
  const finalPath = `${dir}/${filename}`;
  await client.put(Buffer.from(content), tempPath);
  await client.rename(tempPath, finalPath);
}
