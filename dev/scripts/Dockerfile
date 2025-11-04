FROM debian:bookworm@sha256:6337ad82d5c764a8b6a16cde86b157fdce353e36d8ca06fc1b16d4f34d29960e

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
