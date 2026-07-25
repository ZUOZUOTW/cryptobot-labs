output "executor_instance_id" { value = aws_instance.executor.id }
output "fixed_egress_ip" { value = aws_eip.executor.public_ip }
output "kms_key_arn" { value = aws_kms_key.credentials.arn }
output "runtime_secret_arn" { value = aws_secretsmanager_secret.executor_runtime.arn }
output "weex_oauth_callback" { value = "https://${var.api_hostname}/oauth/weex/callback" }
