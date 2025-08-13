FROM debian:bookworm@sha256:731dd1380d6a8d170a695dbeb17fe0eade0e1c29f654cf0a3a07f372191c3f4b

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
