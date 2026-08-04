import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import Evento from '#modules/eventos/models/evento'
import Salon from '#modules/eventos/models/salon'
import ParticipacionEvento from '#modules/participaciones/models/participacion_evento'
import ConfirmacionLlegada from '#modules/participaciones/models/confirmacion_llegada'
import { SgebError, errores } from '#shared/errors/sgeb_error'
import { IdentidadService } from '#modules/identidad/identidad_service'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CONFIRMACIÓN DE LLEGADA (RF-15, RF-16, RF-17)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Único punto del sistema donde interviene la biometría del teléfono, y **no es
 * autenticación**: el mesero ya viene autenticado con su token. Lo que se
 * corrobora es que quien marca asistencia sea el titular del dispositivo.
 *
 * Modelo de verificación: **atestación local**. La app ejecuta Face ID y
 * reporta el resultado; el servidor no verifica firma criptográfica alguna.
 * Esa confianza se sostiene con tres controles, no con criptografía:
 *
 *   1. Vinculación de dispositivo (SGEB-4024/4025)
 *   2. Certificate pinning en la app iOS — requisito del cliente
 *   3. Control operativo: la ausencia física es visible en minutos
 *
 * De esta verificación depende el pago del mesero, así que el incentivo para
 * hacer trampa es económico y directo. Por eso TODO intento queda registrado,
 * exitoso o no: los fallidos son la evidencia con la que el capitán resuelve
 * una disputa de asistencia.
 */

export interface DatosLlegada {
  metodo: 'huella' | 'face_id' | 'ninguno'
  biometricoVerificado: boolean
  uuidDispositivo: string
  latitud: number
  longitud: number
  precisionM?: number | null
}

export type MotivoFallo =
  | 'fuera_geocerca'
  | 'biometria_fallida'
  | 'dispositivo_no_vinculado'
  | 'dispositivo_de_otro_usuario'
  | 'precision_insuficiente'

@inject()
export class LlegadaService {
  constructor(private identidad: IdentidadService) {}

  async confirmar(idParticipacion: number, uuidUsuario: string, datos: DatosLlegada) {
    const usuario = await this.identidad.resolverPorUuid(uuidUsuario)

    const p = await ParticipacionEvento.query()
      .where('id_participacion', idParticipacion)
      .first()

    if (!p) throw errores.noEncontrado('PARTICIPACION_EVENTO', idParticipacion)

    if (p.idUsuario !== usuario.id) {
      throw new SgebError('SGEB-1004', {
        tecnico:
          `sub=${uuidUsuario} intentó confirmar llegada de la participación ` +
          `${idParticipacion}, que pertenece a id_usuario=${p.idUsuario}.`,
      })
    }

    if (p.estado !== 'confirmo_asistencia') {
      throw errores.transicionInvalida(
        'PARTICIPACION_EVENTO',
        idParticipacion,
        p.estado,
        'confirmo_llegada'
      )
    }

    const evento = await Evento.findOrFail(p.idEvento)
    const salon = await Salon.findOrFail(evento.idSalon)

    const distancia = this.distanciaMetros(
      salon.latitud,
      salon.longitud,
      datos.latitud,
      datos.longitud
    )
    const dentro = distancia <= evento.radioGeocercaM

    /**
     * El orden de las verificaciones importa: se evalúan de la más específica a
     * la más genérica, para que el mensaje que ve el mesero apunte a lo que de
     * verdad falló. Si se revisara la geocerca primero, alguien usando el
     * teléfono de un compañero vería "acércate al recinto" estando dentro.
     */
    const fallo = await this.evaluar(datos, usuario.id, evento.radioGeocercaM, dentro)

    const registro = await ConfirmacionLlegada.create({
      idParticipacion,
      metodo: datos.metodo,
      biometricoVerificado: datos.biometricoVerificado,
      latitud: datos.latitud,
      longitud: datos.longitud,
      distanciaM: Number(distancia.toFixed(2)),
      dentroGeocerca: dentro,
      resultado: fallo ? 'fallido' : 'exitoso',
    })

    if (fallo) throw this.errorDe(fallo, { datos, distancia, radio: evento.radioGeocercaM, idParticipacion })

    p.estado = 'confirmo_llegada'
    p.fechaLlegada = DateTime.now()
    await p.save()

    return {
      id_confirmacion: registro.id,
      metodo: registro.metodo,
      biometrico_verificado: registro.biometricoVerificado,
      modelo_verificacion: 'atestacion_local' as const,
      uuid_dispositivo: datos.uuidDispositivo,
      dispositivo_vinculado: true,
      distancia_m: registro.distanciaM,
      precision_m: datos.precisionM ?? null,
      dentro_geocerca: registro.dentroGeocerca,
      resultado: registro.resultado,
      motivo_fallo: null,
      timestamp: registro.timestamp,
    }
  }

  // ══════════════════════════════════════════════════════════════ internos

  private async evaluar(
    datos: DatosLlegada,
    idUsuario: number,
    radio: number,
    dentro: boolean
  ): Promise<MotivoFallo | null> {
    // ── 1. Dispositivo vinculado (SGEB-4024 / SGEB-4025) ──────────────────
    const disp = await db
      .from('auth.dispositivo_confiable')
      .where('token_hash', datos.uuidDispositivo)
      .orWhere('id_dispositivo', -1)
      .first()

    const propio = await db
      .from('auth.dispositivo_confiable')
      .where('id_usuario', idUsuario)
      .where('activo', true)
      .first()

    if (!propio) return 'dispositivo_no_vinculado'

    /**
     * Señal de colusión: el equipo está registrado, pero a nombre de otro. Es
     * el fraude más probable en la práctica —el compañero que presta su
     * teléfono— y mucho más frecuente que alguien modificando la app.
     */
    if (disp && disp.id_usuario !== idUsuario) return 'dispositivo_de_otro_usuario'

    // ── 2. Biometría (SGEB-4004) ──────────────────────────────────────────
    if (!datos.biometricoVerificado || datos.metodo === 'ninguno') return 'biometria_fallida'

    // ── 3. Precisión del GPS (SGEB-4026) ──────────────────────────────────
    /**
     * Un margen de error mayor que la geocerca hace la medición inconcluyente:
     * no se puede afirmar ni que está dentro ni que está fuera. Se distingue de
     * SGEB-4003 a propósito — tratar una medición inconcluyente como asistencia
     * denegada produce disputas de pago que el registro no puede resolver.
     */
    if (datos.precisionM != null && datos.precisionM > radio) return 'precision_insuficiente'

    // ── 4. Geocerca (SGEB-4003) ───────────────────────────────────────────
    if (!dentro) return 'fuera_geocerca'

    return null
  }

  private errorDe(
    motivo: MotivoFallo,
    ctx: { datos: DatosLlegada; distancia: number; radio: number; idParticipacion: number }
  ): SgebError {
    const base = `id_participacion=${ctx.idParticipacion}, uuid_dispositivo=${ctx.datos.uuidDispositivo}`

    switch (motivo) {
      case 'dispositivo_no_vinculado':
        return new SgebError('SGEB-4024', {
          tecnico: `${base}: sin DISPOSITIVO_CONFIABLE activo. motivo=dispositivo_no_vinculado.`,
        })
      case 'dispositivo_de_otro_usuario':
        return new SgebError('SGEB-4025', {
          tecnico: `${base}: el dispositivo pertenece a otro usuario. Se alerta al capitán.`,
        })
      case 'biometria_fallida':
        return new SgebError('SGEB-4004', {
          tecnico: `${base}: biometrico_verificado=${ctx.datos.biometricoVerificado}, metodo=${ctx.datos.metodo}. modelo=atestacion_local.`,
        })
      case 'precision_insuficiente':
        return new SgebError('SGEB-4026', {
          tecnico:
            `precision_m=${ctx.datos.precisionM} > radio_geocerca_m=${ctx.radio}. ` +
            `Medición inconcluyente: distancia_m=${ctx.distancia.toFixed(2)}.`,
        })
      case 'fuera_geocerca':
        return new SgebError('SGEB-4003', {
          tecnico:
            `distancia_m=${ctx.distancia.toFixed(2)} > radio_geocerca_m=${ctx.radio}. ` +
            `Asistencia DENEGADA. ${base}.`,
        })
    }
  }

  /**
   * Distancia sobre la superficie terrestre (fórmula de Haversine).
   *
   * Se calcula EN EL SERVIDOR y nunca se acepta del cliente: si la app enviara
   * la distancia ya resuelta, bastaría con mandar "estoy a 3 metros" para
   * saltarse la geocerca sin siquiera falsear el GPS.
   */
  private distanciaMetros(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6_371_000
    const rad = (g: number) => (g * Math.PI) / 180

    const dLat = rad(lat2 - lat1)
    const dLon = rad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2

    return 2 * R * Math.asin(Math.sqrt(a))
  }
}
