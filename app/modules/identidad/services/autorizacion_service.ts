import { DateTime } from 'luxon'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { SsoError } from '#modules/identidad/errores_sso'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FLUJO DE CÓDIGO DE AUTORIZACIÓN CON PKCE (OAuth 2.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PKCE existe para clientes **públicos**: una app iOS y un panel React no
 * pueden guardar un secreto — el binario y el bundle son artefactos que
 * cualquiera descarga y abre. Sin PKCE, quien intercepte el código de
 * autorización (por un esquema de URL registrado por otra app, por el
 * historial del navegador, por un log de proxy) puede canjearlo él.
 *
 * PKCE lo impide así: el cliente inventa un `code_verifier` aleatorio, envía
 * solo su SHA-256 al pedir autorización, y presenta el verificador al canjear.
 * Quien robe el código no tiene el verificador, y del hash no se puede volver
 * atrás.
 */

/** Registro de aplicaciones cliente. Sin él no hay a quién dar acceso "único". */
export interface ClienteRegistrado {
  clientId: string
  nombre: string
  /** Coincidencia EXACTA, byte a byte. Sin comodines ni prefijos. */
  redirectUris: string[]
  postLogoutRedirectUris: string[]
  scopes: string[]
  tipo: 'web' | 'movil'
  activo: boolean
}

export const CLIENTES: Record<string, ClienteRegistrado> = {
  'sgeb-web-panel': {
    clientId: 'sgeb-web-panel',
    nombre: 'Panel del capitán',
    redirectUris: [
      'https://mediocres-inc.online/auth/callback',
      'https://sgeb.mediocres.mx/auth/callback',
      'http://localhost:5173/auth/callback',
    ],
    postLogoutRedirectUris: ['https://mediocres-inc.online/', 'https://sgeb.mediocres.mx/', 'http://localhost:5173/'],
    scopes: ['openid', 'profile', 'perfil', 'sgeb.api'],
    tipo: 'web',
    activo: true,
  },
  'sgeb-ios-mesero': {
    clientId: 'sgeb-ios-mesero',
    nombre: 'App del mesero',
    redirectUris: ['mx.mediocres.sgeb://callback'],
    postLogoutRedirectUris: ['mx.mediocres.sgeb://logout'],
    scopes: ['openid', 'profile', 'perfil', 'sgeb.api'],
    tipo: 'movil',
    activo: true,
  },
}

export interface SolicitudAutorizacion {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  nonce: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
}

const VIDA_CODIGO_SEG = 60
const VIDA_FLUJO_SEG = 10 * 60

export class AutorizacionService {
  /**
   * Valida cliente y URL de retorno ANTES de cualquier otra cosa.
   *
   * Estos dos errores NO se devuelven por redirección: se renderiza una página.
   * Redirigir a una URL que no se pudo verificar convertiría al proveedor en un
   * redirector abierto — un atacante armaría un enlace que aparenta venir de tu
   * dominio y termina en el suyo, con la credibilidad de tu marca prestada.
   */
  validarCliente(clientId: string, redirectUri: string): ClienteRegistrado {
    const cliente = CLIENTES[clientId]
    if (!cliente || !cliente.activo) {
      throw new SsoError('SSO-4006', {
        tecnico: `client_id='${clientId}' desconocido o inactivo. NO redirigir; renderizar página de error.`,
      })
    }

    if (!cliente.redirectUris.includes(redirectUri)) {
      throw new SsoError('SSO-4007', {
        tecnico:
          `redirect_uri='${redirectUri}' no registrada para ${clientId}. ` +
          `Registradas: ${cliente.redirectUris.join(', ')}. NO redirigir.`,
      })
    }

    return cliente
  }

  /** Validaciones que SÍ pueden devolverse por redirección con `error`. */
  validarParametros(s: Partial<SolicitudAutorizacion>): SolicitudAutorizacion {
    const faltantes = (['scope', 'state', 'nonce', 'codeChallenge'] as const).filter((k) => !s[k])
    if (faltantes.length) {
      throw new SsoError('SSO-2001', {
        tecnico: `Parámetros obligatorios ausentes en /authorize: ${faltantes.join(', ')}.`,
      })
    }

    /**
     * Solo S256. El método `plain` envía el verificador tal cual en la primera
     * petición, lo que anula por completo el propósito de PKCE.
     */
    if (s.codeChallengeMethod !== 'S256') {
      throw new SsoError('SSO-2004', {
        tecnico: `code_challenge_method='${s.codeChallengeMethod}'. Solo se admite S256; 'plain' está prohibido.`,
      })
    }

    /**
     * El state protege contra CSRF y debe ser impredecible. Un valor corto
     * ("1", "abc") es adivinable y deja el flujo abierto.
     */
    if ((s.state ?? '').length < 16) {
      throw new SsoError('SSO-2003', {
        tecnico: `state de longitud ${s.state?.length ?? 0}; mínimo 16 caracteres aleatorios.`,
      })
    }

    const cliente = CLIENTES[s.clientId!]
    const pedidos = (s.scope ?? '').split(' ').filter(Boolean)
    const noAutorizados = pedidos.filter((p) => !cliente.scopes.includes(p))
    if (!pedidos.includes('openid') || noAutorizados.length) {
      throw new SsoError('SSO-2004', {
        tecnico:
          `scope='${s.scope}' inválido. Debe incluir 'openid'. ` +
          `No autorizados para ${s.clientId}: ${noAutorizados.join(', ') || 'ninguno'}.`,
      })
    }

    return s as SolicitudAutorizacion
  }

  /**
   * Ticket que ata cada pantalla del proveedor (S1 → S3) a la solicitud
   * /authorize que la originó.
   *
   * Sin él, la pantalla de credenciales no sabe a qué cliente ni a qué URL
   * regresar al usuario, y el flujo quedaría abierto a que alguien completara
   * un login legítimo y redirigiera el código a otra parte.
   */
  async crearFlujo(s: SolicitudAutorizacion): Promise<string> {
    const ticket = randomBytes(32).toString('base64url')
    await db.table('auth.flujo_autorizacion').insert({
      ticket_hash: this.hash(ticket),
      client_id: s.clientId,
      redirect_uri: s.redirectUri,
      scope: s.scope,
      state: s.state,
      nonce: s.nonce,
      code_challenge: s.codeChallenge,
      expira_en: DateTime.now().plus({ seconds: VIDA_FLUJO_SEG }).toSQL(),
    })
    return ticket
  }

  async leerFlujo(ticket: string) {
    const fila = await db
      .from('auth.flujo_autorizacion')
      .where('ticket_hash', this.hash(ticket))
      .first()

    if (!fila || new Date(fila.expira_en) < new Date() || fila.consumido) {
      throw new SsoError('SSO-1017', {
        tecnico: `ticket_flujo inválido, expirado o ya consumido. hash=${this.hash(ticket).slice(0, 12)}…`,
      })
    }
    return fila
  }

  /**
   * Emite el código de autorización tras una autenticación exitosa.
   * Vive 60 segundos: solo tiene que sobrevivir un redirect.
   */
  async emitirCodigo(ticket: string, idUsuario: number): Promise<{ code: string; state: string; redirectUri: string }> {
    const flujo = await this.leerFlujo(ticket)
    const code = randomBytes(32).toString('base64url')

    await db.transaction(async (trx) => {
      await trx.from('auth.flujo_autorizacion').where('id_flujo', flujo.id_flujo).update({ consumido: true })
      await trx.table('auth.codigo_autorizacion').insert({
        codigo_hash: this.hash(code),
        id_usuario: idUsuario,
        client_id: flujo.client_id,
        redirect_uri: flujo.redirect_uri,
        scope: flujo.scope,
        nonce: flujo.nonce,
        code_challenge: flujo.code_challenge,
        expira_en: DateTime.now().plus({ seconds: VIDA_CODIGO_SEG }).toSQL(),
      })
    })

    return { code, state: flujo.state, redirectUri: flujo.redirect_uri }
  }

  /**
   * Canjea el código verificando PKCE.
   *
   * Un código es de **un solo uso**. Presentarlo dos veces solo ocurre si
   * alguien lo interceptó, así que el segundo intento revoca los tokens que
   * emitió el primero (SSO-1015) en lugar de limitarse a rechazarlo.
   */
  async canjearCodigo(opciones: {
    code: string
    clientId: string
    redirectUri: string
    codeVerifier: string
  }) {
    const hash = this.hash(opciones.code)
    let segundoCanjeDe: number | null = null

    try {
      return await db.transaction(async (trx) => {
      const fila = await trx
        .from('auth.codigo_autorizacion')
        .where('codigo_hash', hash)
        .forUpdate()
        .first()

      if (!fila) {
        throw new SsoError('SSO-1015', {
          tecnico: `Código de autorización inexistente. hash=${hash.slice(0, 12)}…`,
        })
      }

      if (fila.usado) {
        /** Revocar fuera de la transacción: el throw haría rollback. */
        segundoCanjeDe = fila.id_usuario
        throw new SsoError('SSO-1015', {
          tecnico:
            `SEGUNDO CANJE del código id=${fila.id_codigo_autorizacion} (usado el ${fila.usado_en}). ` +
            `Tokens emitidos por ese código REVOCADOS. Posible intercepción.`,
        })
      }

      if (new Date(fila.expira_en) < new Date()) {
        throw new SsoError('SSO-1015', {
          tecnico: `Código expirado el ${fila.expira_en} (vida ${VIDA_CODIGO_SEG} s).`,
        })
      }

      /**
       * `redirect_uri` debe ser idéntica a la de /authorize. Es una defensa
       * extra: aunque el atacante tuviera el código, tendría que además conocer
       * la URL exacta con la que se emitió.
       */
      if (fila.redirect_uri !== opciones.redirectUri || fila.client_id !== opciones.clientId) {
        throw new SsoError('SSO-1015', {
          tecnico:
            `Discrepancia en el canje. Esperado client_id='${fila.client_id}' ` +
            `redirect_uri='${fila.redirect_uri}'; recibido '${opciones.clientId}' / '${opciones.redirectUri}'.`,
        })
      }

      if (!this.verificarPkce(opciones.codeVerifier, fila.code_challenge)) {
        throw new SsoError('SSO-1016', {
          tecnico:
            `PKCE fallido: SHA-256(code_verifier) ≠ code_challenge almacenado. ` +
            `client_id=${opciones.clientId}, longitud verifier=${opciones.codeVerifier?.length}. ` +
            `NUNCA loguear el verifier. Causa más común: el cliente perdió el verificador ` +
            `entre el redirect y el retorno (sessionStorage en web, memoria del coordinador en iOS).`,
        })
      }

      await trx
        .from('auth.codigo_autorizacion')
        .where('id_codigo_autorizacion', fila.id_codigo_autorizacion)
        .update({ usado: true, usado_en: DateTime.now().toSQL() })

      return fila
      })
    } finally {
      if (segundoCanjeDe) {
        await db
          .from('auth.refresh_token')
          .where('id_usuario', segundoCanjeDe)
          .where('revocado', false)
          .update({ revocado: true })
      }
    }
  }

  /**
   * Comparación en tiempo constante. Un `===` normal corta en el primer byte
   * distinto, y ese diferencial de tiempo permite reconstruir el valor byte a
   * byte con suficientes intentos.
   */
  private verificarPkce(verifier: string, challengeGuardado: string): boolean {
    if (!verifier || verifier.length < 43 || verifier.length > 128) return false

    const calculado = createHash('sha256').update(verifier).digest('base64url')
    const a = Buffer.from(calculado)
    const b = Buffer.from(challengeGuardado)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private hash(valor: string): string {
    return createHash('sha256').update(valor).digest('hex')
  }
}
