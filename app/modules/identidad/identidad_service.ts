import { SgebError } from '#shared/errors/sgeb_error'
import Usuario from '#modules/identidad/models/usuario'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA COSTURA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Esta interfaz es la ÚNICA puerta entre el dominio y el módulo de identidad.
 * Ningún módulo de negocio importa modelos de identidad ni consulta sus tablas.
 *
 * El día que el SSO se extraiga a un servidor propio, se sustituye la
 * implementación por una que hable HTTP y el resto del código no se entera.
 * Si alguien escribe `Usuario.query().join('evento')` en un servicio de
 * eventos, esa extracción deja de ser posible: es la regla que más fácil se
 * rompe "para sacar un reporte rápido" y la que más caro cuesta después.
 *
 * Se declara como CLASE ABSTRACTA y no como interfaz por una razón práctica:
 * una interfaz de TypeScript desaparece al compilar, así que no puede servir de
 * llave en el contenedor de dependencias. La clase abstracta existe en tiempo de
 * ejecución, se usa como token de inyección y sigue sin poder instanciarse.
 *
 * Referencias: Diccionario de Datos v3 Anexo D · Entorno Tecnológico v0.4 §8.2
 */
export abstract class IdentidadService {
  /**
   * Traduce el UUID público al identificador interno.
   *
   * Se invoca UNA VEZ por petición, desde el middleware de resolución de
   * sujeto, y el resultado queda en el contexto. Llamarlo desde cada servicio
   * multiplica los viajes a la base de datos sin ganar nada.
   */
  abstract resolverPorUuid(uuid: string): Promise<UsuarioResuelto>

  /** Datos públicos de un usuario, para pintarlo en una lista o un detalle. */
  abstract perfil(uuid: string): Promise<PerfilPublico>

  /** Varios de golpe. Evita el N+1 al pintar la plantilla de un evento. */
  abstract perfiles(uuids: string[]): Promise<Map<string, PerfilPublico>>

  /**
   * Valida que un UUID corresponda a un usuario activo con alguno de los roles
   * indicados. Lo usa la creación de evento con `uuid_capitan`: SGEB-3002 si no
   * existe, SGEB-4023 si existe pero no le toca.
   */
  abstract exigirRol(
    uuid: string,
    roles: Array<'admin' | 'capitan' | 'mesero'>
  ): Promise<UsuarioResuelto>
}

export interface UsuarioResuelto {
  /**
   * Identificador entero interno. Llave de los JOIN.
   * NUNCA se serializa hacia el cliente: ver migracion-uuid-usuario.md.
   */
  id: number
  uuid: string
  rol: 'admin' | 'capitan' | 'mesero'
  activo: boolean
}

export interface PerfilPublico {
  uuid_usuario: string
  nombre_completo: string
  rol: 'admin' | 'capitan' | 'mesero'
  activo: boolean
}

/**
 * Implementación local: el módulo vive en el mismo proceso y consulta la misma
 * instancia de PostgreSQL, en su propio esquema.
 */
export class IdentidadLocal extends IdentidadService {
  async resolverPorUuid(uuid: string): Promise<UsuarioResuelto> {
    const u = await Usuario.query().where('uuid_usuario', uuid).preload('rol').first()

    if (!u) {
      /**
       * Un token bien firmado cuyo sujeto no existe en la base significa que la
       * cuenta se borró mientras el token seguía vivo. Es un problema de sesión,
       * no de recurso: por eso 1003 y no 3001. Además, responder "no encontrado"
       * confirmaría al portador que su UUID es válido pero la cuenta ya no.
       */
      throw new SgebError('SGEB-1003', {
        tecnico: `Token válido con sub=${uuid} sin correspondencia en USUARIO.`,
      })
    }

    return { id: u.id, uuid: u.uuidUsuario, rol: u.rol.nombre, activo: u.activo }
  }

  async perfil(uuid: string): Promise<PerfilPublico> {
    const u = await this.buscar(uuid)
    return this.aPerfil(u)
  }

  async perfiles(uuids: string[]): Promise<Map<string, PerfilPublico>> {
    if (uuids.length === 0) return new Map()
    const filas = await Usuario.query().whereIn('uuid_usuario', uuids).preload('rol')
    return new Map(filas.map((u) => [u.uuidUsuario, this.aPerfil(u)]))
  }

  async exigirRol(uuid: string, roles: Array<'admin' | 'capitan' | 'mesero'>) {
    const u = await Usuario.query().where('uuid_usuario', uuid).preload('rol').first()

    // Inexistente = integridad referencial rota, igual que cualquier otra FK.
    if (!u) {
      throw new SgebError('SGEB-3002', {
        tecnico: `uuid_usuario='${uuid}' no existe en USUARIO.`,
      })
    }

    // Existe pero no califica = regla de negocio.
    if (!u.activo || !roles.includes(u.rol.nombre)) {
      throw new SgebError('SGEB-4023', {
        tecnico:
          `uuid=${uuid} tiene rol='${u.rol.nombre}' y activo=${u.activo}. ` +
          `Requiere uno de: ${roles.join('|')} activo.`,
      })
    }

    return { id: u.id, uuid: u.uuidUsuario, rol: u.rol.nombre, activo: u.activo }
  }

  private async buscar(uuid: string) {
    const u = await Usuario.query().where('uuid_usuario', uuid).preload('rol').first()
    if (!u) {
      throw new SgebError('SGEB-3001', {
        tecnico: `SELECT USUARIO WHERE uuid_usuario='${uuid}' → 0 filas.`,
      })
    }
    return u
  }

  private aPerfil(u: Usuario): PerfilPublico {
    return {
      uuid_usuario: u.uuidUsuario,
      nombre_completo: [u.nombre, u.apellidoPaterno, u.apellidoMaterno].filter(Boolean).join(' '),
      rol: u.rol.nombre,
      activo: u.activo,
    }
  }
}

/**
 * Esqueleto de la implementación remota. No se usa hoy; existe para que la ruta
 * de extracción esté escrita y no haya que improvisarla bajo presión.
 *
 * export class IdentidadRemota implements IdentidadService {
 *   async resolverPorUuid(uuid: string) {
 *     const r = await fetch(`${env.get('SSO_BASE_URL')}/interno/usuarios/${uuid}`, {
 *       headers: { authorization: `Bearer ${await this.tokenDeServicio()}` },
 *     })
 *     ...
 *   }
 * }
 */
