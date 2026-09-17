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
9. Optional check-in fields `metrics`, `packages`, and `titles` report disk,
   memory, CPU load, uptime, network counters, WireGuard handshake age,
   installed packages, and game/cabinet titles (build, config hash, and whether
   the process is running). Existing hostname and secret fields stay required.
10. Check-in responses may include `desired_agent_version`, `download_url`, and
    `commands`. Commands are a closed whitelist (`reboot`, `restart`, `update`)
    — never a shell or SSH string. The client refuses anything else and reports
    the result on the next check-in.
11. The worker reconciles the server peer and status tables.

The Linux and Windows endpoint agent is a static binary (`apps/lockhaven-agent`).
It attaches to a device Hub already has, or enrolls a new one, then installs as
a service:

```
curl -fsSL <hub>/install/install-lockhaven-agent.sh | sudo LOCKHAVEN_TOKEN=<token> LOCKHAVEN_BASE_URL=<hub> bash
```

```powershell
$Token = "<token>"; $BaseUrl = "<hub>"; $Script = "$env:TEMP\install-lockhaven-agent.ps1"; Invoke-WebRequest -Uri "$BaseUrl/install/install-lockhaven-agent.ps1" -OutFile $Script; powershell.exe -ExecutionPolicy Bypass -File $Script -Token $Token -BaseUrl $BaseUrl
```

On a listed device the installer binds to that record and leaves the existing
tunnel in place. It only calls `POST /api/enroll` when Hub has no match.
Local agent state (`/var/lib/lockhaven/agent.json` on Linux,
`%ProgramData%\Lockhaven\agent.json` on Windows) is enough to start the service
without calling Hub again.

From a device page in Console, the Agent tab creates a Linux or Windows install
command that includes the device id so attach binds that listing even when
hostname or serial would be ambiguous. The tab also links agent downloads from
`/install/lockhaven-agent-linux-amd64`, `…-arm64`,
`/install/lockhaven-agent-windows-amd64.exe`, and `…-arm64.exe`.

The Enrollment tokens page is a full-width list. **New token** is in the
header. After create, and whenever you open a token, a side panel shows the
Linux and Windows agent commands (and the older tunnel-only `enroll-linux.sh`
and `enroll-windows.ps1` commands) plus the raw token. Hub stores the token hash
for auth plus an encrypted copy of the secret so those commands can be copied
later. Tokens created before that storage need a new secret issued once.

`POST /api/agent/attach` issues a new check-in secret for the matched device.
`POST /api/enroll` refuses with `device_exists` when the host already matches
inventory.

Optional `titles` on check-in is separate from package inventory. Linux agents
read a watch list from `LOCKHAVEN_TITLES_FILE`, or `/etc/lockhaven/titles.json`,
or `/var/lib/lockhaven/titles.json`. When that file is absent, the agent omits
`titles` and Hub keeps the last inventory. A sanitized watch list:

```json
{
  "titles": [
    {
      "key": "cabinet-a",
      "title": "Cabinet A",
      "process": "game-bin",
      "build_file": "/opt/game/BUILD",
      "config_path": "/opt/game/config.json"
    }
  ]
}
```

The TypeScript client in `apps/agent` remains a protocol reference. macOS still
uses that path until that installer ships the Go binary.

Windows installs the same Go agent as a Windows service (`LockhavenAgent`).
Attach never replaces an existing WireGuard tunnel. Greenfield enroll writes a
tunnel only when WireGuard is already present (the Windows installer installs
WireGuard if needed). Hub commands stay `reboot`, `restart`, and `update`.

For tunnel-only Windows enrollment (no agent), the enrollment script can
generate the keypair, call the API over your app hostname, install WireGuard if
needed, import the tunnel, and start it.

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
