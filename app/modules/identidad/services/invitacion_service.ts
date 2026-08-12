import { DateTime } from 'luxon'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import Invitacion from '#modules/identidad/models/invitacion'
import Usuario from '#modules/identidad/models/usuario'
import { inject } from '@adonisjs/core'
import { SsoError } from '#modules/identidad/errores_sso'
import { errores } from '#shared/errors/sgeb_error'
import { CorreoService } from '#shared/services/correo_service'
import logger from '@adonisjs/core/services/logger'

const HORAS_VIGENCIA = 72

/** Mínimo 8, una mayúscula y un número (SSO-2006). */
const POLITICA_PASSWORD = /^(?=.*[A-ZÁÉÍÓÚÑ])(?=.*\d).{8,72}$/

export interface DatosRegistro {
  token: string
  password: string
  password2: string
  clabe: string
  banco: string
  titular: string
  aceptaPrivacidad: boolean
}

@inject()
export class InvitacionService {
  constructor(private correo: CorreoService) {}

  private hash(v: string): string {
    return createHash('sha256').update(v).digest('hex')
  }

  /**
   * El capitán invita. Devuelve el token en claro UNA vez, para el deeplink.
   *
   * Del lado de la base solo queda el SHA-256: si alguien vuelca la tabla, no
   * puede completar registros ajenos.
   */
  async invitar(datos: {
    idEmisor: number
    idRolDestino: number
    nombre: string
    apellidoPaterno: string
    apellidoMaterno?: string | null
    correo: string
  }): Promise<{ token: string; deeplink: string; expiraEn: DateTime }> {
    const correo = datos.correo.trim().toLowerCase()

    /**
     * Se comprueba antes por dar un mensaje mejor, pero la garantía real es el
     * índice parcial `invitacion_una_pendiente_por_correo`: si dos capitanes
     * invitan a la vez, la base rechaza la segunda y el error cae aquí igual.
     */
    const yaExiste = await Usuario.query().where('correo', correo).first()
    if (yaExiste) {
      throw new SsoError('SSO-2005', {
        tecnico: `USUARIO.correo='${correo}' ya existe (id=${yaExiste.id}). Invitación rechazada.`,
      })
    }

    const token = randomBytes(32).toString('base64url')
    const expiraEn = DateTime.now().plus({ hours: HORAS_VIGENCIA })

    try {
      await Invitacion.create({
        idEmisor: datos.idEmisor,
        idRolDestino: datos.idRolDestino,
        nombre: datos.nombre,
        apellidoPaterno: datos.apellidoPaterno,
        apellidoMaterno: datos.apellidoMaterno ?? null,
        correo,
        tokenHash: this.hash(token),
        estado: 'pendiente',
        expiraEn,
      })
    } catch (error) {
      const e = error as { code?: string }
      if (e.code === '23505') {
        throw new SsoError('SSO-4001', {
          tecnico: `Ya existe INVITACION pendiente para correo='${correo}'. Índice parcial.`,
          causa: error,
        })
      }
      throw error
    }

    const deeplink = `mx.mediocres.sgeb://registro?token=${token}`
    await this.correo.invitacion(correo, datos.nombre, deeplink)

    return { token, deeplink, expiraEn }
  }

  /**
   * Invitaciones del sistema, para que el capitán vea a quién falta responder.
   *
   * **Nunca devuelve el token**, ni siquiera hasheado: quien tenga acceso al
   * panel podría completar el registro de otra persona. El deeplink solo existe
   * una vez, en la respuesta del alta y en el correo.
   */
  async listar(filtros: { estado?: string; idEmisor?: number } = {}) {
    const q = Invitacion.query().orderBy('creado_en', 'desc').limit(200)

    if (filtros.estado) q.where('estado', filtros.estado)
    if (filtros.idEmisor) q.where('id_emisor', filtros.idEmisor)

    const filas = await q

    /**
     * El estado `expirada` se deriva, no se persiste: una tarea que recorriera
     * la tabla marcándolas sería un proceso más que mantener para un dato que
     * se calcula con una comparación de fechas.
     */
    return filas.map((i) => {
      const vencida = i.estado === 'pendiente' && i.expiraEn < DateTime.now()
      return { ...i.serialize(), estado: vencida ? 'expirada' : i.estado }
    })
  }

  /**
   * Revoca una invitación pendiente.
   *
   * Se usa cuando el capitán se equivocó de correo o la persona ya no entra al
   * equipo. **Libera el correo**: el índice parcial solo admite una pendiente
   * por dirección, así que sin revocar la anterior no se puede reinvitar.
   */
  async revocar(idInvitacion: number, uuidResponsable: string): Promise<Invitacion> {
    const inv = await Invitacion.find(idInvitacion)
    if (!inv) throw errores.noEncontrado('INVITACION', idInvitacion)

    if (inv.estado === 'usada') {
      throw new SsoError('SSO-3002', {
        tecnico:
          `INVITACION id=${idInvitacion} ya usada por id_usuario=${inv.idUsuarioCreado}. ` +
          `La cuenta existe: para darla de baja use PATCH /usuarios/{uuid}.`,
      })
    }
    if (inv.estado === 'revocada') return inv

    inv.estado = 'revocada'
    await inv.save()

    logger.info(
      { idInvitacion, correo: inv.correo, responsable: uuidResponsable },
      'Invitación revocada'
    )
    return inv
  }

  /**
   * Reenvía la invitación: revoca la anterior y emite una nueva.
   *
   * No se reutiliza el token original a propósito. Si el correo no llegó, el
   * token viejo sigue vivo 72 horas; reemplazarlo cierra esa ventana y además
   * reinicia el plazo, que es lo que el capitán espera al reenviar.
   */
  async reenviar(idInvitacion: number, uuidResponsable: string) {
    const vieja = await Invitacion.find(idInvitacion)
    if (!vieja) throw errores.noEncontrado('INVITACION', idInvitacion)

    if (vieja.estado === 'usada') {
      throw new SsoError('SSO-3002', {
        tecnico: `INVITACION id=${idInvitacion} ya usada. No hay nada que reenviar.`,
      })
    }

    await this.revocar(idInvitacion, uuidResponsable)

    return this.invitar({
      idEmisor: vieja.idEmisor,
      idRolDestino: vieja.idRolDestino,
      nombre: vieja.nombre,
      apellidoPaterno: vieja.apellidoPaterno,
      apellidoMaterno: vieja.apellidoMaterno,
      correo: vieja.correo,
    })
  }

  /** Lee la invitación para pintar la pantalla S4. */
  async leer(token: string): Promise<Invitacion> {
    const inv = await Invitacion.query().where('token_hash', this.hash(token)).first()

    if (!inv || inv.estado !== 'pendiente' || inv.expiraEn < DateTime.now()) {
      /**
       * Un solo código para las tres causas (inexistente, usada, expirada).
       * Distinguirlas le diría a quien pruebe tokens al azar cuáles fueron
       * válidos alguna vez.
       */
      throw new SsoError('SSO-3002', {
        tecnico:
          `Invitación inválida. hash=${this.hash(token).slice(0, 12)}…, ` +
          `estado=${inv?.estado ?? 'inexistente'}, expira=${inv?.expiraEn?.toISO() ?? '—'}.`,
      })
    }
    return inv
  }

  /**
   * Crea la cuenta y los datos bancarios en UNA transacción.
   *
   * ────────────────────────────────────────────────────────────────────────
   * La CLABE nunca toca las tablas de autenticación. `USUARIO` es del módulo
   * de identidad y `DATOS_BANCARIOS` del de nómina; este método orquesta los
   * dos, pero los datos viven separados. Por eso el error de CLABE inválida es
   * `SGEB-2005`, de la serie de la aplicación, y no un código `SSO-`.
   * ────────────────────────────────────────────────────────────────────────
   */
  async registrar(datos: DatosRegistro): Promise<Usuario> {
    const inv = await this.leer(datos.token)

    if (!datos.aceptaPrivacidad) {
      throw new SsoError('SSO-4005', {
        tecnico: `acepta_privacidad=false en registro de invitación id=${inv.id}.`,
      })
    }
    if (datos.password !== datos.password2) {
      throw new SsoError('SSO-2007', { tecnico: 'Las contraseñas capturadas no coinciden.' })
    }
    if (!POLITICA_PASSWORD.test(datos.password)) {
      throw new SsoError('SSO-2006', {
        tecnico: `Contraseña fuera de política. longitud=${datos.password.length}. NUNCA loguear el valor.`,
      })
    }
    if (!/^\d{18}$/.test(datos.clabe) || !this.clabeValida(datos.clabe)) {
      throw new SsoError('SSO-2002', {
        tecnico:
          `CLABE='${datos.clabe.slice(0, 4)}…${datos.clabe.slice(-4)}': longitud o dígito de ` +
          `control incorrecto. Equivale a SGEB-2005 del lado de la aplicación.`,
      })
    }

    return db.transaction(async (trx) => {
      const usuario = await Usuario.create(
        {
          uuidUsuario: randomUUID(),
          idRol: inv.idRolDestino,
          nombre: inv.nombre,
          apellidoPaterno: inv.apellidoPaterno,
          apellidoMaterno: inv.apellidoMaterno,
          correo: inv.correo,
          passwordHash: await hash.make(datos.password),
          biometriaHabilitada: false,
          activo: true,
        },
        { client: trx }
      )

      await trx.table('datos_bancarios').insert({
        id_usuario: usuario.id,
        clabe: datos.clabe,
        banco: datos.banco.trim(),
        titular_cuenta: datos.titular.trim(),
        activo: true,
      })

      inv.estado = 'usada'
      inv.idUsuarioCreado = usuario.id
      inv.usadaEn = DateTime.now()
      await inv.useTransaction(trx).save()

      return usuario
    })
  }

  /**
   * Dígito verificador de la CLABE (algoritmo del Banco de México):
   * pesos 3,7,1 cíclicos sobre los 17 primeros dígitos.
   *
   * Atrapa el error de captura, que es lo frecuente: una CLABE mal tecleada que
   * pasa a nómina termina en una transferencia rechazada o, peor, enviada a la
   * cuenta de otra persona.
   */
  private clabeValida(clabe: string): boolean {
    const pesos = [3, 7, 1]
    let suma = 0
    for (let i = 0; i < 17; i++) {
      suma += ((Number(clabe[i]) * pesos[i % 3]) % 10)
    }
    return (10 - (suma % 10)) % 10 === Number(clabe[17])
  }
}
