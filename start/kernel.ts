import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

/**
 * Manejador global de excepciones. Es lo que garantiza que TODA respuesta
 * —incluido el fallo no previsto— salga con el envelope result/data.
 */
server.errorHandler(() => import('#exceptions/handler'))

/**
 * Middleware de servidor: corre en todas las peticiones, incluso las que no
 * coinciden con ninguna ruta. Por eso el 404 también sale con envelope.
 */
server.use([
  () => import('@adonisjs/cors/cors_middleware'),
  () => import('#shared/middleware/trace_id'),
])

router.use([() => import('@adonisjs/core/bodyparser_middleware')])

/**
 * Middleware con nombre, para usar en rutas.
 *
 * El ORDEN importa y no es intercambiable:
 *   auth    → valida la firma del token y llena ctx.sujeto
 *   sujeto  → traduce el UUID al usuario interno y llena ctx.usuario
 *   rol     → autoriza contra ctx.sujeto.rol
 *
 * `rol` puede ir sin `sujeto` (solo necesita el claim, no la base de datos),
 * pero nunca sin `auth`. `sujeto` sin `auth` truena en tiempo de ejecución.
 */
export const middleware = router.named({
  auth: () => import('#shared/middleware/jwt_auth'),
  sujeto: () => import('#shared/middleware/resolver_sujeto'),
  rol: () => import('#shared/middleware/rol'),
})
