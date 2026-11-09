# AutoMarket 3D

Mercado de autos donde publican personas y concesionarios. Cada vendedor muestra su cédula y una selfie antes de publicar. El comprador reserva el auto con un abono que le paga directo al vendedor, y la plataforma cobra planes, comisiones y destacados con Binance.

El nombre viene de la primera versión, que traía una vista 3D de los autos. Esa parte se quitó; el nombre se quedó.

Código privado. Ver [LICENSE](LICENSE).

## Qué hace

- Publicar es gratis, con un cupo de anuncios según el plan.
- Verificación de identidad con cédula y selfie (y RIF para concesionarios), revisada a mano desde el panel.
- Chat en tiempo real que tapa teléfonos, correos e insultos hasta que el vendedor confirma la reserva. Las notas de voz se abren después de la reserva.
- Reservas con abono directo al vendedor. Al marcar la venta, el vendedor paga la comisión de su plan.
- «Destacar» un anuncio (Impulso 3 días, Semana 7 días, Portada 7 días), pagado con Binance. El anuncio sube **solo cuando el administrador confirma el pago**.
- Buscador que entiende frases («jeepeta automática hasta 15 mil en Valencia»), comparador, autos guardados con aviso de bajada de precio y directorio de concesionarios.
- Tres Copilotos (comprador, concesionario y administrador). Responden con reglas sobre los datos reales de la base. No usan inteligencia artificial y no inventan cifras.
- Panel de administración: pagos, verificaciones, denuncias, estadísticas, planes, precios, Términos y fotos del sitio.

Planes que crea `npm run db:seed` (los precios se cambian en el panel):

| Plan | Para | Anuncios a la vez | Comisión por venta |
|---|---|---|---|
| Gratis | todos | 1 | 5 % |
| Premium | personas | 5 | 2,5 % |
| Concesionario Básico | agencias | 20 | 2 % |
| Concesionario Pro | agencias | sin límite | 0 % |

Los créditos (calculadora de cuota) solo salen en autos de concesionarios. El RIF y los datos fiscales de una agencia solo se ven si tiene un plan de concesionario vigente.

## Piezas

| Carpeta | Qué es | Puerto |
|---|---|---|
| `apps/web` | La página: Next.js 16, React 19, Tailwind 4 | 3000 |
| `apps/api` | La API: Express 5, Socket.io, Prisma 7 sobre MySQL/MariaDB | 4000 |
| `packages/contracts` | Tipos y reglas que comparten la web y la API (precios, buscador, textos legales) | |
| `apps/api/scripts/dev-s3.mjs` | Almacén de fotos local, imita S3 (guarda en `apps/api/.dev-s3/`) | 9000 |
| `deploy/` | Todo lo del servidor: Docker, Caddy con HTTPS, `instalar.sh` y la guía | |
| `scripts/` | Lanzador, copias de la base, zip del proyecto y parches | |

La base de datos es la MySQL (MariaDB) de XAMPP. En la red de casa la web pasa todo por el puerto 3000 (`/api`, `/socket.io`, `/s3`), así el teléfono solo necesita `http://IP-de-la-PC:3000`.

## Requisitos

- Windows con [XAMPP](https://www.apachefriends.org/) (solo hace falta MySQL).
- [Node.js](https://nodejs.org/) 22.12 o más nuevo.
- GitHub Desktop o git, para bajar y subir cambios.

## Primera vez en una PC

1. Baja el repositorio con GitHub Desktop (*File → Clone repository*) o descomprime una copia.
2. En la carpeta del proyecto abre una consola y corre:
   ```
   npm install
   ```
3. Crea los archivos de claves a partir de los ejemplos. **Nunca se suben a GitHub.**
   - `apps/api/.env.example` → `apps/api/.env`. Revisa sobre todo `DATABASE_URL`, `JWT_ACCESS_SECRET` (una frase larga al azar), `WEB_URL` y `ADMIN_ONE_EMAIL`. Para el correo, `SMTP_URL`; para cobrar, `BINANCE_PAY_ID` y `BINANCE_PAY_NAME`.
   - `apps/web/.env.example` → `apps/web/.env.local`.
4. Enciende MySQL en XAMPP y crea la base vacía en phpMyAdmin, con el nombre que pusiste en `DATABASE_URL` y cotejamiento `utf8mb4_unicode_ci`.
5. Prepara la base:
   ```
   npm run db:generate -w @automarket/api
   npm run db:deploy -w @automarket/api
   npm run db:seed -w @automarket/api
   ```
6. Doble clic en `AutoMarket.exe`.
7. Primer administrador: crea tu cuenta en la página. En phpMyAdmin, tabla `users`, cámbiale `role` a `ADMIN`. Pon ese correo en `ADMIN_ONE_EMAIL` de `apps/api/.env` y corre:
   ```
   npm run db:bootstrap-admin-one -w @automarket/api
   ```
   Esa cuenta queda como administrador principal, el único que puede cambiar el Pay ID de Binance.
8. En el panel: *Planes y ajustes → Cobro Binance* (tu Pay ID), marcas y precios de Destacar.

¿Traes una copia hecha con `comprimir-proyecto.cmd`? Adentro viene `COMO-RESTAURAR.txt`. La base se importa en phpMyAdmin con el `.sql` de `base-de-datos/`, y no hace falta el paso 5.

## Uso diario

Doble clic en **`AutoMarket.exe`**. Enciende MySQL de XAMPP si está apagado, aplica las migraciones nuevas, arranca la API, la página y el almacén de fotos, y abre `http://localhost:3000`. La primera vez después de un cambio en la página tarda de 1 a 3 minutos en compilar. Además hace una copia de la base una vez al día.

Para apagar todo, cierra su ventana. Si después la página vieja sigue respondiendo, corre `detener-automarket.cmd`.

Desde el teléfono, en la misma red Wi-Fi, entra a `http://IP-de-la-PC:3000` (la IP sale con `ipconfig`). La red de Windows tiene que estar como «Privada» y Node.js permitido en el firewall. Por `http` el navegador del teléfono no deja grabar notas de voz ni entrar con Google; con el dominio y `https` sí.

## Herramientas de la carpeta

| Archivo | Para qué |
|---|---|
| `AutoMarket.exe` | Arranca todo en modo rápido (la página compilada). Su código está en `scripts/launcher/` (Go). |
| `iniciar.cmd` | Arranca en modo desarrollo: recarga al editar el código, pero cada página tarda en abrir. |
| `detener-automarket.cmd` | Cierra lo que quede usando los puertos 3000, 4000 y 9000. |
| `crear-datos-prueba.cmd` | Crea 18 cuentas y 51 autos de prueba en 12 países (correos `@automarket.test`). |
| `borrar-datos-prueba.cmd` | Borra esas cuentas de prueba y todo lo suyo. Las cuentas reales no se tocan. |
| `respaldar-base.cmd` | Copia de la base en `respaldos/` (guarda las últimas 30). |
| `comprimir-proyecto.cmd` | Zip del proyecto con la base en `.sql` adentro, en `copias-del-proyecto/`. |
| `preparar-servidor.cmd` | Arma `para-el-servidor/` con el código, la base y las fotos para subir al servidor. |
| `probar-correo.cmd` | Manda un correo de prueba con el `SMTP_URL` de `apps/api/.env`. |
| `enlace-publico.cmd` | Enlace público temporal con Cloudflare (`https://….trycloudflare.com`) mientras la ventana esté abierta. |
| `aplicar-parches.cmd` | Cambia textos exactos en páginas de carpetas muy profundas, según `scripts/parches.json`. |

Ninguna de estas herramientas sube datos a internet, salvo `enlace-publico.cmd`, que publica la página mientras está abierto.

## Comandos útiles

```
npm run dev                                   # lo mismo que AutoMarket.exe, en la consola
npm run typecheck                             # revisa los tipos de todo el proyecto
npm run db:deploy -w @automarket/api          # aplica migraciones pendientes
npm run db:studio -w @automarket/api          # ver y editar la base en el navegador
npm run mail:probar -w @automarket/api -- tu@correo.com
```

## Pruebas

`apps/api/test/e2e.mjs` recorre la app de punta a punta contra una base real: registro, verificación, publicar, buscar, chat, reservas, pagos, planes, Destacar, Copilotos, panel y permisos. Hoy son 531 comprobaciones.

Con la MySQL de XAMPP encendida (crea una base temporal `automarket_e2e` y la borra al terminar):

```
set E2E_DATABASE_URL=mysql://root@127.0.0.1:3306
npm run test:e2e
```

## Subir a un servidor

La guía completa está en [deploy/GUIA.md](deploy/GUIA.md). En corto: compra un dominio y un servidor Linux, corre `preparar-servidor.cmd` en la PC, sube la carpeta `para-el-servidor/` y en el servidor corre `./instalar.sh`. Te pide el dominio, el correo del administrador y tu Gmail con contraseña de aplicación; el HTTPS lo pone solo.

## GitHub

- Repositorio privado: `diego15-ux/automarket-3d`.
- `main` es la versión estable. Los cambios se hacen en la rama `automarket-prueba` y pasan a `main` con un Pull Request.
- El [.gitignore](.gitignore) deja fuera las claves (`.env`), la base y sus copias, las fotos subidas, `node_modules` y las compilaciones. Antes de cada commit revisa que no aparezca ningún `.env`.

## Más detalle

- [ARQUITECTURA.md](ARQUITECTURA.md): diseño técnico de la base, la API, la seguridad y los pagos.
- [deploy/GUIA.md](deploy/GUIA.md): el servidor paso a paso.
