#!/usr/bin/env bash

docker build -t data-generation .

docker run --rm --tty --name data-generation \
    -v $(pwd)/data:/app/data \
    data-generation $@
