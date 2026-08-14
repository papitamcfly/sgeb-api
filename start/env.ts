import { Env } from '@adonisjs/core/env'

/**
 * Validación de variables de entorno.
 *
 * Falla al arrancar, no en la primera petición. Un servidor que levanta sin
 * `SSO_JWKS_URL` funciona hasta que alguien intenta autenticarse, y entonces
 * el síntoma aparece lejos de la causa.
 */
export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const),

  // ---------------------------------------------------------------- PostgreSQL (VPS 3)
  // El host es la IP de WireGuard, no la pública: la base nunca se expone a
  // Internet (Documento de Arquitectura de Infraestructura v0.4, §3.2).
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string(),
  DB_DATABASE: Env.schema.string(),

  // ---------------------------------------------------------------- Identidad (SSO)
  /**
   * Documento de llaves públicas. La API valida firmas contra esto y NUNCA con
   * un secreto compartido: si compartiera secreto con el proveedor, estarían
   * acoplados aunque las carpetas estén separadas, y la extracción del módulo
   * dejaría de ser posible sin tocar ambos lados.
   */
  SSO_JWKS_URL: Env.schema.string({ format: 'url' }),
  /**
   * `local` mientras el proveedor comparta proceso con la API; `remoto` tras la
   * extracción. Solo cambia el transporte de las llaves: la validación (firma,
   * emisor, audiencia, algoritmo) es idéntica en ambos modos.
   */
  SSO_JWKS_MODE: Env.schema.enum(['local', 'remoto'] as const),

  /**
   * Orígenes autorizados para abrir un socket, separados por coma. Un `*` aquí
   * dejaría que cualquier página abriera un canal con el token de la víctima si
   * lograra leerlo.
   */
  SOCKET_CORS_ORIGIN: Env.schema.string(),

  /**
   * Orígenes autorizados del API y del proveedor, separados por coma y **sin
   * barra final**: el navegador compara el origen exacto.
   */
  CORS_ORIGIN: Env.schema.string(),

  /*
  |----------------------------------------------------------------------------
  | Correo saliente (Mailtrap por SMTP)
  |----------------------------------------------------------------------------
  |
  | `CORREO_MODO` decide el transporte:
  |   log      escribe el mensaje en el log. Desarrollo y pruebas
  |   mailtrap envía por SMTP
  |
  | La validación es la misma en ambos modos: el servicio arma el mensaje igual
  | y solo cambia a dónde va. Así el flujo que se prueba en desarrollo es el
  | mismo que corre en producción.
  */
  CORREO_MODO: Env.schema.enum(['log', 'mailtrap'] as const),
  MAIL_HOST: Env.schema.string.optional(),
  MAIL_PORT: Env.schema.string.optional(),
  MAIL_USERNAME: Env.schema.string.optional(),
  MAIL_PASSWORD: Env.schema.string.optional(),
  MAIL_FROM_ADDRESS: Env.schema.string.optional(),
  MAIL_FROM_NAME: Env.schema.string.optional(),

  /** Base de los enlaces que viajan por correo (invitación, recuperación). */
  APP_URL_PROVEEDOR: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------------------------
  | Notificaciones push (Firebase Cloud Messaging)
  |----------------------------------------------------------------------------
  |
  | `PUSH_MODO`: `log` o `firebase`.
  |
  | Las tres variables de Firebase son los campos del archivo de cuenta de
  | servicio. Se pasan sueltas y no como JSON completo para no tener que
  | versionar ni montar un archivo con credenciales en el servidor.
  |
  | FIREBASE_PRIVATE_KEY lleva saltos de línea escapados (\n): el servicio los
  | restituye al leerla, porque una variable de entorno no admite saltos reales.
  */
  PUSH_MODO: Env.schema.enum(['log', 'firebase'] as const),
  FIREBASE_PROJECT_ID: Env.schema.string.optional(),
  FIREBASE_CLIENT_EMAIL: Env.schema.string.optional(),
  FIREBASE_PRIVATE_KEY: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------------------------
  | Almacenamiento de archivos (Supabase Storage, API compatible con S3)
  |----------------------------------------------------------------------------
  |
  | `ALMACEN_MODO`: `local` (disco, solo desarrollo) o `s3`.
  |
  | El bucket debe ser PRIVADO. El archivo se sirve solo por URL firmada de 15
  | minutos: una clave adivinable dejaría ver la comanda de cualquier evento.
  |
  | S3_ENDPOINT de Supabase:
  |   https://<proyecto>.storage.supabase.co/storage/v1/s3
  */
  ALMACEN_MODO: Env.schema.enum(['local', 's3'] as const),
  S3_ENDPOINT: Env.schema.string.optional(),
  S3_REGION: Env.schema.string.optional(),
  S3_BUCKET: Env.schema.string.optional(),
  S3_ACCESS_KEY_ID: Env.schema.string.optional(),
  S3_SECRET_ACCESS_KEY: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------------------------
  | reCAPTCHA v3
  |----------------------------------------------------------------------------
  |
  | `CAPTCHA_MODO`: `log` (acepta cualquier token, para desarrollo) o `recaptcha`.
  |
  | v3 y no v2 a propósito: v2 muestra el desafío de las imágenes, y el usuario
  | típico aquí es un mesero capturando su contraseña en el estacionamiento del
  | salón, con una mano y con prisa. Un desafío visual ahí no protege, expulsa.
  |
  | El umbral por defecto es 0.5. Subirlo empieza a tirar usuarios legítimos
  | —extensiones de privacidad, redes compartidas, modo incógnito— y aquí un
  | falso positivo es un mesero que no puede entrar a trabajar.
  */
  CAPTCHA_MODO: Env.schema.enum(['log', 'recaptcha'] as const),
  RECAPTCHA_SITE_KEY: Env.schema.string.optional(),
  RECAPTCHA_SECRET_KEY: Env.schema.string.optional(),
  RECAPTCHA_UMBRAL: Env.schema.string.optional(),
  /** Debe coincidir con el claim `iss`. Un token de otro emisor se rechaza. */
  SSO_ISSUER: Env.schema.string({ format: 'url' }),
  /** Claim `aud`. Un token emitido para otro destinatario no sirve aquí. */
  SSO_AUDIENCE: Env.schema.string(),
  /**
   * Llave maestra AES-256-GCM (32 bytes en hex) que cifra las llaves privadas
   * de firma en reposo. Vive FUERA de la base de datos: si estuviera dentro, un
   * volcado bastaría para firmar tokens arbitrarios.
   *   Generar con: openssl rand -hex 32
   */
  SSO_MASTER_KEY: Env.schema.string(),

  // ---------------------------------------------------------------- MQTT (VPS 4)
  MQTT_URL: Env.schema.string(),
  MQTT_USERNAME: Env.schema.string.optional(),
  MQTT_PASSWORD: Env.schema.string.optional(),
})
