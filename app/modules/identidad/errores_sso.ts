import { Exception } from '@adonisjs/core/exceptions'

/**
 * Catálogo de códigos SSO — traducción a código de `diccionario-errores-sso.md` v2.1.
 *
 * Mismas reglas de gobernanza que el catálogo SGEB: un código nunca cambia de
 * significado y los retirados no se reciclan.
 *
 * `oauth` es el valor del campo `error` que exige la especificación cuando el
 * fallo ocurre en un endpoint de protocolo. Los endpoints de protocolo NO usan
 * el envelope: responden `{ error, error_description, sso_code }`, y `sso_code`
 * es la extensión propia que permite rastrear el fallo hasta este diccionario
 * sin romper la compatibilidad con librerías estándar.
 */

export type ErrorOAuth =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'login_required'
  | 'server_error'
  | 'temporarily_unavailable'

export interface DefinicionSso {
  http: number
  mensaje: string
  oauth?: ErrorOAuth
}

export const CODIGOS_SSO = {
  // ---------------------------------------------------------------- 0xxx
  'SSO-0000': { http: 200, mensaje: 'Operación realizada correctamente.' },
  'SSO-0001': { http: 201, mensaje: 'Registro creado correctamente.' },
  /**
   * Respuesta idéntica exista o no el correo. Distinguirlas convertiría el
   * endpoint de recuperación en un oráculo para enumerar cuentas.
   */
  'SSO-0002': {
    http: 200,
    mensaje: 'Si el correo está registrado, te enviamos un enlace. Revisa tu bandeja.',
  },

  // ---------------------------------------------------------------- 1xxx
  'SSO-1001': {
    http: 401,
    mensaje: 'Correo o contraseña incorrectos. Verifica tus datos.',
    oauth: 'invalid_grant',
  },
  'SSO-1002': { http: 401, mensaje: 'Tu sesión ha expirado. Vuelve a iniciar sesión.' },
  'SSO-1003': { http: 401, mensaje: 'No pudimos validar tu sesión. Inicia sesión nuevamente.' },
  'SSO-1004': { http: 403, mensaje: 'No tienes permisos para realizar esta acción.' },
  'SSO-1005': {
    http: 403,
    mensaje: 'Tu cuenta está desactivada. Contacta a tu capitán.',
    oauth: 'access_denied',
  },
  'SSO-1006': {
    http: 401,
    mensaje: 'Tu sesión ya no es válida. Inicia sesión nuevamente.',
    oauth: 'invalid_grant',
  },
  'SSO-1007': {
    http: 401,
    mensaje: 'Por tu seguridad cerramos todas tus sesiones. Inicia sesión de nuevo.',
    oauth: 'invalid_grant',
  },
  'SSO-1008': { http: 429, mensaje: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
  'SSO-1009': { http: 401, mensaje: 'El código no es correcto. Verifica e inténtalo de nuevo.' },
  'SSO-1010': { http: 410, mensaje: 'El código ya no es válido. Solicita uno nuevo.' },
  'SSO-1011': { http: 429, mensaje: 'Espera un momento antes de pedir otro código.' },
  'SSO-1012': { http: 401, mensaje: 'Tu proceso de verificación expiró. Inicia sesión nuevamente.' },
  'SSO-1014': { http: 401, mensaje: 'Este equipo ya no es de confianza. Completa la verificación.' },

  /**
   * SSO-1015 y SSO-1016 comparten mensaje a propósito. Un código ya canjeado
   * sugiere intercepción; un PKCE fallido suele ser un bug del cliente.
   * Distinguirlos en pantalla le diría al atacante en qué punto falló su
   * intento. La diferencia vive completa en `technical_message`.
   */
  'SSO-1015': {
    http: 400,
    mensaje: 'No pudimos completar el inicio de sesión. Vuelve a intentarlo.',
    oauth: 'invalid_grant',
  },
  'SSO-1016': {
    http: 400,
    mensaje: 'No pudimos completar el inicio de sesión. Vuelve a intentarlo.',
    oauth: 'invalid_grant',
  },
  'SSO-1017': { http: 400, mensaje: 'Tu sesión de inicio expiró. Vuelve a empezar.' },

  // ---------------------------------------------------------------- 2xxx
  'SSO-2001': {
    http: 400,
    mensaje: 'Faltan datos obligatorios. Completa los campos marcados.',
    oauth: 'invalid_request',
  },
  'SSO-2002': {
    http: 400,
    mensaje: 'Revisa los datos capturados: hay campos con formato incorrecto.',
    oauth: 'invalid_request',
  },
  'SSO-2003': { http: 400, mensaje: 'El texto capturado es demasiado corto o demasiado largo.' },
  'SSO-2004': { http: 400, mensaje: 'El valor seleccionado no es válido.', oauth: 'invalid_scope' },
  'SSO-2005': {
    http: 409,
    mensaje: 'Ese correo ya está registrado. Intenta iniciar sesión o recupera tu contraseña.',
  },
  'SSO-2006': {
    http: 400,
    mensaje: 'La contraseña debe tener al menos 8 caracteres, con una mayúscula y un número.',
  },
  'SSO-2007': { http: 400, mensaje: 'Las contraseñas no coinciden.' },

  // ---------------------------------------------------------------- 3xxx
  'SSO-3001': { http: 404, mensaje: 'No encontramos la información solicitada.' },
  'SSO-3002': { http: 410, mensaje: 'Esta invitación ya no es válida. Pide a tu capitán una nueva.' },
  'SSO-3003': {
    http: 410,
    mensaje: 'Este enlace ya no es válido. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".',
  },

  // ---------------------------------------------------------------- 4xxx
  'SSO-4001': { http: 409, mensaje: 'Ya existe una invitación pendiente para ese correo.' },
  'SSO-4002': {
    http: 429,
    mensaje: 'Ya enviamos un enlace recientemente. Revisa tu correo o espera unos minutos.',
  },
  'SSO-4005': { http: 400, mensaje: 'Debes aceptar el aviso de privacidad para continuar.' },
  /**
   * SSO-4006 y SSO-4007 NUNCA redirigen: se renderiza una página de error. Con
   * un cliente o una URL de retorno no verificados, redirigir convertiría al
   * proveedor en un redirector abierto, que es justo el ataque que la lista
   * blanca previene.
   */
  'SSO-4006': {
    http: 400,
    mensaje: 'No pudimos identificar la aplicación que solicita el acceso.',
    oauth: 'invalid_client',
  },
  'SSO-4007': {
    http: 400,
    mensaje: 'La dirección de retorno no está autorizada para esta aplicación.',
    oauth: 'invalid_request',
  },

  // ---------------------------------------------------------------- 5xxx
  /**
   * reCAPTCHA rechazado. NO se dice la puntuación al usuario: revelarla le
   * diría al atacante qué tan cerca está del umbral.
   */
  'SSO-4008': {
    http: 403,
    mensaje: 'No pudimos verificar que eres una persona. Recarga la página e inténtalo de nuevo.',
    oauth: 'access_denied',
  },
  /**
   * Límite de peticiones por IP. Cubre el ataque distribuido sobre muchas
   * cuentas, que nunca dispara el bloqueo por cuenta.
   */
  'SSO-4009': {
    http: 429,
    mensaje: 'Demasiadas solicitudes desde esta conexión. Espera unos minutos.',
    oauth: 'temporarily_unavailable',
  },
  'SSO-5001': {
    http: 500,
    mensaje: 'Ocurrió un problema inesperado. Intenta de nuevo en unos minutos.',
    oauth: 'server_error',
  },
  'SSO-5002': { http: 500, mensaje: 'No pudimos procesar tu solicitud. Intenta de nuevo.' },
  'SSO-5003': { http: 502, mensaje: 'No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.' },
  'SSO-5004': {
    http: 503,
    mensaje: 'El sistema está en mantenimiento. Vuelve a intentarlo más tarde.',
    oauth: 'temporarily_unavailable',
  },
} as const satisfies Record<string, DefinicionSso>

export type CodigoSSO = keyof typeof CODIGOS_SSO

/**
 * Retirados en la v2.1 al eliminar el login biométrico. No se reciclan.
 */
export const RETIRADOS_SSO = {
  'SSO-1013': 'SGEB-4004',
  'SSO-4003': '—',
  'SSO-4004': 'SGEB-4024 / SGEB-4025',
} as const

export class SsoError extends Exception {
  readonly codigo: CodigoSSO
  readonly tecnico?: string
  readonly httpStatus: number
  readonly oauth?: ErrorOAuth

  constructor(
    codigo: CodigoSSO,
    opciones: { tecnico?: string; causa?: unknown } = {}
  ) {
    const def = CODIGOS_SSO[codigo] as DefinicionSso
    super(def.mensaje, { status: def.http, code: codigo, cause: opciones.causa })
    this.codigo = codigo
    this.tecnico = opciones.tecnico
    this.httpStatus = def.http
    this.oauth = def.oauth
  }

  /** Formato de la especificación, para los endpoints de protocolo. */
  aOAuth() {
    return {
      error: this.oauth ?? 'invalid_request',
      error_description: this.message,
      sso_code: this.codigo,
    }
  }
}
