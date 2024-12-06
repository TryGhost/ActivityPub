#!/usr/bin/env bash

docker build -t generate-fake-data-js-csv .

docker run --rm --tty --name generate-fake-data-js-csv \
    -v $(pwd)/data:/app/data \
    generate-fake-data-js-csv $@
