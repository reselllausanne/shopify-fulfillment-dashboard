#!/usr/bin/env bash
#
# Installe CUPS + client `lp` sur un VPS Debian/Ubuntu pour que l’auto-print
# (étiquettes Swiss Post / bon Decathlon) puisse parler à une imprimante **réseau**
# (Brother, HP, etc.). Les **noms de files** restent dans le `.env` :
#   SWISS_POST_PRINTER_NAME
#   SWISS_POST_PRINTER_MEDIA
#   DECATHLON_PACKING_SLIP_PRINTER_NAME
#   DECATHLON_PACKING_SLIP_PRINTER_MEDIA
#
# Usage (root sur le VPS) :
#   sudo bash scripts/vps-cups-print-setup.sh
#
# Ensuite, enregistrer chaque imprimante (une fois) — exemple IPP vers la machine
# qui expose l’imprimante (IP fixe recommandé) :
#
#   lpadmin -p Brother_QL_810W -E -v ipp://192.168.1.50/ipp/print -m everywhere
#   lpadmin -p HP_Smart_Tank_5100 -E -v ipp://192.168.1.51/ipp/print -m everywhere
#
# Vérifier les noms exacts pour le .env :
#   lpstat -p
#
set -euo pipefail

if [[ "${EUID:-}" -ne 0 ]]; then
  echo "Relance en root : sudo bash $0" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Ce script cible apt (Debian/Ubuntu). Sur Alpine : apk add cups cups-client" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y cups cups-client

# Démarrer CUPS (socket + service selon distro)
if systemctl is-system-running >/dev/null 2>&1; then
  systemctl enable cups.socket cups.service 2>/dev/null || true
  systemctl restart cups.service 2>/dev/null || systemctl restart cups.socket 2>/dev/null || true
fi

# Process Node (PM2/systemd) doit pouvoir soumettre des jobs
DEPLOY_USER="${SUDO_USER:-${USER:-root}}"
if id "$DEPLOY_USER" &>/dev/null; then
  usermod -aG lp,sys "$DEPLOY_USER" 2>/dev/null || true
fi
if id www-data &>/dev/null; then
  usermod -aG lp www-data 2>/dev/null || true
fi

echo ""
echo "=== CUPS installé. Prochaines étapes ==="
echo "1) Ajouter les imprimantes réseau (exemples ci-dessus avec lpadmin -p ... -v ipp://...)"
echo "2) lpstat -p   → copier le nom exact de file dans .env"
echo "3) Redémarrer l’app Node / PM2 pour prendre en compte le groupe lp si besoin"
echo "4) Tester : sudo -u $DEPLOY_USER lp -d NOM_FILE /chemin/vers/test.pdf"
echo ""
echo "Pare-feu : le VPS doit joindre l’IPP de l’imprimante (souvent 631/tcp sur la box LAN)."
echo "Si l’imprimante n’est pas routée depuis le datacenter, utiliser un VPN ou un tunnel."
