import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Agrega `cancelada` al enumerado de SOLICITUD_SERVICIO.estado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  DISCREPANCIA #9 CON EL DICCIONARIO DE DATOS
 * ────────────────────────────────────────────────────────────────────────────
 * El Diccionario (tabla 24) declara solo `pendiente | atendida`;
 * `openapi-sgeb.yaml` incluye además `cancelada`, tanto en el filtro de listado
 * como en la transición de estado.
 *
 * Se adopta el OpenAPI, al revés que en las discrepancias anteriores, porque
 * aquí la necesidad operativa es real: el anti-spam de SGEB-4014 rechaza una
 * solicitud nueva mientras haya una pendiente en la mesa. Sin un estado
 * terminal distinto de `atendida`, una solicitud que nadie atiende —el comensal
 * se levantó, o pidió por error— **bloquea la mesa para siempre**: el comensal
 * no puede volver a llamar y el mesero no puede cerrarla sin mentir diciendo
 * que la atendió.
 *
 * `cancelada` es lo que permite cerrarla honestamente, y además distingue en el
 * histórico entre "se atendió" y "se descartó", que es justo la diferencia que
 * el capitán necesita al revisar el tiempo de respuesta de sus meseros.
 *
 * **Pendiente documental:** actualizar el Diccionario, tabla 24, a
 * `pendiente | atendida | cancelada`.
 */
export default class extends BaseSchema {
  /** ALTER TYPE ... ADD VALUE no puede ejecutarse dentro de una transacción. */
  static disableTransactions = true

  async up() {
    /**
     * PostgreSQL no permite ALTER TYPE ... ADD VALUE dentro de una transacción,
     * y las migraciones de Lucid corren en una. `IF NOT EXISTS` hace la
     * operación idempotente para poder correrla fuera de ella.
     */
    this.schema.raw(`ALTER TYPE solicitud_estado ADD VALUE IF NOT EXISTS 'cancelada'`)
  }

  async down() {
    /**
     * PostgreSQL no admite quitar un valor de un enumerado. Revertir exigiría
     * recrear el tipo y reescribir la columna, lo que con datos en producción
     * es más riesgoso que dejar un valor sin usar.
     */
    this.schema.raw(`UPDATE solicitud_servicio SET estado = 'atendida' WHERE estado = 'cancelada'`)
  }
}
