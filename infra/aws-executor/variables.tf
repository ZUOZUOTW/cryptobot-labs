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
  description = "Open inbound TCP/443 only after the production TLS endpoint is installed."
  type        = bool
  default     = false
}
