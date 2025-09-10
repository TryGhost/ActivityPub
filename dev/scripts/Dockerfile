FROM debian:bookworm@sha256:7dc1e2b39b0147079a16347915e9583cb2f239d4896fe2beac396b979e5c06a9

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
