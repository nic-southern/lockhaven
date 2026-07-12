# Enrollment

1. Admin creates an enrollment token.
2. The device generates its WireGuard keypair locally.
3. The client submits metadata and its public key to `POST /api/enroll`.
4. The API allocates a VPN `/32`, creates the device row, issues a device
   check-in secret, and returns the client-side WireGuard settings.
5. The agent includes that secret on `POST /api/agent/check-in` so the API can
   accept status updates for the enrolled device.
6. The worker reconciles the server peer and status tables.

For Windows devices, the enrollment script can generate the keypair, call the
API over your app hostname, install WireGuard if needed, import the tunnel,
and start it.

## Imaging tokens (no site)

Tokens can omit a site. Use a reusable shared token with no site when mass
imaging systems before you know their final location. Enrollment still creates
the device, allocates a VPN address, and authenticates the tunnel. Assign the
device to a site later from the Console.

Imaging tokens do not expire. Revoke them when they should stop working. Site
tokens still require an expiration date.

Only one active shared imaging token is allowed per organization at a time.
Shared site tokens are still limited to one active token per site.
