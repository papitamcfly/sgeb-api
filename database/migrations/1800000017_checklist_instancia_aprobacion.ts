import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * CHECKLIST_INSTANCIA: aprobación persistida.
 *
 * Hasta ahora `aprobar()` solo dejaba rastro para el checklist de montaje, y
 * de forma indirecta: vía `PARTICIPACION.checklist_ok`. Para servicio y cierre
 * la aprobación del capitán no se guardaba en ningún lado — el evento
 * `checklist:cambio` con `aprobado: true` era la única señal, y se perdía en
 * cuanto el socket se desconectaba o el proceso se reiniciaba.
 *
 * Eso rompe la exigencia de que la salida (`PARTICIPACION.estado = 'salida'`)
 * solo se permita con el checklist de cierre aprobado: no hay estado
 * autoritativo contra el cual verificar tras un reinicio.
 *
 * `aprobado_en` es la fuente de verdad para cualquier tipo de checklist, sin
 * tocar el significado de `checklist_ok` (que sigue siendo exclusivo del
 * desbloqueo de asignación de mesas por montaje).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('checklist_instancia', (table) => {
      table.timestamp('aprobado_en').nullable()
    })
  }

  async down() {
    this.schema.alterTable('checklist_instancia', (table) => {
      table.dropColumn('aprobado_en')
    })
  }
}
