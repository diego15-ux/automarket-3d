# AutoMarket 3D — Arquitectura técnica

Marketplace automotriz para **personas naturales y concesionarios** (toda cuenta compra, reserva y
publica), con verificación estricta de identidad, publicación gratuita con cupo limitado,
**reservas P2P** (el abono va directamente al vendedor) confirmadas por el vendedor, planes y
comisión post-venta cobrados con **Binance**, chat con emojis y notas de voz, base de datos
persistente en **MySQL / MariaDB (XAMPP)**, búsqueda priorizada por ubicación, panel de
administración y showroom 3D.

Flujo por fases: **1)** landing pública → **2)** acceso (login de cristal con fondo dinámico desde
el panel) → **3)** aplicación privada (catálogo, reservas, chat, verificación).

---

## 1. Visión general

```mermaid
flowchart LR
  subgraph Cliente
    WEB["Next.js 16 · React 19<br/>Tailwind 4 · tema día/noche"]
    R3F["Visor 3D<br/>R3F 9 + drei 10"]
  end

  CDN[("CDN / S3 público<br/>fotos · vídeos · GLB")]
  API["API Express 5<br/>REST /api/*"]
  WS["Socket.io 4<br/>chat · avisos · /public"]
  DB[("MySQL 8 / MariaDB 10.4 (XAMPP)<br/>Prisma 7 + adapter mariadb")]
  REDIS[("Redis<br/>rate limit · adapter Socket.io")]
  S3[("S3 privado<br/>chat · KYC")]
  BN["Binance<br/>Pay ID (manual) · Binance Pay Merchant API"]
  ADM["Equipo (ADMIN)<br/>verifica pagos al Pay ID"]
  CF["Cloudflare Turnstile<br/>siteverify"]
  SMTP["SMTP<br/>correo transaccional"]
  JOBS["Jobs (GET_LOCK)<br/>caducidades · avisos · destacados · outbox"]

  WEB -- "HTTPS + cookies httpOnly" --> API
  WEB -- "WebSocket" --> WS
  WEB -- "PUT prefirmado" --> S3
  WEB -- "QR · enlace de pago · Pay ID" --> BN
  R3F --> CDN
  API --> DB
  API --> REDIS
  API -- "órdenes · consulta · cierre · reembolso (HMAC-SHA512)" --> BN
  BN -- "webhooks firmados (RSA)" --> API
  ADM -- "aprobar / rechazar · reembolso enviado" --> API
  API -- "token anti-bot" --> CF
  JOBS --> DB
  JOBS --> SMTP
  JOBS --> BN
  WS <--> REDIS
```

| Decisión | Motivo |
|---|---|
| **MySQL 8.0.16+ o MariaDB 10.4+ (XAMPP)** con Prisma 7 y `@prisma/adapter-mariadb` | El driver `mariadb` habla con ambos (incluido caching_sha2_password de MySQL 8). Fechas en UTC (`SET time_zone = '+00:00'` al abrir cada conexión). El SQL evita lo que MariaDB 10.4 no tiene (`SKIP LOCKED`, índices parciales) y la suite e2e pasa en los dos motores. |
| Contratos compartidos en **`packages/contracts`** | Los mismos esquemas Zod validan el formulario en la web y la petición en la API; los DTO y eventos de Socket.io son tipos únicos. |
| Integridad en la **base de datos** | CHECKs (18) y claves UNIQUE mantenidas por la app (`openKey`, `cartKey`, `lockedReservationId`) sustituyen a los índices parciales que MySQL no tiene. |
| Dinero con **`Prisma.Decimal`** | Abonos, comisiones y reembolsos se calculan con decimales exactos y redondeo comercial; nunca `float`. |
| **Reservas P2P** | El abono de reserva lo fija el vendedor y el comprador se lo paga **directamente** (la plataforma no custodia dinero de terceros). AutoMarket cobra con Binance solo las **membresías** y la **comisión post-venta**. |
| **Binance** en dos modos: Pay ID (manual) y Binance Pay (comercio) | Manual: el usuario envía USDT al Pay ID de la empresa con una referencia y el equipo lo verifica; comercio: QR/checkout con confirmación por webhook. Membresía = cobro único por mes/año, sin suscripciones. |
| **Verificación estricta** | Nadie publica ni reserva sin identidad verificada (cédula + selfie + teléfono; documento del RIF en concesionarios) ni con comisiones vencidas. |
| **Plan gratuito estricto** | Registrarse y publicar es gratis, con **1 anuncio en cupo** (borrador, publicado o reservado). Con el cupo lleno no se puede crear otro hasta mejorar el plan con Binance (o retirar/pausar uno). |
| Correo con **bandeja de salida** (`email_outbox`) | El correo se encola en la misma transacción que el cambio de negocio y se envía con reintentos (`FOR UPDATE` + reserva de 5 min por fila; MariaDB 10.4 no tiene `SKIP LOCKED`). |
| Jobs con **`GET_LOCK`** | Con varias instancias, solo una ejecuta las tareas periódicas a la vez. |

### Versiones verificadas (octubre 2026)

| Capa | Paquetes | Versión |
|---|---|---|
| Web | `next` · `react` · `tailwindcss` · `@tanstack/react-query` · `recharts` | 16.4 · 19.3 · 4.3 · 5.105 · 3.10 |
| 3D | `three` · `@react-three/fiber` · `@react-three/drei` | 0.186 · 9.8 · 10.7 |
| API | `express` · `socket.io` · `zod` · `jose` · `@node-rs/argon2` · `nodemailer` · `exceljs` · `pdfkit` · `redis` | 5.3 · 4.8 · 4.6 · 6.2 · 2.2 · 10.3 · 4.4 · 0.20 · 6.3 |
| Datos | `prisma` / `@prisma/client` / `@prisma/adapter-mariadb` · `mariadb` · MySQL · MariaDB (XAMPP) | 7.10 · 3.5 · 8.4 LTS · 10.4.32 |
| TypeScript | API: 7 (compilador nativo) · web y contracts: 6 | 7.0 · 6.0 |

---

## 2. Monorepo (npm workspaces)

```
automarket-3d/
├─ package.json                 # workspaces: packages/*, apps/* (license: UNLICENSED)
├─ LICENSE                      # licencia propietaria: todos los derechos reservados
├─ database/automarket3d.sql    # esquema completo para importar en XAMPP (phpMyAdmin o mysql.exe)
├─ docker-compose.yml           # MySQL 8.4 · Redis 7 · Mailpit (SMTP de desarrollo)
├─ packages/
│  └─ contracts/                # @automarket/contracts (compilado a dist/)
│     └─ src/ enums · geo (países, ciudad normalizada) · labels · auth · vehicles
│             commerce (planes, pagos, reservas) · chat (eventos Socket.io) · admin
├─ apps/
│  ├─ api/
│  │  ├─ prisma/ schema.prisma · migrations/ · sql/constraints.sql · seed.ts
│  │  ├─ scripts/ dev-db.mjs (MySQL sin Docker) · dev-s3.mjs (S3 local)
│  │  ├─ test/ e2e.mjs (220 comprobaciones) · fakes.mjs (Binance Pay, Turnstile, S3, SMTP)
│  │  └─ src/
│  │     ├─ config/env.ts                 # validación fail-fast (obligatorios en producción)
│  │     ├─ jobs/scheduler.ts             # tareas periódicas bajo GET_LOCK
│  │     ├─ modules/
│  │     │  ├─ auth/                      # registro, login, OAuth, refresh, recuperación, perfil
│  │     │  ├─ vehicles/                  # publicación, galería, búsqueda, similares, jobs
│  │     │  ├─ reservations/              # reserva P2P, confirmación, bloqueo, comisión post-venta, jobs
│  │     │  ├─ memberships/               # planes, checkout con Binance, activación, avisos, jobs
│  │     │  ├─ payments/                  # Binance: checkout, comprobante, verificación, reembolsos, webhook, jobs
│  │     │  ├─ showcase/                  # landing: stats, carrusel, reseñas, contacto, avisos
│  │     │  ├─ admin/                     # métricas, usuarios, planes, inventario, exportaciones
│  │     │  ├─ chat/ · kyc/ · media/
│  │     └─ shared/
│  │        ├─ infra/  prisma · mysql-config · binance-pay · redis · storage · audit
│  │        ├─ http/middlewares/  auth · human-check (Turnstile+honeypot) · rate-limit (Redis)
│  │        ├─ mail/  mailer (outbox) · templates
│  │        ├─ moderation/blocklist.ts    # lista negra global
│  │        ├─ notifications.ts · realtime.ts · membership.ts
│  │        ├─ trust.ts                   # identidad verificada y comisiones al día
│  │        ├─ contact-card.ts            # datos verificados (reserva confirmada / chat directo)
│  │        ├─ legal/default-terms.ts     # Términos iniciales (luego, los del panel)
│  │        └─ utils/  money (Decimal, uuidv7) · mime (incluye firma real de imágenes)
│  └─ web/
│     └─ src/
│        ├─ app/  page.tsx (landing) · terminos · (auth)/ login · registro · recuperar · restablecer
│        │        (platform)/ vehiculos · cuenta/{anuncios,plan,reservas,perfil,verificacion}
│        │                    mensajes · pagos/[id] · admin/* (pagos, comisiones, sitio…)
│        ├─ features/ landing · auth · vehicles · reservations · memberships · payments · admin
│        │            notifications · chat · kyc · showroom-3d
│        ├─ shared/ ui (theme-toggle, turnstile, media-image…) · lib (http, session, format)
│        └─ proxy.ts                       # rutas privadas → /login?next=
```

---

## 3. Base de datos (MySQL / MariaDB de XAMPP)

- **Conexión** (`apps/api/.env`): `DATABASE_URL=mysql://root@127.0.0.1:3306/automarket3d`, el
  usuario `root` sin contraseña que trae XAMPP. `shared/infra/mysql-config.ts` traduce la URL a la
  configuración del pool (`?ssl=true`, `connectionLimit`) y `shared/infra/prisma.ts` crea el
  cliente con `@prisma/adapter-mariadb`. Los datos persisten en `C:\xampp\mysql\data\automarket3d`.
- **Base propia `automarket3d`** (utf8mb4): no toca otras bases del mismo servidor.
- **`database/automarket3d.sql`**: el esquema completo (tablas, claves, índices y CHECKs) con el
  catálogo inicial (planes, ajustes, lista negra) y el registro de la migración, para importar en
  phpMyAdmin o con `mysql.exe`. No incluye usuarios ni vehículos de ejemplo (los crea el seed).
- **PK UUID v7 en `CHAR(36)`**: ordenables en el tiempo (buena localidad en InnoDB). Cuando el id
  debe existir antes de insertar (va en las URL de retorno de Binance Pay) se genera con `uuidv7()`.
- **24 tablas**: identidad (`users`, `oauth_accounts`, `refresh_tokens`, `password_reset_tokens`),
  membresías (`plans`, `membership_periods`, `platform_settings`), catálogo (`vehicles`,
  `vehicle_media`, `carousel_items`), comercio (`cart_reserves`, `payments`,
  `payment_webhook_events`, `ledger_entries`), moderación (`blocked_terms`, `reports`, `reviews`,
  `contact_messages`), comunicación (`conversations`, `chat_messages`, `notifications`,
  `email_outbox`), cumplimiento (`kyc_documents`, `audit_logs`).
- **Unicidad condicional sin índices parciales**:
  - `cart_reserves.openKey = "buyerId:vehicleId"` mientras la reserva está abierta (NULL al cerrarse) → una reserva abierta por comprador y vehículo.
  - `vehicles.lockedReservationId UNIQUE` + `UPDATE … WHERE lockedReservationId IS NULL AND status = 'PUBLISHED'` → un solo bloqueo por vehículo aunque dos aceptaciones lleguen a la vez.
  - `membership_periods.paymentId UNIQUE` y `payment_webhook_events.id` (PK `bizType:bizId:bizStatus`) → activación y webhooks exactamente una vez.
  - `payments.reference` y `payments.txId` UNIQUE → cada referencia y cada transacción de Binance sirven para un solo pago.
- **CHECKs** (`prisma/sql/constraints.sql`): concesionario con datos fiscales completos, precio > 0, abono de reserva ≤ precio, dueños 0–3 y coherentes con NUEVO/USADO, abono según tipo de reserva, mensaje según tipo, `moderationFlags` es un array JSON, motivo obligatorio en rechazos KYC, tasas, precios y plazos válidos, reembolsos ≤ importe, valoración 1–5.
- **Migraciones** (aplicar: `npm run db:deploy -w @automarket/api`):
  - `20261030120000_init`: DDL generado por `prisma migrate diff` + constraints.
  - `20261030180000_p2p_concesionarios`: tipo de cuenta y datos fiscales (`users.accountType`, `businessName`, `taxId` UNIQUE, `fiscalAddress`, `businessPhone`); planes por tipo de cuenta (`BASIC→PREMIUM`, `MEDIUM→DEALER_BASIC`, `PRO→DEALER_PRO` sin perder asignaciones, `plans.accountType`); abono de reserva del vendedor (`vehicles.reservationAmount`); reserva P2P con comisión post-venta (`cart_reserves.salePrice`, `commissionDueAt`, `commissionPaidAt`, `legalAcceptedAt`); fondo del login y Términos en `platform_settings`.

---

## 4. Identidad, roles y anti-bot

- **Roles unificados**: `USER` (compra, reserva y publica) y `ADMIN`. Publicar, reservar o pagar
  exige cuenta activa con **país y ciudad** (`requireCompleteProfile`, consulta en BD).
- **Registro**: nombre, email, contraseña (argon2id, 19 MiB / t=2), **país (ISO‑3166) y ciudad**
  (normalizada: «ciudad DE méxico» → «Ciudad de México»), aceptación de los Términos (enlace a `/terminos`)
  y **tipo de cuenta**: *persona natural* o *concesionario*. El concesionario aporta obligatoriamente
  **razón social, RIF, dirección fiscal y teléfono corporativo** (CHECK en BD; en Venezuela el RIF se
  valida y normaliza a `J-12345678-9`; RIF único por cuenta → 409 `TAX_ID_TAKEN`). Se muestran en su
  perfil y en su insignia (RIF, dirección y teléfono públicos con un plan de concesionario).
  Las cuentas de Google/Apple completan país y ciudad en `/cuenta/perfil` (`needsProfile`).
- **Verificación estricta** (`shared/trust.ts`): para **publicar o reservar** hace falta identidad
  verificada: cédula (u otro documento) + selfie aprobados por el equipo (KYC, archivos en la carpeta
  privada `cedulas/`) + **teléfono** en el perfil; los concesionarios, además, el documento del RIF.
  Al completarse el último requisito la cuenta queda verificada sola. Después, teléfono, tipo de
  cuenta y RIF quedan fijos (cambiarlos requiere soporte). Las comisiones post-venta vencidas también
  bloquean publicar y reservar (`COMMISSION_OVERDUE`).
- **Detección de bots** en registro, login, recuperación y contacto:
  1. **Cloudflare Turnstile**: el token se verifica servidor‑servidor (`siteverify`) con la IP real y la **acción** del formulario (un token del login no vale para el registro). Obligatorio en producción.
  2. **Honeypot** `website` invisible.
  3. **Rate limiting en Redis** (Lua `INCR`+`PEXPIRE`, compartido entre instancias): login 10/15 min por IP+email y 50 por IP; registro 5/h; recuperación 5/h por IP y 3 correos/h por cuenta; contacto 5/h. Sin Redis solo se permite en desarrollo.
- **Recuperación de contraseña**: token de 256 bits de un solo uso (en BD solo su SHA‑256), caduca en 30 min; la respuesta nunca revela si el correo existe; al restablecer se revocan todas las sesiones.
- Sesión: JWT HS256 de 15 min (`am_at`) + refresh opaco rotatorio con detección de reutilización (`am_rt`).

---

## 5. Publicación de vehículos

```
Borrador (ficha + precio + abono)  →  Galería: ≤10 fotos o vídeos (PUT prefirmado a S3 · vehiculos/)
                                   →  Publicar (identidad verificada · ≥1 foto real · abono fijado ·
                                                sin términos bloqueados · límite del plan)
```

- El vendedor fija **precio, abono de reserva** (≤ precio; se le paga directamente a él) **y ficha técnica**; **dueños anteriores** obligatorio (único, 2, 3+) y **condición** NUEVO/USADO (nuevo ⇒ 0 dueños y ≤1.000 km, validado en web, API y CHECK).
- Galería: JPG/PNG/WebP ≤10 MB y MP4/WebM/MOV ≤200 MB; registro serializado con `SELECT … FOR UPDATE` (nunca más de 10). **Foto real obligatoria**: en la web, `accept` de HTML5 y botón Publicar desactivado sin foto; en la API, tamaño y tipo del objeto en S3 y su **firma binaria** (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF…WEBP`): un archivo renombrado se rechaza (`MEDIA_NOT_A_PHOTO`) y se borra. La **portada** del catálogo es la primera FOTO; la ficha muestra la galería completa con reproductor de vídeo y el visor 3D modular.
- **Límites del plan** (serializados con bloqueo de la fila del usuario): anuncios en cupo y duración (Gratis 1/30 d · Premium 3/60 d · Concesionario Básico 20/90 d · Concesionario Pro ilimitados/sin vencimiento). El cupo cuenta borradores, publicados y reservados; pausados, vendidos, vencidos y retirados no cuentan. Con el cupo lleno, crear otro anuncio devuelve 403 `PLAN_LIMIT_REACHED` y la web muestra «Llegaste al límite de tu plan» con el botón para mejorarlo (pago con Binance). Un job pasa a `EXPIRED` los anuncios vencidos.
- **CRUD del vendedor** (`/cuenta/anuncios`): crear (borrador), editar ficha y galería, publicar, pausar, renovar y **retirar** (`DELETE /api/vehicles/:id` = archivado: sale del cupo y del catálogo, pero se conserva por el historial de reservas y pagos). El panel muestra el cupo usado y el estado del plan.
- **Destacados**: Concesionario Pro hasta 3 simultáneos mientras dure el plan; Concesionario Básico 1 por mes natural durante 30 días (si no lo elige, el job destaca su anuncio más reciente).

---

## 6. Búsqueda y recomendaciones

- Filtros: texto libre, marca, modelo, año (rango), precio (rango), condición, dueños, categoría, país y ciudad; facetas con recuento real (`/api/vehicles/facets`).
- Orden **relevancia**: misma ciudad > mismo país (perfil del usuario o `CF‑IPCountry` si es anónimo) > disponible > destacado > prioridad del plan del vendedor (Pro = máxima) > recencia. SQL parametrizado (`Prisma.sql`), comodines de `LIKE` escapados.
- **Similares**: misma categoría o marca, precio cercano y zona del anuncio. **Recomendados**: cercanía + intereses reales del usuario (vehículos sobre los que chateó o reservó).

---

## 7. Reservas P2P con confirmación del vendedor

```
AWAITING_SELLER ──(vendedor confirma: bloqueo atómico)──▶ ACCEPTED ──(venta concretada)──▶ COMPLETED ──▶ comisión post-venta (Binance)
AWAITING_SELLER ──(rechazo · plazo vencido · el comprador la retira)──▶ REJECTED / EXPIRED / CANCELLED
ACCEPTED ──(cancelación · fin del plazo de reserva sin venta)──▶ CANCELLED / EXPIRED (vuelve a estar disponible)
```

- **Cobro directo P2P**: el abono que fija el vendedor se le paga **directamente a él** (transferencia, pago móvil, Binance P2P…). AutoMarket no cobra ni custodia ese dinero; se descuenta del precio total y, si la venta no se concreta, el vendedor debe devolverlo íntegro.
- **Aviso legal**: antes de reservar, el comprador acepta en un modal el deslinde de encuentros presenciales, el pago directo al vendedor, el abono a cuenta del precio y la devolución del 100 % si la venta falla (`acceptLegal`; se guarda `legalAcceptedAt`).
- Comprador y vendedor deben tener la **identidad verificada**. El vendedor tiene `sellerResponseHours` (1–72 h) para confirmar.
- **Confirmar**: transacción con `FOR UPDATE` + `UPDATE` condicional del vehículo (`RESERVED`, `lockedReservationId`); se fija la tasa de comisión del plan del vendedor y el plazo de la reserva (`reservationHoldDays`, 7 días por defecto). El resto de solicitudes del vehículo se rechazan. Mientras tanto la ficha muestra el aviso formal: *«Este vehículo se encuentra en proceso de reserva. Si la compra no se concreta, volverá a estar disponible para reserva automáticamente.»*
- **Chat directo**: con la reserva confirmada, cada parte ve los **datos verificados** de la otra (nombre, teléfono, email, ciudad y, en concesionarios, razón social, RIF, dirección fiscal y teléfono corporativo) y se habilitan las **notas de voz**. Antes, el chat oculta teléfonos, correos y enlaces y no admite audio (no se puede moderar).
- **Sin venta**: si se cancela o vence el plazo, el vehículo vuelve a `PUBLISHED` solo y ambas partes reciben el recordatorio de devolver el 100 % del abono.
- **Venta concretada** (la marca el vendedor): vehículo `SOLD`; comisión = tasa del plan × precio de venta, a pagar con Binance en `commissionDueDays` (7 por defecto) con la advertencia legal de acciones judiciales por impago. Pagada → libro `SALE_COMMISSION`. Vencida → aviso único (campana + correo) y bloqueo de publicar y reservar hasta pagarla.

---

## 8. Membresías

| Plan | Para | Anuncios | Duración | Comisión* | Extras |
|---|---|---|---|---|---|
| Gratis | cualquier cuenta | 1 (límite estricto) | 30 días | 5 % | — |
| Premium | personas naturales | 3 | 60 días | 3,5 % | prioridad en búsquedas |
| Concesionario Básico | concesionarios | 20 | 90 días | 2 % | RIF visible · 1 destacado automático al mes |
| Concesionario Pro / VIP | concesionarios | ilimitados | sin vencimiento | 0 % | RIF visible · posicionamiento prioritario · hasta 3 destacados |

\* comisión post-venta sobre el precio de cada venta concretada. Precios mensual/anual, cupo y comisión **editables por el administrador** (valores iniciales en `seed.ts`). Una persona natural no puede contratar planes de concesionario ni al revés (`PLAN_NOT_FOR_ACCOUNT`).

- **Pago por periodo** (mes o año) con Binance a la cuenta de la empresa (`/cuenta/plan` → «Pagar/Renovar con Binance» → `/pagos/[id]`). Renovar el mismo plan antes de vencer **acumula** el tiempo; cambiar de plan empieza hoy.
- **Activación**: con Binance Pay, automática al confirmarse el pago (webhook `PAY_SUCCESS`, o consulta de estado si el webhook no llega); con Pay ID, cuando el equipo aprueba el comprobante en `/admin/pagos`. Idempotente (`membership_periods.paymentId` UNIQUE, origen `BINANCE`). Un cobro manual sin comprobante caduca a las `MANUAL_PAYMENT_WINDOW_HOURS` (24 h). **Manual**: el administrador activa, renueva o da de baja desde el panel (queda en historial y auditoría).
- **Avisos**: a ≤10 y ≤3 días, notificación + correo (una sola vez cada uno, `dedupeKey`) y banner en la app. Al vencer: plan Gratis, sin prioridad ni destacados y solo el anuncio activo más reciente sigue publicado (el resto en pausa).

---

## 9. Pagos con Binance

Binance se usa **solo para lo que cobra la plataforma**: membresías y comisiones post-venta (las reservas se pagan directamente al vendedor). Dos modos que se activan por configuración; pueden convivir: el usuario elige y la web solo muestra los configurados.

| Modo | Configuración (`apps/api/.env`) | Cómo paga el usuario | Confirmación |
|---|---|---|---|
| **Pay ID** (manual) | `BINANCE_PAY_ID`, `BINANCE_PAY_NAME` y, opcional, `BINANCE_PAY_QR_IMAGE_URL` | En la app de Binance (Pay → Enviar → Pay ID) envía el importe exacto con la **referencia** (`AM` + 8 caracteres) en la nota y pega el id de la transacción | Un administrador lo comprueba en su Binance y aprueba o rechaza en `/admin/pagos` |
| **Binance Pay** (comercio) | `BINANCE_PAY_API_KEY` + `BINANCE_PAY_SECRET_KEY` (cuenta Binance Merchant) | La API crea la orden y la web muestra el QR, el enlace de pago y el acceso directo a la app | Automática: webhook firmado y, si no llega, consulta de estado por job |

- **Estados** (`payments`): `PENDING → (SUBMITTED, solo manual) → PAID → (REFUND_PENDING) → REFUNDED / PARTIALLY_REFUNDED`; sin cobro: `REJECTED`, `EXPIRED`, `CANCELLED`, `FAILED`. Un pago que Binance confirma tarde se acepta igualmente y sus efectos son idempotentes.
- **Moneda**: `PAYMENT_CURRENCY` (USDT por defecto; USDC o FDUSD), 1:1 con USD. El libro contable siempre va en USD.
- **Cliente propio** (`shared/infra/binance-pay.ts`): cada petición se firma con `HMAC-SHA512("timestamp\nnonce\nbody\n")` en las cabeceras `BinancePay-Timestamp/Nonce/Certificate-SN/Signature`; crea (`/binancepay/openapi/v2/order`), consulta, cierra y reembolsa órdenes.
- **Webhook** `POST /api/payments/binance/webhook`: verificación RSA‑SHA256 con el certificado público de Binance (`/binancepay/openapi/certificates`, en caché 1 h) sobre el cuerpo **original** (`rawBody`) y marca de tiempo de ≤5 min; cada evento se registra una vez en `payment_webhook_events`. Eventos: `PAY_SUCCESS`, `PAY_CLOSED`, `REFUND_SUCCESS`; respuesta `{"returnCode":"SUCCESS","returnMessage":null}`. La URL va en cada orden si defines `API_PUBLIC_URL` (HTTPS público); si no, configúrala en el panel de Binance Merchant.
- **Web**: `/pagos/[id]` muestra las instrucciones (Pay ID, importe y referencia con botón de copiar, o el QR de Binance Pay) y el estado en vivo; `/admin/pagos` tiene las pestañas «Por verificar», «Reembolsos por enviar» y «Todos».

---

## 10. Panel de administración (`/admin`, rol ADMIN)

- **Resumen**: ingresos (membresías + comisiones post-venta cobradas) desde `ledger_entries`, comisiones por cobrar y vencidas, serie mensual de 12 meses (barras apiladas con leyenda y vista de tabla; paleta validada para daltonismo en claro y oscuro), usuarios por plan, concesionarios y ventas concretadas.
- **Pagos Binance**: verificación de los pagos al Pay ID (importe, referencia e id de transacción; aprobar o rechazar con nota). Aprobar un pago de comisión la marca como pagada.
- **Comisiones**: comisiones post-venta pendientes (vencidas primero) con los datos del vendedor y el último intento de pago.
- **Usuarios y membresías**: búsqueda, tipo de cuenta y datos fiscales, suspensión (revoca sesiones), alta/renovación/baja manual de planes.
- **Planes y ajustes**: precios mensual/anual, cupo de anuncios y comisión post-venta por plan; plazo del vendedor, duración de la reserva y plazo para pagar la comisión.
- **Login y Términos**: imagen de fondo del login (subida al bucket público, carpeta `login-bg/`, firma de imagen comprobada; su ruta se guarda en MySQL) y editor de los Términos y Condiciones con vista previa (texto con `#`, `##` y `-`; se publican en `/terminos`).
- **Inventario**, **Carrusel** (selección y orden del equipo; después los destacados de los planes), **Moderación** (denuncias, reseñas con **exportación PDF de opiniones**, **lista negra global** que se aplica al instante a chats, títulos, descripciones y reseñas, mensajes de contacto), **KYC**.
- **Exportaciones reales**: `GET /api/admin/exports/:dataset?format=xlsx|pdf` (usuarios, inventario, reservas, pagos, denuncias, opiniones) generadas con exceljs y pdfkit en streaming. El PDF de opiniones resume la media y la distribución por estrellas e incluye cada comentario completo; todos los PDF llevan el aviso de derechos de autor en el pie de página.

---

## 11. Landing (Next.js)

Modo **día/noche** (preferencia guardada; por defecto la del sistema, sin parpadeo), buscador con país, **contadores en vivo** de usuarios y autos publicados (valor inicial desde MySQL + actualizaciones por Socket.io `/public`), **carrusel controlado desde el panel**, cómo funciona, planes con precios reales (personas naturales / concesionarios), **testimonios** (reseñas aprobadas con media real) y **formulario de contacto** con Turnstile.

- **Fase 1 · landing pública**: comprar o vender lleva al login (el catálogo y las fichas son privados, `proxy.ts`).
- **Fase 2 · acceso**: login, registro y recuperación en una tarjeta de cristal (glassmorphism) sobre el **fondo dinámico** que el administrador sube desde el panel (sin imagen: degradado de marca).
- **Fase 3 · aplicación privada**: catálogo, reservas, chat (emojis, fotos, vídeo y notas de voz en el chat directo) y verificación.
- **Derechos de autor**: pie de página de la landing, el acceso y la aplicación con «© Todos los derechos reservados. Sistema desarrollado bajo licencia exclusiva del propietario de la plataforma.»; cabecera en el código (`/*! … */`), `LICENSE` propietaria, `"license": "UNLICENSED"` en los paquetes, meta `copyright` y, en producción, sin mapas de código fuente ni cabecera `X-Powered-By`. El código que se ejecuta en el navegador siempre puede verse: la protección real es la licencia y que la lógica de negocio vive en la API.

---

## 12. Tareas programadas

`jobs/scheduler.ts` (cada `JOBS_INTERVAL_MS`, bajo `GET_LOCK('automarket:jobs')`): **pagos** (caducan los cobros de membresía no pagados y se cierra su orden en Binance Pay; se consultan las órdenes de Binance Pay pendientes por si el webhook no llegó; se reintentan los reembolsos automáticos), **reservas** (caducan las solicitudes sin respuesta del vendedor; las reservas confirmadas que agotan su plazo sin venta vuelven a dejar el vehículo disponible; recordatorio de la comisión 2 días antes y aviso único al vencer), vencimiento de anuncios, avisos y vencimiento de membresías, destacado mensual del plan Concesionario Básico y envío de la bandeja de correo.

---

## 13. Puesta en marcha

```bash
# Requisitos: Node ≥ 22.12 · XAMPP con «MySQL» (MariaDB) iniciado en su panel de control (:3306)
cd automarket-3d
npm install                       # compila packages/contracts (postinstall)
cp apps/api/.env.example apps/api/.env          # ya apunta a mysql://root@127.0.0.1:3306/automarket3d
cp apps/web/.env.example apps/web/.env.local
C:/xampp/mysql/bin/mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS automarket3d CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
npm run db:generate -w @automarket/api
npm run db:deploy -w @automarket/api   # crea las tablas (equivale a importar database/automarket3d.sql)
npm run db:seed -w @automarket/api     # planes, ajustes, lista negra y datos de ejemplo
npm run dev:s3 -w @automarket/api      # S3 local (o S3_ENDPOINT de MinIO)
npm run dev:api                        # API + Socket.io en :4000
npm run dev:web                        # web en :3000
```

**Pagos con Binance**: en `apps/api/.env` rellena `BINANCE_PAY_ID` (tu Pay ID: app de Binance → Pay → Recibir) y `BINANCE_PAY_NAME`; opcional `BINANCE_PAY_QR_IMAGE_URL` (p. ej. guarda tu QR de cobro en `apps/web/public/binance-qr.png` y usa `http://localhost:3000/binance-qr.png`). Para el cobro automático con Binance Pay añade `BINANCE_PAY_API_KEY` y `BINANCE_PAY_SECRET_KEY` de tu cuenta Binance Merchant y `API_PUBLIC_URL`. Sin ninguno, la web avisa de que los pagos aún no están configurados.

Alternativas a XAMPP: `docker compose up -d` (MySQL 8.4 · Redis · Mailpit en http://localhost:8025; usa el puerto 3306, así que detén antes el MySQL de XAMPP) con `DATABASE_URL=mysql://automarket:automarket@127.0.0.1:3306/automarket`, o `npm run dev:db -w @automarket/api`, que arranca **MySQL 8.4 oficial** en `:3307` con datos efímeros.

Cuentas de ejemplo (`seed.ts`): `admin@automarket.dev / Admin2026!`, `vendedor@automarket.dev / Vende2026!` (concesionario «Prestige Motors C.A.», RIF J-40123456-7, plan Concesionario Pro, verificado), `comprador@automarket.dev / Compra2026!` (persona natural, verificada).

**Pruebas**: `npm run test:e2e -w @automarket/api` levanta MySQL 8.4 real (o, con `E2E_DATABASE_URL=mysql://root@127.0.0.1:3306`, usa el servidor de XAMPP: crea la base temporal `automarket_e2e` y la borra al terminar), aplica las migraciones y ejecuta **220 comprobaciones** (registro de personas y concesionarios con RIF y anti-bot, recuperación por SMTP, verificación estricta con cédula + selfie + teléfono, foto real y abono obligatorios, límite estricto del plan gratuito, CRUD de anuncios, planes por tipo de cuenta con Binance en modo manual y comercio, webhooks duplicados o con firma manipulada, búsqueda por cercanía, reserva P2P con aviso legal, bloqueo y chat directo con nota de voz, venta concretada y comisión post-venta (manual, Binance Pay y vencida con bloqueo), jobs, fondo del login y Términos desde el panel, administración, exportaciones y PDF de opiniones, contadores en vivo). Binance Pay, Turnstile, S3 y SMTP se sustituyen por dobles locales que respetan su contrato HTTP (`test/fakes.mjs`).

### Para producción

`NODE_ENV=production` exige `TURNSTILE_SECRET_KEY`, `SMTP_URL`, `REDIS_URL` y al menos un método de pago (`BINANCE_PAY_ID` o las claves de Binance Pay). Configura además un usuario de MySQL con contraseña en `DATABASE_URL` (no `root` sin contraseña; TLS con `?ssl=true` si la base está en otra máquina), `JWT_ACCESS_SECRET` aleatorio, `WEB_URL`, `API_PUBLIC_URL` (HTTPS, para el webhook de Binance Pay) y `MEDIA_PUBLIC_BASE_URL` (CDN). En la web: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y `NEXT_PUBLIC_MEDIA_HOST`. Ajusta `TRUST_PROXY` al número de proxies delante de la API para que el rate limiting vea la IP real.
