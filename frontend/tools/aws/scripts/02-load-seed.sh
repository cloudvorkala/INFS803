#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Loads the 100 books into Paperbound-Products.
#
# Uses the four BatchWriteItem payloads in tools/seed-data/, which are already
# chunked to DynamoDB's 25-item-per-request limit. Re-running is safe: these are
# PutRequests keyed by id, so they overwrite rather than duplicate.
#
# Usage:  ./02-load-seed.sh
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
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_DIR="$HERE/../../seed-data"
TABLE="Paperbound-Products"

command -v aws >/dev/null || { echo "The AWS CLI is not installed." >&2; exit 1; }

aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1 || {
  echo "Table $TABLE does not exist. Run ./01-create-tables.sh first." >&2
  exit 1
}

shopt -s nullglob
BATCHES=("$SEED_DIR"/dynamodb-batch-*.json)
[[ ${#BATCHES[@]} -gt 0 ]] || { echo "No seed files in $SEED_DIR" >&2; exit 1; }

for f in "${BATCHES[@]}"; do
  echo "==> $(basename "$f")"
  UNPROCESSED="$(aws dynamodb batch-write-item \
    --request-items "file://$(cli_path "$f")" \
    --region "$REGION" \
    --query 'UnprocessedItems' --output json)"

  # A throttled batch comes back as UnprocessedItems rather than an error.
  # "Nothing unprocessed" appears as {} , null , None , or an empty string
  # depending on CLI version and platform — all four mean success.
  if [[ -n "$UNPROCESSED" && "$UNPROCESSED" != "{}" && "$UNPROCESSED" != "null" \
        && "$UNPROCESSED" != "None" && "$UNPROCESSED" != '""' ]]; then
    echo "    some items were throttled; retrying once after 3s"
    sleep 3
    RETRY="$(mktemp)"
    echo "$UNPROCESSED" > "$RETRY"
    aws dynamodb batch-write-item --request-items "file://$(cli_path "$RETRY")" --region "$REGION" >/dev/null
    rm -f "$RETRY"
  fi
done

echo
COUNT="$(aws dynamodb scan --table-name "$TABLE" --region "$REGION" --select COUNT --query Count --output text)"
echo "Items in $TABLE: $COUNT"
[[ "$COUNT" == "100" ]] && echo "All 100 books loaded." || echo "Expected 100 — check the output above."

echo
echo "Spot check:"
aws dynamodb get-item --table-name "$TABLE" --region "$REGION" \
  --key '{"id":{"S":"bk-001"}}' \
  --query 'Item.{id:id.S,title:title.S,price:price.N,stock:stock.N,cover:coverUrl.S}' --output table

echo "Next:  ./03-covers-bucket.sh <a-globally-unique-bucket-name>"
