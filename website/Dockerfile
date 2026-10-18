# syntax=docker/dockerfile:1.7
# Static documentation image served under /migaia. Build context: website/.
# Every stage is Debian-based; the runtime holds only Caddy and the prerendered files.

ARG BUN_VERSION=1.4.3
ARG CADDY_VERSION=2.10.2

# Build: bun is the only JavaScript runtime. `--bun` keeps the Node-shebang CLIs on bun.
# The committed src/generated manifests are the input, so no workspace package is built here.
FROM oven/bun:${BUN_VERSION}-debian AS build
WORKDIR /website
COPY package.json bun.lock bunfig.toml ./
# @migaia/* packages come from the private GitHub Packages registry. The token arrives as a
# BuildKit secret and the .npmrc holding it is deleted in the same layer, so no image keeps it.
RUN --mount=type=secret,id=npm_token,required=true \
  printf '@migaia:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' \
    "$(cat /run/secrets/npm_token)" > .npmrc \
  && bun install --frozen-lockfile \
  && rm .npmrc
COPY . .
ENV WEBSITE_BASE=/migaia/
# Index the basename directory so Pagefind URLs are /zh/... ; indexing build/client would record
# /migaia/zh/... and the runtime's derived /migaia/ base URL would double the prefix into a 404.
RUN bun --bun react-router build && bun --bun pagefind --site build/client/migaia

# Caddy: official static release binary, checked against the release checksum list.
FROM debian:trixie-slim AS caddy
ARG CADDY_VERSION
ARG TARGETARCH
WORKDIR /tmp/caddy
ADD https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${TARGETARCH}.tar.gz ./
ADD https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_checksums.txt ./
RUN grep " caddy_${CADDY_VERSION}_linux_${TARGETARCH}.tar.gz\$" caddy_${CADDY_VERSION}_checksums.txt | sha512sum -c - \
  && tar -xzf caddy_${CADDY_VERSION}_linux_${TARGETARCH}.tar.gz caddy

# Runtime: distroless Debian, no shell, non-root.
FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=caddy /tmp/caddy/caddy /usr/bin/caddy
COPY docker/Caddyfile /etc/caddy/Caddyfile
# React Router writes basename pages to build/client/migaia/ (Pagefind writes its bundle there
# too), but assets stay at build/client/; their URLs are /migaia/assets and /migaia/pagefind.
COPY --from=build /website/build/client/migaia /srv/migaia
COPY --from=build /website/build/client/assets /srv/migaia/assets
EXPOSE 8080
ENTRYPOINT ["/usr/bin/caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
