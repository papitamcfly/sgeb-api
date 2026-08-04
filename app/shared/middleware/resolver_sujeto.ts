import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { inject } from '@adonisjs/core'
/**
 * `IdentidadService` se importa como VALOR, no con `import type`.
 *
 * El contenedor resuelve las dependencias leyendo los metadatos que TypeScript
 * emite para los parámetros del constructor. `import type` se borra al compilar,
 * así que el metadato queda como `Object` y la inyección falla en tiempo de
 * ejecución con "Cannot inject [Function: Object]" — un error que el typecheck
 * no puede ver, porque a nivel de tipos todo cuadra.
 *
 * `UsuarioResuelto` sí es solo un tipo y va aparte.
 */
import { IdentidadService } from '#modules/identidad/identidad_service'
import type { UsuarioResuelto } from '#modules/identidad/identidad_service'

/**
 * Traduce el UUID del token al usuario interno, UNA sola vez por petición.
 *
 * Se registra después de JwtAuthMiddleware y antes de los controladores. El
 * resultado queda en `ctx.usuario`, de donde lo toman los servicios que
 * necesitan el identificador entero para sus JOIN.
 *
 * Por qué aquí y no en cada servicio: si cada uno resuelve por su cuenta, una
 * petición que toca tres servicios hace tres SELECT idénticos. Con el índice
 * único sobre uuid_usuario cada uno es barato, pero el patrón se multiplica
 * solo, y en el dashboard —que toca ocho agregados— se nota.
 *
 * Se salta en las rutas públicas (comensal por QR) y en las que no necesitan
 * el entero, como las que solo comparan UUIDs.
 */
@inject()
export default class ResolverSujetoMiddleware {
  constructor(private identidad: IdentidadService) {}

  async handle(ctx: HttpContext, next: NextFn) {
    ctx.usuario = await this.identidad.resolverPorUuid(ctx.sujeto.uuid)
    return next()
  }
}

declare module '@adonisjs/core/http' {
  interface HttpContext {
    usuario: UsuarioResuelto
  }
}
