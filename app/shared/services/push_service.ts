import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  NOTIFICACIONES PUSH (Firebase Cloud Messaging)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mismo patrón que el correo: clase abstracta, dos implementaciones, y
 * `PUSH_MODO` decide cuál se inyecta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  POR QUÉ EL PUSH NUNCA LANZA
 * ────────────────────────────────────────────────────────────────────────────
 * Un fallo al enviar no debe tumbar la operación que lo generó. Si el hito del
 * cronograma se dispara y Firebase está caído, el hito **debe quedar marcado
 * como disparado igual**: la notificación ya está en la base y el mesero la ve
 * al abrir la app, además de que le llega por el canal de tiempo real.
 *
 * Si lanzara, el rollback desharía la marca y el siguiente ciclo volvería a
 * intentar, notificando de nuevo a todos los que sí recibieron. Peor que no
 * avisar es avisar de más.
 *
 * Por eso `enviar` devuelve un resultado en vez de lanzar: quien llama decide
 * si le importa, y hoy a nadie le importa lo suficiente como para abortar.
 */

export interface MensajePush {
  /** Tokens de dispositivo FCM. Uno por app instalada, no por usuario. */
  tokens: string[]
  titulo: string
  cuerpo: string
  /** Carga silenciosa para que la app navegue al abrir la notificación. */
  datos?: Record<string, string>
}

export interface ResultadoPush {
  enviados: number
  fallidos: number
  /** Tokens que el proveedor reportó como muertos: se dan de baja. */
  tokensInvalidos: string[]
}

export abstract class PushService {
  abstract enviar(mensaje: MensajePush): Promise<ResultadoPush>

  /**
   * Envía a todos los dispositivos activos de un conjunto de participaciones.
   *
   * Resuelve los tokens aquí y no en quien llama para que ningún servicio de
   * dominio tenga que conocer la tabla de dispositivos push.
   */
  async aParticipaciones(
    idsParticipacion: number[],
    titulo: string,
    cuerpo: string,
    datos?: Record<string, string>
  ): Promise<ResultadoPush> {
    if (idsParticipacion.length === 0) {
      return { enviados: 0, fallidos: 0, tokensInvalidos: [] }
    }

    const filas = await db
      .from('dispositivo_push')
      .whereIn(
        'id_usuario',
        db
          .from('participacion_evento')
          .select('id_usuario')
          .whereIn('id_participacion', idsParticipacion)
      )
      .where('activo', true)
      .select('token')

    const tokens = filas.map((f) => f.token as string)
    if (tokens.length === 0) return { enviados: 0, fallidos: 0, tokensInvalidos: [] }

    const r = await this.enviar({ tokens, titulo, cuerpo, datos })

    /**
     * Un token muerto —la app se desinstaló, o el sistema lo rotó— se da de baja
     * en cuanto el proveedor lo reporta. Si no, la tabla acumula destinos que
     * fallan en cada envío y el conteo de "fallidos" deja de significar nada.
     */
    if (r.tokensInvalidos.length > 0) {
      await db.from('dispositivo_push').whereIn('token', r.tokensInvalidos).update({ activo: false })
    }

    return r
  }

  /**
   * Registra el token de un dispositivo.
   *
   * Idempotente por token: la app lo reenvía en cada arranque porque FCM puede
   * rotarlo, y no debe crear una fila nueva cada vez.
   */
  async registrarDispositivo(datos: {
    idUsuario: number
    token: string
    plataforma: 'ios' | 'android' | 'web'
  }): Promise<void> {
    const existente = await db.from('dispositivo_push').where('token', datos.token).first()

    if (existente) {
      await db
        .from('dispositivo_push')
        .where('token', datos.token)
        .update({ id_usuario: datos.idUsuario, activo: true, actualizado_en: new Date().toISOString() })
      return
    }

    await db.table('dispositivo_push').insert({
      id_usuario: datos.idUsuario,
      token: datos.token,
      plataforma: datos.plataforma,
      activo: true,
    })
  }
}

/** Transporte de desarrollo. */
export class PushLog extends PushService {
  async enviar(mensaje: MensajePush): Promise<ResultadoPush> {
    logger.info(
      { tokens: mensaje.tokens.length, titulo: mensaje.titulo },
      `[PUSH-LOG] ${mensaje.titulo}: ${mensaje.cuerpo}`
    )
    return { enviados: mensaje.tokens.length, fallidos: 0, tokensInvalidos: [] }
  }
}

/**
 * Transporte real: Firebase Cloud Messaging.
 *
 * La app de Firebase se inicializa **una sola vez y de forma perezosa**: el SDK
 * mantiene un pool de conexiones y reinicializarlo en cada envío las tiraría.
 * Perezosa y no en el arranque porque en modo `log` no debe siquiera intentar
 * conectarse.
 */
export class PushFirebase extends PushService {
  private app: unknown = null

  private async mensajeria() {
    /**
     * API modular de firebase-admin v14 (`firebase-admin/app`), no el objeto
     * global de las versiones anteriores. Se importa de forma perezosa para que
     * en modo `log` el SDK ni siquiera se cargue.
     */
    const { initializeApp, getApps, getApp, cert } = await import('firebase-admin/app')
    const { getMessaging } = await import('firebase-admin/messaging')

    if (!this.app) {
      const proyecto = env.get('FIREBASE_PROJECT_ID')
      const correo = env.get('FIREBASE_CLIENT_EMAIL')
      const llave = env.get('FIREBASE_PRIVATE_KEY')

      if (!proyecto || !correo || !llave) {
        throw new Error(
          'PUSH_MODO=firebase pero faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY.'
        )
      }

      this.app = getApps().length
        ? getApp()
        : initializeApp({
            credential: cert({
              projectId: proyecto,
              clientEmail: correo,
              /**
               * Una variable de entorno no admite saltos de línea reales, así
               * que la llave viaja con `\n` escapados y se restituyen aquí. Sin
               * esto el SDK falla con un error de PEM inválido que no dice nada
               * sobre la causa.
               */
              privateKey: llave.replace(/\\n/g, '\n'),
            }),
          })
    }

    return getMessaging(this.app as Parameters<typeof getMessaging>[0])
  }

  async enviar(mensaje: MensajePush): Promise<ResultadoPush> {
    if (mensaje.tokens.length === 0) {
      return { enviados: 0, fallidos: 0, tokensInvalidos: [] }
    }

    try {
      const messaging = await this.mensajeria()

      const r = await messaging.sendEachForMulticast({
        tokens: mensaje.tokens,
        notification: { title: mensaje.titulo, body: mensaje.cuerpo },
        data: mensaje.datos ?? {},
        android: {
          /**
           * `high` porque un aviso de tiempo de comida pierde todo su valor si
           * el sistema lo agrupa y lo entrega media hora después.
           */
          priority: 'high',
          notification: { sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default' } },
          headers: { 'apns-priority': '10' },
        },
      })

      const invalidos: string[] = []
      r.responses.forEach((res: { success: boolean; error?: unknown }, i: number) => {
        if (res.success) return
        const codigo = (res.error as { code?: string } | undefined)?.code
        if (
          codigo === 'messaging/registration-token-not-registered' ||
          codigo === 'messaging/invalid-registration-token'
        ) {
          invalidos.push(mensaje.tokens[i])
        }
      })

      return { enviados: r.successCount, fallidos: r.failureCount, tokensInvalidos: invalidos }
    } catch (error) {
      /**
       * No relanza. Ver la nota del encabezado: un fallo de push no debe
       * deshacer el hito que lo disparó.
       */
      logger.error({ err: error, titulo: mensaje.titulo }, 'Fallo al enviar push por FCM')
      return { enviados: 0, fallidos: mensaje.tokens.length, tokensInvalidos: [] }
    }
  }
}
