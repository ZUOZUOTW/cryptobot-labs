#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_ACCOUNT_ID="148905583129"
readonly AWS_REGION="ap-northeast-1"
readonly ROLE_ARN="arn:aws:iam::${EXPECTED_ACCOUNT_ID}:role/CryptoBotLabsProvisioner"
readonly TF_DATA_DIR="/tmp/cryptobot-labs-terraform-data"
export AWS_PAGER=""
export TF_DATA_DIR

actual_account_id="$(aws sts get-caller-identity --query Account --output text)"
if [[ "${actual_account_id}" != "${EXPECTED_ACCOUNT_ID}" ]]; then
  echo "Refusing to verify unexpected AWS account ${actual_account_id}." >&2
  exit 1
fi

caller_arn="$(aws sts get-caller-identity --query Arn --output text)"
if [[ "${caller_arn}" == "arn:aws:iam::${EXPECTED_ACCOUNT_ID}:root" ]]; then
  echo "AWS root cannot assume roles; using the current CloudShell session for this one-time verification." >&2
else
  credentials="$(aws sts assume-role \
    --role-arn "${ROLE_ARN}" \
    --role-session-name CryptoBotLabsTerraformVerify \
    --duration-seconds 3600 \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
    --output text)"
  read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<<"${credentials}"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
fi
export AWS_REGION

instance_id="$(terraform output -raw executor_instance_id)"
kms_key_arn="$(terraform output -raw kms_key_arn)"
secret_arn="$(terraform output -raw runtime_secret_arn)"
security_group_id="$(aws ec2 describe-instances --instance-ids "${instance_id}" --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)"
volume_id="$(aws ec2 describe-instances --instance-ids "${instance_id}" --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text)"

aws ec2 describe-instances \
  --instance-ids "${instance_id}" \
  --query 'Reservations[0].Instances[0].{InstanceId:InstanceId,State:State.Name,Type:InstanceType,PublicIp:PublicIpAddress,ImdsTokens:MetadataOptions.HttpTokens,Monitoring:Monitoring.State,VolumeId:BlockDeviceMappings[0].Ebs.VolumeId}'
aws ec2 describe-volumes \
  --volume-ids "${volume_id}" \
  --query 'Volumes[0].{Encrypted:Encrypted,SizeGiB:Size,Type:VolumeType,State:State}'
aws ec2 describe-security-groups \
  --group-ids "${security_group_id}" \
  --query 'SecurityGroups[0].{GroupId:GroupId,Ingress:IpPermissions,Egress:IpPermissionsEgress}'
aws kms get-key-rotation-status --key-id "${kms_key_arn}"
aws secretsmanager describe-secret \
  --secret-id "${secret_arn}" \
  --query '{ARN:ARN,Name:Name,KmsKeyId:KmsKeyId,LastChangedDate:LastChangedDate}'
aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=${instance_id}" \
  --query 'InstanceInformationList[0].{InstanceId:InstanceId,PingStatus:PingStatus,Platform:PlatformName,AgentVersion:AgentVersion}'
