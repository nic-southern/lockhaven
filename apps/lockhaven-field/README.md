# Lockhaven Field

Desktop field technician app for Lockhaven inventory work on site visits.

## Platforms

One Flutter codebase with **Linux**, **Windows**, and **macOS** targets.

## Warehouse Mac (dogfood)

Short path for an Apple Silicon or Intel MacBook at the warehouse with a
Brother PT-D460BT / PT-D460BTVP on USB.

### One-time install

1. **Xcode** from the App Store (open once to accept the license), then:
   `xcode-select --install` if prompted for CLT.
2. **Flutter** stable 3.24+ (`flutter doctor`; desktop macOS enabled).
3. **Homebrew**, then:
   ```bash
   brew install python cmake libusb libgd pkg-config
   brew install --cask font-dejavu   # DejaVu → ~/Library/Fonts
   ```
4. Clone Lockhaven (or use this checkout) and install the tape tool:
   ```bash
   cd lockhaven   # repo root
   ./scripts/install-ptouch-print.sh   # → ~/.local/bin/ptouch-print
   export PATH="$HOME/.local/bin:$PATH"
   ptouch-print --list-supported | grep -i D460   # expect PT-D460BT
   ```
5. Plug the printer in over **USB** (Bluetooth is not this path). Leave Brother
   P-touch Editor closed so it does not claim the device. Confirm:
   ```bash
   ptouch-print --info
   ```

### Run Field

```bash
cd apps/lockhaven-field
flutter pub get
flutter run -d macos \
  --dart-define=HUB_BASE_URL=https://your-console.example \
  --dart-define=LABEL_PRINT_SCRIPT=$PWD/../../scripts/print-asset-labels.sh
```

Or build a local `.app` (ad-hoc signed; no Apple Developer account needed):

```bash
flutter build macos --debug
open build/macos/Build/Products/Debug/lockhaven_field.app
```

**Save & print** / **Print label** write a one-row CSV and run
`scripts/print-asset-labels.sh` (Python/Pillow + DejaVu → `ptouch-print`).
The helper auto-creates `scripts/.venv-labels` on first run.

Dry-run without the printer:

```bash
./scripts/print-asset-labels.sh --dry-run /path/to/labels.csv
```

### macOS caveats

- **App Sandbox is off** for Debug and Release so Field can spawn the helper
  and reach USB via `ptouch-print`. This is intentional for warehouse dogfood,
  not App Store packaging.
- Signing is **ad-hoc** (`CODE_SIGN_IDENTITY = "-"`). Gatekeeper may warn on
  first open of a copied `.app` — right-click → Open, or run from Terminal via
  `flutter run`.
- First USB use may trigger a macOS privacy prompt; allow access for the
  Terminal / Field process that launches `ptouch-print`.
- Field prepends `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` to
  PATH when spawning the helper (Apple Silicon Homebrew + Intel).
- Do not run a second copy of Brother’s editor against the same USB device.

---

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

## Label printing (Linux / macOS USB)

Save & print / Print write a one-row CSV and run
`scripts/print-asset-labels.sh` — the same Python/Pillow + DejaVu layout that
passed the Brother spike (readable text + QR). The helper creates
`scripts/.venv-labels` with pillow/qrcode on first run.

Requirements on the laptop:

- `ptouch-print` on PATH (often `~/.local/bin`; use `./scripts/install-ptouch-print.sh`)
- `python3` (macOS: Homebrew Python; Linux: + `python3-venv`)
- Printer on, USB connected (PT-D460BT / PT-D460BTVP)
- DejaVu fonts (Linux: `fonts-dejavu-core`; macOS: `brew install --cask font-dejavu`)

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
# macOS compile check (on a Mac):
flutter build macos --debug
```
