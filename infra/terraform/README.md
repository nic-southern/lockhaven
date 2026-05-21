# Terraform

This directory provisions a single DigitalOcean droplet for the management VPN.

## Files

- `provider.tf.example` - provider, token, and SSH key wiring
- `main.tf` - droplet and firewall resources
- `variables.tf` - deployment variables
- `outputs.tf` - droplet and firewall outputs
- `terraform.tfvars.example` - example values for a production deploy

## Quick Start

1. Install Terraform.
2. Copy `provider.tf.example` to `provider.tf`.
3. Use `/.env.stage` as the editable source of truth for droplet and hostname values.
4. Export `TF_VAR_do_token` or `DO_TOKEN`, and make sure the matching SSH private key is loaded in your agent.
5. Run `scripts/deploy-production.sh` from the repository root.

Terraform provisions the droplet, uploads `deploy/production.compose.yml`,
uploads the generated `/.env.deploy`, and installs `infra/systemd/vpnctl`.
