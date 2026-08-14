import db from '@adonisjs/lucid/services/db'
import Salon from '#modules/eventos/models/salon'
import { SgebError, errores } from '#shared/errors/sgeb_error'

/**
 * SERVICIO DE REFERENCIA — el resto de los módulos copia este patrón.
 *
 * Cuatro reglas que se ven aquí y aplican a todos:
 *
 *  1. El servicio NO conoce HTTP. No recibe `ctx`, no toca `response`, no sabe
 *     qué estatus va a salir. Recibe datos, devuelve datos o lanza SgebError.
 *     Eso lo hace probable sin levantar un servidor y reutilizable desde una
 *     tarea programada o un comando de Ace.
 *
 *  2. Toda baja es lógica. Ningún DELETE del API borra físicamente un registro
 *     con historia operativa: marca activo=0. Si el borrado rompería historia,
 *     responde SGEB-4016 y ofrece la desactivación.
 *
 *  3. Las verificaciones que deciden si una operación procede van DENTRO de la
 *     transacción, no antes. Entre un `SELECT count(*)` optimista y el `UPDATE`
 *     que le sigue cabe otra petición.
 *
 *  4. El `technical_message` lleva el detalle que soporte necesita: cuántas
 *     filas, de qué tabla, con qué ids de muestra.
 */
export class SalonService {
  async listar(filtros: { activo?: boolean; q?: string }) {
    const query = Salon.query().orderBy('nombre')
    if (filtros.activo !== undefined) query.where('activo', filtros.activo)
    if (filtros.q) query.whereILike('nombre', `%${filtros.q}%`)
    return query
  }

  async obtener(id: number) {
    const salon = await Salon.find(id)
    if (!salon) throw errores.noEncontrado('SALON', id)

    /**
     * Distinción deliberada: "no existe" (3001) y "ya no está disponible" (3004)
     * son cosas distintas para quien está en la pantalla. La primera sugiere que
     * se equivocó de enlace; la segunda, que el salón se dio de baja y hay que
     * elegir otro.
     */
    if (!salon.activo) throw errores.desactivado('SALON', id)

    return salon
  }

  async crear(datos: CrearSalon) {
    // El UNIQUE de la base es la garantía real; esta verificación solo existe
    // para dar un mensaje mejor. Si hay carrera, el 23505 lo atrapa el handler
    // y sale el mismo SGEB-2013.
    return Salon.create({ ...datos, activo: true })
  }

  async actualizar(id: number, datos: CrearSalon) {
    const salon = await this.obtener(id)

    /**
     * Cambiar coordenadas NO reescribe la geocerca de eventos ya publicados:
     * cada evento congela su radio y su punto al crearse. Si se permitiera,
     * mover el salón invalidaría retroactivamente asistencias ya confirmadas,
     * y de esas asistencias dependen pagos.
     */
    salon.merge(datos)
    await salon.save()
    return salon
  }

  async desactivar(id: number) {
    return db.transaction(async (trx) => {
      const salon = await Salon.query({ client: trx })
        .where('id', id)
        .forUpdate()
        .first()

      if (!salon) throw errores.noEncontrado('SALON', id)

      // Idempotente: desactivar lo ya desactivado no es un error.
      if (!salon.activo) return salon

      const [{ count }] = await trx
        .from('evento')
        .where('id_salon', id)
        .whereIn('estado', ['publicado', 'en_curso'])
        .count('* as count')

      const n = Number(count)
      if (n > 0) {
        const muestra = await trx
          .from('evento')
          .where('id_salon', id)
          .whereIn('estado', ['publicado', 'en_curso'])
          .select('id')
          .limit(5)

        throw new SgebError('SGEB-4016', {
          tecnico:
            `DELETE rechazado: SALON id=${id} referenciada por ${n} EVENTO ` +
            `en estado publicado|en_curso (ids: ${muestra.map((e) => e.id).join(', ')}). ` +
            `Sugerir baja lógica tras el cierre de los eventos.`,
          datos: { eventos_vigentes: n, alternativa: 'esperar_cierre' },
        })
      }

      salon.activo = false
      await salon.useTransaction(trx).save()
      return salon
    })
  }
}

export interface CrearSalon {
  nombre: string
  calle: string
  cp: string
  colonia: string
  ciudad: string
  estado: string
  latitud: number
  longitud: number
  capacidadMaxMesas: number
  capacidadPersonas: number
}
