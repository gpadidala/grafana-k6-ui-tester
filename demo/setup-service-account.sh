#!/bin/bash
# Creates a Grafana Service Account with Admin role and generates a token
# Idempotent — safe to run multiple times

set -e

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
ADMIN_PASS="${GRAFANA_ADMIN_PASS:-admin}"
SA_NAME="k6-tester"
TOKEN_NAME="k6-test-token"

echo "Setting up service account on ${GRAFANA_URL}..."

# Check if service account already exists
SA_LIST=$(curl -s -u "${ADMIN_USER}:${ADMIN_PASS}" \
  "${GRAFANA_URL}/api/serviceaccounts/search?query=${SA_NAME}" 2>/dev/null)

SA_ID=$(echo "$SA_LIST" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    accounts = data.get('serviceAccounts', [])
    for sa in accounts:
        if sa.get('name') == '${SA_NAME}':
            print(sa['id'])
            break
except: pass
" 2>/dev/null)

if [ -z "$SA_ID" ]; then
  # Create service account
  SA_RESPONSE=$(curl -s -u "${ADMIN_USER}:${ADMIN_PASS}" \
    -X POST "${GRAFANA_URL}/api/serviceaccounts" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${SA_NAME}\",\"role\":\"Admin\"}")

  SA_ID=$(echo "$SA_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

  if [ -z "$SA_ID" ]; then
    echo "ERROR: Failed to create service account"
    echo "$SA_RESPONSE"
    exit 1
  fi
  echo "Created service account: ${SA_NAME} (ID: ${SA_ID})"
else
  echo "Service account already exists (ID: ${SA_ID})"
fi

# Create token (delete existing first if any)
TOKENS=$(curl -s -u "${ADMIN_USER}:${ADMIN_PASS}" \
  "${GRAFANA_URL}/api/serviceaccounts/${SA_ID}/tokens" 2>/dev/null)

EXISTING_TOKEN_ID=$(echo "$TOKENS" | python3 -c "
import sys, json
try:
    tokens = json.load(sys.stdin)
    for t in tokens:
        if t.get('name') == '${TOKEN_NAME}':
            print(t['id'])
            break
except: pass
" 2>/dev/null)

if [ -n "$EXISTING_TOKEN_ID" ]; then
  curl -s -u "${ADMIN_USER}:${ADMIN_PASS}" \
    -X DELETE "${GRAFANA_URL}/api/serviceaccounts/${SA_ID}/tokens/${EXISTING_TOKEN_ID}" >/dev/null 2>&1
fi

# Create new token
TOKEN_RESPONSE=$(curl -s -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -X POST "${GRAFANA_URL}/api/serviceaccounts/${SA_ID}/tokens" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${TOKEN_NAME}\"}")

TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to create token"
  echo "$TOKEN_RESPONSE"
  exit 1
fi

echo "Token created successfully"
echo "$TOKEN"
