output "droplet_ipv4_address" {
  value = digitalocean_droplet.vpn.ipv4_address
}

output "droplet_id" {
  value = digitalocean_droplet.vpn.id
}

output "firewall_id" {
  value = digitalocean_firewall.vpn.id
}
