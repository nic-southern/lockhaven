# Lockhaven Field

Desktop field technician app for Lockhaven inventory work on site visits.

## Platforms

One Flutter codebase with **Linux**, **Windows**, and **macOS** targets.

## Run (Linux)

```bash
# Install Flutter 3.24+ (stable), then:
cd apps/lockhaven-field
flutter pub get
flutter run -d linux \
  --dart-define=HUB_BASE_URL=https://your-console.example
```

Local Hub default is `http://127.0.0.1:3000` when `HUB_BASE_URL` is omitted.

## Sign-in

1. App opens the system browser to Hub `/field/auth`.
2. Sign in with the same Console account (password, passkey, or SSO).
3. Hub redirects to a loopback callback with a one-time code.
4. App exchanges the code for a short-lived session token (stored under the
   app support directory with mode `600` on Unix).

No organization API keys and no enrollment tokens.

## Features (MVP)

- Sites list → site assets → asset detail (edit fields Hub already allows)
- **Add asset** / **Add folder** — serial-first items; folders named (cabinet, TRT, …)
- **Save** or **Save & print** on add (print via local helper or Hub labels page)
- Stay-in-flow after saving an item: scan the next serial without leaving the screen
- Folder detail: **Add asset** into the folder, or find an existing item
- Find by scan (HID keyboard wedge / paste into the scan field)
- Container: set site on a container (Hub cascades children + linked device)
- Item: reassign folder via `setParent` (search by tag/serial/name)
- Full-page navigation for assets and containers (no sidebar sheets)

## Label printing (Linux USB)

Save & print / Print render the 18 mm label **inside Flutter** (QR + tag /
serial / company), then call `ptouch-print --image` over USB.

No Python / pillow / qrcode required for Field. Brother mobile SDKs are not
used (Android/iOS only). The Console CSV helper script remains for bulk export.

Requirements on the laptop:

- `ptouch-print` on PATH (often `~/.local/bin` from the Phase 0 spike)
- Printer on, USB connected (PT-D460BT / PT-D460BTVP)

```bash
flutter run -d linux \
  --dart-define=HUB_BASE_URL=https://your-console.example \
  --dart-define=PTOUCH_PRINT=$HOME/.local/bin/ptouch-print
```

## Deferred

- Camera barcode on desktop (HID wedge is the primary scan path)
- In-process USB print (helper remains the print path)
- Passkey quick unlock and device-grant pairing
- Offline write queue

## Develop

```bash
flutter analyze
flutter test
```
