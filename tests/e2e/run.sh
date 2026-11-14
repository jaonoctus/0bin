#! /bin/bash

# Start a throwaway 0bin server (temporary data and config dirs) and run the
# browser test against it.
#
#   tests/e2e/run.sh              minified assets, as served in production
#   DEBUG=true tests/e2e/run.sh   debug mode: individual, unminified sources
#
# Requires the app to be installed (`pip install -e .`), node, a local Chrome
# or Chromium (see run.mjs) and `npm ci` to have been run in this directory.

set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PORT:-3299}
DEBUG=${DEBUG:-false}
BASE="http://127.0.0.1:$PORT"

WORK=$(mktemp -d)

cd "$ROOT"
python -m zerobin runserver --debug "$DEBUG" --host 127.0.0.1 --port "$PORT" \
  --data-dir "$WORK/data" --config-dir "$WORK/config" >"$WORK/server.log" 2>&1 &
SERVER=$!

cleanup() {
  status=$?
  # In debug mode the server is bottle's reloader, which runs the app in a child
  pkill -P "$SERVER" 2>/dev/null || true
  kill "$SERVER" 2>/dev/null || true
  wait "$SERVER" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    echo "---- server log ----"
    cat "$WORK/server.log"
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

for _ in $(seq 60); do
  if curl -sf -o /dev/null "$BASE/"; then
    break
  fi
  if ! kill -0 "$SERVER" 2>/dev/null; then
    echo >&2 "Error: the server exited before answering."
    exit 1
  fi
  sleep 0.5
done
curl -sf -o /dev/null "$BASE/" || {
  echo >&2 "Error: the server did not answer on $BASE."
  exit 1
}

cd "$HERE"
node run.mjs "$BASE"
