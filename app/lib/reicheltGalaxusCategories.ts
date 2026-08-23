import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

type ReicheltClassifyInput = {
  breadcrumbs?: string[] | null;
  title?: string | null;
  supplierProductType?: string | null;
};

/** Never ingest — explicit user skip list. */
const REICHELT_SKIP_PATTERNS: RegExp[] = [
  /software|betriebssystem|bürosoftware|buerosoftware|anwender-software|sicherheitssoftware|fachbuch|messsoftware/i,
  /kleber|malerband|abdeckband|spachtel|farbe\b|lacke\b|lack\b/i,
  /möbel(?!.*gaming)|meuble|bürostuhl(?!.*gaming)|chefsessel|besucherstuhl|drehstuhl(?!.*gaming)/i,
  /sanitär|sanitaer|dusche|wc\b|waschbecken|spüle/i,
  /angeln\b|fischen\b|jagd\b/i,
  /tabak|zigarette/i,
];

/** Reichelt breadcrumb / label → Galaxus kind. Order = specific before generic. */
const REI_LABEL_TO_KIND: Array<{ pattern: RegExp; kind: GalaxusProductKind }> = [
  // explicit skips handled in classify — software first in skip list

  // Jetson / SBC — before robot rules (Jetson AGX = Entwicklungsboard + Kit)
  { pattern: /jetson|nvidia jetson|agx thor|agx orin|agx xavier|agx nano/i, kind: "dev_board" },

  // robotics — before docking/notebook false positives (e.g. Unitree Dockingstation)
  {
    pattern:
      /robotik modul|robot module|robot modul|\bmodule unitree|\bh2 module|\bh2\b.*unitree/i,
    kind: "robot_module",
  },
  {
    pattern:
      /robotik zubeh|robot.*zubeh|robot.*accessory|robot.*accessoire/i,
    kind: "robot_accessory",
  },
  {
    pattern:
      /unitree|\bgo2\b|go 2\b|\bg1 edu|\bg1\b|humanoid|quadruped|robot dog|roboter hund|robot dog|boston dynamics|spot mini|roboter kit|robot kit|robotik kit|kit robotique|service robot|combat robot|robotic arm|robot arm|manipulator arm/i,
    kind: "robot_kit",
  },

  // camping (FR + DE slugs from Galaxus Sport > Outdoor > Camping)
  { pattern: /cuisine de camping|campingkocher|camping.?koch/i, kind: "camping_stove" },
  { pattern: /campinggeschirr|camping.?geschirr/i, kind: "camping_cookware" },
  { pattern: /gaskartusche|cartouche de gaz|gas cartridge/i, kind: "camping_gas" },
  { pattern: /matelas de randonn|isomatte|sleeping pad/i, kind: "camping_mat" },
  { pattern: /glaci[eè]re|kühlbox|kuehlbox|cool box/i, kind: "camping_cooler" },
  { pattern: /glaci[eè]re.*access|kühlbox.*zubeh|cool box.*acc/i, kind: "camping_cooler_acc" },
  { pattern: /sac de couchage|schlafsack|sleeping bag/i, kind: "camping_sleeping_bag" },
  { pattern: /schlafsack.*zubeh|sleeping bag.*acc/i, kind: "camping_sleeping_bag_acc" },
  { pattern: /\btente\b|\bzelt\b|\btent\b/i, kind: "camping_tent" },
  { pattern: /tente.*access|zelt.*zubeh|tent.*acc/i, kind: "camping_tent_acc" },
  { pattern: /meubles de camping|campingmöbel|campingstuhl|campingtisch|campingmobiliar|camping furniture/i, kind: "camping_furniture" },
  { pattern: /camping(?!lampe|licht|leuchte)/i, kind: "camping_tent" },

  // power tools — Fraiser + raboter (Galaxus Baumarkt > Fräsen + Hobeln)
  { pattern: /fraiseuse|fräse|fräsmaschine|fraesen|cnc.?fr|milling machine|router\b/i, kind: "power_router" },
  { pattern: /drehmaschine|tour\b|lathe/i, kind: "power_lathe" },
  { pattern: /raboteuse|hobelmaschine|planer\b|hobeln/i, kind: "power_planer" },
  { pattern: /graveur|gravierer|engraver/i, kind: "power_engraver" },

  // smartphones / wearables — separate Galaxus leaf categories
  { pattern: /\bsmartphones?\b(?!.*zubeh|.*access|.*halter|.*hülle|.*rep)/i, kind: "smartphone" },
  { pattern: /tastenhandy|mobile phone/i, kind: "smartphone" },
  { pattern: /\btablets?\b(?!.*graph|.*zubeh.*stift)/i, kind: "tablet" },
  { pattern: /e-book|ebook|ereader|liseuse/i, kind: "ereader" },
  { pattern: /smartwatch|montre connect|uhr connect/i, kind: "smartwatch" },
  { pattern: /smartwatch.*zubeh|montre connect.*access/i, kind: "smartwatch_accessory" },
  { pattern: /aktivitätstracker|activity tracker|fitness.?tracker|smart.?tracker|tracker\b/i, kind: "activity_tracker" },
  { pattern: /smartphone akku|ersatzakkus fuer handys|mobile battery/i, kind: "smartphone_battery" },
  { pattern: /powerbank|power bank/i, kind: "power_bank" },
  { pattern: /halter.*smartphone|smartphone halter|phone holder/i, kind: "phone" },

  // batteries / power — context-specific
  { pattern: /unterbrechungsfrei|\busv\b|ups\b/i, kind: "ups" },
  { pattern: /usv.*zubeh|ups.*zubeh/i, kind: "ups_accessory" },
  { pattern: /server.*zubeh|serverschrank.*zubeh|rack.*zubeh/i, kind: "server_accessory" },
  { pattern: /serverschrank|19.?zoll.*schrank|rack\s*geh/i, kind: "server_rack" },
  { pattern: /gender.?changer|adapter.*hdmi|adapter.*vga|adapter.*dvi/i, kind: "video_cable" },
  { pattern: /\bakkus\b|replacement battery|ersatzakku/i, kind: "rc_battery" },
  { pattern: /laborprogramm|laborsystem|labor.*system/i, kind: "lab_power_supply" },
  { pattern: /\brc\b.*lade|modellbau.*lade/i, kind: "rc_charger" },
  { pattern: /solarpanel|solarmodul|photovoltaik/i, kind: "solar_panel" },
  { pattern: /solar.*zubeh|zubehör solarenergie|wechselrichter|solarwechselrichter/i, kind: "solar_accessory" },
  { pattern: /blei.?akku|blei.?vlies|stationary battery/i, kind: "ups" },
  { pattern: /alkaline|mignon|micro\b.*batter|knopfzell|button cell|9v block/i, kind: "charger" },

  // TV / AV / beamer
  { pattern: /beamer|projektor|projector/i, kind: "beamer" },
  { pattern: /beamer.*zubeh|leinwand|projector screen/i, kind: "beamer_accessory" },
  { pattern: /\btv\b|fernseher|television/i, kind: "tv" },
  { pattern: /tv.*zubeh|fernseh.*zubeh|wandhalter|deckenhalter.*tv/i, kind: "tv_accessory" },
  { pattern: /av receiver|receiver\b.*audio|stereo receiver/i, kind: "av_receiver" },
  { pattern: /bluray|blu-ray|dvd.?player|dvd player/i, kind: "bluray_player" },
  { pattern: /dvb|sat.*receiver|receiver dvb|parabol|satelliten/i, kind: "tv_receiver" },
  { pattern: /soundbar|barre de son/i, kind: "soundbar" },
  { pattern: /plattenspieler|turntable|phono/i, kind: "turntable" },
  { pattern: /stereoverstärker|stereo receiver|verstärker\b|amplifier\b|ampli\b/i, kind: "amplifier_hifi" },
  { pattern: /car.?hifi|fahrzeug.*lautsprecher|autoradio/i, kind: "car_hifi" },
  { pattern: /subwoofer|tieftöner|tieftoner/i, kind: "car_subwoofer" },

  // photo / video
  { pattern: /dashcam|dash cam|rückfahrkamera|backup camera/i, kind: "dashcam" },
  { pattern: /stativ|trépied|tripod|gimbal/i, kind: "camera_tripod" },
  { pattern: /objektiv|\blens\b/i, kind: "camera_lens" },
  { pattern: /drohne|drone|multikopter|quadcopter/i, kind: "drone" },
  { pattern: /kamera|camera\b|caméra|camcorder|action cam/i, kind: "camera" },

  // dev boards / SBC
  {
    pattern:
      /raspberry|arduino|jetson|entwicklungsboard|development board|single.?board|einzelplatinen|mini.?pc|intel nuc|brix|microcontroller|microcontrôleur|mikrocontroller|robotik kit|robot kit|fpga|evaluation board|starter kit|board de d[eé]veloppement|platinencomputer|embedded system|entwicklerboard/i,
    kind: "dev_board",
  },

  // Lighting BEFORE `led\b` in active semiconductors — otherwise tubes/lamps map to Transistor.
  {
    pattern:
      /campinglampe|camping[-\s]?lampe|camping[-\s]?licht|camping[-\s]?leuchte|campingleuchte|camping\s*light|lampe.*camping|lumière.*camping|akku[-\s]?camping|led[-\s]?camping|lumière\s*extérieure\s*led|outdoor\s*led.*(?:batter|akku)|led[-\s]?akku[-\s]?camping|\bglen\b/i,
    kind: "camping_lamp",
  },
  {
    pattern:
      /led[-\s]?röhre|led[-\s]?roehre|led[-\s]?tube|tube\s*led|röhre\s*t[58]|roehre\s*t[58]|\bt5\b.*(?:led|röhre|tube)|\bt8\b.*(?:led|röhre|tube)|(?:led|röhre|tube).*\bt[58]\b|culot\s*g13|sockel\s*g13|\bg13\b.*(?:tube|röhre|led)|leuchtmittel|filament\s*led|lampe\s*filament|led[-\s]?filament|ampoule\s*led|glühbirne|gluehbirne|led[-\s]?birne|led\s*bulb|lampe\s*led|led[-\s]?lampe(?!.*(?:driver|ic|modul))|projecteur\s*led|led[-\s]?strahler|led[-\s]?spot|gu10|gu5\.?3|gu4|e27|e14|e40|mr16/i,
    kind: "light_bulb",
  },
  {
    pattern:
      /stirnlampe|headlamp|head\s*torch|lampe\s*frontale/i,
    kind: "headlamp",
  },
  {
    pattern:
      /taschenlampe|flashlight|\btorch\b|lampe\s*de\s*poche/i,
    kind: "flashlight",
  },
  {
    pattern:
      /lampe\s*de\s*travail|arbeitsleuchte|werkstattlampe|werkstattleuchte|work\s*light|baustellenstrahler|projecteur\s*de\s*chantier|unterbau|sous[-\s]?meuble|schrankbeleuchtung|stehlampe|tischlampe|deckenleuchte|wandleuchte|lampe\s*de\s*table|aussenleuchte|außenleuchte|gartenleuchte|solarleuchte|outdoor.?light|panneau\s*(?:à\s*)?led|led[-\s]?panel/i,
    kind: "home_lamp",
  },
  {
    pattern:
      /bewegungsmelder|motion\s*sensor|motion\s*detector|détecteur\s*de\s*mouvement|detecteur\s*de\s*mouvement|détecteur\s*de\s*présence|anwesenheitssensor|\bpir\b/i,
    kind: "motion_sensor",
  },
  // LED drivers / PSUs — not finished luminaires, not transistors
  {
    pattern:
      /(?:transformateur|trafo|netzteil|alimentation|power\s*supply|driver|bloc\s*d['’]alimentation|led[-\s]?treiber)\s*led|led\s*(?:transformateur|trafo|netzteil|driver|alimentation|power\s*supply|treiber)|alimentation\s*led|led[-\s]?netzteil|constant\s*current.*led|led.*constant\s*current/i,
    kind: "charger",
  },
  // Discrete LED components (SMD / wired indicators) — keep as Aktive Bauelemente
  {
    pattern:
      /led,\s*cms|cms\s*(?:latérale|laterale)?\s*,?\s*rgb|led,\s*\d+\s*mm|led\s*\d+\s*mm|led\s*simple|\b\d+\s*mcd\b|superflux|led\s*bedrahtet|wired\s*led|led\s*chip|led\s*diode|led\s*emitter|smd\s*led|high[-\s]?power\s*led/i,
    kind: "active_component",
  },
  // Broad LED lighting catch-all (brands: LEDVANCE, Paulmann, V-TAC, …) before semiconductor fallthrough.
  {
    pattern:
      /\bled\b.{0,48}(?:lampe|leuchte|strip|band|bande|barrette|streifen|leiste|panel|panneau|spot|strahler|röhre|roehre|tube|birne|bulb|filament|downlight|beleuchtung|luminaire|éclairage|eclairage|leuchtmittel|ampoule|glüh|glueh|spotlight|decke|pendel|einbau|plafonnier|applique|projecteur|feu\b|signalisation|maxled|highbay|armature|colonne)|(?:lampe|leuchte|strip|band|bande|barrette|streifen|leiste|panel|panneau|spot|strahler|röhre|roehre|tube|birne|bulb|filament|downlight|beleuchtung|luminaire|éclairage|eclairage|leuchtmittel|ampoule|spotlight|deckenlampe|pendelleuchte|einbauleuchte|strahler|leuchtstoff|plafonnier|applique|projecteur|maxled|highbay|armature|colonne\s*lumineuse).{0,48}\bled\b|\b(?:leuchtmittel|glühbirne|gluehbirne|ampoule|leuchtstofflampe|energiesparlampe|halogenlampe|plafonnier|applique\s*murale|panneau\s*d['’]encastrement|high\s*bay|highbay|colonne\s*lumineuse|armature\s*led|maxled)\b/i,
    kind: "light_bulb",
  },
  {
    pattern:
      /\b(?:lampe|leuchte|luminaire|lumininaire|éclairage|eclairage|beleuchtung|strahler|downlight|pendelleuchte|deckenlampe|tischlampe|stehlampe|wandlampe|einbauleuchte|plafonnier|applique|projecteur|feu\s*(?:machine|de\s*signalisation|d['’]orientation|à\s*éclats|a\s*eclats)|avertisseur\s*lumineux|feu\s*de\s*machine)\b/i,
    kind: "home_lamp",
  },
  // Finished LED modules with electrical lighting specs (W + lm/K)
  {
    pattern: /module\s*led|led\s*module|led2work|systeme\s*d['’]eclairage|système\s*d['’]éclairage/i,
    kind: "light_bulb",
  },
  {
    pattern:
      /\bled\b.{0,80}\d+(?:[.,]\d+)?\s*W\b.{0,80}\d[\d\s]*\s*(?:lm|K)\b|\b\d+(?:[.,]\d+)?\s*W\b.{0,80}\bled\b.{0,80}\d[\d\s]*\s*(?:lm|K)\b/i,
    kind: "light_bulb",
  },
  { pattern: /\blatarka\b|keychain\s*led|led\s*key\s*chain/i, kind: "flashlight" },
  {
    pattern:
      /alimentation\s*à\s*découpage.*led|led.*alimentation\s*à\s*découpage|variateur.*led|led.*variateur|dimmer.*led|led.*dimmer/i,
    kind: "charger",
  },

  // active semiconductors — discrete parts (finished LED lamps handled above)
  {
    pattern:
      /transistor|mosfet|igbt|thyristor|diode|zener|optocoupl|triac|halbleiter|semiconductor|active component|composant actif|aktives bauelement|gate driver|driver ic|integrated circuit|\bic\b|microprocesseur|processeur embarqu|spannungsregler|regulator|op.?amp|operational amplifier|logic ic|memory ic|timer ic|convertisseur|wandler/i,
    kind: "active_component",
  },

  // passive components
  {
    pattern:
      /widerstand|resistor|résistance|kondensator|capacitor|condensateur|induktor|inductor|inductance|spule|relais|relay|relai|passive component|composant passif|passives bauelement|potentiometer|trimmer|ferrite|quarz|crystal|oscillator|crystal oscillator|varistor|thermistor|fuse holder|sicherung/i,
    kind: "passive_component",
  },

  // enclosures / PCB / connectors
  {
    pattern:
      /gehäuse|gehause|enclosure|boîtier|boitier|leiterplatte|pcb|printed circuit|platine|circuit board|elektronikzubehör|elektronikgehäuse|steckverbinder|connecteur|connector|buchsenleiste|header|socket|terminal block|bornier|klemme|crimp|fiche\b|fiches\b|pin header|d-sub|dsub|rf connector|coax|stecker.*kupplung|rj45/i,
    kind: "electronic_enclosure",
  },

  // soldering
  {
    pattern:
      /lötstation|lötgerät|löten|soldering station|soldering iron|station de soudure|fer à souder|entlöt|desolder|lötzinn|solder wire|solder paste|flux\b|schweiss|welding|loetkolben|loetstation/i,
    kind: "soldering_tool",
  },

  // test / measure
  {
    pattern:
      /oszilloskop|oscilloscope|funktionsgenerator|function generator|signal generator|logic analyzer|analyseur logique|spectrum analyzer|component tester|usb-oszilloskop/i,
    kind: "oscilloscope",
  },
  {
    pattern:
      /multimeter|messgerät|measuring instrument|instrument de mesure|lab.?power|netzgerät|lab supply|labornetzger|prüfgerät|testgerät|spannungsprüfer|component tester/i,
    kind: "multimeter",
  },
  { pattern: /energiemess|energiezähler|stromzähler|power meter/i, kind: "energy_meter" },
  { pattern: /endoskop|microscope|mikroskop/i, kind: "endoscope" },

  // electronic hand tools
  {
    pattern:
      /schraubendreher|screwdriver|steckschlüssel|stecknuss|bitsatz|bit.?set|drehmoment|crimpzange|abisolier|wire stripper|seitenschneider|bolzenschneider|pinzette|tweezer|entgrater|pcb cutter|hot air/i,
    kind: "hand_screwdriver",
  },
  { pattern: /\bzange\b|\bpliers\b|pince\b/i, kind: "pliers" },

  // PC components — full Galaxus PC Komponenten tree
  { pattern: /grafikkarte|graphics card|carte graphique|gpu\b|video card|radeon|geforce/i, kind: "pc_gpu" },
  { pattern: /prozessor|processor|processeur|\bcpu\b|ryzen|core i[3579]|xeon|threadripper|cpus amd|cpus intel/i, kind: "pc_cpu" },
  { pattern: /mainboard|motherboard|carte mère|carte mere|platine mère/i, kind: "pc_motherboard" },
  { pattern: /\bddr\d|\bram\b|arbeitsspeicher|memory module|mémoire vive|dimm|so.?dimm/i, kind: "pc_ram" },
  { pattern: /externe ssd|external ssd|ssd externe|ssds als externe/i, kind: "pc_ssd" },
  { pattern: /\bm\.2\b|\bnvme\b|solid state|\bssd\b/i, kind: "pc_ssd" },
  { pattern: /externe festplatte|external hard drive|disque dur externe/i, kind: "pc_hdd" },
  { pattern: /festplatte|hard drive|disque dur|\bhdd\b|sata drive|laufwerk/i, kind: "pc_hdd" },
  { pattern: /festplattengehäuse|gehäuse.*laufwerk|hdd enclosure/i, kind: "pc_hdd_enclosure" },
  { pattern: /pc netzteil|pc power supply|alimentation pc|atx power|netzteil pc|schaltnetzteil/i, kind: "pc_psu" },
  { pattern: /pc gehäuse|pc case|boîtier pc|boitier pc|tower case|mini-itx case/i, kind: "pc_case" },
  { pattern: /wasserkühl|wasserkuehl|water cooling|wasserkühlung/i, kind: "pc_watercooling" },
  { pattern: /cpu kühler|cpu cooler|refroidisseur cpu/i, kind: "pc_cooler" },
  { pattern: /pc lüfter|case fan|ventilateur pc|lüftersteuerung|ventilateur\b/i, kind: "pc_fan" },
  { pattern: /barebone|aufrüst.?pc|aufruest.?pc|mini pc system/i, kind: "pc_barebone" },
  { pattern: /all-in-one|all in one pc/i, kind: "desktop_pc" },

  // notebooks / desktops
  { pattern: /notebook|laptop|portable|ultrabook|chromebook/i, kind: "notebook" },
  { pattern: /desktop pc|tower pc|workstation|\bpc system|computer\b.*pc/i, kind: "desktop_pc" },

  // network
  { pattern: /netzwerkkabel|network cable|câble réseau|cable reseau|patchkabel|patch cable|cat\.?\s*[56768]|rj45 cable|ethernet cable/i, kind: "network_cable" },
  { pattern: /netzwerk switch|network switch|switch réseau|switch reseau|managed switch/i, kind: "network_switch" },
  { pattern: /wlan repeater|wifi repeater|répéteur|repeteur|mesh/i, kind: "wifi_repeater" },
  { pattern: /powerline|courant porteur|powerline adapter/i, kind: "powerline_adapter" },
  { pattern: /access point|point d'accès|point d acces/i, kind: "network_router" },
  { pattern: /\brouter\b|routeur|modem router|dsl router|wifi router|wlan router/i, kind: "network_router" },
  { pattern: /\bnas\b|netzwerkspeicher|network storage|serveur de stockage/i, kind: "network_nas" },
  { pattern: /nas.*zubeh/i, kind: "nas_accessory" },
  { pattern: /\bserver\b|serveur|rack server|server rack/i, kind: "server" },

  // peripherals
  { pattern: /gaming tastatur|gaming keyboard|clavier gaming|\btastatur\b|\bkeyboard\b|clavier\b/i, kind: "keyboard" },
  { pattern: /gaming maus|gaming mouse|souris gaming|\bmaus\b|\bmouse\b|souris\b/i, kind: "mouse" },
  { pattern: /mausmatte|mouse pad|tapis de souris/i, kind: "mouse" },
  { pattern: /\bmonitor\b|bildschirm|écran|ecran|display\b|curved monitor|gaming monitor|touchdisplay/i, kind: "monitor" },
  { pattern: /grafiktablett|graphics tablet|tablette graphique/i, kind: "graphics_tablet" },
  { pattern: /webcam|caméra web|camera web/i, kind: "webcam" },
  { pattern: /kvm switch|kvm\b/i, kind: "kvm_switch" },
  { pattern: /notebook.*dock|laptop.*dock|port replicator|usb hub|usb-hub|dockingsation.*notebook|dock.*notebook/i, kind: "notebook" },
  { pattern: /gaming.?stuhl|gaming chair|gamingstuhl/i, kind: "gaming_chair" },
  { pattern: /gaming.?tisch|gaming desk|gamingtisch/i, kind: "gaming_desk" },

  // printers / 3D / labels / office
  { pattern: /3d druck|3d print/i, kind: "printer_3d" },
  { pattern: /3d drucker|imprimante 3d|cnc-fraesen|cnc fraesen|automatis.*fertigung/i, kind: "printer_3d" },
  { pattern: /filament|3d druck zubeh/i, kind: "filament_3d" },
  { pattern: /etikettendruck|label printer|beschriftungsgerät|beschriftungsgeraet|dymo|brother.*beschrift/i, kind: "label_printer" },
  { pattern: /beschriftungsband|schriftband|label tape/i, kind: "label_tape" },
  { pattern: /aktenvernichter|shredder|papiervernichter/i, kind: "shredder" },
  { pattern: /toner|cartouche|ink cartridge|encre|druckerpatrone|printer cartridge|tinte\b|tinten/i, kind: "toner" },
  { pattern: /tinten\b|druckerpatrone|ink\b/i, kind: "ink_cartridge" },
  { pattern: /scanner\b|scanneur/i, kind: "scanner" },
  { pattern: /drucker|printer|imprimante/i, kind: "printer" },

  // cables
  { pattern: /hdmi|displayport|videokabel|video cable|câble vidéo|cable video|dvi cable|vga cable|scart|dp dp|dp dvi|dp vga/i, kind: "video_cable" },
  { pattern: /usb kabel|usb cable|câble usb|cable usb|lightning cable|type-c cable|usb-c/i, kind: "usb_cable" },
  { pattern: /audio kabel|audio cable|câble audio|cable audio|lautsprecherkabel|speaker cable|jack cable|rca cable|xlr|a v-/i, kind: "audio_cable" },
  { pattern: /stromkabel|power cable|câble secteur|cable secteur|netzkabel|mains cable|extension cable|prolongateur|secteur/i, kind: "power_cable" },
  { pattern: /schnittstellenkabel|interface cable|câble interface/i, kind: "video_cable" },
  { pattern: /kabelbinder|cable tie|colliers de serrage/i, kind: "cable_accessory" },
  { pattern: /kabelverbindung|kabelleitung|cable connector kit|gaine|conduit|schrumpfschlauch/i, kind: "electrical_installation" },
  { pattern: /netzstecker|power plug|fiche secteur|stecker und kupplung|mains plug/i, kind: "connector" },
  { pattern: /steckdosenleiste|power strip|multiprise|surge protector|parafoudre/i, kind: "power_strip" },

  // storage media
  { pattern: /usb stick|clé usb|cle usb|flash drive|usb flash|usb-sticks/i, kind: "storage_usb" },
  { pattern: /speicherkarte|memory card|carte mémoire|carte memoire|microsd|sd card|cf card|cf-karten|sd-karten/i, kind: "storage_card" },

  // audio / av
  { pattern: /kopfhörer|headphone|headset|casque|earbud|in-ear|over-ear/i, kind: "headphone" },
  { pattern: /bluetooth lautsprecher|bluetooth speaker|enceinte bluetooth|smart speaker|enceinte intelligente|lautsprecher|speaker/i, kind: "speaker" },
  { pattern: /mischpult|mixer\b|console de mixage/i, kind: "mixer" },
  { pattern: /\bmikrofon\b|microphone\b|micro\b/i, kind: "microphone" },

  // gaming / VR
  { pattern: /spielkonsole|game console|console de jeu|playstation|xbox|nintendo switch|spiele-konsolen/i, kind: "console" },
  { pattern: /controller|gamepad|manette|joystick|joy-con|dualsense|dualshock|spielsteuerung/i, kind: "controller" },
  { pattern: /vr brille|vr headset|casque vr|virtual reality|flightsim|simgaming|simracing/i, kind: "vr_headset" },

  // smart home / power / EV
  { pattern: /smart home|domotique|home automation|smart hub|hub intelligent|aqara|shelly|wiser|eve systems|connected light/i, kind: "smart_home" },
  { pattern: /magsafe|wireless charger|chargeur sans fil|ladegerät|charger|charging station|usb charger|fahrrad ladeger|wallbox|ladestation|elektroauto lad/i, kind: "charger" },
  { pattern: /elektroauto ladestation|wallbox|ev charger/i, kind: "ev_charger" },
  { pattern: /elektroauto ladekabel|ev cable|ladestecker|type.?2/i, kind: "ev_cable" },
  { pattern: /e-scooter|elektroroller|escooter/i, kind: "escooter" },
  { pattern: /elektromobilit|e-mobility|emobility/i, kind: "ev_charger" },

  // lighting (primary rules live above active semiconductors — keep late fallbacks)
  { pattern: /leuchtmittel|sockel e\d|sockel gu/i, kind: "light_bulb" },
  { pattern: /stehlampe|tischlampe|deckenleuchte|wandleuchte/i, kind: "home_lamp" },
  { pattern: /gartenleuchte|aussenleuchte|solarleuchte|outdoor.?light/i, kind: "home_lamp" },

  // cleaning / appliances
  { pattern: /saugroboter|wischroboter|staubsaugrobot|robot vacuum/i, kind: "robot_vacuum" },
  { pattern: /staubsauger|vacuum/i, kind: "vacuum" },

  // security / electrical install
  { pattern: /alarmanlage|alarmmelder|alarmsensor|einbruch|intrusion/i, kind: "alarm_system" },
  { pattern: /bewegungsmelder|motion sensor|motion detector/i, kind: "motion_sensor" },
  { pattern: /rauchmelder|smoke detector/i, kind: "alarm_system" },
  { pattern: /fi-schutz|rcd\b|afdd|schutzschalter/i, kind: "electrical_installation" },
  { pattern: /unterputz|aufputz|schalterprogramm|steckdose|abzweigdose|verteilerdose/i, kind: "electrical_installation" },

  // bike / outdoor mobility
  { pattern: /fahrrad|velo\b|bike\b|ebike|e-bike/i, kind: "bike_accessory" },
  { pattern: /fahrrad-computer|velocomputer|bike computer/i, kind: "bike_computer" },

  // health (non-skip)
  { pattern: /blutdruck|blood pressure/i, kind: "health_bp" },
  { pattern: /thermometer|fiebertherm/i, kind: "health_thermometer" },

  // office supplies → sticker/labels
  { pattern: /etikett|label\b|sticker|beschrift/i, kind: "sticker" },

  // generic IT fallbacks (after specific rules)
  { pattern: /netzwerk|network|réseau|reseau|lan\b|wlan\b|wifi\b/i, kind: "network_cable" },
  { pattern: /pc komponent|pc component|composant pc|computer component/i, kind: "pc_motherboard" },
  { pattern: /elektronikwerkzeug|electronic tool|outil électronique/i, kind: "electronic_tool" },
  { pattern: /kabel|câble|cable\b|wire\b|fil\b|leitung/i, kind: "power_cable" },
  { pattern: /elektronik|electronic|électronique|electronique|composant|component|bauelement|elektrotechnik|robotik|robotique/i, kind: "passive_component" },
  { pattern: /messtechnik|measurement|test equipment|instrument/i, kind: "multimeter" },
  { pattern: /werkzeug|tool|outil|outillage/i, kind: "electronic_tool" },
];

function normalizeReicheltText(values: Array<string | null | undefined>): string {
  return values
    .flatMap((v) => String(v ?? "").split(">"))
    .map((part) => part.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

function isReicheltSkipped(text: string): boolean {
  return REICHELT_SKIP_PATTERNS.some((pattern) => pattern.test(text));
}

/** Returns null when the product should not be ingested (no Galaxus mapping). */
export function classifyReicheltGalaxusKind(input: ReicheltClassifyInput): GalaxusProductKind | null {
  const text = normalizeReicheltText([
    ...(input.breadcrumbs ?? []),
    input.supplierProductType,
    input.title,
  ]);
  if (!text) return null;
  if (isReicheltSkipped(text)) return null;
  for (const rule of REI_LABEL_TO_KIND) {
    if (rule.pattern.test(text)) return rule.kind;
  }
  return null;
}

export function reicheltCategoryPathLabel(breadcrumbs: string[]): string | null {
  const trimmed = breadcrumbs
    .map((b) => b.trim())
    .filter((b) => b && !/veuillez vous connecter|bitte loggen|taille d['’]origine|avec\s+[\d.,]+\s*%\s*tva|ex stock|délai de livraison/i.test(b));
  if (!trimmed.length) return null;
  return trimmed[trimmed.length - 1] ?? null;
}
