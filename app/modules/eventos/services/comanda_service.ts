import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import Evento from '#modules/eventos/models/evento'
import ComandaEvento from '#modules/eventos/models/comanda_evento'
import { AlmacenService } from '#shared/services/almacen_service'
import { BitacoraService } from '#modules/admin/services/bitacora_service'
import { SgebError, errores } from '#shared/errors/sgeb_error'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  COMANDA DEL EVENTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El documento que dice qué se sirve y cuándo. Lo sube el capitán y lo consultan
 * los meseros desde el salón.
 *
 * **Nunca se sirve por URL pública.** El acceso pasa siempre por el backend, que
 * verifica que quien pide tiene participación en ese evento. Con un enlace
 * público, cualquiera que lo consiguiera vería la operación completa de un
 * evento ajeno — y los enlaces se reenvían por WhatsApp sin pensarlo.
 */

/** 10 MB. Un PDF de comanda escaneado rara vez pasa de 3. */
export const MAX_BYTES = 10 * 1024 * 1024

/**
 * Muchos capitanes reciben la comanda por WhatsApp como foto, así que se
 * aceptan imágenes además del PDF.
 */
export const TIPOS_PERMITIDOS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const

@inject()
export class ComandaService {
  constructor(
    private almacen: AlmacenService,
    private identidad: IdentidadService,
    private bitacora: BitacoraService
  ) {}

  /**
   * Sube o reemplaza la comanda.
   *
   * La anterior queda inactiva pero **no se borra ni del bucket**: si el capitán
   * sube la equivocada a media fiesta, se puede volver. Costaría más un evento
   * servido con la comanda incorrecta que los kilobytes de las versiones viejas.
   */
  async subir(
    idEvento: number,
    archivo: MultipartFile,
    uuidCapitan: string,
    ip?: string | null
  ): Promise<ComandaEvento> {
    const evento = await Evento.find(idEvento)
    if (!evento) throw errores.noEncontrado('EVENTO', idEvento)

    if (['finalizado', 'cancelado'].includes(evento.estado)) {
      throw new SgebError('SGEB-4013', {
        tecnico: `EVENTO id=${idEvento} estado='${evento.estado}'. No admite comanda nueva.`,
      })
    }

    const capitan = await this.identidad.resolverPorUuid(uuidCapitan)

    const tipo = archivo.headers['content-type'] ?? ''
    if (!TIPOS_PERMITIDOS.includes(tipo as (typeof TIPOS_PERMITIDOS)[number])) {
      throw new SgebError('SGEB-2004', {
        tecnico:
          `content-type='${tipo}' no permitido. Admitidos: ${TIPOS_PERMITIDOS.join(', ')}.`,
      })
    }

    if ((archivo.size ?? 0) > MAX_BYTES) {
      throw new SgebError('SGEB-2012', {
        tecnico:
          `Archivo de ${Math.round((archivo.size ?? 0) / 1024)} KB excede el máximo de ` +
          `${MAX_BYTES / 1024 / 1024} MB.`,
      })
    }

    if (!archivo.tmpPath) {
      throw new SgebError('SGEB-2001', { tecnico: 'Archivo sin contenido en la petición.' })
    }

    /**
     * La clave lleva un UUID y no el nombre original. Dos razones: el nombre que
     * pone el capitán puede repetirse entre eventos, y un nombre adivinable en
     * el bucket haría que la privacidad dependiera solo del ACL.
     */
    const extension = (archivo.extname ?? 'bin').toLowerCase()
    const clave = `comandas/${idEvento}/${randomUUID()}.${extension}`

    const subido = await this.almacen.subir(clave, archivo.tmpPath, tipo)

    const comanda = await db.transaction(async (trx) => {
      /** La anterior se marca inactiva; el objeto se conserva. */
      await ComandaEvento.query({ client: trx })
        .where('id_evento', idEvento)
        .where('activo', true)
        .update({ activo: false })

      const c = await ComandaEvento.create(
        {
          idEvento,
          claveObjeto: subido.clave,
          nombreOriginal: (archivo.clientName ?? 'comanda').slice(0, 255),
          tipoMime: tipo,
          tamanoBytes: subido.tamanoBytes,
          idSubidoPor: capitan.id,
          activo: true,
        },
        { client: trx }
      )

      /**
       * `EVENTO.comanda_url` conserva la clave de la vigente. Se mantiene por
       * compatibilidad con el Diccionario, pero **ya no es una URL**: es la
       * clave del objeto, y el archivo se sirve por el endpoint del backend.
       */
      await trx.from('evento').where('id_evento', idEvento).update({ comanda_url: subido.clave })

      return c
    })

    await this.bitacora.registrar({
      tipoEntidad: 'COMANDA_EVENTO',
      idEntidad: comanda.id,
      accion: 'crear',
      uuidResponsable: uuidCapitan,
      detalle: `Comanda '${comanda.nombreOriginal}' (${Math.round(comanda.tamanoBytes / 1024)} KB) para el evento ${idEvento}.`,
      ip,
    })

    return comanda
  }

  /**
   * Devuelve la comanda vigente con una URL temporal para descargarla.
   *
   * **Verifica la pertenencia contra la base.** Sin esto, cualquiera con un
   * token válido podría pedir la comanda de un evento donde no trabaja.
   */
  async obtener(idEvento: number, uuidUsuario: string, rol: string) {
    await this.verificarAcceso(idEvento, uuidUsuario, rol)

    const c = await ComandaEvento.query()
      .where('id_evento', idEvento)
      .where('activo', true)
      .first()

    if (!c) {
      throw new SgebError('SGEB-3001', {
        tecnico: `EVENTO id=${idEvento} sin comanda vigente. El capitán no la ha subido.`,
      })
    }

    return {
      comanda: c,
      /**
       * 15 minutos: suficiente para abrir el documento y leerlo, y corto para
       * que un enlace reenviado deje de servir enseguida.
       */
      url: await this.almacen.urlFirmada(c.claveObjeto, 900),
      expira_en: DateTime.now().plus({ seconds: 900 }).toISO(),
    }
  }

  /** Contenido crudo, para cuando el backend sirve el archivo él mismo. */
  async contenido(idEvento: number, uuidUsuario: string, rol: string) {
    const { comanda } = await this.obtener(idEvento, uuidUsuario, rol)
    return { comanda, datos: await this.almacen.leer(comanda.claveObjeto) }
  }

  /** Historial de versiones. Es lo que permite volver a una anterior. */
  async historial(idEvento: number, uuidUsuario: string, rol: string) {
    await this.verificarAcceso(idEvento, uuidUsuario, rol)
    return ComandaEvento.query().where('id_evento', idEvento).orderBy('creado_en', 'desc')
  }

  /**
   * Restaura una versión anterior.
   *
   * No re-sube nada: el objeto sigue en el bucket, solo cambia cuál está activa.
   */
  async restaurar(idEvento: number, idComanda: number, uuidCapitan: string, ip?: string | null) {
    const c = await ComandaEvento.query()
      .where('id_comanda', idComanda)
      .where('id_evento', idEvento)
      .first()

    if (!c) throw errores.noEncontrado('COMANDA_EVENTO', idComanda)
    if (c.activo) return c

    await db.transaction(async (trx) => {
      await ComandaEvento.query({ client: trx })
        .where('id_evento', idEvento)
        .where('activo', true)
        .update({ activo: false })

      c.activo = true
      await c.useTransaction(trx).save()

      await trx.from('evento').where('id_evento', idEvento).update({ comanda_url: c.claveObjeto })
    })

    await this.bitacora.registrar({
      tipoEntidad: 'COMANDA_EVENTO',
      idEntidad: c.id,
      accion: 'actualizar',
      uuidResponsable: uuidCapitan,
      detalle: `Restaurada la comanda '${c.nombreOriginal}' en el evento ${idEvento}.`,
      ip,
    })

    return c
  }

  /**
   * Retira la comanda vigente.
   *
   * Baja lógica: el objeto se conserva y la versión anterior NO se reactiva sola
   * —eso sería adivinar la intención del capitán—. Queda el evento sin comanda
   * hasta que suba otra o restaure una.
   */
  async retirar(idEvento: number, uuidCapitan: string, ip?: string | null): Promise<void> {
    const c = await ComandaEvento.query()
      .where('id_evento', idEvento)
      .where('activo', true)
      .first()

    if (!c) throw errores.noEncontrado('COMANDA_EVENTO', idEvento)

    await db.transaction(async (trx) => {
      c.activo = false
      await c.useTransaction(trx).save()
      await trx.from('evento').where('id_evento', idEvento).update({ comanda_url: null })
    })

    await this.bitacora.registrar({
      tipoEntidad: 'COMANDA_EVENTO',
      idEntidad: c.id,
      accion: 'desactivar',
      uuidResponsable: uuidCapitan,
      detalle: `Retirada la comanda del evento ${idEvento}.`,
      ip,
    })
  }

  /**
   * Quién puede ver la comanda: el capitán del evento, cualquier admin, y los
   * meseros con participación.
   *
   * El comensal no. La comanda dice qué se sirve y en qué orden, que es
   * información operativa del banquete, no del invitado.
   */
  private async verificarAcceso(idEvento: number, uuidUsuario: string, rol: string): Promise<void> {
    if (rol === 'admin') return

    const usuario = await this.identidad.resolverPorUuid(uuidUsuario)

    if (rol === 'capitan') {
      const e = await db
        .from('evento')
        .where('id_evento', idEvento)
        .where('id_capitan', usuario.id)
        .first()
      if (e) return

      throw new SgebError('SGEB-1004', {
        tecnico: `sub=${uuidUsuario} no dirige el evento ${idEvento}.`,
      })
    }

    const p = await db
      .from('participacion_evento')
      .where('id_evento', idEvento)
      .where('id_usuario', usuario.id)
      .first()

    if (!p) {
      throw new SgebError('SGEB-1004', {
        tecnico: `sub=${uuidUsuario} sin participación en el evento ${idEvento}.`,
      })
    }
  }
}
