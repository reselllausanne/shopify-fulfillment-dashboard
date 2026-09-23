# QZ Tray silent print — free multi-machine (no Premium)

Premium ($749) is optional. Same result with a **demo/self cert** + `override.crt`
copied to every packing PC.

## Once (on any admin Mac)

1. Install + start [QZ Tray](https://qz.io/download/).
2. Menu → **Advanced** → **Site Manager** → **+** → **Create New**.
3. Yes / Yes / Yes (create + install + copy to `override.crt`).
4. Desktop folder **QZ Tray Demo Cert** contains:
   - `digital-certificate.txt`
   - `private-key.pem`
   - (and `override.crt` was installed on this Mac)

5. Put keys on the **server** (VPS `.env` or local `.env.local`):

```bash
# Escape newlines as \n in one line, or use a multiline secret store.
QZ_PUBLIC_CERT="$(cat digital-certificate.txt | awk 'NF{printf "%s\\n",$0}')"
QZ_PRIVATE_KEY="$(cat private-key.pem | awk 'NF{printf "%s\\n",$0}')"
```

Restart the web app after setting env.

## Every packing PC (colleague)

No env access needed. On the **VPS `/scan` page**:

1. Click **override.crt** (or wizard → Télécharger override.crt).
2. Quit QZ Tray.
3. Copy the file:

### macOS
`/Applications/QZ Tray.app/Contents/Resources/override.crt`

### Windows
`C:\Program Files\QZ Tray\override.crt`

4. Start QZ Tray → `/scan` → Configurer ce poste → Activate.

API: `GET /api/qz/override.crt` (public cert only — never the private key).

## What you do NOT send colleagues
- Private key (`private-key.pem`) — stays on the **server** only.
- They do not need Terminal or VPS access.

## Check
`/scan` status should show signature serveur OK after Activate. First connect may still ask Allow once if Site Manager allowlist is empty — click **Allow** + **Remember**.
