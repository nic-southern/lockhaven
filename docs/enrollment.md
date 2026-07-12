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
9. The worker reconciles the server peer and status tables.

For Windows devices, the enrollment script can generate the keypair, call the
API over your app hostname, install WireGuard if needed, import the tunnel,
and start it.

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
