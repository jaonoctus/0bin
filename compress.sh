#! /bin/bash

export PYTHONWARNINGS=ignore::FutureWarning # scss prints future warnings

python -c "import scss" || {
    echo >&2 "Error: this script requires the scss python module. pip install -r dev-requirements.txt"
    exit 1
}

command -v "uglifyjs" >/dev/null 2>&1 || {
    echo >&2 "Error: this script requires the command 'uglifyjs' to be available."
    exit 1
}

CURDIR=$(dirname $(readlink -f $0))
CSSDIR=$CURDIR'/zerobin/static/css/'
JSDIR=$CURDIR'/zerobin/static/js/'

MAIN_JS_OUTPUT=$JSDIR"main.min.js"
CSS_OUTPUT=$CSSDIR"style.min.css"

cat /dev/null >$CSS_OUTPUT

echo "Compressing CSS..."

echo $'\n''/* Prettify */' >>$CSS_OUTPUT
python -m scss $CSSDIR'prettify.css' >>$CSS_OUTPUT

echo $'\n''/* Desert prettify theme */' >>$CSS_OUTPUT
python -m scss $CSSDIR'desert.css' >>$CSS_OUTPUT

echo $'\n''/* Bootswatch bootstrap theme */' >>$CSS_OUTPUT
python -m scss $CSSDIR'bootswatch.4.5.css' >>$CSS_OUTPUT

echo $'\n''/* Our own CSS */' >>$CSS_OUTPUT
python -m scss $CSSDIR'style.css' >>$CSS_OUTPUT

echo "Compressing JS..."

cat /dev/null >$MAIN_JS_OUTPUT

echo $'\n''/* Vue */' >>$MAIN_JS_OUTPUT
uglifyjs $JSDIR'vue.js' >>$MAIN_JS_OUTPUT

# Built and minified by vendor_noble_ciphers.sh. It is modern JS that uglifyjs
# may not parse, so it is concatenated as is.
echo $'\n''/* @noble/ciphers */' >>$MAIN_JS_OUTPUT
cat $JSDIR'noble-ciphers.js' >>$MAIN_JS_OUTPUT

echo $'\n''/* Our own JS */' >>$MAIN_JS_OUTPUT
uglifyjs $JSDIR'zerobin-crypto.js' >>$MAIN_JS_OUTPUT
uglifyjs $JSDIR'behavior.js' >>$MAIN_JS_OUTPUT

echo $'\n''/* Prettify */' >>$MAIN_JS_OUTPUT
uglifyjs $JSDIR'prettify.min.js' >>$MAIN_JS_OUTPUT

echo "Done"
