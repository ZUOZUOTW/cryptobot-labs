data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_kms_key" "credentials" {
  description             = "CryptoBot Labs WEEX credential envelope key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "credentials" {
  name          = "alias/cryptobot-labs-production-weex"
  target_key_id = aws_kms_key.credentials.key_id
}

resource "aws_secretsmanager_secret" "executor_runtime" {
  name                    = "cryptobot-labs/production/executor-runtime"
  description             = "Runtime configuration; create the secret value outside Terraform so plaintext never enters state."
  kms_key_id              = aws_kms_key.credentials.arn
  recovery_window_in_days = 30
}

resource "aws_iam_role" "executor" {
  name = "cryptobot-labs-production-executor"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.executor.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "executor" {
  name = "cryptobot-labs-executor-minimum"
  role = aws_iam_role.executor.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "CredentialEnvelope"
        Effect   = "Allow"
        Action   = ["kms:DescribeKey", "kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.credentials.arn
      },
      {
        Sid      = "RuntimeConfiguration"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.executor_runtime.arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "executor" {
  name = "cryptobot-labs-production-executor"
  role = aws_iam_role.executor.name
}

resource "aws_security_group" "executor" {
  name        = "cryptobot-labs-production-executor"
  description = "HTTPS callback ingress and tightly scoped executor egress"
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "HTTPS to WEEX, Supabase and AWS APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Postgres TLS to Supabase IPv4 session pooler"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "VPC DNS over UDP"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }

  egress {
    description = "VPC DNS over TCP"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }
}

resource "aws_vpc_security_group_ingress_rule" "https_cloudflare" {
  for_each          = var.enable_public_https ? var.cloudflare_ipv4_cidrs : toset([])
  security_group_id = aws_security_group.executor.id
  description       = "HTTPS from Cloudflare proxy ${each.value}"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = each.value
}

resource "aws_instance" "executor" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids = [aws_security_group.executor.id]
  iam_instance_profile   = aws_iam_instance_profile.executor.name
  monitoring             = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = 20
  }

  tags = { Name = "cryptobot-labs-production-executor" }
}

resource "aws_eip" "executor" {
  domain   = "vpc"
  instance = aws_instance.executor.id
  tags     = { Name = "cryptobot-labs-production-egress" }
}

resource "cloudflare_dns_record" "api" {
  count   = var.manage_cloudflare_dns ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = var.api_hostname
  type    = "A"
  content = aws_eip.executor.public_ip
  ttl     = 1
  proxied = true
  comment = "Cloudflare-proxied CryptoBot Labs fixed-IP production executor"
}
