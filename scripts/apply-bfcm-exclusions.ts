/**
 * Apply BFCM exclusion flags to EXISTING Klaviyo profiles (properties only).
 * Never subscribes, never creates profiles, never touches consent.
 * Usage: npx tsx --env-file=.env scripts/apply-bfcm-exclusions.ts <dir> [--apply]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!DIR) throw new Error("dir required");

const H = {
  Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

function parseCsv(text: string): Record<string, string>[] {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function findProfile(email: string) {
  const f = encodeURIComponent(`equals(email,"${email.replace(/"/g, "")}")`);
  const r = await fetch(`https://a.klaviyo.com/api/profiles/?filter=${f}`, { headers: H });
  if (r.status === 429) { await new Promise((x) => setTimeout(x, 2000)); return findProfile(email); }
  const j = await r.json();
  return (j.data ?? [])[0] ?? null;
}

async function patch(id: string, properties: Record<string, unknown>) {
  const r = await fetch(`https://a.klaviyo.com/api/profiles/${id}/`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ data: { type: "profile", id, attributes: { properties } } }),
  });
  if (r.status === 429) { await new Promise((x) => setTimeout(x, 2000)); return patch(id, properties); }
  if (!r.ok) throw new Error(`PATCH ${id} ${r.status} ${(await r.text()).slice(0, 200)}`);
}

(async () => {
  const jobs: { file: string; flag: "rl_bf_2026_excluded" | "rl_marketing_hold" }[] = [
    { file: "IMPORT_A_VALIDER_Exclusion_BF.csv", flag: "rl_bf_2026_excluded" },
    { file: "IMPORT_A_VALIDER_Pause_SAV.csv", flag: "rl_marketing_hold" },
  ];
  const missing: string[] = [];
  let ok = 0;
  const flagged: string[] = [];

  const work: { email: string; props: Record<string, unknown> }[] = [];
  for (const { file, flag } of jobs) {
    for (const r of parseCsv(readFileSync(join(DIR, file), "utf8"))) {
      const email = r.Email.trim().toLowerCase();
      if (!email) continue;
      work.push({
        email,
        props: {
          [flag]: true,
          rl_marketing_hold_reason: r.rl_marketing_hold_reason,
          rl_marketing_hold_source: r.rl_marketing_hold_source,
          rl_exclusion_reviewed_at: r.rl_exclusion_reviewed_at,
        },
      });
    }
  }
  // opposition: hold flag too (native suppression is separate)
  for (const r of parseCsv(readFileSync(join(DIR, "03_Opposition_emails.csv"), "utf8"))) {
    const email = r.Email.trim().toLowerCase();
    if (email)
      work.push({
        email,
        props: {
          rl_marketing_hold: true,
          rl_marketing_hold_reason: "Opposition explicite aux emails",
          rl_marketing_hold_source: r.Lien_Gmail,
          rl_exclusion_reviewed_at: "2026-11-14",
        },
      });
  }

  for (const w of work) {
    const p = await findProfile(w.email);
    if (!p) { missing.push(w.email); continue; }
    if (APPLY) await patch(p.id, w.props);
    ok++;
    flagged.push(w.email);
  }
  console.log(JSON.stringify({ apply: APPLY, rows: work.length, matchedInKlaviyo: ok, notInKlaviyo: missing.length }));
  console.log("not in Klaviyo (nothing to exclude, no profile):", missing.length);
})();
