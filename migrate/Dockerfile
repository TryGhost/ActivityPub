FROM debian:bookworm-slim@sha256:6ac2c08566499cc2415926653cf2ed7c3aedac445675a013cc09469c9e118fdd

RUN apt-get update -y && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/* && \
    curl -L https://github.com/golang-migrate/migrate/releases/download/v4.17.1/migrate.linux-amd64.tar.gz | tar xvz && \
    mv migrate /usr/bin/

COPY bin /usr/local/bin

COPY ./migrations /migrations

ENV MYSQL_DB=""

CMD ["up"]
