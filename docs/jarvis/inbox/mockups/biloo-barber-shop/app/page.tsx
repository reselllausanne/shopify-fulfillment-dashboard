import { BUSINESS } from "./business";

/*
 * Tout bloc marqué EXEMPLE ci-dessous (prestations, prix, accroche, horaires)
 * est un texte NON SOURCÉ : exemple, à valider avec le commerçant.
 */

// EXEMPLE : prestations et prix indicatifs, inventés pour la démo.
const SERVICES = [
  { name: "Coupe homme", desc: "Ciseaux ou tondeuse, finitions nettes.", price: "35" },
  { name: "Dégradé (fade)", desc: "Dégradé précis, du plus ras au plus progressif.", price: "40" },
  { name: "Taille de barbe", desc: "Contours, volume et soin de la barbe.", price: "25" },
  { name: "Coupe + barbe", desc: "La formule complète.", price: "55" },
  { name: "Rasage traditionnel", desc: "Serviette chaude et rasoir.", price: "35" },
  { name: "Coupe enfant", desc: "Jusqu'à 12 ans.", price: "25" },
] as const;

// EXEMPLE : horaires inventés, absents de la fiche source.
const HOURS = [
  { day: "Lundi", hours: "Fermé" },
  { day: "Mardi", hours: "09:00 – 19:00" },
  { day: "Mercredi", hours: "09:00 – 19:00" },
  { day: "Jeudi", hours: "09:00 – 19:00" },
  { day: "Vendredi", hours: "09:00 – 19:00" },
  { day: "Samedi", hours: "09:00 – 18:00" },
  { day: "Dimanche", hours: "Fermé" },
] as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BarberShop",
  name: BUSINESS.name,
  address: {
    "@type": "PostalAddress",
    streetAddress: BUSINESS.streetAddress,
    postalCode: BUSINESS.postalCode,
    addressLocality: BUSINESS.locality,
    addressCountry: BUSINESS.country,
  },
  telephone: BUSINESS.phoneTel,
  geo: {
    "@type": "GeoCoordinates",
    latitude: BUSINESS.geo.lat,
    longitude: BUSINESS.geo.lon,
  },
  hasMap: BUSINESS.mapsUrl,
  // Volontairement absents : horaires, prix, aggregateRating (non vérifiables ou non datés).
};

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <a className="skip" href="#contenu">Aller au contenu</a>

      <header className="topbar">
        <div className="wrap topbar-in">
          <a href="#top" className="brand" aria-label={`${BUSINESS.name}, accueil`}>
            BİLOO<span> Barber Shop</span>
          </a>
          <nav aria-label="Navigation principale" className="nav">
            <a href="#prestations">Prestations</a>
            <a href="#horaires">Horaires</a>
            <a href="#contact">Contact</a>
          </nav>
          <a className="btn btn-sm btn-gold" href={`tel:${BUSINESS.phoneTel}`}>
            <PhoneIcon /> Appeler
          </a>
        </div>
      </header>

      <main id="contenu">
        <section className="hero" id="top">
          <div className="wrap hero-in">
            <div className="hero-copy">
              <p className="eyebrow">{BUSINESS.activity} · {BUSINESS.locality}</p>
              <h1>BİLOO <em>Barber Shop</em></h1>
              {/* EXEMPLE : accroche inventée, à valider avec le commerçant. */}
              <p className="lead">
                Coupes précises, barbe soignée, ambiance posée. Au cœur de Lausanne.
                <Badge>Exemple</Badge>
              </p>
              <div className="cta-row">
                <a className="btn btn-gold" href={`tel:${BUSINESS.phoneTel}`}>
                  <PhoneIcon /> Appeler le {BUSINESS.phoneDisplay}
                </a>
                <a className="btn btn-ghost" href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer">
                  <PinIcon /> Itinéraire
                </a>
              </div>
              <a className="rating" href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer">
                <span className="stars" aria-hidden="true">★★★★★</span>
                <strong>{BUSINESS.rating.value}</strong> sur Google · {BUSINESS.rating.count} avis
                <span className="sr-only"> (ouvre Google Maps dans un nouvel onglet)</span>
              </a>
              <p className="source">Source : {BUSINESS.ratingSource}.</p>
            </div>

            {/* Placeholder visuel CSS/SVG : aucune photo du commerce utilisée. */}
            <figure className="visual" aria-label="Illustration provisoire">
              <div className="pole" aria-hidden="true" />
              <svg className="scissors" viewBox="0 0 120 120" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <circle cx="30" cy="92" r="14" />
                <circle cx="90" cy="92" r="14" />
                <path d="M40 80 88 14M80 80 32 14" />
              </svg>
              <figcaption>Illustration provisoire. Photo définitive à fournir par le commerçant.</figcaption>
            </figure>
          </div>
        </section>

        <section className="section" id="prestations" aria-labelledby="h-prest">
          <div className="wrap">
            <p className="eyebrow">Carte</p>
            <h2 id="h-prest">Prestations</h2>
            <p className="note">
              <Badge>Exemple</Badge> Prestations et prix indicatifs en CHF, à valider avec le commerçant.
            </p>
            <ul className="services">
              {SERVICES.map((s) => (
                <li key={s.name}>
                  <div>
                    <h3>{s.name}</h3>
                    <p>{s.desc}</p>
                  </div>
                  <span className="price"><span className="sr-only">à partir de </span>{s.price}<small> CHF</small></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section alt" id="horaires" aria-labelledby="h-hor">
          <div className="wrap split">
            <div>
              <p className="eyebrow">Quand venir</p>
              <h2 id="h-hor">Horaires</h2>
              <p className="note">
                <Badge>Exemple</Badge> Horaires non communiqués par la source : à confirmer avec le commerçant.
              </p>
            </div>
            <table className="hours">
              <caption className="sr-only">Horaires d&apos;ouverture (exemple)</caption>
              <tbody>
                {HOURS.map((h) => (
                  <tr key={h.day}>
                    <th scope="row">{h.day}</th>
                    <td className={h.hours === "Fermé" ? "closed" : ""}>{h.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section" id="contact" aria-labelledby="h-contact">
          <div className="wrap split">
            <div>
              <p className="eyebrow">Nous trouver</p>
              <h2 id="h-contact">Contact</h2>
              <address className="addr">
                <strong>{BUSINESS.name}</strong>
                <br />
                {BUSINESS.streetAddressDisplay}
                <br />
                {BUSINESS.postalCode} {BUSINESS.locality}
              </address>
              <p className="phone">
                <a href={`tel:${BUSINESS.phoneTel}`}>{BUSINESS.phoneDisplay}</a>
              </p>
              <div className="cta-row">
                <a className="btn btn-gold" href={`tel:${BUSINESS.phoneTel}`}>
                  <PhoneIcon /> Appeler
                </a>
                <a className="btn btn-ghost" href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer">
                  <PinIcon /> Ouvrir dans Google Maps
                  <span className="sr-only"> (nouvel onglet)</span>
                </a>
              </div>
            </div>

            {/* Lien plutôt qu'embed : aucune requête vers un tiers au chargement, aucune clé API. */}
            <a className="map" href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer" aria-label="Voir BİLOO Barber Shop sur Google Maps (nouvel onglet)">
              <svg viewBox="0 0 400 260" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
                <rect width="400" height="260" fill="#1c1815" />
                <g stroke="#2c2620" strokeWidth="14" fill="none">
                  <path d="M-10 70 L410 40" />
                  <path d="M-10 190 L410 210" />
                  <path d="M120 -10 L150 270" />
                  <path d="M290 -10 L260 270" />
                </g>
                <g stroke="#3a3128" strokeWidth="3" fill="none">
                  <path d="M-10 130 L410 120" />
                  <path d="M200 -10 L210 270" />
                </g>
              </svg>
              <span className="pin"><PinIcon /></span>
              <span className="map-label">Voir sur Google Maps</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="demo" role="contentinfo">
        <div className="wrap">
          <p className="demo-title">Page de démonstration</p>
          <p>
            Mock-up non officiel, réalisé sans contact avec le commerce. Seuls sont sourcés : nom, adresse,
            téléphone public, lien Google Maps, note 4,9 et 127 avis (consultés le 27.11.2026).
            Prestations, prix, horaires, accroche : <strong>exemple, à valider avec le commerçant</strong>.
            Photo définitive à fournir par le commerçant.
          </p>
        </div>
      </footer>

      <div className="sticky-cta" role="group" aria-label="Actions rapides">
        <a className="btn btn-gold" href={`tel:${BUSINESS.phoneTel}`}>
          <PhoneIcon /> Appeler
        </a>
        <a className="btn btn-ghost" href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer">
          <PinIcon /> Itinéraire
        </a>
      </div>
    </>
  );
}
