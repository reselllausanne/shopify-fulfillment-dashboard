const LANDING_URL = "https://www.resell-lausanne.ch/pages/black-friday";

/**
 * Live landing ranges. Each email button opens one range.
 * Exact sizes stay distinct inside that range; the landing expands them.
 */
export const BF2026_EMAIL_SIZE_RANGES = [
  {
    label: "36–37.5",
    size: "36-37.5",
    sizes: ["36", "36 2/3", "36.5", "37", "37.5"],
  },
  {
    label: "38–39.5",
    size: "38-39.5",
    sizes: ["38", "38 2/3", "38.5", "39", "39 1/3", "39.5"],
  },
  {
    label: "40–41.5",
    size: "40-41.5",
    sizes: ["40", "40 2/3", "40.5", "41", "41 1/3", "41.5"],
  },
  {
    label: "42–43.5",
    size: "42-43.5",
    sizes: ["42", "42 2/3", "42.5", "43", "43 1/3", "43.5"],
  },
  {
    label: "44–46",
    size: "44-46",
    sizes: ["44", "44.5", "45", "45 1/3", "45.5", "46"],
  },
] as const;

export type Bf2026EmailSizeRange =
  (typeof BF2026_EMAIL_SIZE_RANGES)[number]["size"];

export function bf2026SizeUrl(size: Bf2026EmailSizeRange): string {
  return (
    `${LANDING_URL}?size=${size}` +
    "&utm_source=email" +
    "&utm_medium=bfcm" +
    "&utm_campaign=bfcm_2026_size" +
    `&utm_content=size_${size}`
  );
}

export const BF2026_SIZE_LINKS = BF2026_EMAIL_SIZE_RANGES.map((range) => ({
  label: range.label,
  size: range.size,
  url: bf2026SizeUrl(range.size),
}));

function sizeRows(): string {
  return BF2026_SIZE_LINKS.map(
    ({ label, url }) =>
      `<tr><td style="padding:4px 0;"><a class="size-button" href="${url.replaceAll("&", "&amp;")}" ` +
      `style="display:block;padding:16px 12px;border:1px solid #D7D7D0;` +
      `color:#101010;font:700 16px/20px Arial,Helvetica,sans-serif;` +
      `text-align:center;text-decoration:none;">${label}</a></td></tr>`,
  ).join("");
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
@media screen and (max-width:620px){.shell{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}.headline{font-size:42px!important;line-height:42px!important}.size-button{font-size:15px!important;padding:15px 8px!important}}
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
