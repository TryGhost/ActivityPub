FROM ubuntu:26.04@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db

RUN apt update && \
    apt install -y curl percona-toolkit
RUN curl -fsSL https://github.com/github/gh-ost/releases/download/v1.1.7/gh-ost-binary-linux-arm64-20241219160321.tar.gz -o gh-ost.tar.gz && \
    tar -xzf gh-ost.tar.gz && \
    rm gh-ost.tar.gz && \
    mv gh-ost /usr/local/bin/gh-ost

CMD ["bin/bash"]
