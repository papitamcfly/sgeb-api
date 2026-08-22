import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { responder } from '#shared/responder'
import { InvitacionService } from '#modules/identidad/services/invitacion_service'
import { IdentidadService } from '#modules/identidad/identidad_service'
import { BitacoraService } from '#modules/admin/services/bitacora_service'
import Rol from '#modules/identidad/models/rol'
import { SgebError } from '#shared/errors/sgeb_error'

const NOMBRE = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü ' \-]{2,30}$/

const crearValidator = vine.compile(
  vine.object({
    idRolDestino: vine.number().min(1).max(255),
    nombre: vine.string().trim().regex(NOMBRE),
    apellidoPaterno: vine.string().trim().regex(NOMBRE),
    apellidoMaterno: vine.string().trim().regex(NOMBRE).nullable().optional(),
    correo: vine.string().trim().email().maxLength(100),
  })
)

const filtrosValidator = vine.compile(
  vine.object({
    estado: vine.enum(['pendiente', 'usada', 'expirada', 'revocada'] as const).optional(),
    mias: vine.boolean().optional(),
  })
)

/**
 * Invitaciones: la única vía de alta de personal.
 *
 * El mesero nunca se registra solo. El capitán invita, y el deeplink del correo
 * es lo único que permite crear la cuenta — eso evita que cualquiera se dé de
 * alta y aparezca en las listas de asignación.
 */
@inject()
export default class InvitacionesController {
  constructor(
    private invitaciones: InvitacionService,
    private identidad: IdentidadService,
    private bitacora: BitacoraService
  ) {}

  async listar(ctx: HttpContext) {
    const f = await filtrosValidator.validate(ctx.request.qs())

    /**
     * El capitán ve las suyas; el admin ve todas. Se resuelve aquí y no en el
     * servicio porque depende de quién pregunta, no de la regla en sí.
     */
    let idEmisor: number | undefined
    if (ctx.sujeto.rol === 'capitan' || f.mias) {
      idEmisor = (await this.identidad.resolverPorUuid(ctx.sujeto.uuid)).id
    }

    return responder.lista(ctx, await this.invitaciones.listar({ estado: f.estado, idEmisor }))
  }

  /**
   * Emite la invitación y manda el correo.
   *
   * **El deeplink se devuelve UNA vez.** No se puede volver a consultar: en la
   * base solo queda su hash, así que un volcado no permite completar registros
   * ajenos. Si el correo no llega, se reenvía —lo que emite un token nuevo—, no
   * se recupera el viejo.
   */
  async crear(ctx: HttpContext) {
    const datos = await crearValidator.validate(ctx.request.body())

    /**
     * El capitán invita **solo meseros**: arma su equipo, no decide la
     * estructura del negocio. Sin esta comprobación podía darse de alta un
     * cómplice con su mismo nivel de permisos, y `idRolDestino` viaja en el
     * cuerpo — lo elige quien llama.
     */
    if (ctx.sujeto.rol !== 'admin') {
      const rol = await Rol.find(datos.idRolDestino)
      if (rol?.nombre !== 'mesero') {
        throw new SgebError('SGEB-1004', {
          tecnico:
            `rol='${ctx.sujeto.rol}' intentó invitar con id_rol_destino=${datos.idRolDestino} ` +
            `('${rol?.nombre ?? 'desconocido'}'). Solo el admin invita capitanes y admins.`,
        })
      }
    }

    const emisor = await this.identidad.resolverPorUuid(ctx.sujeto.uuid)

    const r = await this.invitaciones.invitar({ ...datos, idEmisor: emisor.id })

    await this.bitacora.registrar({
      tipoEntidad: 'INVITACION',
      accion: 'crear',
      uuidResponsable: ctx.sujeto.uuid,
      detalle: `Invitación a ${datos.correo} con rol ${datos.idRolDestino}.`,
      ip: ctx.request.ip(),
    })

    return responder.creado(
      ctx,
      { correo: datos.correo, deeplink: r.deeplink, expira_en: r.expiraEn },
      'Invitación enviada. El deeplink no se puede volver a consultar.'
    )
  }

  /**
   * Revoca una pendiente. **Libera el correo** para poder reinvitar: el índice
   * parcial solo admite una pendiente por dirección.
   */
  async revocar(ctx: HttpContext) {
    const inv = await this.invitaciones.revocar(
      ctx.request.param('id_invitacion'),
      ctx.sujeto.uuid
    )

    await this.bitacora.registrar({
      tipoEntidad: 'INVITACION',
      idEntidad: inv.id,
      accion: 'cancelar',
      uuidResponsable: ctx.sujeto.uuid,
      detalle: `Invitación a ${inv.correo} revocada.`,
      ip: ctx.request.ip(),
    })

    return responder.ok(ctx, inv, `INVITACION id=${inv.id} revocada. El correo queda libre.`)
  }

  /**
   * Reenvía: revoca la anterior y emite una nueva.
   *
   * No reutiliza el token original a propósito. Si el correo no llegó, el viejo
   * sigue vivo 72 horas; reemplazarlo cierra esa ventana y reinicia el plazo,
   * que es lo que el capitán espera al reenviar.
   */
  async reenviar(ctx: HttpContext) {
    const r = await this.invitaciones.reenviar(
      ctx.request.param('id_invitacion'),
      ctx.sujeto.uuid
    )

    await this.bitacora.registrar({
      tipoEntidad: 'INVITACION',
      accion: 'actualizar',
      uuidResponsable: ctx.sujeto.uuid,
      detalle: `Invitación reenviada; la anterior quedó revocada.`,
      ip: ctx.request.ip(),
    })

    return responder.creado(ctx, { deeplink: r.deeplink, expira_en: r.expiraEn })
  }
}
