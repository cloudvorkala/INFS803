#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Creates the S3 bucket for cover images, uploads all 100, and rewrites the
# seed data so coverUrl points at the bucket instead of a local path.
#
# This is the "assets on cloud storage" requirement in the brief. Screenshot
# the bucket afterwards for the cloud-implementation section of the report.
#
# On public read: the bucket holds nothing but product cover images, which are
# public by nature — the same images anyone browsing the shop already sees.
# Writes stay restricted to the EC2 instance role created in 04. Say that in the
# report rather than leaving a public bucket unexplained.
#
# Usage:  ./03-covers-bucket.sh paperbound-covers-yourname
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

BUCKET="${1:-}"
REGION="${AWS_REGION:-ap-southeast-2}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/../../.."

if [[ -z "$BUCKET" ]]; then
  echo "Usage: $0 <globally-unique-bucket-name>" >&2
  echo "e.g.   $0 paperbound-covers-ashtosh" >&2
  exit 1
fi

command -v aws >/dev/null || { echo "The AWS CLI is not installed." >&2; exit 1; }
[[ -d "$ROOT/public/covers" ]] || { echo "Cannot find public/covers — run from the repo." >&2; exit 1; }

# --- Bucket ------------------------------------------------------------------
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "==> Bucket $BUCKET already exists"
else
  echo "==> Creating bucket $BUCKET in $REGION"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi

# --- Allow public reads of the covers/ prefix only ---------------------------
echo "==> Allowing public read on covers/ (and nothing else)"

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

POLICY="$(mktemp)"
trap 'rm -f "$POLICY"' EXIT
cat > "$POLICY" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadCoversOnly",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::$BUCKET/covers/*"
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$(cli_path "$POLICY")"

# --- Upload ------------------------------------------------------------------
echo "==> Uploading 100 cover images"
aws s3 sync "$ROOT/public/covers" "s3://$BUCKET/covers" \
  --content-type "image/svg+xml" \
  --cache-control "public,max-age=31536000,immutable" \
  --only-show-errors

UPLOADED="$(aws s3 ls "s3://$BUCKET/covers/" --recursive | wc -l | tr -d ' ')"
echo "    $UPLOADED objects in s3://$BUCKET/covers/"

BASE="https://$BUCKET.s3.$REGION.amazonaws.com/covers"

echo
echo "==> Verifying a cover is publicly readable"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/bk-001.svg" || true)"
if [[ "$CODE" == "200" ]]; then
  echo "    $BASE/bk-001.svg -> 200"
else
  echo "    WARNING: got HTTP $CODE. The policy can take a moment; retry the URL in a browser."
fi

# --- Point the seed data at the bucket ---------------------------------------
echo
echo "==> Rewriting seed data so coverUrl points at S3"
( cd "$ROOT" && COVER_BASE="$BASE" node tools/build-catalogue.mjs )

echo
cat <<NOTE
Cover base URL:
    $BASE

The seed files in tools/seed-data/ now carry full S3 URLs. Reload them so the
database matches:

    ./02-load-seed.sh

Note this also rewrote src/data/books.json, which the client's mock API reads.
That is fine for the deployed build (the real API supplies the URLs), but if you
want the local demo to keep using bundled covers, run:

    node tools/build-catalogue.mjs

with no COVER_BASE to switch it back.

Next:  ./04-launch-ec2.sh
NOTE
