import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import Usuario from '#modules/identidad/models/usuario'
import Rol from '#modules/identidad/models/rol'
import DatosBancarios from '#modules/identidad/models/datos_bancarios'
import { BitacoraService } from '#modules/admin/services/bitacora_service'
import { IdentidadService } from '#modules/identidad/identidad_service'
import { InvitacionService } from '#modules/identidad/services/invitacion_service'
import { SgebError, errores } from '#shared/errors/sgeb_error'

/**
 * Administración de usuarios y sus datos bancarios.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  DOS REGLAS QUE ATRAVIESAN TODO ESTE SERVICIO
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 1. **El entero de usuario no sale.** Todo entra y sale por `uuid_usuario`.
 *    La traducción vive dentro; los controladores nunca ven el entero.
 *
 * 2. **Ninguna operación toca contraseñas.** El alta crea la cuenta y el
 *    proveedor de identidad emite la invitación; el usuario define su
 *    contraseña en la pantalla del proveedor. Si este servicio aceptara una
 *    contraseña, el panel volvería a ser intermediario de credenciales y el
 *    flujo de código de autorización perdería su propósito.
 */

export interface CrearUsuario {
  idRol: number
  nombre: string
  apellidoPaterno: string
  apellidoMaterno?: string | null
  correo: string
  telefono?: string | null
}

@inject()
export class UsuarioService {
  constructor(
    private bitacora: BitacoraService,
    private identidad: IdentidadService,
    private invitaciones: InvitacionService
  ) {}

  // ══════════════════════════════════════════════════════════════ roles

  async listarRoles() {
    return Rol.query().where('activo', true).orderBy('id_rol')
  }

  // ══════════════════════════════════════════════════════════════ usuarios

  /**
   * Roles sobre los que puede operar quien pregunta.
   *
   * El capitán administra **solo meseros**: es quien arma su equipo, no quien
   * decide la estructura del negocio. Dejarlo tocar capitanes le permitiría
   * desactivar a un colega en medio de su evento, o darse de alta cómplices con
   * su mismo nivel de permisos.
   *
   * El admin opera sobre todos.
   */
  private alcance(rol: string): string[] | null {
    if (rol === 'admin') return null
    if (rol === 'capitan') return ['mesero']
    return []
  }

  /** Lanza si el objetivo está fuera del alcance de quien pregunta. */
  private async exigirAlcance(objetivo: Usuario, rolSolicitante: string, uuid: string) {
    const permitidos = this.alcance(rolSolicitante)
    if (permitidos === null) return

    await objetivo.load('rol')
    if (!permitidos.includes(objetivo.rol.nombre)) {
      throw new SgebError('SGEB-1004', {
        tecnico:
          `sub=${uuid} con rol='${rolSolicitante}' intentó operar sobre USUARIO ` +
          `id=${objetivo.id} de rol='${objetivo.rol.nombre}'. Alcance: ${permitidos.join(', ')}.`,
      })
    }
  }

  async listar(filtros: { rol?: string; activo?: boolean; q?: string; rolSolicitante?: string } = {}) {
    const q = Usuario.query().preload('rol').orderBy('nombre')

    /**
     * El filtro de alcance se aplica en la consulta, no al serializar: así el
     * capitán no puede deducir cuántos admins hay comparando conteos.
     */
    const permitidos = this.alcance(filtros.rolSolicitante ?? 'admin')
    if (permitidos !== null) {
      q.whereIn('id_rol', db.from('rol').select('id_rol').whereIn('nombre', permitidos))
    }

    if (filtros.activo !== undefined) q.where('activo', filtros.activo)
    if (filtros.rol) {
      q.whereIn('id_rol', db.from('rol').select('id_rol').where('nombre', filtros.rol))
    }
    if (filtros.q) {
      const patron = `%${filtros.q}%`
      q.where((sub) =>
        sub
          .whereILike('nombre', patron)
          .orWhereILike('apellido_paterno', patron)
          .orWhereILike('correo', patron)
      )
    }
    return q
  }

  async obtener(uuid: string, solicitante?: { uuid: string; rol: string }): Promise<Usuario> {
    const u = await Usuario.query().where('uuid_usuario', uuid).preload('rol').first()
    if (!u) throw errores.noEncontrado('USUARIO', uuid)

    /**
     * Sin solicitante es una lectura interna del propio backend (resolver el
     * perfil propio, precargar el capitán de un evento). El alcance solo aplica
     * cuando alguien pregunta por otro.
     */
    if (solicitante && solicitante.uuid !== uuid) {
      await this.exigirAlcance(u, solicitante.rol, solicitante.uuid)
    }
    return u
  }

  /**
   * Alta administrativa.
   *
   * Crea la cuenta **sin contraseña utilizable**: el `password_hash` queda con
   * un valor imposible de producir por Bcrypt, así que nadie puede entrar hasta
   * que el proveedor emita la invitación y el usuario defina la suya.
   *
   * Se hace así y no dejando el campo nulo porque la columna es NOT NULL en el
   * Diccionario, y relajarla abriría la puerta a cuentas sin credencial que
   * algún camino olvidado pudiera aceptar.
   */
  /**
   * Alta administrativa **con invitación**.
   *
   * ────────────────────────────────────────────────────────────────────────
   *  POR QUÉ EL ALTA Y LA INVITACIÓN VAN JUNTAS
   * ────────────────────────────────────────────────────────────────────────
   * Antes eran dos operaciones independientes y eso producía un callejón sin
   * salida: `POST /usuarios` creaba la cuenta con un hash imposible, y al
   * intentar invitar después, la invitación **rechazaba el correo** por
   * existir ya. La cuenta quedaba viva y sin ninguna forma de activarse.
   *
   * Lo detectó el equipo de frontend intentando dar de alta un capitán.
   *
   * Ahora es una sola operación: se crea la cuenta y se emite la invitación en
   * la misma transacción. El usuario define su contraseña en la pantalla del
   * proveedor, igual que un mesero invitado.
   */
  async crear(
    datos: CrearUsuario,
    uuidResponsable: string,
    rolSolicitante: string,
    ip?: string | null
  ) {
    const correo = datos.correo.trim().toLowerCase()

    const rol = await Rol.find(datos.idRol)
    if (!rol) {
      throw new SgebError('SGEB-3002', { tecnico: `id_rol=${datos.idRol} no existe en ROL.` })
    }

    /**
     * Solo el admin da de alta capitanes y admins. Un capitán que pudiera
     * crearlos se daría a sí mismo un cómplice con su mismo nivel de permisos.
     */
    const permitidos = this.alcance(rolSolicitante)
    if (permitidos !== null && !permitidos.includes(rol.nombre)) {
      throw new SgebError('SGEB-1004', {
        tecnico:
          `rol='${rolSolicitante}' no puede dar de alta usuarios con rol='${rol.nombre}'. ` +
          `Alcance: ${permitidos.join(', ')}.`,
      })
    }

    /**
     * La cuenta NO se crea aquí. Se delega en el módulo de invitaciones, que la
     * crea cuando el usuario completa el registro y define su contraseña.
     *
     * Crearla antes producía una cuenta viva sin credencial que la invitación
     * luego rechazaba por correo duplicado: un callejón sin salida.
     */
    const emisor = await this.identidad.resolverPorUuid(uuidResponsable)

    const inv = await this.invitaciones.invitar({
      idEmisor: emisor.id,
      idRolDestino: datos.idRol,
      nombre: datos.nombre.trim(),
      apellidoPaterno: datos.apellidoPaterno.trim(),
      apellidoMaterno: datos.apellidoMaterno?.trim() || null,
      correo,
    })

    await this.bitacora.registrar({
      tipoEntidad: 'INVITACION',
      accion: 'crear',
      uuidResponsable,
      detalle: `Alta de ${correo} con rol ${rol.nombre} por invitación.`,
      ip,
    })

    return { correo, rol: rol.nombre, deeplink: inv.deeplink, expira_en: inv.expiraEn }
  }

  /** Actualiza datos de perfil. No toca rol, correo ni estado de la cuenta. */
  async actualizar(
    uuid: string,
    datos: Partial<Pick<CrearUsuario, 'nombre' | 'apellidoPaterno' | 'apellidoMaterno' | 'telefono'>>,
    uuidResponsable: string,
    rolSolicitante: string,
    ip?: string | null
  ): Promise<Usuario> {
    const u = await this.obtener(uuid, { uuid: uuidResponsable, rol: rolSolicitante })

    if (datos.nombre) u.nombre = datos.nombre.trim()
    if (datos.apellidoPaterno) u.apellidoPaterno = datos.apellidoPaterno.trim()
    if (datos.apellidoMaterno !== undefined) u.apellidoMaterno = datos.apellidoMaterno?.trim() || null
    if (datos.telefono !== undefined) u.telefono = datos.telefono?.trim() || null

    await u.save()

    /** Solo se audita si lo cambió otro; editarse el propio perfil es rutina. */
    if (uuidResponsable !== uuid) {
      await this.bitacora.registrar({
        tipoEntidad: 'USUARIO',
        idEntidad: u.id,
        accion: 'actualizar',
        uuidResponsable,
        detalle: `Edición del perfil de ${u.correo}.`,
        ip,
      })
    }

    return u
  }

  /**
   * Activa o desactiva la cuenta (RF-6).
   *
   * Al desactivar, el módulo de identidad revoca en cascada los refresh tokens,
   * las sesiones y los dispositivos confiables. Los access tokens vigentes
   * expiran solos en ≤ 15 min: esa ventana es una decisión consciente que evita
   * consultar la base de identidad en cada petición del API.
   */
  async cambiarEstado(
    uuid: string,
    activo: boolean,
    uuidResponsable: string,
    rolSolicitante: string,
    ip?: string | null
  ): Promise<Usuario> {
    /** Alcance antes que nada: un capitán no desactiva a otro capitán. */
    await this.obtener(uuid, { uuid: uuidResponsable, rol: rolSolicitante })

    if (uuid === uuidResponsable) {
      throw new SgebError('SGEB-4022', {
        tecnico: `PATCH /usuarios/${uuid} rechazado: sub del JWT == uuid objetivo.`,
      })
    }

    return db.transaction(async (trx) => {
      const u = await Usuario.query({ client: trx })
        .where('uuid_usuario', uuid)
        .preload('rol')
        .forUpdate()
        .first()

      if (!u) throw errores.noEncontrado('USUARIO', uuid)
      if (u.activo === activo) return u

      u.activo = activo
      await u.useTransaction(trx).save()

      if (!activo) {
        await trx.from('auth.refresh_token').where('id_usuario', u.id).where('revocado', false).update({ revocado: true })
        await trx.from('auth.sesion_sso').where('id_usuario', u.id).where('revocada', false).update({ revocada: true })
        await trx.from('auth.dispositivo_confiable').where('id_usuario', u.id).where('activo', true).update({ activo: false })
      }

      await this.bitacora.registrar({
        tipoEntidad: 'USUARIO',
        idEntidad: u.id,
        accion: activo ? 'activar' : 'desactivar',
        uuidResponsable,
        detalle: `${activo ? 'Reactivación' : 'Desactivación'} de ${u.correo}${
          activo ? '' : '. Sesiones y dispositivos revocados.'
        }`,
        ip,
      })

      return u
    })
  }

  // ══════════════════════════════════════════════════════ datos bancarios

  async obtenerDatosBancarios(uuid: string): Promise<DatosBancarios> {
    const u = await this.obtener(uuid)
    const d = await DatosBancarios.query().where('id_usuario', u.id).where('activo', true).first()

    if (!d) {
      throw new SgebError('SGEB-3001', {
        tecnico: `Sin DATOS_BANCARIOS activos para uuid=${uuid}. El mesero aún no registró su CLABE.`,
      })
    }
    return d
  }

  /**
   * Registra o reemplaza la CLABE (RF-4, RF-5).
   *
   * La anterior se desactiva, **nunca se borra**: los PAGO históricos conservan
   * la referencia al snapshot con el que se dispersaron, y borrarla dejaría sin
   * explicación a dónde se fue un dinero ya transferido.
   */
  async registrarDatosBancarios(
    uuid: string,
    datos: { clabe: string; banco: string; titularCuenta: string },
    uuidResponsable: string,
    ip?: string | null
  ): Promise<DatosBancarios> {
    const u = await this.obtener(uuid)

    if (!/^\d{18}$/.test(datos.clabe) || !this.clabeValida(datos.clabe)) {
      throw new SgebError('SGEB-2005', {
        tecnico:
          `CLABE='${datos.clabe.slice(0, 4)}…${datos.clabe.slice(-4)}': longitud o dígito ` +
          `de control incorrecto para uuid=${uuid}.`,
      })
    }

    return db.transaction(async (trx) => {
      await DatosBancarios.query({ client: trx })
        .where('id_usuario', u.id)
        .where('activo', true)
        .update({ activo: false })

      const d = await DatosBancarios.create(
        {
          idUsuario: u.id,
          clabe: datos.clabe,
          banco: datos.banco.trim(),
          titularCuenta: datos.titularCuenta.trim(),
          activo: true,
        },
        { client: trx }
      )

      await this.bitacora.registrar({
        tipoEntidad: 'DATOS_BANCARIOS',
        idEntidad: d.id,
        accion: 'actualizar',
        uuidResponsable,
        /** Enmascarada también aquí: la bitácora se consulta desde el panel. */
        detalle: `CLABE ${datos.clabe.slice(0, 4)}…${datos.clabe.slice(-4)} para ${u.correo}.`,
        ip,
      })

      return d
    })
  }

  /**
   * Baja lógica de la cuenta bancaria.
   *
   * Se rechaza si hay pagos pendientes: quedarían apuntando a una cuenta que el
   * sistema ya considera inválida, y al intentar dispersar fallarían con
   * SGEB-4012 sin que nadie entienda por qué.
   */
  async desactivarDatosBancarios(uuid: string, uuidResponsable: string, ip?: string | null) {
    const u = await this.obtener(uuid)

    return db.transaction(async (trx) => {
      const d = await DatosBancarios.query({ client: trx })
        .where('id_usuario', u.id)
        .where('activo', true)
        .forUpdate()
        .first()

      if (!d) throw errores.noEncontrado('DATOS_BANCARIOS', uuid)

      const [{ count }] = await trx
        .from('pago')
        .whereIn(
          'id_participacion',
          trx.from('participacion_evento').select('id_participacion').where('id_usuario', u.id)
        )
        .whereIn('estado', ['pendiente', 'fallido'])
        .count('* as count')

      if (Number(count) > 0) {
        throw new SgebError('SGEB-4016', {
          tecnico:
            `DATOS_BANCARIOS id=${d.id} con ${count} PAGO en estado pendiente|fallido. ` +
            `Desactivarla dejaría esos pagos sin destino válido (SGEB-4012 al dispersar).`,
          datos: { pagos_pendientes: Number(count), alternativa: 'liquidar_o_cancelar_pagos' },
        })
      }

      d.activo = false
      await d.useTransaction(trx).save()

      await this.bitacora.registrar({
        tipoEntidad: 'DATOS_BANCARIOS',
        idEntidad: d.id,
        accion: 'desactivar',
        uuidResponsable,
        detalle: `Baja de la cuenta bancaria de ${u.correo}.`,
        ip,
      })
    })
  }

  /**
   * Dígito verificador de la CLABE (algoritmo del Banco de México):
   * pesos 3, 7 y 1 cíclicos sobre los 17 primeros dígitos.
   *
   * Atrapa el error de captura, que es lo frecuente: una CLABE mal tecleada que
   * pasa a nómina termina en una transferencia rechazada o, peor, enviada a la
   * cuenta de otra persona.
   */
  private clabeValida(clabe: string): boolean {
    const pesos = [3, 7, 1]
    let suma = 0
    for (let i = 0; i < 17; i++) suma += (Number(clabe[i]) * pesos[i % 3]) % 10
    return (10 - (suma % 10)) % 10 === Number(clabe[17])
  }
}
