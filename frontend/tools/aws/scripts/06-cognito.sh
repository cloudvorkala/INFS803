#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Creates the Cognito User Pool the client signs in against, plus an app client,
# an "admins" group, and two working demo accounts.
#
# Cognito is free for the first 50,000 monthly active users, so this costs
# nothing on any plan.
#
# Writes the three values the frontend needs straight into a .env file, so
# there is nothing to copy by hand.
#
# Usage:  ./06-cognito.sh
# ---------------------------------------------------------------------------
set -euo pipefail

# --- Windows/Git Bash compatibility -----------------------------------------
cli_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

REGION="${AWS_REGION:-ap-southeast-2}"
POOL_NAME="Paperbound-Users"
CLIENT_NAME="paperbound-web"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/../../.."

ADMIN_EMAIL="admin@paperbound.test"
ADMIN_PASSWORD="Admin123!"
READER_EMAIL="reader@paperbound.test"
READER_PASSWORD="Reader123!"

command -v aws >/dev/null || { echo "The AWS CLI is not installed." >&2; exit 1; }

echo "Region: $REGION"
echo

# --- User pool ---------------------------------------------------------------
POOL_ID="$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" \
  --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" --output text 2>/dev/null || echo None)"

if [[ "$POOL_ID" != "None" && -n "$POOL_ID" ]]; then
  echo "==> User pool $POOL_NAME already exists: $POOL_ID"
else
  echo "==> Creating user pool $POOL_NAME"

  POLICIES="$(mktemp)"
  trap 'rm -f "$POLICIES"' EXIT
  cat > "$POLICIES" <<'EOF'
{
  "PasswordPolicy": {
    "MinimumLength": 8,
    "RequireUppercase": true,
    "RequireLowercase": true,
    "RequireNumbers": true,
    "RequireSymbols": true
  }
}
EOF

  POOL_ID="$(aws cognito-idp create-user-pool \
    --pool-name "$POOL_NAME" \
    --region "$REGION" \
    --username-attributes email \
    --auto-verified-attributes email \
    --policies "file://$(cli_path "$POLICIES")" \
    --schema \
      Name=email,AttributeDataType=String,Required=true,Mutable=true \
      Name=name,AttributeDataType=String,Required=true,Mutable=true \
    --query 'UserPool.Id' --output text)"
  echo "    $POOL_ID"
fi

# --- App client — NO client secret, a browser cannot keep one ----------------
CLIENT_ID="$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" \
  --max-results 60 --region "$REGION" \
  --query "UserPoolClients[?ClientName=='$CLIENT_NAME'].ClientId | [0]" --output text 2>/dev/null || echo None)"

if [[ "$CLIENT_ID" != "None" && -n "$CLIENT_ID" ]]; then
  echo "==> App client $CLIENT_NAME already exists: $CLIENT_ID"
else
  echo "==> Creating app client $CLIENT_NAME (no client secret)"
  CLIENT_ID="$(aws cognito-idp create-user-pool-client \
    --user-pool-id "$POOL_ID" \
    --client-name "$CLIENT_NAME" \
    --region "$REGION" \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --query 'UserPoolClient.ClientId' --output text)"
  echo "    $CLIENT_ID"
fi

# --- admins group ------------------------------------------------------------
if aws cognito-idp get-group --group-name admins --user-pool-id "$POOL_ID" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Group 'admins' already exists"
else
  echo "==> Creating group 'admins'"
  aws cognito-idp create-group --group-name admins --user-pool-id "$POOL_ID" \
    --region "$REGION" --description "Can create, edit and delete products" >/dev/null
fi

# --- Demo users --------------------------------------------------------------
create_user() {
  local EMAIL="$1" PASSWORD="$2" FULLNAME="$3" IS_ADMIN="$4"

  if aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$EMAIL" \
       --region "$REGION" >/dev/null 2>&1; then
    echo "    $EMAIL already exists"
  else
    aws cognito-idp admin-create-user \
      --user-pool-id "$POOL_ID" \
      --username "$EMAIL" \
      --region "$REGION" \
      --message-action SUPPRESS \
      --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
                        Name=name,Value="$FULLNAME" >/dev/null

    # Without --permanent the account lands in FORCE_CHANGE_PASSWORD and cannot
    # sign in from the client.
    aws cognito-idp admin-set-user-password \
      --user-pool-id "$POOL_ID" --username "$EMAIL" \
      --password "$PASSWORD" --permanent --region "$REGION"

    echo "    created $EMAIL"
  fi

  if [[ "$IS_ADMIN" == "yes" ]]; then
    aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" \
      --username "$EMAIL" --group-name admins --region "$REGION" >/dev/null 2>&1 || true
  fi
}

echo "==> Demo accounts"
create_user "$ADMIN_EMAIL"  "$ADMIN_PASSWORD"  "Store Admin" yes
create_user "$READER_EMAIL" "$READER_PASSWORD" "Demo Reader" no

# --- Write the frontend config ----------------------------------------------
ENV_FILE="$ROOT/.env.cognito"
cat > "$ENV_FILE" <<EOF
# Generated by tools/aws/scripts/06-cognito.sh
# Copy these into .env once your teammate gives you the API URL.
#
# These three values are PUBLIC identifiers — they are designed to ship inside a
# browser bundle. They are not secrets. An access key would be; never put one here.

VITE_COGNITO_USER_POOL_ID=$POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
VITE_COGNITO_REGION=$REGION

# Set these two when the backend is live:
# VITE_API_BASE_URL=https://<your-api-url>
# VITE_AUTH_MODE=cognito
EOF

cat <<NOTE

================================================
  Cognito ready
================================================

  User Pool ID : $POOL_ID
  App Client ID: $CLIENT_ID
  Region       : $REGION

  Demo accounts (password already set, no email confirmation needed):
    $ADMIN_EMAIL  / $ADMIN_PASSWORD   (in 'admins' group)
    $READER_EMAIL / $READER_PASSWORD

  Written to: .env.cognito at the repo root

  Console:
  https://$REGION.console.aws.amazon.com/cognito/v2/idp/user-pools/$POOL_ID/users?region=$REGION

  Screenshot the pool overview, the app client settings, and the group —
  the brief asks for evidence of how each cloud service was configured.

  Give your teammate the User Pool ID and region so his API can verify the
  JWTs (the 'aws-jwt-verify' library). He does NOT need the client ID.

NOTE
