resource "digitalocean_droplet" "vpn" {
  image     = var.image
  name      = var.name
  region    = var.region
  size      = var.droplet_size
  ssh_keys  = [data.digitalocean_ssh_key.terraform.id]
  user_data = file("${path.module}/../cloud-init/user-data.yaml")

  tags = [var.name, var.environment]

  connection {
    host    = self.ipv4_address
    type    = "ssh"
    user    = "root"
    agent   = true
    timeout = "10m"
  }

  provisioner "remote-exec" {
    inline = [
      "mkdir -p /opt/lockhaven/deploy",
    ]
  }

  provisioner "file" {
    source      = "${path.module}/../../deploy/production.compose.yml"
    destination = "/opt/lockhaven/deploy/production.compose.yml"
  }

  provisioner "file" {
    source      = "${path.module}/../../.env.deploy"
    destination = "/opt/lockhaven/.env.deploy"
  }

  provisioner "file" {
    source      = "${path.module}/../systemd/vpnctl"
    destination = "/tmp/vpnctl"
  }

  provisioner "remote-exec" {
    inline = [
      "install -m 0755 /tmp/vpnctl /usr/local/sbin/vpnctl",
    ]
  }
}

resource "digitalocean_firewall" "vpn" {
  name = "${var.name}-firewall"

  droplet_ids = [digitalocean_droplet.vpn.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowed_cidrs
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "udp"
    port_range       = "51820"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
