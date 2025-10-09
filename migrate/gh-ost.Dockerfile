FROM ubuntu:24.04@sha256:59a458b76b4e8896031cd559576eac7d6cb53a69b38ba819fb26518536368d86

RUN apt update && \
    apt install -y curl percona-toolkit
RUN curl -fsSL https://github.com/github/gh-ost/releases/download/v1.1.7/gh-ost-binary-linux-arm64-20241219160321.tar.gz -o gh-ost.tar.gz && \
    tar -xzf gh-ost.tar.gz && \
    rm gh-ost.tar.gz && \
    mv gh-ost /usr/local/bin/gh-ost

CMD ["bin/bash"]
