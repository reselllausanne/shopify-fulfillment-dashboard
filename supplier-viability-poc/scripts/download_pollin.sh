#!/bin/bash
set +e
UA='SupplierViabilityPOC/1.0'
OUT='/Users/resell-lausanne/Projects/shopify-fulfillment-dashboard/supplier-viability-poc/_raw/pollin/products'
mkdir -p "$OUT"
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0000.html" -w "0 %{http_code}\n" 'https://www.pollin.de/p/verico-li-ion-akku-loop-energy-aa-mit-usb-c-buchse-12er-pack-273395'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0001.html" -w "1 %{http_code}\n" 'https://www.pollin.de/p/trio-led-deckenleuchte-nazar-633919131-36w-3600lm-3000k-522028'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0002.html" -w "2 %{http_code}\n" 'https://www.pollin.de/p/ansmann-ladegeraet-comfort-smart-mit-usb-eingang-352723'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0003.html" -w "3 %{http_code}\n" 'https://www.pollin.de/p/logilink-usb-2-0-typ-c-kabel-cu0190-alu-schwarz-1-m-714009'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0004.html" -w "4 %{http_code}\n" 'https://www.pollin.de/p/wiska-kabelabzweigkasten-combi-407-5-lg-ip66-67-553853'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0005.html" -w "5 %{http_code}\n" 'https://www.pollin.de/p/quatpower-usb-lader-2a12-2-fach-2-4-a-schwarz-353122'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0006.html" -w "6 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-kaltgeraetekabel-5-m-schwarz-561654'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0007.html" -w "7 %{http_code}\n" 'https://www.pollin.de/p/daylite-led-lampe-g4-20-250ww-g4-eek-e-2-w-250-lm-3000-k-539828'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0008.html" -w "8 %{http_code}\n" 'https://www.pollin.de/p/mean-well-schaltnetzteil-lrs-75-24-24-v-3-2-a-352176'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0009.html" -w "9 %{http_code}\n" 'https://www.pollin.de/p/phoenix-contact-kunststoff-kabelmarker-1005266-kmk-2-442754'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0010.html" -w "10 %{http_code}\n" 'https://www.pollin.de/p/dunlop-fahrrad-spiralkabelschloss-150cm-851316'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0011.html" -w "11 %{http_code}\n" 'https://www.pollin.de/p/luxula-led-panel-lx-62-4000-cri98-eek-f-40-w-4000-lm-4000-k-521694'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0012.html" -w "12 %{http_code}\n" 'https://www.pollin.de/p/chilitec-led-einbauleuchte-flat-32-eek-f-5-w-590-lm-4000-k-edelstahl-535623'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0013.html" -w "13 %{http_code}\n" 'https://www.pollin.de/p/rev-kabeltrommel-h07rn-4-fach-40-m-553004'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0014.html" -w "14 %{http_code}\n" 'https://www.pollin.de/p/kss-kabelverschraubung-m12-schwarz-3-bis-6-5-knickschutz-442796'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0015.html" -w "15 %{http_code}\n" 'https://www.pollin.de/p/daytools-kabelbinder-125x12-mm-klettverschluss-blau-10-stueck-442316'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0016.html" -w "16 %{http_code}\n" 'https://www.pollin.de/p/inter-tech-led-netzteil-led-12v-50-w-537993'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0017.html" -w "17 %{http_code}\n" 'https://www.pollin.de/p/logilink-usb-tastatur-beleuchtet-id0138-schwarz-750259'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0018.html" -w "18 %{http_code}\n" 'https://www.pollin.de/p/tfa-led-mini-arbeitsleuchte-cob-akku-43-2040-01-6-w-schwarz-521648'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0019.html" -w "19 %{http_code}\n" 'https://www.pollin.de/p/goobay-wetterfester-led-trafo-24v-dc-60w-4-16-a-ip67-522301'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0020.html" -w "20 %{http_code}\n" 'https://www.pollin.de/p/intenso-usb-kabel-a315c-usb-a-auf-usb-c-1-5m-714080'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0021.html" -w "21 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-koaxial-kabelverbinder-570035'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0022.html" -w "22 %{http_code}\n" 'https://www.pollin.de/p/kingston-usb-stick-datatraveler-kyson-usb-3-2-64-gb-724502'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0023.html" -w "23 %{http_code}\n" 'https://www.pollin.de/p/einhell-schnellverbinder-fuer-kabelgeb-schmutzwasser-und-klarwasserpumpen-871790'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0024.html" -w "24 %{http_code}\n" 'https://www.pollin.de/p/shelly-luftfeuchtigkeits-und-temperatursensor-h-t-schwarz-4-stueck-591405'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0025.html" -w "25 %{http_code}\n" 'https://www.pollin.de/p/luxula-led-einbauleuchte-24w-eek-f-2400lm-cct-ip44-weiss-522670'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0026.html" -w "26 %{http_code}\n" 'https://www.pollin.de/p/homematic-ip-156669a0-wandthermostat-mit-luftfeuchtigkeitssensor-591252'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0027.html" -w "27 %{http_code}\n" 'https://www.pollin.de/p/chilitec-led-lampe-silikon-w2-g4-eek-e-2-w-200-lm-4000-k-neutralweiss-537560'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0028.html" -w "28 %{http_code}\n" 'https://www.pollin.de/p/joy-it-labornetzteil-mit-60-v-und-12-a-ausgangsstrom-jt-rd6012-352730'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0029.html" -w "29 %{http_code}\n" 'https://www.pollin.de/p/blulaxa-led-deckenleuchte-promina-s-sternenhimmel-18w-cct-fernbedienung-538979'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0030.html" -w "30 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-rj45-patchkabel-u-utp-m-cat-7-rohkabel-2-m-gelb-740235'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0031.html" -w "31 %{http_code}\n" 'https://www.pollin.de/p/solid-state-relais-k15-d-24z25-lq-4-32-v-25-a-240-v-340856'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0032.html" -w "32 %{http_code}\n" 'https://www.pollin.de/p/osram-led-lampe-superstar-dimmbar-e14-3-4-w-2700-k-eek-d-470-lm-warmweiss-522248'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0033.html" -w "33 %{http_code}\n" 'https://www.pollin.de/p/eltako-stromstossschaltrelais-esr12np-230v-uc-554853'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0034.html" -w "34 %{http_code}\n" 'https://www.pollin.de/p/profi-cook-glas-wasserkocher-pc-wk-1328-g-1-7l-varriable-temperatur-touch-display-695368'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0035.html" -w "35 %{http_code}\n" 'https://www.pollin.de/p/v-tac-led-fluter-vt-48500-500w-4000k-eek-d-67500lm-neutralweiss-ip65-schwarz-522694'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0036.html" -w "36 %{http_code}\n" 'https://www.pollin.de/p/wiska-kabelabzweigkasten-combi-1210-wh-ip66-67-553865'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0037.html" -w "37 %{http_code}\n" 'https://www.pollin.de/p/verbatim-usb-3-0-hdd-store-n-go-1-tb-schwarz-702333'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0038.html" -w "38 %{http_code}\n" 'https://www.pollin.de/p/everstar-duo-leds-esl-s6794rgw033w-eckig-gruen-rot-10-stueck-121332'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0039.html" -w "39 %{http_code}\n" 'https://www.pollin.de/p/reality-led-tischleuchte-berry-r52191187-titanfarbig-3-2-w-350-lm-3000-k-539760'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0040.html" -w "40 %{http_code}\n" 'https://www.pollin.de/p/rev-schnur-zwischenschalter-0033050112-mit-usb-a-weiss-421663'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0041.html" -w "41 %{http_code}\n" 'https://www.pollin.de/p/goobay-usb-3-0-super-speed-anschlusskabel-a-a-95717-1-m-schwarz-713483'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0042.html" -w "42 %{http_code}\n" 'https://www.pollin.de/p/reality-led-deckenleuchte-mit-ventilator-mora-r64032101-23w-2700-6000k-1800lm-cct-ip20-weiss-522597'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0043.html" -w "43 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-rj45-patchkabel-cat-7-rohkabel-u-utp-gelb-5-m-741005'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0044.html" -w "44 %{http_code}\n" 'https://www.pollin.de/p/einhell-akku-18-v-3-0-ah-sealed-pxc-plus-273368'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0045.html" -w "45 %{http_code}\n" 'https://www.pollin.de/p/goobay-cee-adapterkabel-76185-1-5-m-stecker-zu-schutzkontakt-stecker-554836'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0046.html" -w "46 %{http_code}\n" 'https://www.pollin.de/p/osram-led-deckenleuchte-mit-sensor-15-5-w-1100-lm-3000-k-ip44-oe-0-3-m-522161'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0047.html" -w "47 %{http_code}\n" 'https://www.pollin.de/p/wiska-kabelverschraubung-10066528-eskv-set-32-m-32x1-5-metrisch-lichtgrau-442915'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0048.html" -w "48 %{http_code}\n" 'https://www.pollin.de/p/mueller-licht-led-nachtlicht-grada-sensor-0-25w-10lm-4000k-538739'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0049.html" -w "49 %{http_code}\n" 'https://www.pollin.de/p/hycell-universal-netzteil-hcps-1500-3-12-v-1500ma-18-w-353136'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0050.html" -w "50 %{http_code}\n" 'https://www.pollin.de/p/cherry-usb-tastatur-g80-3000-mechanisch-linear-schwarz-751123'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0051.html" -w "51 %{http_code}\n" 'https://www.pollin.de/p/enovalite-led-feuchtraumleuchte-pro-eek-e-18w-2070lm-4000k-650mm-539131'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0052.html" -w "52 %{http_code}\n" 'https://www.pollin.de/p/quatpower-stecker-schaltnetzteil-xy12j-0502000q-ew55-21-5v-2-0a-5-5-2-1-352928'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0053.html" -w "53 %{http_code}\n" 'https://www.pollin.de/p/mean-well-hutschienen-schaltnetzteil-hdr-60-48-48-v-1-25-a-352123'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0054.html" -w "54 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-rj45-patchkabel-s-ftp-pimf-m-cat-7-rohkabel-20-m-weiss-740197'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0055.html" -w "55 %{http_code}\n" 'https://www.pollin.de/p/goobay-usb-adapter-45402-schwarz-c-buchse-c-stecker-900-gewinkelt-713438'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0056.html" -w "56 %{http_code}\n" 'https://www.pollin.de/p/mediarange-usb-tastatur-mros102-qwertz-schwarz-751547'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0057.html" -w "57 %{http_code}\n" 'https://www.pollin.de/p/nedis-smartlife-aussenkamera-wificbo33wt-3mp-full-hd-1296p-ip65-kabellos-mensch-erkennung-farb-nachtsicht-581450'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0058.html" -w "58 %{http_code}\n" 'https://www.pollin.de/p/kss-kabelbinder-sortiment-polyamid-6-6-schwarz-80x2-5-uv-bestaendig-100-stueck-443388'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0059.html" -w "59 %{http_code}\n" 'https://www.pollin.de/p/western-digital-usb-3-0-hdd-my-passport-4tb-schwarz-725447'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0060.html" -w "60 %{http_code}\n" 'https://www.pollin.de/p/grundig-usb-c-ladegeraet-30-w-230-v-usb-a-usb-c-353221'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0061.html" -w "61 %{http_code}\n" 'https://www.pollin.de/p/daypower-hall-sensor-modul-lc393-810567'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0062.html" -w "62 %{http_code}\n" 'https://www.pollin.de/p/mediarange-usb-stick-mr937-64gb-724996'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0063.html" -w "63 %{http_code}\n" 'https://www.pollin.de/p/apple-usb-c-kabel-2m-weiss-714582'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0064.html" -w "64 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-cat-6-patchkabel-s-ftp-900-gerade-0-5-m-grau-740870'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0065.html" -w "65 %{http_code}\n" 'https://www.pollin.de/p/las-versorgungskabel-10263-7x0-75-mm2-5-m-851471'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0066.html" -w "66 %{http_code}\n" 'https://www.pollin.de/p/goobay-usb-adapterkabel-usb-c-lightning-stecker-stecker-2-0m-713945'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0067.html" -w "67 %{http_code}\n" 'https://www.pollin.de/p/osram-led-roehre-t8-1200mm-g13-eek-f-20w-2160lm-3000k-539088'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0068.html" -w "68 %{http_code}\n" 'https://www.pollin.de/p/blanko-stromversorgungs-verteilerkabel-4-fach-561880'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0069.html" -w "69 %{http_code}\n" 'https://www.pollin.de/p/reality-led-akku-tischleuchte-munoz-r54891131-1-3w-120lm-3000k-weiss-522047'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0070.html" -w "70 %{http_code}\n" 'https://www.pollin.de/p/mutter-fuer-kabelverschraubung-m20-polyamid-lichtgrau-441424'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0071.html" -w "71 %{http_code}\n" 'https://www.pollin.de/p/logilink-patchkabel-cat-5e-15m-schwarz-542300'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0072.html" -w "72 %{http_code}\n" 'https://www.pollin.de/p/luxula-led-strassenleuchte-eek-f-30w-3000lm-4500k-ip65-grau-521732'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0073.html" -w "73 %{http_code}\n" 'https://www.pollin.de/p/sonero-usb-2-0-kabel-spc-u110-010-a-c-1m-grau-schwarz-714425'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0074.html" -w "74 %{http_code}\n" 'https://www.pollin.de/p/homematic-ip-smart-home-152056a0-wettersensor-basic-590233'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0075.html" -w "75 %{http_code}\n" 'https://www.pollin.de/p/samsung-sdxc-speicherkarte-pro-plus-2023-512gb-inkl-usb-kartenleser-725098'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0076.html" -w "76 %{http_code}\n" 'https://www.pollin.de/p/finder-relais-40-52-8-230-5000-340677'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0077.html" -w "77 %{http_code}\n" 'https://www.pollin.de/p/enovalite-led-highbay-leuchte-ufo-eek-c-200w-34000lm-5000k-schwarz-521681'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0078.html" -w "78 %{http_code}\n" 'https://www.pollin.de/p/mean-well-ac-dc-printnetzteil-irm-10-5-5-v-2-a-10-w-352011'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0079.html" -w "79 %{http_code}\n" 'https://www.pollin.de/p/joy-it-widerange-spannungsversorgung-pi-energy-mini-rb-pe01-fuer-raspberry-pi-811677'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0080.html" -w "80 %{http_code}\n" 'https://www.pollin.de/p/ringkabelschuh-2-5-mm2-m5-10-stueck-450288'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0081.html" -w "81 %{http_code}\n" 'https://www.pollin.de/p/raspberry-pi-gehaeuse-oberteil-weiss-701970'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0082.html" -w "82 %{http_code}\n" 'https://www.pollin.de/p/ir-led-3-w-mit-treiberplatine-und-3-streulinsen-810943'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0083.html" -w "83 %{http_code}\n" 'https://www.pollin.de/p/mueller-licht-led-feuchtraumleuchte-aquaprofi-120-34w-5200lm-4000k-538097'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0084.html" -w "84 %{http_code}\n" 'https://www.pollin.de/p/sandisk-usb-3-0-speicherstick-ultra-64-gb-711840'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0085.html" -w "85 %{http_code}\n" 'https://www.pollin.de/p/eglo-led-deckenleuchte-pogliola-s-18w-2050-lm-4000k-310-mm-kristalleffekt-536661'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0086.html" -w "86 %{http_code}\n" 'https://www.pollin.de/p/joy-it-esp32-kamera-entwicklungsplatine-mit-2-mp-kamera-sbc-esp32-cam-811273'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0087.html" -w "87 %{http_code}\n" 'https://www.pollin.de/p/osram-led-roehre-st8sp-1500mm-g13-eek-e-18-3w-2200lm-4000k-8-stueck-539395'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0088.html" -w "88 %{http_code}\n" 'https://www.pollin.de/p/goobay-hutschienen-netzteil-74767-24-v-2-5-a-60-w-581364'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0089.html" -w "89 %{http_code}\n" 'https://www.pollin.de/p/wiska-kabelverschraubung-10066400-skv-7-pg-7-pg-lichtgrau-442926'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0090.html" -w "90 %{http_code}\n" 'https://www.pollin.de/p/reality-led-wandleuchte-beja-r23359142-mit-bewegungssensor-12-5w-4000k-1650lm-neutalweiss-ip44-anthrazit-522590'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0091.html" -w "91 %{http_code}\n" 'https://www.pollin.de/p/kubii-m-2-ssd-sata-nvme-auf-usb-c-3-1-adapter-811964'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0092.html" -w "92 %{http_code}\n" 'https://www.pollin.de/p/joy-it-staubpartikelsensor-gp2y1014au-811028'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0093.html" -w "93 %{http_code}\n" 'https://www.pollin.de/p/fassung-fuer-led-oder-halogenlampen-g4-g5-3-gy6-35-520026'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0094.html" -w "94 %{http_code}\n" 'https://www.pollin.de/p/luxula-led-panel-40-w-4400-lm-4000-k-eek-e-620x620-mm-backlit-539530'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0095.html" -w "95 %{http_code}\n" 'https://www.pollin.de/p/joy-it-schaltnetzteil-jt-rd6006-nt-400-w-60-v-6-6-a-352693'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0096.html" -w "96 %{http_code}\n" 'https://www.pollin.de/p/logilink-patchkabel-primeline-cat-6a-mit-cat-7-rohkabel-s-ftp-grau-1m-742441'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0097.html" -w "97 %{http_code}\n" 'https://www.pollin.de/p/goobay-sata-esata-kabel-720034'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0098.html" -w "98 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-cat-6-patchkabel-10-m-blau-740129'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0099.html" -w "99 %{http_code}\n" 'https://www.pollin.de/p/just-light-led-deckenleuchte-14693-55-45w-5500lm-silber-522084'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0100.html" -w "100 %{http_code}\n" 'https://www.pollin.de/p/enovalite-led-highbay-leuchte-ufo-120-200-w-4000-k-eek-c-19200-32000-lm-dimmbar-schwarz-522766'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0101.html" -w "101 %{http_code}\n" 'https://www.pollin.de/p/daypower-ultraschall-distanzsensor-sr04-810579'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0102.html" -w "102 %{http_code}\n" 'https://www.pollin.de/p/kss-kabelbinder-sortiment-polyamid-6-6-schwarz-120x3-2-uv-bestaendig-100-stueck-443392'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0103.html" -w "103 %{http_code}\n" 'https://www.pollin.de/p/owon-tisch-multimeter-xdm1041-trms-8-9-cm-3-5-lc-display-830971'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0104.html" -w "104 %{http_code}\n" 'https://www.pollin.de/p/kss-kabelbinder-sortiment-polyamid-6-6-schwarz-250x3-6-uv-bestaendig-100-stueck-443410'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0105.html" -w "105 %{http_code}\n" 'https://www.pollin.de/p/icy-box-cardreader-ib-cr301-u3-cf-sd-micro-usb-3-0-anschluss-724654'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0106.html" -w "106 %{http_code}\n" 'https://www.pollin.de/p/mikrofonkabel-2-polig-50-m-schwarz-560727'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0107.html" -w "107 %{http_code}\n" 'https://www.pollin.de/p/logilink-energiekosten-messgeraet-em0004-display-1800-drehbar-weiss-591442'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0108.html" -w "108 %{http_code}\n" 'https://www.pollin.de/p/eltako-schaltrelais-er12-002-8-230vuc-554843'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0109.html" -w "109 %{http_code}\n" 'https://www.pollin.de/p/purelink-lautsprecherkabel-2x4-mm2-10m-weiss-cca-562625'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0110.html" -w "110 %{http_code}\n" 'https://www.pollin.de/p/logilink-gaming-maus-id0137-usb-750261'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0111.html" -w "111 %{http_code}\n" 'https://www.pollin.de/p/sharp-hifi-anlage-xl-b517d-schwarz-dab-bluetooth-usb-mp3-cd-laufwerk-631557'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0112.html" -w "112 %{http_code}\n" 'https://www.pollin.de/p/kss-kabelbinder-sortiment-polyamid-6-6-schwarz-75x2-4-uv-bestaendig-100-stueck-443387'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0113.html" -w "113 %{http_code}\n" 'https://www.pollin.de/p/logilink-netzwerk-kabeltester-wz0080-742615'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0114.html" -w "114 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-cat-5e-patchkabel-20m-grau-540997'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0115.html" -w "115 %{http_code}\n" 'https://www.pollin.de/p/led-lichterkette-bunt-320-leds-gruenes-kabel-innen-aussen-27m-8-funk-521950'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0116.html" -w "116 %{http_code}\n" 'https://www.pollin.de/p/sandisk-usb-3-2-stick-ultra-fit-64-gb-724067'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0117.html" -w "117 %{http_code}\n" 'https://www.pollin.de/p/logilink-usb-2-0-typ-c-kabel-cu0192-usb-a-alu-schwarz-1-m-714013'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0118.html" -w "118 %{http_code}\n" 'https://www.pollin.de/p/led-clusterlichterkette-bunt-1800-leds-gruenes-kabel-innen-aussen-33m-521985'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0119.html" -w "119 %{http_code}\n" 'https://www.pollin.de/p/kubii-abs-gehaeuse-fuer-raspberry-pi-5-mit-touchscreen-luftgekuehlt-811791'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0120.html" -w "120 %{http_code}\n" 'https://www.pollin.de/p/h-tronic-schwimmerschalter-s3-inkl-10-m-kabel-421386'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0121.html" -w "121 %{http_code}\n" 'https://www.pollin.de/p/usb-a-einbaubuchse-451533'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0122.html" -w "122 %{http_code}\n" 'https://www.pollin.de/p/just-light-led-deckenleuchte-14326-16-weiss-26-5-w-3300-lm-cct-521430'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0123.html" -w "123 %{http_code}\n" 'https://www.pollin.de/p/steckverbinder-usb-a-printmontage-900-buchse-452757'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0124.html" -w "124 %{http_code}\n" 'https://www.pollin.de/p/goobay-dc-adapterkabel-2-5-mm-dc-stecker-auf-dc-kupplung-weiss-3-m-563911'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0125.html" -w "125 %{http_code}\n" 'https://www.pollin.de/p/sonero-usb-c-kabel-spc-u200-015-60w-pd-1-5m-schwarz-714429'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0126.html" -w "126 %{http_code}\n" 'https://www.pollin.de/p/pimoroni-dual-nvme-base-fuer-raspberry-pi-5-725685'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0127.html" -w "127 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-hdmi-kabel-with-ethernet-7-5-m-562685'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0128.html" -w "128 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-hdmi-adapterkabel-hdmi-stecker-dvi-d-stecker-5-m-561143'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0129.html" -w "129 %{http_code}\n" 'https://www.pollin.de/p/arduino-uno-rev3-a000066-811361'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0130.html" -w "130 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-nullmodem-kabel-1-8-m-720396'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0131.html" -w "131 %{http_code}\n" 'https://www.pollin.de/p/blulaxa-led-lampe-48693-agl-e27-eek-e-7-w-810-lm-2700-k-2-stueck-537443'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0132.html" -w "132 %{http_code}\n" 'https://www.pollin.de/p/daylite-led-signalleuchte-kontrollleuchte-lsl-29230b-230-v-blau-532285'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0133.html" -w "133 %{http_code}\n" 'https://www.pollin.de/p/just-light-led-deckenleuchte-14053-79-15w-3000k-2200lm-warmweiss-ip20-holz-schwarz-522441'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0134.html" -w "134 %{http_code}\n" 'https://www.pollin.de/p/just-light-led-deckenleuchte-14680-16-weiss-15-w-2100-lm-cct-rgb-smart-home-522410'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0135.html" -w "135 %{http_code}\n" 'https://www.pollin.de/p/grundig-led-solar-ansteckleuchte-81x54x93-mm-539455'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0136.html" -w "136 %{http_code}\n" 'https://www.pollin.de/p/osram-led-fluter-100w-9000lm-3000k-1050-warmweiss-522217'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0137.html" -w "137 %{http_code}\n" 'https://www.pollin.de/p/osram-led-fluter-mit-sensor-20w-1800lm-6500k-1050-ip65-kaltweiss-522204'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0138.html" -w "138 %{http_code}\n" 'https://www.pollin.de/p/filmer-fahrradcomputer-40108-kabellos-21-funktionen-852242'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0139.html" -w "139 %{http_code}\n" 'https://www.pollin.de/p/argon-oled-modul-fuer-argon-one-v5-argonoledv5-811785'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0140.html" -w "140 %{http_code}\n" 'https://www.pollin.de/p/ansmann-led-taschenlampe-ansmann-daily-use-150b-150-lm-batteriebetrieben-521363'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0141.html" -w "141 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-usb-a-verbindungskabel-2-0-schwarz-0-5m-714151'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0142.html" -w "142 %{http_code}\n" 'https://www.pollin.de/p/goobay-usb-lader-65411-45-w-2-fach-1xc-pd-1xa-gan-schwarz-353266'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0143.html" -w "143 %{http_code}\n" 'https://www.pollin.de/p/enovalite-led-panel-36-w-3600-lm-eek-f-620x620-mm-3000-k-900-abstrahlwinkel-ugr-19-539507'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0144.html" -w "144 %{http_code}\n" 'https://www.pollin.de/p/blulaxa-led-netzteil-15-w-fuer-12-v-led-lampen-u-stripes-521826'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0145.html" -w "145 %{http_code}\n" 'https://www.pollin.de/p/mean-well-schaltnetzteil-apv-35-24-24-v-1-5-a-352158'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0146.html" -w "146 %{http_code}\n" 'https://www.pollin.de/p/optosupply-led-5mm-gelb-klar-1200mcd-12v-121673'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0147.html" -w "147 %{http_code}\n" 'https://www.pollin.de/p/kss-kabelverschraubung-m16-lichtgrau-5-bis-10-442772'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0148.html" -w "148 %{http_code}\n" 'https://www.pollin.de/p/just-light-led-deckenleuchte-14347-18-schwarz-29-w-3400-lm-3000-k-521435'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0149.html" -w "149 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-rj45-patchkabel-cat-7-rohkabel-u-utp-grau-0-5-m-740968'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0150.html" -w "150 %{http_code}\n" 'https://www.pollin.de/p/logilink-unterputz-steckdose-pa0262-usb-a-usb-c-742277'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0151.html" -w "151 %{http_code}\n" 'https://www.pollin.de/p/purelink-lautsprecherkabel-2x2-5-mm2-10m-transparent-cca-560949'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0152.html" -w "152 %{http_code}\n" 'https://www.pollin.de/p/osram-led-einbauleuchte-ultra-slim-22w-2000lm-3000k-ip20-warmweiss-oe-225-mm-warmweiss-522169'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0153.html" -w "153 %{http_code}\n" 'https://www.pollin.de/p/logilink-cat-5e-patchkabel-0-25m-schwarz-542292'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0154.html" -w "154 %{http_code}\n" 'https://www.pollin.de/p/raspberry-pi-iqaudio-dac-pro-rb-iq-sc0369-811666'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0155.html" -w "155 %{http_code}\n" 'https://www.pollin.de/p/chilitec-solar-led-wandleuchte-swl-as500-ip44-3000-k-pir-sensor-521778'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0156.html" -w "156 %{http_code}\n" 'https://www.pollin.de/p/luxula-led-unterbauleuchte-8w-eek-f-800lm-cct-ip20-dimmbar-weiss-55-cm-522632'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0157.html" -w "157 %{http_code}\n" 'https://www.pollin.de/p/osram-led-stiftsockellampe-pin32-g9-eek-f-3w-320lm-2700k-538160'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0158.html" -w "158 %{http_code}\n" 'https://www.pollin.de/p/osram-led-lampe-retrofit-1-w-e14-2700k-eek-d-136-lm-ip20-warmweiss-522238'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0159.html" -w "159 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-cat-6a-patchkabel-10-m-gelb-740097'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0160.html" -w "160 %{http_code}\n" 'https://www.pollin.de/p/pce-gummi-schutzkontaktkupplung-taurus2-mit-klappdeckel-schwarz-grau-553077'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0161.html" -w "161 %{http_code}\n" 'https://www.pollin.de/p/schuetzinger-sicherheits-pruefleitung-spl-2128-2-5-100-sw-831320'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0162.html" -w "162 %{http_code}\n" 'https://www.pollin.de/p/drucktaster-1-x-aus-ein-tastend-30-v-1-a-421514'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0163.html" -w "163 %{http_code}\n" 'https://www.pollin.de/p/loetoese-gerade-4-3-x-18-mm-100-stueck-452429'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0164.html" -w "164 %{http_code}\n" 'https://www.pollin.de/p/kopp-schutzkontakt-stecker-173002007-gross-mit-knickschutz-weiss-554336'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0165.html" -w "165 %{http_code}\n" 'https://www.pollin.de/p/nedis-smartlife-indoor-kamera-wifici08cwt-3mp-full-hd-1296p-nachtsicht-bewegungsmelder-weiss-581452'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0166.html" -w "166 %{http_code}\n" 'https://www.pollin.de/p/homematic-ip-156587a0-rauchwarnmelder-q-label-3-stueck-591964'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0167.html" -w "167 %{http_code}\n" 'https://www.pollin.de/p/intenso-dvd-r-spindel-doublelayer-25-stueck-722167'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0168.html" -w "168 %{http_code}\n" 'https://www.pollin.de/p/tfa-funk-wetterstation-life-weiss-35-1153-02-590600'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0169.html" -w "169 %{http_code}\n" 'https://www.pollin.de/p/pollin-polycarbonat-gehaeuse-122-x-120-x-55-mm-ip66-lichtgrau-460452'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0170.html" -w "170 %{http_code}\n" 'https://www.pollin.de/p/kohleschicht-widerstand-cf50p6r8w025-6-8-ohm-0-25-w-1-50-stueck-725589'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0171.html" -w "171 %{http_code}\n" 'https://www.pollin.de/p/logilink-rev-steckdosen-dimmer-pa0151-40-280-w-550374'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0172.html" -w "172 %{http_code}\n" 'https://www.pollin.de/p/delphi-wechselschalter-klemmanschluss-10a-250v-1-fach-rahmen-weiss-552846'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0173.html" -w "173 %{http_code}\n" 'https://www.pollin.de/p/sodastream-wassersprudler-duo-titan-umsteigerset-schwarz-694904'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0174.html" -w "174 %{http_code}\n" 'https://www.pollin.de/p/omeg-potentiometer-pc2g20bu-47-ko-stereo-linear-240737'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0175.html" -w "175 %{http_code}\n" 'https://www.pollin.de/p/filmer-fahrrad-reparaturset-863360'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0176.html" -w "176 %{http_code}\n" 'https://www.pollin.de/p/texas-instruments-tlc555cp-timer-c-mos-texas-instruments-101355'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0177.html" -w "177 %{http_code}\n" 'https://www.pollin.de/p/einhell-druckluft-saugstrahlpistole-503913'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0178.html" -w "178 %{http_code}\n" 'https://www.pollin.de/p/clatronic-elektrische-reinigungsbuerste-erb-3815-a-1200mah-li-ion-blau-grau-695112'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0179.html" -w "179 %{http_code}\n" 'https://www.pollin.de/p/ersa-loetspitze-0102cdlf16-sb-meisselfoermig-1-6-mm-840346'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0180.html" -w "180 %{http_code}\n" 'https://www.pollin.de/p/international-rectifier-leistungs-mosfet-irlb8748pbf-131318'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0181.html" -w "181 %{http_code}\n" 'https://www.pollin.de/p/rautronic-zwillingslitze-2x-0-14-mm2-braun-weiss-10-m-561805'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0182.html" -w "182 %{http_code}\n" 'https://www.pollin.de/p/minidrossel-2-2mh-110ma-rm5-7-5x11-mm-1-stueck-250566'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0183.html" -w "183 %{http_code}\n" 'https://www.pollin.de/p/shelly-wlan-schaltaktor-pro-4pm-40-a-bluetooth-lan-anschluss-messfunktion-590998'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0184.html" -w "184 %{http_code}\n" 'https://www.pollin.de/p/wiko-zink-spray-hell-510251'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0185.html" -w "185 %{http_code}\n" 'https://www.pollin.de/p/kohleschicht-widerstand-3-9-ko-100-stueck-221453'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0186.html" -w "186 %{http_code}\n" 'https://www.pollin.de/p/kartenhalter-jojo-rot-mit-guertelclip-695329'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0187.html" -w "187 %{http_code}\n" 'https://www.pollin.de/p/xcell-nimh-akku-industriezelle-4-5-aa-loet-printanschluss-1-2v-1-4ah-272082'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0188.html" -w "188 %{http_code}\n" 'https://www.pollin.de/p/zigarettenanzuender-stecker-12v-24v-8a-851765'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0189.html" -w "189 %{http_code}\n" 'https://www.pollin.de/p/eltako-stromstoss-gruppenschalter-egs12z-8-230vuc-16a-554855'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0190.html" -w "190 %{http_code}\n" 'https://www.pollin.de/p/fidlock-trinkflasche-twist-bottle-450-uni-base-852758'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0191.html" -w "191 %{http_code}\n" 'https://www.pollin.de/p/druckluft-verteiler-500630'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0192.html" -w "192 %{http_code}\n" 'https://www.pollin.de/p/gebro-steckdosenleiste-105670-6-fach-mit-flachstecker-flatplug-u-schalter-schwarz-554773'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0193.html" -w "193 %{http_code}\n" 'https://www.pollin.de/p/einhell-drucklufttacker-tc-pn-50-4137790-504999'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0194.html" -w "194 %{http_code}\n" 'https://www.pollin.de/p/masterproof-feuerstahl-3-teilig-512633'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0195.html" -w "195 %{http_code}\n" 'https://www.pollin.de/p/chilitec-abluftsteuerung-pilota-casa-funk-2000-w-553637'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0196.html" -w "196 %{http_code}\n" 'https://www.pollin.de/p/rautronic-schaltlitze-liyv-0-14-mm2-25-m-gruen-560376'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0197.html" -w "197 %{http_code}\n" 'https://www.pollin.de/p/handlauftraeger-edelstahl-rund-490404'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0198.html" -w "198 %{http_code}\n" 'https://www.pollin.de/p/ersa-gasloetset-independent-130-basic-set-840371'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0199.html" -w "199 %{http_code}\n" 'https://www.pollin.de/p/masterproof-drahtueberfalle-mit-oese-80mm-442208'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0200.html" -w "200 %{http_code}\n" 'https://www.pollin.de/p/pce-gummi-schutzkontaktstecker-taurus2-schwarz-rot-553065'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0201.html" -w "201 %{http_code}\n" 'https://www.pollin.de/p/rautronic-silikon-litze-1-5-mm2-rot-10-m-562007'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0202.html" -w "202 %{http_code}\n" 'https://www.pollin.de/p/einhell-e-case-einleger-stecknuesse-und-ratschen-370520-60-teilig-505275'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0203.html" -w "203 %{http_code}\n" 'https://www.pollin.de/p/ansmann-akku-ladegeraet-comfort-plus-352967'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0204.html" -w "204 %{http_code}\n" 'https://www.pollin.de/p/brueder-mannesmann-bit-satz-100-teilig-503724'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0205.html" -w "205 %{http_code}\n" 'https://www.pollin.de/p/drehknopf-oe27x15-mm-achse-oe6-mm-410188'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0206.html" -w "206 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-modular-verbinder-8p8c-crossover-720621'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0207.html" -w "207 %{http_code}\n" 'https://www.pollin.de/p/international-rectifier-leistungs-mosfet-irfz44zpbf-131295'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0208.html" -w "208 %{http_code}\n" 'https://www.pollin.de/p/kohleschicht-widerstand-56-o-100-stueck-220482'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0209.html" -w "209 %{http_code}\n" 'https://www.pollin.de/p/masterproof-gewindeschrauben-m6x30-mit-muttern-4-stueck-491291'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0210.html" -w "210 %{http_code}\n" 'https://www.pollin.de/p/saft-lithium-batterie-ls14500-aa-270101'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0211.html" -w "211 %{http_code}\n" 'https://www.pollin.de/p/bgs-technic-druckluftschlauch-3130-stecker-kupplung-10m-502188'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0212.html" -w "212 %{http_code}\n" 'https://www.pollin.de/p/econ-connect-wannenstecker-gerade-14-polig-451169'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0213.html" -w "213 %{http_code}\n" 'https://www.pollin.de/p/tuerkontakt-fensterkontakt-mit-25-cm-anschlusslitzen-10-w-braun-580569'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0214.html" -w "214 %{http_code}\n" 'https://www.pollin.de/p/st-microelectronics-transistor-tip127-pnp-darl-100v-5a-65w-to220-131472'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0215.html" -w "215 %{http_code}\n" 'https://www.pollin.de/p/centralsystems-reinigungskassette-fuer-kassettenrekorder-mit-reinigungsfluessigkeit-631232'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0216.html" -w "216 %{http_code}\n" 'https://www.pollin.de/p/fdk-corporation-fdk-lithium-batterie-cr-17335se-2-3a-zelle-3-v-1800-mah-272410'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0217.html" -w "217 %{http_code}\n" 'https://www.pollin.de/p/clatronic-elektromesser-em-3062-edelstahldoppelklingen-weiss-150w-695201'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0218.html" -w "218 %{http_code}\n" 'https://www.pollin.de/p/einhell-elektro-stab-heckenschere-saege-gc-hc-90-2046-t-871787'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0219.html" -w "219 %{http_code}\n" 'https://www.pollin.de/p/bgs-technic-automatischer-koerner-2070-502300'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0220.html" -w "220 %{http_code}\n" 'https://www.pollin.de/p/burg-waechter-schluesseltresor-key-safe-60-l-sb-694385'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0221.html" -w "221 %{http_code}\n" 'https://www.pollin.de/p/apa-pumpspruehflasche-31368-1-5-l-852912'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0222.html" -w "222 %{http_code}\n" 'https://www.pollin.de/p/texas-instruments-ne5532an-operationsverstaerker-dip-8-101275'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0223.html" -w "223 %{http_code}\n" 'https://www.pollin.de/p/sol-expert-loetbausatz-binaere-uhr-76334-811868'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0224.html" -w "224 %{http_code}\n" 'https://www.pollin.de/p/richwell-keramik-kondensator-1-nf-100-v-rm-5-20-201100'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0225.html" -w "225 %{http_code}\n" 'https://www.pollin.de/p/schuetzinger-abgreifklemme-sak-6674-ni-gn-831310'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0226.html" -w "226 %{http_code}\n" 'https://www.pollin.de/p/eltako-wechselstromzaehler-eva12-32a-591873'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0227.html" -w "227 %{http_code}\n" 'https://www.pollin.de/p/einhell-handkreissaege-te-ps-165-4331300-504997'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0228.html" -w "228 %{http_code}\n" 'https://www.pollin.de/p/gloria-rauchmelder-r-10-581159'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0229.html" -w "229 %{http_code}\n" 'https://www.pollin.de/p/red4power-rail-adapter-fuer-einbaumodul-dna1091-740829'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0230.html" -w "230 %{http_code}\n" 'https://www.pollin.de/p/international-rectifier-leistungs-mosfet-irfp250npbf-131345'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0231.html" -w "231 %{http_code}\n" 'https://www.pollin.de/p/luftpolsterbeutel-250x400-mm-polyethylen-transparent-442741'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0232.html" -w "232 %{http_code}\n" 'https://www.pollin.de/p/st-microelectronics-transistor-stmicroelectronics-darlington-bd682-130928'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0233.html" -w "233 %{http_code}\n" 'https://www.pollin.de/p/kingston-m-2-ssd-nv3-1tb-705122'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0234.html" -w "234 %{http_code}\n" 'https://www.pollin.de/p/shelly-wlan-schaltaktor-plus-2pm-2x-10-a-bluetooth-3-stueck-591296'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0235.html" -w "235 %{http_code}\n" 'https://www.pollin.de/p/keramik-zf-filter-250047'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0236.html" -w "236 %{http_code}\n" 'https://www.pollin.de/p/leiterplattenklemme-supu-256303-3-polig-rm-5-16-a-250-v-451888'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0237.html" -w "237 %{http_code}\n" 'https://www.pollin.de/p/saft-lithium-batterie-lsh-20-cnr-d-mit-u-loetfahne-3-6-v-13000-mah-272402'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0238.html" -w "238 %{http_code}\n" 'https://www.pollin.de/p/gp-lady-batterien-set-super-alkaline-2-stueck-272044'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0239.html" -w "239 %{http_code}\n" 'https://www.pollin.de/p/topstar-buerostuhl-eurostar-200-inkl-armlehnen-schwarz-891636'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0240.html" -w "240 %{http_code}\n" 'https://www.pollin.de/p/kopp-feuchtraum-serienschalter-563548001-grau-553483'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0241.html" -w "241 %{http_code}\n" 'https://www.pollin.de/p/donau-elektronik-miniaturbuchse-2-mm-schwarz-221-453664'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0242.html" -w "242 %{http_code}\n" 'https://www.pollin.de/p/sortiment-tantalkondensatoren-800021'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0243.html" -w "243 %{http_code}\n" 'https://www.pollin.de/p/siba-g-sicherung-6-3x32-1-6-a-700-v-superflink-260829'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0244.html" -w "244 %{http_code}\n" 'https://www.pollin.de/p/hammond-handgehaeuse-1599ebk-170-x-85-x-34-460414'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0245.html" -w "245 %{http_code}\n" 'https://www.pollin.de/p/schwaiger-z-winkel-fuer-solarmodul-sodm0040-4-stueck-273567'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0246.html" -w "246 %{http_code}\n" 'https://www.pollin.de/p/weicon-rost-schock-spray-400-ml-10000143-512600'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0247.html" -w "247 %{http_code}\n" 'https://www.pollin.de/p/econ-connect-modular-einbaubuchse-mit-anschlusslitzen-6p6c-541843'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0248.html" -w "248 %{http_code}\n" 'https://www.pollin.de/p/joy-it-modul-sen-hx711-01-hx711-mit-1kg-waegezelle-811417'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0249.html" -w "249 %{http_code}\n" 'https://www.pollin.de/p/filmer-frostschutzpruefer-18005-851533'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0250.html" -w "250 %{http_code}\n" 'https://www.pollin.de/p/schluesselringe-30mm-100-stueck-490279'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0251.html" -w "251 %{http_code}\n" 'https://www.pollin.de/p/logitech-g-gaming-maus-pro-x-superlight-schwarz-752597'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0252.html" -w "252 %{http_code}\n" 'https://www.pollin.de/p/logitech-g-gaming-maus-g502-hero-black-752600'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0253.html" -w "253 %{http_code}\n" 'https://www.pollin.de/p/rautronic-steuerleitung-liycy-4x0-14-mm2-grau-10-m-562000'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0254.html" -w "254 %{http_code}\n" 'https://www.pollin.de/p/boxenflansch-640389'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0255.html" -w "255 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-cinchadapter-kupplung-kupplung-1-fach-rot-450506'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0256.html" -w "256 %{http_code}\n" 'https://www.pollin.de/p/knipex-werkzeugrucksack-modular-x18-00-21-50-le-leer-512640'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0257.html" -w "257 %{http_code}\n" 'https://www.pollin.de/p/camelion-knopfzelle-ag13-2-st-271544'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0258.html" -w "258 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-hdmi-adapter-a-stecker-dvi-kupplung-720966'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0259.html" -w "259 %{http_code}\n" 'https://www.pollin.de/p/gleichstrommotor-tr-390-mit-ritzel-310699'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0260.html" -w "260 %{http_code}\n" 'https://www.pollin.de/p/grundig-knopfzelle-cr2016-5-stueck-273722'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0261.html" -w "261 %{http_code}\n" 'https://www.pollin.de/p/intenso-m-2-ssd-mi500-500gb-704799'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0262.html" -w "262 %{http_code}\n" 'https://www.pollin.de/p/goobay-batteriehalter-mit-schalter-270830'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0263.html" -w "263 %{http_code}\n" 'https://www.pollin.de/p/kippschalter-mts-201-a2-420433'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0264.html" -w "264 %{http_code}\n" 'https://www.pollin.de/p/zeitschaltuhr-zu-24a-870161'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0265.html" -w "265 %{http_code}\n" 'https://www.pollin.de/p/tfa-digitaler-timer-und-stoppuhr-99hours-38-2049-02-865929'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0266.html" -w "266 %{http_code}\n" 'https://www.pollin.de/p/rautronic-litze-h07v-k-6-mm2-10-m-gruen-gelb-562998'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0267.html" -w "267 %{http_code}\n" 'https://www.pollin.de/p/degson-klemmleiste-dg333k-3-5-05p-12-00ah-5-polig-blau-453120'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0268.html" -w "268 %{http_code}\n" 'https://www.pollin.de/p/metallschicht-widerstand-mf50p685w050-6-8-mega-ohm-0-5-w-1-50-stueck-725583'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0269.html" -w "269 %{http_code}\n" 'https://www.pollin.de/p/s-impuls-cinch-einbaubuchse-rot-6-mm-450026'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0270.html" -w "270 %{http_code}\n" 'https://www.pollin.de/p/sonero-funksteckdosen-set-1-sender-4-empfaenger-anthrazit-591217'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0271.html" -w "271 %{http_code}\n" 'https://www.pollin.de/p/stromverteiler-platine-4-fach-mit-sicherungen-452468'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0272.html" -w "272 %{http_code}\n" 'https://www.pollin.de/p/vierkant-antriebsriemen-1-2-mm-oe-22-mm-35-mm-310675'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0273.html" -w "273 %{http_code}\n" 'https://www.pollin.de/p/pancontrol-multimeter-pan-minimeter-2-831267'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0274.html" -w "274 %{http_code}\n" 'https://www.pollin.de/p/icy-box-clonestation-dockingstation-ib-2915mscl-c31-m-2-nvme-sata-2-5-3-5-ssd-hdd-704832'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0275.html" -w "275 %{http_code}\n" 'https://www.pollin.de/p/mini-wippenschalter-1-pol-i-0-gruen-beleuchtet-12-v-16-a-421013'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0276.html" -w "276 %{http_code}\n" 'https://www.pollin.de/p/mcpower-schalter-und-steckdosen-set-flair-einfamilienhaus-matt-schwarz-95-teilig-555021'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0277.html" -w "277 %{http_code}\n" 'https://www.pollin.de/p/goobay-bnc-einbaubuchse-loetanschluss-9-1-mm-450423'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0278.html" -w "278 %{http_code}\n" 'https://www.pollin.de/p/bosch-akku-pba-18v-2500mah-272983'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0279.html" -w "279 %{http_code}\n" 'https://www.pollin.de/p/kinzo-gartenschlauch-set-1-2-30-m-871932'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0280.html" -w "280 %{http_code}\n" 'https://www.pollin.de/p/samsung-m-2-ssd-990-evo-1tb-705016'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0281.html" -w "281 %{http_code}\n" 'https://www.pollin.de/p/masterproof-holzbohrer-satz-in-kunststoffbox-3-10-mm-8-teilig-502911'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0282.html" -w "282 %{http_code}\n" 'https://www.pollin.de/p/grundig-fieberthermometer-mdi231-693285'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0283.html" -w "283 %{http_code}\n" 'https://www.pollin.de/p/samsung-smartphone-galaxy-a16-4g-128gb-light-green-543654'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0284.html" -w "284 %{http_code}\n" 'https://www.pollin.de/p/pollin-abs-gehaeuse-4u63090804437-89x75x41-mm-ip65-glasklarer-deckel-460975'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0285.html" -w "285 %{http_code}\n" 'https://www.pollin.de/p/goobay-koaxial-winkelkupplung-570158'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0286.html" -w "286 %{http_code}\n" 'https://www.pollin.de/p/goobay-tools-metall-steinbohrer-set-77848-1-5-10-mm-17-teilig-505194'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0287.html" -w "287 %{http_code}\n" 'https://www.pollin.de/p/batteriepolklemmen-set-isoliert-200a-851774'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0288.html" -w "288 %{http_code}\n" 'https://www.pollin.de/p/goobay-smartphone-halter-47145-548480'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0289.html" -w "289 %{http_code}\n" 'https://www.pollin.de/p/kidsbit-intelligentes-stem-verkehrssystem-725707'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0290.html" -w "290 %{http_code}\n" 'https://www.pollin.de/p/kohleschicht-widerstand-820-ko-100-stueck-220479'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0291.html" -w "291 %{http_code}\n" 'https://www.pollin.de/p/pce-cee-stecker-grip-tt-midnight-32-a-5-polig-552691'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0292.html" -w "292 %{http_code}\n" 'https://www.pollin.de/p/goobay-steckdosenleiste-5-fach-551830'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0293.html" -w "293 %{http_code}\n" 'https://www.pollin.de/p/garmin-smartwatch-forerunner-165-music-grau-543659'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0294.html" -w "294 %{http_code}\n" 'https://www.pollin.de/p/modulgehaeuse-abs-160x110x90-mm-ip65-lichtgrau-460315'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0295.html" -w "295 %{http_code}\n" 'https://www.pollin.de/p/chilitec-fehlerstromschutzadapter-ct-rcd-ip44-554111'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0296.html" -w "296 %{http_code}\n" 'https://www.pollin.de/p/intenso-sdxc-card-3421490-64-gb-class-10-uhs-i-723078'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0297.html" -w "297 %{http_code}\n" 'https://www.pollin.de/p/hochstrom-einbaustecker-set-2-polig-oe-19-mm-mit-abdeckkappe-452448'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0298.html" -w "298 %{http_code}\n" 'https://www.pollin.de/p/alpina-eisportionierer-edelstahl-spuelmaschinenfest-23x6x3-5cm-695430'
sleep 0.35
curl -sL -A "$UA" --max-time 35 -o "$OUT/p_0299.html" -w "299 %{http_code}\n" 'https://www.pollin.de/p/leiterplattenklemme-supu-256307-7-polig-rm-5-16-a-250-v-451892'
sleep 0.35
echo DONE_POLLIN