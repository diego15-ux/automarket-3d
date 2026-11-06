import { MAX_BOOSTED_LISTINGS, MAX_VEHICLE_MEDIA, normalizeSearch, normalizeText, parseLegalDocs, usdPrice, type CopilotChipDTO, type PlanDTO } from '@automarket/contracts';
import { env } from '../../config/env.js';
import type { getSettings } from '../memberships/plans.js';
import { DEFAULT_TERMS } from '../../shared/legal/default-terms.js';

/**
 * Dudas sobre AutoMarket y sobre comprar un auto (Copiloto del comprador), sin IA: cada tema tiene
 * frases y palabras que lo identifican y una respuesta armada con las reglas reales (planes,
 * plazos y precios del panel). Si ningún tema encaja, se busca en los Términos y políticas
 * publicados; si tampoco, el Copiloto lo dice y ofrece escribirle al equipo.
 *
 * Voz (instrucciones del proyecto): empieza por el dato, sin saludos ni frases de relleno; pasos
 * con «1. …», opciones con «- …», cifras y estados en **negrita**, y cierra con una sola llamada a
 * la acción (`cta`) que corresponde a la primera opción: así «sí» o «dale» la ejecuta.
 */

type Settings = Awaited<ReturnType<typeof getSettings>>;
export interface HelpFacts {
  plans: PlanDTO[];
  settings: Settings;
}
export interface HelpAnswer {
  text: string;
  chips: CopilotChipDTO[];
  /** Cierre: una sola pregunta o instrucción que lleva a la primera opción (`chips[0]`). */
  cta?: string | null;
}

/** El cierre va en su propio párrafo y en negrita (la web lo muestra como la línea de acción). */
export const withCta = (text: string, cta?: string | null) => (cta ? `${text}\n\n**${cta}**` : text);

interface Topic {
  id: string;
  /** Frases (sin acentos) que identifican el tema: cuentan 3. */
  phrases: string[];
  /** Palabras propias del tema: cuentan 3. Con «*» al final vale como raíz (verific*). */
  strong?: string[];
  /** Palabras que ayudan: cuentan 1. */
  weak?: string[];
  /** Si aparece alguna, el tema no aplica (p. ej. «comparar automático y sincrónico» no es el comparador). */
  not?: string[];
  /** Vale aunque la pregunta nombre un modelo («avísame cuando salga un Corolla»). */
  withModel?: boolean;
  answer: (facts: HelpFacts) => string;
  chips?: CopilotChipDTO[];
  /** Llamada a la acción del final; corresponde a `chips[0]`. */
  cta?: string;
}

const say = (value: string): CopilotChipDTO => ({ label: value, text: value });
const go = (label: string, href: string): CopilotChipDTO => ({ label, href });
const CONTACT = go('Escribir al equipo', '/#contacto');
const pct = (rate: number) => `${String(Math.round(rate * 1000) / 10).replace('.', ',')} %`;
const money = (value: number) => usdPrice(value);
const listOf = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`);

const TOPICS: Topic[] = [
  {
    id: 'password',
    phrases: ['olvide mi contrasena', 'olvide la contrasena', 'cambiar mi contrasena', 'cambiar la contrasena', 'recuperar mi cuenta', 'no recuerdo mi clave'],
    strong: ['contrasena', 'contrasenas', 'clave', 'password'],
    answer: () =>
      `Recupérala en 3 pasos:\n1. En «Entrar», toca «¿Olvidaste tu contraseña?».\n2. Escribe el correo de tu cuenta.\n3. Abre el enlace que te llega (sirve **${env.PASSWORD_RESET_TTL_MINUTES} minutos**) y crea la nueva.\nPara cambiarla aunque la recuerdes, sigue los mismos pasos.`,
    chips: [go('Recuperar contraseña', '/recuperar')],
    cta: '¿Abrimos la recuperación de contraseña?',
  },
  {
    id: 'email',
    phrases: ['cambiar mi correo', 'cambiar el correo', 'cambio mi correo', 'cambio el correo', 'cambiar correo', 'otro correo', 'correo equivocado', 'cambiar mi email', 'cambiar el email', 'actualizar mi correo'],
    answer: () => 'El correo de la cuenta no se cambia desde la app; lo cambia el equipo:\n1. Abre «Contacto», en la portada.\n2. Escribe tu correo actual y el nuevo.',
    chips: [CONTACT],
    cta: '¿Le escribimos al equipo?',
  },
  {
    id: 'delete',
    phrases: ['borrar mi cuenta', 'eliminar mi cuenta', 'cerrar mi cuenta', 'dar de baja', 'darme de baja', 'borrar la cuenta', 'eliminar la cuenta', 'borrar mis datos', 'eliminar mis datos', 'borrar cuenta', 'eliminar cuenta'],
    answer: () =>
      'Para borrar tu cuenta y tus datos, escríbele al equipo desde «Contacto». Antes de pedirlo:\n1. Retira tus anuncios.\n2. Termina las reservas que tengas abiertas.\nLo que puedes pedir sobre tus datos está en la Política de privacidad.',
    chips: [CONTACT, go('Política de privacidad', '/terminos#politica-de-privacidad')],
    cta: '¿Le escribimos al equipo?',
  },
  {
    id: 'dealer-account',
    phrases: ['cuenta de concesionario', 'cambiar a concesionario', 'soy concesionario', 'tengo una agencia', 'tengo un concesionario', 'hacerme concesionario', 'hazte aliado', 'ser aliado', 'registrar mi agencia', 'registrar mi concesionario', 'vender como concesionario', 'persona natural'],
    weak: ['concesionario', 'agencia', 'rif'],
    answer: ({ plans }) => {
      const list = plans.filter(plan => plan.accountType === 'DEALER').map(plan => `- **${plan.name}**: ${money(plan.priceMonthly)} al mes · comisión de ${pct(plan.commissionRate)}`);
      return `Así abres una cuenta de concesionario:\n1. Al crear la cuenta, elige «Concesionario» (o cámbialo en Perfil → Mi cuenta mientras tu identidad no esté verificada).\n2. Completa razón social, RIF, dirección fiscal y teléfono corporativo.\n3. En la verificación, sube también el documento del RIF.${list.length ? `\nPlanes de concesionario:\n${list.join('\n')}` : ''}\nCon un plan de concesionario vigente se muestran tu RIF y tus datos fiscales.`;
    },
    chips: [go('Crear cuenta de concesionario', '/registro?tipo=concesionario'), say('¿Cómo verifico mi identidad?')],
    cta: '¿Creamos tu cuenta de concesionario?',
  },
  {
    id: 'register',
    phrases: ['crear cuenta', 'crear una cuenta', 'crear mi cuenta', 'como me registro', 'abrir una cuenta', 'hacerme una cuenta', 'registrarme'],
    weak: ['registro', 'registrar', 'registrarse'],
    answer: () =>
      'Crear la cuenta es **gratis**:\n1. Toca «Crear cuenta».\n2. Pon tu nombre, correo, contraseña, país y ciudad.\n3. Elige persona o concesionario (el concesionario agrega razón social, RIF, dirección fiscal y teléfono corporativo).\nPara publicar o reservar, después verificas tu identidad.',
    chips: [go('Crear cuenta', '/registro'), say('¿Cómo verifico mi identidad?')],
    cta: '¿Creamos tu cuenta?',
  },
  {
    id: 'login',
    phrases: ['no puedo entrar', 'no puedo iniciar sesion', 'iniciar sesion', 'no me deja entrar', 'entrar a mi cuenta', 'como entro', 'no puedo ingresar', 'cerrar sesion'],
    answer: () =>
      'Entras con tu correo y tu contraseña en «Entrar».\n- Si no la recuerdas, usa «¿Olvidaste tu contraseña?».\n- Para cerrar sesión, toca tu foto, arriba a la derecha.\n- Si te dice **cuenta suspendida**, escríbele al equipo desde «Contacto».',
    chips: [go('Entrar', '/login'), go('Recuperar contraseña', '/recuperar')],
    cta: '¿Vamos a «Entrar»?',
  },
  {
    id: 'profile',
    phrases: ['cambiar mi nombre', 'cambio mi nombre', 'editar mi perfil', 'cambiar mi foto', 'cambio mi foto', 'foto de perfil', 'cambiar mi telefono', 'cambio mi telefono', 'cambiar mi numero', 'cambio mi numero', 'mi perfil', 'cambiar mi ciudad', 'cambiar la ciudad', 'mi biografia', 'horario de atencion'],
    answer: () =>
      'En Perfil → Mi cuenta cambias:\n- Nombre, ciudad y biografía (los concesionarios, también su horario de atención).\n- Foto, con «Cambiar foto»: JPG, PNG o WebP de hasta **5 MB**.\n- Teléfono, mientras tu identidad no esté verificada; después lo cambia el equipo.\nTu teléfono solo lo ve la otra persona cuando hay una **reserva confirmada**.',
    chips: [go('Abrir mi perfil', '/cuenta/perfil')],
    cta: '¿Abrimos tu perfil?',
  },
  {
    id: 'kyc',
    phrases: ['verificar mi identidad', 'verifico mi identidad', 'verificar identidad', 'verificar mi cuenta', 'verificacion de identidad', 'como me verifico', 'como verifico', 'subir mi cedula', 'subir la cedula', 'documentos para verificar', 'que documentos'],
    strong: ['verificarme', 'verificacion', 'kyc', 'selfie'],
    answer: () =>
      'Verifica tu identidad en 3 pasos:\n1. Sube tu cédula, pasaporte o licencia de conducir vigente.\n2. Tómate una selfie con buena luz.\n3. Agrega tu teléfono en el perfil.\nLos concesionarios suben además el documento del RIF. El equipo revisa cada documento; si rechaza uno, ves el motivo y subes otro.\nSin la verificación **no puedes publicar ni reservar**.',
    chips: [go('Verificar mi identidad', '/cuenta/verificacion')],
    cta: '¿Empezamos la verificación?',
  },
  {
    id: 'kyc-wait',
    phrases: ['cuanto tarda la verificacion', 'cuanto tardan en verificar', 'me rechazaron', 'rechazaron mi', 'documento rechazado', 'verificacion rechazada', 'no me verifican', 'sigue en revision'],
    answer: () => 'El equipo revisa los documentos por orden de llegada; no hay un tiempo fijo.\n- Si rechaza uno, en Verificación de identidad ves el motivo y subes otro.\n- Si pasa mucho tiempo, escríbele al equipo desde «Contacto».',
    chips: [go('Ver mi verificación', '/cuenta/verificacion'), CONTACT],
    cta: '¿Revisamos el estado de tu verificación?',
  },
  {
    id: 'directory',
    phrases: ['ver concesionarios', 'lista de concesionarios', 'concesionarios en', 'agencias en', 'buscar un concesionario', 'buscar concesionario', 'seguir una agencia', 'seguir agencia', 'seguir al concesionario', 'seguir un concesionario'],
    strong: ['directorio'],
    answer: () => 'En «Concesionarios» están las agencias con **RIF verificado**, por país y ciudad, con sus autos, ventas y reseñas. Si sigues una agencia, te avisamos cada vez que publica un auto.',
    chips: [go('Ver concesionarios', '/concesionarios')],
    cta: '¿Abrimos el directorio de concesionarios?',
  },
  {
    id: 'saved',
    withModel: true,
    phrases: ['guardar un auto', 'guardar autos', 'autos guardados', 'mis guardados', 'guardar el auto', 'como guardo', 'marcar como favorito', 'tus guardados'],
    strong: ['favorito', 'favoritos', 'guardados'],
    answer: () =>
      'Toca «Guardar» (el corazón) en la ficha del auto.\n- Tus guardados están en Mis alertas.\n- Si el vendedor baja el precio, te avisamos. Eso se apaga en «Bajadas de precio en tus guardados».',
    chips: [go('Ver mis guardados', '/alertas#guardados')],
    cta: '¿Vemos tus guardados?',
  },
  {
    id: 'alerts',
    withModel: true,
    phrases: ['crear una alerta', 'alerta de busqueda', 'avisame cuando', 'avisarme cuando', 'me avisen cuando', 'me avisas cuando', 'mis alertas', 'avisame si sale', 'avisame si aparece'],
    strong: ['alerta', 'alertas'],
    answer: () =>
      'Crea una alerta en 3 pasos:\n1. En Mis alertas, toca «+ Nueva alerta».\n2. Elige la marca, el modelo, el precio máximo, la ciudad o el año.\n3. Escoge cada cuánto te avisamos: al instante, una vez al día o una vez a la semana.\nLa pausas cuando quieras. Para un auto reservado o en negociación, usa «Avísame si vuelve» en su ficha.',
    chips: [go('Abrir Mis alertas', '/alertas')],
    cta: '¿Creamos tu alerta?',
  },
  {
    id: 'compare',
    phrases: ['comparar autos', 'comparar dos autos', 'comparar varios', 'comparar carros', 'comparar los autos', 'lado a lado', 'como comparo', 'como comparar', 'comparo autos', 'comparo carros'],
    strong: ['comparador'],
    not: ['automatico', 'sincronico', 'caja'],
    answer: () =>
      'Compara hasta **3 autos** lado a lado:\n1. Toca «Comparar» en cada auto, en el catálogo o en la ficha.\n2. Abre «Ver la comparación».\nVes precio, kilómetros, año, caja y ficha técnica. También puedes escribirme dos modelos, por ejemplo «Corolla vs Civic».',
    chips: [go('Abrir el comparador', '/comparar')],
    cta: '¿Abrimos el comparador?',
  },
  {
    id: 'status',
    phrases: ['en negociacion', 'que significa reservado', 'que es reservado', 'por que dice reservado', 'esta reservado', 'avisame si vuelve'],
    answer: () =>
      '- **Reservado**: alguien pagó el abono y el vendedor lo confirmó; nadie más puede reservarlo por ahora.\n- **En negociación**: además, el vendedor está cerrando la venta.\nToca «Avísame si vuelve» en la ficha y te avisamos si queda libre.',
    chips: [say('¿Cómo funciona la reserva?')],
    cta: '¿Te explico cómo funciona la reserva?',
  },
  {
    id: 'featured',
    phrases: ['que significa destacado', 'que es destacado', 'por que dice destacado', 'autos destacados', 'que es un destacado'],
    answer: () => '**Destacado** quiere decir que el vendedor pagó para que su auto salga más arriba por unos días. No cambia el precio ni el estado del auto.',
  },
  {
    id: 'boost',
    withModel: true,
    phrases: ['destacar mi auto', 'destacar mi anuncio', 'destacar un anuncio', 'destacar el auto', 'semana destacada', 'salir primero', 'salir arriba', 'mas visitas', 'mas vistas', 'que lo vean mas', 'como destaco'],
    strong: ['destacar', 'impulso'],
    answer: ({ settings }) => {
      const login = settings.loginOnSale ? `\n- **Pantalla de entrada**: desde **${money(Number(settings.loginPrice1))}** por un día` : '';
      return `Destácalo desde Mis anuncios → «Destacar». Opciones:\n- **Impulso**: 3 días · **${money(Number(settings.boostPriceCity3))}**\n- **Semana destacada**: 7 días · **${money(Number(settings.boostPriceCity7))}**\n- **Portada**: 7 días · **${money(Number(settings.boostPriceHome))}**${login}\nSe paga en USDT con Binance. Los cupos son limitados por ciudad y tipo de auto: si están llenos, quedas en lista de espera sin pagar. Puedes tener hasta **${MAX_BOOSTED_LISTINGS} autos** destacados a la vez.`;
    },
    chips: [go('Ir a Mis anuncios', '/cuenta/anuncios'), say('¿Cómo pago con Binance?')],
    cta: '¿Vamos a Mis anuncios para destacarlo?',
  },
  {
    id: 'edit',
    phrases: ['editar mi anuncio', 'editar el anuncio', 'cambiar el precio', 'cambiar mi anuncio', 'modificar mi anuncio', 'modificar el anuncio', 'corregir mi anuncio', 'cambiar las fotos', 'bajar el precio', 'agregar fotos', 'subir mas fotos'],
    answer: () =>
      `En Mis anuncios abres el anuncio y cambias:\n- El precio.\n- Las fotos (hasta **${MAX_VEHICLE_MEDIA}**).\n- Los datos del auto.\nMientras está **reservado**, **en venta** o **vendido** no se puede editar. Si bajas el precio, avisamos a quienes lo guardaron.`,
    chips: [go('Ir a Mis anuncios', '/cuenta/anuncios')],
    cta: '¿Vamos a Mis anuncios?',
  },
  {
    id: 'pause',
    phrases: ['pausar mi anuncio', 'pausar el anuncio', 'pauso mi anuncio', 'quitar mi anuncio', 'borrar mi anuncio', 'eliminar mi anuncio', 'retirar mi anuncio', 'retirar el anuncio', 'ocultar mi anuncio', 'como pauso'],
    strong: ['pausar', 'pauso', 'despublicar'],
    withModel: true,
    answer: () =>
      'En Mis anuncios tienes dos opciones:\n- **Pausar**: deja de verse y lo vuelves a publicar cuando quieras.\n- **Retirar**: lo quita del catálogo y de tu cupo.\nSi tiene una reserva en curso, resuélvela primero.',
    chips: [go('Ir a Mis anuncios', '/cuenta/anuncios')],
    cta: '¿Vamos a Mis anuncios?',
  },
  {
    id: 'expire',
    phrases: ['anuncio vencido', 'se vencio', 'vence mi anuncio', 'cuanto dura mi anuncio', 'cuanto dura el anuncio', 'renovar mi anuncio', 'renovar el anuncio', 'volver a publicar', 'republicar'],
    answer: ({ plans }) => {
      const list = plans.map(plan => `- **${plan.name}**: ${plan.listingDurationDays ? `${plan.listingDurationDays} días` : 'no vence'}`);
      return `Lo que dura un anuncio depende del plan:\n${list.join('\n')}\nCuando vence, lo vuelves a publicar desde Mis anuncios.`;
    },
    chips: [go('Ir a Mis anuncios', '/cuenta/anuncios'), say('¿Qué planes hay?')],
    cta: '¿Vamos a Mis anuncios?',
  },
  {
    id: 'limit',
    phrases: ['cuantos autos puedo publicar', 'cuantos anuncios puedo', 'limite de anuncios', 'no me deja publicar', 'publicar mas autos', 'publicar mas de un auto', 'mas de un anuncio'],
    answer: ({ plans }) => {
      const list = plans.map(plan => `- **${plan.name}**: ${plan.maxActiveListings === null ? 'sin límite' : `${plan.maxActiveListings} ${plan.maxActiveListings === 1 ? 'anuncio' : 'anuncios'}`}`);
      return `Los anuncios que puedes tener activos dependen del plan:\n${list.join('\n')}\nSi llegaste al límite, mejora tu plan, o pausa o retira un anuncio. Para publicar también necesitas tu identidad verificada.`;
    },
    chips: [go('Ver mi plan', '/cuenta/plan')],
    cta: '¿Revisamos tu plan?',
  },
  {
    id: 'sold',
    withModel: true,
    phrases: ['marcar como vendido', 'marcar vendido', 'ya vendi', 'vendi mi auto', 'vendi el auto', 'cerrar la venta', 'lo vendi'],
    answer: ({ plans, settings }) => {
      const free = plans.filter(plan => plan.commissionRate === 0).map(plan => plan.name);
      return `Así cierras la venta:\n1. En Mis anuncios, toca «Marcar vendido».\n2. Escribe el precio final.\n3. Si tu plan cobra comisión, págala con Binance en un plazo de **${settings.commissionDueDays} días**.${free.length ? `\nCon ${listOf(free)} no hay comisión.` : ''}`;
    },
    chips: [go('Ir a Mis anuncios', '/cuenta/anuncios'), say('¿Cuánto cobran de comisión?')],
    cta: '¿Vamos a Mis anuncios?',
  },
  {
    id: 'rate',
    phrases: ['valorar al vendedor', 'calificar al vendedor', 'dejar una resena', 'dejar resena', 'poner estrellas', 'opinion del vendedor', 'resena del vendedor'],
    strong: ['resena', 'resenas', 'valoracion'],
    answer: () => 'Cuando se concreta la compra de un auto que reservaste, en Mis reservas le das de **1 a 5 estrellas** al vendedor y, si quieres, un comentario. Las reseñas salen en su perfil.',
    chips: [go('Mis reservas', '/cuenta/reservas')],
    cta: '¿Abrimos Mis reservas?',
  },
  {
    id: 'opinion',
    phrases: ['opinion sobre automarket', 'dejar mi opinion', 'opinar sobre la pagina', 'calificar la pagina', 'mi opinion'],
    answer: () => 'Escríbela en Perfil → «Mi opinión». El equipo la revisa y las mejores salen en la portada.',
    chips: [go('Abrir mi perfil', '/cuenta/perfil')],
    cta: '¿Abrimos tu perfil?',
  },
  {
    id: 'cancel',
    phrases: ['cancelar la reserva', 'cancelar mi reserva', 'anular la reserva', 'me arrepenti', 'ya no quiero el auto', 'cancelar reserva', 'quitar la reserva'],
    answer: () =>
      'En Mis reservas:\n- Si el vendedor aún no la confirmó, toca «Retirar solicitud».\n- Si ya estaba confirmada, toca «Cancelar reserva»: el vendedor te devuelve el **100 % del abono** y el auto vuelve al catálogo.',
    chips: [go('Mis reservas', '/cuenta/reservas'), say('¿A quién le pago el abono?')],
    cta: '¿Abrimos Mis reservas?',
  },
  {
    id: 'seller-silent',
    phrases: ['el vendedor no responde', 'no me contesta', 'no responde el vendedor', 'no me respondieron', 'no me responde', 'no contesta'],
    answer: ({ settings }) =>
      `Si el vendedor no responde en el chat, prueba con otro auto parecido. Si ya pediste la reserva y no la confirma en **${settings.sellerResponseHours} horas**, la solicitud vence sola y **no pagas nada**.`,
    chips: [go('Ver autos en el catálogo', '/vehiculos'), say('¿Cómo funciona la reserva?')],
    cta: '¿Vemos otros autos en el catálogo?',
  },
  {
    id: 'notifications',
    phrases: ['no me llegan los avisos', 'no me llegan', 'me llegan correos', 'correos de automarket', 'donde veo los avisos'],
    strong: ['notificaciones', 'notificacion', 'campana'],
    answer: () => 'Los avisos llegan a la campana, arriba a la derecha.\n- Los de reservas también te llegan al correo.\n- Las alertas de búsqueda y las de bajada de precio se pausan en Mis alertas.',
    chips: [go('Abrir Mis alertas', '/alertas')],
    cta: '¿Abrimos Mis alertas?',
  },
  {
    id: 'contact-team',
    phrases: ['hablar con alguien', 'hablar con una persona', 'hablar con un humano', 'hablo con el equipo', 'hablar con el equipo', 'contactar al equipo', 'contacto con el equipo', 'comunicarme con', 'escribirle a automarket', 'contactar a automarket', 'atencion al cliente', 'servicio al cliente', 'escribirle al equipo', 'contacto de automarket', 'numero de automarket', 'correo de automarket', 'poner un reclamo', 'hacer un reclamo'],
    strong: ['soporte', 'reclamo', 'queja'],
    answer: () => 'Escríbele al equipo desde «Contacto», en la portada. Cuéntales qué pasó y, si es sobre un auto, pega el enlace del anuncio.',
    chips: [CONTACT],
    cta: '¿Le escribimos al equipo?',
  },
  {
    id: 'suspended',
    phrases: ['cuenta suspendida', 'me suspendieron', 'me suspenden', 'suspender mi cuenta', 'suspenden la cuenta', 'me bloquearon', 'cuenta bloqueada', 'me banearon', 'mi cuenta esta bloqueada'],
    strong: ['suspendida', 'suspendido', 'suspenden', 'suspendieron'],
    answer: () => 'Con la cuenta **suspendida** no puedes publicar ni reservar. Escríbele al equipo desde «Contacto» para saber el motivo y qué hacer.',
    chips: [CONTACT],
    cta: '¿Le escribimos al equipo?',
  },
  {
    id: 'privacy',
    phrases: ['mis datos', 'datos personales', 'quien ve mi', 'venden mis datos', 'comparten mis datos', 'quien ve mis'],
    strong: ['privacidad'],
    not: ['tiempo', 'guardan'],
    answer: () =>
      '- Tu teléfono y tus datos de contacto solo los ve la otra persona cuando hay una **reserva confirmada**.\n- Tus documentos de identidad solo los ve el equipo que verifica.\nEl detalle está en la Política de privacidad.',
    chips: [go('Política de privacidad', '/terminos#politica-de-privacidad')],
    cta: '¿Abrimos la Política de privacidad?',
  },
  {
    id: 'cookies',
    phrases: [],
    strong: ['cookies', 'cookie'],
    answer: () => 'En Términos y políticas → Cookies eliges qué guarda AutoMarket en tu navegador. Las necesarias siempre están activas; las de preferencias y medición, como tú decidas.',
    chips: [go('Cookies', '/terminos#cookies')],
    cta: '¿Abrimos la configuración de cookies?',
  },
  {
    id: 'terms',
    phrases: ['terminos y condiciones', 'reglas de la pagina', 'politicas de automarket', 'normas de la pagina'],
    strong: ['terminos', 'condiciones', 'politicas'],
    answer: () => 'Están en Términos y políticas, con un buscador:\n- Términos y condiciones.\n- Privacidad y cookies.\n- Pagos y reembolsos.\n- Reglas para anuncios.\n- Compra segura.',
    chips: [go('Términos y políticas', '/terminos')],
    cta: '¿Abrimos Términos y políticas?',
  },
  {
    id: 'pay-how',
    phrases: ['como pago', 'como pagar', 'pagar con binance', 'pago con binance', 'pay id', 'binance pay', 'metodos de pago', 'metodo de pago', 'formas de pago', 'forma de pago', 'en efectivo', 'con tarjeta', 'pago movil'],
    strong: ['binance', 'usdt', 'zelle', 'paypal', 'efectivo', 'tarjeta'],
    not: ['abono'],
    withModel: true,
    answer: () =>
      'Los **planes**, los **destacados** y las **comisiones** se pagan con Binance en USDT:\n- **Binance Pay**: pagas desde la app de Binance y se confirma solo.\n- **Pay ID**: transfieres a nuestro Pay ID y el equipo lo confirma a mano con el ID de la transacción.\nNo se paga con tarjeta ni en efectivo. El **abono de una reserva** es distinto: se lo pagas directo al vendedor.',
    chips: [say('¿Qué planes hay?'), say('¿Cuánto cobran de comisión?')],
    cta: '¿Te muestro los planes?',
  },
  {
    id: 'pay-problem',
    phrases: ['reembolso del plan', 'reembolso de mi plan', 'devolucion del plan', 'me cobraron', 'pague y no', 'pago no aparece', 'pago pendiente', 'no se activo mi plan', 'no aparece mi pago', 'cobro doble', 'cobraron dos veces', 'por verificar'],
    answer: () =>
      'Si pagaste al Pay ID de Binance, el equipo confirma el pago a mano con el ID de la transacción; mientras tanto, el pago aparece como **Por verificar**.\nSi algo no cuadra o necesitas un reembolso, escríbele al equipo desde «Contacto» con ese ID. Cuándo se devuelve un pago está en «Pagos y reembolsos».',
    chips: [CONTACT, go('Pagos y reembolsos', '/terminos#pagos-y-reembolsos')],
    cta: '¿Le escribimos al equipo?',
  },
  {
    id: 'currency',
    phrases: ['en bolivares', 'en pesos', 'otra moneda', 'que moneda', 'en que moneda', 'otros paises', 'en que paises', 'fuera de venezuela', 'funciona en'],
    strong: ['bolivares', 'moneda'],
    answer: () => 'Los precios en AutoMarket van en **dólares (USD)**, en todos los países. Publicas y buscas en tu país y tu ciudad.',
  },
  {
    id: 'theme',
    phrases: ['modo oscuro', 'tema oscuro', 'modo claro', 'pantalla oscura', 'fondo negro'],
    answer: () => 'Toca el botón de la luna (o del sol), arriba, para cambiar entre modo claro y oscuro.',
  },
  {
    id: 'app',
    phrases: ['descargar la app', 'app movil', 'play store', 'app store', 'tienen app', 'hay app', 'instalar la app'],
    strong: ['aplicacion'],
    answer: () => 'AutoMarket funciona desde el navegador, también en el teléfono: no hace falta instalar nada.',
  },
  {
    id: 'about',
    phrases: ['que es automarket', 'como funciona automarket', 'como funciona la pagina', 'como funciona esto', 'para que sirve automarket', 'quienes son'],
    answer: ({ plans }) => {
      const free = plans.find(plan => plan.code === 'FREE');
      return `AutoMarket es un mercado de autos entre personas y concesionarios con la **identidad verificada**:\n1. Buscas el auto y hablas con el vendedor por el chat.\n2. Lo reservas con un abono que le pagas **directo al vendedor**.\n3. Cierras la compra con él.\nComprar no cuesta nada; el vendedor paga una comisión cuando vende${free ? ` (con ${free.name}, **${pct(free.commissionRate)}**)` : ''}.`;
    },
    chips: [say('¿Cómo funciona la reserva?'), say('¿Qué planes hay?')],
    cta: '¿Te explico cómo funciona la reserva?',
  },
  {
    id: 'buyer-cost',
    phrases: ['el comprador paga', 'cobran al comprador', 'cuanto paga el comprador', 'cuesta comprar', 'es gratis comprar', 'tengo que pagar para comprar', 'cobran por comprar'],
    answer: () => 'Comprar en AutoMarket **no tiene costo**: al comprador no le cobramos nada. El abono de la reserva se lo pagas al vendedor y se descuenta del precio.',
    chips: [say('¿A quién le pago el abono?')],
    cta: '¿Te explico cómo se paga el abono?',
  },
  {
    id: 'meet',
    withModel: true,
    phrases: ['ver el auto en persona', 'donde nos vemos', 'reunirme con el vendedor', 'me reuno', 'lugar seguro', 'ir a ver el auto', 'ir a ver el carro', 'cita con el vendedor', 'reunion con el vendedor'],
    strong: ['encuentro', 'reuno', 'reunirme', 'reunirnos'],
    answer: () => 'Para ver el auto en persona:\n1. Queda de día, en un lugar público y con gente.\n2. Ve acompañado.\n3. No lleves el dinero completo.\n4. Antes de pagar, que lo revise un mecánico de confianza.',
    chips: [say('¿Qué reviso antes de comprar?'), say('¿Cómo es el traspaso?')],
    cta: '¿Te digo qué revisar antes de comprar?',
  },
  {
    id: 'advance',
    withModel: true,
    phrases: ['me pide dinero', 'me pidio dinero', 'me pidio un deposito', 'pagar por adelantado', 'transferencia antes', 'me pidio pagar', 'pago adelantado', 'me pide un adelanto'],
    answer: () =>
      'No pagues nada fuera de la reserva antes de ver el auto. Lo único que se paga antes es el **abono de una reserva confirmada** en AutoMarket, y se descuenta del precio.\nSi alguien te pide otra cosa, denúncialo desde el chat o desde el anuncio.',
    chips: [say('¿Cómo funciona la reserva?')],
    cta: '¿Te explico cómo funciona la reserva?',
  },
  {
    id: 'insurance',
    withModel: true,
    phrases: ['seguro del auto', 'seguro del carro', 'asegurar el auto', 'asegurar el carro', 'seguro para el carro', 'seguro para el auto', 'necesito seguro', 'necesito un seguro', 'sacar un seguro', 'seguro de auto', 'seguro de carro'],
    strong: ['poliza', 'aseguradora'],
    answer: () => 'AutoMarket no vende seguros. Pide una cotización a una aseguradora con la marca, el modelo, el año y el serial antes de cerrar la compra; algunas piden revisar el auto.',
  },
  {
    id: 'stolen',
    withModel: true,
    phrases: ['es robado', 'esta solicitado', 'problemas legales', 'reporte de robo', 'esta limpio', 'auto robado', 'carro robado'],
    answer: () =>
      'Antes de pagar:\n1. Pide el título.\n2. Revisa que los seriales de carrocería y motor coincidan con él.\n3. Consulta el estado del vehículo con las autoridades de tránsito de tu país (en Venezuela, el INTT) o con un gestor.',
    chips: [say('¿Cómo es el traspaso?')],
    cta: '¿Te explico cómo es el traspaso?',
  },
  {
    id: 'maintenance',
    withModel: true,
    phrases: ['cada cuanto cambio el aceite', 'cambio de aceite', 'cambiar el aceite'],
    strong: ['mantenimiento'],
    answer: () => 'Sigue el manual del auto: casi todos piden aceite y filtro cada **5.000 a 10.000 km**, según el aceite. Si compras usado, pide las facturas y haz un mantenimiento general al comprarlo.',
    chips: [say('¿Qué reviso antes de comprar?')],
    cta: '¿Te digo qué revisar antes de comprar?',
  },
  {
    id: 'photos',
    phrases: ['que fotos', 'cuantas fotos', 'fotos permitidas', 'fotos no se permiten', 'reglas de las fotos', 'subir fotos', 'fotos del anuncio', 'subir un video', 'subir videos', 'tamano de las fotos'],
    answer: () =>
      `Sube hasta **${MAX_VEHICLE_MEDIA}** fotos o vídeos del auto real:\n- Fotos JPG, PNG o WebP de hasta **10 MB**.\n- Vídeos MP4, WebM o MOV de hasta **200 MB**.\n- Sin fotos de internet, textos encima ni datos de contacto en la imagen.\nLa primera foto es la portada del anuncio.`,
    chips: [go('Reglas para anuncios', '/terminos#reglas-para-anuncios')],
    cta: '¿Abrimos las reglas para anuncios?',
  },
  {
    id: 'damaged',
    phrases: ['auto chocado', 'carro chocado', 'auto con fallas', 'carro con fallas', 'auto danado', 'carro danado', 'necesita reparacion', 'para repuestos'],
    withModel: true,
    answer: () =>
      'Sí, siempre que los datos sean exactos: di en la descripción qué tiene y muéstralo en las fotos. El precio, el kilometraje, los dueños y el estado tienen que ser los reales; si no, el anuncio se puede retirar.',
    chips: [go('Reglas para anuncios', '/terminos#reglas-para-anuncios'), say('¿A cuánto vendo mi auto?')],
    cta: '¿Abrimos las reglas para anuncios?',
  },
  {
    id: 'after-sale',
    phrases: ['salio malo', 'me estafaron', 'me enganaron', 'me vendieron', 'el vendedor me engano', 'problema con el auto que compre', 'el auto que compre', 'el carro que compre', 'garantia'],
    strong: ['estafa', 'estafaron', 'garantia'],
    answer: () =>
      'AutoMarket no vende los autos ni da garantía: la compra es entre tú y el vendedor, y los precios del Copiloto son una referencia. Si el vendedor te engañó:\n1. Denúncialo desde el chat o desde su perfil.\n2. Escríbele al equipo con los detalles.\n3. Si hubo una estafa, haz también la denuncia ante las autoridades.',
    chips: [CONTACT, go('Compra segura', '/terminos#compra-segura')],
    cta: '¿Le escribimos al equipo?',
  },
  {
    id: 'fines',
    phrases: ['tiene multas', 'con multas', 'pagar las multas', 'solvencia de multas'],
    strong: ['multa', 'multas'],
    withModel: true,
    answer: () =>
      'Pídele al vendedor la **solvencia de multas** antes de pagar: las multas son de quien era el dueño cuando se pusieron y, por lo general, el traspaso la pide. Confírmalo con el organismo de tránsito de tu país (en Venezuela, el INTT) o con un gestor.',
    chips: [say('¿Cómo es el traspaso?')],
    cta: '¿Te explico cómo es el traspaso?',
  },
  {
    id: 'kinds',
    phrases: ['vender motos', 'vender una moto', 'publicar una moto', 'vender un camion', 'publicar un camion', 'hay motos', 'venden motos'],
    strong: ['moto', 'motos', 'motocicleta', 'camion', 'camiones', 'lancha', 'gandola'],
    answer: () => 'AutoMarket es para autos: sedanes, camionetas, pickups, compactos, deportivos, convertibles y eléctricos. Motos, camiones y otros vehículos **no se pueden publicar** por ahora.',
  },
  {
    id: 'self',
    phrases: ['quien eres', 'que eres', 'eres un robot', 'eres humano', 'con quien hablo', 'que puedes hacer', 'que sabes hacer', 'en que me ayudas', 'otras dudas'],
    answer: () =>
      'Soy el Copiloto de AutoMarket. Respondo con los anuncios publicados y con las reglas de la página:\n- Busco autos y reviso si un precio es justo.\n- Te explico tu cuenta, la verificación, las reservas, los pagos y cómo publicar.\nSi algo no lo sé, te digo cómo hablar con el equipo.',
    chips: [say('¿Cómo verifico mi identidad?'), say('¿Cómo guardo un auto?'), say('¿Cómo destaco mi auto?'), say('¿Cómo hablo con el equipo?')],
    cta: 'Elige una opción o escribe tu duda.',
  },
];

/** Texto sin acentos ni signos, con espacios a los lados (para buscar frases enteras). */
const clean = (value: string) => ` ${normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim()} `;

function scoreOf(topic: Topic, q: string, tokens: string[]): number {
  if (topic.not?.some(word => tokens.includes(word))) return 0;
  let score = 0;
  for (const phrase of topic.phrases) if (q.includes(` ${phrase} `)) score += 3;
  const has = (word: string) => (word.endsWith('*') ? tokens.some(token => token.startsWith(word.slice(0, -1))) : tokens.includes(word));
  for (const word of topic.strong ?? []) if (has(word)) score += 3;
  for (const word of topic.weak ?? []) if (has(word)) score += 1;
  return score;
}

/** El tema de ayuda que mejor encaja con la pregunta (o null si ninguno llega a 3 puntos). */
export function matchHelp(question: string, namesModel = false): Topic | null {
  const q = clean(question);
  const tokens = q.trim().split(' ');
  let best: { topic: Topic; score: number } | null = null;
  for (const topic of TOPICS) {
    if (namesModel && !topic.withModel) continue;
    const score = scoreOf(topic, q, tokens);
    if (score >= 3 && (!best || score > best.score)) best = { topic, score };
  }
  return best?.topic ?? null;
}

/**
 * Respuesta de un tema. Si el tema no tiene una acción propia, cierra con `fallbackCta` (cada
 * Copiloto pasa la suya: buscar autos en el del comprador, preguntar por un auto en el de agencias).
 */
export const helpAnswer = (topic: Topic, facts: HelpFacts, fallbackCta?: string): HelpAnswer => ({
  text: topic.answer(facts),
  chips: topic.chips ?? [],
  cta: topic.cta ?? (topic.chips?.length ? null : (fallbackCta ?? null)),
});

const STOP = new Set(
  ('a al algo alguien algun alguna como con cual cuales cuando cuanto cuantos de del donde el ella en era es esa ese eso esta este esto estoy hay hace la las le les lo los me mi mis muy no nos o otra otro para pero por porque puedo puede que quien se ser si sin sobre su sus tambien te tengo ti tiene tu tus un una uno unos y ya yo ' +
    'automarket pagina auto autos carro carros vehiculo vehiculos pasa pasar hacer quiero saber necesito tienen pueden deben debo esto cosa cosas favor gracias hola').split(' '),
);

/**
 * Sin tema que encaje: busca la sección de los Términos y políticas publicados que más palabras de
 * la pregunta comparte (las palabras raras pesan más). Responde con su primer párrafo y el enlace.
 */
export function searchTerms(question: string, content: string | null): HelpAnswer | null {
  const words = [...new Set(clean(question).trim().split(' ').filter(word => word.length >= 4 && !STOP.has(word)))];
  if (!words.length) return null;
  const docs = parseLegalDocs(content ?? DEFAULT_TERMS);
  const sections = docs.flatMap(doc => doc.sections.map(section => ({ doc, section, tokens: clean([section.heading, ...section.blocks.map(block => block.text)].join(' ')).trim().split(' ') })));
  if (!sections.length) return null;
  // Raíz de 5 letras: «devolucion» encuentra «devolvemos», «reembolsos» encuentra «reembolso».
  const stem = (word: string) => word.slice(0, Math.min(word.length, 5));
  const df = new Map(words.map(word => [word, sections.filter(s => s.tokens.some(token => token.startsWith(stem(word)))).length]));
  let best: { s: (typeof sections)[number]; score: number; hits: number } | null = null;
  for (const s of sections) {
    let score = 0;
    let hits = 0;
    let rare = false;
    const heading = clean(s.section.heading).trim().split(' ');
    for (const word of words) {
      const n = df.get(word) ?? 0;
      if (!n || !s.tokens.some(token => token.startsWith(stem(word)))) continue;
      hits += 1;
      rare ||= n <= 3;
      score += Math.log(1 + sections.length / n) + (heading.some(token => token.startsWith(stem(word))) ? 1.5 : 0);
    }
    // Vale con dos palabras de la pregunta, o con una poco común (que sale en 3 secciones o menos).
    if ((hits >= 2 || (hits === 1 && rare)) && (!best || score > best.score)) best = { s, score, hits };
  }
  if (!best) return null;
  const { doc, section } = best.s;
  const body = section.blocks.map(block => block.text.replace(/\*\*/g, '')).join(' ');
  const excerpt = body.length > 420 ? `${body.slice(0, body.lastIndexOf(' ', 400))}…` : body;
  return {
    text: `En «${doc.title}», sección «${section.heading}»:\n${excerpt}`,
    chips: [{ label: `Leer «${doc.title}»`, href: `/terminos#${doc.key}` }, CONTACT],
    cta: `¿Abrimos «${doc.title}» completo?`,
  };
}

/** Si no hay tema ni sección que encaje: decirlo y ofrecer al equipo. */
export const helpFallback = (): HelpAnswer => ({
  text: 'Eso no lo sé responder. Te ayudo con:\n- Autos publicados y precios.\n- Tu cuenta y la verificación.\n- Reservas, pagos y cómo publicar.\nSi es otra cosa, escríbele al equipo desde «Contacto».',
  chips: [CONTACT],
  cta: '¿Le escribimos al equipo?',
});

/** Normaliza para comparar una frase con lo que se preguntó (evitar repetir el chip). */
export const sameQuestion = (a: string, b: string) => normalizeSearch(a).replace(/[¿?¡!.]/g, '').trim() === normalizeSearch(b).replace(/[¿?¡!.]/g, '').trim();
