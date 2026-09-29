FROM postgres:16-alpine
RUN apk add --no-cache aws-cli tini
COPY ops/backup/backup.sh ops/backup/restore.sh ops/backup/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
