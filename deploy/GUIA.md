# Subir AutoMarket a un servidor

Con esta guía AutoMarket queda en internet con tu dominio, HTTPS, fotos y copias diarias, sin depender de tu PC. Todo corre en un solo servidor con Docker. Lo único que tienes que escribir es el dominio, tu correo y (si ya la tienes) la contraseña de aplicación de Gmail: el resto lo hace `instalar.sh`.

## Lo que necesitas

| Qué | Para qué | Dónde |
|---|---|---|
| Un servidor Linux (Ubuntu 24.04) con 2 GB de RAM o más (4 GB va mejor) | Donde vive la página | Hetzner, DigitalOcean, Contabo, Vultr… |
| Un dominio | La dirección de la página (ej.: `automarket.com`) | Cloudflare, Namecheap, GoDaddy… |
| Tu Gmail con una contraseña de aplicación | «Olvidé mi contraseña», avisos y pagos | Paso 3 de esta guía |
| Cloudflare Turnstile (gratis, se puede poner después) | Frena los registros de robots | dash.cloudflare.com → Turnstile |

## 1. Apunta el dominio al servidor

En el panel de tu dominio crea **dos registros tipo A** con la IP del servidor:

| Nombre | Tipo | Valor |
|---|---|---|
| `@` (el dominio solo) | A | IP del servidor |
| `media` | A | IP del servidor |

`media.tudominio.com` es donde quedan las fotos. Si usas Cloudflare, deja los dos registros en **«Solo DNS»** (nube gris) mientras instalas: así Caddy saca el certificado sin problemas.

## 2. Prepara los archivos en tu PC

Con AutoMarket abierto, doble clic en **`preparar-servidor.cmd`**. Crea la carpeta `para-el-servidor` con:

- `automarket.tar.gz`: el proyecto (sin claves ni carpetas pesadas).
- `respaldo.sql.gz`: una copia nueva de tu base (usuarios, autos, planes, ajustes, Términos).
- `fotos.tar.gz`: tus fotos, vídeos y documentos.

## 3. Saca la contraseña de aplicación de Gmail

1. Entra a **myaccount.google.com** con el Gmail que va a mandar los correos.
2. **Seguridad** → activa la **Verificación en 2 pasos** (si no la tienes).
3. Busca **«Contraseñas de aplicaciones»** (o abre myaccount.google.com/apppasswords).
4. Ponle de nombre «AutoMarket» y **Crear**. Copia las 16 letras que salen: las pide `instalar.sh`.

Gmail sirve para empezar; tiene un límite diario de envíos. Cuando haya mucho movimiento conviene pasar a Brevo o Amazon SES (solo cambia `SMTP_URL`).

## 4. Sube los archivos e instala

Desde la Terminal de Windows, dentro de la carpeta `para-el-servidor`:

```bash
scp automarket.tar.gz respaldo.sql.gz fotos.tar.gz root@IP_DEL_SERVIDOR:~
ssh root@IP_DEL_SERVIDOR
```

(También sirve WinSCP o FileZilla para subir los archivos.)

Ya en el servidor:

```bash
tar -xzf automarket.tar.gz
cd automarket-3d/deploy
./instalar.sh
```

`instalar.sh`:

1. Instala Docker si falta (te pregunta antes).
2. Te pide el **dominio**, el **correo del administrador** y tu **Gmail con la contraseña de aplicación**. Turnstile lo puedes dejar en blanco.
3. Inventa las demás claves y las guarda en `deploy/.env` (solo las puede leer tu usuario del servidor).
4. Avisa si el dominio todavía no apunta al servidor.
5. Arranca todo (la primera vez tarda de 5 a 15 minutos).
6. Si encuentra `respaldo.sql.gz` y `fotos.tar.gz`, te ofrece cargar tus datos de la PC (escribes `SI` para confirmar).
7. Crea los planes y ajustes que falten.

Al final te dice la dirección: `https://tudominio.com`.

## 5. Comprueba

1. Abre `https://tudominio.com`. El candado de HTTPS sale solo.
2. Prueba el correo:
   ```bash
   docker compose exec api node scripts/probar-correo.mjs tu@correo.com
   ```
3. Entra con tu cuenta, abre un anuncio y sube una foto.
4. Panel → Planes y ajustes → Cobro Binance: revisa el Pay ID.

## Lo que quedó para después

**Turnstile.** En Cloudflare → Turnstile → «Agregar sitio» con tu dominio. Copia las dos llaves en `deploy/.env`:

```bash
nano .env      # TURNSTILE_SITE_KEY=…  TURNSTILE_SECRET_KEY=…  TURNSTILE_DISABLED=false
docker compose up -d --build web api
```

**Correo (si lo dejaste en blanco).** `./instalar.sh --nuevo` te vuelve a preguntar todo y **conserva** las claves de la base y del almacén. Luego `docker compose up -d`.

**«Entrar con Google» (opcional).** En Google Cloud crea un «ID de cliente de OAuth» tipo web con `https://tudominio.com` en «Orígenes autorizados de JavaScript». Ponlo en `GOOGLE_CLIENT_ID=` de `.env` y `docker compose up -d --build web api`.

## Empezar sin datos (sin la copia de tu PC)

Crea tu cuenta en la página con el mismo correo de `ADMIN_ONE_EMAIL` y, en el servidor:

```bash
docker compose exec db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" automarket -e "UPDATE users SET role=\"ADMIN\" WHERE email=\"TU_CORREO\""'
docker compose exec api npx tsx prisma/bootstrap-admin-one.ts
```

## Copias de seguridad

El servicio `backup` guarda una copia de la base cada día en `deploy/respaldos` (las últimas 30). Bájalas a tu PC de vez en cuando:

```bash
scp root@IP_DEL_SERVIDOR:~/automarket-3d/deploy/respaldos/*.sql.gz .
```

Las fotos viven en el volumen `minio`. Si el proveedor ofrece copias del disco completo (snapshots), actívalas: cubren todo.

## Actualizar a una versión nueva

1. En tu PC, `preparar-servidor.cmd` otra vez y sube solo `automarket.tar.gz`.
2. En el servidor:
   ```bash
   tar -xzf automarket.tar.gz
   cd automarket-3d/deploy
   docker compose up -d --build
   ```

El `.env` y los datos no se tocan. Las migraciones nuevas se aplican solas al arrancar la API.

## Si algo falla

| Lo que ves | Qué hacer |
|---|---|
| `Falta … en deploy/.env` | Llena esa línea de `.env` (o `./instalar.sh --nuevo`) y vuelve a correr `docker compose up -d` |
| La página no abre o no hay candado | Revisa los dos registros A del paso 1 y que los puertos 80 y 443 estén abiertos en el firewall del proveedor; mira `docker compose logs caddy` |
| No se suben fotos | `media.tudominio.com` tiene que apuntar al servidor; mira `docker compose logs caddy minio` |
| No llegan correos | Corre la prueba del paso 5: el mensaje dice si es el usuario, la clave o el puerto. En Gmail hace falta la contraseña de aplicación, no tu clave normal |
| La API dice «Sin correo» o «Sin Turnstile» al arrancar | Es un recordatorio: falta poner eso (sección «Lo que quedó para después») |
| Cambiaste `TURNSTILE_SITE_KEY` o `GOOGLE_CLIENT_ID` y no se nota | Esas dos van dentro de la página: `docker compose up -d --build web api` |

Comandos útiles: `docker compose ps` (qué está encendido), `docker compose logs --tail 100 api` (últimos mensajes de la API), `docker compose restart api`, `docker compose down` (apagar; los datos se quedan).
