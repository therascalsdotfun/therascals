#!/usr/bin/env bash
# Push the repo to the server and bring the stack up. Re-runnable: every call
# rebuilds the image and restarts the container.
#
# Uses a reviewed source snapshot rather than changing the server Git checkout. `.env` is
# excluded, which also protects the live secrets file from `--delete`.
set -euo pipefail

HOST=${1:?usage: deploy.sh <ip-or-hostname> [ssh-key]}
KEY=${2:-$HOME/.oci/instance/rascals_oracle}
# Vultr and DigitalOcean install your key for root; Oracle's Ubuntu image uses
# the ubuntu user and needs sudo for docker.
SSH_USER=${SSH_USER:-ubuntu}
SUDO=$([ "$SSH_USER" = root ] && echo "" || echo "sudo ")
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
REPO=$(cd "$(dirname "$0")/.." && pwd)

$SSH "$SSH_USER@$HOST" true || { echo "cannot SSH to $SSH_USER@$HOST"; exit 1; }

# Private local state and generated worker artifacts never enter the upload.
$SSH "$SSH_USER@$HOST" 'mkdir -p /opt/rascals/repo'
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude target \
  --exclude .local-dev --exclude .tools --exclude .superpowers \
  --exclude artifacts --exclude __pycache__ --exclude '*.log' \
  --exclude 'workers/**/target/' --exclude 'workers/**/artifacts/' \
  --exclude .data --exclude .credentials --include '.env.example' --exclude '.env' --exclude '.env.*' --exclude '.gstack' \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$REPO/" "$SSH_USER@$HOST:/opt/rascals/repo/"
echo "synced $REPO -> $SSH_USER@$HOST:/opt/rascals/repo"

if ! $SSH "$SSH_USER@$HOST" 'test -f /opt/rascals/repo/deploy/.env' 2>/dev/null; then
  cat <<EOF

First deploy: the server has no deploy/.env yet. Create it once:

  $SSH $SSH_USER@$HOST 'cd /opt/rascals/repo/deploy && cp .env.example .env && chmod 600 .env && vi .env'

Fill in JACKPOT_PUBLIC_ORIGIN, JACKPOT_HOST and JACKPOT_PERPS_SECRET
(openssl rand -hex 32, generated off-box and saved somewhere durable),
then re-run this script.
EOF
  exit 1
fi

# The shared edge lives outside this project's tree on purpose: a redeploy with
# --delete must never be able to take down the proxy the other sites depend on.
# The repo is the source of truth for the Caddyfile, so it overwrites — but never
# touches secrets/, which holds the live Postgres password.
$SSH "$SSH_USER@$HOST" 'mkdir -p /opt/rascals/host/secrets'
rsync -az --exclude secrets \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "$REPO/deploy/host/" "$SSH_USER@$HOST:/opt/rascals/host/"
$SSH "$SSH_USER@$HOST" \
  "cd /opt/rascals/host && ${SUDO}docker compose up -d caddy" >/dev/null

$SSH "$SSH_USER@$HOST" "cd /opt/rascals/repo/deploy && ${SUDO}docker compose up -d --build" 2>&1 | tail -6

echo
echo "verifying..."
origin=$($SSH "$SSH_USER@$HOST" "grep '^JACKPOT_PUBLIC_ORIGIN=' /opt/rascals/repo/deploy/.env | cut -d= -f2")
for path in /api/health /api/runtime; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$origin$path" || echo 000)
  echo "  $path -> $code"
done
# The origin guard has to reject a foreign Origin, or the public box is trusting
# any site that embeds it.
bad=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST "$origin/api/intents/operations" \
  -H 'origin: https://evil.example' -H 'content-type: application/json' -d '{}')
[ "$bad" = "403" ] && echo "  foreign-origin POST -> 403 (correct)" || echo "  FAIL: foreign-origin POST -> $bad, expected 403"
# A proxy that mangles headers can strip the CSP nonce and silently break NEAR
# sign-in, so confirm the handshake survives the hop.
page=$(curl -s -m 20 "$origin/")
echo "$page" | grep -q 'name="csp-nonce"' && echo "  CSP nonce present" || echo "  FAIL: no csp-nonce meta on the served page"
