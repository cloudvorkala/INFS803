
param(
    [ValidateSet("race", "rollback")]
    [string]$Case = "race"
)

$ErrorActionPreference = "Stop"

# Load .env.k6
Get-Content ".env.k6" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable(
            $matches[1].Trim(),
            $matches[2].Trim(),
            'Process'
        )
    }
}

function Get-CognitoIdToken {
    param(
        [string]$Username,
        [string]$Password
    )

    return aws cognito-idp initiate-auth `
        --region ap-southeast-2 `
        --client-id $env:COGNITO_CLIENT_ID `
        --auth-flow USER_PASSWORD_AUTH `
        --auth-parameters "USERNAME=$Username,PASSWORD=$Password" `
        --query "AuthenticationResult.IdToken" `
        --output text
}

Write-Host "Refreshing Cognito test tokens..."

$env:ADMIN_ID_TOKEN = Get-CognitoIdToken `
    $env:ADMIN_USERNAME `
    $env:ADMIN_PASSWORD

$env:USER_A_ID_TOKEN = Get-CognitoIdToken `
    $env:USER_A_USERNAME `
    $env:USER_A_PASSWORD

$env:USER_B_ID_TOKEN = Get-CognitoIdToken `
    $env:USER_B_USERNAME `
    $env:USER_B_PASSWORD

Write-Host "Tokens refreshed."

# Export current AWS CLI credentials for DynamoDB read-only checks
$awsCredJson = (aws configure export-credentials --format process) -join "`n"

if ($LASTEXITCODE -ne 0) {
    throw "Failed to export AWS credentials."
}

$awsCred = $awsCredJson | ConvertFrom-Json

$env:AWS_ACCESS_KEY_ID = $awsCred.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $awsCred.SecretAccessKey

if ($awsCred.SessionToken) {
    $env:AWS_SESSION_TOKEN = $awsCred.SessionToken
} else {
    Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
}

Write-Host "AWS credentials exported."

# Run test
k6 run -e CASE=$Case test-checkout.js