import RecetaIngrediente, { type TipoPorcion } from '#modules/menu/models/receta_ingrediente'
import { SgebError } from '#shared/errors/sgeb_error'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DE LA RECETA A LOS MILILITROS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Traduce "una cuba en vaso de 350 ml" a "45 ml de ron y 305 ml de refresco",
 * respetando el orden de servido.
 *
 * Los tres modos del Diccionario (tabla 16):
 *
 *   FIJO_ML     mililitros exactos, sin importar el envase. El alcohol va así:
 *               una cuba lleva 45 ml de ron tanto en vaso como en jarra, o la
 *               bebida saldría más fuerte solo por pedirla en envase grande.
 *   PROPORCION  fracción del volumen del envase. Para ingredientes que sí deben
 *               escalar, como un jarabe.
 *   RESTO       lo que sobre. Es el refresco, que rellena hasta arriba.
 *
 * `ordenServido` importa físicamente: el alcohol va primero y el refresco al
 * final, porque el vaso lleva hielo y el orden inverso lo desborda.
 */

export interface Vertido {
  idInsumo: number
  ml: number
  orden: number
  tipoPorcion: TipoPorcion
}

export class RecetaCalculo {
  /**
   * @param volumenEnvaseMl capacidad del envase elegido
   * @param factorLlenado   fracción útil del envase. 0.85 por defecto: el hielo
   *                        ocupa espacio, y llenar al 100 % derrama al servir.
   */
  calcular(
    receta: RecetaIngrediente[],
    volumenEnvaseMl: number,
    factorLlenado = 0.85
  ): Vertido[] {
    if (receta.length === 0) {
      throw new SgebError('SGEB-3002', {
        tecnico: 'BEBIDA sin RECETA_INGREDIENTE. No hay nada que dispensar.',
      })
    }

    const objetivo = Math.floor(volumenEnvaseMl * factorLlenado)
    const ordenada = [...receta].sort((a, b) => a.ordenServido - b.ordenServido)

    const vertidos: Vertido[] = []
    let acumulado = 0

    for (const ing of ordenada) {
      if (ing.tipoPorcion === 'RESTO') continue

      const ml =
        ing.tipoPorcion === 'FIJO_ML'
          ? Math.round(ing.valor)
          : Math.round(objetivo * ing.valor)

      vertidos.push({ idInsumo: ing.idInsumo, ml, orden: ing.ordenServido, tipoPorcion: ing.tipoPorcion })
      acumulado += ml
    }

    const restos = ordenada.filter((i) => i.tipoPorcion === 'RESTO')

    if (restos.length > 0) {
      const sobra = objetivo - acumulado

      /**
       * Si lo fijo ya supera la capacidad útil, la receta no cabe en ese envase.
       * Es un error de configuración del menú, no del mesero: pasa cuando se
       * define una bebida con 90 ml de licor y alguien la pide en vaso tequilero.
       */
      if (sobra <= 0) {
        throw new SgebError('SGEB-4007', {
          tecnico:
            `Receta incompatible con el envase: los ingredientes fijos suman ${acumulado} ml ` +
            `y la capacidad útil es ${objetivo} ml (envase ${volumenEnvaseMl} ml × ${factorLlenado}). ` +
            `Revisar RECETA_INGREDIENTE o el envase ofrecido.`,
        })
      }

      /** Si hay varios RESTO, se reparte a partes iguales. */
      const porResto = Math.floor(sobra / restos.length)
      restos.forEach((ing, i) => {
        /** El último absorbe el redondeo, para que la suma cuadre exacto. */
        const ml = i === restos.length - 1 ? sobra - porResto * (restos.length - 1) : porResto
        vertidos.push({ idInsumo: ing.idInsumo, ml, orden: ing.ordenServido, tipoPorcion: 'RESTO' })
      })
    }

    return vertidos.sort((a, b) => a.orden - b.orden)
  }

  /**
   * Segundos que debe permanecer abierta la electroválvula.
   *
   * El caudal sale de la calibración del pin, no de una constante: cada
   * manguera y cada altura de botella dan un caudal distinto, y usar un valor
   * teórico serviría tragos de volumen equivocado.
   */
  segundos(ml: number, caudalMlSeg: number): number {
    if (caudalMlSeg <= 0) {
      throw new SgebError('SGEB-5001', {
        tecnico: `caudal_ml_seg=${caudalMlSeg} no positivo. División imposible; revisar calibración.`,
      })
    }
    /** DECIMAL(4,2) en la base: dos decimales, máximo 99.99 s. */
    return Math.min(99.99, Math.round((ml / caudalMlSeg) * 100) / 100)
  }
}
