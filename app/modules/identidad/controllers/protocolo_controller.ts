import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { SsoError } from '#modules/identidad/errores_sso'
import { LlaveFirmaService } from '#modules/identidad/services/llave_firma_service'
import { TokenService, type TokensEmitidos } from '#modules/identidad/services/token_service'
import { AutorizacionService, CLIENTES } from '#modules/identidad/services/autorizacion_service'
import Usuario from '#modules/identidad/models/usuario'

/**
 * Endpoints de PROTOCOLO — OAuth 2.1 + OpenID Connect.
 *
 * **No usan el envelope result/data.** Responden con el formato exacto de la
 * especificación. Es la única excepción autorizada al estándar interno, y es
 * deliberada: el propósito de adoptar el protocolo es que cualquier librería
 * cliente funcione sin adaptadores y que el proveedor pueda sustituirse por
 * Keycloak o Auth0 sin tocar las apps. Envolver las respuestas destruiría esa
 * propiedad.
 *
 * La trazabilidad interna se conserva con la extensión `sso_code`, que las
 * librerías estándar ignoran por ser un campo desconocido.
 */
@inject()
export default class ProtocoloController {
  constructor(
    private llaves: LlaveFirmaService,
    private tokens: TokenService,
    private autorizacion: AutorizacionService
  ) {}

  /**
   * Documento de descubrimiento. Permite que los clientes se configuren con una
   * sola URL en vez de siete rutas cableadas, y que mover un endpoint no
   * obligue a redesplegar el panel ni a publicar una versión en la App Store.
   */
  async descubrimiento({ response }: HttpContext) {
    const iss = env.get('SSO_ISSUER')
    return response.header('cache-control', 'public, max-age=86400').json({
      issuer: iss,
      authorization_endpoint: `${iss}/authorize`,
      token_endpoint: `${iss}/token`,
      userinfo_endpoint: `${iss}/userinfo`,
      jwks_uri: `${iss}/.well-known/jwks.json`,
      end_session_endpoint: `${iss}/logout`,
      revocation_endpoint: `${iss}/token/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      id_token_signing_alg_values_supported: ['RS256', 'ES256'],
      scopes_supported: ['openid', 'perfil', 'sgeb.api'],
      /** Clientes públicos: la protección es PKCE, no un secreto. */
      token_endpoint_auth_methods_supported: ['none'],
    })
  }

  async jwks({ response }: HttpContext) {
    return response.header('cache-control', 'public, max-age=3600').json(await this.llaves.jwks())
  }

  /**
   * Inicio del flujo. Valida cliente y URL de retorno ANTES que nada.
   *
   * Con `client_id` o `redirect_uri` inválidos se renderiza una página y NO se
   * redirige: mandar al usuario a una URL no verificada convertiría al
   * proveedor en un redirector abierto.
   */
  async authorize({ request, response }: HttpContext) {
    const q = request.qs()

    let cliente
    try {
      cliente = this.autorizacion.validarCliente(q.client_id, q.redirect_uri)
    } catch (error) {
      const e = error as SsoError
      return response.status(e.httpStatus).send(
        `<!doctype html><meta charset="utf-8"><title>Error de autorización</title>` +
          `<p>${e.message}</p><p><small>${e.codigo}</small></p>`
      )
    }

    // A partir de aquí el retorno está verificado: los errores sí redirigen.
    try {
      if (q.response_type !== 'code') {
        throw new SsoError('SSO-2004', {
          tecnico: `response_type='${q.response_type}'. Solo se admite 'code'.`,
        })
      }

      const solicitud = this.autorizacion.validarParametros({
        clientId: q.client_id,
        redirectUri: q.redirect_uri,
        scope: q.scope,
        state: q.state,
        nonce: q.nonce,
        codeChallenge: q.code_challenge,
        codeChallengeMethod: q.code_challenge_method,
      })

      const ticket = await this.autorizacion.crearFlujo(solicitud)

      /**
       * Aquí el proveedor evaluaría su cookie de sesión SSO: con sesión vigente
       * salta directo al código sin preguntar nada, que es literalmente el
       * inicio de sesión único en funcionamiento. Con `prompt=none` y sin
       * sesión, responde `login_required` sin mostrar interfaz.
       *
       * Pendiente: la interfaz de credenciales (wireframes S1, S3, S5–S7), que
       * el proveedor debe servir en su propio origen.
       */
      return response.redirect(`/interno/login?ticket=${encodeURIComponent(ticket)}&cliente=${cliente.tipo}`)
    } catch (error) {
      const e = error as SsoError
      const url = new URL(q.redirect_uri)
      url.searchParams.set('error', e.oauth ?? 'invalid_request')
      url.searchParams.set('error_description', e.message)
      if (q.state) url.searchParams.set('state', q.state)
      return response.redirect(url.toString())
    }
  }

  /** Canje del código y renovación. Cuerpo en x-www-form-urlencoded. */
  async token({ request, response }: HttpContext) {
    const b = request.body()

    try {
      if (b.grant_type === 'authorization_code') {
        const fila = await this.autorizacion.canjearCodigo({
          code: b.code,
          clientId: b.client_id,
          redirectUri: b.redirect_uri,
          codeVerifier: b.code_verifier,
        })

        const usuario = await Usuario.query()
          .where('id_usuario', fila.id_usuario)
          .preload('rol')
          .firstOrFail()

        const tokens = await this.tokens.emitir({
          usuario,
          rol: usuario.rol.nombre,
          cliente: CLIENTES[b.client_id]?.tipo ?? 'web',
          metodoLogin: 'password_2fa',
          scope: fila.scope,
          sid: crypto.randomUUID(),
          ip: request.ip(),
          userAgent: request.header('user-agent'),
        })

        return response.json(this.sinRefreshEnWeb(tokens, b.client_id, response))
      }

      if (b.grant_type === 'refresh_token') {
        const tokens = await this.tokens.rotar({
          refreshToken: b.refresh_token ?? this.refreshDeCookie(request),
          cliente: CLIENTES[b.client_id]?.tipo ?? 'web',
          ip: request.ip(),
          userAgent: request.header('user-agent'),
        })
        return response.json(this.sinRefreshEnWeb(tokens, b.client_id, response))
      }

      throw new SsoError('SSO-2004', {
        tecnico: `grant_type='${b.grant_type}' no soportado. Admitidos: authorization_code, refresh_token.`,
      })
    } catch (error) {
      if (error instanceof SsoError) {
        return response.status(error.httpStatus).json(error.aOAuth())
      }
      throw error
    }
  }

  async userinfo({ request, response }: HttpContext) {
    // El middleware de validación ya dejó el sujeto en el contexto.
    const uuid = request.header('x-sujeto-uuid')
    const usuario = await Usuario.query().where('uuid_usuario', uuid ?? '').preload('rol').first()

    if (!usuario) {
      return response.status(401).json({ error: 'invalid_grant', sso_code: 'SSO-1003' })
    }

    /** Nunca incluye datos bancarios: la CLABE pertenece al módulo de nómina. */
    return response.json({
      sub: usuario.uuidUsuario,
      name: [usuario.nombre, usuario.apellidoPaterno, usuario.apellidoMaterno]
        .filter(Boolean)
        .join(' '),
      given_name: usuario.nombre,
      family_name: usuario.apellidoPaterno,
      email: usuario.correo,
      email_verified: true,
      rol: usuario.rol.nombre,
    })
  }

  /**
   * Cierre de sesión ÚNICO: destruye la sesión del proveedor y revoca la cadena.
   * Para cerrar solo esta aplicación existe POST /token/revoke.
   */
  async logout({ request, response }: HttpContext) {
    const q = request.qs()
    response.clearCookie('sso_session')

    const destino = q.post_logout_redirect_uri
    const cliente = CLIENTES[q.client_id ?? '']
    if (destino && cliente?.postLogoutRedirectUris.includes(destino)) {
      const url = new URL(destino)
      if (q.state) url.searchParams.set('state', q.state)
      return response.redirect(url.toString())
    }

    return response.send('<!doctype html><meta charset="utf-8"><p>Sesión cerrada.</p>')
  }

  /**
   * Revocación. Responde 200 aunque el token no exista o ya estuviera revocado:
   * la especificación lo exige así para no convertir el endpoint en un oráculo
   * que permita averiguar qué tokens son válidos probándolos.
   */
  async revocar({ request, response }: HttpContext) {
    const token = request.input('token')
    if (token) await this.tokens.revocar(token)
    return response.status(200).send('')
  }

  // ── internos ────────────────────────────────────────────────────────────

  /**
   * En el cliente web el refresh token NO viaja en el cuerpo: sale como cookie
   * HttpOnly del dominio del proveedor. Así un XSS en el panel no puede leerlo.
   * En iOS sí viaja, y la app lo guarda en Keychain.
   */
  private sinRefreshEnWeb(
    tokens: TokensEmitidos,
    clientId: string,
    response: HttpContext['response']
  ): Record<string, unknown> {
    if (CLIENTES[clientId]?.tipo !== 'web') return { ...tokens }

    response.cookie('sgeb_refresh', tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/token',
    })

    const { refresh_token: _omitido, ...resto } = tokens
    return resto
  }

  private refreshDeCookie(request: HttpContext['request']): string {
    return request.cookie('sgeb_refresh', '')
  }
}
