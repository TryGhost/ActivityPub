FROM debian:bookworm@sha256:26f2a7cab45014541c65f9d140ccfa6aaefbb49686c6759bea9c6f7f5bb3d72f

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
