FROM ubuntu:24.04@sha256:186072bba1b2f436cbb91ef2567abca677337cfc786c86e107d25b7072feef0c

RUN apt update && \
    apt install -y curl percona-toolkit
RUN curl -fsSL https://github.com/github/gh-ost/releases/download/v1.1.7/gh-ost-binary-linux-arm64-20241219160321.tar.gz -o gh-ost.tar.gz && \
    tar -xzf gh-ost.tar.gz && \
    rm gh-ost.tar.gz && \
    mv gh-ost /usr/local/bin/gh-ost

CMD ["bin/bash"]
