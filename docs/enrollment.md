# Enrollment

1. Admin creates an enrollment token.
2. The device generates its WireGuard keypair locally.
3. The client submits metadata and its public key to `POST /api/enroll`.
4. The API allocates a VPN `/32`, creates the device row, issues a device
   check-in secret, and returns the client-side WireGuard settings.
5. When SSH is requested, the API also returns an SSH username and public key
   and stores the matching private key for Console remote access.
6. The Linux installer writes that public key into `authorized_keys`.
7. When VNC (or RDP) is requested with an optional `password`, the API stores
   that password encrypted for Console remote sessions. The Linux installer
   registers VNC on port 5900 and pushes `/etc/manatee/vnc.password.txt` (or
   `LOCKHAVEN_VNC_PASSWORD`) when present.
8. The agent includes that secret on `POST /api/agent/check-in` so the API can
   accept status updates for the enrolled device.
9. Optional check-in fields `metrics` and `packages` report disk, memory, CPU
   load, uptime, network counters, WireGuard handshake age, and installed
   software. Existing hostname and secret fields stay required.
10. Check-in responses may include `desired_agent_version`, `download_url`, and
    `commands`. Commands are a closed whitelist (`reboot`, `restart`, `update`)
    — never a shell or SSH string. The client refuses anything else and reports
    the result on the next check-in.
11. The worker reconciles the server peer and status tables.

The Linux endpoint agent is a static binary (`apps/lockhaven-agent`). It
attaches to a device Hub already has, or enrolls a new one, then installs a
systemd service:

```
curl -fsSL <hub>/install/install-lockhaven-agent.sh | sudo LOCKHAVEN_TOKEN=<token> LOCKHAVEN_BASE_URL=<hub> bash
```

On a listed device the installer binds to that record and leaves the existing
tunnel in place. It only calls `POST /api/enroll` when Hub has no match.
Local `/var/lib/lockhaven/agent.json` is enough to start the service without
calling Hub again.

From a device page in Console, the Agent tab creates a Linux install command
that includes `LOCKHAVEN_DEVICE_ID` so attach binds that listing even when
hostname or serial would be ambiguous. The tab also links the Linux agent
downloads from `/install/lockhaven-agent-linux-amd64` and `…-arm64`.

`POST /api/agent/attach` issues a new check-in secret for the matched device.
`POST /api/enroll` refuses with `device_exists` when the host already matches
inventory.

The TypeScript client in `apps/agent` remains a protocol reference. Windows
and macOS still use that path until those installers ship the Go binary.

For Windows devices, the enrollment script can generate the keypair, call the
API over your app hostname, install WireGuard if needed, import the tunnel,
and start it.

## Android

Android devices cannot run the Linux installer on-device. Use the operator-side
script served at `/install/enroll-android.sh`:

1. Create an enrollment token in the Console.
2. On a Mac or Linux workstation with `wg`, `curl`, and `python3` (optional
   `qrencode`), run the Android install command from the Console.
3. The script calls `POST /api/enroll` with `os_family: android`, allocates an
   address from the Android VPN pool (`10.80.60.0/24`), and writes a
   `lockhaven-<hostname>.conf` (plus a QR image when `qrencode` is available).
4. On the device, open the official WireGuard app and import the tunnel from
   file or QR code. Activate the tunnel.
5. Remote screen access is outside Console (for example `adb` / `scrcpy` over
   the VPN). Enrollment registers no SSH/VNC services.

The script does not bring up a WireGuard interface on the workstation — the
config is only for the Android device.

## Imaging tokens (no site)

Tokens can omit a site. Use a reusable shared token with no site when mass
imaging systems before you know their final location. Enrollment still creates
the device, allocates a VPN address, authenticates the tunnel, and installs SSH
access so remote sessions work out of the box. Assign the device to a site later
from the Console.

Imaging enrollments share one organization SSH keypair. Every Linux host that
enrolls with an imaging token gets the same public key in `authorized_keys`, and
Console sessions use the matching private key. That means you can reach every
imaged device after mass enrollment without per-host key setup.

Imaging tokens do not expire. Revoke them when they should stop working. Site
tokens still require an expiration date.

Only one active shared imaging token is allowed per organization at a time.
Shared site tokens are still limited to one active token per site.

## SSH keys

Sites get an SSH keypair automatically when created. Organizations get an
imaging SSH keypair automatically when you create an imaging token or enroll
without a site. Enrollment installs the matching public key on Linux hosts with
no operator steps. Console sessions use the stored private key.
