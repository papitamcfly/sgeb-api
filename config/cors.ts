import { defineConfig } from '@adonisjs/cors'
import env from '#start/env'

/**
 * Configuration options to tweak the CORS policy. The following
 * options are documented on the official documentation website.
 *
 * https://docs.adonisjs.com/guides/security/cors
 */
const corsConfig = defineConfig({
  /**
   * Enable or disable CORS handling globally.
   */
  enabled: true,

  /**
   * Lista blanca explícita, desde `CORS_ORIGIN` (separada por comas).
   *
   * No se usa `true` ni siquiera en desarrollo: con `credentials: true`, un
   * origen comodín permitiría que cualquier página abierta en el navegador del
   * capitán hiciera peticiones autenticadas contra el API usando sus cookies.
   * El navegador de una persona que desarrolla tiene decenas de pestañas.
   *
   * Sin barra final: el navegador compara el origen exacto y
   * `https://sgeb.mediocres.mx/` no coincide con `https://sgeb.mediocres.mx`.
   */
  origin: env
    .get('CORS_ORIGIN', '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),

  /**
   * HTTP methods accepted for cross-origin requests.
   */
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],

  /**
   * Reflect request headers by default. Use a string array to restrict
   * allowed headers.
   */
  headers: true,

  /**
   * Response headers exposed to the browser.
   */
  exposeHeaders: [],

  /**
   * Allow cookies/authorization headers on cross-origin requests.
   */
  credentials: true,

  /**
   * Cache CORS preflight response for N seconds.
   */
  maxAge: 90,
})

export default corsConfig
