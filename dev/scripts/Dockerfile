FROM debian:bookworm@sha256:562665545b4070ef8d4e2fef66c9abc37a39b749f58a11bda5d7120f6cb327b3

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
