#!/bin/sh
# Restore a backup into the database (DESTROYS current data). Usage inside the backup container:
#   restore.sh /backups/rca-20261001T023000Z.dump
# Stop the api service first: docker compose -f docker-compose.prod.yml stop api
set -eu
FILE="${1:?usage: restore.sh <file.dump>}"
[ -f "${FILE}" ] || { echo "no such file: ${FILE}"; exit 1; }
export PGPASSWORD="${POSTGRES_PASSWORD}"
echo "restore: restoring ${FILE} into ${POSTGRES_DB} on ${PGHOST:-db}"
pg_restore -h "${PGHOST:-db}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --clean --if-exists --no-owner --single-transaction "${FILE}"
echo "restore: done. Start the api again: docker compose -f docker-compose.prod.yml start api"
