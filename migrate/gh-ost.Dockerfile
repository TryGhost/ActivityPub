FROM ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517

RUN apt update && \
    apt install -y curl percona-toolkit
RUN curl -fsSL https://github.com/github/gh-ost/releases/download/v1.1.7/gh-ost-binary-linux-arm64-20241219160321.tar.gz -o gh-ost.tar.gz && \
    tar -xzf gh-ost.tar.gz && \
    rm gh-ost.tar.gz && \
    mv gh-ost /usr/local/bin/gh-ost

CMD ["bin/bash"]
