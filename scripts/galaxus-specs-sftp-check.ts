// @ts-nocheck -- ad-hoc debug script, run manually via tsx (not part of app build runtime)
/**
 * Download the latest SpecificationData_*.csv from Galaxus SFTP and search for a providerKey.
 * Usage: npx tsx scripts/galaxus-specs-sftp-check.ts STX_191526411576
 */
import "dotenv/config";
import { Client } from "ssh2";

const HOST = process.env.GALAXUS_SFTP_HOST!;
const PORT = Number(process.env.GALAXUS_SFTP_PORT ?? "22");
const USER = process.env.GALAXUS_SFTP_USER!;
const PASS = process.env.GALAXUS_SFTP_PASSWORD!;
const DIR = process.env.GALAXUS_SFTP_FEEDS_DIR ?? "/ProductData";

function main() {
  const needle = (process.argv[2] ?? "STX_191526411576").trim();
  const conn = new Client();
  conn
    .on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err) {
          console.error("sftp err", err);
          conn.end();
          return;
        }
        sftp.readdir(DIR, (e, list) => {
          if (e) {
            console.error("readdir err", e);
            conn.end();
            return;
          }
          const matching = list.filter((f) => f.filename.startsWith("SpecificationData_"));
          matching.sort((a, b) => (b.attrs.mtime ?? 0) - (a.attrs.mtime ?? 0));
          console.log("SpecificationData files on SFTP:");
          for (const f of matching) {
            console.log("  ", f.filename, new Date((f.attrs.mtime ?? 0) * 1000).toISOString());
          }
          if (!matching.length) {
            conn.end();
            return;
          }
          const latest = matching[0];
          const path = `${DIR}/${latest.filename}`;
          const rs = sftp.createReadStream(path, { encoding: "utf8" });
          let content = "";
          rs.on("data", (d) => (content += d));
          rs.on("end", () => {
            const lines = content.split(/\r?\n/);
            console.log("\nLatest file:", latest.filename, path);
            console.log("Total lines (incl header):", lines.length);
            console.log("Header:", lines[0]);
            const matches = lines.filter((l) => l.includes(needle));
            console.log(`\nRows containing '${needle}': ${matches.length}`);
            for (const m of matches) console.log("  ", m);
            conn.end();
          });
          rs.on("error", (er) => {
            console.error("read err", er);
            conn.end();
          });
        });
      });
    })
    .on("error", (e) => {
      console.error("conn err", e);
      process.exit(1);
    })
    .connect({ host: HOST, port: PORT, username: USER, password: PASS });
}

main();
