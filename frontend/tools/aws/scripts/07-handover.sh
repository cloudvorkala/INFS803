#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Reads what actually exists in your AWS account and prints a handover summary
# you can paste straight to your backend teammate.
#
# Read-only — creates nothing, costs nothing.
#
# Usage:  ./07-handover.sh [bucket-name]
# ---------------------------------------------------------------------------
set -uo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
BUCKET="${1:-}"
OK=0
MISSING=0

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
dim()   { printf '\033[2m%s\033[0m' "$1"; }

echo "Checking what exists in $REGION ..."
echo

# --- DynamoDB ---------------------------------------------------------------
for T in Paperbound-Products Paperbound-Carts Paperbound-Orders; do
  if aws dynamodb describe-table --table-name "$T" --region "$REGION" >/dev/null 2>&1; then
    echo "  $(green PASS)  table $T"
    OK=$((OK+1))
  else
    echo "  $(red MISSING)  table $T  — run ./01-create-tables.sh"
    MISSING=$((MISSING+1))
  fi
done

BOOKS="$(aws dynamodb scan --table-name Paperbound-Products --region "$REGION" \
          --select COUNT --query Count --output text 2>/dev/null || echo 0)"
if [[ "$BOOKS" == "100" ]]; then
  echo "  $(green PASS)  100 books loaded"
  OK=$((OK+1))
else
  echo "  $(red "CHECK ")  Products has $BOOKS items, expected 100 — run ./02-load-seed.sh"
  MISSING=$((MISSING+1))
fi

# --- S3 ---------------------------------------------------------------------
if [[ -z "$BUCKET" ]]; then
  BUCKET="$(aws s3api list-buckets --query "Buckets[?starts_with(Name,'paperbound-covers')].Name | [0]" \
            --output text 2>/dev/null || echo None)"
fi

if [[ -n "$BUCKET" && "$BUCKET" != "None" ]]; then
  COVERS="$(aws s3 ls "s3://$BUCKET/covers/" --recursive 2>/dev/null | wc -l | tr -d ' ')"
  echo "  $(green PASS)  bucket $BUCKET — $COVERS objects"
  OK=$((OK+1))
  COVER_URL="https://$BUCKET.s3.$REGION.amazonaws.com/covers/bk-001.svg"
else
  echo "  $(red MISSING)  covers bucket — run ./03-covers-bucket.sh <name>"
  MISSING=$((MISSING+1))
  BUCKET="<not created>"
  COVER_URL="<not created>"
fi

# --- Cognito ----------------------------------------------------------------
POOL_ID="$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" \
  --query "UserPools[?Name=='Paperbound-Users'].Id | [0]" --output text 2>/dev/null || echo None)"

if [[ -n "$POOL_ID" && "$POOL_ID" != "None" ]]; then
  echo "  $(green PASS)  Cognito user pool $POOL_ID"
  OK=$((OK+1))
  CLIENT_ID="$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" \
    --max-results 60 --region "$REGION" \
    --query "UserPoolClients[?ClientName=='paperbound-web'].ClientId | [0]" --output text 2>/dev/null || echo None)"
  USERS="$(aws cognito-idp list-users --user-pool-id "$POOL_ID" --region "$REGION" \
    --query 'length(Users)' --output text 2>/dev/null || echo 0)"
  echo "  $(dim "        app client $CLIENT_ID, $USERS user(s)")"
else
  echo "  $(red MISSING)  Cognito user pool — run ./06-cognito.sh"
  MISSING=$((MISSING+1))
  POOL_ID="<not created>"
  CLIENT_ID="<not created>"
fi

# --- Nothing should be costing money ----------------------------------------
RUNNING="$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=instance-state-name,Values=running,stopped" \
  --query 'length(Reservations[].Instances[])' --output text 2>/dev/null || echo 0)"
if [[ "$RUNNING" == "0" ]]; then
  echo "  $(green PASS)  no EC2 instances — nothing billing"
else
  echo "  $(red "CHECK ")  $RUNNING EC2 instance(s) exist. If that is not deliberate, terminate them."
fi

echo
echo "================================================"
if [[ $MISSING -eq 0 ]]; then
  echo "  $(green "Everything on your side is ready.")"
else
  echo "  $MISSING thing(s) still missing — see above."
fi
echo "================================================"

# --- The message ------------------------------------------------------------
cat <<MSG

--- PASTE THIS TO YOUR TEAMMATE ------------------------------------------

Hey — frontend and database are done and live in AWS. Your part is the
Express API (the middle tier). Everything you need is in the repo.

START HERE: read HANDOVER.md at the repo root. It has all 14 routes, the
exact JSON the client expects, and working DynamoDB code for every query —
all of it already tested, so you shouldn't have to guess at anything.

Also run tools/reference-server.mjs — it's a complete implementation of all
14 routes with the right response shapes. It keeps state in memory instead
of DynamoDB; swapping that is basically the job.

    node tools/reference-server.mjs      # localhost:4000

WHAT'S ALREADY LIVE

  Region        $REGION
  Tables        Paperbound-Products   (100 books loaded)
                Paperbound-Carts
                Paperbound-Orders
  Indexes       category-title-index, author-title-index (on Products)
  S3 bucket     $BUCKET
  Cover example $COVER_URL
  Cognito pool  $POOL_ID
  Test accounts admin@paperbound.test / Admin123!   (admins group)
                reader@paperbound.test / Reader123!

NO ACCESS KEYS — and please don't ask for one. Launch the instance with
tools/aws/scripts/04-launch-ec2.sh and it comes with an IAM role scoped to
those three tables and the covers prefix. Use the AWS SDK with no
credentials configured; it picks the role up automatically:

    const db = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: '$REGION' })
    );

If you hit AccessDeniedException, tell me and I'll add the ARN to the role.

THREE THINGS THAT WILL COST YOU A DAY IF NOBODY WARNS YOU

  1. HTTPS. The client is served over HTTPS and browsers silently block
     calls from an HTTPS page to a plain-HTTP address. http://<ip>:3000
     works from your laptop and will NOT work from the deployed site.
     Fix: CloudFront in front of the instance (free tier). Do not use a
     load balancer — ~US\$16/month and this account has to stay free.
     Exact settings are in DEPLOYMENT.md.

  2. CORS must allow the Authorization header, or every signed-in route
     dies at the preflight before it ever reaches your code.

  3. pm2 start / pm2 save / pm2 startup — the API has to survive a reboot
     and stay up from submission until marking is done.

ONE DECISION FOR US TO MAKE TOGETHER

  Auth is either Cognito-direct (you just verify JWTs — 11 routes are
  yours) or proxied through your API (you implement /register, /login,
  /logout too — 14 routes). The client supports both off one env var.
  Either clears the brief's 10-route minimum. Tell me which you're doing
  so the report matches what actually ships.

SEND BACK WHEN YOU'RE LIVE

  VITE_API_BASE_URL=https://<your-cloudfront-domain>

  ...and which auth mode. I rebuild the client against it and we're
  three-tier.

--------------------------------------------------------------------------

MSG

echo "$(dim "Also push the repo to GitHub and send him the link — the brief requires")"
echo "$(dim "per-member commit history and markers do check it.")"
