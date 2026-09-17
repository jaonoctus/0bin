#! /bin/bash

# Build zerobin/static/js/noble-ciphers.js: a self-contained, minified browser
# bundle of the parts of @noble/ciphers that 0bin uses, exposed as the global
# `nobleCiphers`. The npm package only ships ES modules and the project's own
# standalone release file is not published for every version, so we bundle it.
#
# Requires node and npm. Bump NOBLE_VERSION, run this script, then run
# compress.sh (or `doit compress`) to rebuild main.min.js.

set -euo pipefail

NOBLE_VERSION="2.4.0"
ESBUILD_VERSION="0.25.9"

CURDIR=$(cd "$(dirname "$0")" && pwd)
OUT="$CURDIR/zerobin/static/js/noble-ciphers.js"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

npm init -y >/dev/null
npm install --silent --no-audit --no-fund \
  "@noble/ciphers@$NOBLE_VERSION" "esbuild@$ESBUILD_VERSION"

cat > entry.js <<'JS'
export { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
export { randomBytes, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js';
JS

npx esbuild entry.js \
  --bundle --minify --format=iife --global-name=nobleCiphers --target=es2020 \
  --banner:js="/* @noble/ciphers $NOBLE_VERSION, MIT, https://github.com/paulmillr/noble-ciphers. Built by vendor_noble_ciphers.sh, do not edit. */" \
  --outfile="$OUT"

echo "Wrote $OUT"
