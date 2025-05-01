#!/bin/bash

docker build . -t boottime
docker kill boottime || true
docker run --rm --name boottime boottime
