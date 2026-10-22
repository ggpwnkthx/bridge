# syntax=docker/dockerfile:1

# The version of the runtime and the revision of the build are labels of the
# image: an operator has to know what is running without reading the logs.
#
# The base image is pinned by digest: a tag is a name that moves, and the
# image of a release has to be the image that was built and scanned.
ARG BUN_VERSION=1.4.3
ARG BUN_DIGEST=sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373
ARG VERSION=0.1.0
ARG REVISION=unknown

# ---------------------------------------------------------------- dependencies
#
# The dependencies of the studio alone. The development dependencies (the
# types of the tests) are not part of the image of the studio.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production && \
    rm -rf /root/.bun/install/cache

# ------------------------------------------------------------------- runtime
#
# The production image contains the studio and the assets of its user
# interface. There is no secret in it: the secret of the client of the
# studio at the broker and the key of the gateway are given to the process
# in its environment.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS runtime
WORKDIR /app

ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="bridge" \
      org.opencontainers.image.description="The studio of the headless data backend: it shows the collections, the rows, the aggregates and the audit log of a workspace." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/ggpwnkthx/bridge" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    BRIDGE_HOST=0.0.0.0 \
    BRIDGE_PORT=8081 \
    BRIDGE_PROBES=true

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
COPY package.json ./

# The script of the browser is built in the image: the studio serves it,
# and it never builds anything at the time of a request.
RUN bun run scripts/build.ts && chown -R bun:bun /app/public

# The studio runs as a user that is not root: a container that is root on
# the host of the container is root on the host.
USER bun
EXPOSE 8081

# The studio writes nothing: the logs go to the standard output, and the
# file system of the container can be read-only.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8081/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["bun", "run"]
CMD ["src/main.ts"]
