FROM debian:bookworm@sha256:7e5bc0e499a8d50cb1e32287944a90b9ec8fd7d500673e75daff3f52882f5798

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
