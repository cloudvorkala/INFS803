#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Creates the three DynamoDB tables from tools/aws/tables/*.json.
#
# Capacity is PROVISIONED and deliberately small — 20 read units and 20 write
# units in total across all tables and indexes. That sits inside the 25/25
# always-free DynamoDB allowance, and unlike on-demand it cannot spike into a
# bill if something loops. It is far more than this assignment will ever use.
#
# Idempotent: tables that already exist are left alone.
#
# Usage:  ./01-create-tables.sh
#         AWS_REGION=ap-southeast-2 ./01-create-tables.sh
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
TABLES_DIR="$HERE/../tables"

command -v aws >/dev/null || { echo "The AWS CLI is not installed." >&2; exit 1; }

echo "Region: $REGION"
echo

for def in "$TABLES_DIR"/*.json; do
  NAME="$(sed -n 's/.*"TableName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$def" | head -1)"

  if aws dynamodb describe-table --table-name "$NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "==> $NAME already exists — skipping"
    continue
  fi

  echo "==> Creating $NAME"
  aws dynamodb create-table --cli-input-json "file://$(cli_path "$def")" --region "$REGION" \
    --query 'TableDescription.{Table:TableName,Status:TableStatus}' --output text
done

echo
echo "==> Waiting for all tables to become ACTIVE"
for def in "$TABLES_DIR"/*.json; do
  NAME="$(sed -n 's/.*"TableName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$def" | head -1)"
  aws dynamodb wait table-exists --table-name "$NAME" --region "$REGION"
  echo "    $NAME ready"
done

echo
aws dynamodb list-tables --region "$REGION" --output table

cat <<'NOTE'

Provisioned capacity in use:
    Paperbound-Products          5 read / 5 write
      category-title-index       3 read / 3 write
      author-title-index         2 read / 2 write
    Paperbound-Carts             5 read / 5 write
    Paperbound-Orders            5 read / 5 write
    ------------------------------------------------
    total                       20 read / 20 write   (free allowance is 25/25)

Next:  ./02-load-seed.sh
NOTE
