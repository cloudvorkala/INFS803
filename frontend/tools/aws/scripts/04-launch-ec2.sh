#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Launches the EC2 instance your teammate's Express backend will run on.
#
# Free-tier-safe choices, and why:
#   · t3.micro, 8 GB gp3          — inside the 750 hour / 30 GB allowances
#   · default VPC, public subnet  — avoids a NAT Gateway (~US$32/month)
#   · auto-assigned public IPv4   — no Elastic IP to leave dangling and billing
#   · no load balancer            — an ALB is ~US$16/month with no free tier;
#                                   HTTPS comes from CloudFront instead
#   · an IAM instance role        — so the app reaches DynamoDB and S3 with NO
#                                   access keys on the box. The brief asks for
#                                   exactly this; it is also the right answer.
#
# Usage:  ./04-launch-ec2.sh
#         ./04-launch-ec2.sh my-key-name
# ---------------------------------------------------------------------------
set -euo pipefail

# --- Windows/Git Bash compatibility -----------------------------------------
# The AWS CLI on Windows is a native .exe and cannot read Git Bash paths like
# /c/Users/... . cygpath -m converts them to C:/Users/... which file:// accepts.
# On Linux and macOS cygpath does not exist and the path passes through as-is.
cli_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

REGION="${AWS_REGION:-ap-southeast-2}"
KEY_NAME="${1:-paperbound-key}"
NAME="paperbound-api"
ROLE="paperbound-ec2-role"
PROFILE="paperbound-ec2-profile"
SG="paperbound-api-sg"
APP_PORT=3000

command -v aws >/dev/null || { echo "The AWS CLI is not installed." >&2; exit 1; }
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

echo "Region:  $REGION"
echo "Account: $ACCOUNT_ID"
echo

# --- Key pair ----------------------------------------------------------------
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Key pair $KEY_NAME already exists"
else
  echo "==> Creating key pair $KEY_NAME"
  aws ec2 create-key-pair --key-name "$KEY_NAME" --region "$REGION" \
    --query 'KeyMaterial' --output text > "$KEY_NAME.pem"
  chmod 400 "$KEY_NAME.pem"
  echo "    saved to ./$KEY_NAME.pem — keep it, it cannot be downloaded again,"
  echo "    and do NOT commit it (it is covered by .gitignore)."
fi

# --- Security group ----------------------------------------------------------
VPC_ID="$(aws ec2 describe-vpcs --region "$REGION" --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"
[[ "$VPC_ID" != "None" ]] || { echo "No default VPC in $REGION." >&2; exit 1; }

SG_ID="$(aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=$SG" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)"

if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
  echo "==> Creating security group $SG"
  SG_ID="$(aws ec2 create-security-group --region "$REGION" \
    --group-name "$SG" --vpc-id "$VPC_ID" \
    --description "Paperbound API - SSH from admin IP, app port from anywhere" \
    --query 'GroupId' --output text)"

  MY_IP="$(curl -s --max-time 10 https://checkip.amazonaws.com || echo '')"
  if [[ -n "$MY_IP" ]]; then
    echo "    SSH restricted to $MY_IP/32"
    aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
      --protocol tcp --port 22 --cidr "$MY_IP/32" >/dev/null
  else
    echo "    Could not detect your IP. Add an SSH rule yourself:"
    echo "    aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr YOUR.IP/32 --region $REGION"
  fi

  # The API port and 80/443 stay open — markers must reach the API from anywhere.
  for PORT in 80 443 "$APP_PORT"; do
    aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
      --protocol tcp --port "$PORT" --cidr 0.0.0.0/0 >/dev/null
  done
  echo "    ports 80, 443 and $APP_PORT open to the internet"
else
  echo "==> Security group $SG already exists ($SG_ID)"
fi

# --- IAM role: DynamoDB + S3 access with no keys on the instance -------------
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "==> IAM role $ROLE already exists"
else
  echo "==> Creating IAM role $ROLE (least privilege, no access keys anywhere)"

  TRUST="$(mktemp)"; POLICY="$(mktemp)"
  trap 'rm -f "$TRUST" "$POLICY"' EXIT

  cat > "$TRUST" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document "file://$(cli_path "$TRUST")" \
    --description "Paperbound Express API: DynamoDB + S3 covers" >/dev/null

  cat > "$POLICY" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OurTablesOnly",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
        "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
        "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
        "dynamodb:TransactWriteItems", "dynamodb:TransactGetItems"
      ],
      "Resource": [
        "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/Paperbound-Products",
        "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/Paperbound-Products/index/*",
        "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/Paperbound-Carts",
        "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/Paperbound-Orders"
      ]
    },
    {
      "Sid": "CoverUploadsOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::paperbound-covers-*/covers/*"
    }
  ]
}
EOF

  aws iam put-role-policy --role-name "$ROLE" \
    --policy-name "paperbound-data-access" --policy-document "file://$(cli_path "$POLICY")"

  aws iam create-instance-profile --instance-profile-name "$PROFILE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE"
  echo "    waiting for the instance profile to propagate"
  sleep 12
fi

# --- AMI: resolved from SSM so it is never a stale hardcoded id --------------
AMI_ID="$(aws ssm get-parameters --region "$REGION" \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)"
echo "==> Amazon Linux 2023 AMI: $AMI_ID"

# --- Already running? --------------------------------------------------------
EXISTING="$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=running,pending,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo None)"

if [[ "$EXISTING" != "None" && -n "$EXISTING" ]]; then
  echo
  echo "An instance tagged $NAME already exists: $EXISTING"
  echo "Not launching a second one — two instances would exceed the 750 free hours."
  aws ec2 describe-instances --region "$REGION" --instance-ids "$EXISTING" \
    --query 'Reservations[0].Instances[0].{Id:InstanceId,State:State.Name,Type:InstanceType,PublicIp:PublicIpAddress}' \
    --output table
  exit 0
fi

# --- Launch ------------------------------------------------------------------
USER_DATA="$(mktemp)"
cat > "$USER_DATA" <<'EOF'
#!/bin/bash
set -eux
dnf update -y
dnf install -y git
# Node 20 for the Express API
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
npm install -g pm2
mkdir -p /opt/paperbound && chown ec2-user:ec2-user /opt/paperbound
echo "ready" > /opt/paperbound/PROVISIONED
EOF

echo "==> Launching t3.micro"
INSTANCE_ID="$(aws ec2 run-instances --region "$REGION" \
  --image-id "$AMI_ID" \
  --instance-type t3.micro \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --iam-instance-profile "Name=$PROFILE" \
  --user-data "file://$(cli_path "$USER_DATA")" \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":8,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=INFS803-Assignment2},{Key=Layer,Value=backend}]" \
  --query 'Instances[0].InstanceId' --output text)"
rm -f "$USER_DATA"

echo "    $INSTANCE_ID — waiting for it to come up"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

PUBLIC_IP="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"

cat <<NOTE

Instance:  $INSTANCE_ID
Public IP: $PUBLIC_IP

SSH in (give it two or three minutes to finish installing Node):
    ssh -i $KEY_NAME.pem ec2-user@$PUBLIC_IP

Hand your teammate:
    · the IP above
    · /opt/paperbound is theirs, Node 20 and pm2 are installed
    · table names: Paperbound-Products / -Carts / -Orders in $REGION
    · NO credentials — the instance role handles DynamoDB and S3. Their code
      should use the AWS SDK with no keys configured; it picks the role up
      automatically. If they ask you for an access key, the answer is no.

COST — stop it when you are not using it:
    aws ec2 stop-instances  --instance-ids $INSTANCE_ID --region $REGION
    aws ec2 start-instances --instance-ids $INSTANCE_ID --region $REGION
Note the public IP CHANGES on restart. That is fine until submission; once the
API URL is in your report, leave the instance running.

Next:  HTTPS. Your client will be served over HTTPS and browsers block calls
from an HTTPS page to a plain-HTTP API, so http://$PUBLIC_IP:$APP_PORT will not
work from the deployed site. See DEPLOYMENT.md — use CloudFront in front of this
instance, which is free-tier and avoids a US\$16/month load balancer.
NOTE
