import { DateTime } from 'luxon'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA SESIÓN DEL PROVEEDOR — lo que convierte esto en single sign-on
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sin esta pieza, cada aplicación tendría que autenticar por su cuenta y lo que
 * existiría sería un login centralizado bien hecho, no un inicio de sesión
 * único. La diferencia está exactamente aquí: el proveedor mantiene SU PROPIA
 * sesión con el usuario, y cuando una segunda aplicación llega a `/authorize`,
 * la reconoce y emite el código sin preguntar nada.
 *
 * La cookie pertenece al origen del proveedor (auth.sgeb.mediocres.mx), no al
 * de la API. Por eso el proveedor necesita subdominio propio y no una ruta
 * `/auth` dentro de la API: una cookie de sesión compartida entre ambos ataría
 * los dos componentes y arruinaría la ruta de extracción.
 *
 * `sid` viaja en los tokens que emite esta sesión. Es lo que permite que
 * "cerrar sesión en todos mis equipos" revoque exactamente esta cadena, y no
 * todas las sesiones del usuario en todos sus dispositivos.
 */

const NOMBRE_COOKIE = 'sso_session'
const VIGENCIA_HORAS = 12

export interface SesionSso {
  sid: string
  idUsuario: number
  uuidUsuario: string
  metodoLogin: 'password' | 'password_2fa'
  creadaEn: DateTime
}

export class SesionSsoService {
  private hash(valor: string): string {
    return createHash('sha256').update(valor).digest('hex')
  }

  /**
   * Crea la sesión y planta la cookie.
   *
   * `httpOnly` para que un XSS en cualquier pantalla del proveedor no pueda
   * leerla. `sameSite: lax` y no `strict` porque la cookie tiene que sobrevivir
   * al redirect de vuelta desde el cliente: con `strict` el navegador no la
   * enviaría y el salto entre aplicaciones nunca ocurriría.
   */
  async crear(
    ctx: HttpContext,
    datos: { idUsuario: number; uuidUsuario: string; metodoLogin: 'password' | 'password_2fa' }
  ): Promise<string> {
    const sid = randomUUID()
    const secreto = randomBytes(32).toString('base64url')

    await db.table('auth.sesion_sso').insert({
      sid,
      cookie_hash: this.hash(secreto),
      id_usuario: datos.idUsuario,
      metodo_login: datos.metodoLogin,
      expira_en: DateTime.now().plus({ hours: VIGENCIA_HORAS }).toSQL(),
    })

    ctx.response.cookie(NOMBRE_COOKIE, secreto, {
      httpOnly: true,
      /**
       * `Secure` fuera de desarrollo. En local el proveedor corre sobre `http`
       * y el navegador descartaría la cookie sin avisar: el F5 llegaría a
       * `/authorize?...&prompt=none` sin `sso_session` y el proveedor
       * respondería "sesión expirada" aunque la sesión siga viva.
       *
       * Mismo criterio que `sgeb_refresh` en protocolo_controller.ts.
       */
      secure: !app.inDev,
      sameSite: 'lax',
      path: '/',
      maxAge: VIGENCIA_HORAS * 60 * 60,
    })

    return sid
  }

  /**
   * Lee la sesión vigente, si la hay.
   *
   * Devuelve `null` en vez de lanzar: la ausencia de sesión es el caso normal
   * del primer login, no un error. Es `/authorize` quien decide qué hacer con
   * ese null según `prompt`.
   */
  async vigente(ctx: HttpContext): Promise<SesionSso | null> {
    const secreto = ctx.request.cookie(NOMBRE_COOKIE, '')
    if (!secreto) return null

    const fila = await db
      .from('auth.sesion_sso')
      .where('cookie_hash', this.hash(secreto))
      .where('revocada', false)
      .first()

    if (!fila || new Date(fila.expira_en) < new Date()) return null

    const usuario = await db
      .from('usuario')
      .where('id_usuario', fila.id_usuario)
      .select('uuid_usuario', 'activo')
      .first()

    /**
     * La cuenta pudo desactivarse con la sesión abierta. Se revisa aquí porque
     * es el único punto donde el proveedor vuelve a mirar al usuario: los
     * access tokens se validan por firma, sin tocar la base.
     */
    if (!usuario || !usuario.activo) {
      await this.revocarPorSid(fila.sid)
      return null
    }

    return {
      sid: fila.sid,
      idUsuario: fila.id_usuario,
      uuidUsuario: usuario.uuid_usuario,
      metodoLogin: fila.metodo_login,
      creadaEn: DateTime.fromJSDate(new Date(fila.creado_en)),
    }
  }

  /** Cierre de sesión único: destruye la sesión y borra la cookie. */
  async destruir(ctx: HttpContext): Promise<number | null> {
    const secreto = ctx.request.cookie(NOMBRE_COOKIE, '')
    ctx.response.clearCookie(NOMBRE_COOKIE, { path: '/' })
    if (!secreto) return null

    const fila = await db.from('auth.sesion_sso').where('cookie_hash', this.hash(secreto)).first()
    if (!fila) return null

    await this.revocarPorSid(fila.sid)
    return fila.id_usuario as number
  }

  private async revocarPorSid(sid: string): Promise<void> {
    await db.from('auth.sesion_sso').where('sid', sid).update({ revocada: true })
  }
}
