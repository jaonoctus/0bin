#! /bin/bash

# Fetch the Vue 3 browser builds from npm into zerobin/static/js/:
#   vue.js      development build, loaded as is when settings.DEBUG is on
#   vue.min.js  production build, concatenated into main.min.js by compress.sh
# Both are the "global" full builds: they expose `Vue` and include the template
# compiler, which 0bin needs because its templates live in the served HTML.
#
# Requires node and npm. Bump the version below, run this script, then run
# compress.sh (or `doit compress`) to rebuild main.min.js.

set -euo pipefail

VUE_VERSION="3.5.45"

CURDIR=$(cd "$(dirname "$0")" && pwd)
JSDIR="$CURDIR/zerobin/static/js"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

npm init -y >/dev/null
npm install --silent --no-audit --no-fund "vue@$VUE_VERSION"

cp node_modules/vue/dist/vue.global.js "$JSDIR/vue.js"
cp node_modules/vue/dist/vue.global.prod.js "$JSDIR/vue.min.js"

echo "Wrote $JSDIR/vue.js and $JSDIR/vue.min.js"
