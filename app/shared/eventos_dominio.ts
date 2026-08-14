/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVENTOS DE DOMINIO — la capa entre los servicios y el tiempo real
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Los servicios NO conocen el transporte. Publican hechos de negocio —"se
 * apartó un lugar", "se pausó una orden"— y quien escucha decide qué hacer con
 * ellos: emitirlos por WebSocket, mandar una notificación push, escribir en
 * bitácora, o nada.
 *
 * Sin esta capa, las llamadas a `io.emit()` acabarían salpicadas dentro de
 * `apartar`, `procesarDetalle`, `aprobar` y `confirmar`, y la regla de que un
 * servicio no conoce HTTP se rompería por la puerta de atrás. Además el
 * servicio dejaría de ser probable sin levantar un socket.
 *
 * Todos los eventos llevan `idEvento`: es la llave de la sala. El alcance por
 * sala no es un detalle de implementación, es un requisito de privacidad —un
 * mesero no debe recibir el estado de mesas de un evento donde no trabaja.
 *
 * Referencia: Entorno Tecnológico §10.2 (áreas candidatas) y §10.5 (alcance
 * por sala de evento).
 */

/**
 * Campo común a todas las cargas del canal.
 *
 * `emitido_en` lo pone el puente al publicar, no cada servicio: así ningún
 * emisor puede olvidarlo y todos usan el mismo reloj.
 *
 * Para qué sirve del lado del cliente:
 *
 *  1. **Descartar lo viejo.** Tras una reconexión pueden llegar eventos
 *     rezagados; comparar contra el estado local evita pintar hacia atrás.
 *  2. **Medir el desfase.** Si la diferencia con el reloj del cliente crece,
 *     algo va mal en el enlace y conviene resincronizar por REST.
 *
 * No es un número de secuencia, y no lo necesita: las cargas llevan **estado
 * completo, no deltas**. `mesa:cambio` dice "la mesa 7 quedó ocupada", no
 * "+1 ocupada". Aplicar dos veces el mismo evento es idempotente, y uno viejo
 * que llega tarde solo repone un valor que ya era correcto.
 */
export interface Emitido {
  /** ISO 8601 con zona. Reloj del servidor, no del dispositivo. */
  emitido_en: string
}

/** Área §10.2.1 — Cupo de meseros. Disputado entre varios a la vez. */
export interface CupoActualizado {
  idEvento: number
  cupoMeseros: number
  ocupados: number
  disponibles: number
}

/** Área §10.2.2 — Panel en vivo: montaje, piso y asignaciones. */
export interface ParticipacionCambio {
  idEvento: number
  idParticipacion: number
  estado: string
  checklistOk?: boolean
}

export interface MesaCambio {
  idEvento: number
  idMesa: number
  estado: 'libre' | 'ocupada'
  idParticipacion: number | null
  vinculada: boolean
}

export interface ChecklistCambio {
  idEvento: number
  idParticipacion: number
  idInstancia: number
  completado: boolean
  aprobado: boolean
  pendientes: number
}

/** Área §10.2.3 — Dispensado y botella vacía. Origen asíncrono: el Cubaitor. */
export interface OrdenCambio {
  idEvento: number
  idOrden: number
  idMesa: number
  estado: string
}

export interface DispensadoCambio {
  idEvento: number
  idDispensado: number
  idDetalle: number
  pinGpio: number
  estado: 'ok' | 'parcial' | 'error' | 'pausado_por_insumo'
  volumenMl: number
  segundos: number
}

/**
 * La alerta que más importa del canal: sin tiempo real, el capitán se entera de
 * la botella vacía cuando un mesero se lo dice, y para entonces hay órdenes
 * acumuladas en pausa.
 */
export interface AlertaInsumo {
  idEvento: number
  idInsumo: number
  nombreInsumo: string
  motivo: 'botella_vacia' | 'insumo_agotado' | 'sin_configuracion'
  codigo: 'SGEB-4008' | 'SGEB-4009'
  ordenesPausadas: number
}

/**
 * Hito del cronograma disparado.
 *
 * No estaba en la §10.2 pero encaja en el mismo criterio: lo dispara un proceso
 * externo (la tarea programada) y su ventana de utilidad son minutos. Sin canal,
 * el mesero se entera cuando abre la app.
 */
export interface CronogramaDisparado {
  idEvento: number
  idCronograma: number
  tipoTiempo: 'ENTRADA' | 'FUERTE' | 'POSTRE' | 'OTRO'
  mensaje: string
  destinatarios: number
}

/** Área §10.2.4 — Solicitudes del comensal. */
export interface SolicitudCambio {
  idEvento: number
  idSolicitud: number
  idMesa: number
  tipo: string
  estado: 'pendiente' | 'atendida' | 'cancelada'
  idParticipacion: number | null
}

/**
 * Registro de eventos. AdonisJS lo usa para tipar `emitter.emit()` y
 * `emitter.on()`, así que un nombre mal escrito o una carga con la forma
 * equivocada se detectan al compilar, no en producción con un socket mudo.
 */
declare module '@adonisjs/core/types' {
  interface EventsList {
    'cupo:actualizado': CupoActualizado
    'participacion:cambio': ParticipacionCambio
    'mesa:cambio': MesaCambio
    'checklist:cambio': ChecklistCambio
    'orden:cambio': OrdenCambio
    'dispensado:cambio': DispensadoCambio
    'alerta:insumo': AlertaInsumo
    'solicitud:cambio': SolicitudCambio
    'cronograma:disparado': CronogramaDisparado
  }
}

/** Nombre de la sala. Un solo lugar para que servidor y clientes no divirjan. */
export function salaEvento(idEvento: number): string {
  return `evento:${idEvento}`
}
