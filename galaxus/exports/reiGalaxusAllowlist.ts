/**
 * Reichelt (REI) Galaxus allowlist — locked snapshot (13 Oct 2026). Galaxus asked for a
 * fashion-focused feed, so the REI catalog is delisted except every REI item that sold at
 * least once on Galaxus, minus neon / LED tubes and bars (bulky) and the Ansmann AA battery
 * (wrong GTIN). Static on purpose: new REI sales do not auto-join.
 * Kill switch: GALAXUS_REI_ALLOWLIST=0 (full REI catalog again).
 */
const REI_GALAXUS_ALLOWED_GTINS = [
  "0092644583834", // KLEIN TOOLS Kabeltester für Sprach-, Daten- und Videodienste
  "0194644293192", // EUFY t comprenant 4 caméras, PoE","detected_source_language":"DE","ta
  "0658917500061", // UNITREE Contrôleur à distance Go2
  "0704256800864", // PIMORONI Raspberry Pi Shield – OnOff SHIM
  "0732388665006", // SOLDERED Raspberry Pi - T-Cobbler, câble inclus
  "0732388668403", // SOLDERED Cartes de développement - Écran, 0,96", écran OLED, SSD1306
  "0732388672004", // SOLDERED Cartes de développement - Breakout-Board pour cartes MicroSD
  "0790069368240", // D-LINK Commutateur, 8 ports, Gigabit Ethernet
  "0790069468568", // D-LINK Carte réseau, USB-A/C, 2,5 Gigabit Ethernet, 1 x RJ45
  "0791352938874", // FREI Arduino Shield - Protoshield mit Schraubklemmen, für Nano
  "0791352941560", // IDUINO Arduino - capteur de champ magnétique à effet Hall, A3141
  "0810152850282", // NVIDIA AI PC System, GB10 Grace Blackwell Superchip
  "0812674025278", // NVIDIA Kit NVIDIA Jetson Orin Nano Super Dev., 67 TOPS, 8 Go DDR5
  "0840006674900", // CORSAIR 32 Go (2 x 16 Go) de mémoire vive DDR5 6000 CL36 CORSAIR Venge
  "3272496012097", // KUBII Manette SNES USB noir
  "3800156693326", // OPTONICA Lampe solaire LED, piquet de terre, argent, IP44, détecteur d
  "3800170201699", // V-TAC LED-Einbaupanel, 6 W, 660 lm, 3000 K, Backlit
  "4002940022759", // HEITRONIC Plafonnier LED ALLROUNDER, 10-20 W, 1800 lm, 3000-5700 K, Ø2
  "4007754221978", // MONACOR MKT-Folienkondensator, 1,0 µF, 250 V
  "4008496745982", // VARTA VARTA Ready 2 Use, 4 x Mignon, 2 600 mAh
  "4010126005342", // FREI Vélo - Lampe frontale à LED, 70 lux, capteur inclus
  "4010126007872", // FREI Vélo - feu avant, LED, 30 lux, dynamo
  "4010126423030", // FREI Vélo - câble Bowden, universel, 180 cm
  "4011376706591", // BKL Fiche de haut-parleur DIN, avec protection contre le pliage
  "4012386138136", // MYWALL Gestionnaire de câbles, montage sous table, montage par pince, 
  "4012386150558", // MAXTRACK Adaptateur, HDMI mâle/femelle, circuit ouvert CEC
  "4012386150916", // MAXTRACK Câble HDMI High Speed avec Ethernet, 4K, 1,5 m
  "4012386151401", // MAXTRACK Câble HDMI Ultra High Speed, 1,5 m
  "4012386160656", // MAXTRACK Fiche USB C vers 2 ports USB C, 60 W.
  "4012386428305", // MAXTRACK Câble DisplayPort, DisplayPort 2,1, 4K 240 Hz, 3,0 M.
  "4012386440659", // MAXTRACK Câble de haut-parleur conducteur CCA, 2 x 2,5 mm², blanc, ann
  "4013674189748", // ANSMANN Projecteur de chantier à LED WL5000R, 2 x 30 W, 5000 lm, 3 400
  "4014296242170", // TOPSTAR Topstar Sitness® Half Ball stool, apple green
  "4014619018789", // GOOD CONNECTIONS Câble patch Cat. 6, S/FTP PiMF, 250 MHz, jaune, 3 M.
  "4014619018857", // GOOD CONNECTIONS Câble patch Cat. 6, S/FTP PiMF, 250 MHz, vert, 15 m
  "4014619042777", // GOOD CONNECTIONS Prise USB 2.0 A vers connecteur femelle A, 5 m
  "4014619548170", // GOOD CONNECTIONS Patchkabel Cat.6, S/FTP PiMF, 250 MHz, rot, 1,5 m
  "4014619603046", // GOOD CONNECTIONS Câble patch à fibre optique Simplex, OS2 SM, 9/125 µ,
  "4014619603688", // GOOD CONNECTIONS Câble patch Cat.6a, U/FTP PiMF, SlimLine, 0,15 m, bla
  "4014619738328", // GOOD CONNECTIONS Câble d'antenne prise F SmartFLEX, 10 m, blanc
  "4014619842728", // GOOD CONNECTIONS USB-Ladegerät, 5-20 V, 3,5 A, 110 W
  "4014619963324", // GOOD CONNECTIONS Câble patch - câble brut Cat.7, noir, 50m
  "4017538127488", // NONAME Câble de raccordement DisplayPort 5,0 m
  "4018412654762", // MÜLLER LICHT Éclairage d'orientation à LED Mizar Sensor, 2 lm, avec ca
  "4018412695918", // MÜLLER LICHT LED-Arbeitsleuchte IL2, 60 W
  "4018412696687", // MÜLLER LICHT Lampe porte-clés à batterie LED, batterie, intensité vari
  "4018412699091", // MÜLLER LICHT LED-Outdoor-Leuchte GLEN, dimmbar, CCT, Akku, IP44, beige
  "4019524100222", // PROCAR KFZ - Connecteur universel, 12/24V, 7,5A, coudé
  "4019524101090", // PROCAR KFZ - fiche standard sur prise allume-cigare, adaptateur
  "4021087038720", // MEAN WELL Transformateur LED, 480 W, 54 V c.c., 8,9 A, IP65
  "4021553163048", // BARTHELME Lampe à tube/I 16x35 BA15d 24V 5W.
  "4021553325279", // BARTHELME Lampe de prise téléphonique (4.6x22) 24V.
  "4021553335377", // BARTHELME Lampe de prise téléphonique (5.4x30) 30V.
  "4023125027840", // FRITZ! FRITZ!Box 7590 refurbished - braune Box - Dualband-Router - Mes
  "4026397226102", // OMNITRONIC Câble jack 6,3 mm, fiche / fiche, 1,5 m
  "4026423000737", // FEINTECH LED-Büro-Stehleuchte, weiß
  "4026423960550", // FEINTECH Lampe de bureau à LED, 7 W, avec support de fixation
  "4027236042303", // GREENLED Lampe LED, G9, 3,5 W, 350 lm, 2 700 K
  "4027236042525", // GREENLED Lampe LED GU10, 5 W, 450 lm, 3 000 K
  "4030462009392", // ATG KFZ - Scheiben/Glas, Smart Repair, mit UV Lampe, 19-teilig
  "4038816912480", // SYNERGY 21 Adaptateur de prise, G24 à E27, plastique, blanc
  "4040849124433", // GOOBAY Porte-pile fermé pour 2 piles Mignon AA, fermé
  "4040849151170", // GOOBAY Câble haut-parleur 2x2,5mm² , 10 m blanc CU
  "4040849232350", // GOOBAY Connecteur Tamiya avec câble 14 cm rouge/noir
  "4040849452994", // GOOBAY Chargeur USB, 5 V, 1 A, USB-C, blanc
  "4040849500176", // GOOBAY Câble spiralé prise jack 3,5 mm vers couplage jack, prise jack 
  "4040849516498", // GOOBAY Câble audio, prise jack 3,5 mm vers 2 prises RCA, 1,5 m
  "4040849539978", // MINWA Bloc d'alimentation secteur respectueux de l'environnement, maxi
  "4040849547935", // MINWA Bloc d'alimentation secteur respectueux de l'environnement, maxi
  "4040849670862", // GOOBAY DVB-T2 Zimmerantenne
  "4040849683473", // GOOBAY Câble réseau U/UTP Cat 5e 10 m, gris, RJ45
  "4040849756979", // GOOBAY Adapterkabel USB C > HDMI, 4K 60 Hz, 2,0 m
  "4040849766794", // GOOBAY Câble adaptateur, 3000 mm, 2,5 mm, DC mâle vers DC femelle, bla
  "4040849794261", // GOOBAY Boîtier vide 8 ports Keystone, blanc
  "4040849797552", // GOOBAY Support TV 32" - 75" ; 45 kg, distance du mur 2,7 cm, avec nive
  "4040849932298", // GOOBAY Câble USB 2.0, fiche A vers fiche mini B, 0,3 m
  "4040849937484", // GOOBAY Cat.6a High Quality-Patchkabel,violett,2 m
  "4042146288757", // KS TOOLS GMBH Double clé polygonale à cliquet, commutable, 4 en 1
  "4042774288310", // JAMARA Servo High End Micro analogique
  "4043619188284", // DELOCK Guide-câbles en silicone, 10 pièces de couleurs assorties
  "4043619189540", // DELOCK Collier de câble, inscriptible, 100 x 2,5 mm, blanc, 10 pièces
  "4043619195176", // DELOCK Colliers de serrage avec écrou à oreilles, 32 - 50 mm, 5 pièces
  "4043619601844", // DELOCK Serre-câble, autoadhésif, acier inoxydable, lot de 10
  "4043619604456", // DELOCK Boîtier d'installation IP65 étanche 200 x 150 x 100 mm gris
  "4043619604579", // DELOCK Manchon de protection de câble, 1 m x 13 mm, noir
  "4043619658336", // DELOCK Adaptateur D-SUB, 15 broches mâle > 2x 15 broches femelle
  "4043619668663", // DELOCK Erdungssatz für Netzwerkschrank, 30 cm
  "4043619671618", // DELOCK Adaptateur D-SUB, 37 broches mâle > 2x 37 broches femelle
  "4043619673094", // DELOCK Grille de ventilateur avec filtre à poussière, 40 x 40 mm, noir
  "4043619801800", // DELOCK Câble plat RJ45, Cat.8.1, 2 m, noir
  "4043619801954", // DELOCK RJ50 Verlängerungskabel Stecker / Buchse, S/FTP, 3 m, schwarz
  "4043619803057", // DELOCK Câble Cat.6a, S/FTP, coudé en bas / droit, 1 m
  "4043619826636", // DELOCK Câble HDMI haute vitesse avec Ethernet A/d plug / plug 3 M.
  "4043619831173", // DELOCK USB>6 extrémités de câble libres TTL série 1,8 m (3,3 V)
  "4043619838363", // DELOCK Câble SATA FLEXI 6 Gbit/s 70 cm rouge avec clips métalliques
  "4043619849611", // DELOCK Répartiteur TOSLINK 1 entrée 2 sorties, S/PDIF
  "4043619854097", // DELOCK Câble de synchronisation et de charge, USB-C, 100 W, indicateur
  "4043619864645", // DELOCK LED rouge Keystone 6 V, plate, noir
  "4043619866168", // DELOCK Câble modem nul, RS-232, fiche/prise avec écrous, 2 M.
  "4043619870691", // DELOCK Câble DisplayPort 1.4, 8K à 60 Hz, coudé vers la droite à 90°, 
  "4043619871094", // DELOCK Rallonge réseau, Easy 45, S/FTP, Cat.6a, 0,25 m, noir
  "4043619881475", // DELOCK Adaptateur RJ45 encastrable, Cat.6a, 25 cm, noir
  "4043619881871", // DELOCK Cat.5e RJ45 femelle à encastrer, avec fouet de câble mâle
  "4043619883097", // DELOCK HDMI Video Capture Stick USB Type-C™
  "4043619906727", // DELOCK Câble spiralé RJ45, prise vers port catégorie 5e, 1 m à 3 m, no
  "4043619907373", // DELOCK WiFi 2,4 GHz Antenne RP-BNC Stecker 2 dBi 14,5 cm omnidirektion
  "4043619909216", // DELOCK Câble TOSLINK 2,2 mm, fiche / mini fiche, 3 m
  "4043619917969", // DELOCK Câble USB-C 5 V pour rasoir Remington, 1,2 m
  "4045294704612", // BS SYSTEMS GMBH & CO. KG Plan de travail mobile, 500 x 700, pour L-BOX
  "4045454293567", // WAGO Fiche banane 4 mm, CAGE CLAMP, vert-jaune
  "4049759028718", // EFB-ELEKTRONIK Tôle vide RJ45 48 cm (19"), non équipé, noir
  "4049759116538", // HIROSE Prise RJ45 Hirose Cat-6a, TM31, orange
  "4049759260972", // EFB-ELEKTRONIK Rallonge de câble patch, Cat. 6A, noire, 3 m
  "4049759261054", // EFB-ELEKTRONIK Bloc multiprise 19", 1,5 U, 18 prises, USB
  "4049759290122", // EFB-ELEKTRONIK Câble patch, câble brut Cat.7, S/FTP PiMF, 0,50 m, roug
  "4050255040968", // BATAVIA Déboucheur de drain sans fil, Maxxpack, sans batterie
  "4052792034011", // LOGILINK Adaptateur USB 3.0 vers VGA LogiLink®
  "4052792034370", // LOGILINK Câble audio, prises jack mâle stéréo 3,5 mm, métal, bleu, 0,3
  "4052792047127", // LOGILINK Pile bouton au lithium, 3 V, 20,0 x 3,2 mm, lot de 10
  "4052792064131", // LOGILINK Casque, jack, mono
  "4052792065053", // LOGILINK Lampe grossissante, LED, lentille en verre véritable Ø 100 mm
  "4052792066821", // LOGILINK Capteur de vibrations WLAN
  "4052792068672", // LOGILINK Bloc multiprise 19" à 6 prises, avec 2 broches Disjoncteur
  "4052792074819", // LOGILINK Guide-câble de bureau, flexible, 30 articulations, noir
  "4052792077186", // LOGILINK Batterie Li-Ion rechargeable, AAA (Micro), 550 mAh, 1,5 V, lo
  "4052792080216", // LOGILINK Câble de synchronisation et de chargement, USB-C -> C, 1,5 m,
  "4053171956603", // MATRIX HANDELS GMBH Télécommande qui remplace LG MR22GA avec air Mouse
  "4053171963885", // MATRIX HANDELS GMBH Télécommande qui remplace LG MR20GA / AKB75855501 
  "4055144014198", // WAGO Schutzleiterklemme, 4-Leiter, Ø 0,25 - 4 mm²
  "4058075115293", // BELLALUX Lampe LED E14, 2,8 W, 250 lm, 2700 K, filament
  "4058075269866", // LEDVANCE GMBH Lampe LED STAR RETROFIT E27, 7 W, 806 lm, 2 700 K, filam
  "4058075270008", // LEDVANCE GMBH Lampe LED VINTAGE E27, 4,5 W, 250 lm, 2 2000 K, avec fil
  "4058075321267", // LEDVANCE Lampe de bureau à LED, 5 W, 220 lm, sans fil, blanche
  "4058075432635", // LEDVANCE GMBH Lampe LED STAR LINE R7S, 11,5 W, 1 521 lm, 2 700 K, 78 m
  "4058075436527", // LEDVANCE GMBH Lampe LED STAR E14, 4 W, 470 lm, 2 2700 K, avec filament
  "4058075437227", // LEDVANCE GMBH Lampe LED STAR B22d, 4 W, 470 lm, 2 2700 K, avec filamen
  "4058075831803", // LEDVANCE GMBH Lampe LED STAR E27, 8,5 W, 806 lm, 2 2700 K, avec filame
  "4058075832121", // LEDVANCE GMBH LED-Lampe STAR E14, 7,5 W, 806 lm, 2700 K, frosted
  "4066857003010", // KABELMEISTER Traversée de fenêtre solaire compatible MC4, par paire, n
  "4066966321630", // WAGO Connecteur d'épissure en ligne PUSH WIRE® - 4 mm² max.
  "4099891416867", // EDSYN Distributeur de flux CMS "No-Clean" sans plomb
  "4099986851962", // WEIDMÜLLER Bornier traversant S4C ENFICHABLE, 1,5 mm², beige
  "4099986851993", // WEIDMÜLLER Bornier de conducteur de protection S4C ENFICHABLE, 1,5 mm²
  "4250078171423", // ICYBOX USB 5 Gb/s Kabel, B Stecker auf A Stecker + USB-C Adapter, 1 m
  "4250236821825", // JOY-IT Arduino - Capteur de vibrations piézoélectriques
  "4250312502457", // CSX CSX 2GB DDR2-533MHz SODIMM
  "4250312502846", // CSX SODIMM CSX 4 GO DDR2-667MHZ
  "4250312503485", // CSX MÉMOIRE DIMM DDR3-1600MHZ CSX 4 GO
  "4250312508251", // CSX DIMM DDR3-1600MHZ 8 GO CSX
  "4250312510087", // CSX SODIMM CSX 2 GO DDR3-1333MHZ
  "4250312511848", // CSX SODIMM DDR3-1600MHZ CSX 4 GO
  "4250312512913", // CSX DIMM DDR4-2400MHZ 8 GO CSX
  "4250312513712", // CSX CSX 4GB DDR3-1866MHz SODIMM
  "4250312514986", // CSX SODIMM DDR3-1600MHZ 16 GO CSX
  "4250312566480", // CSX CSX 16 GB DDR4-3200MHz ECC Unbuffered SODIMM
  "4250348731104", // PCE INSTRUMENTS Sonomètre LEQ PCE-354, 30 - 130 dB
  "4250549505542", // LUMENO Lampe loupe, LED, Ø 177 mm Lentille en verre véritable, 3 diopt
  "4250551405441", // SMRTER Câble de chargement, USB/USB-C -> micro USB, Lightning &
  "4250696655428", // FLEXLINE Patchkabel Cat.8.1, U/FTP, TPE, schwarz, 2 m
  "4250967312210", // MCSHINE Lampe pendulaire E14, blanc, câble de 1,5 m avec interrupteur 
  "4250967341203", // EINLICHT Lampe à pince, HALO, 3,3 W, 438 lm, blanche
  "4251266700630", // FREI Raspberry Pi - Rallonge micro SD, flexible, 15 cm
  "4251266751502", // SERTRONICS Hub USB 2.0 4 ports micro USB OTG noir
  "4251364720356", // SONERO Anschlusskabel, IEC, Stecker, Kupplung, 1 m
  "4251364720394", // SONERO Câble de raccordement, CEI, prise, couplage, 5 m
  "4251364720882", // SONERO Fiche DisplayPort vers fiche HDMI A, 2 m, 4K à 30 Hz
  "4251364721322", // SONERO Câble moniteur VGA 15 broches VGA mâle, 1080p, 1 m
  "4251364736432", // SONERO Micro HDMI auf HDMI Kabel, 4K 60Hz, 1,5m
  "4251364736579", // SONERO Câble d'extension HDMI, 4K 60 Hz, 3,0 m
  "4251364736593", // SONERO Câble d'extension HDMI, 4K 60 Hz, nylon, 0,5 m
  "4251364736616", // SONERO Câble d'extension HDMI, 4K 60 Hz, nylon, 1,5 m
  "4251364736630", // SONERO HDMI Verlängerungskabel, 4K 60Hz, Nylon, 3,0m
  "4251364736685", // SONERO Adapter, HDMI-C-Stecker auf HDMI-A-Buchse, schwarz
  "4251364756027", // PURELINK FlexInstall
  "4251394608617", // METZ CONNECT CAT.6A Module K 180° Jack, seul
  "4255606501581", // BLULAXA LED-Lampe E27, 0,8 W, 50 lm, 1800 K
  "4255606502403", // BLULAXA Bande de LED, 3 3000 K, 1000 mm, fonctionnant sur batterie
  "4255606504070", // BLULAXA LED FlexFilament A60, E27, 4,8 W, 380 lm, 2200 K.
  "4255606504346", // BLULAXA Bande LED, RVB, 5 m, IP44, avec télécommande
  "4255719602397", // LUXULA Lampe à filament LED, E27, 2 W, 40 lm, 2 1800 K, intensité vari
  "4255719605060", // ENOVALITE Lampadaire LED, noir, ALU, 1 flamme, douille GU10, IP20
  "4255719605138", // LUXULA Panneau LED, 62 x 62 cm, CRI98, 40 W, 4000 lm, 4000K.
  "4255719605305", // ENOVALITE Highbay, 200W, 5000K, 170lm/W, dimmable
  "4255719605374", // LUXULA Lampe à broche LED G4, 1,8 W, 160 lm, 2 2800 K
  "4255719605411", // LUXULA Lampe LED G9, 4 W, 400 lm, 2 4000 K
  "4255719605428", // LUXULA Lampe LED G9, 7 W, 700 lm, 2 2800 K, à intensité variable
  "4255719605510", // LUXULA LUXULA LITEQ 100, panneau LED avec télécommande, blanc
  "4255719623507", // LUXULA Éclairage sous meuble LED, 120 cm, 36 W
  "4260101731135", // TECHNAXX Compresseur mobile, 10 bar, pompe à air sans fil
  "4260113570753", // LOGILINK Modularstecker CAT5e schwarz 100 Stk.
  "4260113575406", // LOGILINK Boîtier de protection pour disque dur 1 × 2,5"
  "4260134116725", // PUREMOUNTS Support pour moniteur, 1 écran, 13" - 27", noir, montage mu
  "4260293197146", // BLULAXA Suspension par câble métallique pour panneau à LED
  "4260293203007", // BLULAXA Bande de LED, blanc chaud, 3000 mm, avec bloc d'alimentation
  "4260293207272", // BLULAXA Lampe LED longue portée slim, 10 W, 1200 lm, 2 4000 K, 30 cm
  "4260439550620", // HIFIBERRY Raspberry Pi Shield - HiFiBerry DAC+ ADC Pro
  "4260439550712", // HIFIBERRY Logement pour Raspberry Pi 4 & HiFiBerry DAC+, n/b
  "4260439551030", // HIFIBERRY Bouclier Raspberry Pi - HiFiBerry DAC2 ADC Pro
  "4260508896932", // ENOVALITE LED-Panel, 36 W, 3600 lm, CCT, 120x30
  "4260528722709", // RUTHEX Fer à souder 900M, 90 W, avec affichage LED
  "4260556620954", // LED2WORK LED Maschinenleuchten, TOPLED, 8,4 W, IP67
  "4260573969364", // QUADRIOS Pince à sertir pour embouts de câble, 230 mm, avec 1200 embou
  "4260580375813", // SAMSUNG SSD OEM client Samsung PM9A1 1 To, NVMe
  "4260664814405", // GARDIGO Lumière UV et flux d'air piège à insectes
  "4260766895265", // PCWORK Pinzettenset, ESD-sicher, 9-teilig, Edelstahl
  "4260766895586", // PCWORK jeu d'outils de précision de 89 pièces
  "4260766895777", // PCWORK LED-Arbeitsleuchte, 400 lm, Akku
  "4262489710177", // ENERGIELESER Lecteur d'énergie - lecteur de gaz, wifi
  "4262504150698", // FREI Support pour la série Shelly Mini, rail DIN
  "4262565910026", // TTL NETWORK Câble DisplayPort 2,1, 80Gbps, 16K60Hz, 2,0m
  "4262565910033", // TTL NETWORK Câble DisplayPort 2,1, 80 Gbit/s, 16K60Hz, 3,0 M.
  "4262565910170", // TTL NETWORK Câble USB 40Gbit/s, 240W, 8K60Hz, 0,5m
  "4270002353138", // PCWORK Testeur de prise PCW06B, avec contrôle RCD et écran LCD
  "4710679550008", // AKASA Boîtier pour Raspberry Pi 4B, alu, argenté
  "4710679550138", // AKASA Boîtier pour Raspberry Pi 4B, alu, noir
  "4710679550749", // AKASA Boîtier pour Raspberry Pi 4B, alu, noir
  "4716123315209", // NOCTUA Câble en Y 3 broches Noctua NA-SYC2
  "4718937615155", // ZYXEL Point d'accès WLAN 2.4/5 GHz 1 1200 Mb/s.
  "4895229151253", // PHILIPS MEDIA Écouteurs intra-auriculaires filaires avec MIC + USB-C T
  "4897104950241", // WIZ WiZ Fernbedienung Wifi
  "4909723161493", // ICOM Radio portable libre de droits (dPMR446/PMR446)
  "5055416000019", // PANORAMA ANTENNAS Antenne LoRa 868 MHz, 2 dBi, fiche SMA
  "5056561804224", // RASPBERRY PI Raspberry Pi - MicroSD-Karte, A2-Class, 128 GB
  "5056561805306", // RASPBERRY PI Raspberry Pi Compute Modul 5, 2GB RAM, sans eMMC
  "5099383004557", // EI ELECTRONICS Module radio de monoxyde de carbone
  "5410329655105", // PEREL Projecteur de travail LED, 15 W, 800 lm, avec pied aimanté
  "5410329709792", // VELLEMAN Bloc d'alimentation secteur, 12 W, 12 V, 1 A, stabilisé
  "5412810400263", // NEDIS Projecteur LED GU10, 1,9 W, 145 lm, 2 2700 K
  "5412810419845", // NEDIS Nedis Câble audio DIN
  "5412810425747", // NEDIS Câble coaxial, fiche CEI <> prise CEI, 2,00 m, rond, blanc
  "5412810426553", // NEDIS Câble audio-vidéo, fiche 3.5 mm <> 3x fiches RCA, 2,00 m, rond
  "5412810426577", // NEDIS Câble vidéo composite, RCA <> RCA, 2 m, rond
  "5615268400056", // KUBII Manette N64 USB
  "5902135124482", // POS POWER Bloc d'alimentation LED, 50 W, 12 V c.c., 4,16 A, CV+CC, int
  "5999094002364", // KOLINK Kolink Adapter 4+4-Pin CPU auf 6+2-Pin-PCIe, schwarz
  "5999094004771", // KOLINK Jeu de câbles Kolink Core Adept - noir/gris
  "6928819523586", // XTOOL Presse de transfert, mini presse, blanc
  "6941921149024", // HYPER PortReplicator/station d'accueil, USB-C, 6 ports
  "6942383122594", // G&G Toner, BROTHER, noir, TN-2510XL, compatible
  "6952918341123", // XTAR Chargeur rapide 2 A, micro USB, Li-ion, 1 emplacement
  "6956362941762", // SUPERFIRE Lampe de poche multifonction Superfire G16-S, 800 lm, USB-C.
  "6971636401735", // CREALITY3D Imprimante 3D, K1C
  "6971974621352", // DANGBEI Projektor-Stand, für Dangbei Atom
  "6972012773897", // ANNKE Caméra de surveillance extérieure, IP, LAN, PoE
  "6974370800314", // HOTO Präzisionsschraubendreher mit Bits, 24-in-1
  "6974370800598", // HOTO Jeu d'outils, mallette à outils, HOTO, 9 pièces
  "6975514333088", // HOYMILES Micro-onduleur, HOYMILES HiFlow1600 Pro (4xMMPT)
  "6976521115292", // INATECK Imprimante d'étiquettes, Thermo, Bluetooth, Noir
  "7319926016648", // GOLLA Ordinateur portable, housse de protection, pochette, 15" (38 cm)
  "7350001161778", // KKSB Boîtier pour Raspberry Pi 5 + HATs et dissipateur, alu, noir
  "7350001162034", // KKSB Boîtier pour Raspberry Pi 5, aluminium, noir
  "7350001162089", // KKSB Boîtier pour Raspberry Pi 5 & M.2 NVMe HAT
  "7350001162201", // KKSB Boîtier pour Raspberry Pi 3/4/5, rack 10 pouces, noir
  "7350001162249", // KKSB Boîtier pour Raspberry Pi 5 + dual HATs et dissipateur, alu, noi
  "7613187014628", // REAN Prise jack stéréo 3,5 mm à 3 broches, boîtier noir
  "7613187027703", // NEUTRIK PowerCON® TRUE1, embase/fiche mâle de panneau
  "7640170030099", // CONSTRUCTIVA Assortiment de résistances, 0402, E12, 1 %, 25 pièces/val
  "7640170030129", // CONSTRUCTIVA Assortiment de résistances, 0402, E24, 1 %, 25 pièces/val
  "7640186418959", // DICOTA Sac à dos pour ordinateur portable, Eco base 15" - 17.3"
  "8010703853867", // TCI Variateur LED, max., 150 W, CASAMBI, coupure de phase
  "8012823244259", // FINDER Relais enfiché, 1 x UM, 250 V/16 A, 12 V, pas 5,0 mm
  "8051128106367", // TECHLY HDMI High Speed avec Ethernet, rallonge, 3 M.
  "8051128109665", // EFB-ELEKTRONIK Adaptateur HDMI, fiche USB 3.1 Type-C vers port HDMI, 4
  "8054242080643", // SUPERIOR ELECTRONICS Télécommande universelle Ready5 Smart Extended Su
  "8054242081145", // SUPERIOR ELECTRONICS Kit de piles pour lave-linge et sèche-linge
  "8054242081725", // SUPERIOR ELECTRONICS Télécommande multifréquence fixe et à code tourna
  "8056772850154", // 1CONTROL Ouvre-porte sans fil, intelligent, Bluetooth, 50 utilisateurs
  "8698800002526", // LOGILINK Boîtier mural 10", 9U, profondeur 300 mm, gris
  "8711658438375", // SMARTWARES Kit d'interrupteur mural sans fil
  "8718739066656", // SCHIEFER LIGHTING Variateur de cordon à bouton poussoir LED, 0 - 75 W,
  "8718739068797", // SCHIEFER LIGHTING Lampe LED E27, 1 W, orange
  "8720039511859", // PHILIPS MEDIA Carte microSDXC, 64 Go classe 10 UHS-I U3 avec adaptateu
  "8720389078972", // PHILIPS Ventilateur de table Philips série 1000
  "8721139740071", // BATAVIA Tronçonneuse sans fil à une main, Maxxpack, 18 V, sans batteri
  "9010018201246", // NOCTUA Lot de 2 grilles de ventilateur NOCTUA NA-FG1-20 200 mm
  "9503289416759", // FREI Rallonge de câble pour Shelly Pro 3EM, 100 cm
] as const;

const ALLOWED_PROVIDER_KEYS = new Set(REI_GALAXUS_ALLOWED_GTINS.map((gtin) => `REI_${gtin}`));

export function isGalaxusReiAllowlistEnabled(): boolean {
  const raw = String(process.env.GALAXUS_REI_ALLOWLIST ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

export function isReiGalaxusAllowlisted(providerKey: string | null | undefined): boolean {
  return ALLOWED_PROVIDER_KEYS.has(String(providerKey ?? "").trim().toUpperCase());
}

export function reiGalaxusAllowlistSize(): number {
  return ALLOWED_PROVIDER_KEYS.size;
}
