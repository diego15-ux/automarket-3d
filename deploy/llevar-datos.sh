#!/usr/bin/env bash
# AutoMarket 3D · lleva a este servidor la base y las fotos de tu PC.
#
#   ./llevar-datos.sh respaldo.sql.gz                 solo la base
#   ./llevar-datos.sh respaldo.sql.gz fotos.tar.gz    la base y las fotos
#
# Los dos archivos los arma preparar-servidor.cmd en tu PC (carpeta para-el-servidor).
# También sirve un fotos.zip con la carpeta apps\api\.dev-s3 comprimida.
# OJO: reemplaza la base del servidor. Úsalo una vez, al empezar.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Falta deploy/.env (copia env.ejemplo y llénalo)."; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a

DUMP=${1:-}
FOTOS=${2:-}
[ -f "$DUMP" ] || { echo "Uso: ./llevar-datos.sh respaldo.sql.gz [fotos.tar.gz]"; exit 1; }
if [ -n "$FOTOS" ]; then
  [ -f "$FOTOS" ] || { echo "No encuentro $FOTOS"; exit 1; }
  case "$FOTOS" in
    *.zip) command -v unzip >/dev/null || { echo "Falta unzip: sudo apt install -y unzip"; exit 1; } ;;
  esac
fi

echo "Esto REEMPLAZA la base del servidor con $DUMP."
read -r -p "Escribe SI para seguir: " ok
[ "$ok" = "SI" ] || { echo "No se hizo nada."; exit 1; }

docker compose up -d db minio
docker compose run --rm minio-init
docker compose stop api web >/dev/null 2>&1 || true
until docker compose exec -T db healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; do
  echo "esperando a la base…"
  sleep 2
done

sql() { docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" automarket'; }

echo "Cargando la base…"
# Algunas versiones de mariadb-dump empiezan con una línea de «sandbox mode» que no hace falta.
gunzip -c "$DUMP" | sed '/enable the sandbox mode/d' | sql

# Las URLs de las fotos de tu PC apuntaban a tu PC: pasan al almacén del servidor.
NEW="https://media.${DOMINIO}/automarket-media"
sql <<SQL
UPDATE vehicle_media SET url = CONCAT('${NEW}/', storageKey);
UPDATE users SET avatarUrl = CONCAT('${NEW}/', avatarKey) WHERE avatarKey IS NOT NULL;
UPDATE platform_settings SET homeHeroUrl = CONCAT('${NEW}/', homeHeroKey) WHERE homeHeroKey IS NOT NULL;
UPDATE platform_settings SET loginBackgroundUrl = CONCAT('${NEW}/', loginBackgroundKey) WHERE loginBackgroundKey IS NOT NULL;
UPDATE platform_settings SET binanceQrUrl = CONCAT('${NEW}/', binanceQrKey) WHERE binanceQrKey IS NOT NULL;
UPDATE kyc_documents SET s3Bucket = 'automarket-kyc';
SQL
echo "Base lista."

if [ -n "$FOTOS" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  case "$FOTOS" in
    *.zip) unzip -q "$FOTOS" -d "$tmp" ;;
    *) tar -xzf "$FOTOS" -C "$tmp" ;;
  esac
  src="$tmp"
  [ -d "$tmp/.dev-s3" ] && src="$tmp/.dev-s3"
  for dir in "$src"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    case "$name" in
      *kyc*) dest=automarket-kyc ;;
      *) dest=automarket-media ;;
    esac
    echo "Subiendo $name → $dest…"
    docker run --rm --network automarket_default -v "$dir":/src:ro \
      -e U="$MINIO_ROOT_USER" -e P="$MINIO_ROOT_PASSWORD" -e DEST="$dest" \
      minio/mc:latest sh -c 'mc alias set local http://minio:9000 "$U" "$P" >/dev/null && mc mirror --overwrite --exclude "*.__meta.json" /src "local/$DEST"'
  done
  echo "Fotos listas."
fi

docker compose up -d
echo "Listo: abre https://${DOMINIO}"
