import db from '@adonisjs/lucid/services/db'
import Insumo from '#modules/menu/models/insumo'
import Bebida from '#modules/menu/models/bebida'
import Envase from '#modules/menu/models/envase'
import RecetaIngrediente from '#modules/menu/models/receta_ingrediente'
import { SgebError, errores } from '#shared/errors/sgeb_error'

/**
 * Catálogo del menú: insumos, bebidas, recetas y envases.
 *
 * Todas las bajas son lógicas. Ningún DELETE borra físicamente un registro con
 * historia operativa: un insumo que estuvo en la receta de una bebida servida
 * hace tres meses tiene que seguir existiendo para que el consumo histórico
 * cuadre.
 */
export class MenuService {
  // ══════════════════════════════════════════════════════════════ insumos

  async listarInsumos(filtros: { activo?: boolean; estado?: string } = {}) {
    const q = Insumo.query().orderBy('nombre')
    if (filtros.activo !== undefined) q.where('activo', filtros.activo)
    if (filtros.estado) q.where('estado', filtros.estado)
    return q
  }

  async crearInsumo(datos: {
    nombre: string
    tipo: 'alcohol' | 'refresco' | 'jugo' | 'agua' | 'otro'
    unidad: string
    costo: number
  }) {
    return Insumo.create({ ...datos, nombre: datos.nombre.trim(), estado: 'disponible', activo: true })
  }

  /**
   * Cambia el estado operativo del insumo.
   *
   * Lo usa la barra cuando se acaba o se repone una botella sin pasar por el
   * Cubaitor. Marcar 'agotado' pausa las órdenes que dependan de ese insumo:
   * es preferible pausarlas de golpe a que cada mesero descubra el problema al
   * intentar servir.
   */
  async cambiarEstadoInsumo(id: number, estado: 'disponible' | 'bajo' | 'agotado' | 'inactivo') {
    return db.transaction(async (trx) => {
      const insumo = await Insumo.query({ client: trx }).where('id_insumo', id).forUpdate().first()
      if (!insumo) throw errores.noEncontrado('INSUMO', id)

      insumo.estado = estado
      if (estado === 'inactivo') insumo.activo = false
      await insumo.useTransaction(trx).save()

      if (estado === 'agotado') {
        const detalles = await trx
          .from('orden_detalle')
          .join('orden_detalle as od2', 'od2.id_detalle', 'orden_detalle.id_detalle')
          .where('orden_detalle.estado', 'pendiente')
          .whereIn(
            'orden_detalle.id_bebida',
            trx.from('receta_ingrediente').select('id_bebida').where('id_insumo', id)
          )
          .select('orden_detalle.id_detalle', 'orden_detalle.id_orden')

        const ids = detalles.map((d) => d.id_detalle)
        if (ids.length > 0) {
          await trx.from('orden_detalle').whereIn('id_detalle', ids).update({ estado: 'pausada_por_insumo' })
          await trx
            .from('orden')
            .whereIn('id_orden', detalles.map((d) => d.id_orden))
            .update({ estado: 'pausada_por_insumo' })
        }

        return { insumo, ordenesPausadas: ids.length }
      }

      return { insumo, ordenesPausadas: 0 }
    })
  }

  async desactivarInsumo(id: number) {
    return db.transaction(async (trx) => {
      const insumo = await Insumo.query({ client: trx }).where('id_insumo', id).forUpdate().first()
      if (!insumo) throw errores.noEncontrado('INSUMO', id)
      if (!insumo.activo) return insumo

      /**
       * Un insumo dentro de la receta de una bebida activa no se puede dar de
       * baja: esa bebida quedaría imposible de preparar y el mesero lo
       * descubriría al intentar servirla, frente al comensal.
       */
      const [{ count }] = await trx
        .from('receta_ingrediente')
        .join('bebida', 'bebida.id_bebida', 'receta_ingrediente.id_bebida')
        .where('receta_ingrediente.id_insumo', id)
        .where('bebida.activo', true)
        .count('* as count')

      if (Number(count) > 0) {
        throw errores.enUso('INSUMO', id, 'RECETA_INGREDIENTE de bebidas activas', Number(count))
      }

      const [{ enCurso }] = await trx
        .from('config_dispensado')
        .join('evento', 'evento.id_evento', 'config_dispensado.id_evento')
        .where('config_dispensado.id_insumo', id)
        .where('config_dispensado.activo', true)
        .whereIn('evento.estado', ['publicado', 'en_curso'])
        .count('* as enCurso')

      if (Number(enCurso) > 0) {
        throw new SgebError('SGEB-4017', {
          tecnico: `INSUMO id=${id} configurado en ${enCurso} pines de eventos vigentes.`,
        })
      }

      insumo.activo = false
      insumo.estado = 'inactivo'
      await insumo.useTransaction(trx).save()
      return insumo
    })
  }

  // ══════════════════════════════════════════════════════════════ bebidas

  async listarBebidas(soloActivas = true) {
    const q = Bebida.query().preload('receta', (r) => r.orderBy('orden_servido')).orderBy('nombre')
    if (soloActivas) q.where('activo', true)
    return q
  }

  async crearBebida(datos: { nombre: string; descripcion?: string | null; alcoholica: boolean }) {
    return Bebida.create({
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion ?? null,
      alcoholica: datos.alcoholica,
      activo: true,
    })
  }

  /**
   * Reemplaza la receta completa.
   *
   * Se valida que las proporciones no excedan 1.0 y que haya a lo sumo lógica
   * coherente: sin esta comprobación, una receta con dos ingredientes al 60 %
   * cada uno pediría 120 % del vaso y el cálculo daría un RESTO negativo
   * justo al momento de servir, frente al comensal.
   */
  async definirReceta(
    idBebida: number,
    ingredientes: Array<{
      idInsumo: number
      tipoPorcion: 'PROPORCION' | 'FIJO_ML' | 'RESTO'
      valor: number
      ordenServido: number
    }>
  ) {
    const bebida = await Bebida.find(idBebida)
    if (!bebida) throw errores.noEncontrado('BEBIDA', idBebida)

    if (ingredientes.length === 0) {
      throw new SgebError('SGEB-2001', { tecnico: 'RECETA vacía; una bebida necesita al menos un insumo.' })
    }

    const suma = ingredientes
      .filter((i) => i.tipoPorcion === 'PROPORCION')
      .reduce((a, i) => a + i.valor, 0)

    if (suma > 1) {
      throw new SgebError('SGEB-2012', {
        tecnico: `Las porciones PROPORCION suman ${suma.toFixed(2)} (> 1.00) para bebida id=${idBebida}.`,
      })
    }

    return db.transaction(async (trx) => {
      await RecetaIngrediente.query({ client: trx }).where('id_bebida', idBebida).delete()

      for (const ing of ingredientes) {
        const insumo = await Insumo.find(ing.idInsumo, { client: trx })
        if (!insumo) {
          throw new SgebError('SGEB-3002', { tecnico: `id_insumo=${ing.idInsumo} no existe.` })
        }
        await RecetaIngrediente.create(
          {
            idBebida,
            idInsumo: ing.idInsumo,
            tipoPorcion: ing.tipoPorcion,
            valor: ing.tipoPorcion === 'RESTO' ? 0 : ing.valor,
            ordenServido: ing.ordenServido,
          },
          { client: trx }
        )
      }

      await bebida.load('receta')
      return bebida
    })
  }

  async desactivarBebida(id: number) {
    return db.transaction(async (trx) => {
      const bebida = await Bebida.query({ client: trx }).where('id_bebida', id).forUpdate().first()
      if (!bebida) throw errores.noEncontrado('BEBIDA', id)
      if (!bebida.activo) return bebida

      const [{ count }] = await trx
        .from('orden_detalle')
        .where('id_bebida', id)
        .whereIn('estado', ['pendiente', 'pausada_por_insumo'])
        .count('* as count')

      if (Number(count) > 0) {
        throw errores.enUso('BEBIDA', id, 'ORDEN_DETALLE en curso', Number(count))
      }

      bebida.activo = false
      await bebida.useTransaction(trx).save()
      return bebida
    })
  }

  // ══════════════════════════════════════════════════════════════ envases

  async listarEnvases(soloActivos = true) {
    const q = Envase.query().orderBy('volumen_ml')
    if (soloActivos) q.where('activo', true)
    return q
  }

  async crearEnvase(datos: { nombre: string; volumenMl: number }) {
    return Envase.create({ nombre: datos.nombre.trim(), volumenMl: datos.volumenMl, activo: true })
  }

  async desactivarEnvase(id: number) {
    return db.transaction(async (trx) => {
      const envase = await Envase.query({ client: trx }).where('id_envase', id).forUpdate().first()
      if (!envase) throw errores.noEncontrado('ENVASE', id)
      if (!envase.activo) return envase

      const [{ count }] = await trx
        .from('orden_detalle')
        .where('id_envase', id)
        .whereIn('estado', ['pendiente', 'pausada_por_insumo'])
        .count('* as count')

      if (Number(count) > 0) {
        throw errores.enUso('ENVASE', id, 'ORDEN_DETALLE en curso', Number(count))
      }

      envase.activo = false
      await envase.useTransaction(trx).save()
      return envase
    })
  }
}
