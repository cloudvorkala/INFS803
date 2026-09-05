#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deletes everything these scripts created, so nothing keeps billing after the
# assignment is marked.
#
# DESTRUCTIVE. Requires you to type the confirmation phrase.
# Do NOT run this before your assignment has been marked — the brief requires
# the URLs to stay live until you are notified.
#
# Usage:  ./99-teardown.sh [bucket-name]
# ---------------------------------------------------------------------------
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
BUCKET="${1:-}"

echo "This will permanently delete, in $REGION:"
echo "  · EC2 instance tagged paperbound-api (and its disk)"
echo "  · security group paperbound-api-sg"
echo "  · IAM role paperbound-ec2-role and its instance profile"
echo "  · DynamoDB tables Paperbound-Products / -Carts / -Orders, with all data"
echo "  · the Cognito user pool Paperbound-Users and every account in it"
[[ -n "$BUCKET" ]] && echo "  · S3 bucket $BUCKET and everything in it"
echo
read -r -p 'Type "delete everything" to continue: ' CONFIRM
[[ "$CONFIRM" == "delete everything" ]] || { echo "Cancelled."; exit 1; }

echo
echo "==> Terminating EC2"
IDS="$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=paperbound-api" "Name=instance-state-name,Values=running,stopped,pending" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
if [[ -n "$IDS" ]]; then
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --region "$REGION" --instance-ids $IDS >/dev/null
  echo "    terminating: $IDS"
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --region "$REGION" --instance-ids $IDS
  echo "    gone"
else
  echo "    none found"
fi

echo "==> Releasing any unattached Elastic IPs (these bill while idle)"
for ALLOC in $(aws ec2 describe-addresses --region "$REGION" \
  --query 'Addresses[?AssociationId==null].AllocationId' --output text); do
  aws ec2 release-address --region "$REGION" --allocation-id "$ALLOC" && echo "    released $ALLOC"
done

echo "==> Deleting security group"
SG_ID="$(aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=paperbound-api-sg" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)"
if [[ "$SG_ID" != "None" && -n "$SG_ID" ]]; then
  aws ec2 delete-security-group --region "$REGION" --group-id "$SG_ID" 2>/dev/null \
    && echo "    deleted $SG_ID" || echo "    still in use; retry in a minute"
fi

echo "==> Deleting IAM role and instance profile"
aws iam remove-role-from-instance-profile --instance-profile-name paperbound-ec2-profile \
  --role-name paperbound-ec2-role 2>/dev/null || true
aws iam delete-instance-profile --instance-profile-name paperbound-ec2-profile 2>/dev/null || true
aws iam delete-role-policy --role-name paperbound-ec2-role --policy-name paperbound-data-access 2>/dev/null || true
aws iam delete-role --role-name paperbound-ec2-role 2>/dev/null && echo "    deleted" || echo "    not found"

echo "==> Deleting the Cognito user pool"
POOL_ID="$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" \
  --query "UserPools[?Name=='Paperbound-Users'].Id | [0]" --output text 2>/dev/null || echo None)"
if [[ "$POOL_ID" != "None" && -n "$POOL_ID" ]]; then
  aws cognito-idp delete-user-pool --user-pool-id "$POOL_ID" --region "$REGION" \
    && echo "    deleted $POOL_ID" || echo "    could not delete $POOL_ID"
else
  echo "    not found"
fi

echo "==> Deleting DynamoDB tables"
for T in Paperbound-Products Paperbound-Carts Paperbound-Orders; do
  aws dynamodb delete-table --table-name "$T" --region "$REGION" >/dev/null 2>&1 \
    && echo "    deleting $T" || echo "    $T not found"
done

if [[ -n "$BUCKET" ]]; then
  echo "==> Emptying and deleting s3://$BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive --only-show-errors || true
  aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION" && echo "    deleted" || echo "    not found"
fi

echo
echo "Done. Check the console in a day to confirm nothing is left:"
echo "  https://console.aws.amazon.com/billing/home#/bills"
echo
echo "The budget alert (paperbound-zero-spend) is left in place on purpose."
echo "Delete it yourself if you want it gone:"
echo "  aws budgets delete-budget --account-id \$(aws sts get-caller-identity --query Account --output text) --budget-name paperbound-zero-spend"
