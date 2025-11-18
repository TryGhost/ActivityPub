FROM debian:bookworm@sha256:3d957cd5e0693cf44cbb65aa43033fb701443df6b0afa4dcc9293c9bb7a258f9

RUN apt-get update -y
RUN apt-get install -y curl openssl jq

COPY bin /usr/local/bin
