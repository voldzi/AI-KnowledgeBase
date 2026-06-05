#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${POSTGRES_MULTIPLE_DATABASES:-}" ]]; then
  exit 0
fi

create_database() {
  local database="$1"
  if [[ -z "$database" ]]; then
    return
  fi

  echo "Creating database '$database' if it does not exist"
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE "$database"'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$database')\gexec
    GRANT ALL PRIVILEGES ON DATABASE "$database" TO "$POSTGRES_USER";
EOSQL
}

IFS=',' read -ra databases <<< "$POSTGRES_MULTIPLE_DATABASES"
for database in "${databases[@]}"; do
  create_database "$(echo "$database" | xargs)"
done
