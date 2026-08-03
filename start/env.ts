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
  /** Debe coincidir con el claim `iss`. Un token de otro emisor se rechaza. */
  SSO_ISSUER: Env.schema.string({ format: 'url' }),
  /** Claim `aud`. Un token emitido para otro destinatario no sirve aquí. */
  SSO_AUDIENCE: Env.schema.string(),

  // ---------------------------------------------------------------- MQTT (VPS 4)
  MQTT_URL: Env.schema.string(),
  MQTT_USERNAME: Env.schema.string.optional(),
  MQTT_PASSWORD: Env.schema.string.optional(),
})
