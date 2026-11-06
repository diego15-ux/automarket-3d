#!/usr/bin/env bash
# AutoMarket 3D · instalación en el servidor con solo poner el dominio.
#
#   cd automarket-3d/deploy && ./instalar.sh
#
# Pide el dominio, el correo del administrador y (si ya lo tienes) tu Gmail con su contraseña
# de aplicación. Las demás claves las genera solo. Arranca todo, crea los planes y, si encuentra
# respaldo.sql.gz y fotos.tar.gz (los arma preparar-servidor.cmd en tu PC), ofrece cargarlos.
# Repetirlo no borra nada: si ya hay deploy/.env, lo usa tal cual (./instalar.sh --nuevo lo rehace).
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() { local prompt=$1 var; read -r -p "$prompt" var; printf '%s' "$var"; }
urlencode() { local s=$1 out='' c i; for ((i = 0; i < ${#s}; i++)); do c=${s:i:1}; case "$c" in [a-zA-Z0-9.~_-]) out+=$c ;; *) out+=$(printf '%%%02X' "'$c") ;; esac; done; printf '%s' "$out"; }
secret() { openssl rand -hex "$1"; }

# ── Docker ──────────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  say "Docker no está instalado en este servidor."
  [ "$(ask '¿Lo instalo ahora? (S/N): ')" = "S" ] || { echo "Sin Docker no se puede seguir."; exit 1; }
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "Falta «docker compose». Actualiza Docker."; exit 1; }
command -v openssl >/dev/null || { echo "Falta openssl: sudo apt install -y openssl"; exit 1; }

# ── Configuración (deploy/.env) ──────────────────────────────────────────────────
if [ -f .env ] && [ "${1:-}" != "--nuevo" ]; then
  say "Ya hay una configuración (deploy/.env). La uso tal cual."
else
  say "1/3  Tu dominio"
  echo "Sin https:// ni www. Ejemplo: automarket.com"
  while :; do
    DOMINIO=$(ask 'Dominio: ' | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^www\.##; s#/.*$##')
    [[ "$DOMINIO" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] && break
    echo "Ese dominio no se ve bien. Prueba otra vez."
  done

  say "2/3  Correo del administrador principal"
  echo "La cuenta con este correo queda como administrador principal (si ya existe en tus datos)."
  ADMIN=$(ask 'Correo: ')

  say "3/3  Correo de salida con Gmail"
  echo "Hace falta una «contraseña de aplicación» de Google (16 letras): myaccount.google.com → Seguridad"
  echo "→ Verificación en 2 pasos (activada) → Contraseñas de aplicaciones. Enter para dejarlo para después."
  GMAIL=$(ask 'Tu Gmail: ')
  SMTP_URL=''
  MAIL_FROM='AutoMarket <no-reply@'"$DOMINIO"'>'
  MAIL_DISABLED=true
  if [ -n "$GMAIL" ]; then
    read -r -s -p 'Contraseña de aplicación (no se ve al escribir): ' APP_PASS
    echo
    APP_PASS=${APP_PASS// /}
    SMTP_URL="smtps://$(urlencode "$GMAIL"):$(urlencode "$APP_PASS")@smtp.gmail.com:465"
    MAIL_FROM="AutoMarket <$GMAIL>"
    MAIL_DISABLED=false
  fi

  echo
  echo "Turnstile (anti-robots de Cloudflare). Si aún no tienes las llaves, Enter y lo pones después."
  TS_SITE=$(ask 'Llave pública (site key): ')
  TS_SECRET=''
  TURNSTILE_DISABLED=true
  if [ -n "$TS_SITE" ]; then
    read -r -s -p 'Llave secreta (secret key, no se ve al escribir): ' TS_SECRET
    echo
    [ -n "$TS_SECRET" ] && TURNSTILE_DISABLED=false || TS_SITE=''
  fi

  # Con --nuevo se conservan las claves que ya usan la base y el almacén (si cambian, dejan de abrir).
  old() { [ -f .env ] && grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
  DB_PASS=$(old MYSQL_PASSWORD); DB_ROOT=$(old MYSQL_ROOT_PASSWORD); S3_PASS=$(old MINIO_ROOT_PASSWORD); JWT=$(old JWT_ACCESS_SECRET)
  umask 077
  cat > .env <<EOF
# Generado por instalar.sh el $(date '+%F %H:%M'). No lo compartas: tiene todas las claves.
DOMINIO=$DOMINIO
ADMIN_ONE_EMAIL=$ADMIN

MYSQL_PASSWORD=${DB_PASS:-$(secret 24)}
MYSQL_ROOT_PASSWORD=${DB_ROOT:-$(secret 24)}
MINIO_ROOT_USER=automarket
MINIO_ROOT_PASSWORD=${S3_PASS:-$(secret 24)}
JWT_ACCESS_SECRET=${JWT:-$(secret 32)}

SMTP_URL=$SMTP_URL
MAIL_FROM="$MAIL_FROM"
MAIL_DISABLED=$MAIL_DISABLED

TURNSTILE_SITE_KEY=$TS_SITE
TURNSTILE_SECRET_KEY=$TS_SECRET
TURNSTILE_DISABLED=$TURNSTILE_DISABLED

GOOGLE_CLIENT_ID=
BINANCE_PAY_ID=
EOF
  say "Configuración guardada en deploy/.env (solo la puede leer este usuario)."
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

# ── El dominio apunta aquí? ──────────────────────────────────────────────────────
mine=$(hostname -I 2>/dev/null || true)
for host in "$DOMINIO" "media.$DOMINIO"; do
  ip=$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR==1{print $1}' || true)
  if [ -z "$ip" ]; then
    echo "Ojo: $host todavía no tiene registro DNS. Crea un registro A con la IP de este servidor."
  elif ! grep -qw "$ip" <<<"$mine"; then
    echo "Ojo: $host apunta a $ip. Si no es la IP de este servidor, el HTTPS no va a salir."
  fi
done

# ── Arranque ────────────────────────────────────────────────────────────────────
say "Construyendo y arrancando AutoMarket (la primera vez tarda de 5 a 15 minutos)…"
docker compose up -d --build

say "Esperando a la API…"
for _ in $(seq 1 90); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/public/stats').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 5
done
[ "${ok:-}" = 1 ] || { echo "La API no respondió. Mira: docker compose logs --tail 80 api"; exit 1; }

# ── Datos de tu PC ──────────────────────────────────────────────────────────────
DUMP=''
FOTOS=''
for dir in "$HOME" ../..; do
  [ -z "$DUMP" ] && [ -f "$dir/respaldo.sql.gz" ] && DUMP="$dir/respaldo.sql.gz"
  [ -z "$FOTOS" ] && [ -f "$dir/fotos.tar.gz" ] && FOTOS="$dir/fotos.tar.gz"
done
if [ -n "$DUMP" ] && [ ! -f .datos-cargados ]; then
  say "Encontré tus datos de la PC: $DUMP ${FOTOS:+y $FOTOS}"
  if [ "$(ask '¿Los cargo ahora? Reemplaza la base de este servidor (S/N): ')" = "S" ]; then
    ./llevar-datos.sh "$DUMP" ${FOTOS:+"$FOTOS"}
    touch .datos-cargados
  fi
fi

# Planes, ajustes y palabras bloqueadas: solo crea lo que falta.
docker compose exec -T api npx prisma db seed >/dev/null && echo "Planes y ajustes listos."

say "Listo: https://$DOMINIO"
[ "${MAIL_DISABLED:-false}" = true ] && echo "Pendiente: correo. Pon SMTP_URL en deploy/.env (o ./instalar.sh --nuevo) y luego: docker compose up -d"
[ "${TURNSTILE_DISABLED:-false}" = true ] && echo "Pendiente: Turnstile. Pon las dos llaves en deploy/.env, TURNSTILE_DISABLED=false, y luego: docker compose up -d --build web api"
if [ ! -f .datos-cargados ]; then
  echo "Empezaste sin datos: crea tu cuenta en la página con $ADMIN_ONE_EMAIL y sigue «Empezar sin datos» en GUIA.md."
fi
