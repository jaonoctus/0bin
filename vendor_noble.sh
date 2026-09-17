#! /bin/bash

# Build zerobin/static/js/noble.js: a self-contained, minified browser bundle of
# the parts of @noble/ciphers and @noble/hashes that 0bin uses, exposed as the
# global `noble`. The npm packages only ship ES modules and the projects' own
# standalone release files are not published for every version, so we bundle.
#
# Requires node and npm. Bump the versions below, run this script, then run
# compress.sh (or `doit compress`) to rebuild main.min.js.

set -euo pipefail

NOBLE_CIPHERS_VERSION="2.4.0"
NOBLE_HASHES_VERSION="2.4.0"
ESBUILD_VERSION="0.25.9"

CURDIR=$(cd "$(dirname "$0")" && pwd)
OUT="$CURDIR/zerobin/static/js/noble.js"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

npm init -y >/dev/null
npm install --silent --no-audit --no-fund \
  "@noble/ciphers@$NOBLE_CIPHERS_VERSION" \
  "@noble/hashes@$NOBLE_HASHES_VERSION" \
  "esbuild@$ESBUILD_VERSION"

cat > entry.js <<'JS'
export { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
export { randomBytes, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js';
export { argon2idAsync } from '@noble/hashes/argon2.js';
JS

npx esbuild entry.js \
  --bundle --minify --format=iife --global-name=noble --target=es2020 \
  --banner:js="/* @noble/ciphers $NOBLE_CIPHERS_VERSION and @noble/hashes $NOBLE_HASHES_VERSION, MIT, https://paulmillr.com/noble/. Built by vendor_noble.sh, do not edit. */" \
  --outfile="$OUT"

echo "Wrote $OUT"
