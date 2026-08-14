import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { responder } from '#shared/responder'
import {
  ComandaService,
  MAX_BYTES,
  TIPOS_PERMITIDOS,
} from '#modules/eventos/services/comanda_service'
import { SgebError } from '#shared/errors/sgeb_error'

@inject()
export default class ComandaController {
  constructor(private comandas: ComandaService) {}

  /**
   * Sube o reemplaza la comanda del evento.
   *
   * Los límites se declaran también aquí y no solo en el servicio: el
   * `bodyparser` corta la subida al superarlos, así que un archivo de 200 MB no
   * llega a ocupar disco ni memoria antes de rechazarse.
   */
  async subir(ctx: HttpContext) {
    const archivo = ctx.request.file('comanda', {
      size: MAX_BYTES,
      extnames: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'webp'],
    })

    if (!archivo) {
      throw new SgebError('SGEB-2001', {
        tecnico: "Falta el campo 'comanda' en el multipart/form-data.",
      })
    }

    if (!archivo.isValid) {
      throw new SgebError('SGEB-2012', {
        tecnico:
          `Archivo rechazado por el bodyparser: ${archivo.errors.map((e) => e.message).join('; ')}. ` +
          `Máximo ${MAX_BYTES / 1024 / 1024} MB. Tipos: ${TIPOS_PERMITIDOS.join(', ')}.`,
      })
    }

    const c = await this.comandas.subir(
      ctx.request.param('id_evento'),
      archivo,
      ctx.sujeto.uuid,
      ctx.request.ip()
    )

    return responder.creado(ctx, c)
  }

  /**
   * Metadatos de la comanda vigente más una URL temporal.
   *
   * Se devuelve la URL en vez del archivo para que la app pueda abrirlo con su
   * visor nativo de PDF sin pasar el binario por el backend.
   */
  async mostrar(ctx: HttpContext) {
    const r = await this.comandas.obtener(
      ctx.request.param('id_evento'),
      ctx.sujeto.uuid,
      ctx.sujeto.rol
    )
    return responder.ok(ctx, { ...r.comanda.serialize(), url: r.url, expira_en: r.expira_en })
  }

  /**
   * Sirve el archivo desde el backend.
   *
   * Existe para el modo de almacenamiento local —donde no hay URL firmada— y
   * como alternativa cuando el cliente no puede seguir un enlace externo.
   */
  async descargar(ctx: HttpContext) {
    const { comanda, datos } = await this.comandas.contenido(
      ctx.request.param('id_evento'),
      ctx.sujeto.uuid,
      ctx.sujeto.rol
    )

    return ctx.response
      .header('content-type', comanda.tipoMime)
      /** `inline` para que el visor la abra en vez de descargarla al carrete. */
      .header('content-disposition', `inline; filename="${encodeURIComponent(comanda.nombreOriginal)}"`)
      /** Privada: la respuesta lleva contenido específico de quien la pidió. */
      .header('cache-control', 'private, max-age=300')
      .send(datos)
  }

  async historial(ctx: HttpContext) {
    const filas = await this.comandas.historial(
      ctx.request.param('id_evento'),
      ctx.sujeto.uuid,
      ctx.sujeto.rol
    )
    return responder.lista(ctx, filas)
  }

  /** Vuelve a una versión anterior sin re-subir: el objeto sigue en el bucket. */
  async restaurar(ctx: HttpContext) {
    const c = await this.comandas.restaurar(
      ctx.request.param('id_evento'),
      ctx.request.param('id_comanda'),
      ctx.sujeto.uuid,
      ctx.request.ip()
    )
    return responder.ok(ctx, c)
  }

  async retirar(ctx: HttpContext) {
    await this.comandas.retirar(ctx.request.param('id_evento'), ctx.sujeto.uuid, ctx.request.ip())
    return responder.ok(ctx, null, `Comanda del evento ${ctx.request.param('id_evento')} retirada.`)
  }
}
