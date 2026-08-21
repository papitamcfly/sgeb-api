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
router
  .get('/userinfo', '#modules/identidad/controllers/protocolo_controller.userinfo')
  .use([middleware.auth()])
router.get('/logout', '#modules/identidad/controllers/protocolo_controller.logout')
router.post('/token/revoke', '#modules/identidad/controllers/protocolo_controller.revocar')

/**
 * Pantallas del proveedor (wireframes S1–S7). Mismo origen que /authorize.
 *
 * NINGUNA aplicación cliente llama a estas rutas: las consume la propia
 * interfaz del proveedor. Una petición a /interno/login desde el panel React o
 * desde iOS significa que esa aplicación está manipulando la contraseña del
 * usuario, que es justo lo que este flujo existe para evitar.
 */
router
  .group(() => {
    router.get('/login', '#modules/identidad/controllers/interno_controller.mostrarLogin')
    router.post('/login', '#modules/identidad/controllers/interno_controller.login')
    router.post('/verificacion', '#modules/identidad/controllers/interno_controller.verificacion')
    router.get('/verificacion/reenviar', '#modules/identidad/controllers/interno_controller.reenviar')
    router.get('/registro', '#modules/identidad/controllers/interno_controller.mostrarRegistro')
    router.post('/registro', '#modules/identidad/controllers/interno_controller.registro')
    router.get('/recuperar', '#modules/identidad/controllers/interno_controller.mostrarRecuperar')
    router.post('/recuperar', '#modules/identidad/controllers/interno_controller.recuperar')
    router.get('/recuperar/nueva', '#modules/identidad/controllers/interno_controller.mostrarNuevaPassword')
    router.post('/recuperar/confirmar', '#modules/identidad/controllers/interno_controller.confirmarRecuperacion')
  })
  .prefix('/interno')

router
  .group(() => {
    // ---------------------------------------------------------------- pública
    // Sin token de usuario: el comensal es anónimo, entra por QR.
    router
      .group(() => {
        router.get('/mesas/:codigo_qr', '#modules/eventos/controllers/publico_controller.mesa')
        router.post('/mesas/:codigo_qr/solicitudes', '#modules/comensal/controllers/comensal_controller.solicitar')
        router.post('/mesas/:codigo_qr/calificaciones', '#modules/comensal/controllers/comensal_controller.calificar')
        /** Emite el token que el navegador conserva para calificar una sola vez. */
        router.post('/mesas/:codigo_qr/token', '#modules/comensal/controllers/comensal_controller.token')
      })
      .prefix('/publico')

    // ---------------------------------------------------------------- usuario en sesión
    // Solo `auth` + `sujeto`: cualquier rol autenticado puede operar sobre sí mismo.
    router
      .group(() => {
        router.get('/usuarios/me', '#modules/identidad/controllers/usuarios_controller.miPerfil')
      })
      .use([middleware.auth(), middleware.sujeto()])

    // ---------------------------------------------------------------- capitán y admin
    router
      .group(() => {
        router.get('/salones', '#modules/eventos/controllers/salones_controller.listar')
        router.post('/salones', '#modules/eventos/controllers/salones_controller.crear')
        router.get('/salones/:id_salon', '#modules/eventos/controllers/salones_controller.mostrar')
        router.put('/salones/:id_salon', '#modules/eventos/controllers/salones_controller.actualizar')
        router.delete('/salones/:id_salon', '#modules/eventos/controllers/salones_controller.desactivar')

        router.post('/eventos', '#modules/eventos/controllers/eventos_controller.crear')
        router.put('/eventos/:id_evento', '#modules/eventos/controllers/eventos_controller.actualizar')
        router.patch('/eventos/:id_evento/estado', '#modules/eventos/controllers/eventos_controller.cambiarEstado')

        router.post('/eventos/:id_evento/mesas', '#modules/eventos/controllers/eventos_controller.agregarMesa')
        router.delete('/eventos/:id_evento/mesas/:id_mesa', '#modules/eventos/controllers/eventos_controller.eliminarMesa')
        router.post('/eventos/:id_evento/mesas/:id_mesa/regenerar-qr', '#modules/eventos/controllers/eventos_controller.regenerarQr')

        router.patch('/participaciones/:id_participacion/estado', '#modules/participaciones/controllers/participaciones_controller.cambiarEstado')
        router.post('/participaciones/:id_participacion/asignaciones', '#modules/participaciones/controllers/participaciones_controller.asignarMesa')
        router.delete('/asignaciones/:id_asignacion', '#modules/participaciones/controllers/participaciones_controller.liberarMesa')

        // ── Catálogo del menú y barra ─────────────────────────────────
        router.get('/insumos', '#modules/menu/controllers/menu_controller.listarInsumos')
        router.post('/insumos', '#modules/menu/controllers/menu_controller.crearInsumo')
        router.patch('/insumos/:id_insumo/estado', '#modules/menu/controllers/menu_controller.cambiarEstadoInsumo')
        router.delete('/insumos/:id_insumo', '#modules/menu/controllers/menu_controller.desactivarInsumo')

        router.post('/bebidas', '#modules/menu/controllers/menu_controller.crearBebida')
        router.put('/bebidas/:id_bebida/receta', '#modules/menu/controllers/menu_controller.definirReceta')
        router.delete('/bebidas/:id_bebida', '#modules/menu/controllers/menu_controller.desactivarBebida')

        router.post('/envases', '#modules/menu/controllers/menu_controller.crearEnvase')
        router.delete('/envases/:id_envase', '#modules/menu/controllers/menu_controller.desactivarEnvase')

        // ── Cubaitor y configuración de pines ─────────────────────────
        router.get('/cubaitors', '#modules/cubaitor/controllers/cubaitor_controller.listar')
        router.post('/cubaitors', '#modules/cubaitor/controllers/cubaitor_controller.registrar')
        router.post('/cubaitors/heartbeat', '#modules/cubaitor/controllers/cubaitor_controller.heartbeat')
        router.get('/cubaitors/:id_cubaitor/estado', '#modules/cubaitor/controllers/cubaitor_controller.estado')

        router.get('/eventos/:id_evento/config-dispensado', '#modules/cubaitor/controllers/cubaitor_controller.listarConfig')
        router.post('/eventos/:id_evento/config-dispensado', '#modules/cubaitor/controllers/cubaitor_controller.configurarPin')
        router.patch('/eventos/:id_evento/config-dispensado/:id_config/recarga', '#modules/cubaitor/controllers/cubaitor_controller.recargar')

        /** Las calificaciones solo las ve el capitán: son evaluación del personal. */
        router.get('/eventos/:id_evento/calificaciones', '#modules/comensal/controllers/comensal_controller.listarCalificaciones')


        // ── Invitaciones: la única vía de alta de personal ────────────
        router.get('/usuarios/invitaciones', '#modules/identidad/controllers/invitaciones_controller.listar')
        router.post('/usuarios/invitaciones', '#modules/identidad/controllers/invitaciones_controller.crear')
        router.delete('/usuarios/invitaciones/:id_invitacion', '#modules/identidad/controllers/invitaciones_controller.revocar')
        router.post('/usuarios/invitaciones/:id_invitacion/reenviar', '#modules/identidad/controllers/invitaciones_controller.reenviar')

        // ── Usuarios: administración de la plantilla ──────────────────
        router.get('/roles', '#modules/identidad/controllers/usuarios_controller.listarRoles')
        router.get('/usuarios', '#modules/identidad/controllers/usuarios_controller.listar')
        router.post('/usuarios', '#modules/identidad/controllers/usuarios_controller.crear')
        router.get('/usuarios/:uuid_usuario', '#modules/identidad/controllers/usuarios_controller.mostrar')
        router.put('/usuarios/:uuid_usuario', '#modules/identidad/controllers/usuarios_controller.actualizar')
        router.patch('/usuarios/:uuid_usuario', '#modules/identidad/controllers/usuarios_controller.cambiarEstado')
        router.get('/usuarios/:uuid_usuario/datos-bancarios', '#modules/identidad/controllers/usuarios_controller.datosBancarios')
        router.post('/usuarios/:uuid_usuario/datos-bancarios', '#modules/identidad/controllers/usuarios_controller.registrarDatosBancarios')
        router.delete('/usuarios/:uuid_usuario/datos-bancarios', '#modules/identidad/controllers/usuarios_controller.desactivarDatosBancarios')

        // ── Catálogo: edición individual ──────────────────────────────
        router.put('/insumos/:id_insumo', '#modules/menu/controllers/menu_controller.actualizarInsumo')
        router.put('/bebidas/:id_bebida', '#modules/menu/controllers/menu_controller.actualizarBebida')
        router.put('/envases/:id_envase', '#modules/menu/controllers/menu_controller.actualizarEnvase')

        router.put('/cubaitors/:id_cubaitor', '#modules/cubaitor/controllers/cubaitor_controller.actualizar')
        router.delete('/cubaitors/:id_cubaitor', '#modules/cubaitor/controllers/cubaitor_controller.desactivar')
        router.put('/eventos/:id_evento/config-dispensado/:id_config', '#modules/cubaitor/controllers/cubaitor_controller.actualizarConfig')
        router.delete('/eventos/:id_evento/config-dispensado/:id_config', '#modules/cubaitor/controllers/cubaitor_controller.desactivarConfig')

        router.put('/eventos/:id_evento/mesas/:id_mesa', '#modules/eventos/controllers/eventos_controller.actualizarMesa')

        /** La comanda la sube y administra el capitán. */
        router.post('/eventos/:id_evento/comanda', '#modules/eventos/controllers/comanda_controller.subir')
        router.delete('/eventos/:id_evento/comanda', '#modules/eventos/controllers/comanda_controller.retirar')
        router.get('/eventos/:id_evento/comanda/historial', '#modules/eventos/controllers/comanda_controller.historial')
        router.patch('/eventos/:id_evento/comanda/:id_comanda/restaurar', '#modules/eventos/controllers/comanda_controller.restaurar')

        /** Desempeño histórico del personal. Solo capitán y admin. */
        router.get('/reportes/desempeno-meseros', '#modules/dashboard/controllers/reportes_controller.desempenoMeseros')

        // ── Dashboard del capitán ─────────────────────────────────────
        router.get('/dashboard/capitan', '#modules/dashboard/controllers/dashboard_controller.capitan')

        // ── Cronograma del evento ─────────────────────────────────────
        router.post('/eventos/:id_evento/cronograma', '#modules/eventos/controllers/cronograma_controller.crear')
        router.put('/eventos/:id_evento/cronograma/:id_hito', '#modules/eventos/controllers/cronograma_controller.actualizar')
        router.delete('/eventos/:id_evento/cronograma/:id_hito', '#modules/eventos/controllers/cronograma_controller.eliminar')

        // ── Checklists: plantillas y aprobación ───────────────────────
        router.post('/checklists', '#modules/checklists/controllers/checklists_controller.crear')
        router.put('/checklists/:id_checklist', '#modules/checklists/controllers/checklists_controller.actualizar')
        router.delete('/checklists/:id_checklist', '#modules/checklists/controllers/checklists_controller.desactivar')
        router.post('/participaciones/:id_participacion/checklist-instancias', '#modules/checklists/controllers/checklists_controller.instanciar')
        router.patch('/checklist-instancias/:id_instancia/aprobar', '#modules/checklists/controllers/checklists_controller.aprobar')

        // ── Cierre: mermas y pagos ────────────────────────────────────
        router.get('/eventos/:id_evento/reportes-merma', '#modules/cierre/controllers/cierre_controller.listarMermas')
        router.post('/eventos/:id_evento/reportes-merma', '#modules/cierre/controllers/cierre_controller.registrarMerma')

        router.get('/eventos/:id_evento/cierre', '#modules/cierre/controllers/cierre_controller.verificar')
        router.get('/eventos/:id_evento/pagos', '#modules/cierre/controllers/cierre_controller.listarPagos')
        router.post('/eventos/:id_evento/pagos/calcular', '#modules/cierre/controllers/cierre_controller.calcular')
        router.patch('/pagos/:id_pago/pagado', '#modules/cierre/controllers/cierre_controller.marcarPagado')
        router.patch('/pagos/:id_pago/fallido', '#modules/cierre/controllers/cierre_controller.marcarFallido')
      })
      .use([middleware.auth(), middleware.sujeto(), middleware.rol(['capitan', 'admin'])])

    // ---------------------------------------------------------------- cualquier rol autenticado
    // Consultas que los tres roles necesitan; el filtrado por pertenencia lo
    // hace el controlador según quién pregunta.
    router
      .group(() => {
        router.get('/eventos', '#modules/eventos/controllers/eventos_controller.listar')
        router.get('/eventos/:id_evento', '#modules/eventos/controllers/eventos_controller.mostrar')
        router.get('/eventos/:id_evento/participaciones', '#modules/participaciones/controllers/participaciones_controller.listar')
        /** Readback del panel de piso: qué mesa tiene quién. */
        router.get('/eventos/:id_evento/asignaciones', '#modules/participaciones/controllers/participaciones_controller.listarAsignaciones')

        /**
         * El menú lo consultan los tres roles: el mesero lo necesita para
         * levantar la orden en la mesa.
         */

        /** Perfil propio y datos bancarios propios. El sujeto sale del token. */
        router.put('/usuarios/me', '#modules/identidad/controllers/usuarios_controller.actualizarMiPerfil')
        router.get('/usuarios/me/datos-bancarios', '#modules/identidad/controllers/usuarios_controller.misDatosBancarios')
        router.post('/usuarios/me/datos-bancarios', '#modules/identidad/controllers/usuarios_controller.registrarMisDatosBancarios')

        /** La app registra su token de FCM al arrancar. Idempotente por token. */
        router.post('/usuarios/me/dispositivos-push', '#modules/identidad/controllers/usuarios_controller.registrarDispositivoPush')

        /** Consultas del catálogo: el mesero las necesita en la mesa. */
        router.get('/insumos/:id_insumo', '#modules/menu/controllers/menu_controller.mostrarInsumo')
        router.get('/bebidas/:id_bebida', '#modules/menu/controllers/menu_controller.mostrarBebida')
        router.get('/bebidas/:id_bebida/receta', '#modules/menu/controllers/menu_controller.mostrarReceta')
        router.get('/envases/:id_envase', '#modules/menu/controllers/menu_controller.mostrarEnvase')

        /** El mesero la consulta desde el salón; el servicio verifica su participación. */
        router.get('/eventos/:id_evento/comanda', '#modules/eventos/controllers/comanda_controller.mostrar')
        router.get('/eventos/:id_evento/comanda/archivo', '#modules/eventos/controllers/comanda_controller.descargar')

        router.get('/eventos/:id_evento/mesas', '#modules/eventos/controllers/eventos_controller.listarMesas')
        router.get('/eventos/:id_evento/mesas/:id_mesa', '#modules/eventos/controllers/eventos_controller.mostrarMesa')
        router.get('/participaciones/:id_participacion', '#modules/participaciones/controllers/participaciones_controller.mostrar')
        router.get('/salones/:id_salon/disponibilidad', '#modules/eventos/controllers/salones_controller.disponibilidad')

        router.get('/cubaitors/:id_cubaitor', '#modules/cubaitor/controllers/cubaitor_controller.mostrar')
        /**
         * Latido del dispositivo. Expuesto por HTTP mientras el cliente MQTT no
         * existe: sin él, `ultima_conexion` nunca se actualizaba y el dashboard
         * marcaba todos los Cubaitores fuera de línea para siempre.
         */
        router.post('/cubaitors/heartbeat', '#modules/cubaitor/controllers/cubaitor_controller.heartbeat')
        router.get('/eventos/:id_evento/alertas', '#modules/cubaitor/controllers/cubaitor_controller.alertas')

        /** Paneles: el del evento lo miran los tres roles desde el salón. */
        router.get('/eventos/:id_evento/dashboard', '#modules/dashboard/controllers/dashboard_controller.evento')
        router.get('/dashboard/meseros', '#modules/dashboard/controllers/dashboard_controller.meseros')

        /** El cronograma lo consulta el mesero: necesita saber cuándo toca cada tiempo. */
        router.get('/eventos/:id_evento/cronograma', '#modules/eventos/controllers/cronograma_controller.listar')

        /** Bandeja propia: el sujeto sale del token. */
        router.get('/notificaciones', '#modules/notificaciones/controllers/notificaciones_controller.listar')
        router.patch('/notificaciones/:id_notificacion/leida', '#modules/notificaciones/controllers/notificaciones_controller.marcarLeida')

        router.get('/checklists', '#modules/checklists/controllers/checklists_controller.listar')
        router.get('/checklists/:id_checklist', '#modules/checklists/controllers/checklists_controller.mostrar')
        router.get('/participaciones/:id_participacion/checklist-instancias', '#modules/checklists/controllers/checklists_controller.listarInstancias')

        router.get('/bebidas', '#modules/menu/controllers/menu_controller.listarBebidas')
        router.get('/envases', '#modules/menu/controllers/menu_controller.listarEnvases')

        /** Tablero de barra: lo miran el capitán y quien esté en la barra. */
        /** Bandeja de piso: la miran el mesero asignado y el capitán. */
        router.get('/eventos/:id_evento/solicitudes', '#modules/comensal/controllers/comensal_controller.listarSolicitudes')
        router.patch('/solicitudes/:id_solicitud/estado', '#modules/comensal/controllers/comensal_controller.cambiarEstado')

        router.get('/eventos/:id_evento/ordenes', '#modules/ordenes/controllers/ordenes_controller.listarPorEvento')
        router.get('/ordenes/:id_orden', '#modules/ordenes/controllers/ordenes_controller.mostrar')
        router.patch('/ordenes/:id_orden/estado', '#modules/ordenes/controllers/ordenes_controller.cambiarEstado')

        /**
         * Dispensar y reportar los ejecuta quien atiende la barra, que puede ser
         * un mesero con puesto 'barra' o el propio capitán. Por eso van aquí y
         * no en el grupo exclusivo de meseros.
         */
        router.get('/orden-detalles/:id_detalle/dispensados', '#modules/ordenes/controllers/ordenes_controller.obtenerDispensados')
        router.post('/orden-detalles/:id_detalle/dispensar', '#modules/ordenes/controllers/ordenes_controller.dispensar')
        router.patch('/dispensados/:id_dispensado/reporte', '#modules/ordenes/controllers/ordenes_controller.reportar')
      })
      .use([middleware.auth(), middleware.sujeto()])

    // ---------------------------------------------------------------- mesero en piso
    router
      .group(() => {
        router.post('/eventos/:id_evento/participaciones', '#modules/participaciones/controllers/participaciones_controller.apartar')
        router.delete('/participaciones/:id_participacion', '#modules/participaciones/controllers/participaciones_controller.liberar')
        router.post('/participaciones/:id_participacion/confirmacion-llegada', '#modules/participaciones/controllers/participaciones_controller.confirmarLlegada')
        router.patch('/asignaciones/:id_asignacion/vincular', '#modules/participaciones/controllers/participaciones_controller.vincularMesa')

        /** Marcar el checklist es del mesero: es quien montó las mesas. */
        router.put('/checklist-instancias/:id_instancia/respuestas', '#modules/checklists/controllers/checklists_controller.responder')

        /** Levantar la orden es del mesero: es quien está en la mesa. */
        router.post('/mesas/:id_mesa/ordenes', '#modules/ordenes/controllers/ordenes_controller.crear')
      })
      .use([middleware.auth(), middleware.sujeto(), middleware.rol(['mesero'])])

    // ---------------------------------------------------------------- solo admin
    // La bitácora expone quién hizo qué en todo el sistema.
    router
      .group(() => {
        router.get('/admin/bitacora', '#modules/admin/controllers/bitacora_controller.listar')
      })
      .use([middleware.auth(), middleware.sujeto(), middleware.rol(['admin'])])
  })
  .prefix('/v1')
