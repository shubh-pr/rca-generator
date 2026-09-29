#!/bin/sh
# Daily PostgreSQL backup: pg_dump custom format into /backups, keep BACKUP_RETENTION_DAYS days,
# and optionally copy to an S3-compatible bucket (BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, AWS_* keys).
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="/backups/rca-${STAMP}.dump"
export PGPASSWORD="${POSTGRES_PASSWORD}"
pg_dump -h "${PGHOST:-db}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc -Z 6 -f "${FILE}.partial"
mv "${FILE}.partial" "${FILE}"
# Verify the archive is readable before counting it as a backup.
pg_restore --list "${FILE}" > /dev/null
echo "backup: wrote ${FILE} ($(du -h "${FILE}" | cut -f1))"
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  ENDPOINT_ARG=""
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT_ARG="--endpoint-url ${BACKUP_S3_ENDPOINT}"
  # shellcheck disable=SC2086
  aws s3 cp ${ENDPOINT_ARG} "${FILE}" "s3://${BACKUP_S3_BUCKET}/postgres/$(basename "${FILE}")"
  echo "backup: copied to s3://${BACKUP_S3_BUCKET}/postgres/"
fi
find /backups -name 'rca-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
