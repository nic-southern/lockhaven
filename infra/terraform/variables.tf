variable "name" {
  description = "Droplet name"
  type        = string
}

variable "environment" {
  description = "Environment label attached as a droplet tag"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
  default     = "nyc3"
}

variable "droplet_size" {
  description = "Droplet size slug"
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "image" {
  description = "Droplet image slug"
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "ssh_key_name" {
  description = "Name of the uploaded DigitalOcean SSH key"
  type        = string
}

variable "ssh_allowed_cidrs" {
  description = "CIDR ranges allowed to reach SSH"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
