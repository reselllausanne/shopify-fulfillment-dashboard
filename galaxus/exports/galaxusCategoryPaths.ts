/**
 * Galaxus product kind → German merchant category path.
 * Paths sourced from Producttypes.xlsx (Partner Portal export).
 */
export type GalaxusProductKind =
  | "sneakers"
  | "slippers"
  | "boots"
  | "halbschuhe"
  | "hiking_boots"
  | "sandals"
  | "flip_flops"
  | "shorts"
  | "apparel"
  | "light_jacket"
  | "phone"
  | "backpack"
  | "bag"
  | "duffel"
  | "waist_bag"
  | "pool_robot"
  | "camera"
  | "tumbler"
  | "watch"
  | "lego"
  | "tradingcard"
  | "boardgame"
  | "cardgame"
  | "rpg"
  | "miniature"
  | "game_accessory"
  | "dice"
  | "playmat"
  | "puzzle"
  | "cap"
  | "hat"
  | "beanie"
  | "headband"
  | "socks"
  | "sport_socks"
  | "trousers"
  | "underwear"
  | "sticker"
  | "skateboard"
  | "charger"
  | "headphone"
  | "console"
  | "controller"
  | "coin"
  | "ski"
  | "langlauf_ski"
  | "ski_boots"
  | "langlauf_boots"
  | "ski_poles"
  | "hiking_poles"
  | "ski_binding"
  | "ski_goggles"
  | "ski_helmet"
  | "ski_jacket"
  | "langlauf_jacket"
  | "ski_pants"
  | "langlauf_pants"
  | "ski_gloves"
  | "snowboard"
  | "snowboard_boots"
  | "snowboard_binding"
  | "sunglasses"
  | "running_shoes"
  | "trail_shoes"
  | "climbing_shoes"
  | "outdoor_jacket"
  | "rain_jacket"
  | "winter_jacket"
  | "running_jacket"
  | "bike_jacket"
  | "outdoor_pants"
  | "bike_pants"
  | "outdoor_shirt"
  | "functional_shirt"
  | "pullover"
  | "tshirt"
  | "hemd"
  | "vest"
  | "base_layer_top"
  | "base_layer_bottom"
  | "gaiters"
  | "sport_bra"
  | "ski_mask"
  | "ski_wax"
  | "ski_tools"
  | "dev_board"
  | "passive_component"
  | "active_component"
  | "electronic_enclosure"
  | "soldering_tool"
  | "multimeter"
  | "electronic_tool"
  | "pc_ssd"
  | "pc_hdd"
  | "pc_ram"
  | "pc_cpu"
  | "pc_gpu"
  | "pc_motherboard"
  | "pc_psu"
  | "pc_case"
  | "pc_fan"
  | "pc_cooler"
  | "network_cable"
  | "network_switch"
  | "network_router"
  | "network_nas"
  | "notebook"
  | "server"
  | "keyboard"
  | "mouse"
  | "monitor"
  | "printer"
  | "scanner"
  | "power_cable"
  | "usb_cable"
  | "audio_cable"
  | "video_cable"
  | "smart_home"
  | "webcam"
  | "speaker"
  | "storage_usb"
  | "storage_card"
  | "cable_accessory"
  | "power_strip"
  | "connector"
  | "electrical_installation"
  | "kvm_switch"
  | "graphics_tablet"
  | "microphone"
  | "mixer"
  | "vr_headset"
  | "printer_3d"
  | "toner"
  | "soundbar"
  | "smartphone"
  | "tablet"
  | "ereader"
  | "smartwatch"
  | "smartwatch_accessory"
  | "activity_tracker"
  | "smartphone_battery"
  | "power_bank"
  | "ups"
  | "ups_accessory"
  | "server_accessory"
  | "server_rack"
  | "rc_battery"
  | "rc_charger"
  | "solar_panel"
  | "solar_accessory"
  | "tv"
  | "tv_accessory"
  | "beamer"
  | "beamer_accessory"
  | "av_receiver"
  | "bluray_player"
  | "tv_receiver"
  | "pc_watercooling"
  | "pc_barebone"
  | "pc_hdd_enclosure"
  | "gaming_chair"
  | "gaming_desk"
  | "camping_stove"
  | "camping_cookware"
  | "camping_gas"
  | "camping_mat"
  | "camping_cooler"
  | "camping_cooler_acc"
  | "camping_sleeping_bag"
  | "camping_sleeping_bag_acc"
  | "camping_tent"
  | "camping_tent_acc"
  | "camping_furniture"
  | "power_router"
  | "power_lathe"
  | "power_planer"
  | "power_engraver"
  | "label_printer"
  | "label_tape"
  | "label_device"
  | "shredder"
  | "ev_charger"
  | "ev_cable"
  | "escooter"
  | "dashcam"
  | "camera_tripod"
  | "camera_lens"
  | "drone"
  | "robot_vacuum"
  | "vacuum"
  | "headlamp"
  | "camping_lamp"
  | "home_lamp"
  | "flashlight"
  | "light_bulb"
  | "wifi_repeater"
  | "powerline_adapter"
  | "nas_accessory"
  | "ink_cartridge"
  | "filament_3d"
  | "hand_screwdriver"
  | "pliers"
  | "wrench_set"
  | "alarm_system"
  | "motion_sensor"
  | "bike_accessory"
  | "bike_computer"
  | "health_thermometer"
  | "health_bp"
  | "car_hifi"
  | "car_subwoofer"
  | "turntable"
  | "amplifier_hifi"
  | "endoscope"
  | "energy_meter"
  | "oscilloscope"
  | "lab_power_supply"
  | "desktop_pc"
  | "robot_kit"
  | "robot_module"
  | "robot_accessory"
  /** Manufactum / XNT home + fashion accessories (partner category hints; Galaxus AI remaps). */
  | "belt"
  | "gloves"
  | "scarf"
  | "dress"
  | "drinking_glass"
  | "mug"
  | "plate"
  | "bowl"
  | "cutlery"
  | "cookware"
  | "kitchen_tool"
  | "bedding"
  | "towel"
  | "book"
  | "home_accessory"
  | "unknown";

/** German Galaxus merchant `ProductCategory` paths (Producttypes.xlsx). */
export const GALAXUS_CATEGORY_PATHS: Record<GalaxusProductKind, string> = {
  sneakers: "Mode > Alles in Mode > Schuhe > Sneakers",
  slippers: "Mode > Alles in Mode > Schuhe > Hausschuhe",
  boots: "Mode > Alles in Mode > Schuhe > Boots + Stiefel",
  halbschuhe: "Mode > Alles in Mode > Schuhe > Halbschuhe",
  hiking_boots: "Sport > Outdoor > Wandern > Wanderschuhe",
  sandals: "Mode > Alles in Mode > Schuhe > Sandalen",
  flip_flops: "Mode > Alles in Mode > Schuhe > Flip-Flops",
  shorts: "Mode > Alles in Mode > Bekleidung > Shorts",
  // "Bekleidung" alone is a branch, not a Producttypes leaf — Galaxus cannot assign a
  // product type to it (Step 3). Shirts (2430) is the safest leaf for generic tops.
  apparel: "Mode > Alles in Mode > Bekleidung > Shirts",
  light_jacket: "Mode > Alles in Mode > Bekleidung > Jacken > Leichte Jacken",
  backpack: "Sport > Taschen + Gepäck > Rucksack",
  bag: "Sport > Taschen + Gepäck > Tasche",
  duffel: "Sport > Taschen + Gepäck > Tasche",
  waist_bag: "Sport > Taschen + Gepäck > Bauchtasche",
  phone: "IT + Multimedia > Smartphones + Tablets > Smartphone Zubehör > Weiteres Smartphone Zubehör",
  pool_robot: "Do it + Garden > Pool + Spa > Pool > Poolroboter",
  camera: "IT + Multimedia > Foto + Video > Kameras",
  tumbler: "Sport + Toys > Wasserflaschen + Thermosflaschen",
  watch: "Mode > Alles in Mode > Uhren",
  lego: "Sport + Toys > LEGO",
  tradingcard: "Sport + Toys > Sammelkarten",
  boardgame: "Sport + Toys > Brettspiele",
  cardgame: "Sport + Toys > Kartenspiele",
  rpg: "Sport + Toys > Rollenspiele",
  miniature: "Sport + Toys > Tabletop",
  game_accessory: "Sport + Toys > Spielzubehör",
  dice: "Sport + Toys > Würfel",
  playmat: "Sport + Toys > Spielzubehör",
  puzzle: "Sport + Toys > Puzzle",
  cap: "Mode > Alles in Mode > Accessoires > Hüte + Caps > Cap",
  hat: "Mode > Alles in Mode > Accessoires > Hüte + Caps > Hut",
  beanie: "Mode > Alles in Mode > Accessoires > Hüte + Caps > Mütze",
  headband: "Mode > Alles in Mode > Accessoires > Hüte + Caps > Stirnband",
  socks: "Mode > Alles in Mode > Wäsche > Socken",
  sport_socks: "Sport > Fitness > Fitnessbekleidung > Sportsocken",
  trousers: "Mode > Alles in Mode > Bekleidung > Hosen",
  underwear: "Mode > Alles in Mode > Wäsche > Unterhosen",
  sticker: "Office + Gaming > Bürobedarf + Schule > Etiketten + Aufkleber",
  skateboard: "Sport + Toys > Skateboarding > Decks",
  charger: "IT + Multimedia > Zubehör > Ladegeräte",
  headphone: "IT + Multimedia > Audio > Kopfhörer",
  console: "IT + Multimedia > Gaming > Konsolen",
  controller: "IT + Multimedia > Gaming > Zubehör > Controller",
  coin: "Sammeln + Antiquitäten > Münzen",
  ski: "Sport > Wintersport > Skifahren + Langlauf > Ski",
  langlauf_ski: "Sport > Wintersport > Skifahren + Langlauf > Langlaufski",
  ski_boots: "Sport > Wintersport > Skifahren + Langlauf > Skischuhe",
  langlauf_boots: "Sport > Wintersport > Skifahren + Langlauf > Langlaufschuhe",
  ski_poles: "Sport > Wintersport > Skifahren + Langlauf > Skistöcke",
  hiking_poles: "Sport > Outdoor > Wandern > Wanderstöcke",
  ski_binding: "Sport > Wintersport > Skifahren + Langlauf > Skibindung",
  ski_goggles: "Sport > Wintersport > Wintersport Schutzausrüstung > Skibrille",
  ski_helmet: "Sport > Wintersport > Wintersport Schutzausrüstung > Skihelm",
  ski_jacket: "Sport > Wintersport > Wintersportbekleidung > Skijacke",
  langlauf_jacket: "Sport > Wintersport > Wintersportbekleidung > Langlaufjacke",
  ski_pants: "Sport > Wintersport > Wintersportbekleidung > Skihosen",
  langlauf_pants: "Sport > Wintersport > Wintersportbekleidung > Langlaufhose",
  ski_gloves: "Sport > Wintersport > Wintersportbekleidung > Skihosen",
  snowboard: "Sport > Wintersport > Snowboarden > Snowboard",
  snowboard_boots: "Sport > Wintersport > Snowboarden > Snowboardschuhe",
  snowboard_binding: "Sport > Wintersport > Snowboarden > Snowboardbindung",
  sunglasses: "Mode > Alles in Mode > Accessoires > Sonnenbrille",
  running_shoes: "Sport > Running > Laufschuhe",
  trail_shoes: "Sport > Running > Laufschuhe",
  climbing_shoes: "Sport > Outdoor > Outdoorschuhe > Kletterschuhe",
  outdoor_jacket: "Sport > Outdoor > Outdoorbekleidung > Outdoorjacken",
  rain_jacket: "Mode > Alles in Mode > Bekleidung > Jacken > Regenjacken",
  winter_jacket: "Mode > Alles in Mode > Bekleidung > Jacken > Winterjacken",
  running_jacket: "Sport > Running > Runningbekleidung > Laufjacke",
  bike_jacket: "Sport > Bike > Velobekleidung > Velojacke",
  outdoor_pants: "Sport > Outdoor > Outdoorbekleidung > Outdoorhose",
  bike_pants: "Sport > Bike > Velobekleidung > Velohosen",
  outdoor_shirt: "Sport > Outdoor > Outdoorbekleidung > Sportshirt",
  functional_shirt: "Sport > Outdoor > Outdoorbekleidung > Funktionsshirt",
  pullover: "Mode > Alles in Mode > Bekleidung > Pullover",
  tshirt: "Mode > Alles in Mode > Bekleidung > Shirts",
  hemd: "Mode > Alles in Mode > Bekleidung > Hemden",
  vest: "Mode > Alles in Mode > Bekleidung > Jacken > Westen",
  base_layer_top: "Sport > Outdoor > Outdoorbekleidung > Funktionsshirt",
  base_layer_bottom: "Sport > Outdoor > Outdoorbekleidung > Funktionsunterhose",
  gaiters: "Sport > Outdoor > Outdoorbekleidung > Gamaschen",
  sport_bra: "Sport > Fitness > Yoga + Pilates > Sport-BH",
  ski_mask: "Sport > Wintersport > Wintersport Schutzausrüstung > Sturmhaube + Halsschlauch",
  ski_wax: "Sport > Wintersport > Skifahren + Langlauf > Skiwachs",
  ski_tools: "Sport > Wintersport > Skifahren + Langlauf > Skiwerkzeug",
  dev_board: "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Entwicklungsboard + Kit",
  passive_component:
    "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Elektrische Bauelemente > Passive Bauelemente > Widerstand",
  active_component:
    "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Elektrische Bauelemente > Aktive Bauelemente > Transistor",
  electronic_enclosure:
    "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Elektronik > Elektronikzubehör + Gehäuse",
  soldering_tool: "Baumarkt + Garten > Elektrobedarf > Elektroinstallation > Elektronikwerkzeug > Lötgerät",
  multimeter: "Baumarkt + Garten > Elektrobedarf > Elektroinstallation > Elektronikwerkzeug > Multimeter",
  electronic_tool:
    "Baumarkt + Garten > Elektrobedarf > Elektroinstallation > Elektronikwerkzeug > Bolzenschneider + Seitenschneider",
  pc_ssd: "IT + Multimedia > PC Komponenten > Speicher > SSD",
  pc_hdd: "IT + Multimedia > PC Komponenten > Speicher > Festplatte",
  pc_ram: "IT + Multimedia > PC Komponenten > RAM",
  pc_cpu: "IT + Multimedia > PC Komponenten > Prozessor",
  pc_gpu: "IT + Multimedia > PC Komponenten > Grafikkarte",
  pc_motherboard: "IT + Multimedia > PC Komponenten > Mainboard",
  pc_psu: "IT + Multimedia > PC Komponenten > PC Netzteil",
  pc_case: "IT + Multimedia > PC Komponenten > Gehäuse > PC Gehäuse",
  pc_fan: "IT + Multimedia > PC Komponenten > Luftkühlung > PC Lüfter",
  pc_cooler: "IT + Multimedia > PC Komponenten > Luftkühlung > CPU Kühler",
  network_cable: "IT + Multimedia > Netzwerk > Netzwerkkabel",
  network_switch: "IT + Multimedia > Netzwerk > Bridges + Router > Netzwerk Switch",
  network_router: "IT + Multimedia > Netzwerk > Bridges + Router > Router",
  network_nas: "IT + Multimedia > Netzwerk > Netzwerkspeicher > NAS",
  notebook: "IT + Multimedia > Notebooks + PCs > Notebook",
  server: "IT + Multimedia > Netzwerk > Server + Zubehör > Server",
  keyboard: "IT + Multimedia > Peripherie > Mäuse + Tastaturen > Tastatur",
  mouse: "IT + Multimedia > Peripherie > Mäuse + Tastaturen > Maus",
  monitor: "IT + Multimedia > Peripherie > Monitore > Monitor",
  printer: "IT + Multimedia > Peripherie > Drucker + Scanner > Drucken > Drucker",
  scanner: "IT + Multimedia > Peripherie > Drucker + Scanner > Scannen > Scanner",
  power_cable: "IT + Multimedia > Peripherie > Kabel > Stromkabel",
  usb_cable: "IT + Multimedia > Peripherie > Stromversorgung > Ladegeräte > USB Kabel",
  audio_cable: "IT + Multimedia > Peripherie > Kabel > Audio Kabel",
  video_cable: "IT + Multimedia > Peripherie > Kabel > Videokabel",
  smart_home: "IT + Multimedia > Smart Home > Smart Home Hub",
  webcam: "IT + Multimedia > Gaming + VR > Streaming > Sound + Video > Webcam",
  speaker: "IT + Multimedia > Audio > Lautsprecher > Bluetooth Lautsprecher",
  storage_usb: "IT + Multimedia > Peripherie > Speicher > USB Stick",
  storage_card: "IT + Multimedia > Peripherie > Speicher > Speicherkarte",
  cable_accessory: "Baumarkt + Garten > Elektrobedarf > Elektroinstallation > Kabelbinder",
  power_strip: "Baumarkt + Garten > Elektrobedarf > Stromverteilung > Steckdosenleiste",
  connector: "Baumarkt + Garten > Elektrobedarf > Elektroinstallation > Netzstecker + Netzkupplung",
  electrical_installation: "Baumarkt + Garten > Elektrobedarf > Elektroinstallation > Kabelverbindung",
  kvm_switch: "IT + Multimedia > Peripherie > Hubs + Switches > KVM Switch",
  graphics_tablet: "IT + Multimedia > Peripherie > Grafiktablett",
  microphone: "IT + Multimedia > Gaming + VR > Streaming > Sound + Video > Mikrofon",
  mixer: "IT + Multimedia > Audio > Mischpult",
  vr_headset: "IT + Multimedia > Gaming + VR > AR + VR > VR Brille",
  printer_3d: "IT + Multimedia > Peripherie > Drucker + Scanner > Drucken > 3D > 3D Drucker",
  toner: "IT + Multimedia > Peripherie > Drucker + Scanner > Drucken > Toner",
  soundbar: "IT + Multimedia > TV + Heimkino > Heimkino Sound > Soundbar",
  smartphone: "IT + Multimedia > Smartphones + Tablets > Smartphone",
  tablet: "IT + Multimedia > Smartphones + Tablets > Tablet + eReader > Tablet",
  ereader: "IT + Multimedia > Smartphones + Tablets > Tablet + eReader > eReader",
  smartwatch: "IT + Multimedia > Wearables > Smartwatch",
  smartwatch_accessory: "IT + Multimedia > Wearables > Smartwatch Zubehör",
  activity_tracker:
    "IT + Multimedia > Smartphones + Tablets > Smartphone Zubehör > Smartphone Tags > Tracker",
  smartphone_battery:
    "IT + Multimedia > Smartphones + Tablets > Smartphone Zubehör > Smartphone Reparatur > Smartphone Akku",
  power_bank: "IT + Multimedia > Peripherie > Stromversorgung > Powerbank",
  ups: "IT + Multimedia > Netzwerk > Server + Zubehör > USV",
  ups_accessory: "IT + Multimedia > Netzwerk > Server + Zubehör > USV Zubehör",
  server_accessory: "IT + Multimedia > Netzwerk > Server + Zubehör > Server Zubehör",
  server_rack: "IT + Multimedia > Netzwerk > Server + Zubehör > Serverschrank",
  rc_battery: "Spielzeug > Spielfahrzeuge > RC + Modellbau > RC Elektronik > RC Akku",
  rc_charger: "Spielzeug > Spielfahrzeuge > RC + Modellbau > RC Elektronik > RC Ladegerät",
  solar_panel: "Baumarkt + Garten > Elektrobedarf > Stromerzeugung > Solarpanel",
  solar_accessory: "Baumarkt + Garten > Elektrobedarf > Stromerzeugung > Zubehör Solarenergie",
  tv: "IT + Multimedia > TV + Heimkino > TV",
  tv_accessory: "IT + Multimedia > TV + Heimkino > TV Zubehör",
  beamer: "IT + Multimedia > TV + Heimkino > Beamer + Leinwände > Beamer",
  beamer_accessory: "IT + Multimedia > TV + Heimkino > Beamer + Leinwände > Beamer Zubehör",
  av_receiver: "IT + Multimedia > TV + Heimkino > Heimkino Sound > AV Receiver",
  bluray_player: "IT + Multimedia > TV + Heimkino > Bluray Player + DVD Player",
  tv_receiver: "IT + Multimedia > TV + Heimkino > TV Empfangstechnik > TV Receiver",
  pc_watercooling: "IT + Multimedia > PC Komponenten > Wasserkühlung > CPU Wasserkühler",
  pc_barebone: "IT + Multimedia > PC Komponenten > Barebone",
  pc_hdd_enclosure: "IT + Multimedia > PC Komponenten > Gehäuse > Festplattengehäuse",
  gaming_chair: "IT + Multimedia > Gaming + VR > Gaming Möbel > Gaming Stuhl",
  gaming_desk: "IT + Multimedia > Gaming + VR > Gaming Möbel > Gaming Tisch",
  camping_stove: "Sport > Outdoor > Camping > Campingkocher",
  camping_cookware: "Sport > Outdoor > Camping > Campinggeschirr",
  camping_gas: "Sport > Outdoor > Camping > Gaskartusche",
  camping_mat: "Sport > Outdoor > Camping > Isomatte",
  camping_cooler: "Sport > Outdoor > Camping > Kühlbox",
  camping_cooler_acc: "Sport > Outdoor > Camping > Kühlbox Zubehör",
  camping_sleeping_bag: "Sport > Outdoor > Camping > Schlafsack",
  camping_sleeping_bag_acc: "Sport > Outdoor > Camping > Schlafsack Zubehör",
  camping_tent: "Sport > Outdoor > Camping > Zelt",
  camping_tent_acc: "Sport > Outdoor > Camping > Zelt Zubehör",
  camping_furniture: "Sport > Outdoor > Camping > Campingmobiliar > Campingmöbel",
  power_router: "Baumarkt + Garten > Werkzeug + Werkstatt > Elektrowerkzeug > Fräsen + Hobeln > Fräse",
  power_lathe: "Baumarkt + Garten > Werkzeug + Werkstatt > Elektrowerkzeug > Fräsen + Hobeln > Drehmaschine",
  power_planer: "Baumarkt + Garten > Werkzeug + Werkstatt > Elektrowerkzeug > Fräsen + Hobeln > Hobelmaschine",
  power_engraver: "Baumarkt + Garten > Werkzeug + Werkstatt > Elektrowerkzeug > Fräsen + Hobeln > Gravierer",
  label_printer: "IT + Multimedia > Peripherie > Drucker + Scanner > Drucken > Etikettendrucker",
  label_tape: "Büro + Schreibwaren > Bürotechnik > Bürogeräte > Beschriftungsband",
  label_device: "Büro + Schreibwaren > Bürotechnik > Bürogeräte > Beschriftungsgerät",
  shredder: "Büro + Schreibwaren > Bürotechnik > Bürogeräte > Aktenvernichter",
  ev_charger: "Baumarkt + Garten > Fahrzeug > E-Mobilität > Elektroauto Ladestation",
  ev_cable: "Baumarkt + Garten > Fahrzeug > E-Mobilität > Elektroauto Ladekabel",
  escooter: "Sport > E-Mobilität + Rollsport > E-Rideables > E-Scooter",
  dashcam: "IT + Multimedia > Foto + Video > Actioncams + Videokameras > Dashcam",
  camera_tripod: "IT + Multimedia > Foto + Video > Stative + Gimbals > Stativ",
  camera_lens: "IT + Multimedia > Foto + Video > Objektive + Filter > Objektiv",
  drone: "IT + Multimedia > Foto + Video > Drohne > Drohne",
  robot_vacuum: "Haushalt > Reinigungsgeräte > Staubsauger Roboter",
  vacuum: "Haushalt > Reinigungsgeräte > Staubsauger",
  headlamp: "Sport > Outdoor > Lampen + Leuchten > Stirnlampe",
  camping_lamp: "Sport > Outdoor > Lampen + Leuchten > Campinglampe",
  home_lamp: "Wohnen > Lampen + Leuchten > Tischlampe",
  flashlight: "Baumarkt + Garten > Sicherheit > Selbstschutz > Taschenlampe",
  light_bulb: "Wohnen > Lampen + Leuchten > Leuchtmittel",
  wifi_repeater: "IT + Multimedia > Netzwerk > Bridges + Router > WLAN Repeater",
  powerline_adapter: "IT + Multimedia > Netzwerk > Bridges + Router > Powerline",
  nas_accessory: "IT + Multimedia > Netzwerk > Netzwerkspeicher > NAS Zubehör",
  ink_cartridge: "IT + Multimedia > Peripherie > Drucker + Scanner > Drucken > Druckerpatrone",
  filament_3d: "IT + Multimedia > Peripherie > Drucker + Scanner > Drucken > 3D > 3D Filament",
  hand_screwdriver:
    "Baumarkt + Garten > Werkzeug + Werkstatt > Handwerkzeug > Schraubwerkzeuge > Schraubendreher",
  pliers: "Baumarkt + Garten > Elektrobedarf > Elektroinstallation > Elektronikwerkzeug > Zange",
  wrench_set:
    "Baumarkt + Garten > Werkzeug + Werkstatt > Handwerkzeug > Schraubwerkzeuge > Steckschlüssel + Stecknuss",
  alarm_system: "Baumarkt + Garten > Sicherheit > Gebäudesicherheit > Einbruchschutz + Alarmanlage",
  motion_sensor: "Baumarkt + Garten > Sicherheit > Gebäudesicherheit > Bewegungsmelder",
  bike_accessory: "Sport > Bike > Veloausrüstung > Velolicht",
  bike_computer: "Sport > Bike > Heimtraining + Navigation > Velocomputer",
  health_thermometer: "Beauty + Gesundheit > Gesundheit > Gesundheitsmessgeräte > Fieberthermometer",
  health_bp: "Beauty + Gesundheit > Gesundheit > Gesundheitsmessgeräte > Blutdruckmessgerät",
  car_hifi: "Baumarkt + Garten > Fahrzeug > Navigation + Car HiFi > Car HiFi + Installation > Car HiFi Verstärker",
  car_subwoofer:
    "Baumarkt + Garten > Fahrzeug > Navigation + Car HiFi > Car HiFi + Installation > Car HiFi Subwoofer",
  turntable: "IT + Multimedia > Audio > HiFi > Plattenspieler",
  amplifier_hifi: "IT + Multimedia > Audio > HiFi > Stereoverstärker",
  endoscope: "Baumarkt + Garten > Werkzeug + Werkstatt > Messgeräte > Endoskopkamera",
  energy_meter: "Baumarkt + Garten > Elektrobedarf > Steuerungstechnik > Energiemessgerät",
  oscilloscope:
    "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Elektronikwerkzeug > Messtechnik",
  lab_power_supply:
    "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Labornetzgerät",
  desktop_pc: "IT + Multimedia > Notebooks + PCs > PC",
  robot_kit: "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Robotik > Robotik Kit",
  robot_module: "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Robotik > Robotik Modul",
  robot_accessory:
    "IT + Multimedia > Drohnen + Elektronik > Robotik + Elektrotechnik > Robotik > Robotik Zubehör",
  belt: "Mode > Alles in Mode > Accessoires > Gürtel",
  gloves: "Mode > Alles in Mode > Accessoires > Handschuhe",
  scarf: "Mode > Alles in Mode > Accessoires > Schals + Tücher",
  dress: "Mode > Alles in Mode > Bekleidung > Kleider",
  drinking_glass: "Wohnen > Küche + Essen > Geschirr > Gläser",
  mug: "Wohnen > Küche + Essen > Geschirr > Tassen + Becher",
  plate: "Wohnen > Küche + Essen > Geschirr > Teller",
  bowl: "Wohnen > Küche + Essen > Geschirr > Schalen + Schüsseln",
  cutlery: "Wohnen > Küche + Essen > Besteck > Besteck",
  cookware: "Wohnen > Küche + Essen > Töpfe + Pfannen > Töpfe",
  kitchen_tool: "Wohnen > Küche + Essen > Küchenhelfer > Küchenhelfer",
  bedding: "Wohnen > Textilien > Bettwäsche > Bettwäsche",
  towel: "Wohnen > Bad > Handtücher > Handtuch",
  book: "Bücher + Medien > Bücher > Sachbücher",
  home_accessory: "Wohnen > Wohnaccessoires > Dekoration > Dekorationartikel",
  unknown: "Mode > Alles in Mode > Schuhe > Sneakers",
};

/** Default kind when no signal matches — supplier-aware. */
export function defaultGalaxusProductKind(supplierKey?: string | null): GalaxusProductKind {
  if (String(supplierKey ?? "").toLowerCase() === "wel") return "boardgame";
  if (String(supplierKey ?? "").toLowerCase() === "rei") return "passive_component";
  if (String(supplierKey ?? "").toLowerCase() === "xnt") return "home_accessory";
  return "sneakers";
}

export function galaxusCategoryPathForKind(
  kind: GalaxusProductKind,
  supplierKey?: string | null
): string {
  if (kind === "unknown") {
    return GALAXUS_CATEGORY_PATHS[defaultGalaxusProductKind(supplierKey)];
  }
  return GALAXUS_CATEGORY_PATHS[kind] ?? GALAXUS_CATEGORY_PATHS.unknown;
}
