#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_ACCOUNT_ID="148905583129"
readonly AWS_REGION="ap-northeast-1"
readonly ROLE_NAME="CryptoBotLabsProvisioner"
readonly ROLE_ARN="arn:aws:iam::${EXPECTED_ACCOUNT_ID}:role/${ROLE_NAME}"
readonly STATE_BUCKET="cryptobot-labs-terraform-state-${EXPECTED_ACCOUNT_ID}"
readonly TF_DATA_DIR="/tmp/cryptobot-labs-terraform-data"
export TF_DATA_DIR

actual_account_id="$(aws sts get-caller-identity --query Account --output text)"
if [[ "${actual_account_id}" != "${EXPECTED_ACCOUNT_ID}" ]]; then
  echo "Refusing to bootstrap unexpected AWS account ${actual_account_id}." >&2
  exit 1
fi

if ! aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --description "Short-lived Terraform provisioner for CryptoBot Labs production" \
    --assume-role-policy-document file://bootstrap/provisioner-trust.json \
    --tags Key=Application,Value=cryptobot-labs Key=Environment,Value=production Key=ManagedBy,Value=bootstrap \
    >/dev/null
fi

aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name CryptoBotLabsTerraformIamBoundary \
  --policy-document file://bootstrap/provisioner-iam-policy.json

if ! command -v terraform >/dev/null 2>&1; then
  sudo dnf install -y dnf-plugins-core >/dev/null
  sudo dnf config-manager --add-repo https://rpm.releases.hashicorp.com/AmazonLinux/hashicorp.repo >/dev/null
  sudo dnf install -y terraform >/dev/null
fi

if ! aws s3api head-bucket --bucket "${STATE_BUCKET}" >/dev/null 2>&1; then
  aws s3api create-bucket \
    --bucket "${STATE_BUCKET}" \
    --region "${AWS_REGION}" \
    --create-bucket-configuration LocationConstraint="${AWS_REGION}" \
    >/dev/null
fi

aws s3api put-public-access-block \
  --bucket "${STATE_BUCKET}" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption \
  --bucket "${STATE_BUCKET}" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-versioning \
  --bucket "${STATE_BUCKET}" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-policy \
  --bucket "${STATE_BUCKET}" \
  --policy "$(jq -cn --arg bucket "${STATE_BUCKET}" '{Version:"2012-10-17",Statement:[{Sid:"DenyInsecureTransport",Effect:"Deny",Principal:"*",Action:"s3:*",Resource:[("arn:aws:s3:::"+$bucket),("arn:aws:s3:::"+$bucket+"/*")],Condition:{Bool:{"aws:SecureTransport":"false"}}}]}')"

caller_arn="$(aws sts get-caller-identity --query Arn --output text)"
if [[ "${caller_arn}" == "arn:aws:iam::${EXPECTED_ACCOUNT_ID}:root" ]]; then
  echo "AWS root cannot assume roles; using the current CloudShell session for this one-time bootstrap." >&2
else
  credentials=""
  for attempt in 1 2 3 4 5; do
    if credentials="$(aws sts assume-role \
      --role-arn "${ROLE_ARN}" \
      --role-session-name CryptoBotLabsTerraform \
      --duration-seconds 3600 \
      --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
      --output text 2>/dev/null)"; then
      break
    fi
    sleep 3
  done
  if [[ -z "${credentials}" ]]; then
    echo "Unable to assume ${ROLE_ARN}." >&2
    exit 1
  fi

  read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<<"${credentials}"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
fi
export AWS_REGION

cp terraform.tfvars.example terraform.tfvars
terraform fmt -recursive
terraform init -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="key=production/aws-executor.tfstate" \
  -backend-config="region=${AWS_REGION}" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"
terraform validate
terraform plan -out=production.tfplan
terraform show -no-color production.tfplan > production-plan.txt

echo "Terraform plan created at ${PWD}/production-plan.txt"
