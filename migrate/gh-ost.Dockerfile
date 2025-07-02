FROM ubuntu:24.04@sha256:89ef6e43e57cb94a23e4b28715a34444de91f45bd410fce3ce00819f86940a9c

RUN apt update && \
    apt install -y curl percona-toolkit
RUN curl -fsSL https://github.com/github/gh-ost/releases/download/v1.1.7/gh-ost-binary-linux-arm64-20241219160321.tar.gz -o gh-ost.tar.gz && \
    tar -xzf gh-ost.tar.gz && \
    rm gh-ost.tar.gz && \
    mv gh-ost /usr/local/bin/gh-ost

CMD ["bin/bash"]
