terraform {
  required_version = ">= 1.8.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Authentication is read from CLOUDFLARE_API_TOKEN. The token only needs DNS
# edit permission for the CryptoBot Labs zone and must never enter tfvars/state.
provider "cloudflare" {}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "cryptobot-labs"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}
