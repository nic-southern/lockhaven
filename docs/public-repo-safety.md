# Public Repo Safety

- Commit `.env.example`, not real `.env` files.
- Never commit WireGuard private keys, Cloudflare tunnel credentials, SSH
  private keys, or database dumps.
- Use placeholder domains in examples.
- Generate admin, database, and remote-access secrets on first boot or from
  explicit environment variables.
- Run secret scanning in CI.
