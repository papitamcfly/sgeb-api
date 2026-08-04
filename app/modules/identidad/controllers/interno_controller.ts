import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { SsoError } from '#modules/identidad/errores_sso'
import { AutorizacionService } from '#modules/identidad/services/autorizacion_service'
import { CredencialesService } from '#modules/identidad/services/credenciales_service'
import { SesionSsoService } from '#modules/identidad/services/sesion_sso_service'
import { InvitacionService } from '#modules/identidad/services/invitacion_service'
import { RecuperacionService } from '#modules/identidad/services/recuperacion_service'
import * as P from '#modules/identidad/pantallas'

/**
 * Controlador INTERNO del proveedor — sirve las pantallas S1–S7.
 *
 * **Ninguna aplicación cliente llama a estas rutas.** Las consume la propia
 * interfaz del proveedor, dentro de su origen. Si aparece una petición a
 * `/interno/login` desde el panel React o desde la app iOS, es un defecto de
 * arquitectura: significa que la aplicación está manipulando la contraseña del
 * usuario, que es exactamente lo que el flujo de código de autorización existe
 * para evitar.
 *
 * Devuelve HTML, no el envelope: son pantallas de navegador, no una API.
 */
/**
 * Redirección explícita.
 *
 * `response.redirect(url)` de AdonisJS reenvía la query string de la petición
 * original, así que un destino que ya lleva parámetros termina con dos signos
 * de interrogación: `/interno/login?ticket=abc?response_type=code&...`. El
 * ticket queda contaminado y el flujo se rompe en el primer paso.
 *
 * Se construye el 302 a mano para que el destino sea exactamente el que se pide.
 */
function redirigir(response: HttpContext['response'], url: string) {
  return response.status(302).header('location', url).send('')
}

@inject()
export default class InternoController {
  constructor(
    private autorizacion: AutorizacionService,
    private credenciales: CredencialesService,
    private sesion: SesionSsoService,
    private invitaciones: InvitacionService,
    private recuperacion: RecuperacionService
  ) {}

  // ══════════════════════════════════════════════════════════ S1 — login

  async mostrarLogin({ request, response }: HttpContext) {
    const ticket = request.input('ticket', '')
    try {
      await this.autorizacion.leerFlujo(ticket)
    } catch (error) {
      return this.error(response, error)
    }
    return response.type('html').send(P.pantallaLogin({ ticket }))
  }

  async login(ctx: HttpContext) {
    const { request, response } = ctx
    const ticket = request.input('ticket', '')
    const correo = request.input('correo', '')

    try {
      const flujo = await this.autorizacion.leerFlujo(ticket)
      const cliente = flujo.client_id === 'sgeb-ios-mesero' ? 'movil' : 'web'

      const r = await this.credenciales.autenticar({
        correo,
        password: request.input('password', ''),
        cliente,
        tokenDispositivo: request.cookie('sgeb_dispositivo', '') || null,
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      if (r.estado === 'verificacion_requerida') {
        /**
         * El ticket 2FA se guarda en el flujo, no en una cookie ni en el HTML:
         * así el paso de verificación queda atado a esta solicitud concreta y
         * un código válido no se puede usar para completar otro flujo.
         */
        await db
          .from('auth.flujo_autorizacion')
          .where('id_flujo', flujo.id_flujo)
          .update({ id_usuario_pendiente: r.usuario.id })

        return response
          .type('html')
          .send(P.pantallaVerificacion({ ticket, correo: r.usuario.correo }))
      }

      // Dispositivo confiable: se salta el segundo factor.
      return this.completar(ctx, ticket, r.usuario.id, r.usuario.uuidUsuario, 'password')
    } catch (error) {
      if (error instanceof SsoError && error.codigo === 'SSO-1017') {
        return this.error(response, error)
      }
      const e = error as SsoError
      return response
        .status(e.httpStatus ?? 500)
        .type('html')
        .send(P.pantallaLogin({ ticket, correo, error: e.message, codigo: e.codigo }))
    }
  }

  // ══════════════════════════════════════════════════════════ S3 — 2FA

  async verificacion(ctx: HttpContext) {
    const { request, response } = ctx
    const ticket = request.input('ticket', '')

    let flujo: Record<string, unknown>
    try {
      flujo = await this.autorizacion.leerFlujo(ticket)
    } catch (error) {
      return this.error(response, error)
    }

    const idUsuario = flujo.id_usuario_pendiente as number | null
    if (!idUsuario) {
      return this.error(
        response,
        new SsoError('SSO-1012', {
          tecnico: `Flujo ${flujo.id_flujo} sin id_usuario_pendiente: se llegó a /verificacion sin pasar por /login.`,
        })
      )
    }

    const correo = (await db.from('usuario').where('id_usuario', idUsuario).first())?.correo ?? ''

    try {
      const usuario = await this.credenciales.verificarCodigo({
        idUsuario,
        codigo: request.input('codigo', ''),
        proposito: 'login',
      })

      if (request.input('confiar') === '1') {
        const token = await this.credenciales.confiarDispositivo({
          idUsuario: usuario.id,
          plataforma: flujo.client_id === 'sgeb-ios-mesero' ? 'ios' : 'web',
          userAgent: request.header('user-agent'),
        })
        response.cookie('sgeb_dispositivo', token, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/interno',
          maxAge: 30 * 24 * 60 * 60,
        })
      }

      return this.completar(ctx, ticket, usuario.id, usuario.uuidUsuario, 'password_2fa')
    } catch (error) {
      const e = error as SsoError
      return response
        .status(e.httpStatus ?? 500)
        .type('html')
        .send(P.pantallaVerificacion({ ticket, correo, error: e.message, codigo: e.codigo }))
    }
  }

  async reenviar({ request, response }: HttpContext) {
    const ticket = request.input('ticket', '')
    try {
      const flujo = await this.autorizacion.leerFlujo(ticket)
      const idUsuario = flujo.id_usuario_pendiente as number
      const correo = (await db.from('usuario').where('id_usuario', idUsuario).first())?.correo ?? ''
      await this.credenciales.reenviarCodigo(idUsuario, 'login')
      return response.type('html').send(P.pantallaVerificacion({ ticket, correo }))
    } catch (error) {
      const e = error as SsoError
      return response
        .status(e.httpStatus ?? 500)
        .type('html')
        .send(P.pantallaVerificacion({ ticket, correo: '', error: e.message, codigo: e.codigo }))
    }
  }

  // ══════════════════════════════════════════════════════════ S4 — registro

  async mostrarRegistro({ request, response }: HttpContext) {
    const token = request.input('token', '')
    try {
      const inv = await this.invitaciones.leer(token)
      return response
        .type('html')
        .send(P.pantallaRegistro({ token, nombre: inv.nombre, correo: inv.correo }))
    } catch (error) {
      return this.error(response, error)
    }
  }

  async registro({ request, response }: HttpContext) {
    const token = request.input('token', '')
    try {
      await this.invitaciones.registrar({
        token,
        password: request.input('password', ''),
        password2: request.input('password2', ''),
        clabe: request.input('clabe', ''),
        banco: request.input('banco', ''),
        titular: request.input('titular', ''),
        aceptaPrivacidad: request.input('privacidad') === '1',
      })

      /**
       * Termina en el login, no autenticado. El registro crea la cuenta; entrar
       * es otro proceso y pasa por el flujo completo, con su segundo factor.
       */
      return response.type('html').send(
        P.pantallaRecuperar({ enviado: true })
      )
    } catch (error) {
      const e = error as SsoError
      try {
        const inv = await this.invitaciones.leer(token)
        return response
          .status(e.httpStatus ?? 500)
          .type('html')
          .send(
            P.pantallaRegistro({
              token,
              nombre: inv.nombre,
              correo: inv.correo,
              error: e.message,
              codigo: e.codigo,
            })
          )
      } catch {
        return this.error(response, e)
      }
    }
  }

  // ══════════════════════════════════════════════════════ S5, S6 — recuperación

  async mostrarRecuperar({ request, response }: HttpContext) {
    return response
      .type('html')
      .send(P.pantallaRecuperar({ ticket: request.input('ticket', '') }))
  }

  async recuperar({ request, response }: HttpContext) {
    await this.recuperacion.solicitar(request.input('correo', ''), request.ip())
    /** Misma respuesta exista o no la cuenta (SSO-0002). */
    return response
      .type('html')
      .send(P.pantallaRecuperar({ ticket: request.input('ticket', ''), enviado: true }))
  }

  async mostrarNuevaPassword({ request, response }: HttpContext) {
    const token = request.input('token', '')
    try {
      await this.recuperacion.leer(token)
      return response.type('html').send(P.pantallaNuevaPassword({ token }))
    } catch (error) {
      return this.error(response, error)
    }
  }

  async confirmarRecuperacion({ request, response }: HttpContext) {
    const token = request.input('token', '')
    try {
      await this.recuperacion.confirmar({
        token,
        password: request.input('password', ''),
        password2: request.input('password2', ''),
      })
      return response.type('html').send(P.pantallaSesionCerrada())
    } catch (error) {
      const e = error as SsoError
      return response
        .status(e.httpStatus ?? 500)
        .type('html')
        .send(P.pantallaNuevaPassword({ token, error: e.message, codigo: e.codigo }))
    }
  }

  // ══════════════════════════════════════════════════════════ internos

  /**
   * Cierra el flujo: crea la sesión del proveedor, emite el código de
   * autorización y redirige de vuelta al cliente.
   *
   * La sesión SSO se crea AQUÍ, y es la que hará que la próxima aplicación
   * entre sin preguntar nada.
   */
  private async completar(
    ctx: HttpContext,
    ticket: string,
    idUsuario: number,
    uuidUsuario: string,
    metodoLogin: 'password' | 'password_2fa'
  ) {
    await this.sesion.crear(ctx, { idUsuario, uuidUsuario, metodoLogin })
    const { code, state, redirectUri } = await this.autorizacion.emitirCodigo(ticket, idUsuario)

    const url = new URL(redirectUri)
    url.searchParams.set('code', code)
    url.searchParams.set('state', state)
    return redirigir(ctx.response, url.toString())
  }

  private error(response: HttpContext['response'], error: unknown) {
    const e = error as SsoError
    return response
      .status(e.httpStatus ?? 500)
      .type('html')
      .send(P.pantallaError({ mensaje: e.message ?? 'Error inesperado', codigo: e.codigo ?? 'SSO-5001' }))
  }
}
