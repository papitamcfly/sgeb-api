import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import { UsuarioService } from '#modules/identidad/services/usuario_service'
import {
  crearUsuarioValidator,
  actualizarUsuarioValidator,
  estadoUsuarioValidator,
  datosBancariosValidator,
  filtrosUsuarioValidator,
  dispositivoPushValidator,
} from '#modules/identidad/validators/usuario_validator'

/**
 * Administración de usuarios.
 *
 * Las rutas `/me` y las que llevan `{uuid_usuario}` comparten servicio pero no
 * autorización: en `/me` el sujeto sale del token y nadie puede tocar lo ajeno;
 * en las otras el middleware de rol ya filtró a capitán o admin.
 */
@inject()
export default class UsuariosController {
  constructor(private usuarios: UsuarioService) {}

  async listarRoles(ctx: HttpContext) {
    return responder.lista(ctx, await this.usuarios.listarRoles())
  }

  /**
   * El capitán ve solo meseros; el admin ve a todos. El alcance se resuelve en
   * la consulta, no al serializar: así el capitán no puede deducir cuántos
   * admins hay comparando conteos.
   */
  async listar(ctx: HttpContext) {
    const filtros = await filtrosUsuarioValidator.validate(ctx.request.qs())
    return responder.lista(
      ctx,
      await this.usuarios.listar({ ...filtros, rolSolicitante: ctx.sujeto.rol })
    )
  }

  async mostrar(ctx: HttpContext) {
    const u = await this.usuarios.obtener(ctx.request.param('uuid_usuario'), {
      uuid: ctx.sujeto.uuid,
      rol: ctx.sujeto.rol,
    })
    return responder.ok(ctx, u)
  }

  /**
   * Alta de personal: **emite la invitación**, no crea la cuenta.
   *
   * La cuenta la crea el módulo de invitaciones cuando el usuario completa el
   * registro y define su contraseña. Crearla antes producía una cuenta viva sin
   * credencial que la invitación luego rechazaba por correo duplicado.
   *
   * Es el mismo camino para meseros y capitanes; solo cambia quién puede
   * emitirla y con qué rol destino.
   */
  async crear(ctx: HttpContext) {
    const datos = await crearUsuarioValidator.validate(ctx.request.body())
    const r = await this.usuarios.crear(datos, ctx.sujeto.uuid, ctx.sujeto.rol, ctx.request.ip())

    return responder.creado(ctx, r, 'Invitación enviada. El deeplink no se puede volver a consultar.')
  }

  async actualizar(ctx: HttpContext) {
    const datos = await actualizarUsuarioValidator.validate(ctx.request.body())
    const u = await this.usuarios.actualizar(
      ctx.request.param('uuid_usuario'),
      datos,
      ctx.sujeto.uuid,
      ctx.sujeto.rol,
      ctx.request.ip()
    )
    return responder.ok(ctx, u)
  }

  async cambiarEstado(ctx: HttpContext) {
    const { activo } = await estadoUsuarioValidator.validate(ctx.request.body())
    const u = await this.usuarios.cambiarEstado(
      ctx.request.param('uuid_usuario'),
      activo,
      ctx.sujeto.uuid,
      ctx.sujeto.rol,
      ctx.request.ip()
    )
    return responder.ok(ctx, u)
  }

  // ────────────────────────────────────────────────────────────────── /me

  async miPerfil(ctx: HttpContext) {
    return responder.ok(ctx, await this.usuarios.obtener(ctx.sujeto.uuid))
  }

  async actualizarMiPerfil(ctx: HttpContext) {
    const datos = await actualizarUsuarioValidator.validate(ctx.request.body())
    const u = await this.usuarios.actualizar(
      ctx.sujeto.uuid,
      datos,
      ctx.sujeto.uuid,
      ctx.sujeto.rol,
      ctx.request.ip()
    )
    return responder.ok(ctx, u)
  }

  async misDatosBancarios(ctx: HttpContext) {
    return responder.ok(ctx, await this.usuarios.obtenerDatosBancarios(ctx.sujeto.uuid))
  }

  async registrarMisDatosBancarios(ctx: HttpContext) {
    const datos = await datosBancariosValidator.validate(ctx.request.body())
    const d = await this.usuarios.registrarDatosBancarios(
      ctx.sujeto.uuid,
      datos,
      ctx.sujeto.uuid,
      ctx.request.ip()
    )
    return responder.creado(ctx, d)
  }

  /**
   * Registra el token de FCM del dispositivo.
   *
   * Idempotente por token: la app lo reenvía en cada arranque porque el sistema
   * puede rotarlo, y acumular registros mandaría la misma notificación varias
   * veces al mismo teléfono.
   */
  async registrarDispositivoPush(ctx: HttpContext) {
    const { token, plataforma } = await dispositivoPushValidator.validate(ctx.request.body())
    const u = await this.usuarios.obtener(ctx.sujeto.uuid)

    const { PushService } = await import('#shared/services/push_service')
    const push = await ctx.containerResolver.make(PushService)
    await push.registrarDispositivo({ idUsuario: u.id, token, plataforma })

    return responder.creado(ctx, { plataforma }, 'Token de notificaciones registrado.')
  }

  // ─────────────────────────────────────────────── datos bancarios ajenos

  async datosBancarios(ctx: HttpContext) {
    return responder.ok(ctx, await this.usuarios.obtenerDatosBancarios(ctx.request.param('uuid_usuario')))
  }

  async registrarDatosBancarios(ctx: HttpContext) {
    const datos = await datosBancariosValidator.validate(ctx.request.body())
    const d = await this.usuarios.registrarDatosBancarios(
      ctx.request.param('uuid_usuario'),
      datos,
      ctx.sujeto.uuid,
      ctx.request.ip()
    )
    return responder.creado(ctx, d)
  }

  async desactivarDatosBancarios(ctx: HttpContext) {
    await this.usuarios.desactivarDatosBancarios(
      ctx.request.param('uuid_usuario'),
      ctx.sujeto.uuid,
      ctx.request.ip()
    )
    return responder.ok(ctx, null, `DATOS_BANCARIOS de ${ctx.request.param('uuid_usuario')} activo=0.`)
  }
}
