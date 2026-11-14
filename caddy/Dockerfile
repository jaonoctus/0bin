# Caddy with the rate limit plugin (https://github.com/mholt/caddy-ratelimit),
# which is not part of the stock image.
FROM caddy:2-builder AS builder

# Pinned to a commit: the only tagged release (v0.1.0) predates the
# ipv6_prefix option used in the Caddyfile and silently ignores it.
RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db

FROM caddy:2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
