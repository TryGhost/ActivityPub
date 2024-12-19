# build

```
docker build . -t query-runner:latest
```

# run

```
docker run --rm -e MYSQL_HOST=<ip> -e MYSQL_USER=<user> -e MYSQL_PASSWORD=<pass> -e MYSQL_DATABASE=activitypub_061224 query-runner
```

# build & run

```
docker build . -t query-runner:latest && docker run --rm -e MYSQL_HOST=<ip> -e MYSQL_USER=<user> -e MYSQL_PASSWORD=<pass> -e MYSQL_DATABASE=activitypub_061224 query-runner
```
