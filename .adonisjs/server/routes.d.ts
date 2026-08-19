import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'protocolo.descubrimiento': { paramsTuple?: []; params?: {} }
    'protocolo.jwks': { paramsTuple?: []; params?: {} }
    'protocolo.authorize': { paramsTuple?: []; params?: {} }
    'protocolo.token': { paramsTuple?: []; params?: {} }
    'protocolo.userinfo': { paramsTuple?: []; params?: {} }
    'protocolo.logout': { paramsTuple?: []; params?: {} }
    'protocolo.revocar': { paramsTuple?: []; params?: {} }
    'interno.mostrar_login': { paramsTuple?: []; params?: {} }
    'interno.login': { paramsTuple?: []; params?: {} }
    'interno.verificacion': { paramsTuple?: []; params?: {} }
    'interno.reenviar': { paramsTuple?: []; params?: {} }
    'interno.mostrar_registro': { paramsTuple?: []; params?: {} }
    'interno.registro': { paramsTuple?: []; params?: {} }
    'interno.mostrar_recuperar': { paramsTuple?: []; params?: {} }
    'interno.recuperar': { paramsTuple?: []; params?: {} }
    'interno.mostrar_nueva_password': { paramsTuple?: []; params?: {} }
    'interno.confirmar_recuperacion': { paramsTuple?: []; params?: {} }
    'publico.mesa': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'comensal.solicitar': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'comensal.calificar': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'comensal.token': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'perfil.mostrar': { paramsTuple?: []; params?: {} }
    'salones.listar': { paramsTuple?: []; params?: {} }
    'salones.crear': { paramsTuple?: []; params?: {} }
    'salones.mostrar': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'salones.actualizar': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'salones.desactivar': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'eventos.crear': { paramsTuple?: []; params?: {} }
    'eventos.actualizar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.cambiar_estado': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.agregar_mesa': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.eliminar_mesa': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'eventos.regenerar_qr': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'participaciones.cambiar_estado': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'participaciones.asignar_mesa': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'participaciones.liberar_mesa': { paramsTuple: [ParamValue]; params: {'id_asignacion': ParamValue} }
    'menu.listar_insumos': { paramsTuple?: []; params?: {} }
    'menu.crear_insumo': { paramsTuple?: []; params?: {} }
    'menu.cambiar_estado_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'menu.desactivar_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'menu.crear_bebida': { paramsTuple?: []; params?: {} }
    'menu.definir_receta': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.desactivar_bebida': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.crear_envase': { paramsTuple?: []; params?: {} }
    'menu.desactivar_envase': { paramsTuple: [ParamValue]; params: {'id_envase': ParamValue} }
    'cubaitor.listar': { paramsTuple?: []; params?: {} }
    'cubaitor.registrar': { paramsTuple?: []; params?: {} }
    'cubaitor.estado': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.listar_config': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cubaitor.configurar_pin': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cubaitor.recargar': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_config': ParamValue} }
    'comensal.listar_calificaciones': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'invitaciones.listar': { paramsTuple?: []; params?: {} }
    'invitaciones.crear': { paramsTuple?: []; params?: {} }
    'invitaciones.revocar': { paramsTuple: [ParamValue]; params: {'id_invitacion': ParamValue} }
    'invitaciones.reenviar': { paramsTuple: [ParamValue]; params: {'id_invitacion': ParamValue} }
    'usuarios.listar_roles': { paramsTuple?: []; params?: {} }
    'usuarios.listar': { paramsTuple?: []; params?: {} }
    'usuarios.crear': { paramsTuple?: []; params?: {} }
    'usuarios.mostrar': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'usuarios.actualizar': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'usuarios.cambiar_estado': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'usuarios.datos_bancarios': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'usuarios.registrar_datos_bancarios': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'usuarios.desactivar_datos_bancarios': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'menu.actualizar_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'menu.actualizar_bebida': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.actualizar_envase': { paramsTuple: [ParamValue]; params: {'id_envase': ParamValue} }
    'cubaitor.actualizar': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.desactivar': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.actualizar_config': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_config': ParamValue} }
    'cubaitor.desactivar_config': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_config': ParamValue} }
    'eventos.actualizar_mesa': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'comanda.subir': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comanda.retirar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comanda.historial': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comanda.restaurar': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_comanda': ParamValue} }
    'dashboard.capitan': { paramsTuple?: []; params?: {} }
    'cronograma.crear': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cronograma.actualizar': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_hito': ParamValue} }
    'cronograma.eliminar': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_hito': ParamValue} }
    'checklists.crear': { paramsTuple?: []; params?: {} }
    'checklists.actualizar': { paramsTuple: [ParamValue]; params: {'id_checklist': ParamValue} }
    'checklists.desactivar': { paramsTuple: [ParamValue]; params: {'id_checklist': ParamValue} }
    'checklists.instanciar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'checklists.aprobar': { paramsTuple: [ParamValue]; params: {'id_instancia': ParamValue} }
    'cierre.listar_mermas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.registrar_merma': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.verificar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.listar_pagos': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.calcular': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.marcar_pagado': { paramsTuple: [ParamValue]; params: {'id_pago': ParamValue} }
    'cierre.marcar_fallido': { paramsTuple: [ParamValue]; params: {'id_pago': ParamValue} }
    'eventos.listar': { paramsTuple?: []; params?: {} }
    'eventos.mostrar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'participaciones.listar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'usuarios.actualizar_mi_perfil': { paramsTuple?: []; params?: {} }
    'usuarios.mis_datos_bancarios': { paramsTuple?: []; params?: {} }
    'usuarios.registrar_mis_datos_bancarios': { paramsTuple?: []; params?: {} }
    'usuarios.registrar_dispositivo_push': { paramsTuple?: []; params?: {} }
    'menu.mostrar_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'menu.mostrar_bebida': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.mostrar_receta': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.mostrar_envase': { paramsTuple: [ParamValue]; params: {'id_envase': ParamValue} }
    'comanda.mostrar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comanda.descargar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.listar_mesas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.mostrar_mesa': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'participaciones.mostrar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'salones.disponibilidad': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'cubaitor.mostrar': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.alertas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'dashboard.evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'dashboard.meseros': { paramsTuple?: []; params?: {} }
    'cronograma.listar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'notificaciones.listar': { paramsTuple?: []; params?: {} }
    'notificaciones.marcar_leida': { paramsTuple: [ParamValue]; params: {'id_notificacion': ParamValue} }
    'checklists.listar': { paramsTuple?: []; params?: {} }
    'checklists.mostrar': { paramsTuple: [ParamValue]; params: {'id_checklist': ParamValue} }
    'checklists.listar_instancias': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'menu.listar_bebidas': { paramsTuple?: []; params?: {} }
    'menu.listar_envases': { paramsTuple?: []; params?: {} }
    'comensal.listar_solicitudes': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comensal.cambiar_estado': { paramsTuple: [ParamValue]; params: {'id_solicitud': ParamValue} }
    'ordenes.listar_por_evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'ordenes.mostrar': { paramsTuple: [ParamValue]; params: {'id_orden': ParamValue} }
    'ordenes.cambiar_estado': { paramsTuple: [ParamValue]; params: {'id_orden': ParamValue} }
    'ordenes.dispensar': { paramsTuple: [ParamValue]; params: {'id_detalle': ParamValue} }
    'ordenes.reportar': { paramsTuple: [ParamValue]; params: {'id_dispensado': ParamValue} }
    'participaciones.apartar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'participaciones.liberar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'participaciones.confirmar_llegada': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'participaciones.vincular_mesa': { paramsTuple: [ParamValue]; params: {'id_asignacion': ParamValue} }
    'checklists.responder': { paramsTuple: [ParamValue]; params: {'id_instancia': ParamValue} }
    'ordenes.crear': { paramsTuple: [ParamValue]; params: {'id_mesa': ParamValue} }
    'bitacora.listar': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'protocolo.descubrimiento': { paramsTuple?: []; params?: {} }
    'protocolo.jwks': { paramsTuple?: []; params?: {} }
    'protocolo.authorize': { paramsTuple?: []; params?: {} }
    'protocolo.userinfo': { paramsTuple?: []; params?: {} }
    'protocolo.logout': { paramsTuple?: []; params?: {} }
    'interno.mostrar_login': { paramsTuple?: []; params?: {} }
    'interno.reenviar': { paramsTuple?: []; params?: {} }
    'interno.mostrar_registro': { paramsTuple?: []; params?: {} }
    'interno.mostrar_recuperar': { paramsTuple?: []; params?: {} }
    'interno.mostrar_nueva_password': { paramsTuple?: []; params?: {} }
    'publico.mesa': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'perfil.mostrar': { paramsTuple?: []; params?: {} }
    'salones.listar': { paramsTuple?: []; params?: {} }
    'salones.mostrar': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'menu.listar_insumos': { paramsTuple?: []; params?: {} }
    'cubaitor.listar': { paramsTuple?: []; params?: {} }
    'cubaitor.estado': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.listar_config': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comensal.listar_calificaciones': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'invitaciones.listar': { paramsTuple?: []; params?: {} }
    'usuarios.listar_roles': { paramsTuple?: []; params?: {} }
    'usuarios.listar': { paramsTuple?: []; params?: {} }
    'usuarios.mostrar': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'usuarios.datos_bancarios': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'comanda.historial': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'dashboard.capitan': { paramsTuple?: []; params?: {} }
    'cierre.listar_mermas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.verificar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.listar_pagos': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.listar': { paramsTuple?: []; params?: {} }
    'eventos.mostrar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'participaciones.listar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'usuarios.mis_datos_bancarios': { paramsTuple?: []; params?: {} }
    'menu.mostrar_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'menu.mostrar_bebida': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.mostrar_receta': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.mostrar_envase': { paramsTuple: [ParamValue]; params: {'id_envase': ParamValue} }
    'comanda.mostrar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comanda.descargar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.listar_mesas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.mostrar_mesa': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'participaciones.mostrar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'salones.disponibilidad': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'cubaitor.mostrar': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.alertas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'dashboard.evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'dashboard.meseros': { paramsTuple?: []; params?: {} }
    'cronograma.listar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'notificaciones.listar': { paramsTuple?: []; params?: {} }
    'checklists.listar': { paramsTuple?: []; params?: {} }
    'checklists.mostrar': { paramsTuple: [ParamValue]; params: {'id_checklist': ParamValue} }
    'checklists.listar_instancias': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'menu.listar_bebidas': { paramsTuple?: []; params?: {} }
    'menu.listar_envases': { paramsTuple?: []; params?: {} }
    'comensal.listar_solicitudes': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'ordenes.listar_por_evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'ordenes.mostrar': { paramsTuple: [ParamValue]; params: {'id_orden': ParamValue} }
    'bitacora.listar': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'protocolo.descubrimiento': { paramsTuple?: []; params?: {} }
    'protocolo.jwks': { paramsTuple?: []; params?: {} }
    'protocolo.authorize': { paramsTuple?: []; params?: {} }
    'protocolo.userinfo': { paramsTuple?: []; params?: {} }
    'protocolo.logout': { paramsTuple?: []; params?: {} }
    'interno.mostrar_login': { paramsTuple?: []; params?: {} }
    'interno.reenviar': { paramsTuple?: []; params?: {} }
    'interno.mostrar_registro': { paramsTuple?: []; params?: {} }
    'interno.mostrar_recuperar': { paramsTuple?: []; params?: {} }
    'interno.mostrar_nueva_password': { paramsTuple?: []; params?: {} }
    'publico.mesa': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'perfil.mostrar': { paramsTuple?: []; params?: {} }
    'salones.listar': { paramsTuple?: []; params?: {} }
    'salones.mostrar': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'menu.listar_insumos': { paramsTuple?: []; params?: {} }
    'cubaitor.listar': { paramsTuple?: []; params?: {} }
    'cubaitor.estado': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.listar_config': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comensal.listar_calificaciones': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'invitaciones.listar': { paramsTuple?: []; params?: {} }
    'usuarios.listar_roles': { paramsTuple?: []; params?: {} }
    'usuarios.listar': { paramsTuple?: []; params?: {} }
    'usuarios.mostrar': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'usuarios.datos_bancarios': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'comanda.historial': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'dashboard.capitan': { paramsTuple?: []; params?: {} }
    'cierre.listar_mermas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.verificar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.listar_pagos': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.listar': { paramsTuple?: []; params?: {} }
    'eventos.mostrar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'participaciones.listar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'usuarios.mis_datos_bancarios': { paramsTuple?: []; params?: {} }
    'menu.mostrar_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'menu.mostrar_bebida': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.mostrar_receta': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.mostrar_envase': { paramsTuple: [ParamValue]; params: {'id_envase': ParamValue} }
    'comanda.mostrar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'comanda.descargar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.listar_mesas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.mostrar_mesa': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'participaciones.mostrar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'salones.disponibilidad': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'cubaitor.mostrar': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.alertas': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'dashboard.evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'dashboard.meseros': { paramsTuple?: []; params?: {} }
    'cronograma.listar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'notificaciones.listar': { paramsTuple?: []; params?: {} }
    'checklists.listar': { paramsTuple?: []; params?: {} }
    'checklists.mostrar': { paramsTuple: [ParamValue]; params: {'id_checklist': ParamValue} }
    'checklists.listar_instancias': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'menu.listar_bebidas': { paramsTuple?: []; params?: {} }
    'menu.listar_envases': { paramsTuple?: []; params?: {} }
    'comensal.listar_solicitudes': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'ordenes.listar_por_evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'ordenes.mostrar': { paramsTuple: [ParamValue]; params: {'id_orden': ParamValue} }
    'bitacora.listar': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'protocolo.token': { paramsTuple?: []; params?: {} }
    'protocolo.revocar': { paramsTuple?: []; params?: {} }
    'interno.login': { paramsTuple?: []; params?: {} }
    'interno.verificacion': { paramsTuple?: []; params?: {} }
    'interno.registro': { paramsTuple?: []; params?: {} }
    'interno.recuperar': { paramsTuple?: []; params?: {} }
    'interno.confirmar_recuperacion': { paramsTuple?: []; params?: {} }
    'comensal.solicitar': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'comensal.calificar': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'comensal.token': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'salones.crear': { paramsTuple?: []; params?: {} }
    'eventos.crear': { paramsTuple?: []; params?: {} }
    'eventos.agregar_mesa': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'eventos.regenerar_qr': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'participaciones.asignar_mesa': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'menu.crear_insumo': { paramsTuple?: []; params?: {} }
    'menu.crear_bebida': { paramsTuple?: []; params?: {} }
    'menu.crear_envase': { paramsTuple?: []; params?: {} }
    'cubaitor.registrar': { paramsTuple?: []; params?: {} }
    'cubaitor.configurar_pin': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'invitaciones.crear': { paramsTuple?: []; params?: {} }
    'invitaciones.reenviar': { paramsTuple: [ParamValue]; params: {'id_invitacion': ParamValue} }
    'usuarios.crear': { paramsTuple?: []; params?: {} }
    'usuarios.registrar_datos_bancarios': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'comanda.subir': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cronograma.crear': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'checklists.crear': { paramsTuple?: []; params?: {} }
    'checklists.instanciar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'cierre.registrar_merma': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cierre.calcular': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'usuarios.registrar_mis_datos_bancarios': { paramsTuple?: []; params?: {} }
    'usuarios.registrar_dispositivo_push': { paramsTuple?: []; params?: {} }
    'ordenes.dispensar': { paramsTuple: [ParamValue]; params: {'id_detalle': ParamValue} }
    'participaciones.apartar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'participaciones.confirmar_llegada': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'ordenes.crear': { paramsTuple: [ParamValue]; params: {'id_mesa': ParamValue} }
  }
  PUT: {
    'salones.actualizar': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'eventos.actualizar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'menu.definir_receta': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'usuarios.actualizar': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'menu.actualizar_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'menu.actualizar_bebida': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.actualizar_envase': { paramsTuple: [ParamValue]; params: {'id_envase': ParamValue} }
    'cubaitor.actualizar': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.actualizar_config': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_config': ParamValue} }
    'eventos.actualizar_mesa': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'cronograma.actualizar': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_hito': ParamValue} }
    'checklists.actualizar': { paramsTuple: [ParamValue]; params: {'id_checklist': ParamValue} }
    'usuarios.actualizar_mi_perfil': { paramsTuple?: []; params?: {} }
    'checklists.responder': { paramsTuple: [ParamValue]; params: {'id_instancia': ParamValue} }
  }
  DELETE: {
    'salones.desactivar': { paramsTuple: [ParamValue]; params: {'id_salon': ParamValue} }
    'eventos.eliminar_mesa': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_mesa': ParamValue} }
    'participaciones.liberar_mesa': { paramsTuple: [ParamValue]; params: {'id_asignacion': ParamValue} }
    'menu.desactivar_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'menu.desactivar_bebida': { paramsTuple: [ParamValue]; params: {'id_bebida': ParamValue} }
    'menu.desactivar_envase': { paramsTuple: [ParamValue]; params: {'id_envase': ParamValue} }
    'invitaciones.revocar': { paramsTuple: [ParamValue]; params: {'id_invitacion': ParamValue} }
    'usuarios.desactivar_datos_bancarios': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'cubaitor.desactivar': { paramsTuple: [ParamValue]; params: {'id_cubaitor': ParamValue} }
    'cubaitor.desactivar_config': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_config': ParamValue} }
    'comanda.retirar': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'cronograma.eliminar': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_hito': ParamValue} }
    'checklists.desactivar': { paramsTuple: [ParamValue]; params: {'id_checklist': ParamValue} }
    'participaciones.liberar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
  }
  PATCH: {
    'eventos.cambiar_estado': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'participaciones.cambiar_estado': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
    'menu.cambiar_estado_insumo': { paramsTuple: [ParamValue]; params: {'id_insumo': ParamValue} }
    'cubaitor.recargar': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_config': ParamValue} }
    'usuarios.cambiar_estado': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'comanda.restaurar': { paramsTuple: [ParamValue,ParamValue]; params: {'id_evento': ParamValue,'id_comanda': ParamValue} }
    'checklists.aprobar': { paramsTuple: [ParamValue]; params: {'id_instancia': ParamValue} }
    'cierre.marcar_pagado': { paramsTuple: [ParamValue]; params: {'id_pago': ParamValue} }
    'cierre.marcar_fallido': { paramsTuple: [ParamValue]; params: {'id_pago': ParamValue} }
    'notificaciones.marcar_leida': { paramsTuple: [ParamValue]; params: {'id_notificacion': ParamValue} }
    'comensal.cambiar_estado': { paramsTuple: [ParamValue]; params: {'id_solicitud': ParamValue} }
    'ordenes.cambiar_estado': { paramsTuple: [ParamValue]; params: {'id_orden': ParamValue} }
    'ordenes.reportar': { paramsTuple: [ParamValue]; params: {'id_dispensado': ParamValue} }
    'participaciones.vincular_mesa': { paramsTuple: [ParamValue]; params: {'id_asignacion': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}