import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ASIGNACION_MESA: separar "vigente" de "vinculada".
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  EL PROBLEMA
 * ────────────────────────────────────────────────────────────────────────────
 * `vinculada = false` significaba **dos cosas distintas**:
 *
 *   · recién asignada, el mesero aún no llega a la mesa
 *   · ya liberada, la asignación terminó
 *
 * Indistinguibles. El panel de piso mostraba al mesero "con mesa asignada"
 * después de habérsela quitado, y el guard contra doble asignación —que solo
 * miraba `vinculada = true`— dejaba acumular varias asignaciones pendientes
 * sobre la misma mesa.
 *
 * Lo reportó el equipo de frontend reproduciéndolo en la interfaz.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  LA CORRECCIÓN
 * ────────────────────────────────────────────────────────────────────────────
 * Dos banderas ortogonales, cada una con un significado único:
 *
 *   activa=true,  vinculada=false  → asignada, el mesero no ha llegado
 *   activa=true,  vinculada=true   → el mesero está en la mesa
 *   activa=false                   → liberada; `fecha_liberacion` dice cuándo
 *
 * La fila **sigue sin borrarse**: el histórico de quién atendió qué mesa es lo
 * que permite resolver una queja del comensal después del evento.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('asignacion_mesa', (table) => {
      table.boolean('activa').notNullable().defaultTo(true)
      table.timestamp('fecha_liberacion').nullable()
    })

    /**
     * Las filas existentes con `vinculada = false` son ambiguas por definición:
     * no hay forma de saber si estaban pendientes o liberadas. Se marcan como
     * **liberadas**, que es el lado seguro: una asignación viva de más
     * bloquearía la mesa para siempre; una de menos se vuelve a crear.
     */
    this.defer(async (db) => {
      await db
        .from('asignacion_mesa')
        .where('vinculada', false)
        .update({ activa: false, fecha_liberacion: db.raw('fecha_asignacion') })
    })

    /**
     * Una sola asignación vigente por mesa. Es lo que cierra el hueco de la
     * doble asignación pendiente: antes el guard vivía solo en el servicio y
     * miraba la bandera equivocada.
     *
     * Índice parcial y no UNIQUE ordinario: el histórico necesita varias filas
     * inactivas por mesa.
     */
    this.schema.raw(`
      CREATE UNIQUE INDEX asignacion_una_activa_por_mesa
      ON asignacion_mesa (id_mesa) WHERE activa = true
    `)

    /** Para el readback del panel de piso, que filtra por evento y vigencia. */
    this.schema.raw(`
      CREATE INDEX asignacion_participacion_activa
      ON asignacion_mesa (id_participacion, activa)
    `)
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS asignacion_una_activa_por_mesa')
    this.schema.raw('DROP INDEX IF EXISTS asignacion_participacion_activa')
    this.schema.alterTable('asignacion_mesa', (table) => {
      table.dropColumn('activa')
      table.dropColumn('fecha_liberacion')
    })
  }
}
