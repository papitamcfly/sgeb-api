import { DateTime } from 'luxon'
import { createHash, randomBytes } from 'node:crypto'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import TokenRecuperacion from '#modules/identidad/models/token_recuperacion'
import Usuario from '#modules/identidad/models/usuario'
import { inject } from '@adonisjs/core'
import env from '#start/env'
import { SsoError } from '#modules/identidad/errores_sso'
import { CorreoService } from '#shared/services/correo_service'

const VIGENCIA_MIN = 30
const ESPERA_ENTRE_SOLICITUDES_MIN = 5
const POLITICA_PASSWORD = /^(?=.*[A-ZÁÉÍÓÚÑ])(?=.*\d).{8,72}$/

@inject()
export class RecuperacionService {
  constructor(private correo: CorreoService) {}

  private hash(v: string): string {
    return createHash('sha256').update(v).digest('hex')
  }

  /**
   * Solicita el enlace de restablecimiento.
   *
   * ────────────────────────────────────────────────────────────────────────
   * **Nunca revela si el correo existe.** Devuelve `null` y la pantalla dice lo
   * mismo en ambos casos (SSO-0002). Un mensaje distinto convertiría esta
   * pantalla en un enumerador de cuentas: sin necesidad de contraseñas, se
   * podría construir la lista completa del padrón probando correos.
   *
   * Por la misma razón el límite de frecuencia se aplica solo cuando la cuenta
   * existe, pero la respuesta es idéntica: si respondiéramos "espera" únicamente
   * a los correos reales, esa diferencia también los delataría.
   * ────────────────────────────────────────────────────────────────────────
   */
  async solicitar(correo: string, ip?: string | null): Promise<string | null> {
    const normalizado = correo.trim().toLowerCase()
    const usuario = await Usuario.query().where('correo', normalizado).first()

    if (!usuario || !usuario.activo) return null

    const reciente = await TokenRecuperacion.query()
      .where('id_usuario', usuario.id)
      .where('usado', false)
      .orderBy('id_token', 'desc')
      .first()

    if (
      reciente &&
      DateTime.now().diff(reciente.creadoEn, 'minutes').minutes < ESPERA_ENTRE_SOLICITUDES_MIN
    ) {
      return null
    }

    /**
     * Los tokens anteriores se invalidan. Si no, cada solicitud dejaría vivo
     * otro enlace y bastaría con que uno solo se filtrara de un correo viejo.
     */
    await TokenRecuperacion.query()
      .where('id_usuario', usuario.id)
      .where('usado', false)
      .update({ usado: true })

    const token = randomBytes(32).toString('base64url')
    await TokenRecuperacion.create({
      idUsuario: usuario.id,
      tokenHash: this.hash(token),
      usado: false,
      expiraEn: DateTime.now().plus({ minutes: VIGENCIA_MIN }),
      ipSolicitud: ip ?? null,
    })

    const base = env.get('APP_URL_PROVEEDOR') ?? 'https://auth.sgeb.mediocres.mx'
    await this.correo.recuperacion(
      normalizado,
      `${base}/recuperar/nueva?token=${encodeURIComponent(token)}`
    )

    return token
  }

  async leer(token: string): Promise<TokenRecuperacion> {
    const fila = await TokenRecuperacion.query().where('token_hash', this.hash(token)).first()

    if (!fila || fila.usado || fila.expiraEn < DateTime.now()) {
      throw new SsoError('SSO-3003', {
        tecnico:
          `Token de recuperación inválido. hash=${this.hash(token).slice(0, 12)}…, ` +
          `usado=${fila?.usado ?? '—'}, expira=${fila?.expiraEn?.toISO() ?? '—'}.`,
      })
    }
    return fila
  }

  /**
   * Restablece la contraseña y **cierra todas las sesiones del usuario**.
   *
   * Esto último no es opcional. Si alguien recupera su contraseña, la hipótesis
   * más probable es que sospeche que su cuenta está comprometida. Dejar vivas
   * las sesiones anteriores permitiría al intruso seguir dentro con un refresh
   * token que ya no depende de la contraseña que acaba de cambiar.
   */
  async confirmar(datos: { token: string; password: string; password2: string }): Promise<Usuario> {
    const fila = await this.leer(datos.token)

    if (datos.password !== datos.password2) {
      throw new SsoError('SSO-2007', { tecnico: 'Las contraseñas capturadas no coinciden.' })
    }
    if (!POLITICA_PASSWORD.test(datos.password)) {
      throw new SsoError('SSO-2006', {
        tecnico: `Contraseña fuera de política. longitud=${datos.password.length}. NUNCA loguear el valor.`,
      })
    }

    return db.transaction(async (trx) => {
      const usuario = await Usuario.query({ client: trx })
        .where('id_usuario', fila.idUsuario)
        .preload('rol')
        .firstOrFail()

      usuario.passwordHash = await hash.make(datos.password)
      await usuario.useTransaction(trx).save()

      fila.usado = true
      fila.usadoEn = DateTime.now()
      await fila.useTransaction(trx).save()

      await trx
        .from('auth.refresh_token')
        .where('id_usuario', usuario.id)
        .where('revocado', false)
        .update({ revocado: true })

      await trx
        .from('auth.sesion_sso')
        .where('id_usuario', usuario.id)
        .where('revocada', false)
        .update({ revocada: true })

      /** También se levantan los bloqueos: quien recuperó su acceso debe poder entrar. */
      await trx
        .from('auth.bloqueo_cuenta')
        .where('id_usuario', usuario.id)
        .where('activo', true)
        .update({ activo: false })

      return usuario
    })
  }
}
