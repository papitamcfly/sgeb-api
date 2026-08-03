import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { errores } from '#shared/errors/sgeb_error'
import type { Sujeto } from './jwt_auth.js'

/**
 * Autorización por rol. Emite SGEB-1004.
 *
 * Se usa como `middleware.rol(['capitan', 'admin'])` en las rutas.
 *
 * Importante: esto resuelve "¿este ROL puede tocar este ENDPOINT?", que es una
 * pregunta distinta de "¿este USUARIO puede tocar ESTE recurso?". La segunda
 * (un capitán abriendo el dashboard de un evento que no es suyo) no se puede
 * contestar sin ir a la base de datos, así que vive en la capa de servicios.
 * Ambas responden SGEB-1004: para el usuario es el mismo "no tienes permisos".
 */
export default class RolMiddleware {
  async handle(ctx: HttpContext, next: NextFn, permitidos: Array<Sujeto['rol']>) {
    const sujeto = ctx.sujeto

    if (!sujeto) {
      throw new Error(
        'RolMiddleware se ejecutó sin sujeto en el contexto. ' +
          'Debe registrarse SIEMPRE después de JwtAuthMiddleware en start/kernel.ts.'
      )
    }

    if (!permitidos.includes(sujeto.rol)) {
      throw errores.sinPermisos(
        sujeto.rol,
        sujeto.uuid,
        ctx.request.method(),
        ctx.request.url(),
        permitidos
      )
    }

    return next()
  }
}
