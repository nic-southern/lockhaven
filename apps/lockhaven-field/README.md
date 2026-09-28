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
- Add asset (serial-first, suggested tracking tag)
- Find by scan (HID keyboard wedge / paste into the scan field)
- Container: set site on a container (Hub cascades children + linked device)
- Item: reassign container via `setParent` (search by tag/serial/name)
- Full-page navigation for assets and containers (no sidebar sheets)

## Deferred

- Camera barcode on desktop (HID wedge is the primary scan path)
- USB / Brother label print (laptop helper remains the print path)
- Passkey quick unlock and device-grant pairing
- Offline write queue

## Develop

```bash
flutter analyze
flutter test
```
