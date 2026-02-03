export const GALAXUS_SFTP_HOST = process.env.GALAXUS_SFTP_HOST ?? "ftp.digitecgalaxus.ch";
export const GALAXUS_SFTP_PORT = Number(process.env.GALAXUS_SFTP_PORT ?? "22");
export const GALAXUS_SFTP_USER = process.env.GALAXUS_SFTP_USER ?? "";
export const GALAXUS_SFTP_PASSWORD = process.env.GALAXUS_SFTP_PASSWORD ?? "";
export const GALAXUS_SFTP_IN_DIR = process.env.GALAXUS_SFTP_IN_DIR ?? "/dg2partner";
export const GALAXUS_SFTP_OUT_DIR = process.env.GALAXUS_SFTP_OUT_DIR ?? "/partner2dg";
export const GALAXUS_SUPPLIER_ID = process.env.GALAXUS_SUPPLIER_ID ?? "";

export function assertSftpConfig() {
  if (!GALAXUS_SFTP_USER || !GALAXUS_SFTP_PASSWORD || !GALAXUS_SUPPLIER_ID) {
    throw new Error("Missing Galaxus SFTP credentials or supplier id.");
  }
}
