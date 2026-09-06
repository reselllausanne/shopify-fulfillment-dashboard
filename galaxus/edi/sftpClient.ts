import SftpClient from "ssh2-sftp-client";

type SftpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
};

type RemoteFile = {
  name: string;
  path: string;
  size: number;
  modifyTime?: number;
};

export async function withSftp<T>(
  config: SftpConfig,
  handler: (client: SftpClient) => Promise<T>,
  options: { timeoutMs?: number } = {}
): Promise<T> {
  // Hard cap so warehouse Swiss Post label never waits forever on hung Galaxus SFTP.
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs ?? 45_000));
  const client = new SftpClient();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const work = (async () => {
      await client.connect({
        ...config,
        readyTimeout: Math.min(20_000, timeoutMs),
      });
      return await handler(client);
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`SFTP operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
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
  await client.put(Buffer.isBuffer(content) ? content : Buffer.from(content), tempPath);
  await client.rename(tempPath, finalPath);
}

/**
 * Same tmp → rename dance, but ssh2-sftp-client reads the local file as a
 * stream so the whole CSV never lives in the Node heap. Use for master/specs
 * feeds where the CSV can be several hundred MB.
 */
export async function uploadFilePathTempThenRename(
  client: SftpClient,
  remoteDir: string,
  filename: string,
  localFilePath: string
): Promise<void> {
  const dir = remoteDir.replace(/\/$/, "");
  const tempName = `tmp_${filename}`;
  const tempPath = `${dir}/${tempName}`;
  const finalPath = `${dir}/${filename}`;
  // fastPut opens a local read stream + parallel SFTP write — no Buffer in RAM.
  const fastPut = (client as unknown as {
    fastPut?: (localPath: string, remotePath: string) => Promise<unknown>;
  }).fastPut;
  if (typeof fastPut === "function") {
    await fastPut.call(client, localFilePath, tempPath);
  } else {
    // Older ssh2-sftp-client: `put` accepts a local path string when it exists on disk.
    await client.put(localFilePath, tempPath);
  }
  await client.rename(tempPath, finalPath);
}
