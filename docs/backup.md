# Backups

Lockhaven stores two databases (control plane and session gateway), the hub
environment file, and the concentrator tunnel keys. Back them up together,
encrypted, and keep the passphrase off the host backup itself.

## What is included

`scripts/backup.sh` writes one encrypted archive containing:

- Control-plane dump (`control-plane.dump`)
- Session-gateway dump (`session-gateway.dump`) when `GUACAMOLE_DATABASE_URL` is set
- Hub environment file (`.env.deploy`, stored as `hub.env`)
- Files from `/etc/wireguard` (private key, public key, `wg0.conf`)

The archive is AES-256-CBC with PBKDF2 (`openssl enc`). The passphrase comes
from `BACKUP_PASSPHRASE` in the process environment. It is never logged.

## Host setup

1. Create `/opt/lockhaven/backup.env` with mode `600`:

   ```bash
   BACKUP_PASSPHRASE=<a long random secret>
   # Optional off-host copy once rclone is already configured on the host:
   # RCLONE_REMOTE=remote:bucket/lockhaven
   ```

   Do not put `BACKUP_PASSPHRASE` in `.env.deploy`. That file is part of the
   backup; the passphrase must stay outside it.

2. Install the daily timer:

   ```bash
   bash infra/systemd/install-backup.sh
   ```

   The installer copies `scripts/backup.sh` and `scripts/restore.sh` to
   `/opt/lockhaven/scripts` when those files are present next to the unit
   files.

3. Confirm a manual run:

   ```bash
   set -a
   . /opt/lockhaven/backup.env
   set +a
   DRY_RUN=1 bash /opt/lockhaven/scripts/backup.sh
   bash /opt/lockhaven/scripts/backup.sh
   ```

Archives land in `/var/backups/lockhaven/lockhaven-YYYYMMDDThhmmssZ.tar.enc`
(mode `600`). `LOCKHAVEN_BACKUP_KEEP` (default `14`) deletes older local
archives. When `RCLONE_REMOTE` is set, the new archive is copied with
`rclone copy` and no extra logging of credentials.

### Environment

| Variable                | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `BACKUP_PASSPHRASE`     | Required. Encryption secret.                                         |
| `LOCKHAVEN_ROOT`        | Hub directory (default `/opt/lockhaven`).                            |
| `LOCKHAVEN_ENV_FILE`    | Environment file to include (default `$LOCKHAVEN_ROOT/.env.deploy`). |
| `LOCKHAVEN_WG_DIR`      | Tunnel key directory (default `/etc/wireguard`).                     |
| `LOCKHAVEN_BACKUP_DIR`  | Archive directory (default `/var/backups/lockhaven`).                |
| `LOCKHAVEN_BACKUP_KEEP` | Local archives to retain (default `14`).                             |
| `RCLONE_REMOTE`         | Optional rclone destination.                                         |
| `DRY_RUN=1`             | Check tools and paths without writing an archive.                    |

## Restore

Restores are destructive. Take a fresh backup first if the host still has
usable data.

```bash
set -a
. /opt/lockhaven/backup.env
set +a
DRY_RUN=1 bash /opt/lockhaven/scripts/restore.sh /var/backups/lockhaven/lockhaven-YYYYMMDDThhmmssZ.tar.enc
bash /opt/lockhaven/scripts/restore.sh /var/backups/lockhaven/lockhaven-YYYYMMDDThhmmssZ.tar.enc
```

The script decrypts the archive, restores both dumps with `pg_restore
--clean --if-exists`, replaces `.env.deploy`, and writes tunnel key files
back to `/etc/wireguard`. Restart the Compose stack afterward.

If decryption fails, the passphrase is wrong or the file is not a Lockhaven
archive. The script does not print dump contents on failure.

## Safety

- Keep `backup.env` mode `600` and off shared disks that are not encrypted.
- Rotate `BACKUP_PASSPHRASE` by writing a new archive, then retiring the old
  passphrase only after you have confirmed a restore dry-run.
- Do not commit passphrases, dumps, `.env.deploy`, or WireGuard private keys.
