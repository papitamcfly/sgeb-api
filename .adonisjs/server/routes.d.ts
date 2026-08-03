import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'publico.mesa': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'publico.solicitar': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'perfil.mostrar': { paramsTuple?: []; params?: {} }
    'perfil.actualizar': { paramsTuple?: []; params?: {} }
    'datos_bancarios.mostrar_propio': { paramsTuple?: []; params?: {} }
    'datos_bancarios.registrar_propio': { paramsTuple?: []; params?: {} }
    'usuarios.listar': { paramsTuple?: []; params?: {} }
    'usuarios.mostrar': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'salones.crear': { paramsTuple?: []; params?: {} }
    'salones.actualizar': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'salones.desactivar': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'dashboard.capitan': { paramsTuple?: []; params?: {} }
    'dashboard.evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
    'llegada.confirmar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
  }
  GET: {
    'publico.mesa': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'perfil.mostrar': { paramsTuple?: []; params?: {} }
    'datos_bancarios.mostrar_propio': { paramsTuple?: []; params?: {} }
    'usuarios.listar': { paramsTuple?: []; params?: {} }
    'usuarios.mostrar': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'dashboard.capitan': { paramsTuple?: []; params?: {} }
    'dashboard.evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
  }
  HEAD: {
    'publico.mesa': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'perfil.mostrar': { paramsTuple?: []; params?: {} }
    'datos_bancarios.mostrar_propio': { paramsTuple?: []; params?: {} }
    'usuarios.listar': { paramsTuple?: []; params?: {} }
    'usuarios.mostrar': { paramsTuple: [ParamValue]; params: {'uuid_usuario': ParamValue} }
    'dashboard.capitan': { paramsTuple?: []; params?: {} }
    'dashboard.evento': { paramsTuple: [ParamValue]; params: {'id_evento': ParamValue} }
  }
  POST: {
    'publico.solicitar': { paramsTuple: [ParamValue]; params: {'codigo_qr': ParamValue} }
    'datos_bancarios.registrar_propio': { paramsTuple?: []; params?: {} }
    'salones.crear': { paramsTuple?: []; params?: {} }
    'llegada.confirmar': { paramsTuple: [ParamValue]; params: {'id_participacion': ParamValue} }
  }
  PUT: {
    'perfil.actualizar': { paramsTuple?: []; params?: {} }
    'salones.actualizar': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'salones.desactivar': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}