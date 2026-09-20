#!/usr/bin/env bash
#
# A REAL Vikunja, locally, for `npm run verify:vikunja` (#259, Phase 2).
#
# Not a fake and not a mock: the released Linux binary, SQLite behind it, a
# registered user and a scoped API token. The brief asks for the integration to
# be proved against a real server, and this is the cheapest real server there
# is — no account, no hosting, nothing to pay for, nothing to cancel.
#
# Secrets: the JWT signing secret, the account password and the API token are
# generated here into files with mode 600 under $VIKUNJA_HOME and are NEVER
# printed. Nothing here writes into the repository.
#
# It is idempotent: run it again and it reuses what it finds.
set -euo pipefail

VERSION="${VIKUNJA_VERSION:-v2.6.0}"
HOME_DIR="${VIKUNJA_HOME:-/tmp/vikunja-dev}"
PORT="${VIKUNJA_PORT:-3456}"
BIN="$HOME_DIR/vikunja-$VERSION-linux-amd64"

mkdir -p "$HOME_DIR/files"
cd "$HOME_DIR"

if [ ! -x "$BIN" ]; then
  echo "fetching Vikunja $VERSION (once, about 46MB)"
  curl -sS -O "https://dl.vikunja.io/vikunja/$VERSION/vikunja-$VERSION-linux-amd64-full.zip"
  unzip -o -q "vikunja-$VERSION-linux-amd64-full.zip"
  # The release publishes a checksum beside the binary. A download nobody
  # checked is a download somebody can replace.
  sha256sum -c "vikunja-$VERSION-linux-amd64.sha256"
fi

[ -f .jwt ] || { python3 -c "import secrets;print(secrets.token_urlsafe(48),end='')" > .jwt; chmod 600 .jwt; }
[ -f .pw ]  || { python3 -c "import secrets;print(secrets.token_urlsafe(24),end='')" > .pw;  chmod 600 .pw; }

if ! curl -sS --noproxy 127.0.0.1 -o /dev/null "http://127.0.0.1:$PORT/api/v1/info" 2>/dev/null; then
  echo "starting Vikunja on 127.0.0.1:$PORT"
  VIKUNJA_DATABASE_TYPE=sqlite \
  VIKUNJA_DATABASE_PATH="$HOME_DIR/vikunja.db" \
  VIKUNJA_SERVICE_INTERFACE=":$PORT" \
  VIKUNJA_SERVICE_PUBLICURL="http://127.0.0.1:$PORT/" \
  VIKUNJA_SERVICE_ENABLEREGISTRATION=true \
  VIKUNJA_SERVICE_JWTSECRET="$(cat .jwt)" \
  VIKUNJA_FILES_BASEPATH="$HOME_DIR/files" \
  nohup "$BIN" > "$HOME_DIR/server.log" 2>&1 &
  for _ in $(seq 1 40); do
    sleep 1
    curl -sS --noproxy 127.0.0.1 -o /dev/null "http://127.0.0.1:$PORT/api/v1/info" 2>/dev/null && break
  done
fi

curl -sS --noproxy 127.0.0.1 -o /dev/null "http://127.0.0.1:$PORT/api/v1/info" \
  || { echo "Vikunja did not come up; see $HOME_DIR/server.log"; exit 1; }

# The account. Registering one that exists answers an error, which is fine.
PW="$(cat .pw)"
curl -sS --noproxy 127.0.0.1 -o /dev/null -X POST "http://127.0.0.1:$PORT/api/v1/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"office\",\"password\":\"$PW\",\"email\":\"office@example.invalid\"}" || true

JWT="$(curl -sS --noproxy 127.0.0.1 -X POST "http://127.0.0.1:$PORT/api/v1/login" \
  -H 'Content-Type: application/json' -d "{\"username\":\"office\",\"password\":\"$PW\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""),end="")')"
[ -n "$JWT" ] || { echo "could not log in to the local Vikunja"; exit 1; }

if [ ! -s .apitok ]; then
  # Scoped to what the office actually does. A token that can do everything is
  # a token whose blast radius nobody can state.
  curl -sS --noproxy 127.0.0.1 -X PUT "http://127.0.0.1:$PORT/api/v1/tokens" \
    -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
    -d '{"title":"agentic-team-office","permissions":{
          "tasks":["create","read_all","read_one","update","delete"],
          "projects":["create","read_all","read_one","update","delete"],
          "labels":["create","read_all"],
          "tasks_labels":["create","read_all","delete"]},
         "expires_at":"2027-09-20T00:00:00Z"}' \
    | python3 -c 'import sys,json,pathlib;pathlib.Path(".apitok").write_text(json.load(sys.stdin).get("token",""))'
  chmod 600 .apitok
fi
[ -s .apitok ] || { echo "could not mint an API token"; exit 1; }

echo
echo "Vikunja $VERSION is up at http://127.0.0.1:$PORT"
echo "the API token is in $HOME_DIR/.apitok — deliberately not printed"
echo
echo "  export VIKUNJA_URL=http://127.0.0.1:$PORT"
echo "  export VIKUNJA_TOKEN_FILE=$HOME_DIR/.apitok"
echo "  npm run verify:vikunja"
