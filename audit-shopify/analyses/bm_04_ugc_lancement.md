> **ERRATUM 2026-11-02 23:30 (pilote).** Les chiffres de ce fichier reposent sur une TVA de 8,1 % extraite des prix. Le dirigeant déclare le forfait TDFN 2,1 % du CA TTC (non prouvé, relevés inaccessibles). Lire : contribution avant pub **40,3 CHF/commande** (et non 28,8), ROAS global d équilibre **≈ 5,4** (et non 7,6), résultat 2026 avant rémunération **+11,9 k CHF** (et non −21,2 k). Les conclusions « la pub dépasse la contribution » deviennent « la pub marginale (≈ 42-75 CHF/commande) dépasse la contribution unitaire (40,3) ; la moyenne reste légèrement positive ». Voir `fin_00_base_financiere.md`.

# bm_04 — UGC, contenu et lancement commercial par étapes

Sous-agent n°3 — mandat BRIEF_MAITRE §14. Date de consultation de toutes les sources : **2026-11-02**. Lecture seule ; aucun créateur, plateforme ou agence contacté ; aucune publicité lancée ni compte modifié.
Ceci n'est **pas** un avis juridique : les points de droit sont à faire valider par un juriste suisse (et, pour des consommateurs de l'UE, par un conseil connaissant le droit applicable).

Légende : **[I]** interne · **[O]** source officielle · **[S]** source sectorielle/doctrine · **[P]** affirmation de prestataire (agence/blog commercial, non auditée) · **[W]** constat sur le site public · **[H]** hypothèse.

## 0. Verdict

1. **Le contenu ne répare pas l'économie.** Contribution avant publicité 40,3 CHF/commande (base corrigée TDFN) ; un canal payant n'est rentable que si le ROAS (CA TTC conservé / dépenses) dépasse ≈ **5,4** ; le Google Ads actuel est à ≈ **6,2** en moyenne mais ≈ 75 CHF de pub par commande marginale (fin_00 §4). L'écart moyen est mince (+5,3 CHF/commande) et fragile ; un nouveau canal doit viser un niveau supérieur au point mort pour ne pas perdre d'argent. Aucune vidéo ne garantit ce niveau.
2. **Cas du benchmark** : The Sneaker Store (DK) a bâti sa croissance sur du contenu TikTok organique avec un créateur salarié, mais son résultat brut est devenu négatif sur l'exercice 2025 (bm_01) — le contenu a produit de l'audience, pas une marge.
3. **Avant tout contenu** : le site affiche « 4,9 ★ — 589+ avis vérifiés » alors que Judge.me seul donne 410 avis ≈ **4,66** (cx_03) [W/I]. Utiliser du contenu client pour soutenir une note ou un nombre inexact accroît le risque de pratique trompeuse (§2).
4. **Dispositif recommandé (hypothèse)** : (a) contenu de **clients vérifiés** et de produits réellement livrés ; (b) **petit** lot de contenus de créateurs rémunérés (4–8 vidéos) avec contrat de droits et mention de collaboration ; (c) contenu interne (préparation, tailles, délais réels). Pas de « témoignage » joué.
5. **Coût total d'un lancement par étapes** (créateurs, droits, produits offerts, temps, média test) : **≈ 4,3 k CHF (bas), ≈ 9,9 k CHF (médian), ≈ 17,2 k CHF (haut)**, dont le temps de travail valorisé à 40 CHF/h (hypothèse) et un média de test de 1,5–5 k CHF (hypothèse). Les tarifs de créateurs viennent de prestataires **[P]**, pas de devis. À comparer à une contribution actuelle de ≈ −2,1 k CHF/mois avant rémunération (fin_00 : −21,2 k sur 10 mois).
6. **Ouvrir Meta seulement si** les conditions du §6 sont remplies. G1 (économie de base) est atteinte en moyenne mais fragile (+5,3 CHF/commande) ; **G2 à G8 ne sont pas remplies** (promesses incohérentes ; 71–96 % des commandes expédiées en plus de 7 jours ; aucun test de contenu ; mesure non vérifiée ; cadre légal ; plafond de perte ; capacité).

---

## 1. Pourquoi l'économie unitaire borne l'usage du contenu

Source : `calculs/bm_ugc_01_cout.py` → `tableaux/bm_ugc_seuil_roas.csv` (entrées : fin_00, 2026-01→10).

| Indicateur | Valeur | Étiquette |
|---|---|---|
| CA TTC conservé (brut 685 086 − remboursements 57 789) | 627 297 CHF | F |
| Contribution avant publicité | 116 031 CHF = **40,3 CHF/commande** (nouveau client 40 CHF ; récurrent 62 CHF) — base corrigée TDFN (fin_00) | F/D |
| Publicité Google (`DailyAdSpend`) | 100 856 CHF = 35,0 CHF/commande | F |
| Contribution avant pub / CA TTC conservé | 13,2 % | calcul |
| **ROAS observé** (CA TTC conservé / pub) | **6,2** | calcul |
| **ROAS d'équilibre** (avant frais fixes) | **5,4** | calcul |
| CPA d'équilibre par nouvelle commande | 40,3 CHF | calcul |
| Rendement marginal (oct. 2025 → oct. 2026) | ≈ 70 CHF de pub par commande additionnelle | fin_00 §4 (lecture confondue par la saisonnalité) |

**Définition** : ce ROAS « global » divise **tout** le CA TTC conservé de la boutique (organique compris) par la dépense Google ; ce n'est pas le ROAS revendiqué par Google (≈ 3,1–4,0 selon `ads_01_structure_et_depenses.md`, valeur de conversion Google, autre base). Le seuil de 5,4 vaut pour un ratio défini de la même façon ; en attribution par canal, l'équilibre est plus exigeant. Voir ads_01/ads_02 pour l'attribution.

**Interprétation** : le canal payant existant dépasse déjà la contribution disponible. Un nouveau canal doit viser un CPA < ≈ 28 CHF (nouveau client) ; le réachat (9,6 % à 365 jours) ajoute peu. Le contenu n'a de valeur économique que s'il : (a) abaisse le CPA, (b) augmente la conversion de ce qui est déjà visité, ou (c) réduit les retours/litiges en fixant les attentes. **Confiance** : moyenne (calcul simple, base fin_00 avec coûts partiellement estimés).

---

## 2. Cadre légal et déontologique (extraits sourcés)

### 2.1 Suisse

- **UWG art. 2 et art. 3 al. 1 let. b** : *« Unlauter und widerrechtlich ist jedes täuschende oder in anderer Weise gegen den Grundsatz von Treu und Glauben verstossende Verhalten… »* ; *« Unlauter handelt insbesondere, wer über sich, seine Firma… seine Waren, Werke oder Leistungen, deren Preise, die vorrätige Menge… unrichtige oder irreführende Angaben macht »* (Fedlex, SR 241, https://www.fedlex.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/1988/223_223_223/20250101/de/pdf-a/fedlex-data-admin-ch-eli-cc-1988-223_223_223-20250101-de-pdf-a.pdf, consulté 2026-11-02). **Application** : exactitude de la note, du nombre d'avis, du délai, du nombre de références, de la quantité en stock (« vorrätige Menge »). Un contenu dont la promesse (ex. « 48 h ») est contredite par la réalité entre sous cette règle.
- **Principes de la Commission suisse pour la loyauté (SLK), édition 1.1.2025, B.15a** : *« Kommerzielle Kommunikation ist irreführend und damit unlauter, wenn sie… nicht so gestaltet und gekennzeichnet ist, dass sie als bezahlte Einschaltung klar erkennbar ist. »* ; le placement de produit contre rémunération ou contrepartie est déloyal tant que le commanditaire n'est pas transparent (https://www.faire-werbung.ch/wp-content/uploads/2025/01/SLK-Grundsaetze_DE-1.1.2025.pdf). Selon doctrine : l'influenceur doit divulguer sa relation avec le commanditaire, en particulier en cas de rémunération ou de prestations en nature (Vischer, https://www.vischer.com/de/insights/werbetrennung-im-influencer-marketing-in-der-schweiz-38349 ; Chambers 2026, https://practiceguides.chambers.com/practice-guides/advertising-and-marketing-2026/switzerland/trends-and-developments). Le Conseil fédéral estime qu'il n'y a pas d'obligation générale de marquage si la publicité est reconnaissable comme telle pour le destinataire moyen, mais cela s'apprécie au cas par cas (Härting, https://haerting.ch/wissen/influencer-werbung-ist-auch-werbung/). Une simple mention de remerciement (« Danke an XYZ ») ne suffit probablement pas (Vischer). La SLK n'est **pas un tribunal** ; ses principes sont une référence de l'industrie.
- **Avis** : pas de règle suisse spécifique sur les avis ; ce sont l'art. 3 al. 1 let. b UWG et le principe B.15 qui s'appliquent ; l'usage de faux profils pour masquer le caractère commercial est déloyal (digitalvantage.ch, doctrine secondaire : https://www.digitalvantage.ch/posts/ecommerce/marketing/affiliate-marketing).

### 2.2 Union européenne (si on cible des consommateurs de l'UE — applicabilité à valider)

- **Directive 2005/29/CE, annexe I point 11** : est toujours déloyal le *« using editorial content in the media to promote a product where a trader has paid for the promotion without making that clear in the content… (advertorial) »* (https://eur-lex.europa.eu/resource.html?format=PDF&uri=cellar%3Ae6fc22bd-9b63-45a6-9eba-204809bd9072.0006.02%2FDOC_2). La CJUE (affaire C-371/20) précise qu'une publication est « payée » dès qu'il y a une contrepartie ayant une valeur patrimoniale, par exemple la mise à disposition gratuite d'images protégées, s'il existe un lien certain entre la contrepartie et la publication (https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A62020CJ0371). **Application** : un produit offert à un créateur contre une publication est une contrepartie ; il faut le déclarer.
- **Directive Omnibus (UE) 2019/2161**, annexe I points 23b et 23c : est toujours déloyal de *« stating that reviews of a product are submitted by consumers who have actually used or purchased the product without taking reasonable and proportionate steps to check that they originate from such consumers »* et de *« submitting or commissioning another legal or natural person to submit false consumer reviews or endorsements, or misrepresenting consumer reviews or social endorsements, in order to promote products »* (https://eur-lex.europa.eu/eli/dir/2019/2161/oj/eng). Le considérant 47 demande d'indiquer si des procédures vérifient l'origine des avis et si les avis ont été « sponsorisés ou influencés par une relation contractuelle ».
- **Réserve** : un commentateur indique que la directive 2005/29 ne s'applique pas à une boutique suisse « as such » (digitalvantage.ch) ; son application à un vendeur suisse ciblant des consommateurs UE n'est pas tranchée ici.

### 2.3 Conséquences opérationnelles pour le dispositif

| Règle | Conséquence |
|---|---|
| Publicité jouée présentée comme témoignage = déloyal | Aucun acteur ne joue un « client » ; pas de faux comptes ; pas de contenu généré par IA présenté comme client réel |
| Contrepartie (argent, produit, avantage) = à divulguer | Étiquette de partenariat de la plateforme + mention dans la légende/la vidéo, au début, en langue du public (#Werbung / #Anzeige / #pub / #ad) ; pas de remerciement vague |
| Avis vérifiés | Ne publier que des avis d'acheteurs vérifiés ; ne pas supprimer ni masquer les avis négatifs ; afficher la note et le nombre réels (Judge.me 410 / ≈ 4,66), ou expliquer le mélange de sources |
| Exactitude des promesses | Délais, stock, nombre de références, frais de port vérifiables (bm_03 A4, A6) |
| Droit à l'image, musique, droits d'auteur | Contrat écrit avec licence (durée, médias, territoire, whitelisting), consentement du client pour l'usage commercial, musique libre de droits (à faire valider par un juriste) |

---

## 3. Dispositif de contenu

### 3.1 Quatre sources distinctes (jamais confondues)

| Source | Description | Atouts | Limites | Mesure |
|---|---|---|---|---|
| **Clients vérifiés** | Photos/vidéos de clients ayant reçu leur commande, invités à J+7 après **livraison confirmée**, même message pour tous, consentement écrit à la réutilisation | Authentique ; coût faible | Volume faible (3 560 commandes/an, base de réponse inconnue) ; biais d'auto-sélection ; ne pas lier la note à une récompense | Taux de réponse ; part exploitable |
| **Créateurs rémunérés** | Créateurs payés pour produire un contenu (UGC « commandé ») ; contrat de droits ; marquage publicitaire | Volume et qualité maîtrisés | Coût ; ce n'est **pas** un avis de client ; ne pas le présenter comme tel | Contribution par commande ; taux de rétention vidéo |
| **Partenariats / produits offerts** | Échange produit contre publication par un créateur à son compte | Coût marginal ≈ coût d'achat du produit (≈ 150,8 CHF par paire en moyenne, fin_00) | Contrepartie → divulgation obligatoire ; contrôle limité | Idem |
| **Interne** | Contenu produit par l'équipe : préparation des colis, vérification, tailles, délais réels, FAQ | Aucun problème de droits ; fidèle à la réalité | Temps de travail ; qualité variable | Temps passé ; conversion des pages |

### 3.2 Hypothèses créatives (à tester ; aucune n'est une promesse de résultat)

Elles reposent sur la promesse défendable identifiée en bm_02 (**choix + disponibilité en Suisse, livré de façon fiable**) et sur les données internes : paniers 150–300 CHF (57 % du CA), atterrissages DE 32,9 % / FR 27,7 % / EN 16,3 %, 88,5 % de premières commandes.

| # | Hypothèse | Contenu | Condition préalable | Mesure |
|---|---|---|---|---|
| H1 | « Ce que je reçois est conforme à ce que j'ai commandé » réduit l'incertitude d'achat | Déballage d'une vraie commande de client vérifié, avec numéro d'article ; **sans** prétendre à une authentification non auditée | Politique d'authentification décrite réellement (non vérifiée ici) | Conversion fiche produit ; taux de retour |
| H2 | Un délai **réel** annoncé avant l'achat réduit les litiges « produit non reçu » (9,6 k CHF perdus) | Vidéo/infographie « de la commande à la livraison » avec délais médians réels | Délai médian publié = délai constaté (9–14 jours aujourd'hui, fin_00) | Litiges ; avis ≤ 3★ ; conversion |
| H3 | Aide au choix de taille (taille sneakers ≠ taille réelle) réduit les échanges | Courtes vidéos « taille » par marque (Nike, adidas, ASICS…) avec données de retours | Données de retours par taille (non extraites) | Taux d'échange |
| H4 | Contenu centré sur la sélection stock propre (Essentials) démarque l'offre | Photos produit en main, vidéos de coupe | Coût de stock prouvé par facture (fin_00 : 211 lignes à coût 0) | Contribution réelle par unité |
| H5 | Contenu DE natif (pas une traduction) améliore la conversion DE (32,9 % des atterrissages) | Voix-off et sous-titres en suisse-allemand/allemand standard ; titres propres (cf. bm_03 A8) | Pages DE corrigées (bm_03 A7, A8) | Conversion DE vs FR |

### 3.3 Sélection des créateurs (méthode)

1. **Critères d'éligibilité** : audience suisse (FR/DE) ou DACH ; pertinence sneakers/streetwear ; historique de marquage publicitaire correct ; aucun faux avis ou abonnés achetés visibles ; langue native ; pas d'exclusivité concurrente.
2. **Vérification (sans contact tiers dans ce mandat)** : l'entrepreneur examine 10–15 profils : ratio vues/abonnés sur les 12 derniers contenus, commentaires réels, marquage des collaborations précédentes, cohérence avec la promesse.
3. **Test d'abord** : 3 créateurs × 1–2 vidéos avant tout engagement récurrent ; brief écrit (message, contraintes légales, mentions obligatoires) ; relecture avant publication ; **droits d'usage écrits** (durée, plateformes, whitelisting, territoire).
4. **Rémunération** : forfait par contenu + droits ; pas de rémunération à la note ou au volume d'avis ; pas de script qui présente la collaboration comme un avis spontané.
5. **Biais à contrôler** : survivants (créateurs ayant fait des « succès » vs échecs) ; mesurer la contribution par commande, pas les vues.

### 3.4 Coûts, droits, langues, réutilisation, fréquence

Script : `calculs/bm_ugc_01_cout.py` → `tableaux/bm_ugc_cout_lancement.csv`. **Tarifs = affirmations de prestataires [P], non des devis.**

| Source de tarif [P] | Affirmation (consultée 2026-11-02) |
|---|---|
| Tulip Films (CH) | « Specialized creators in Switzerland typically charge between 300 CHF and 500 CHF per video, with brands securing full usage rights for unlimited digital reuse » — https://www.tulipfilms.ch/en/post/audiovisual-switzerland-trends-and-services-for-2026 |
| Biggie (CH) | UGC payant ≈ CHF 300–500/vidéo avec pleins droits ; micro-influenceurs (10–100 k) CHF 1 000–3 000 par post — https://ch.biggie.co/en-articles/trends-2026-influencer-marketing-and-ugc-in-switzerland |
| Aumovo (UE) | Vidéo de base 80–150 EUR (débutant), 200–400 EUR (expérimenté) ; droits pour publicité payante +50–150 EUR par vidéo ; whitelisting 100–300 EUR/mois ; « the add-ons are where the bill grows » — https://www.aumovo.com/blog/how-much-do-ugc-creators-charge |
| Flintery (DACH) | Base 200–500 EUR (créateur intermédiaire, usage organique) ; droits pub DACH +20–30 %, UE +30–50 % ; rachat des droits +100–150 % — https://flintery.com/en/blog/ugc-creator-pricing-2026 |
| Insense (US) | 50–400 USD (débutant), 150–1 000 (intermédiaire) ; création interne = frais créateurs + 7 000–10 000+ USD/mois de temps de personnel selon l'article — https://insense.pro/blog/ugc-creator-rates |

**Lecture** : ces sources sont des fournisseurs de prestations ; elles tendent à présenter des tarifs bas. Les montants additionnels (droits, variantes, retouches, whitelisting) font monter la facture réelle. Fréquence nécessaire pour un test publicitaire sérieux : l'une des sources évoque 8–12 variantes par mois (≈ 3–5 k EUR/mois de frais de créateurs) — c'est une **fourchette de prestataire**, pas une norme.

**Scénarios de coût (hypothèses, par lancement complet)** :

| Poste | Bas | Médian | Haut |
|---|---|---|---|
| Vidéos de créateurs (nombre × tarif [P]) | 4 × 300 | 8 × 400 | 12 × 500 |
| Droits pub DACH (+20/25/30 %) | inclus ci-dessous | inclus | inclus |
| **Créateurs + droits** | **1 440 CHF** | **4 000 CHF** | **7 800 CHF** |
| Produits offerts (0/3/5 paires × coût d'achat moyen 150,8 CHF [I]) | 0 | 452 | 754 |
| Temps de travail (35/60/90 h × 40 CHF/h [H]) | 1 400 | 2 400 | 3 600 |
| **Total hors média** | **2 840** | **6 852** | **12 154** |
| Média de test (H) | 1 500 | 3 000 | 5 000 |
| **Total lancement** | **4 340** | **9 852** | **17 154** |
| Commandes nécessaires pour amortir le total hors média, à 40,3 CHF de contribution avant pub | ≈ 71 | ≈ 170 | ≈ 301 |

**Interprétation** : le seul coût hors média du scénario médian (≈ 6,9 k CHF) correspond à ≈ 238 commandes à contribution moyenne **sans** aucun frais de média, soit près de 3 mois de volume actuel (283–348 commandes/mois). Un contenu ne s'amortit que s'il est réutilisé largement (site, e-mails, réseaux, publicités) et s'il améliore effectivement la conversion ou le CPA. **Confiance** : faible (tarifs [P], temps et média [H]).

**Langues et réutilisation** :
- Priorité DE et FR (32,9 % + 27,7 % des atterrissages) ; EN en sous-titres. Un même contenu : fiche produit, e-mail post-achat, réseaux organiques, publicité (si droits payants), sans contenu spécifique par pays UE avant le pilote (bm_05).
- Fréquence : 1 lot de 4–8 vidéos pour valider ; pas de calendrier de publication continu avant preuve.

### 3.5 Déclinaisons par canal

| Canal | Usage | Exigence |
|---|---|---|
| Site | Fiches produit/collections, page « Avis » (clients vérifiés uniquement) | Note et nombre réels ; mention de la source |
| E-mail | Post-achat (J+7 après livraison), relance panier | Consentement, désinscription (UWG art. 3 al. 1 let. o) |
| Réseaux sociaux organiques | Contenu interne et clients ; créateurs avec marquage | Marquage au début, étiquette de plateforme |
| Publicité (Meta, TikTok, Google) | Contenu créateur avec droits payants ; whitelisting si négocié | Droits écrits ; conditions du §6 |

---

## 4. Plan de tests créatifs et mesure de la contribution

**Principe** : on mesure la **contribution par commande après média** (40,3 CHF avant pub, ROAS d'équilibre 5,4), pas les vues ni les clics.

| Test | Variante A | Variante B | Mesure | Taille minimale (H) | Décision |
|---|---|---|---|---|---|
| T1 fiche produit | page actuelle | page avec délai réel + clients vérifiés (H1, H2) | conversion, remboursements, litiges | ≥ 200 sessions mobiles par variante et ≥ 30 commandes sur 4 semaines (hors Black Friday) | Garder B si conversion ↑ sans hausse des remboursements |
| T2 langue | titres/contenus traduits | contenus natifs DE (H5) | conversion DE | idem | Étendre si ↑ |
| T3 créateur | 3 créateurs × 1–2 vidéos | — | contribution par commande (code ou lien propre) | ≥ 15 commandes par créateur ou arrêt | Poursuivre le créateur si CPA < 28 CHF |
| T4 média | meilleur contenu T3 | 2 variantes d'accroche | ROAS (≥ 5,4, viser ≥ 6,5) | ≥ 50 commandes cumulées avant de conclure | Étape 3 si ROAS ≥ 5,4 (cible 6,5) sur ≥ 3 semaines |

**Limites de mesure** : attribution non auditée (« Google non étiqueté SEO » ≈ 45,4 % des premières visites), GA4 inaccessible pour moi ; Black Friday/Noël fausseront les comparaisons ; les seuils ci-dessus sont des **hypothèses** de prudence, pas des tests statistiques conçus.

---

## 5. Lancement par étapes

| Étape | Contenu | Durée | Coût (voir §3.4) | Critère de passage | Critère d'arrêt |
|---|---|---|---|---|---|
| **0. Preuve de promesse** | Corriger promesses (bm_03 A1/A4/A6), affichage des avis (cx_03) ; mesurer délai réel ; collecte honnête d'avis (cx_03 §reco 5) | 2–4 semaines | ≈ 0 + 10–15 h de temps | Délai affiché = délai médian constaté ; avis cohérents | Impossible de tenir un délai crédible |
| **1. Validation offre + contenus** | Contenus clients vérifiés + internes ; 4–8 vidéos de créateurs ; tests T1/T2 | 4–6 semaines | bas : ≈ 2,8 k CHF ; médian : ≈ 6,9 k CHF (hors média) | Conversion ↑ ou litiges ↓ mesurés ; droits et mentions en ordre | Aucune amélioration mesurable après 4 semaines |
| **2. Test d'acquisition** | Média Meta/TikTok limité (T4) avec les meilleurs contenus | 4 semaines | média 1,5–5 k CHF **[H]** | ROAS ≥ 5,4 (cible 6,5) et CPA < 35 CHF sur ≥ 50 commandes | ROAS < 4 après 2 semaines **ou** budget épuisé |
| **3. Augmentation contrôlée** | Hausse du budget de ≤ 20 % par semaine tant que ROAS ≥ 5,4 et délai tenu | continu | proportionnel | Contribution après média ≥ 0 sur 4 semaines glissantes | Deux semaines consécutives sous le ROAS d'équilibre |

**Coût total y compris travail** : voir tableau §3.4 (≈ 4,3 / 9,9 / 17,2 k CHF). **Condition d'engagement** : le résultat avant rémunération est d'environ +11,9 k CHF sur 10 mois (non démontré, fourchette ≈ 0 à +12 k ; fin_00) ; chaque franc de ce budget est financé par l'exploitation, du capital propre ou l'activité Galaxus (hors périmètre) — **à décider par l'entrepreneur**.

---

## 6. Conditions pour ouvrir ou augmenter Meta (ou un autre canal)

Toutes à satisfaire ; aucune n'est remplie aujourd'hui.

| # | Condition | Seuil proposé (H) | État actuel |
|---|---|---|---|
| G1 | Économie de base | Contribution après acquisition ≥ 0 sur 8 semaines **sur cohortes mûres**, ou ROAS ≥ 5,4 | +5,3 CHF/commande en moyenne 10 mois ; ROAS ≈ 6,2 ; fragile (6 % de coût estimé, remboursements récents sous-estimés) : **atteinte en moyenne, non démontrée** |
| G2 | Promesses exactes | Délais, frais de port, nombre de références, avis alignés sur la réalité (bm_03 A1, A4, A6 ; cx_03) | Non (4,9/589 vs 4,66/410 ; « 48 h » vs 9–14 jours ; « 20 000 » vs 98 521) |
| G3 | Exécution | ≥ 60 % des commandes expédiées sous 7 jours **ou** délai affiché honnête avec litiges « non reçu » en baisse | 4–29 % sous 7 jours (fin_00 : 71–96 % au-delà) |
| G4 | Contenus validés | ≥ 3 contenus ayant amélioré conversion/contribution en test organique/page | Aucun test |
| G5 | Mesure | Suivi des conversions côté serveur et consentement conformes ; mode d'attribution défini ; compte de test séparé | Non vérifié (GA4/Meta inaccessibles) |
| G6 | Cadre légal | Contrat de droits, marquage, avis vérifiés ; règles de la plateforme (Meta : règles de publicité et de commerce non lues ici) | Non |
| G7 | Plafond de perte | Budget d'étape écrit avec arrêt automatique | Non défini |
| G8 | Capacité | Stock/délais compatibles avec la demande générée ; pas de promotion d'articles à achat à la demande sans délai honnête | Non |

**Réserve** : taille de l'audience propre (3,5 k commandes/an) trop faible pour des audiences similaires solides **[H]** : le ciblage reposerait surtout sur le ciblage large, donc sur la qualité du contenu et de l'offre.

---

## 7. Recommandation

| | |
|---|---|
| **Fait observé** | ROAS observé 6,2 > ROAS d'équilibre 5,4 en moyenne (marge mince) ; contribution après acquisition +5,3 CHF/commande ; note et nombre d'avis affichés incohérents avec Judge.me ; délais réels très au-dessus de la promesse ; cas du benchmark où le contenu n'a pas produit de marge (The Sneaker Store) |
| **Interprétation** | Le contenu amplifierait l'état actuel : si l'offre et les promesses ne sont pas corrigées, il accroît le coût et le risque de pratique trompeuse |
| **Hypothèse** | Contenu réel + délai réel + avis vérifiés améliore conversion et réduit les litiges ; un CPA < 28 CHF reste à démontrer |
| **Recommandation** (mécanisme : réduire le coût par commande et le taux de litiges avant d'acheter du trafic) | Étape 0 immédiate (promesses, avis, délais) ; étape 1 avec un petit lot ; étape 2 seulement si G1–G8 ; plafond de budget par étape |
| **Confiance** | Moyenne sur les seuils économiques ; faible sur les coûts de créateurs (provient de prestataires) et sur l'effet réel du contenu |

---

## 8. Limites et données manquantes

- **Tarifs des créateurs** : uniquement des affirmations de prestataires **[P]** (agences/blogs), aucun devis ; pas de données de créateurs suisses spécifiques au secteur sneakers.
- **Base juridique** : extraits d'actes officiels (UWG, directives) et de la SLK (principes, non contraignants comme loi) ; doctrine secondaire ; applicabilité du droit de l'UE à une boutique suisse non tranchée ; aucune jurisprudence suisse spécifique aux influenceurs trouvée (selon digitalvantage.ch). Droit à l'image, droits d'auteur et protection des données (consentement) non analysés en détail.
- **Plateformes** : règles de Meta/TikTok pour la publicité et les contenus de partenariat **non lues** ; pixel/CAPI, consentement et attribution **non vérifiés** (accès aux comptes non autorisé ; GA4 inaccessible).
- **Données internes manquantes** : taux de réponse aux invitations d'avis ; nombre de contenus clients disponibles ; conversion par page ; retours par taille ; part des commandes issues de Meta (aucune donnée) ; coût réel de production interne ; coût du temps de l'entrepreneur (40 CHF/h = hypothèse dérivée de fin_00).
- **Hypothèses** : seuils des tests (taille minimale), budget média, durée des étapes — arbitraires et à ajuster ; ne remplacent pas un plan statistique.
- **Contribution** : base fin_00 avec coûts partiellement estimés (≈ 38 k CHF de coût estimé, 6 % du net ; 211 lignes de stock propre à coût 0) ; le ROAS d'équilibre est donc approximatif.
- **Benchmark** : The Sneaker Store : date de l'article non retrouvée ; aucun cas audité d'un revendeur dont la croissance serait prouvée par le contenu (biais du survivant).
- **À fournir** : accès en lecture aux données publicitaires Meta/TikTok s'il en existe ; export Judge.me ; politique d'authentification réelle ; budget maximum que l'entrepreneur accepte de perdre ; décision sur le canal de financement du lancement.
