FROM debian:bookworm

RUN apt-get update -y
RUN apt-get install -y curl
RUN curl -L https://github.com/golang-migrate/migrate/releases/download/v4.17.1/migrate.linux-amd64.tar.gz | tar xvz
RUN mv migrate /usr/bin/

COPY bin /usr/local/bin

COPY ./migrations /migrations

ENV MYSQL_DB=""

CMD ["up"]
