import { Server as SocketServer, type Socket } from 'socket.io'
import type { Server as NodeServer } from 'node:http'
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import emitter from '@adonisjs/core/services/emitter'
import { salaEvento } from '#shared/eventos_dominio'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CANAL EN TIEMPO REAL — socket.io sobre el mismo proceso de AdonisJS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Complementa al API REST; no lo sustituye. El criterio de la §10.1 del Entorno
 * Tecnológico: solo hay canal donde el cambio de estado lo disparan varios
 * actores concurrentes o un sistema externo, y dentro de una ventana de tiempo
 * acotada. Todo lo administrativo sigue siendo REST.
 *
 * Cuatro decisiones que definen el diseño:
 *
 * 1. **Autenticación en el handshake, con el mismo JWT.** Un socket sin token
 *    válido se rechaza antes de unirse a nada. No se inventa un mecanismo
 *    paralelo: el token es el mismo que valida el API, con las mismas llaves.
 *
 * 2. **Salas por evento, nunca broadcast global.** Un mesero no debe recibir el
 *    estado de mesas de un evento donde no trabaja. La pertenencia se verifica
 *    contra la base al unirse, no se acepta del cliente.
 *
 * 3. **El canal solo empuja, nunca recibe comandos.** Apartar un lugar, marcar
 *    un checklist o dispensar se hacen por REST, que ya tiene validación,
 *    autorización y envelope de errores. Duplicar esa lógica sobre sockets
 *    significaría mantener dos caminos con dos conjuntos de reglas.
 *
 * 4. **Reutiliza el proceso y el proxy existentes.** Nginx solo necesita
 *    habilitar el upgrade de conexión (§10.5). Con una sola instancia de
 *    AdonisJS no hace falta adaptador Redis; si se escala a más, sí.
 */

export interface SujetoSocket {
  uuid: string
  rol: 'admin' | 'capitan' | 'mesero'
}

/** Igual que en el middleware HTTP: local mientras el proveedor comparta proceso. */
const jwksRemoto = createRemoteJWKSet(new URL(env.get('SSO_JWKS_URL')), {
  cacheMaxAge: 24 * 60 * 60 * 1000,
  cooldownDuration: 30_000,
})

async function llaves(): Promise<Parameters<typeof jwtVerify>[1]> {
  if (env.get('SSO_JWKS_MODE') === 'remoto') return jwksRemoto
  const { LlaveFirmaService } = await import('#modules/identidad/services/llave_firma_service')
  return createLocalJWKSet(
    (await new LlaveFirmaService().jwks()) as Parameters<typeof createLocalJWKSet>[0]
  )
}

export class TiempoRealService {
  private io: SocketServer | null = null

  /** Arranca el servidor de sockets sobre el HTTP de AdonisJS. */
  montar(servidor: NodeServer): SocketServer {
    if (this.io) return this.io

    this.io = new SocketServer(servidor, {
      path: '/socket.io',
      /**
       * El origen se restringe a los clientes registrados. Un `*` aquí dejaría
       * que cualquier página abriera un socket con el token de la víctima si
       * lograra leerlo.
       */
      cors: { origin: env.get('SOCKET_CORS_ORIGIN').split(','), credentials: true },
      /**
       * El evento dura horas y la barra se mueve poco entre picos: si el
       * cliente no responde en 60 s se da por caído y se libera la conexión.
       */
      pingTimeout: 60_000,
    })

    this.io.use(async (socket, next) => {
      try {
        socket.data.sujeto = await this.autenticar(socket)
        next()
      } catch (error) {
        /**
         * El mensaje al cliente es genérico a propósito; el detalle va al log.
         * Un socket rechazado no debe explicar por qué, igual que el login no
         * dice si falló el correo o la contraseña.
         */
        logger.warn({ err: error }, 'Socket rechazado en el handshake')
        next(new Error('SGEB-1003'))
      }
    })

    this.io.on('connection', (socket) => this.alConectar(socket))
    this.registrarPuentes()

    logger.info('Canal de tiempo real montado en /socket.io')
    return this.io
  }

  async cerrar(): Promise<void> {
    if (!this.io) return
    await this.io.close()
    this.io = null
  }

  // ══════════════════════════════════════════════════════════════ internos

  private async autenticar(socket: Socket): Promise<SujetoSocket> {
    /**
     * El token viaja en `auth` del handshake, no en la query: la query se
     * escribe en los logs de acceso de Nginx y en el historial del navegador.
     */
    const token = (socket.handshake.auth?.token as string) ?? ''
    if (!token) throw new Error('Sin token en el handshake')

    const { payload } = await jwtVerify(token, await llaves(), {
      issuer: env.get('SSO_ISSUER'),
      audience: env.get('SSO_AUDIENCE'),
      algorithms: ['RS256', 'ES256'],
      clockTolerance: 30,
    })

    const rol = payload.rol as SujetoSocket['rol'] | undefined
    if (typeof payload.sub !== 'string' || !rol) throw new Error('Claims incompletos')

    return { uuid: payload.sub, rol }
  }

  private alConectar(socket: Socket) {
    const sujeto = socket.data.sujeto as SujetoSocket

    socket.on('unirse:evento', async (idEvento: number, ack?: (r: unknown) => void) => {
      try {
        await this.verificarPertenencia(sujeto, Number(idEvento))
        await socket.join(salaEvento(Number(idEvento)))
        ack?.({ ok: true, sala: salaEvento(Number(idEvento)) })
      } catch (error) {
        /**
         * El `ack` es la razón de elegir socket.io: el cliente sabe si quedó
         * dentro de la sala o no. Con SSE tendría que deducirlo por ausencia de
         * mensajes, que es indistinguible de "no ha pasado nada todavía".
         */
        ack?.({ ok: false, code: 'SGEB-1004', message: (error as Error).message })
      }
    })

    socket.on('salir:evento', async (idEvento: number) => {
      await socket.leave(salaEvento(Number(idEvento)))
    })
  }

  /**
   * Verifica contra la BASE que el sujeto pertenece al evento.
   *
   * No se confía en lo que el cliente diga: sin esta comprobación, cualquiera
   * con un token válido podría unirse a la sala de cualquier evento y ver la
   * operación completa de un salón donde no trabaja.
   */
  private async verificarPertenencia(sujeto: SujetoSocket, idEvento: number): Promise<void> {
    if (sujeto.rol === 'admin') return

    const usuario = await db.from('usuario').where('uuid_usuario', sujeto.uuid).first()
    if (!usuario) throw new Error('Sujeto sin cuenta')

    if (sujeto.rol === 'capitan') {
      const evento = await db
        .from('evento')
        .where('id_evento', idEvento)
        .where('id_capitan', usuario.id_usuario)
        .first()
      if (!evento) throw new Error(`El capitán no dirige el evento ${idEvento}`)
      return
    }

    const p = await db
      .from('participacion_evento')
      .where('id_evento', idEvento)
      .where('id_usuario', usuario.id_usuario)
      .first()
    if (!p) throw new Error(`Sin participación en el evento ${idEvento}`)
  }

  /**
   * Puentes evento de dominio → sala del evento.
   *
   * Este es el único lugar del proyecto que conoce a la vez el dominio y el
   * transporte. Agregar un evento nuevo al canal es una línea aquí, no un
   * cambio en un servicio.
   */
  private registrarPuentes() {
    const puente = <T extends { idEvento: number }>(nombre: string) => {
      emitter.on(nombre as never, (carga: T) => {
        /**
         * `emitido_en` se inyecta aquí y no en cada servicio: así ningún emisor
         * puede olvidarlo y todas las cargas usan el mismo reloj. Es el mismo
         * argumento por el que este es el único punto que conoce a la vez el
         * dominio y el transporte.
         */
        this.io
          ?.to(salaEvento(carga.idEvento))
          .emit(nombre, { ...carga, emitido_en: new Date().toISOString() })
      })
    }

    puente('cupo:actualizado')
    puente('participacion:cambio')
    puente('mesa:cambio')
    puente('checklist:cambio')
    puente('orden:cambio')
    puente('dispensado:cambio')
    puente('alerta:insumo')
    puente('solicitud:cambio')
    puente('cronograma:disparado')
  }

  /** Solo para pruebas: cuántos sockets hay en la sala de un evento. */
  async sockets(idEvento: number): Promise<number> {
    if (!this.io) return 0
    const s = await this.io.in(salaEvento(idEvento)).fetchSockets()
    return s.length
  }
}
