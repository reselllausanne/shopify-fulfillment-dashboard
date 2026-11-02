# Données réellement manquantes — regroupées (S3.5)

Classées par décision bloquée. Pour chacune : ce qui est attendu, où le trouver, la meilleure approximation utilisée, l'effet sur le résultat. Dernière mise à jour : 2026-11-02 soir (Europe/Zurich).

**Accès essayés** : aucun export ni connexion UBS/cartes sur le poste, le VPS ou la base ; `BankTransaction` et `BankBalanceSnapshot` vides ; aucune session bancaire ouverte dans le navigateur ; l'application sait seulement importer des fichiers camt/CSV (`app/lib/bank/import.ts`). Je ne me connecte pas à une banque (authentification forte, mots de passe) ni ne contourne un accès. Les données bancaires doivent être exportées par le dirigeant.

| # | Donnée attendue | Décision bloquée | Source à fournir | Approximation actuelle | Effet |
|---|---|---|---|---|---|
| 1 | Relevés UBS, cartes (Mastercard, Amex), PayPal, TWINT, PowerPay, Cembra : 24 mois (camt.053 ou CSV) | cash libre, trésorerie d'ouverture, rémunération réelle, besoin de financement | Export e-banking ; import possible via `/api/bank/imports` après validation | Ouverture = 0 ; rémunération 6 000/mois (H) | Besoin de financement non démontrable |
| 2 | Décomptes TVA TDFN 2,1 % (AFC) et paiements | marge nette, risque fiscal | Décomptes semestriels 2025-2026 | 2,1 % du CA TTC conservé (D) | ± 33 k CHF vs 8,1 % |
| 3 | Convention NER (10 % de marge, CA redirigé à un tiers), reversements, traitement TVA | contribution Galaxus, risque fiscal/mélange | Contrat/échanges, relevés | 10 % × 196,3 k = 19,6 k (D) | ± 20 k CHF |
| 4 | Délais de paiement Galaxus, avoirs, pénalités, retours Galaxus | cash généré par Galaxus | Décomptes Galaxus, relevés, retours | Contribution plancher ≈ 13 k/mois | Cash libre non calculable |
| 5 | Coût réel d'achat de 206 lignes Shopify 2026 sans `OrderMatch` (53,7 k CHF TTC ; 111 expédiées) | marge réelle | Origine : soldes/retours, stock propre, autre fournisseur ; factures | 70 % du prix (H) = 57,9 k CHF estimés | ± 11-23 k CHF |
| 6 | Coûts unitaires du stock propre (Essentials 42/26, Bape 35, AP 40, boxer 20) | marge du stock, pilote stock | Factures d'achat | Valeurs du code, déclarées | 211 lignes à coût 0 : −7,6 k |
| 7 | Suivi unitaire des soldes (retours revendus à −30 % du buy now) | coût des soldes, double comptage | Registre retours + reventes (`LocalStockLot` n'a que 36 lots) | 70 % de récupération (H) | ± quelques k CHF |
| 8 | Factures Poste et coûts de préparation réels | contribution par commande | Factures Poste CH, temps de préparation | 6,5 + 8,0 CHF/commande (forfaits) | ± 12-15 k CHF |
| 9 | Frais TWINT/PayPal/PowerPay/Cembra (contrats) | frais de paiement | Contrats / relevés | 1,3 % / 3,4 % + 0,55 / 3,0 % / 3,0 % (H) | ± 3 k CHF |
| 10 | Charges fixes : loyer, assurance, comptabilité, abonnements, salaires éventuels | seuil de rentabilité | Relevés | Logiciels 325/mois | Résultat surestimé |
| 11 | Boîte SAV/Gmail (90 jours), état réel des 97 commandes bloquées | SAV, litiges | Export Gmail | cx_02 (API seulement) | Taille du SAV inconnue |
| 12 | Search Console 16 mois, GA4, redirections Shopify, Simprosys (consentement/valeur) | SEO, mesure, domaine | Accès dirigeant | Ahrefs Lite (estimation) | Valeur SEO incertaine |
| 13 | Export Judge.me daté, segment e-mail 2025, valeur du flag `STOCKX_CUSTOMER_DELAY_MAIL` en production | e-mails, avis | Dirigeant/VPS | cx_03, cx_04 | Moyen |
| 14 | Factures Google Ads (TVA incluse ou non), jointure gclid↔commande | ROAS réel | Google Ads | DailyAdSpend vs API (écarts mineurs) | ± 5 % pub |
| 15 | Avis fiscaliste/transitaire (droit de douane DE 16,9 %, preuves e-dec), conseil marque (Swissreg/TMview/WIPO/Zefix), juriste (rétractation UE, structure) | Europe, nom, structure | Professionnels | Sources web partielles | Décisions bloquées |
| 16 | Raison individuelle inscrite au registre du commerce (CA > 100 k CHF) ? | éligibilité Cautionnement romand | Zefix | Non vérifié | Financement |
| 17 | Perte maximale de test acceptée, rémunération cible, horizon | tous les étages d'investissement | Dirigeant | Hypothèses | Plafonds indicatifs |
| 18 | Origine des colis StockX Express (UE/Suisse), documents de douane | marge d'import | Documents StockX/Poste | Coût StockX = enchère + ≈ 28 CHF | Marge import |
