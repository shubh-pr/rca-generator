#!/bin/sh
# Runs backup.sh on BACKUP_SCHEDULE (cron syntax, default 02:30 every day, container time zone UTC).
set -eu
echo "${BACKUP_SCHEDULE:-30 2 * * *} /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "backup: schedule '${BACKUP_SCHEDULE:-30 2 * * *}', keeping ${BACKUP_RETENTION_DAYS:-14} days"
exec crond -f -l 8
