# Brief pour l'agent : emailing automatique parfait (Resell Lausanne)

Mandat : construire, tester et mettre en service (après feu vert écrit) le système complet d'e-mails automatiques de Resell Lausanne : transactionnels, après-achat, réachat, paniers, retours/avoirs, relances. Objectif chiffré : **réduire les annulations et litiges, relever le réachat de 5 % à ≥ 10 % à 90 jours, gagner ≈ +2 à 3 k/mois sans publicité** (hypothèse à vérifier par groupe témoin). Langue du brief : français. Code, commits, e-mails : selon la langue du client.

## 0. Règles non négociables
1. **Aucun envoi réel sans feu vert écrit du dirigeant.** Tout se construit en brouillon, aperçu, envoi de test à une adresse interne.
2. **Consentement** : marketing uniquement aux profils abonnés (1 016). Les 7 163 profils « jamais abonnés » ne reçoivent que du transactionnel. Jamais de consentement écrit par le code. Lien de désinscription partout (LCD art. 3 al. 1 let. o).
3. **Exclusions SAV** : ne jamais envoyer de marketing à un client avec incident ouvert (commande payée non expédiée, litige, remboursement en cours, étiquette `MARKETING/BLOQUE_SAV`). Le code `bfcm/holds.ts` définit déjà `rl_marketing_hold` ; le réutiliser.
4. **Pas de remise automatique par défaut** : les commandes avec code ont une contribution de 15,7 à 19,9 CHF contre 34,7 CHF sans code (`tableaux/cx_04_codes_reduction.csv`). Toute remise = test A/B avec témoin, jamais flux permanent.
5. **Promesses vraies** : délais affichés = délais mesurés (médiane 10 j.o. Express, 13 j.o. Standard ; P90 13 et 19 j.o., `tableaux/cx_02_delais_reels.csv`). Pas de « 24-48 h » ni d'avis « vérifiés » mal étiquetés.
6. Production en lecture seule hors périmètre emailing. Pas de modification des prix, du flux Google, des commandes.
7. Secrets : jamais dans le dépôt ni dans les sorties (jetons Klaviyo, Postmark).

## 1. Ce que disent les données (à relire avant de concevoir)
| Fait | Chiffre | Source |
|---|---|---|
| Flows Klaviyo actifs | 1 seul : panier abandonné (+3 h, +48 h) ; bienvenue, post-achat, suivi = brouillons vides ; 0 campagne en 2026 | `analyses/cx_04` §0, §2 |
| Base utilisable | 1 016 abonnés réels (12,4 % de 8 192 profils) | `cx_04` §0 |
| Langue des e-mails clients | 75 % en anglais (1 002 « Order update » contre 333 « Suivi commande ») ; sessions qui finalisent : 41 % DE, 40 % FR, 14 % EN ; **aucune version allemande** | `cx_02` §0 |
| Première cause de remboursement | annulations avant expédition : 22,8 k (40 % de 57,8 k) ; retards et achats StockX impossibles | `cx_02`, `cx_02_remboursements_buckets.csv` |
| Promesse vs réalité | Express 2-5 j.o. promis, 4,2 % tenus ; Standard 5-10 j.o. promis, 24,8 % tenus | `cx_02_promesse_vs_reel.csv` |
| Litiges | 10 « crédit non traité » en 12 mois, « produit non reçu », « frauduleux » | `cx_03_litiges_motifs.csv` |
| Retours | 84 % de la valeur retournée est remboursée en **crédit magasin** (13,1 k sur 15,6 k) : argent déjà dans la maison, à faire dépenser | `cx_02_remboursements_par_moyen.csv` |
| Réachat | 3,2 % à 30 j., 5,0 % à 90 j., 9,6 % à 12 mois (cohorte 2025) ; médiane 51 j. entre 1ʳᵉ et 2ᵉ commande ; commande récurrente 62 CHF de contribution contre 40 | `tableaux/cx_04_reachat_taux.csv`, `fin_07_seg_nouveau_vs_recurrent.csv` |
| Rendement e-mail passé | campagne BFCM 2025 : 3 521 envois, 4,9 % de clics, 1,79 % de désabonnements, 3 commandes ; panier abandonné : 31 commandes en 12 mois | `cx_04` §0 |
| Avis | page « 4,9 ★ 589+ avis vérifiés » = total mixte saisi à la main ; Judge.me seul : 410 avis, note ≈ 4,66 | `cx_03` §0 |
| Délivrabilité | SPF racine = `secureserver.net` seul ; DMARC `p=none` ; fuseau Klaviyo US/Eastern | `cx_04` §0, §3.4 |

**Trou de données à combler par l'agent (priorité 1)** : je n'ai **pas** pu lire les e-mails SAV réels (aucune boîte Gmail accessible). Demander au dirigeant un export (Google Takeout ou accès lecture à l'étiquette SAV), puis extraire : 20 motifs de contact les plus fréquents, formulations des clients, délais de réponse, phrases qui calment ou énervent. Ces motifs fixent le contenu des e-mails de retard, retour et avoir.

## 2. Architecture
- **Transactionnel (Postmark)** : confirmation, suivi, retard, expédition, livraison, annulation/remboursement. Doit être corrigé **en premier** : c'est lui qui réduit les annulations, les litiges et les appels. Langue du client = langue de la session/du pays de livraison/de la page d'atterrissage (DE, FR, EN), et non le domaine d'e-mail.
- **Lifecycle (Klaviyo)** : bienvenue, après-livraison, réachat, avoir non utilisé, panier, navigation, reconquête.
- **Données** : Shopify (commandes, clients, retours, avoirs), base (`OrderMatch`, statuts de sourcing), Klaviyo (profils, consentement), Postmark (événements). Un seul événement « commande à risque » (âge de la commande non expédiée) calculé par une tâche planifiée.

## 3. Flows, dans l'ordre de priorité
| # | Flow | Déclencheur et rythme | Contenu clé | Mesure |
|---|---|---|---|---|
| 1 | **Confirmation honnête** (Postmark) | à la commande | délai réel affiché (10-13 j.o. Standard, 7-10 Express), « nous achetons votre paire après commande », lien de suivi, contact | annulations avant expédition, tickets « où est ma commande » |
| 2 | **Alerte retard proactive** (Postmark) | commande non expédiée à J+8 j.o., puis J+12, puis J+15 avec choix : attendre / remboursement | nouveau délai estimé, option remboursement en un clic, pas de silence | annulations, litiges « produit non reçu » |
| 3 | **Expédition et livraison** (Postmark) | scan transporteur | suivi, taille, conseil retour, ce qu'il faut faire en cas de problème | contacts SAV |
| 4 | **Retour reçu / avoir émis** (Postmark) | retour reçu, avoir créé, remboursement envoyé | montant, délai, utilisation de l'avoir ; réduit les litiges « crédit non traité » (10 en 12 mois) | litiges |
| 5 | **Après livraison** (Klaviyo) | J+3 : « tout va bien ? taille/qualité ? » (problème → SAV, jamais d'avis) ; J+7 si pas de problème : demande d'avis Judge.me | formulaire court, réponse humaine sous 24 h | taux d'avis, litiges évités |
| 6 | **Avoir non utilisé** (Klaviyo) | J+7, J+21, J+45 après l'avoir | solde, 3 produits dans sa marque/taille, date limite si applicable | utilisation de l'avoir (13,1 k en crédits) |
| 7 | **Réachat** (Klaviyo) | J+30, J+51, J+75 sans nouvelle commande | arrivées dans sa marque et sa taille (marque et pointure de la dernière commande), sans remise | réachat à 90 j. (cible ≥ 10 %), contribution par e-mail |
| 8 | **Panier abandonné** (Klaviyo, existant) | +1 h, +24 h, +72 h | rappel + délai réel + support ; pas de code automatique | commandes attribuées, avec groupe témoin 10 % |
| 9 | **Alerte taille / retour en stock** (Klaviyo) | variante épuisée puis disponible | pointure demandée | commandes attribuées |
| 10 | **Bienvenue** (Klaviyo, 1 016 abonnés + nouveaux) | J0, J+3, J+7 | positionnement, délai honnête, avis réels (Judge.me 410 avis, note affichée réelle) | clics, première commande |
| 11 | **Reconquête** (Klaviyo) | 120 et 180 j. sans commande, consentement requis | nouveautés, aucun code | réactivation, désabonnement < 1 % |
| 12 | **Campagnes** (Klaviyo) | calendrier BFCM déjà dans `bfcm/` (sélection 05.11, VIP 26.11, public 27.11) | abonnés uniquement ; exclure incidents ; DE/FR | contribution par envoi |

Règles de contenu : une idée par e-mail, objet < 45 caractères, pas de majuscules criardes, aucune fausse urgence, ton direct, vouvoiement FR/DE, aperçu mobile vérifié (≥ 60 % de mobile, à vérifier).

## 4. Étapes, livrables, critères d'acceptation
| Étape | Livrable | Critère |
|---|---|---|
| A. Audit des données | export SAV analysé ; carte des événements Postmark/Klaviyo ; liste des champs de langue | motifs SAV chiffrés ; taux de profils avec langue connue |
| B. Conformité et délivrabilité | SPF/DKIM/DMARC corrects pour `resell-lausanne.ch` ; fuseau Europe/Zurich ; segmentation « abonnés uniquement » vérifiée ; exclusions SAV branchées | tests de livraison Gmail/Outlook ; 0 envoi marketing à un profil non abonné |
| C. Transactionnel | modèles DE/FR/EN pour flows 1-4 ; événement « commande à risque » ; envoi de test | langue correcte à 100 % sur un échantillon de 30 commandes ; délais affichés = délais mesurés |
| D. Lifecycle | flows 5-11 en brouillon, aperçu par langue et appareil | revue ligne par ligne par le dirigeant |
| E. Mesure | groupe témoin 10 % ; tableau hebdomadaire : envois, ouvertures, clics, commandes, contribution, désabonnements, litiges | tableau reproductible, calcul documenté |
| F. Mise en service | activation flow par flow (1-4 d'abord), 7 jours entre chaque ; retour arrière documenté | aucune plainte, désabonnement < 1 %, plaintes spam < 0,1 % |

## 5. À demander au dirigeant avant de commencer
1. Export ou accès lecture à la boîte SAV (étiquettes clients).
2. Accès DNS du domaine `resell-lausanne.ch` (corriger SPF/DKIM/DMARC) ou intervention de la personne qui le gère.
3. Permission d'écriture Klaviyo/Postmark limitée aux modèles et flows (pas d'envoi).
4. Décision : aucune remise automatique (recommandé) ou test A/B plafonné.
5. Nom et adresse de réponse (une vraie personne, délai de réponse ≤ 24 h).
6. Décision sur les 7 163 profils « jamais abonnés » : ne pas les utiliser en marketing (recommandé) ou campagne de re-consentement avec double opt-in.

## 6. Résultats attendus (ordre de grandeur, hypothèses)
- Flows 1-4 : moins d'annulations (22,8 k remboursés en 10 mois : 20 % de moins ≈ 4,5 k de ventes conservées ≈ +2 k de marge) et moins de litiges.
- Flows 6-7 : réachat de 5 % à 10 % à 90 j. sur ≈ 255 nouveaux clients par mois ≈ +13 commandes/mois × 62 CHF ≈ +0,8 k/mois ; avoirs dépensés : jusqu'à 13 k de ventes à marge normale sans publicité.
- Cible pour tout le système : ≈ +2 à 3 k/mois de contribution après 3 mois. Inférieur au rendement e-mail de 2025 (3 commandes sur 3 521 envois) : **le gain vient de la qualité du service, pas du volume d'envois**.

## 7. Risques
Base consentie petite (1 016) ; réponse client insuffisante (le SAV doit suivre) ; données SAV absentes ; délais de livraison qui ne s'améliorent pas : aucun e-mail ne compense un colis en retard. Les flows 1-2 ne fonctionnent que si les dates d'expédition réelles sont fiables.
