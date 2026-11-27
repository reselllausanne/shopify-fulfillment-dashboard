/**
 * Faits SOURCÉS uniquement : fiche #10 de
 * docs/jarvis/inbox/recherche/2026-11-27_commerces-sans-site-lausanne.md
 * (PR #564, consultée le 2026-11-27). Ne rien ajouter ici qui ne figure pas dans la fiche.
 */
export const BUSINESS = {
  name: "BİLOO Barber Shop",
  activity: "Barbier",
  streetAddress: "Avenue Alexandre-Vinet 26",
  streetAddressDisplay: "Avenue Alexandre-Vinet 26/26 bis",
  postalCode: "1004",
  locality: "Lausanne",
  country: "CH",
  phoneDisplay: "+41 79 508 20 96",
  phoneTel: "+41795082096",
  geo: { lat: 46.5265411, lon: 6.6286872 },
  mapsUrl:
    "https://www.google.com/maps/place/B%C4%B0LOO+Barber+Shop+-+Lausanne/data=!4m7!3m6!1s0x478c2fe8d7d8e89d:0x5f8cb8a8ba8d3ef6!8m2!3d46.5265411!4d6.6286872!16s%2Fg%2F11y1yp7x3n!19sChIJnejY1-gvjEcR9j6Nuqi4jF8",
  rating: { value: "4,9", count: 127 },
  ratingSource: "Fiche Google Maps (chiffres relayés par le miroir Exa), consulté le 27.11.2026",
} as const;
