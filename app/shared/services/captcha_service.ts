import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import { SsoError } from '#modules/identidad/errores_sso'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  reCAPTCHA v3 — señal de riesgo, NO un muro
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Qué protege y qué no, para no confiar de más:
 *
 *  · **Sí** encarece el ataque automatizado desde navegador: relleno de
 *    credenciales, enumeración de correos, spam de recuperación.
 *  · **No** detiene a quien llama al endpoint con `curl` desde un servidor.
 *    reCAPTCHA v3 puntúa el comportamiento del navegador; sin navegador no hay
 *    señal, y el atacante simplemente omite el token.
 *
 * Por eso el token es **obligatorio** en las rutas protegidas: si fuera
 * opcional, saltárselo sería tan fácil como no enviarlo, y la defensa no
 * existiría. Y por eso reCAPTCHA acompaña a las otras defensas —bloqueo por
 * cuenta, límite por IP, respuestas indistinguibles— en vez de sustituirlas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  POR QUÉ v3 Y NO v2
 * ────────────────────────────────────────────────────────────────────────────
 * v2 muestra el desafío de las imágenes. Aquí el usuario típico es un mesero
 * capturando su contraseña en el estacionamiento del salón, con una mano y con
 * prisa: un desafío visual ahí no protege, expulsa.
 *
 * v3 puntúa en silencio de 0.0 a 1.0 y deja que el servidor decida.
 */

/**
 * Umbral por defecto. Google sugiere 0.5 como punto de partida.
 *
 * Se elige **0.5 y no más alto** a propósito: por encima empiezan a caer
 * usuarios legítimos —navegadores con extensiones de privacidad, redes
 * compartidas, modo incógnito— y en este sistema un falso positivo significa un
 * mesero que no puede entrar a trabajar. El bloqueo por cuenta y el límite por
 * IP cubren lo que la puntuación deja pasar.
 */
const UMBRAL_DEFECTO = 0.5

const URL_VERIFICACION = 'https://www.google.com/recaptcha/api/siteverify'

/** Segundos antes de darse por vencido con Google. */
const TIMEOUT_MS = 4000

export interface ResultadoCaptcha {
  exito: boolean
  puntuacion: number | null
  accion: string | null
  motivo?: string
}

/**
 * Clase abstracta, mismo patrón que correo y almacenamiento: `CAPTCHA_MODO`
 * decide cuál se inyecta, y las pruebas pueden intercambiarla sin red.
 */
export abstract class CaptchaService {
  abstract verificar(token: string, accionEsperada: string, ip?: string | null): Promise<ResultadoCaptcha>

  /**
   * Verifica y lanza si no pasa. Es lo que llaman los controladores.
   *
   * El error es SSO-4008 y **no dice la puntuación al usuario**: revelarla le
   * diría al atacante qué tan cerca está del umbral, que es información para
   * calibrar el siguiente intento.
   */
  /** Cada implementación decide si un token ausente es aceptable. */
  protected abstract get exigeToken(): boolean

  async exigir(token: string | undefined, accion: string, ip?: string | null): Promise<void> {
    if (!token) {
      /**
       * En producción la ausencia se rechaza: si fuera opcional, saltárselo
       * sería tan fácil como no enviarlo y la defensa no existiría.
       *
       * En modo `log` se acepta, porque las pruebas automatizadas y las
       * herramientas de línea de comandos no ejecutan JavaScript de navegador
       * y no pueden producir un token.
       */
      if (!this.exigeToken) return
      throw new SsoError('SSO-4008', {
        tecnico: `Falta el token de reCAPTCHA en la acción '${accion}'.`,
      })
    }

    const r = await this.verificar(token, accion, ip)
    if (r.exito) return

    throw new SsoError('SSO-4008', {
      tecnico:
        `reCAPTCHA rechazado en '${accion}': ${r.motivo ?? 'sin motivo'}. ` +
        `puntuacion=${r.puntuacion ?? 'n/d'}, accion_recibida=${r.accion ?? 'n/d'}, ip=${ip ?? 'n/d'}.`,
    })
  }
}

/**
 * Modo desarrollo y pruebas: acepta cualquier token no vacío.
 *
 * Existe porque sin él no habría forma de recorrer el flujo de login al
 * desarrollar, y la alternativa —desactivar la verificación por completo en
 * desarrollo— haría que se probara un camino distinto del que corre en
 * producción, que es justo donde aparecen los errores de cableado.
 */
export class CaptchaLog extends CaptchaService {
  protected get exigeToken() {
    return false
  }

  async verificar(token: string, accion: string): Promise<ResultadoCaptcha> {
    logger.debug({ accion, token: token.slice(0, 12) + '…' }, '[CAPTCHA-LOG] aceptado sin verificar')
    return { exito: true, puntuacion: 0.9, accion }
  }
}

/** Verificación real contra Google. */
export class CaptchaRecaptcha extends CaptchaService {
  protected get exigeToken() {
    return true
  }

  private get umbral(): number {
    const v = Number(env.get('RECAPTCHA_UMBRAL') ?? UMBRAL_DEFECTO)
    return Number.isFinite(v) && v > 0 && v < 1 ? v : UMBRAL_DEFECTO
  }

  async verificar(token: string, accionEsperada: string, ip?: string | null): Promise<ResultadoCaptcha> {
    const secreto = env.get('RECAPTCHA_SECRET_KEY')

    if (!secreto) {
      /**
       * Falta de configuración, no de credenciales del usuario. Se registra
       * como error del servidor y **se deja pasar**: con `CAPTCHA_MODO=recaptcha`
       * y sin llave, bloquear el login dejaría a todo el mundo fuera por un
       * `.env` mal armado. El log lo hace visible para que se corrija.
       */
      logger.error('CAPTCHA_MODO=recaptcha pero falta RECAPTCHA_SECRET_KEY. Verificación omitida.')
      return { exito: true, puntuacion: null, accion: null, motivo: 'sin_secret_key' }
    }

    const cuerpo = new URLSearchParams({ secret: secreto, response: token })
    if (ip) cuerpo.set('remoteip', ip)

    let datos: {
      success?: boolean
      score?: number
      action?: string
      'error-codes'?: string[]
    }

    try {
      const control = AbortSignal.timeout(TIMEOUT_MS)
      const r = await fetch(URL_VERIFICACION, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: cuerpo,
        signal: control,
      })
      datos = (await r.json()) as typeof datos
    } catch (error) {
      /**
       * Google caído o red lenta. **Se deja pasar**, a propósito.
       *
       * Es la decisión difícil de este archivo: fallar cerrado convertiría una
       * caída de un tercero en una caída total del login, y con un evento en
       * curso eso significa meseros que no pueden entrar a trabajar.
       *
       * El riesgo se acota porque las otras defensas siguen activas: el bloqueo
       * por cuenta tras 5 intentos y el límite por IP no dependen de Google.
       */
      logger.error({ err: error }, 'reCAPTCHA no respondió; se omite la verificación')
      return { exito: true, puntuacion: null, accion: null, motivo: 'proveedor_no_disponible' }
    }

    if (!datos.success) {
      return {
        exito: false,
        puntuacion: null,
        accion: null,
        motivo: `token inválido: ${(datos['error-codes'] ?? []).join(', ') || 'sin detalle'}`,
      }
    }

    /**
     * La acción debe coincidir. Sin esta comprobación, un token obtenido en una
     * página pública de bajo riesgo —un formulario de contacto— serviría para
     * pasar el login, que es donde la puntuación importa.
     */
    if (datos.action !== accionEsperada) {
      return {
        exito: false,
        puntuacion: datos.score ?? null,
        accion: datos.action ?? null,
        motivo: `acción no coincide: esperada '${accionEsperada}', recibida '${datos.action}'`,
      }
    }

    const score = datos.score ?? 0
    return {
      exito: score >= this.umbral,
      puntuacion: score,
      accion: datos.action ?? null,
      motivo: score >= this.umbral ? undefined : `puntuación ${score} < umbral ${this.umbral}`,
    }
  }
}
