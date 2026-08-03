import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

/**
 * Rutas del SGEB. Un archivo por módulo bajo start/routes/, agrupados aquí.
 *
 * Este archivo muestra las tres formas de proteger una ruta; el resto de los
 * módulos las repiten. Convenciones:
 *
 *  - Prefijo /v1 en todo, según `servers` de openapi-sgeb.yaml.
 *  - `/usuarios/me` ANTES que `/usuarios/:uuid_usuario`, o el router intenta
 *    interpretar "me" como un UUID y devuelve SGEB-2002.
 *  - Los parámetros de UUID llevan matcher: un identificador malformado es un
 *    problema de formato (SGEB-2002), no de recurso inexistente (SGEB-3001).
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  PROVEEDOR DE IDENTIDAD — sin prefijo /v1 y sin envelope.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Estas rutas siguen la especificación OAuth 2.1 / OIDC al pie de la letra:
 * las URLs son las que esperan las librerías cliente estándar. En producción
 * viven bajo el subdominio auth.sgeb.mediocres.mx, con su propio origen, para
 * que la cookie de sesión SSO pertenezca al proveedor y no a la API.
 */
router.get('/.well-known/openid-configuration', '#modules/identidad/controllers/protocolo_controller.descubrimiento')
router.get('/.well-known/jwks.json', '#modules/identidad/controllers/protocolo_controller.jwks')
router.get('/authorize', '#modules/identidad/controllers/protocolo_controller.authorize')
router.post('/token', '#modules/identidad/controllers/protocolo_controller.token')
router.get('/userinfo', '#modules/identidad/controllers/protocolo_controller.userinfo')
router.get('/logout', '#modules/identidad/controllers/protocolo_controller.logout')
router.post('/token/revoke', '#modules/identidad/controllers/protocolo_controller.revocar')

router
  .group(() => {
    // ---------------------------------------------------------------- pública
    // Sin token de usuario: el comensal es anónimo, entra por QR.
    router
      .group(() => {
        router.get('/mesas/:codigo_qr', '#modules/eventos/controllers/publico_controller.mesa')
        router.post('/mesas/:codigo_qr/solicitudes', '#modules/eventos/controllers/publico_controller.solicitar')
      })
      .prefix('/publico')

    // ---------------------------------------------------------------- usuario en sesión
    // Solo `auth` + `sujeto`: cualquier rol autenticado puede operar sobre sí mismo.
    router
      .group(() => {
        router.get('/usuarios/me', '#modules/identidad/controllers/perfil_controller.mostrar')
        router.put('/usuarios/me', '#modules/identidad/controllers/perfil_controller.actualizar')
        router.get('/usuarios/me/datos-bancarios', '#modules/identidad/controllers/datos_bancarios_controller.mostrarPropio')
        router.post('/usuarios/me/datos-bancarios', '#modules/identidad/controllers/datos_bancarios_controller.registrarPropio')
      })
      .use([middleware.auth(), middleware.sujeto()])

    // ---------------------------------------------------------------- administrativa
    // Añade `rol`: el endpoint completo está vedado a los meseros.
    router
      .group(() => {
        router.get('/usuarios', '#modules/identidad/controllers/usuarios_controller.listar')
        router
          .get('/usuarios/:uuid_usuario', '#modules/identidad/controllers/usuarios_controller.mostrar')
          .where('uuid_usuario', UUID_V4)

        router.post('/salones', '#modules/eventos/controllers/salones_controller.crear')
        router.put('/salones/:id', '#modules/eventos/controllers/salones_controller.actualizar')
        router.delete('/salones/:id', '#modules/eventos/controllers/salones_controller.desactivar')

        router.get('/dashboard/capitan', '#modules/dashboard/controllers/dashboard_controller.capitan')
        router.get('/eventos/:id_evento/dashboard', '#modules/dashboard/controllers/dashboard_controller.evento')
      })
      .use([middleware.auth(), middleware.sujeto(), middleware.rol(['capitan', 'admin'])])

    // ---------------------------------------------------------------- mesero en piso
    router
      .group(() => {
        router.post(
          '/participaciones/:id_participacion/confirmacion-llegada',
          '#modules/participaciones/controllers/llegada_controller.confirmar'
        )
      })
      .use([middleware.auth(), middleware.sujeto(), middleware.rol(['mesero'])])
  })
  .prefix('/v1')
