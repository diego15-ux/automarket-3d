#!/bin/sh
# AutoMarket 3D · prepara el almacén de fotos (lo corre docker compose; repetirlo no cambia nada).
set -e
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  echo "esperando al almacén de fotos…"
  sleep 2
done
mc mb --ignore-existing local/automarket-media local/automarket-kyc
# Públicas: fotos y vídeos de anuncios, fotos de perfil, portada, fondo del login y QR de cobro.
# Privadas (enlaces firmados de pocos minutos): fotos y audios del chat, y todo el bucket de documentos.
for carpeta in vehiculos avatars home-hero login-bg binance-qr; do
  mc anonymous set download "local/automarket-media/$carpeta" >/dev/null
done
echo "almacén listo"
