import { COPYRIGHT_NOTICE, MAX_VEHICLE_MEDIA } from '@automarket/contracts';

/**
 * Términos y políticas iniciales. El administrador los reemplaza desde el panel
 * (platform_settings.termsContent); mientras no lo haga, se publican estos.
 * Formato: cada «# Título» abre un documento; el texto antes del primer «##» es su
 * introducción; «## Sección» (se numeran solas), párrafos y listas «- ».
 */
export const DEFAULT_TERMS = `# Términos y condiciones

Las reglas para usar AutoMarket. Al registrarte y usar la plataforma las aceptas. Están escritas para que se entiendan; si algo no queda claro, pregúntanos.

## Qué es AutoMarket
AutoMarket es una plataforma para publicar, buscar y reservar autos entre personas y concesionarios. No compramos ni vendemos autos y no somos parte de la compraventa: el trato es entre comprador y vendedor.

## Tu cuenta
- Puedes registrarte como persona natural o como concesionario. Los concesionarios deben indicar razón social, RIF, dirección fiscal y teléfono corporativo verídicos.
- Debes ser mayor de edad y usar datos reales. Una cuenta por persona.
- Eres responsable de la veracidad de tus datos y de la confidencialidad de tu contraseña.

## Verificación de identidad
Para publicar o reservar debes verificar tu identidad: cédula (u otro documento de identidad), selfie y teléfono. A los concesionarios también les revisamos el documento del RIF. Si los datos no coinciden podemos rechazar la verificación o suspender la cuenta.

## Publicar
- Cada anuncio es de un solo auto y debe incluir al menos una foto real del vehículo y datos exactos: precio, kilometraje, dueños anteriores y estado.
- Tu plan define cuántos anuncios puedes tener activos y cuánto duran. El plan gratuito tiene un límite; para publicar más puedes contratar un plan de pago con Binance.
- No publiques autos que no tienes derecho a vender. AutoMarket puede retirar anuncios falsos, engañosos o que incumplan estas condiciones.

## Reservas y abono
- El abono de reserva lo fija el vendedor y se paga directamente al vendedor. AutoMarket no cobra, no custodia ni garantiza ese dinero.
- El abono forma parte del precio y se descuenta del precio total acordado del vehículo. Si la venta no se concreta, el vendedor está obligado a devolver el 100 % del abono al comprador.
- Mientras una reserva está confirmada el vehículo queda bloqueado para otros compradores, y el vendedor puede marcarlo «En negociación» mientras cierran la venta. Si la compra no se concreta en el plazo de la reserva, vuelve a estar disponible automáticamente.

## Encuentros presenciales
- AutoMarket no participa ni se hace responsable de los encuentros presenciales entre usuarios.
- Reúnete en lugares públicos y seguros, revisa el vehículo y su documentación antes de pagar, y no compartas datos bancarios por canales no seguros.

## Planes, destacados y comisiones
- Los planes, los destacados y las comisiones de la plataforma se pagan con Binance (Binance Pay o el Pay ID oficial que aparece bloqueado en la pantalla de pago). Nadie del equipo te pedirá pagar a otra cuenta.
- Al reportar una venta, el vendedor declara el precio final y paga la comisión de su plan antes de finalizar el anuncio. La comisión se calcula sobre ese precio y la ves en tu plan antes de publicar.
- Si pagas por Pay ID, el pago queda pendiente hasta que un administrador verifique la referencia y el ID de transacción en Binance. No aplicamos sanciones ni bloqueos mientras ese comprobante esté en revisión.
- Si el pago no se completa o se rechaza, la venta no se finaliza y el anuncio vuelve a su estado anterior; el vendedor puede iniciar otro pago.
- Las comisiones de ventas confirmadas deben pagarse en el plazo indicado. El impago bloquea la cuenta para publicar y reservar, y AutoMarket podrá iniciar acciones legales y judiciales para su cobro.

## Lo que no está permitido
Engañar o estafar, pedir datos de tarjetas, pedir pagos fuera de lo acordado, publicar datos falsos o duplicados, usar lenguaje ofensivo, enviar spam o compartir datos de contacto para saltarse la plataforma antes de confirmar una reserva. Los datos de contacto y las notas de voz se habilitan en el chat directo, al confirmarse la reserva.

## Reportes y sanciones
Cualquiera puede reportar un anuncio, un chat o un perfil. El equipo lo revisa y puede retirar anuncios, advertir o suspender cuentas. Si crees que nos equivocamos, escríbenos.

## Responsabilidad
Revisa el auto y sus papeles antes de pagar el resto del precio. El valor de mercado y el precio sugerido por el Copiloto son una referencia calculada con anuncios publicados, no una garantía del precio ni del estado del vehículo.

## Propiedad intelectual
${COPYRIGHT_NOTICE} Queda prohibida la copia, reproducción o distribución total o parcial del sistema, su código, diseño y contenidos sin autorización expresa y por escrito del propietario de la plataforma.

## Cambios a estos términos
AutoMarket puede actualizar estos términos. La versión vigente es la publicada en esta página con su fecha de actualización; si cambia, te pedimos aceptar la nueva versión.

# Política de privacidad

Qué datos tuyos usamos, para qué y cómo los puedes controlar.

## Qué datos guardamos
Los de tu cuenta (nombre, correo, teléfono, país y ciudad), los de verificación (documento de identidad y selfie; el RIF si eres concesionario), los de tus anuncios y mensajes, y datos técnicos como el navegador para proteger la cuenta.

## Para qué los usamos
Para crear tu cuenta, verificar que eres quien dices, mostrar tus anuncios, que te escriban, avisarte de lo que pediste, prevenir estafas y mejorar el servicio. No vendemos tus datos.

## Quién ve qué
Tu teléfono y correo quedan ocultos en el chat hasta que el vendedor confirma una reserva. De tu ubicación solo mostramos la ciudad, nunca la dirección. Tu documento de identidad y tu selfie solo los ve el equipo de verificación.

## Cuánto tiempo
Mientras tengas la cuenta. Si pides borrarla, eliminamos tus datos, salvo lo que la ley nos obligue a guardar.

## Tus derechos
Puedes ver y corregir tus datos desde Mi cuenta. Para descargarlos o borrarlos, escríbenos desde el formulario de contacto.

## Seguridad
Usamos conexión cifrada, verificación anti-bots y revisión de pagos. Si notamos algo raro en tu cuenta, te avisamos.

# Política de cookies

Las cookies son archivos pequeños que guarda tu navegador. Usamos pocas y te dejamos elegir las opcionales.

## Necesarias
Mantienen tu sesión abierta y protegen los formularios contra bots. Sin ellas la web no funciona, por eso no se pueden apagar.

## Preferencias
Recuerdan en este navegador cosas como el modo claro u oscuro y tus emojis recientes del chat. Son opcionales: si las apagas, se borran y dejamos de guardarlas.

## Medición
Nos dirían qué páginas se usan más, sin identificarte. Hoy AutoMarket no usa cookies de medición; si algún día las usamos, solo se activarán si las aceptas aquí.

# Pagos y reembolsos

Cómo pagas a AutoMarket y cuándo devolvemos el dinero.

## Cómo pagas
Por Binance: con Binance Pay, o pagando al Pay ID oficial de AutoMarket con la referencia del pago como nota y enviando el ID de la transacción. En ese caso, el equipo verifica el pago y se activa lo que compraste.

## Cuándo devolvemos
- Si pagaste dos veces, devolvemos el pago repetido.
- Si pagaste y no pudimos confirmar o activar lo que compraste, te devolvemos el monto completo a tu cuenta de Binance.
- Si un destacado no salió por una falla nuestra, te lo reponemos o te lo devolvemos.

## Cuándo no
Un plan o un destacado que ya está activo no se reembolsa por cambiar de idea. El abono de una reserva no pasa por AutoMarket: lo devuelve el vendedor.

# Reglas para anuncios

Para que todos encuentren autos reales a precios reales.

## Fotos
Hasta ${MAX_VEHICLE_MEDIA} fotos o videos del auto real. Nada de fotos de internet, textos encima o datos de contacto en la imagen.

## Precio y datos
El precio es el que realmente pides. El kilometraje debe coincidir con el tablero. Si algo cambia, edita el anuncio.

## Destacados
Los cupos son limitados y se reparten por orden de llegada.

## Lo que retiramos
Anuncios duplicados, con datos falsos, con teléfonos o enlaces en el texto, o de autos ya vendidos que no se marcaron como vendidos.

# Compra segura

Consejos para comprar y vender sin sustos.

## Antes de pagar
Ve el auto en persona, revísalo con tu mecánico y compara el serial (VIN) con los papeles. Desconfía de precios muy por debajo del mercado.

## Nunca
Pagues a una cuenta distinta a la del vendedor o a la oficial de AutoMarket, compartas datos de tu tarjeta ni envíes dinero a terceros «para apartar».

## Si algo no cuadra
Usa el botón Reportar en el anuncio, en el chat o en el perfil. El equipo revisa primero los reportes de posible fraude.
`;
