# Threat Model

- Better Auth protects the admin UI, and the app still enforces authorization.
- Client devices only receive a `/32` and cannot route general traffic through
  the VPN.
- Client-to-client traffic is denied.
- Raw VNC/RDP/SSH are not exposed publicly.
- Secrets, tunnel credentials, Terraform state, and private keys stay out of
  git.
