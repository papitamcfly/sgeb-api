import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Checklist from '#modules/checklists/models/checklist'
import ChecklistItem from '#modules/checklists/models/checklist_item'
import ChecklistInstancia from '#modules/checklists/models/checklist_instancia'
import ChecklistRespuesta from '#modules/checklists/models/checklist_respuesta'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import { SgebError, errores } from '#shared/errors/sgeb_error'
import { inject } from '@adonisjs/core'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * Checklists de montaje, servicio y cierre.
 *
 * Es la pieza que faltaba en medio del flujo del evento: sin checklist de
 * montaje aprobado no hay asignación de mesas (SGEB-4005), y sin checklist de
 * cierre completo no se calculan pagos (SGEB-4015).
 *
 * Hay tres niveles y conviene no confundirlos:
 *
 *   CHECKLIST            la plantilla reutilizable: "Montaje de salón"
 *   CHECKLIST_ITEM       sus tareas: "Colocar mantelería", cantidad esperada 20
 *   CHECKLIST_INSTANCIA  la aplicación concreta a UNA participación
 *   CHECKLIST_RESPUESTA  lo que ese mesero marcó, ítem por ítem
 */

export interface ItemPlantilla {
  descripcion: string
  cantidadEsperada: number
  orden: number
}

@inject()
export class ChecklistService {
  constructor(private identidad: IdentidadService) {}

  // ══════════════════════════════════════════════════════════ plantillas

  async listar(tipo?: 'montaje' | 'servicio' | 'cierre') {
    const q = Checklist.query()
      .where('activo', true)
      .preload('items', (i) => i.where('activo', true).orderBy('orden'))
      .orderBy('nombre')
    if (tipo) q.where('tipo', tipo)
    return q
  }

  async obtener(id: number): Promise<Checklist> {
    const c = await Checklist.query()
      .where('id_checklist', id)
      .preload('items', (i) => i.orderBy('orden'))
      .first()
    if (!c) throw errores.noEncontrado('CHECKLIST', id)
    return c
  }

  async crear(datos: {
    nombre: string
    tipo: 'montaje' | 'servicio' | 'cierre'
    items: ItemPlantilla[]
  }) {
    if (datos.items.length === 0) {
      throw new SgebError('SGEB-2001', {
        tecnico: 'CHECKLIST sin ítems. Una plantilla vacía no sirve para nada.',
      })
    }

    return db.transaction(async (trx) => {
      const c = await Checklist.create(
        { nombre: datos.nombre.trim(), tipo: datos.tipo, activo: true },
        { client: trx }
      )
      await this.reemplazarItems(trx, c.id, datos.items)
      await c.load('items')
      return c
    })
  }

  /**
   * Reemplaza la plantilla y sus ítems.
   *
   * **Las instancias ya creadas NO se tocan**: conservan los ítems con los que
   * se generaron. Si se editaran, un mesero podría estar a media revisión y ver
   * cómo le cambian las tareas bajo los pies; peor aún, una instancia ya
   * aprobada dejaría de corresponder con lo que el capitán aprobó.
   *
   * Por eso los ítems se dan de baja lógica en vez de borrarse: las respuestas
   * históricas apuntan a ellos.
   */
  async actualizar(
    id: number,
    datos: { nombre: string; tipo: 'montaje' | 'servicio' | 'cierre'; items: ItemPlantilla[] }
  ) {
    return db.transaction(async (trx) => {
      const c = await Checklist.query({ client: trx }).where('id_checklist', id).forUpdate().first()
      if (!c) throw errores.noEncontrado('CHECKLIST', id)

      const [{ abiertas }] = await trx
        .from('checklist_instancia')
        .join('participacion_evento', 'participacion_evento.id_participacion', 'checklist_instancia.id_participacion')
        .join('evento', 'evento.id_evento', 'participacion_evento.id_evento')
        .where('checklist_instancia.id_checklist', id)
        .where('checklist_instancia.completado', false)
        .whereIn('evento.estado', ['publicado', 'en_curso'])
        .count('* as abiertas')

      if (Number(abiertas) > 0) {
        throw new SgebError('SGEB-4017', {
          tecnico:
            `CHECKLIST id=${id} con ${abiertas} instancias abiertas en eventos vigentes. ` +
            `Editar la plantilla cambiaría las tareas a meseros que están a media revisión.`,
        })
      }

      c.nombre = datos.nombre.trim()
      c.tipo = datos.tipo
      await c.useTransaction(trx).save()

      await this.reemplazarItems(trx, id, datos.items)
      await c.load('items')
      return c
    })
  }

  async desactivar(id: number) {
    return db.transaction(async (trx) => {
      const c = await Checklist.query({ client: trx }).where('id_checklist', id).forUpdate().first()
      if (!c) throw errores.noEncontrado('CHECKLIST', id)
      if (!c.activo) return c

      const [{ abiertas }] = await trx
        .from('checklist_instancia')
        .where('id_checklist', id)
        .where('completado', false)
        .count('* as abiertas')

      if (Number(abiertas) > 0) {
        throw errores.enUso('CHECKLIST', id, 'CHECKLIST_INSTANCIA sin completar', Number(abiertas))
      }

      c.activo = false
      await c.useTransaction(trx).save()
      return c
    })
  }

  // ══════════════════════════════════════════════════════════ instancias

  async listarInstancias(idParticipacion: number) {
    return ChecklistInstancia.query()
      .where('id_participacion', idParticipacion)
      .preload('respuestas')
      .orderBy('id_instancia')
  }

  /**
   * Instancia la plantilla para una participación.
   *
   * Crea las respuestas en cero de una vez, en lugar de irlas insertando
   * conforme el mesero marca: así la pantalla puede pintar la lista completa
   * desde el primer momento y el conteo de "faltan 3 de 12" es exacto sin
   * consultar la plantilla aparte.
   */
  async instanciar(idParticipacion: number, idChecklist: number) {
    return db.transaction(async (trx) => {
      const p = await ParticipacionEvento.find(idParticipacion, { client: trx })
      if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', idParticipacion)

      const plantilla = await Checklist.query({ client: trx })
        .where('id_checklist', idChecklist)
        .preload('items', (i) => i.where('activo', true).orderBy('orden'))
        .first()

      if (!plantilla) throw errores.noEncontrado('CHECKLIST', idChecklist)
      if (!plantilla.activo) throw errores.desactivado('CHECKLIST', idChecklist)

      const existente = await ChecklistInstancia.query({ client: trx })
        .where('id_participacion', idParticipacion)
        .where('id_checklist', idChecklist)
        .first()

      /**
       * Idempotente: refrescar la pantalla de montaje no debe generar instancias
       * duplicadas. El capitán vería el mismo checklist tres veces sin saber
       * cuál aprobar.
       */
      if (existente) {
        await existente.load('respuestas')
        return existente
      }

      const instancia = await ChecklistInstancia.create(
        { idParticipacion, idChecklist, completado: false, fecha: DateTime.now() },
        { client: trx }
      )

      for (const item of plantilla.items) {
        await ChecklistRespuesta.create(
          { idInstancia: instancia.id, idItem: item.id, cantidad: 0, hecho: false },
          { client: trx }
        )
      }

      await instancia.load('respuestas')
      return instancia
    })
  }

  /**
   * El mesero marca sus respuestas.
   *
   * `completado` lo calcula el servidor a partir de las respuestas, nunca lo
   * manda el cliente: si la app pudiera declararlo, bastaría con enviar
   * `completado: true` para saltarse el montaje entero.
   */
  /**
   * El mesero registra lo que verificó en su mesa.
   *
   * `uuidMesero` es obligatorio: sin él, cualquier mesero podía llenar el
   * checklist de otro y desbloquearle la asignación de mesas sin haber montado
   * nada. El capitán aprobaría un montaje que su autor nunca revisó.
   */
  async responder(
    idInstancia: number,
    respuestas: Array<{ idItem: number; cantidad: number; hecho: boolean }>,
    uuidMesero: string
  ) {
    const usuario = await this.identidad.resolverPorUuid(uuidMesero)

    return db.transaction(async (trx) => {
      const inst = await ChecklistInstancia.query({ client: trx })
        .where('id_instancia', idInstancia)
        .forUpdate()
        .first()

      if (!inst) throw errores.noEncontrado('CHECKLIST_INSTANCIA', idInstancia)

      /**
       * Una instancia ya aprobada no se reabre. La aprobación del capitán es lo
       * que desbloquea la asignación de mesas; permitir editar después dejaría
       * al mesero atendiendo mesas con un montaje que ya no coincide con lo
       * aprobado.
       */
      const p = await ParticipacionEvento.findOrFail(inst.idParticipacion, { client: trx })

      /** El checklist es de quien montó la mesa. */
      if (p.idUsuario !== usuario.id) {
        throw new SgebError('SGEB-1004', {
          tecnico:
            `sub=${uuidMesero} intentó responder la CHECKLIST_INSTANCIA id=${idInstancia}, ` +
            `que pertenece a la participación ${inst.idParticipacion} de id_usuario=${p.idUsuario}.`,
        })
      }

      if (inst.completado && p.checklistOk) {
        throw new SgebError('SGEB-4011', {
          tecnico:
            `CHECKLIST_INSTANCIA id=${idInstancia} ya completada y aprobada por el capitán. ` +
            `No se reabre.`,
        })
      }

      const items = await ChecklistItem.query({ client: trx }).where('id_checklist', inst.idChecklist)
      const porId = new Map(items.map((i) => [i.id, i]))

      for (const r of respuestas) {
        const item = porId.get(r.idItem)
        if (!item) {
          throw new SgebError('SGEB-3002', {
            tecnico: `id_item=${r.idItem} no pertenece al CHECKLIST id=${inst.idChecklist}.`,
          })
        }

        if (r.cantidad > item.cantidadEsperada) {
          throw new SgebError('SGEB-2012', {
            tecnico:
              `cantidad=${r.cantidad} excede cantidad_esperada=${item.cantidadEsperada} ` +
              `para CHECKLIST_ITEM id=${item.id}.`,
          })
        }

        await ChecklistRespuesta.query({ client: trx })
          .where('id_instancia', idInstancia)
          .where('id_item', r.idItem)
          .update({ cantidad: r.cantidad, hecho: r.hecho })
      }

      const pendientes = await ChecklistRespuesta.query({ client: trx })
        .where('id_instancia', idInstancia)
        .where('hecho', false)

      inst.completado = pendientes.length === 0
      inst.fecha = DateTime.now()
      await inst.useTransaction(trx).save()

      await inst.load('respuestas')
      return { instancia: inst, pendientes: pendientes.length, idEvento: p.idEvento }
    }).then((r) => {
      emitter.emit('checklist:cambio', {
        idEvento: r.idEvento,
        idParticipacion: r.instancia.idParticipacion,
        idInstancia: r.instancia.id,
        completado: r.instancia.completado,
        aprobado: false,
        pendientes: r.pendientes,
      })
      return { instancia: r.instancia, pendientes: r.pendientes }
    })
  }

  /**
   * El capitán aprueba el checklist de montaje (RF-21).
   *
   * Es lo que pone `PARTICIPACION.checklist_ok = true` y desbloquea la
   * asignación de mesas. **La aprobación es del capitán y no automática**: que
   * el mesero marque las casillas dice que él cree haber terminado; quien
   * verifica es otra persona.
   */
  async aprobar(idInstancia: number) {
    return db.transaction(async (trx) => {
      const inst = await ChecklistInstancia.query({ client: trx })
        .where('id_instancia', idInstancia)
        .forUpdate()
        .first()

      if (!inst) throw errores.noEncontrado('CHECKLIST_INSTANCIA', idInstancia)

      if (!inst.completado) {
        const pendientes = await ChecklistRespuesta.query({ client: trx })
          .where('id_instancia', idInstancia)
          .where('hecho', false)

        throw new SgebError('SGEB-4005', {
          tecnico:
            `CHECKLIST_INSTANCIA id=${idInstancia} con ${pendientes.length} ítems sin marcar. ` +
            `No se puede aprobar un montaje incompleto.`,
        })
      }

      const plantilla = await Checklist.findOrFail(inst.idChecklist, { client: trx })
      const p = await ParticipacionEvento.query({ client: trx })
        .where('id_participacion', inst.idParticipacion)
        .forUpdate()
        .firstOrFail()

      /**
       * Solo el de montaje desbloquea la asignación. Los de servicio y cierre
       * se aprueban igual pero no tocan `checklist_ok`: el de cierre alimenta
       * el bloqueo de pagos por otra vía.
       */
      if (plantilla.tipo === 'montaje') {
        p.checklistOk = true
        await p.useTransaction(trx).save()
      }

      return {
        instancia: inst,
        tipo: plantilla.tipo,
        desbloquea_asignacion: plantilla.tipo === 'montaje',
        idEvento: p.idEvento,
      }
    }).then((r) => {
      /**
       * El capitán aprueba desde su panel y el mesero tiene que enterarse: es
       * lo que le habilita la asignación de mesas y le dice que puede pasar a
       * la siguiente fase sin refrescar.
       */
      emitter.emit('checklist:cambio', {
        idEvento: r.idEvento,
        idParticipacion: r.instancia.idParticipacion,
        idInstancia: r.instancia.id,
        completado: true,
        aprobado: true,
        pendientes: 0,
      })
      return { instancia: r.instancia, tipo: r.tipo, desbloquea_asignacion: r.desbloquea_asignacion }
    })
  }

  // ══════════════════════════════════════════════════════════ internos

  private async reemplazarItems(
    trx: TransactionClientContract,
    idChecklist: number,
    items: ItemPlantilla[]
  ) {
    /**
     * Baja lógica, no borrado: las CHECKLIST_RESPUESTA históricas apuntan a
     * estos ítems, y borrarlos dejaría reportes de montaje sin poder decir qué
     * se revisó.
     */
    await ChecklistItem.query({ client: trx }).where('id_checklist', idChecklist).update({ activo: false })

    for (const item of items) {
      await ChecklistItem.create(
        {
          idChecklist,
          descripcion: item.descripcion.trim(),
          cantidadEsperada: item.cantidadEsperada,
          orden: item.orden,
          activo: true,
        },
        { client: trx }
      )
    }
  }
}
