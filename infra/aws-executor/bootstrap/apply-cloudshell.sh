#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_ACCOUNT_ID="148905583129"
readonly AWS_REGION="ap-northeast-1"
readonly ROLE_ARN="arn:aws:iam::${EXPECTED_ACCOUNT_ID}:role/CryptoBotLabsProvisioner"
readonly TF_DATA_DIR="/tmp/cryptobot-labs-terraform-data"
export TF_DATA_DIR

actual_account_id="$(aws sts get-caller-identity --query Account --output text)"
if [[ "${actual_account_id}" != "${EXPECTED_ACCOUNT_ID}" ]]; then
  echo "Refusing to apply in unexpected AWS account ${actual_account_id}." >&2
  exit 1
fi

caller_arn="$(aws sts get-caller-identity --query Arn --output text)"
if [[ "${caller_arn}" == "arn:aws:iam::${EXPECTED_ACCOUNT_ID}:root" ]]; then
  echo "AWS root cannot assume roles; using the current CloudShell session for this one-time apply." >&2
else
  credentials="$(aws sts assume-role \
    --role-arn "${ROLE_ARN}" \
    --role-session-name CryptoBotLabsTerraformApply \
    --duration-seconds 3600 \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
    --output text)"
  read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<<"${credentials}"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
fi
export AWS_REGION

if [[ ! -f production.tfplan ]]; then
  echo "production.tfplan is missing; run bootstrap-cloudshell.sh and review the plan first." >&2
  exit 1
fi

terraform apply production.tfplan
terraform output -json > production-outputs.json
echo "AWS production base infrastructure applied. Outputs: ${PWD}/production-outputs.json"
