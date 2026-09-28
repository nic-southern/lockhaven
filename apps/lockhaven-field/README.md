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
- **Device model** search/dropdown on add and edit (Hub `deviceModels` catalog)
- **Save** or **Save & print** on add (print via local helper or Hub labels page)
- Stay-in-flow after saving an item: scan the next serial without leaving the screen
  (device model stays selected for batch adds of the same type)
- Folder detail: **Add asset** into the folder, or find an existing item
- Find by scan (HID keyboard wedge / paste into the scan field)
- Container: set site on a container (Hub cascades children + linked device)
- Item: reassign folder via `setParent` (search by tag/serial/name)
- Full-page navigation for assets and containers (no sidebar sheets)

## Label printing (Linux USB)

Save & print / Print write a one-row CSV and run
`scripts/print-asset-labels.sh` — the same Python/Pillow + DejaVu layout that
passed the Brother spike (readable text + QR). The helper creates
`scripts/.venv-labels` with pillow/qrcode on first run.

Requirements on the laptop:

- `ptouch-print` on PATH (often `~/.local/bin`)
- `python3` + `python3-venv` (for the local helper venv)
- Printer on, USB connected (PT-D460BT / PT-D460BTVP)
- DejaVu fonts (`/usr/share/fonts/…/DejaVuSans*.ttf`) for crisp text

The helper passes `--precut` by default so chained labels waste less tape between
jobs. The first label still has ~23 mm of blank leader (print head to cutter gap
on the PT-D460BT). Set `PTOUCH_PRECUT=0` to disable.

```bash
flutter run -d linux \
  --dart-define=HUB_BASE_URL=https://your-console.example \
  --dart-define=LABEL_PRINT_SCRIPT=$PWD/../../scripts/print-asset-labels.sh
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
