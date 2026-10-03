# Lockhaven Field

Desktop field technician app for Lockhaven inventory work on site visits.

## Platforms

One Flutter codebase with **Linux**, **Windows**, and **macOS** targets.

## Download (operators)

CI packages Field on every push. After a `main` deploy, Hub serves the same
files next to the agent binaries:

| File                        | URL                                           |
| --------------------------- | --------------------------------------------- |
| Mac (Apple silicon)         | `/install/lockhaven-field-macos-arm64.zip`    |
| Linux (x86_64)              | `/install/lockhaven-field-linux-amd64.tar.gz` |
| Windows (x86_64)            | `/install/lockhaven-field-windows-amd64.zip`  |
| Tape printer tool installer | `/install/install-ptouch-print.sh`            |

Console: **Settings → Labels → Field app**.

PR / CI runs also upload GitHub Actions artifacts named
`lockhaven-field-macos`, `lockhaven-field-linux`, and `lockhaven-field-windows`.

### Warehouse Mac (download)

1. Download **Field for Mac** from Console (or the Actions artifact). Unzip.
2. Drag **Lockhaven Field** to Applications (or run it from Downloads).
3. First open: right-click → **Open** (ad-hoc signature; Gatekeeper may warn).
4. Enter the **Console address** (your Hub URL) and sign in with the browser.
5. Plug the PT-D460BT / PT-D460BTVP in over **USB**. Leave Brother P-touch
   Editor closed.
6. **Print** uses the helper **inside the app** (private CPython + venv with
   Pillow/qrcode + DejaVu fonts). You do **not** need Homebrew Python.
7. If print says the tape printer tool is missing, run the one-time installer
   (Homebrew is fine for _this_ binary only). The installer clones Dominic
   Radermacher’s git (`git.familie-radermacher.ch`; a full clone, not
   `--depth 1`) and installs to `~/.local/bin`:
   ```bash
   brew install cmake libusb libgd pkg-config gettext argp-standalone
   chmod +x ./install-ptouch-print.sh
   ./install-ptouch-print.sh   # → ~/.local/bin/ptouch-print
   export PATH="$HOME/.local/bin:$PATH"
   ptouch-print --list-supported | grep -i D460   # expect PT-D460BT
   ptouch-print --info
   ```
   CI often bundles `ptouch-print` inside the app as well; Field looks there
   first, then `~/.local/bin`.

Set repository variable `FIELD_HUB_BASE_URL` if you want CI-built apps to
pre-fill the Console address. Operators can still edit it on the sign-in
screen.

### Warehouse Mac (developers / `flutter run`)

Use this only when you are changing Field itself.

1. **Xcode** from the App Store, then `xcode-select --install` if prompted.
2. **Flutter** stable 3.24+ (`flutter doctor`; desktop macOS enabled).
3. Optional print from a checkout (not needed for the downloaded `.app`):
   ```bash
   brew install python cmake libusb libgd pkg-config gettext argp-standalone
   brew install --cask font-dejavu
   ./scripts/install-ptouch-print.sh
   ptouch-print --list-supported | grep -i D460   # expect PT-D460BT
   ```
4. Run:
   ```bash
   cd apps/lockhaven-field
   flutter pub get
   flutter run -d macos \
     --dart-define=HUB_BASE_URL=https://your-console.example \
     --dart-define=LABEL_PRINT_SCRIPT=$PWD/../../scripts/print-asset-labels.sh
   ```

Release `.app` with bundled label tools (ad-hoc signed; no Apple team):

```bash
flutter build macos --release \
  --dart-define=HUB_BASE_URL=https://your-console.example
# from repo root:
./scripts/package-lockhaven-field.sh macos
# → dist/field/lockhaven-field-macos-arm64.zip (on Apple silicon)
```

### macOS caveats

- **App Sandbox is off** for Debug and Release so Field can spawn the helper
  and reach USB via `ptouch-print`. This is intentional for warehouse dogfood,
  not App Store packaging.
- Signing is **ad-hoc** (`CODE_SIGN_IDENTITY = "-"`).
- First USB use may trigger a macOS privacy prompt; allow access for Field.
- Field prepends the app `label-tools/bin`, `~/.local/bin`, `/opt/homebrew/bin`,
  and `/usr/local/bin` when spawning the helper.
- Do not run a second copy of Brother’s editor against the same USB device.

---

## Run (Linux, from source)

```bash
# Install Flutter 3.24+ (stable), then:
cd apps/lockhaven-field
flutter pub get
flutter run -d linux \
  --dart-define=HUB_BASE_URL=https://your-console.example
```

Or unpack `/install/lockhaven-field-linux-amd64.tar.gz` and run
`./lockhaven-field/lockhaven_field`. Local Hub default is
`http://127.0.0.1:3000` when `HUB_BASE_URL` is omitted (edit Console address
on the sign-in screen).

## Sign-in

1. Enter the Console address if it is not already filled in.
2. App opens the system browser to Hub `/field/auth`.
3. Sign in with the same Console account (password, passkey, or SSO).
4. Hub redirects to a loopback callback with a one-time code.
5. App exchanges the code for a short-lived session token (stored under the
   app support directory with mode `600` on Unix).

No organization API keys and no enrollment tokens.

## Features (MVP)

- Sites list → site assets → asset detail (edit fields Hub already allows)
- **Add asset** / **Add folder** — serial-first items; folders named (cabinet, TRT, …)
- **Device model** search/dropdown on add and edit (Hub `deviceModels` catalog)
- **Save** or **Save & print** on add (print via local helper)
- **Settings** — choose the tape printer from devices on this computer
- Stay-in-flow after saving an item: scan the next serial without leaving the screen
  (device model stays selected for batch adds of the same type)
- Folder detail: **Add asset** into the folder, or find an existing item
- Find by scan (HID keyboard wedge / paste into the scan field)
- Container: set site on a container (Hub cascades children + linked device)
- Item: reassign folder via `setParent` (search by tag/serial/name)
- Full-page navigation for assets and containers (no sidebar sheets)

## Label printing (Linux / macOS USB)

Save & print / Print write a one-row CSV and run `print-asset-labels.sh` —
the same Pillow + DejaVu layout that passed the Brother spike.

**Downloaded Field (Mac/Linux):** the helper, private Python venv, and DejaVu
fonts live in `label-tools/` inside the app (or next to the Linux binary).
Field prefers that copy. `ptouch-print` is bundled when CI can build it;
otherwise install once with `install-ptouch-print.sh`.

**Printer selection:** Settings (bottom bar, also on sign-in) lists devices
from `ptouch-print --list-connected` plus `lsusb` / `system_profiler`. Compatible
tape printers are highlighted. The USB serial is stored and passed as
`PTOUCH_SERIAL` → `ptouch-print --serial`. Windows builds show that USB print
is not available.

**From a git checkout:** the helper creates `scripts/.venv-labels` on first
run. Requirements:

- `ptouch-print` on PATH (often `~/.local/bin`)
- `python3` (Linux: + `python3-venv`; Mac download does not need this)
- Printer on, USB connected (PT-D460BT / PT-D460BTVP)
- DejaVu fonts (bundled in downloads; checkout: `fonts-dejavu-core` or
  `brew install --cask font-dejavu`)

The helper passes `--precut` by default so chained labels waste less tape between
jobs. The first label still has ~23 mm of blank leader. Set `PTOUCH_PRECUT=0`
to disable.

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
- Intel Mac zip (CI currently packages Apple silicon on `macos-latest`)

## Develop

```bash
flutter analyze
flutter test
bash ../../scripts/test-label-helper-bundle.sh   # from apps/lockhaven-field, or repo root
# macOS compile + bundle (on a Mac):
flutter build macos --release
```
