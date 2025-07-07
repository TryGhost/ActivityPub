FROM debian:bookworm@sha256:d42b86d7e24d78a33edcf1ef4f65a20e34acb1e1abd53cabc3f7cdf769fc4082

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
