FROM debian:bookworm@sha256:0d8498a0e9e6a60011df39aab78534cfe940785e7c59d19dfae1eb53ea59babe

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
