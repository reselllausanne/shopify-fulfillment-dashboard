const LANDING_URL = "https://www.resell-lausanne.ch/pages/black-friday";

/**
 * Exact sizes observed on eligible live-sale Shopify variants on 2026-11-11.
 * Never infer intermediate sizes or collapse fractional systems.
 */
export const BF2026_EMAIL_SIZES = [
  "23.5",
  "29.5",
  "31",
  "34",
  "35.5",
  "36",
  "36 2/3",
  "36.5",
  "37",
  "37.5",
  "38",
  "38 2/3",
  "38.5",
  "39",
  "39 1/3",
  "39.5",
  "40",
  "40 2/3",
  "40.5",
  "41",
  "41 1/3",
  "41.5",
  "42",
  "42 2/3",
  "42.5",
  "43",
  "43 1/3",
  "43.5",
  "44",
  "44.5",
  "45",
  "45 1/3",
  "45.5",
  "46",
] as const;

export type Bf2026EmailSize = (typeof BF2026_EMAIL_SIZES)[number];

function encode(value: string): string {
  return encodeURIComponent(value);
}

export function bf2026SizeUrl(size: Bf2026EmailSize): string {
  return (
    `${LANDING_URL}?size=${encode(size)}` +
    "&utm_source=email" +
    "&utm_medium=bfcm" +
    "&utm_campaign=bfcm_2026_size" +
    `&utm_content=size_${encode(size)}`
  );
}

export const BF2026_SIZE_LINKS = BF2026_EMAIL_SIZES.map((size) => ({
  label: `EU ${size}`,
  size,
  url: bf2026SizeUrl(size),
}));

function sizeRows(): string {
  const rows: string[] = [];
  for (let index = 0; index < BF2026_SIZE_LINKS.length; index += 4) {
    const cells = BF2026_SIZE_LINKS.slice(index, index + 4)
      .map(
        ({ label, url }) =>
          `<td width="25%" align="center" style="padding:4px;">` +
          `<a class="size-button" href="${url.replaceAll("&", "&amp;")}" ` +
          `style="display:block;padding:14px 4px;border:1px solid #D7D7D0;` +
          `color:#101010;font:700 13px/18px Arial,Helvetica,sans-serif;` +
          `text-decoration:none;">${label}</a></td>`,
      )
      .join("");
    rows.push(`<tr>${cells}${"<td></td>".repeat(4 - Math.min(4, BF2026_SIZE_LINKS.length - index))}</tr>`);
  }
  return rows.join("");
}

export function renderBf2026SizeEmailHtml(): string {
  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Choisis ta pointure</title>
<style>
html,body{margin:0!important;padding:0!important;width:100%!important}
table,td{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
a{color:inherit}
@media screen and (max-width:620px){.shell{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}.headline{font-size:42px!important;line-height:42px!important}.size-button{font-size:12px!important;padding:13px 2px!important}}
</style>
</head>
<body style="margin:0;padding:0;background:#ECEBE6;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Choisis ta pointure pour ton accès Black Friday privé.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ECEBE6">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px;max-width:600px;background:#FFFFFF;">
<tr><td align="center" style="padding:27px 24px 23px;"><a href="https://www.resell-lausanne.ch" style="text-decoration:none;color:#101010;font:600 29px/41px Arial,Helvetica,sans-serif;letter-spacing:-1.2px;">Resell Lausanne</a></td></tr>
<tr><td align="center" style="padding:10px 16px;border-top:1px solid #ECEBE6;font:700 10px Arial,Helvetica,sans-serif;letter-spacing:1.6px;color:#101010;">BLACK FRIDAY 2026 / ACCÈS PRIVÉ</td></tr>
<tr><td class="pad" bgcolor="#55B3F3" style="padding:38px;background:#55B3F3;">
<p style="margin:0 0 18px;font:700 10px/16px Arial,Helvetica,sans-serif;letter-spacing:1.8px;color:#101010;">RESELL LAUSANNE</p>
<h1 class="headline" style="margin:0;font:900 56px/54px Arial,Helvetica,sans-serif;letter-spacing:-2px;color:#101010;">CHOISIS TA<br>POINTURE.</h1>
</td></tr>
<tr><td class="pad" style="padding:30px 38px 18px;background:#FFFFFF;">
<p style="margin:0 0 8px;font:700 19px/26px Arial,Helvetica,sans-serif;color:#101010;">Réserve ton accès en un clic.</p>
<p style="margin:0;font:400 15px/24px Arial,Helvetica,sans-serif;color:#4A4A46;">Ta sélection sera enregistrée. Les deals restent secrets jusqu’au jour J.</p>
</td></tr>
<tr><td class="pad" style="padding:8px 34px 30px;background:#FFFFFF;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${sizeRows()}</table>
</td></tr>
<tr><td class="pad" style="padding:24px 38px 30px;background:#FFFFFF;">
<p style="margin:0 0 8px;font:400 11px/17px Arial,Helvetica,sans-serif;color:#74746E;">Tu reçois cet email parce que tu es abonné à Resell Lausanne.</p>
<p style="margin:0 0 10px;font:400 11px/17px Arial,Helvetica,sans-serif;color:#74746E;">{{ organization.full_address }}</p>
<a href="{% unsubscribe_link %}" style="font:400 11px Arial,Helvetica,sans-serif;color:#74746E;text-decoration:underline;">Se désinscrire</a>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

export function renderBf2026SizeEmailText(): string {
  const links = BF2026_SIZE_LINKS.map(
    ({ label, url }) => `${label} — ${url}`,
  ).join("\n");
  return `Resell Lausanne

BLACK FRIDAY 2026 / ACCÈS PRIVÉ

CHOISIS TA POINTURE.

Réserve ton accès en un clic.
Ta sélection sera enregistrée. Les deals restent secrets jusqu’au jour J.

${links}

Tu reçois cet email parce que tu es abonné à Resell Lausanne.
{{ organization.full_address }}
Se désinscrire : {% unsubscribe_link %}
`;
}
