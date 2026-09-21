#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Proves the EC2 instance actually works as the backend tier, then tells you
# how to destroy it. Takes about two minutes; at t3.micro rates that is under
# two cents.
#
# What it proves — these are the screenshots for your report:
#   1. Node runs on the instance
#   2. The instance authenticates to AWS as its IAM ROLE, with no access keys
#      anywhere on the box (this is the brief's "without exposing credentials")
#   3. From the instance, it can read all 100 books out of the real DynamoDB
#      table — the database tier, reached by the backend tier
#   4. It can write to the S3 covers bucket (what POST /upload_file will do)
#   5. An API listening on :3000 is reachable from the public internet
#   6. CORS preflight succeeds, so a browser on your deployed client will not
#      be blocked
#
# It deploys tools/reference-server.mjs purely as a stand-in so there is
# something to curl. That is NOT your submission backend — your teammate's
# Express app replaces it.
#
# Usage:  ./05-smoke-test.sh <key.pem> [bucket-name]
# ---------------------------------------------------------------------------
set -uo pipefail

KEY="${1:-}"
BUCKET="${2:-}"
REGION="${AWS_REGION:-ap-southeast-2}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/../../.."
PASS=0
FAIL=0

ok()   { echo -e "  \033[32mPASS\033[0m  $1"; PASS=$((PASS+1)); }
bad()  { echo -e "  \033[31mFAIL\033[0m  $1"; FAIL=$((FAIL+1)); }
step() { echo -e "\n\033[1m$1\033[0m"; }

[[ -n "$KEY" && -f "$KEY" ]] || { echo "Usage: $0 <key.pem> [bucket-name]" >&2; exit 1; }
chmod 400 "$KEY" 2>/dev/null || true

INSTANCE_ID="$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=paperbound-api" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)"
[[ "$INSTANCE_ID" != "None" && -n "$INSTANCE_ID" ]] || {
  echo "No running instance tagged paperbound-api. Run ./04-launch-ec2.sh first." >&2; exit 1; }

IP="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"

echo "Instance: $INSTANCE_ID"
echo "Public IP: $IP"

SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
     -o ConnectTimeout=15 -o LogLevel=ERROR "ec2-user@$IP")

step "1. Reaching the instance"
for i in $(seq 1 20); do
  "${SSH[@]}" true 2>/dev/null && break
  [[ $i -eq 20 ]] && { bad "SSH never came up — check the security group allows your IP on 22"; exit 1; }
  sleep 6
done
ok "SSH connected"

NODE_V="$("${SSH[@]}" 'node --version' 2>/dev/null)"
[[ -n "$NODE_V" ]] && ok "Node installed on the instance — $NODE_V" \
                   || bad "Node missing (user-data may still be running; wait a minute and retry)"

step "2. The instance authenticates as its IAM role, not as a key"
ARN="$("${SSH[@]}" "aws sts get-caller-identity --query Arn --output text" 2>/dev/null)"
if [[ "$ARN" == *"assumed-role/paperbound-ec2-role"* ]]; then
  ok "Identity is the instance role"
  echo "        $ARN"
else
  bad "Unexpected identity: ${ARN:-none}"
fi

KEYFILES="$("${SSH[@]}" 'ls ~/.aws/credentials /etc/aws/credentials 2>/dev/null | wc -l' 2>/dev/null)"
[[ "$KEYFILES" == "0" ]] && ok "No credentials file anywhere on the instance" \
                         || bad "Found a credentials file — there should be none"

step "3. Backend tier reads the database tier"
COUNT="$("${SSH[@]}" "aws dynamodb scan --table-name Paperbound-Products --region $REGION --select COUNT --query Count --output text" 2>/dev/null)"
[[ "$COUNT" == "100" ]] && ok "Read 100 books from Paperbound-Products" \
                        || bad "Expected 100 books, got: ${COUNT:-error}"

TITLE="$("${SSH[@]}" "aws dynamodb get-item --table-name Paperbound-Products --region $REGION --key '{\"id\":{\"S\":\"bk-001\"}}' --query Item.title.S --output text" 2>/dev/null)"
[[ -n "$TITLE" && "$TITLE" != "None" ]] && ok "GetItem works — \"$TITLE\"" || bad "GetItem failed"

QRY="$("${SSH[@]}" "aws dynamodb query --table-name Paperbound-Products --index-name category-title-index --region $REGION --key-condition-expression 'category = :c' --expression-attribute-values '{\":c\":{\"S\":\"Poetry\"}}' --select COUNT --query Count --output text" 2>/dev/null)"
[[ "$QRY" == "10" ]] && ok "GSI query works — 10 poetry titles" || bad "GSI query returned: ${QRY:-error}"

step "4. Backend tier writes to cloud storage"
if [[ -n "$BUCKET" ]]; then
  W="$("${SSH[@]}" "echo smoke-test > /tmp/t.txt && aws s3 cp /tmp/t.txt s3://$BUCKET/covers/_smoke-test.txt --region $REGION >/dev/null 2>&1 && echo yes || echo no" 2>/dev/null)"
  if [[ "$W" == "yes" ]]; then
    ok "Wrote to s3://$BUCKET/covers/ using the instance role"
    "${SSH[@]}" "aws s3 rm s3://$BUCKET/covers/_smoke-test.txt --region $REGION >/dev/null 2>&1" || true
  else
    bad "S3 write failed — check the bucket name matches paperbound-covers-*"
  fi
else
  echo "  SKIP  no bucket name given (pass it as the second argument)"
fi

step "5. An API on :3000 is reachable from the internet"
scp -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  "$ROOT/tools/reference-server.mjs" "ec2-user@$IP:/opt/paperbound/" 2>/dev/null \
  && ok "Copied a stand-in API to the instance" || bad "scp failed"

mkdir -p /tmp/pb-seed && cp -r "$ROOT/src/data" /tmp/pb-seed/ 2>/dev/null
scp -i "$KEY" -r -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  /tmp/pb-seed/data "ec2-user@$IP:/opt/paperbound/src-data" 2>/dev/null || true
"${SSH[@]}" 'mkdir -p /opt/paperbound/src && mv /opt/paperbound/src-data /opt/paperbound/src/data 2>/dev/null' 2>/dev/null || true

"${SSH[@]}" 'cd /opt/paperbound && (pkill -f reference-server || true) && nohup node reference-server.mjs > api.log 2>&1 & sleep 3' 2>/dev/null
sleep 4

CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://$IP:3000/products" || echo 000)"
[[ "$CODE" == "200" ]] && ok "GET http://$IP:3000/products -> 200 from the public internet" \
                       || bad "Got HTTP $CODE — check the security group allows 3000"

if [[ "$CODE" == "200" ]]; then
  # grep rather than jq/python — neither is present in Git Bash on Windows
  N="$(curl -s --max-time 15 "http://$IP:3000/products" \
       | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)"
  N="${N:-0}"
  [[ "$N" == "100" ]] && ok "API returned all 100 products" || bad "API returned $N products"

  U="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://$IP:3000/cart" || echo 000)"
  [[ "$U" == "401" ]] && ok "Protected route rejects an unauthenticated call (401)" \
                      || bad "GET /cart returned $U, expected 401"
fi

step "6. CORS preflight — will a browser be allowed to call this?"
PRE="$(curl -s -i -X OPTIONS --max-time 15 \
  -H "Origin: https://example.amplifyapp.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  "http://$IP:3000/cart" 2>/dev/null || true)"
grep -qi "access-control-allow-origin" <<<"$PRE" && ok "Allow-Origin present" || bad "No Allow-Origin header"
grep -qi "access-control-allow-headers.*authorization" <<<"$PRE" \
  && ok "Authorization is an allowed header" \
  || bad "Authorization not allowed — every signed-in route would fail in a browser"

"${SSH[@]}" 'pkill -f reference-server || true' 2>/dev/null || true
rm -rf /tmp/pb-seed

# --- Result ------------------------------------------------------------------
echo
echo "================================================"
echo "  $PASS passed, $FAIL failed"
echo "================================================"

if [[ $FAIL -eq 0 ]]; then
  cat <<PROOF

Three-tier stack proven end to end:
  client  ->  API on EC2 (public internet, port 3000)
              ->  DynamoDB, via an IAM role with no keys on the box
              ->  S3 for assets

Screenshot this output for the "Details on cloud implementation" section.
PROOF
fi

cat <<TEARDOWN

--- Now destroy it so it stops costing anything ---

Terminate just the instance (keeps the database, bucket and IAM role):

    aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION

Or destroy everything, once you no longer need the data:

    ./99-teardown.sh ${BUCKET:-<bucket-name>}

Confirm nothing is left running:

    aws ec2 describe-instances --region $REGION \\
      --filters "Name=instance-state-name,Values=running,stopped" \\
      --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output table

A TERMINATED instance costs nothing and its disk is deleted with it. A STOPPED
one still bills for the disk, so terminate rather than stop if you are done.
TEARDOWN
