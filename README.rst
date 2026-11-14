**WARNING**: *0bin is dead and will likely stay that way. We got a surge in CP report and decided to not keep it up. Some trouble has to be expected, and we always had to perform some take down, but this is now too much.*

*We dropped the 0bin.net domain, some scammers bought it, and are now controlling it. DO NOT TRUST IT.*

*The code stays available if you choose to host your own instance.*


0bin: a client side encrypted pastebin
===========================================

0bin is a pastebin that encrypts the user content in the browser and can run without a database.

0bin allows anybody to host a pastebin while welcoming any type of content to
be pasted in it. The idea is that one can (probably...) not be legally entitled
to `moderate the pastebin content`_ as they have no way to decrypt it.

It's an Python implementation of the `zerobin project`_, created by sebsauvage, under the `WTFPL licence`_.

To run zerobin, download zerobin.pyz from the latest release_ then:

::

    python zerobin.pyz

0bin requires Python 3.10 or higher.

You may need to type :code:`py -3.10 zerobin.pyz` on Windows, or :code:`python3.10 zerobin.pyz` on Mac/Linux, depending on your configuration.

If you are familiar with the Python ecosystem, you can also :code:`python -m pip install zerobin --user` and run :code:`python -m zerobin` for the same effect.


How it works
=============

When creating the paste:

- the browser generates a random key;
- the pasted content is encrypted with this key using XChaCha20-Poly1305;
- the encrypted pasted content is sent to the server;
- the browser receives the paste URL and adds the key in the URL hash (#).

When reading the paste:

- the browser makes the GET request to the paste URL;
- because the key is in the hash, the key is not part of the request;
- browser gets the encrypted content end decrypts it using the key;
- the pasted decrypted content is displayed and sourcecode is highlighted.

Key points:

- because the key is in the hash, the key is never sent to the server;
- therefore it won't appear in the server logs;
- all operations, including code coloration, happen on the client-side;
- the server is no more than a fancy recipient for the encrypted data.

Other features
======================

- automatic code coloration (no need to specify the language);
- pastebin expiration: 1 day or 1 month;
- burn after reading: the paste is destroyed after the first reading, or after
  1 month if nobody reads it;
- optional passphrase: readers need it in addition to the link;
- clone paste: you can't edit a paste, but you can duplicate any of them;
- code upload: if a file is too big, you can upload it instead of using copy/paste;
- copy paste to clipboard in a click;
- own previous pastes history;
- reader mode;

Hosting an instance
===================

0bin stores every paste as a file and does not limit or clean up anything by
itself. If your instance is reachable by other people, set up both of the
following, or anybody can fill your disk.

**Rate limit paste creation.** Each :code:`POST /paste/create` stores up to
:code:`MAX_SIZE` (1 MB by default) and needs no account, so put a reverse proxy
in front of 0bin and throttle that route per client IP.

The provided :code:`docker-compose.yml` does it for you: it runs Caddy with the
`caddy-ratelimit`_ plugin in front of the application (see the :code:`caddy/`
directory) and only publishes the proxy:

::

    docker compose up -d --build        # http://localhost:3255

The default is 10 paste creations per minute per client IP (per /64 for IPv6).
Change it with :code:`ZEROBIN_RATE_LIMIT_EVENTS` and
:code:`ZEROBIN_RATE_LIMIT_WINDOW` in :code:`docker-compose.yml`. If another
proxy or a tunnel sits in front of Caddy, it must pass the client address in
:code:`X-Forwarded-For`, or all visitors will share one allowance.

Any other proxy that can rate limit works as well, for example nginx with
:code:`limit_req` or a rate limiting rule at your CDN. Stock Caddy can't: it
needs the plugin.

**Delete expired pastes on a schedule.** Expired pastes are only removed when
somebody opens them. Everything else, including burn after reading pastes that
nobody ever read, stays on disk until you run:

::

    python -m zerobin clean-expired-pastes

Add :code:`--dry-run --verbose` to see what it would delete first. Run it
every day, for example from cron (:code:`/etc/cron.d/0bin-clean`), here with
the Docker setup above:

::

    17 4 * * * root /usr/bin/docker exec zerobin python -m zerobin clean-expired-pastes 2>&1 | /usr/bin/logger -t 0bin-clean

Outside Docker, run the command as the user that runs the server. If you
started the server with :code:`--data-dir` or :code:`ZEROBIN_DATA_DIR`, pass
the same :code:`--data-dir` to the command: it does not read the environment
variable.

Known issues
============

- 0bin uses several HTML5/CSS3 features that are not widely supported. In that case we handle the degradation as gracefully as we can.
- The pasted content size limit check is not accurate. It's just a safety net, so we think it's ok.


.. _moderate the pastebin content: http://www.zdnet.com/blog/security/pastebin-to-hunt-for-hacker-pastes-anonymous-cries-censorship/11336
.. _zerobin project: https://github.com/sebsauvage/ZeroBin/
.. _node.js: http://nodejs.org/
.. _is not worth it: http://stackoverflow.com/questions/201705/how-many-random-elements-before-md5-produces-collisions
.. _WTFPL licence: http://en.wikipedia.org/wiki/WTFPL
.. _release: https://github.com/Tygs/0bin/releases
.. _caddy-ratelimit: https://github.com/mholt/caddy-ratelimit

Contributing
=============

We cannot accept contributions for the moment, and will ignore PR.
