FROM mysql:8.3

RUN curl -Lo /bin/cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.10.1/cloud-sql-proxy.linux.amd64
RUN chmod +x /bin/cloud-sql-proxy

COPY cleanup-expired-key-value-records /bin

ENTRYPOINT ["cleanup-expired-key-value-records"]
