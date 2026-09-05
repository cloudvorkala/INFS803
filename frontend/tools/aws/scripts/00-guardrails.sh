#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Run this FIRST. It spends nothing and it is the thing that stops a surprise.
#
#   1. Tells you which Free Tier model your account is on, because they behave
#      very differently: the post-July-2025 Free Plan stops services rather
#      than billing you, the older model bills overages to your card.
#   2. Creates a zero-spend budget alert so you hear about a charge the day it
#      appears rather than at the end of the month. AWS Budgets gives you two
#      budgets free.
#   3. Lists anything already running that could be costing money.
#
# Usage:  ./00-guardrails.sh your.email@example.com
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

EMAIL="${1:-}"
REGION="${AWS_REGION:-ap-southeast-2}"

if [[ -z "$EMAIL" ]]; then
  echo "Usage: $0 your.email@example.com" >&2
  exit 1
fi

command -v aws >/dev/null || { echo "The AWS CLI is not installed." >&2; exit 1; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "Account:  $ACCOUNT_ID"
echo "Region:   $REGION"
echo "Identity: $(aws sts get-caller-identity --query Arn --output text)"
echo

# --- 1. Budget alert at effectively zero ------------------------------------
echo "==> Creating a \$1 budget alert (notifies at 1 cent of actual spend)"

BUDGET_JSON="$(mktemp)"
NOTIF_JSON="$(mktemp)"
trap 'rm -f "$BUDGET_JSON" "$NOTIF_JSON"' EXIT

cat > "$BUDGET_JSON" <<EOF
{
  "BudgetName": "paperbound-zero-spend",
  "BudgetLimit": { "Amount": "1", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
EOF

cat > "$NOTIF_JSON" <<EOF
[
  {
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 1,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      { "SubscriptionType": "EMAIL", "Address": "$EMAIL" }
    ]
  }
]
EOF

if aws budgets create-budget \
  --account-id "$ACCOUNT_ID" \
  --budget "file://$(cli_path "$BUDGET_JSON")" \
  --notifications-with-subscribers "file://$(cli_path "$NOTIF_JSON")" 2>/dev/null; then
  echo "    created — you'll get an email at 1% of \$1, i.e. one cent."
else
  echo "    already exists (or Budgets is not enabled for this account); skipping."
fi

# --- 2. Is the 12-month Free Tier still active? ------------------------------
# This is THE question for an older account. The 12-month allowances (EC2 750
# hours, S3 5 GB, EBS 30 GB) expire; the always-free ones (DynamoDB 25 RCU/WCU
# and 25 GB, CloudFront 1 TB out, Lambda 1M requests) never do.
echo
echo "==> Free Tier status"

# The AWS CLI can format this itself — no jq or python needed, which matters on
# Windows/Git Bash where neither is installed by default.
if FT_ROWS="$(aws freetier get-free-tier-usage --region us-east-1 \
      --query 'freeTierUsages[?contains(service,`EC2`) || contains(service,`S3`) || contains(service,`DynamoDB`)].{Service:service,Used:actualUsageAmount,Limit:limit,Unit:unit,Forecast:forecastedUsageAmount}' \
      --output table 2>/dev/null)" && [[ -n "$FT_ROWS" ]]; then
  echo "$FT_ROWS"
  echo "    Rows above mean the 12-month Free Tier is STILL ACTIVE on this account."
else
  echo "    No Free Tier usage returned. That means one of:"
  echo "      · the 12-month Free Tier on this account has expired  (most likely)"
  echo "      · nothing has been used yet this month"
  echo "      · this IAM user cannot read billing data"
  echo
  echo "    Confirm in the console (sign in as ROOT — this page is root-only"
  echo "    unless IAM billing access is switched on):"
  echo "      https://console.aws.amazon.com/billing/home#/freetier"
fi

cat <<'AGE'

    If your account is MORE than 12 months old, the 12-month allowances are
    gone and EC2 will bill. Rough Sydney on-demand cost for one t3.micro:

        instance   ~US$0.0132/hr   ~US$9.60/month if left running
        public IP  ~US$0.005/hr    ~US$3.60/month
        8 GB gp3   ~US$0.096/GB    ~US$0.77/month
        ------------------------------------------------
        about US$14/month, or about US$0.45/day

    DynamoDB and CloudFront stay free either way — their allowances never
    expire. Only EC2 is exposed.

    If that matters: stop the instance whenever you are not demoing
    (a stopped instance bills only the disk, about 2 cents a day), and
    start it again for marking. The brief does require the API to be
    reachable from submission until marked, so budget for those weeks.

AGE

# --- 3. What is already running ---------------------------------------------
echo
echo "==> Anything already running that could cost money"

echo
echo "  EC2 instances:"
aws ec2 describe-instances --region "$REGION" \
  --filters "Name=instance-state-name,Values=running,stopped" \
  --query 'Reservations[].Instances[].{Id:InstanceId,Type:InstanceType,State:State.Name}' \
  --output table 2>/dev/null || echo "    (none / no permission)"

echo "  Unattached Elastic IPs — these bill even when idle:"
aws ec2 describe-addresses --region "$REGION" \
  --query 'Addresses[?AssociationId==null].[PublicIp,AllocationId]' \
  --output table 2>/dev/null || echo "    (none)"

echo "  NAT Gateways — expensive, you should have none:"
aws ec2 describe-nat-gateways --region "$REGION" \
  --filter "Name=state,Values=available,pending" \
  --query 'NatGateways[].NatGatewayId' --output table 2>/dev/null || echo "    (none)"

echo "  Load balancers — ~\$16+/month, you should have none:"
aws elbv2 describe-load-balancers --region "$REGION" \
  --query 'LoadBalancers[].LoadBalancerName' --output table 2>/dev/null || echo "    (none)"

echo "  RDS instances — you should have none:"
aws rds describe-db-instances --region "$REGION" \
  --query 'DBInstances[].DBInstanceIdentifier' --output table 2>/dev/null || echo "    (none)"

cat <<'NOTE'

--- What actually costs money on this stack -------------------------------

  Safe, on any plan:
    · DynamoDB at the small provisioned capacity these scripts use
    · S3 for the cover images (a few hundred KB)
    · One EC2 t3.micro, and its auto-assigned public IPv4
      (Free Tier includes 750 hours/month of each — one instance running
       24/7 is about 730 hours, so it fits, but TWO instances do not)

  Will cost money — do not create these:
    · An Application Load Balancer (~US$16/month, no free tier).
      Use CloudFront in front of EC2 for HTTPS instead — see DEPLOYMENT.md.
    · A NAT Gateway (~US$32/month). Put EC2 in a public subnet instead.
    · An Elastic IP you allocate and leave unattached.
    · A second EC2 instance, or an instance left running past the free hours.
    · RDS. You are using DynamoDB; do not create one by accident.

  When you are done for the day, stop the instance:
      aws ec2 stop-instances --instance-ids <id> --region REGION
  A stopped instance costs nothing but its 8 GB of EBS, which is inside the
  30 GB Free Tier allowance.

NOTE

echo "Check your billing page in 24 hours: https://console.aws.amazon.com/billing/home#/bills"
