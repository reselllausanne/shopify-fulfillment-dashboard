# Prix Resell vs benchmark Google Merchant (13.11)

Source (F) : Merchant API `price_competitiveness_product_view`, pays CH, 40 000 premières lignes (cap du script, ~12 265 produits), `calculs/ads_13_merchant_prix_concurrence.ts`. Benchmark = prix moyen des autres marchands pour le même produit selon Google. Photo du jour, pas d'historique.

- Prix médian Resell / benchmark = 1,49 (p25 1,24 ; p75 1,79).
- 91 % des lignes à plus de +10 % du benchmark ; 2 % sous −5 %.
- Par tranche de prix (médiane) : 100–200 : 1,56 ; 200–300 : 1,50 ; 300–500 : 1,46 ; 500–1000 : 1,35 ; 1000+ : 1,26.
- Par marque : Nike 1,46 ; Jordan 1,36 ; Adidas 1,55 ; New Balance 1,55 ; Asics 1,49.
- Jordan 4 Retro Fear (2024) : notre prix 356–523 contre benchmark 250–293.
- I (coût estimé = 0,68 × prix − 14,5) : le benchmark est sous notre coût pour 39 % des lignes ; au prix benchmark, 12 % restent à ≥ 0 net avec CPA 44,7, 6 % à ≥ 20 net.
- Limites : échantillon tronqué non aléatoire ; benchmark peut inclure prix neufs retail ; pas d'évolution dans le temps.
