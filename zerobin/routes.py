"""
    Script including controller, rooting, and dependency management.
"""

import os

from distutils.util import strtobool

from datetime import datetime, timedelta

import hashlib

import bottle
from bottle import (
    Bottle,
    static_file,
    view,
    request,
    HTTPResponse,
)

from zerobin import __version__
from zerobin.utils import (
    SettingsValidationError,
    ensure_app_context,
    settings,
)
from zerobin.paste import Paste


ensure_app_context()


def static_files_version():
    """
        Short hash of the CSS and JS files referenced by base.tpl, appended to
        their URLs so browsers drop cached copies whenever the files change.
        Computed once at startup: restart the server after editing them.
    """
    digest = hashlib.sha1()
    for name in (
        "css/style.min.css",
        "css/style.css",
        "js/main.min.js",
        "js/noble.js",
        "js/zerobin-crypto.js",
        "js/behavior.js",
    ):
        digest.update((settings.STATIC_FILES_ROOT / name).read_bytes())
    return digest.hexdigest()[:10]


GLOBAL_CONTEXT = {
    "settings": settings,
    "VERSION": __version__,
    "STATIC_VERSION": static_files_version(),
    "pastes_count": Paste.get_pastes_count(),
    "refresh_counter": datetime.now(),
}


app = Bottle()

# Start of the JSON payload produced by static/js/zerobin-crypto.js
ENCRYPTED_PAYLOAD_PREFIX = '{"v":2,"cipher":"xchacha20poly1305"'


@app.route("/")
@view("home")
def index():
    return GLOBAL_CONTEXT


@app.get("/faq/")
@view("faq")
def faq():
    return GLOBAL_CONTEXT


@app.post("/paste/create")
def create_paste():

    # Reject what is too small, too big, or what does not look like a payload
    # produced by zerobin-crypto.js, to limit abuses
    content = request.forms.get("content", "")
    if not content.startswith(ENCRYPTED_PAYLOAD_PREFIX) or not (
        0 < len(content) < settings.MAX_SIZE
    ):
        return {"status": "error", "message": "Wrong data payload."}

    expiration = request.forms.get("expiration", "burn_after_reading")
    if expiration != "burn_after_reading" and expiration not in Paste.DURATIONS:
        return {"status": "error", "message": "Wrong expiration value."}

    title = request.forms.get("title", "")
    btc_tip_address = request.forms.get("btcTipAddress", "")

    paste = Paste(
        expiration=expiration,
        content=content,
        uuid_length=settings.PASTE_ID_LENGTH,
        title=title,
        btc_tip_address=btc_tip_address,
    )
    paste.save()

    # If refresh time elapsed pick up, update the counter
    if settings.DISPLAY_COUNTER:

        paste.increment_counter()

        now = datetime.now()
        timeout = GLOBAL_CONTEXT["refresh_counter"] + timedelta(
            seconds=settings.REFRESH_COUNTER
        )
        if timeout < now:
            GLOBAL_CONTEXT["pastes_count"] = Paste.get_pastes_count()
            GLOBAL_CONTEXT["refresh_counter"] = now

    return {"status": "ok", "paste": paste.uuid, "owner_key": paste.owner_key}


@app.get("/paste/:paste_id")
@view("paste")
def display_paste(paste_id):

    now = datetime.now()
    keep_alive = False
    try:
        paste = Paste.load(paste_id)
        # Delete the paste if it expired:
        if not isinstance(paste.expiration, datetime):
            # burn_after_reading contains the paste creation date
            # if this read appends 10 seconds after the creation date
            # we don't delete the paste because it means it's the redirection
            # to the paste that happens during the paste creation
            try:
                keep_alive = paste.expiration.split("#")[1]
                keep_alive = datetime.strptime(keep_alive, "%Y-%m-%d %H:%M:%S.%f")
                keep_alive = now < keep_alive + timedelta(seconds=10)
            except IndexError:
                keep_alive = False
            if not keep_alive:
                paste.delete()

        elif paste.expiration < now:
            paste.delete()
            raise ValueError()

    except (TypeError, ValueError):
        return error404(ValueError)

    return {"paste": paste, "keep_alive": keep_alive, **GLOBAL_CONTEXT}


@app.delete("/paste/:paste_id")
def delete_paste(paste_id):

    try:
        paste = Paste.load(paste_id)
    except (TypeError, ValueError):
        return error404(ValueError)

    if paste.owner_key != request.forms.get("owner_key", None):
        return HTTPResponse(status=403, body="Wrong owner key")

    paste.delete()

    return {
        "status": "ok",
        "message": "Paste deleted",
    }


@app.error(404)
@view("404")
def error404(code):
    return GLOBAL_CONTEXT


@app.get("/static/<filename:path>")
def server_static(filename):
    return static_file(filename, root=settings.STATIC_FILES_ROOT)


def get_app(debug=None, config_dir="", data_dir=""):
    """
        Return a tuple (settings, app) configured using passed
        parameters and/or a setting file.
    """

    data_dir = data_dir or os.environ.get("ZEROBIN_DATA_DIR")
    config_dir = config_dir or os.environ.get("ZEROBIN_CONFIG_DIR")

    ensure_app_context(config_dir=config_dir, data_dir=data_dir)

    if debug is None:
        settings.DEBUG = bool(
            strtobool(os.environ.get("ZEROBIN_DEBUG", str(settings.DEBUG)))
        )
    else:
        settings.DEBUG = debug

    settings.DISPLAY_COUNTER = bool(
        os.environ.get("ZEROBIN_DISPLAY_COUNTER", settings.DISPLAY_COUNTER)
    )
    settings.REFRESH_COUNTER = int(
        os.environ.get("ZEROBIN_REFRESH_COUNTER", settings.REFRESH_COUNTER)
    )
    settings.MAX_SIZE = int(os.environ.get("ZEROBIN_MAX_SIZE", settings.MAX_SIZE))
    settings.PASTE_ID_LENGTH = int(
        os.environ.get("ZEROBIN_PASTE_ID_LENGTH", settings.PASTE_ID_LENGTH)
    )

    if settings.PASTE_ID_LENGTH < 4:
        raise SettingsValidationError("PASTE_ID_LENGTH cannot be lower than 4")

    return settings, app
