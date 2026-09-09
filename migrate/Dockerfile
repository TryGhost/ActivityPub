FROM docker.io/library/alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

# Binary is copied from golang-migrate's published image rather than their
# release tarball so Renovate tracks the digest. Not used as a base: it sets
# ENTRYPOINT ["migrate"] and runs on a different version of Alpine.
COPY --from=docker.io/migrate/migrate:v4.20.1@sha256:76cc2074cb6642631f34a898ced71e6aeaa6b1a4d78c4daa743275a22e0c5be7 /usr/local/bin/migrate /usr/bin/migrate

COPY bin /usr/local/bin

# bin/up and bin/create use a relative `migrations` path, so cwd stays at /.
COPY ./migrations /migrations

ENV MYSQL_DB=""

CMD ["up"]
