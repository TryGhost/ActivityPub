FROM debian:bookworm-slim@sha256:56ff6d36d4eb3db13a741b342ec466f121480b5edded42e4b7ee850ce7a418ee

RUN apt-get update -y && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/* && \
    curl -L https://github.com/golang-migrate/migrate/releases/download/v4.17.1/migrate.linux-amd64.tar.gz | tar xvz && \
    mv migrate /usr/bin/

COPY bin /usr/local/bin

COPY ./migrations /migrations

ENV MYSQL_DB=""

CMD ["up"]
