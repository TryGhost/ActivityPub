FROM debian:bookworm@sha256:b6507e340c43553136f5078284c8c68d86ec8262b1724dde73c325e8d3dcdeba

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
