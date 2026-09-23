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

## Every packing PC (colleague — manual, once)

Send them **only** `override.crt` (same file as the admin Mac).

### macOS
1. Quit QZ Tray.
2. Copy `override.crt` into:
   `/Applications/QZ Tray.app/Contents/Resources/override.crt`
   (replace if present)
3. Start QZ Tray again.

### Windows
1. Quit QZ Tray.
2. Copy `override.crt` into:
   `C:\Program Files\QZ Tray\override.crt`
3. Start QZ Tray (as admin if needed).

Then open the **VPS `/scan`** page → **Configurer ce poste** (paper size) → **Activate**.

## What you do NOT send colleagues
- Private key (`private-key.pem`) — stays on the **server** only.
- They do not need Terminal or VPS access.

## Check
`/scan` status should show signature serveur OK after Activate. First connect may still ask Allow once if Site Manager allowlist is empty — click **Allow** + **Remember**.
