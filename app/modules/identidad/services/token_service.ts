import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SignJWT, importPKCS8 } from 'jose'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import RefreshToken from '#modules/identidad/models/refresh_token'
import Usuario from '#modules/identidad/models/usuario'
import { SsoError } from '#modules/identidad/errores_sso'
import { LlaveFirmaService } from './llave_firma_service.js'

/**
 * Emisión y renovación de tokens.
 *
 * Cuatro artefactos distintos, que suelen agruparse mal bajo la palabra "token":
 *
 *   access token   JWT firmado, 15 min, en memoria (web) o Keychain (iOS)
 *   id token       JWT firmado, 15 min, lo consume el CLIENTE, no la API
 *   refresh token  opaco, 12 h web / 30 días móvil, rotativo
 *   sesión SSO     cookie del proveedor, 12 h — vive fuera de este servicio
 */

const VIGENCIA_ACCESS_SEG = 15 * 60
const VIGENCIA_REFRESH: Record<'web' | 'movil', number> = {
  /** Web: 12 h. La sesión del proveedor cubre el resto de la jornada. */
  web: 12 * 60 * 60,
  /** Móvil: 30 días. El mesero no debe recapturar credenciales en cada evento. */
  movil: 30 * 24 * 60 * 60,
}

export interface TokensEmitidos {
  access_token: string
  id_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
}

export class TokenService {
  constructor(private llaves = new LlaveFirmaService()) {}

  /**
   * SHA-256 en hexadecimal minúsculas.
   *
   * Los tokens opacos se guardan hasheados, nunca en claro: un volcado de la
   * base no debe entregar sesiones utilizables. Se usa SHA-256 y no Bcrypt
   * porque el valor ya es aleatorio de 32 bytes —no hay nada que ralentizar
   * contra fuerza bruta— y porque hay que buscarlo por igualdad en cada canje.
   */
  private hash(valor: string): string {
    return createHash('sha256').update(valor).digest('hex')
  }

  private async firmar(
    claims: Record<string, unknown>,
    audiencia: string,
    vigenciaSeg: number
  ): Promise<string> {
    const { kid, algoritmo, privadaPem } = await this.llaves.activa()
    const key = await importPKCS8(privadaPem, algoritmo)

    return new SignJWT(claims)
      .setProtectedHeader({ alg: algoritmo, kid, typ: 'JWT' })
      .setIssuer(env.get('SSO_ISSUER'))
      .setAudience(audiencia)
      .setSubject(String(claims.sub))
      .setIssuedAt()
      .setExpirationTime(`${vigenciaSeg}s`)
      .setJti(randomUUID())
      .sign(key)
  }

  /**
   * Emite el trío completo para un usuario ya autenticado.
   *
   * `sid` ata todos los tokens a una misma sesión del proveedor: es lo que
   * permite que "cerrar sesión en todos mis equipos" revoque exactamente esa
   * cadena y no todas las del usuario.
   */
  async emitir(opciones: {
    usuario: Usuario
    rol: string
    cliente: 'web' | 'movil'
    metodoLogin: 'password' | 'password_2fa'
    scope: string
    sid: string
    idDispositivo?: number | null
    idPadre?: number | null
    ip?: string | null
    userAgent?: string | null
    /**
     * Transacción del llamador. **Obligatoria cuando `idPadre` viene definido.**
     *
     * `REFRESH_TOKEN.id_padre` es una llave foránea a la propia tabla. Si el
     * INSERT del token nuevo corre en otra conexión mientras `rotar()` mantiene
     * un `FOR UPDATE` sobre la fila padre, PostgreSQL necesita un `FOR KEY
     * SHARE` sobre esa misma fila para validar la llave foránea — y ese lock
     * choca con el `FOR UPDATE`.
     *
     * El resultado es un bloqueo que la base **no detecta como interbloqueo**:
     * ve al INSERT esperando a una transacción que, desde su punto de vista,
     * está simplemente inactiva. La petición se queda colgada hasta que algún
     * temporizador de red la corta.
     */
    trx?: TransactionClientContract
  }): Promise<TokensEmitidos> {
    const { usuario, rol, cliente, scope, sid } = opciones

    /**
     * El access token NO transporta datos personales: ni correo, ni teléfono,
     * ni CLABE. Un JWT está firmado, no cifrado — cualquiera que lo intercepte
     * puede leer su contenido en claro.
     */
    const accessToken = await this.firmar(
      {
        sub: usuario.uuidUsuario,
        rol,
        scope,
        sid,
        amr: opciones.metodoLogin === 'password_2fa' ? ['pwd', 'mfa'] : ['pwd'],
      },
      env.get('SSO_AUDIENCE'),
      VIGENCIA_ACCESS_SEG
    )

    /**
     * El id token sí lleva identidad, porque lo consume el cliente para pintar
     * la pantalla. Su audiencia es el client_id, no la API: la API de SGEB
     * nunca debe aceptarlo como credencial.
     */
    const idToken = await this.firmar(
      {
        sub: usuario.uuidUsuario,
        name: [usuario.nombre, usuario.apellidoPaterno].filter(Boolean).join(' '),
        email: usuario.correo,
        email_verified: true,
        rol,
        sid,
      },
      cliente === 'web' ? 'sgeb-web-panel' : 'sgeb-ios-mesero',
      VIGENCIA_ACCESS_SEG
    )

    const refreshClaro = randomBytes(32).toString('base64url')
    await RefreshToken.create(
      {
      idUsuario: usuario.id,
      idDispositivo: opciones.idDispositivo ?? null,
      tokenHash: this.hash(refreshClaro),
      idPadre: opciones.idPadre ?? null,
      cliente,
      metodoLogin: opciones.metodoLogin,
      ip: opciones.ip ?? null,
      userAgent: opciones.userAgent ?? null,
      expiraEn: DateTime.now().plus({ seconds: VIGENCIA_REFRESH[cliente] }),
      revocado: false,
      },
      opciones.trx ? { client: opciones.trx } : {}
    )

    return {
      access_token: accessToken,
      id_token: idToken,
      refresh_token: refreshClaro,
      token_type: 'Bearer',
      expires_in: VIGENCIA_ACCESS_SEG,
      scope,
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  ROTACIÓN CON DETECCIÓN DE REÚSO
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Cada canje revoca el token presentado y emite uno nuevo encadenado. Si
   * llega uno **ya revocado**, hay dos explicaciones y ninguna es buena:
   * alguien lo robó y lo está usando, o el legítimo lo reenvió porque perdió
   * la respuesta. No se pueden distinguir, así que se asume el peor caso y se
   * revoca la cadena completa del usuario (SSO-1007).
   *
   * Es agresivo a propósito: el costo de un falso positivo es que el mesero
   * vuelva a capturar su contraseña; el de un falso negativo es una sesión
   * robada que dura 30 días.
   */
  async rotar(opciones: {
    refreshToken: string
    cliente: 'web' | 'movil'
    ip?: string | null
    userAgent?: string | null
  }): Promise<TokensEmitidos> {
    const hash = this.hash(opciones.refreshToken)
    /**
     * `let` con tipo explícito: TypeScript estrecha a `never` si infiere el tipo
     * solo del valor inicial `null` y la asignación ocurre dentro de un closure.
     */
    let reusoDeUsuario: number | null = null
    let desactivada: number | null = null

    try {
      return await db.transaction(async (trx) => {
      const fila = await RefreshToken.query({ client: trx })
        .where('token_hash', hash)
        .forUpdate()
        .first()

      if (!fila) {
        throw new SsoError('SSO-1006', {
          tecnico: `Refresh token inexistente. hash=${hash.slice(0, 12)}… (prefijo).`,
        })
      }

      /**
       * ── Reúso detectado ───────────────────────────────────────────────
       * La revocación NO puede ir dentro de esta transacción: el `throw` que
       * viene a continuación provocaría un rollback y desharía justo lo que
       * queremos que ocurra. Se marca el caso y se revoca fuera, ya cerrada la
       * transacción. Es la diferencia entre detectar el robo y responder a él.
       */
      if (fila.revocado) {
        reusoDeUsuario = fila.idUsuario
        throw new SsoError('SSO-1007', {
          tecnico:
            `REÚSO DE REFRESH TOKEN. id_refresh=${fila.id}, id_padre=${fila.idPadre}, ` +
            `id_usuario=${fila.idUsuario}. Revocando la cadena completa fuera de la ` +
            `transacción. Posible robo de credenciales; revisar INTENTO_LOGIN e IPs recientes.`,
        })
      }

      if (fila.expiraEn < DateTime.now()) {
        throw new SsoError('SSO-1006', {
          tecnico: `Refresh token expirado el ${fila.expiraEn.toISO()}. id_refresh=${fila.id}.`,
        })
      }

      const usuario = await Usuario.query({ client: trx })
        .where('id_usuario', fila.idUsuario)
        .preload('rol')
        .first()

      if (!usuario) {
        throw new SsoError('SSO-1006', {
          tecnico: `Refresh token válido para id_usuario=${fila.idUsuario} inexistente.`,
        })
      }

      /**
       * La cuenta pudo desactivarse mientras el token seguía vivo. Se revisa en
       * cada canje porque es el único momento en que el proveedor vuelve a ver
       * al usuario: el access token se valida por firma, sin tocar la base.
       */
      if (!usuario.activo) {
        // Misma razón que arriba: revocar fuera, o el rollback lo deshace.
        desactivada = fila.idUsuario
        throw new SsoError('SSO-1005', {
          tecnico: `USUARIO.activo=0 para id_usuario=${fila.idUsuario}. Revocando cadena fuera de la transacción.`,
        })
      }

      fila.revocado = true
      fila.ultimoUso = DateTime.now()
      await fila.useTransaction(trx).save()

      return this.emitir({
        usuario,
        rol: usuario.rol.nombre,
        cliente: opciones.cliente,
        metodoLogin: fila.metodoLogin,
        scope: 'openid perfil sgeb.api',
        sid: randomUUID(),
        idDispositivo: fila.idDispositivo,
        idPadre: fila.id,
        ip: opciones.ip,
        userAgent: opciones.userAgent,
        trx,
      })
      })
    } finally {
      /**
       * `finally` y no `catch`: debe ejecutarse aunque el throw se propague, y
       * su fallo no debe enmascarar el SsoError original.
       */
      if (reusoDeUsuario !== null) await this.revocarCadena(reusoDeUsuario)
      if (desactivada !== null) await this.revocarCadena(desactivada)
    }
  }

  /** Cierra la sesión de ESTA aplicación. La sesión del proveedor sigue viva. */
  async revocar(refreshToken: string): Promise<void> {
    /**
     * No informa si el token existía. La especificación lo exige así para no
     * convertir el endpoint en un oráculo que permita averiguar qué tokens son
     * válidos probándolos uno a uno.
     */
    await RefreshToken.query()
      .where('token_hash', this.hash(refreshToken))
      .where('revocado', false)
      .update({ revocado: true })
  }

  /** Cierra sesión en TODOS los equipos: destruye la cadena completa del sid. */
  async revocarCadena(idUsuario: number): Promise<number> {
    return RefreshToken.query()
      .where('id_usuario', idUsuario)
      .where('revocado', false)
      .update({ revocado: true })
      .then((r) => Number(r))
  }
}
