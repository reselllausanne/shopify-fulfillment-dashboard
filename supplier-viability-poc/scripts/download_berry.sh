#!/bin/bash
set +e
UA='SupplierViabilityPOC/1.0'
OUT='/Users/resell-lausanne/Projects/shopify-fulfillment-dashboard/supplier-viability-poc/_raw/berry/products'
mkdir -p "$OUT"
n=0
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0000.html" -w "0 %{http_code}\n" 'https://www.berrybase.de/120-teiliges-messing-abstandshalter-sortiment-in-kunststoffbox-groesse-m2-5'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0001.html" -w "1 %{http_code}\n" 'https://www.berrybase.de/arduino-uno-q-quad-core-2-ghz-mpu-160-mhz-mcu-4gb-ram-32gb-emmc-5v-3a'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0002.html" -w "2 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-220-f-16v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0003.html" -w "3 %{http_code}\n" 'https://www.berrybase.de/adafruit-vibrierende-mini-motorscheibe'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0004.html" -w "4 %{http_code}\n" 'https://www.berrybase.de/adressierbare-ws2812-rgb-led-pth-8mm-diffus-5er-pack'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0005.html" -w "5 %{http_code}\n" 'https://www.berrybase.de/einfacher-wasserdetektionssensor-mit-digitalausgang'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0006.html" -w "6 %{http_code}\n" 'https://www.berrybase.de/achtlingslitze-isoliert-8x0-14mm-5m-farbe-rot-blau-grau-schwarz-gelb-gruen-braun-weiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0007.html" -w "7 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-330-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0008.html" -w "8 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-82-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0009.html" -w "9 %{http_code}\n" 'https://www.berrybase.de/8bitdo-arcade-stick-xbox-lizensiert-pc-2.4g-usb-programmierbar-17-tasten-1000-mah-weiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0010.html" -w "10 %{http_code}\n" 'https://www.berrybase.de/optosupply-round-super-led-5mm-gruen'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0011.html" -w "11 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-75-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0012.html" -w "12 %{http_code}\n" 'https://www.berrybase.de/schraube-kopf-zylinder-m2-5x5'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0013.html" -w "13 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-10-f-63v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0014.html" -w "14 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-47nf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0015.html" -w "15 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-4-7-kohm-0-6w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0016.html" -w "16 %{http_code}\n" 'https://www.berrybase.de/8bitdo-retro-r8-mouse-c64-edition-paw3395-bluetooth-5-3-2-4g-usb-bis-26000-dpi-bis-8000hz'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0017.html" -w "17 %{http_code}\n" 'https://www.berrybase.de/dc-kupplung-fuer-hohlstecker-5-5x2-1mm-schraubmontage-terminal-block-2-pin'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0018.html" -w "18 %{http_code}\n" 'https://www.berrybase.de/clip-fuer-5mm-led-einteilig-schwarz'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0019.html" -w "19 %{http_code}\n" 'https://www.berrybase.de/8bitdo-retro-receiver-fuer-n64-bluetooth-le-controller-adapter-kompatibel-mit-n64-switch-xbox'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0020.html" -w "20 %{http_code}\n" 'https://www.berrybase.de/8bitdo-64-2-4g-wireless-controller-classic-grey-hall-effect-turbofunktion-usb-n64-design'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0021.html" -w "21 %{http_code}\n" 'https://www.berrybase.de/smd-breakout-adapter-fuer-sop16-ssop16-tssop16-16-pin-0-65mm-1-27mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0022.html" -w "22 %{http_code}\n" 'https://www.berrybase.de/breadboard-potentiometer-10k-ohm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0023.html" -w "23 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-1000-f-16v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0024.html" -w "24 %{http_code}\n" 'https://www.berrybase.de/arduino-portenta-hat-carrier-raspberry-pi-hat-kompatibel-can-usb-ethernet-jtag-16-analoge-i-os'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0025.html" -w "25 %{http_code}\n" 'https://www.berrybase.de/arduino-nano-33-iot-ohne-header'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0026.html" -w "26 %{http_code}\n" 'https://www.berrybase.de/dupont-crimpkontakt-fuer-kabel-awg-22-28-male'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0027.html" -w "27 %{http_code}\n" 'https://www.berrybase.de/arduino-nano-33-iot-mit-headern'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0028.html" -w "28 %{http_code}\n" 'https://www.berrybase.de/8bitdo-ultimate-2-wireless-controller-hall-effekt-tmr-sticks-fire-ring-2-4g-bluetooth-usb-c'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0029.html" -w "29 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-1000-f-25v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0030.html" -w "30 %{http_code}\n" 'https://www.berrybase.de/drehregler-rotary-encoder-mit-breakoutboard'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0031.html" -w "31 %{http_code}\n" 'https://www.berrybase.de/arduino-uno-wifi-rev.2'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0032.html" -w "32 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-pico-rp2040-mikrocontroller-board'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0033.html" -w "33 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-12-0-hm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0034.html" -w "34 %{http_code}\n" 'https://www.berrybase.de/525-teiliges-metallschichtwiderstands-sortiment-in-kunststoffbox'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0035.html" -w "35 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-10-0-kohm-0-6w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0036.html" -w "36 %{http_code}\n" 'https://www.berrybase.de/waveshare-solar-power-manager-modul-d-5v-3a-ausgang-mppt-usb-type-c-fuer-6v-24v-solarpanels'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0037.html" -w "37 %{http_code}\n" 'https://www.berrybase.de/offizielles-raspberry-pi-usb-c-netzteil-5-1v-3-0a-eu-weiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0038.html" -w "38 %{http_code}\n" 'https://www.berrybase.de/adafruit-mcp23017-i2c-gpio-expander-breakout'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0039.html" -w "39 %{http_code}\n" 'https://www.berrybase.de/adafruit-qt-py-rp2040'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0040.html" -w "40 %{http_code}\n" 'https://www.berrybase.de/arduino-uno-rev3'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0041.html" -w "41 %{http_code}\n" 'https://www.berrybase.de/10-segment-led-bargraph-anzeige-10-balken-1x-rot-3x-gelb-4x-gruen-1x-blau'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0042.html" -w "42 %{http_code}\n" 'https://www.berrybase.de/crimpkontakt-fuer-steckverbinder-smrk-..-maennlich-awg-22-26'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0043.html" -w "43 %{http_code}\n" 'https://www.berrybase.de/zwillingslitze-isoliert-2x0-14mm-5m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0044.html" -w "44 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-220-f-63v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0045.html" -w "45 %{http_code}\n" 'https://www.berrybase.de/8bitdo-wireless-bluetooth-usb-adapter-2-kompatibel-mit-windows-macos-steam-switch-raspberry-pi'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0046.html" -w "46 %{http_code}\n" 'https://www.berrybase.de/sandisk-ultra-microsdhc-a1-120mb-s-class-10-speicherkarte-adapter-32gb'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0047.html" -w "47 %{http_code}\n" 'https://www.berrybase.de/solarzelle-5v-150ma-60x90mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0048.html" -w "48 %{http_code}\n" 'https://www.berrybase.de/tcrt5000-infrarot-sensor-lichtschranke'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0049.html" -w "49 %{http_code}\n" 'https://www.berrybase.de/8bitdo-ultimate-2c-bluetooth-controller-switch-kompatibel-hall-effekt-joysticks-6-achsen-blau'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0050.html" -w "50 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-100-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0051.html" -w "51 %{http_code}\n" 'https://www.berrybase.de/kingbright-low-current-led-5mm-rot'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0052.html" -w "52 %{http_code}\n" 'https://www.berrybase.de/m5stack-servo-kit-3600'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0053.html" -w "53 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-10-f-50v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0054.html" -w "54 %{http_code}\n" 'https://www.berrybase.de/8bitdo-pro-2-gamepad-hall-effekt-technologie-bluetooth-usb-c-programmierbar-1000-mah-grau'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0055.html" -w "55 %{http_code}\n" 'https://www.berrybase.de/8bitdo-all-button-arcade-controller-fuer-xbox-series-x-s-xbox-one-pc-2.4g-wireless'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0056.html" -w "56 %{http_code}\n" 'https://www.berrybase.de/armor-gehaeuse-fuer-raspberry-pi-5-schwarz'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0057.html" -w "57 %{http_code}\n" 'https://www.berrybase.de/ttp223-kapazitiver-touch-sensor-taster'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0058.html" -w "58 %{http_code}\n" 'https://www.berrybase.de/berrys-lohnen-sich'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0059.html" -w "59 %{http_code}\n" 'https://www.berrybase.de/40pin-jumper-dupont-kabel-male-male-trennbar'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0060.html" -w "60 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-47-f-50v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0061.html" -w "61 %{http_code}\n" 'https://www.berrybase.de/stp16nf06-n-kanal-mosfet-transistor-60v-16a-to-220-3-pin'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0062.html" -w "62 %{http_code}\n" 'https://www.berrybase.de/vibration-motor'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0063.html" -w "63 %{http_code}\n" 'https://www.berrybase.de/sandisk-extreme-microsdxc-a2-uhs-i-u3-v30-170mb-s-speicherkarte-adapter-64gb'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0064.html" -w "64 %{http_code}\n" 'https://www.berrybase.de/8bitdo-pro-2-gamepad-hall-effekt-technologie-bluetooth-usb-c-programmierbar-1000-mah-classic'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0065.html" -w "65 %{http_code}\n" 'https://www.berrybase.de/8bitdo-sn30-pro-usb-gamepad-g-classic-edition'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0066.html" -w "66 %{http_code}\n" 'https://www.berrybase.de/neopixel-reverse-mount-rgb-leds-sk6812-e-10er-pack'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0067.html" -w "67 %{http_code}\n" 'https://www.berrybase.de/waveshare-metall-serienbus-servo-st3025-40kg.cm-drehmoment-3600-magnetencoder-buerstenlos-12v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0068.html" -w "68 %{http_code}\n" 'https://www.berrybase.de/adafruit-usb-type-c-breakout-board-downstream-verbindung'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0069.html" -w "69 %{http_code}\n" 'https://www.berrybase.de/wago-221-2411-durchgangsverbinder-klemme-mit-hebel'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0070.html" -w "70 %{http_code}\n" 'https://www.berrybase.de/adafruit-tauchbare-3v-dc-wasserpumpe-vertikal'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0071.html" -w "71 %{http_code}\n" 'https://www.berrybase.de/arduino-due-a000056-at91sam3x8e-micro-usb-mit-header-3-3v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0072.html" -w "72 %{http_code}\n" 'https://www.berrybase.de/usb-c-verbindungskabel-tb5-pro-thunderbolt-5-80gbit-s-240w-dp2.1-pcie-4.0-video-bis-16k'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0073.html" -w "73 %{http_code}\n" 'https://www.berrybase.de/berrybase-rf-300c-11440-dc-rundspindelmotor-6200-u-min-23-g.cm-1-6v-0-025-0-33a'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0074.html" -w "74 %{http_code}\n" 'https://www.berrybase.de/sg92r-micro-servo'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0075.html" -w "75 %{http_code}\n" 'https://www.berrybase.de/optosupply-led-5mm-kerzenscheinimitierend-4500-5800mcd-300-klar-rot'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0076.html" -w "76 %{http_code}\n" 'https://www.berrybase.de/anschlussklemme-schraubbar-900-gewinkelt-1-25mm2-rm-5-08mm-2-polig'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0077.html" -w "77 %{http_code}\n" 'https://www.berrybase.de/waveshare-140-dc-kupferbuerstenmotor-drehzahl-17000-36000rmin-koerperlaenge-25mm-3-6v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0078.html" -w "78 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-470-f-25v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0079.html" -w "79 %{http_code}\n" 'https://www.berrybase.de/rgb-led-mit-automatischem-farbwechsel-5mm-klar-33-sekunden'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0080.html" -w "80 %{http_code}\n" 'https://www.berrybase.de/vierlingslitze-isoliert-4x0-25mm-fuer-rgb-led-stripes-5m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0081.html" -w "81 %{http_code}\n" 'https://www.berrybase.de/offizielles-gehaeuse-fuer-raspberry-pi-5-rot-weiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0082.html" -w "82 %{http_code}\n" 'https://www.berrybase.de/stiftleisten-kit-fuer-feather-12-und-16-polige-buchsenleisten'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0083.html" -w "83 %{http_code}\n" 'https://www.berrybase.de/arduino-nicla-voice'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0084.html" -w "84 %{http_code}\n" 'https://www.berrybase.de/ic-sockel-8-polig-rm-2-54mm-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0085.html" -w "85 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-100nf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0086.html" -w "86 %{http_code}\n" 'https://www.berrybase.de/adafruit-vl53l4cd-time-of-flight-distanz-sensor-1-1300mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0087.html" -w "87 %{http_code}\n" 'https://www.berrybase.de/arduino-edge-control-steuermodul-fuer-aussenbereich-bluetooth-sensoranschluesse-64mhz-1mb-12v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0088.html" -w "88 %{http_code}\n" 'https://www.berrybase.de/es'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0089.html" -w "89 %{http_code}\n" 'https://www.berrybase.de/offizielles-raspberry-pi-micro-usb-netzteil-5-1v-2-5a-eu-weiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0090.html" -w "90 %{http_code}\n" 'https://www.berrybase.de/1n4148-schaltdiode-tht-100v-300ma-do35'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0091.html" -w "91 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-4-7nf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0092.html" -w "92 %{http_code}\n" 'https://www.berrybase.de/sn74ahct125n-quad-level-shifter-dil-14'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0093.html" -w "93 %{http_code}\n" 'https://www.berrybase.de/trimmpotentiometer-kit-100r-1m-65-stueck'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0094.html" -w "94 %{http_code}\n" 'https://www.berrybase.de/tip107-pnp-darlington-transistor-100v-15a-to220ab'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0095.html" -w "95 %{http_code}\n" 'https://www.berrybase.de/kupferlackdraht-oe0-10mm-set-7x10m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0096.html" -w "96 %{http_code}\n" 'https://www.berrybase.de/smd-breakout-adapter-fuer-sop8-ssop8-tssop8-8-pin-0-65mm-1-27mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0097.html" -w "97 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-4-7-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0098.html" -w "98 %{http_code}\n" 'https://www.berrybase.de/8bitdo-retro-mechanical-keyboard-m-edition-87-tasten-kailh-box-switches-hot-swap-qwerty'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0099.html" -w "99 %{http_code}\n" 'https://www.berrybase.de/dfrobot-micro-metal-gearmotor-30-1-700rpm-1.2kgcm-drehmoment-55ma-leerlaufstrom-6v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0100.html" -w "100 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-pico-wh-rp2040-wlan-mikrocontroller-board-mit-headern'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0101.html" -w "101 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-22-f-25v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0102.html" -w "102 %{http_code}\n" 'https://www.berrybase.de/flachkabel-bunt-rm-1-4mm-10pin-awg-24'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0103.html" -w "103 %{http_code}\n" 'https://www.berrybase.de/arduino-leonardo-mit-headern'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0104.html" -w "104 %{http_code}\n" 'https://www.berrybase.de/kupferlackdraht-oe0-15mm-set-7x10m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0105.html" -w "105 %{http_code}\n" 'https://www.berrybase.de/donau-kupferschaltlitze-0-75-mm2-10m-lang-1-adrig-24x0-20mm-pvc-isoliert-019d91fee5be73db9a62ec4dfb762de2'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0106.html" -w "106 %{http_code}\n" 'https://www.berrybase.de/breadboard-mit-400-kontakten'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0107.html" -w "107 %{http_code}\n" 'https://www.berrybase.de/buerstenbehafteter-dc-motor-groesse-130-6v-11-5krpm-800ma-blockierstrom'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0108.html" -w "108 %{http_code}\n" 'https://www.berrybase.de/infineon-mosfet-40v-drain-source-162a-drainstrom-200w-verlustleistung-4-ohm-widerstand-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0109.html" -w "109 %{http_code}\n" 'https://www.berrybase.de/adafruit-sensirion-sht45-precision-temperature-humidity-sensor'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0110.html" -w "110 %{http_code}\n" 'https://www.berrybase.de/vierlingslitze-isoliert-4x0-14mm-5m-farbe-blau-gelb-rot-gruen'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0111.html" -w "111 %{http_code}\n" 'https://www.berrybase.de/offizielles-raspberry-pi-usb-c-netzteil-5-1v-3-0a-eu-schwarz'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0112.html" -w "112 %{http_code}\n" 'https://www.berrybase.de/8bitdo-sn30-pro-usb-gamepad-grey-edition'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0113.html" -w "113 %{http_code}\n" 'https://www.berrybase.de/buchsenleiste-1x-5-polig-rm-2-54-h-8-4-gerade'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0114.html" -w "114 %{http_code}\n" 'https://www.berrybase.de/arduino-9-achsen-motion-shield'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0115.html" -w "115 %{http_code}\n" 'https://www.berrybase.de/adafruit-stepper-motor-nema17-cqa240327p-200-schritte-4draht-1.8-grad-5mm-welle-12v-350ma'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0116.html" -w "116 %{http_code}\n" 'https://www.berrybase.de/1n4001-gleichrichterdiode-tht-50v-1a-do41'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0117.html" -w "117 %{http_code}\n" 'https://www.berrybase.de/bc547b-bipolarer-transistor-npn-45v-100ma-to-92-3-pin'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0118.html" -w "118 %{http_code}\n" 'https://www.berrybase.de/arduino-due-a000056-at91sam3x8e-micro-usb-ohne-header-3-3v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0119.html" -w "119 %{http_code}\n" 'https://www.berrybase.de/optosupply-round-super-led-5mm-rot'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0120.html" -w "120 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-470-f-35v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0121.html" -w "121 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-120-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0122.html" -w "122 %{http_code}\n" 'https://www.berrybase.de/offizielles-raspberry-pi-micro-usb-kabel-rot-1-0m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0123.html" -w "123 %{http_code}\n" 'https://www.berrybase.de/buchsenleiste-1x-4-polig-rm-2-54-h-8-4-gerade'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0124.html" -w "124 %{http_code}\n" 'https://www.berrybase.de/8bitdo-ultimate-2-wireless-controller-hall-effekt-tmr-sticks-fire-ring-2-4g-bt-usb-c-android-pc'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0125.html" -w "125 %{http_code}\n" 'https://www.berrybase.de/act-motor-motortreiber-dm420-mikroschritte-200-25600-nema17-max.-2-83a-12-36-v-dc'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0126.html" -w "126 %{http_code}\n" 'https://www.berrybase.de/8bitdo-arcade-stick-fuer-windows-nintendo-switch'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0127.html" -w "127 %{http_code}\n" 'https://www.berrybase.de/arduino-nano-rp2040-connect'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0128.html" -w "128 %{http_code}\n" 'https://www.berrybase.de/tsal6200-ir-sendediode-5mm-170-940nm-60mw-sr-2-pin-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0129.html" -w "129 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-47-0-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0130.html" -w "130 %{http_code}\n" 'https://www.berrybase.de/optosupply-led-1-8mm-2180-3000mcd-300-klar-warmweiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0131.html" -w "131 %{http_code}\n" 'https://www.berrybase.de/40pin-jumper-dupont-kabel-male-female-trennbar'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0132.html" -w "132 %{http_code}\n" 'https://www.berrybase.de/ky-018-ldr-fotowiderstands-modul-mit-analogem-ausgang'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0133.html" -w "133 %{http_code}\n" 'https://www.berrybase.de/arduino-mkr-zero'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0134.html" -w "134 %{http_code}\n" 'https://www.berrybase.de/act-motor-nema17-stepper-motor-17hm5417-0.90-schrittwinkel-0.4-nm-haltemoment-1.7a'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0135.html" -w "135 %{http_code}\n" 'https://www.berrybase.de/optosupply-led-ultrahell-5mm-75.000mcd-150-klar-kaltweiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0136.html" -w "136 %{http_code}\n" 'https://www.berrybase.de/8bitdo-ultimate-2c-bluetooth-controller-switch-kompatibel-hall-effekt-joysticks-6-achsen-pink'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0137.html" -w "137 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-pico-2w-rp2350-wlan-bluetooth-mikrocontroller-board'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0138.html" -w "138 %{http_code}\n" 'https://www.berrybase.de/kingbright-low-current-led-3mm-rot'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0139.html" -w "139 %{http_code}\n" 'https://www.berrybase.de/arduino'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0140.html" -w "140 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-33nf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0141.html" -w "141 %{http_code}\n" 'https://www.berrybase.de/offizielles-raspberry-pi-micro-hdmi-kabel-weiss-1-0m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0142.html" -w "142 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-5-8gb-ram'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0143.html" -w "143 %{http_code}\n" 'https://www.berrybase.de/mcp23017-e-sp-ic-16-bit-i-o-expander-mit-serieller-schnittstelle'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0144.html" -w "144 %{http_code}\n" 'https://www.berrybase.de/arduino-nano-matter-abx00112-cortex-m33-1536kb-flash-256kb-ram-thread-ble-5.3-usb-c-3-3v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0145.html" -w "145 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-100-0-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0146.html" -w "146 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-27w-usb-c-power-supply-netzteil-weiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0147.html" -w "147 %{http_code}\n" 'https://www.berrybase.de/8bitdo-arcade-stick-fuer-pc-all-button-design-bluetooth-2-4g-usb-4-programmierbare-tasten-1000mah'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0148.html" -w "148 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-100-f-16v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0149.html" -w "149 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-2-2nf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0150.html" -w "150 %{http_code}\n" 'https://www.berrybase.de/adafruit-mcp9600-i2c-thermocouple-verstaerker'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0151.html" -w "151 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-camera-cable-standard-mini-200mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0152.html" -w "152 %{http_code}\n" 'https://www.berrybase.de/hobby-motor-getriebe'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0153.html" -w "153 %{http_code}\n" 'https://www.berrybase.de/dfrobot-micro-metal-geared-stepper-motor-100-1-getriebe-180-schrittwinkel-0.6kgcm-drehmoment-12v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0154.html" -w "154 %{http_code}\n" 'https://www.berrybase.de/dupont-gehaeuse-1x1-pin'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0155.html" -w "155 %{http_code}\n" 'https://www.berrybase.de/fassung-fuer-led-3mm-l2-8mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0156.html" -w "156 %{http_code}\n" 'https://www.berrybase.de/5506-ldr-fotowiderstand-90mw-2-6ko-540nm-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0157.html" -w "157 %{http_code}\n" 'https://www.berrybase.de/buchsenleiste-1x-2-polig-rm-2-54-h-8-4-gerade'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0158.html" -w "158 %{http_code}\n" 'https://www.berrybase.de/4-kanal-i2c-kompatibler-bi-direktionaler-logic-level-converter'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0159.html" -w "159 %{http_code}\n" 'https://www.berrybase.de/rgb-led-mit-automatischem-farbwechsel-5mm-klar-60-sekunden'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0160.html" -w "160 %{http_code}\n" 'https://www.berrybase.de/arduino-mkr-iot-carrier-rev2-erweiterungsboard'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0161.html" -w "161 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-68-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0162.html" -w "162 %{http_code}\n" 'https://www.berrybase.de/inkrementalgeber-24-rastungen-24-impulse-taster-stehend-6-x-20mm-achse-printmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0163.html" -w "163 %{http_code}\n" 'https://www.berrybase.de/optosupply-led-1-8mm-4200-5800mcd-300-klar-kaltweiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0164.html" -w "164 %{http_code}\n" 'https://www.berrybase.de/tip122f-npn-darlington-transistor-100v-8a-to-220fp'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0165.html" -w "165 %{http_code}\n" 'https://www.berrybase.de/arduino-micro-a000053-atmega32u4-20-i-o-7-pwm-12-analog-usb-16-mhz-5v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0166.html" -w "166 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-22pf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0167.html" -w "167 %{http_code}\n" 'https://www.berrybase.de/waveshare-sm24240-zweiphasen-schrittmotor-1.80-schrittwinkel-1.7a-pro-phase'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0168.html" -w "168 %{http_code}\n" 'https://www.berrybase.de/ir-infrarot-remote-receiver-empfaenger-tsop38238'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0169.html" -w "169 %{http_code}\n" 'https://www.berrybase.de/aluminium-gehaeuse-fuer-raspberry-pi-5-schwarz'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0170.html" -w "170 %{http_code}\n" 'https://www.berrybase.de/adafruit-molex-picoblade-kabel-2-polig-200mm-1.25mm-pitch-reibungsverriegelung'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0171.html" -w "171 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-4-computer-modell-b-2gb-ram'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0172.html" -w "172 %{http_code}\n" 'https://www.berrybase.de/pololu-shaftless-vibration-motor-14500rpm-8x3.4mm-0.75g-vibrationsamplitude-60ma-3v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0173.html" -w "173 %{http_code}\n" 'https://www.berrybase.de/offizielles-raspberry-pi-micro-hdmi-kabel-schwarz-1-0m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0174.html" -w "174 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-4-computer-modell-b-8gb-ram'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0175.html" -w "175 %{http_code}\n" 'https://www.berrybase.de/kupferschaltdraht-isoliert-oe0-5mm-10m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0176.html" -w "176 %{http_code}\n" 'https://www.berrybase.de/kingbright-low-current-led-3mm-gruen'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0177.html" -w "177 %{http_code}\n" 'https://www.berrybase.de/4-teiliges-kuehlkoerper-set-fuer-raspberry-pi-4-silber'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0178.html" -w "178 %{http_code}\n" 'https://www.berrybase.de/arduino-mkr-protoshield-l'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0179.html" -w "179 %{http_code}\n" 'https://www.berrybase.de/8bitdo-pro-2-gamepad-hall-effekt-technologie-bluetooth-usb-c-programmierbar-1000-mah-schwarz'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0180.html" -w "180 %{http_code}\n" 'https://www.berrybase.de/5526-5528-ldr-fotowiderstand-100mw-8-20ko-540nm-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0181.html" -w "181 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-10-0-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0182.html" -w "182 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-active-cooler-luefter-fuer-raspberry-pi-5'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0183.html" -w "183 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-2200-f-16v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0184.html" -w "184 %{http_code}\n" 'https://www.berrybase.de/8bitdo-arcade-stick-fuer-windows-nintendo-switch-b-ware'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0185.html" -w "185 %{http_code}\n" 'https://www.berrybase.de/kupferlitze-isoliert-0-04-mm2-set-10x10m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0186.html" -w "186 %{http_code}\n" 'https://www.berrybase.de/infineon-technologies-transistor-irf1404lpbf-mosfet-unipolar-40v-162a-200w-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0187.html" -w "187 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-150-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0188.html" -w "188 %{http_code}\n" 'https://www.berrybase.de/adafruit-pt1000-rtd-temperatursensor-verstaerker-max31865'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0189.html" -w "189 %{http_code}\n" 'https://www.berrybase.de/arduino-uno-smd-rev3'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0190.html" -w "190 %{http_code}\n" 'https://www.berrybase.de/8bitdo-sn30-pro-gamepad-hall-edition-classic-bluetooth-usb-c-480mah-grau'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0191.html" -w "191 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-20-0-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0192.html" -w "192 %{http_code}\n" 'https://www.berrybase.de/arduino-plug-and-make-kit'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0193.html" -w "193 %{http_code}\n" 'https://www.berrybase.de/kupferlitze-isoliert-0-14-mm2-set-10x10m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0194.html" -w "194 %{http_code}\n" 'https://www.berrybase.de/2n2222a-bipolarer-transistor-npn-40v-600ma-to-92-3-pin'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0195.html" -w "195 %{http_code}\n" 'https://www.berrybase.de/zwillingslitze-isoliert-extra-duenn-2x-0-04mm-10m-rot-schwarz'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0196.html" -w "196 %{http_code}\n" 'https://www.berrybase.de/8bitdo-zero-2-bluetooth-gamepad-gelb'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0197.html" -w "197 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-200-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0198.html" -w "198 %{http_code}\n" 'https://www.berrybase.de/sandisk-extreme-pro-microsdxc-a2-uhs-i-u3-v30-200mb-s-speicherkarte-adapter-64gb'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0199.html" -w "199 %{http_code}\n" 'https://www.berrybase.de/adafruit-micro-servo-kontinuierliche-drehung'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0200.html" -w "200 %{http_code}\n" 'https://www.berrybase.de/arduino-motor-shield-rev-3'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0201.html" -w "201 %{http_code}\n" 'https://www.berrybase.de/kingbright-low-current-led-5mm-gruen'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0202.html" -w "202 %{http_code}\n" 'https://www.berrybase.de/vibrationsmotor-11-6-4-6-4-8mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0203.html" -w "203 %{http_code}\n" 'https://www.berrybase.de/arduino-portenta-max-carrier-edge-ai-ethernet-lora-cat-m1-nb-iot-usb-microsd-fuer-x8-h7'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0204.html" -w "204 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-180-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0205.html" -w "205 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-1-0-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0206.html" -w "206 %{http_code}\n" 'https://www.berrybase.de/brands'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0207.html" -w "207 %{http_code}\n" 'https://www.berrybase.de/adafruit-esp32-s3-reverse-tft-feather'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0208.html" -w "208 %{http_code}\n" 'https://www.berrybase.de/adafruit-tauchbare-3v-dc-wasserpumpe-mit-1-meter-kabel-horizontal'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0209.html" -w "209 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-1-f-100v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0210.html" -w "210 %{http_code}\n" 'https://www.berrybase.de/8bitdo-zero-2-bluetooth-gamepad-tuerkis'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0211.html" -w "211 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-2-2-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0212.html" -w "212 %{http_code}\n" 'https://www.berrybase.de/adafruit-5-wege-navigations-joystick'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0213.html" -w "213 %{http_code}\n" 'https://www.berrybase.de/ir333-a-ir-sendediode-5mm-200-940nm-150mw-2-pin-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0214.html" -w "214 %{http_code}\n" 'https://www.berrybase.de/optosupply-led-5mm-8.6-9.3lm-150-klar-leaf-green'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0215.html" -w "215 %{http_code}\n" 'https://www.berrybase.de/arduino-portenta-x8-9-kerne-wi-fi-bluetooth-ki-ota-updates-multiprozessor-architektur'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0216.html" -w "216 %{http_code}\n" 'https://www.berrybase.de/kingbright-solid-state-led-10mm-rot'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0217.html" -w "217 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-33-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0218.html" -w "218 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-10nf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0219.html" -w "219 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-3-modell-b'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0220.html" -w "220 %{http_code}\n" 'https://www.berrybase.de/mentor-led-dioden-reflektor-fuer-5mm-leds-12mm-aussendurchmesser-praezise-lichtfuehrung'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0221.html" -w "221 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-22-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0222.html" -w "222 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-27w-usb-c-power-supply-netzteil-schwarz'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0223.html" -w "223 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-10-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0224.html" -w "224 %{http_code}\n" 'https://www.berrybase.de/fr'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0225.html" -w "225 %{http_code}\n" 'https://www.berrybase.de/arduino-opla-iot-starter-kit-englisch'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0226.html" -w "226 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-1000-f-35v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0227.html" -w "227 %{http_code}\n" 'https://www.berrybase.de/adafruit-tdk-invensense-icm-20948-9-dof-imu-mpu-9250-upgrade'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0228.html" -w "228 %{http_code}\n" 'https://www.berrybase.de/adafruit-i2s-mems-mikrofon-breakout-sph0645lm4h'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0229.html" -w "229 %{http_code}\n" 'https://www.berrybase.de/8bitdo-xbox-media-fernbedienung-black-edition-kompatibel-mit-xbox-series-x-s-one-infrarot'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0230.html" -w "230 %{http_code}\n" 'https://www.berrybase.de/adafruit-feather-rp2040-mit-usb-typ-a-host'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0231.html" -w "231 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-2-0-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0232.html" -w "232 %{http_code}\n" 'https://www.berrybase.de/kupferschaltdraht-verzinnt-oe0-8mm-10m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0233.html" -w "233 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-3-3-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0234.html" -w "234 %{http_code}\n" 'https://www.berrybase.de/schraube-mit-flansch-kopf-kugel-m2-5x5'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0235.html" -w "235 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-330-0-kohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0236.html" -w "236 %{http_code}\n" 'https://www.berrybase.de/adafruit-miniboost-5v-at-1a-tps61023'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0237.html" -w "237 %{http_code}\n" 'https://www.berrybase.de/kupferlitze-isoliert-awg-30-8-farbig-280m-rolle'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0238.html" -w "238 %{http_code}\n" 'https://www.berrybase.de/arduino-mega-2560-rev3'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0239.html" -w "239 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-240-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0240.html" -w "240 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-100-f-25v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0241.html" -w "241 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-2200-f-25v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0242.html" -w "242 %{http_code}\n" 'https://www.berrybase.de/adafruit-tpl5110-low-power-timer-breakout'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0243.html" -w "243 %{http_code}\n" 'https://www.berrybase.de/adafruit-aht20-temperatur-und-feuchtigkeitssensor-breakout-board'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0244.html" -w "244 %{http_code}\n" 'https://www.berrybase.de/ne555p-timer-ic-dip8'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0245.html" -w "245 %{http_code}\n" 'https://www.berrybase.de/waveshare-l-foermiger-permanentmagnet-dc-getriebemotor-magnetischer-hall-encoder-240-u-min-12v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0246.html" -w "246 %{http_code}\n" 'https://www.berrybase.de/adafruit-scd-41-co2-sensor-400-5000-ppm-40ppm-5-temperatur-und-feuchtigkeitssensor-3-3-5v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0247.html" -w "247 %{http_code}\n" 'https://www.berrybase.de/arduino-sps-starter-kit-lehrmaterialien-mit-opta-wifi-8-eingaenge-0-10v-4-relaisausgaenge-250v-10a'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0248.html" -w "248 %{http_code}\n" 'https://www.berrybase.de/8bitdo-wireless-bluetooth-adapter-2-fuer-windows-mac-raspberry-pi-switch'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0249.html" -w "249 %{http_code}\n" 'https://www.berrybase.de/8bitdo-neogeo-controller-bluetooth-2.4g-usb-c-300mah-snk-windows-android-neogeo-mini'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0250.html" -w "250 %{http_code}\n" 'https://www.berrybase.de/ic-sockel-14-polig-rm-2-54mm-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0251.html" -w "251 %{http_code}\n" 'https://www.berrybase.de/buchsenleiste-1x-3-polig-rm-2-54-h-8-4-gerade'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0252.html" -w "252 %{http_code}\n" 'https://www.berrybase.de/waveshare-metall-flachschluessel-flanschplatte-fuer-serien-bus-servo'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0253.html" -w "253 %{http_code}\n" 'https://www.berrybase.de/drillingslitze-isoliert-3x0-14mm-5m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0254.html" -w "254 %{http_code}\n" 'https://www.berrybase.de/12-segment-lineare-led-leiste-anzeige-8x-gruen-4x-rot'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0255.html" -w "255 %{http_code}\n" 'https://www.berrybase.de/hobby-getriebemotor-65-u-min-rechter-winkel-2-stueck'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0256.html" -w "256 %{http_code}\n" 'https://www.berrybase.de/sparkfun-solenoid-elektromagnet-linearantrieb-5vdc-4-5mm-hub'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0257.html" -w "257 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-2.2-f-100v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0258.html" -w "258 %{http_code}\n" 'https://www.berrybase.de/kurzhubtaster-vertikale-printmontage-6x6mm-h-5-0mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0259.html" -w "259 %{http_code}\n" 'https://www.berrybase.de/8bitdo-retro-18-mechanical-numpad-m-edition-18-mechanische-tasten-bluetooth-usb'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0260.html" -w "260 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-1-f-50v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0261.html" -w "261 %{http_code}\n" 'https://www.berrybase.de/pn2222abu-bipolarer-transistor-npn-40v-1a-300mhz-hfe-35-to-92-3-pin'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0262.html" -w "262 %{http_code}\n" 'https://www.berrybase.de/smd-breakout-adapter-fuer-sop28-ssop28-tssop28-28-pin-0-65mm-1-27mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0263.html" -w "263 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-560-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0264.html" -w "264 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-47-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0265.html" -w "265 %{http_code}\n" 'https://www.berrybase.de/adafruit-dc-getriebemotor-tt-motor-200rpm-3-6vdc'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0266.html" -w "266 %{http_code}\n" 'https://www.berrybase.de/usb-2.0-hi-speed-otg-adapterkabel-a-buchse-micro-b-stecker-0-15m-weiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0267.html" -w "267 %{http_code}\n" 'https://www.berrybase.de/adafruit-mini-pager-getriebemotor-mit-rueckstellfeder'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0268.html" -w "268 %{http_code}\n" 'https://www.berrybase.de/infineon-irlb4132pbf-n-kanal-mosfet-hexfet-technologie-to220ab-gehaeuse-100a-30v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0269.html" -w "269 %{http_code}\n" 'https://www.berrybase.de/vierlingslitze-isoliert-4x0-25mm-fuer-rgb-led-stripes-10m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0270.html" -w "270 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-22nf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0271.html" -w "271 %{http_code}\n" 'https://www.berrybase.de/hobby-getriebemotor-140-u-min-2-stueck'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0272.html" -w "272 %{http_code}\n" 'https://www.berrybase.de/offizielles-gehaeuse-fuer-raspberry-pi-zero-rot-weiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0273.html" -w "273 %{http_code}\n" 'https://www.berrybase.de/optosupply-round-super-led-5mm-gelb'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0274.html" -w "274 %{http_code}\n" 'https://www.berrybase.de/stiftleiste-1x-20-polig-rm-2-54-gerade'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0275.html" -w "275 %{http_code}\n" 'https://www.berrybase.de/waveshare-servo-driver-hat-b-16-kanal-12-bit-pwm-i2c-5v-regler-fuer-raspberry-pi-jetson-nano'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0276.html" -w "276 %{http_code}\n" 'https://www.berrybase.de/neopixel-rgbw-mini-button-pcb-10er-pack'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0277.html" -w "277 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-470-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0278.html" -w "278 %{http_code}\n" 'https://www.berrybase.de/keramikkondensator-100pf-50v-10-tht-2-54mm'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0279.html" -w "279 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-4.7-f-100v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0280.html" -w "280 %{http_code}\n" 'https://www.berrybase.de/adafruit-raspberry-pi-camera-board-gehaeuse-mit-1-4-stativhalterung'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0281.html" -w "281 %{http_code}\n" 'https://www.berrybase.de/8bitdo-retro-cube-2-speaker-n-edition-stereo-lautsprecher-bluetooth-5-3-2-4g-usb-2x5w-2000mah'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0282.html" -w "282 %{http_code}\n" 'https://www.berrybase.de/abholung-in-berlin'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0283.html" -w "283 %{http_code}\n" 'https://www.berrybase.de/m5stack-servo-kit-1800'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0284.html" -w "284 %{http_code}\n" 'https://www.berrybase.de/seeed-grove-servomotor'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0285.html" -w "285 %{http_code}\n" 'https://www.berrybase.de/optosupply-led-ultrahell-5mm-40.000mcd-150-klar-warmweiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0286.html" -w "286 %{http_code}\n" 'https://www.berrybase.de/7-segment-anzeige-10mm-gemeinsame-anode-40mcd-gelb'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0287.html" -w "287 %{http_code}\n" 'https://www.berrybase.de/8bitdo-wireless-bluetooth-adapter-2-fuer-windows-mac-raspberry-pi-switch-b-ware'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0288.html" -w "288 %{http_code}\n" 'https://www.berrybase.de/optosupply-led-5mm-kerzenscheinimitierend-2000-2500mcd-300-klar-warmweiss'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0289.html" -w "289 %{http_code}\n" 'https://www.berrybase.de/metallschichtwiderstand-680-0-ohm-1-4w-1-0207-axial-durchsteckmontage'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0290.html" -w "290 %{http_code}\n" 'https://www.berrybase.de/dupont-gehaeuse-1x4-pin'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0291.html" -w "291 %{http_code}\n" 'https://www.berrybase.de/subminiatur-kippschalter-2-pin-ein-aus'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0292.html" -w "292 %{http_code}\n" 'https://www.berrybase.de/arduino-alvik'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0293.html" -w "293 %{http_code}\n" 'https://www.berrybase.de/elektrolytkondensator-220-f-25v-1050c-1-radial-tht'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0294.html" -w "294 %{http_code}\n" 'https://www.berrybase.de/adafruit-dvi-sock-fuer-pico-hdmi-displays-nur-grafiken-nutzt-rp2040-pio-system-und-overclocking'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0295.html" -w "295 %{http_code}\n" 'https://www.berrybase.de/kupferschaltdraht-verzinnt-oe0-6mm-10m'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0296.html" -w "296 %{http_code}\n" 'https://www.berrybase.de/sparkfun-bldc-gimbal-motor-7.4v-2000rpm-8-magnetpole-3-phasen-320gcm-drehmoment-6-8v'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0297.html" -w "297 %{http_code}\n" 'https://www.berrybase.de/raspberry-pi-pico-w-rp2040-wlan-mikrocontroller-board'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0298.html" -w "298 %{http_code}\n" 'https://www.berrybase.de/stiftleiste-2x-20-polig-rm-2-54-gerade'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0299.html" -w "299 %{http_code}\n" 'https://www.berrybase.de/8bitdo-pro-2-usb-gamepad-fuer-windows-switch-grey-edition'
sleep 0.35
echo DONE_BERRY