variable "aws_region" {
  description = "AWS region for the executor and KMS key."
  type        = string
  default     = "ap-northeast-1"
}

variable "instance_type" {
  description = "Executor instance size."
  type        = string
  default     = "t3.small"
}

variable "api_hostname" {
  description = "Production API hostname registered with WEEX."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", var.api_hostname))
    error_message = "api_hostname must be a valid lowercase DNS hostname."
  }
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID that owns api_hostname."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be a 32-character hexadecimal Cloudflare zone ID."
  }
}

variable "manage_cloudflare_dns" {
  description = "Create api_hostname in Cloudflare only after the TLS endpoint is installed."
  type        = bool
  default     = false
}

variable "enable_public_https" {
  description = "Open inbound TCP/443 only to the current Cloudflare HTTP proxy ranges."
  type        = bool
  default     = false
}

variable "cloudflare_ipv4_cidrs" {
  description = "Cloudflare HTTP proxy IPv4 ranges from https://www.cloudflare.com/ips-v4."
  type        = set(string)
  default = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ]

  validation {
    condition = length(var.cloudflare_ipv4_cidrs) > 0 && alltrue([
      for cidr in var.cloudflare_ipv4_cidrs :
      can(cidrnetmask(cidr)) && !can(regex(":", cidr))
    ])
    error_message = "cloudflare_ipv4_cidrs must contain valid IPv4 CIDR ranges."
  }
}
