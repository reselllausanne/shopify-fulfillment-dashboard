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
 * Same temp-then-rename upload, but streams from a local file on disk instead of an
 * in-memory Buffer, so an 800MB master feed never has to sit in the heap.
 *
 * Uses `fastPut`, NOT `put`: against the Galaxus SFTP server ssh2-sftp-client v12's
 * stream/path `put` stalls indefinitely (0 bytes after 25min, probe hung >2h), while
 * `fastPut` (chunked parallel WRITEs) transfers reliably at ~37MB/s. `put(Buffer)`
 * also works but would defeat the whole point of streaming from disk.
 */
export async function uploadLocalFileTempThenRename(
  client: SftpClient,
  remoteDir: string,
  filename: string,
  localPath: string
): Promise<void> {
  const dir = remoteDir.replace(/\/$/, "");
  const tempPath = `${dir}/tmp_${filename}`;
  const finalPath = `${dir}/${filename}`;
  // fastPut exists at runtime (ssh2-sftp-client v12) but is missing from the bundled types.
  await (client as unknown as {
    fastPut: (src: string, dst: string) => Promise<string>;
  }).fastPut(localPath, tempPath);
  await client.rename(tempPath, finalPath);
}
