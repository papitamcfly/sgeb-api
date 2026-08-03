/**
 * Catálogo de códigos SGEB.
 *
 * ESTE ARCHIVO ES LA TRADUCCIÓN A CÓDIGO DE `diccionario-errores-sgeb.md` v1.3.
 * Reglas de gobernanza que se heredan del diccionario:
 *
 *  1. Un código NUNCA cambia de significado.
 *  2. Los códigos retirados NO se reciclan (ver RETIRADOS al final).
 *  3. Un código nuevo se documenta en el diccionario ANTES de usarse aquí.
 *  4. `mensaje` es para el usuario final: sin jerga, sin identificadores, sin
 *     nombres de tabla. El detalle va en `technical_message`, que se arma en el
 *     punto donde se lanza el error.
 *
 * El `http` sugerido solo determina el color del componente en el frontend
 * (2xx verde, 4xx amarillo, 5xx rojo). No es parte del contrato de negocio.
 */

export interface DefinicionCodigo {
  http: number
  mensaje: string
}

export const CODIGOS = {
  // ---------------------------------------------------------------- 0xxx Éxito
  'SGEB-0000': { http: 200, mensaje: 'Operación realizada correctamente.' },
  'SGEB-0001': { http: 201, mensaje: 'Registro creado correctamente.' },
  'SGEB-0002': { http: 200, mensaje: 'No encontramos resultados con esos criterios. Intenta con otros filtros.' },
  'SGEB-0003': { http: 202, mensaje: 'Tu solicitud fue recibida y se está procesando.' },
  'SGEB-0004': { http: 200, mensaje: 'Mostramos la información disponible; algunos indicadores no pudieron calcularse.' },

  // ------------------------------------------- 1xxx Validación del token (resource server)
  'SGEB-1002': { http: 401, mensaje: 'Tu sesión ha expirado. Vuelve a iniciar sesión.' },
  'SGEB-1003': { http: 401, mensaje: 'No pudimos validar tu sesión. Inicia sesión nuevamente.' },
  'SGEB-1004': { http: 403, mensaje: 'No tienes permisos para realizar esta acción.' },

  // ---------------------------------------------------------------- 2xxx Validación de entrada
  'SGEB-2001': { http: 400, mensaje: 'Faltan datos obligatorios. Completa los campos marcados.' },
  'SGEB-2002': { http: 400, mensaje: 'Revisa los datos capturados: hay campos con formato incorrecto.' },
  'SGEB-2003': { http: 400, mensaje: 'El texto capturado es demasiado corto o demasiado largo.' },
  'SGEB-2004': { http: 400, mensaje: 'El valor seleccionado no es válido.' },
  'SGEB-2005': { http: 400, mensaje: 'La CLABE capturada no es válida. Verifica los 18 dígitos.' },
  'SGEB-2006': { http: 409, mensaje: 'Ese correo ya está registrado. Intenta iniciar sesión o recupera tu contraseña.' },
  'SGEB-2007': { http: 400, mensaje: 'La fecha del evento no puede ser anterior a hoy.' },
  'SGEB-2008': { http: 400, mensaje: 'Las fechas del evento no son coherentes. Revisa inicio y fin.' },
  'SGEB-2009': { http: 400, mensaje: 'El rango de fechas de búsqueda no es válido.' },
  'SGEB-2011': { http: 400, mensaje: 'La calificación debe ser de 1 a 5 estrellas.' },
  'SGEB-2012': { http: 400, mensaje: 'La cantidad indicada supera lo permitido.' },
  'SGEB-2013': { http: 409, mensaje: 'Ya existe un registro con ese dato. Verifica la información.' },
  'SGEB-2014': { http: 400, mensaje: 'Alguno de los filtros de la consulta no es válido.' },
  'SGEB-2015': { http: 400, mensaje: 'El rango de fechas solicitado es demasiado amplio. Acótalo e inténtalo de nuevo.' },

  // ---------------------------------------------------------------- 3xxx Recursos
  'SGEB-3001': { http: 404, mensaje: 'No encontramos la información solicitada.' },
  'SGEB-3002': { http: 422, mensaje: 'Uno de los datos relacionados ya no existe. Actualiza la pantalla e inténtalo de nuevo.' },
  'SGEB-3003': { http: 404, mensaje: 'El código QR escaneado no corresponde a ninguna mesa activa.' },
  'SGEB-3004': { http: 410, mensaje: 'Este recurso ya no está disponible.' },

  // ---------------------------------------------------------------- 4xxx Reglas de negocio
  'SGEB-4001': { http: 409, mensaje: 'El salón no está disponible en esa fecha. Elige otra fecha u otro salón.' },
  'SGEB-4002': { http: 409, mensaje: 'El cupo de meseros para este evento ya está lleno.' },
  'SGEB-4003': { http: 422, mensaje: 'Estás fuera del área del salón. Acércate al recinto e inténtalo de nuevo.' },
  'SGEB-4004': { http: 422, mensaje: 'No pudimos verificar tu identidad. Intenta de nuevo con tu huella o Face ID.' },
  'SGEB-4005': { http: 409, mensaje: 'Primero completa y aprueba el checklist de montaje.' },
  'SGEB-4006': { http: 409, mensaje: 'Esa mesa ya está asignada a otro mesero.' },
  'SGEB-4007': { http: 422, mensaje: 'El número de mesas supera la capacidad del salón.' },
  'SGEB-4008': { http: 409, mensaje: 'Una bebida de la orden no puede prepararse por falta de insumo. La orden quedó en pausa.' },
  'SGEB-4009': { http: 409, mensaje: 'No hay suficiente líquido cargado para completar el dispensado.' },
  'SGEB-4010': { http: 409, mensaje: 'Ya registraste tu calificación para esta mesa. ¡Gracias!' },
  'SGEB-4011': { http: 409, mensaje: 'Esta acción no está permitida en el estado actual. Actualiza la pantalla.' },
  'SGEB-4012': { http: 409, mensaje: 'La cuenta bancaria del mesero no está vigente. Solicítale que la actualice.' },
  'SGEB-4013': { http: 409, mensaje: 'El evento aún no está en la etapa necesaria para esta operación.' },
  'SGEB-4014': { http: 429, mensaje: 'Ya avisamos a tu mesero. Dale unos momentos para atenderte.' },
  'SGEB-4015': { http: 409, mensaje: 'No es posible pagar: hay meseros sin salida verificada.' },
  'SGEB-4016': { http: 409, mensaje: 'No se puede eliminar: este registro está siendo utilizado. Puedes desactivarlo en su lugar.' },
  'SGEB-4017': { http: 409, mensaje: 'No puedes modificar esto mientras haya un evento en curso que lo utiliza.' },
  'SGEB-4018': { http: 409, mensaje: 'Esa mesa tiene actividad en curso; no puede eliminarse ni liberarse.' },
  'SGEB-4019': { http: 409, mensaje: 'Ese pin ya está configurado con otro insumo en el mismo dispositivo.' },
  'SGEB-4020': { http: 409, mensaje: 'Ya no puedes liberar tu lugar: el evento está por comenzar. Avisa a tu capitán.' },
  'SGEB-4021': { http: 409, mensaje: 'Esa solicitud ya fue atendida por otro mesero.' },
  'SGEB-4022': { http: 409, mensaje: 'No puedes desactivar tu propia cuenta.' },
  'SGEB-4023': { http: 422, mensaje: 'El usuario seleccionado no puede ser capitán de este evento.' },
  'SGEB-4024': { http: 422, mensaje: 'Este equipo no está registrado a tu nombre. Regístralo o avisa a tu capitán.' },
  'SGEB-4025': { http: 409, mensaje: 'Este equipo ya se usó para registrar la llegada de otro mesero en este evento.' },
  'SGEB-4026': { http: 422, mensaje: 'No pudimos ubicarte con precisión. Sal a un espacio abierto e inténtalo de nuevo.' },

  // ---------------------------------------------------------------- 5xxx Técnicos
  'SGEB-5001': { http: 500, mensaje: 'Ocurrió un problema inesperado. Intenta de nuevo en unos minutos.' },
  'SGEB-5002': { http: 500, mensaje: 'No pudimos guardar tu información. Intenta de nuevo.' },
  'SGEB-5003': { http: 503, mensaje: 'La barra automática no responde. Se notificó al mesero para atención manual.' },
  'SGEB-5004': { http: 500, mensaje: 'No pudimos registrar la transferencia. Se reintentará.' },
  'SGEB-5005': { http: 502, mensaje: 'No pudimos enviar la notificación. El mensaje quedó pendiente.' },
  'SGEB-5006': { http: 504, mensaje: 'El dispensado tardó demasiado y se detuvo por seguridad. Verifica el vaso con tu mesero.' },
  'SGEB-5007': { http: 503, mensaje: 'El sistema está en mantenimiento. Vuelve a intentarlo más tarde.' },
  'SGEB-5008': { http: 503, mensaje: 'No pudimos calcular los indicadores en este momento. Intenta de nuevo en unos segundos.' },
} as const satisfies Record<string, DefinicionCodigo>

export type CodigoSGEB = keyof typeof CODIGOS

/**
 * Códigos permanentemente quemados. Migrados al módulo de identidad en la v1.1.
 * Se declaran para que un `grep` los encuentre y para que nadie los reutilice
 * con otro significado.
 */
export const RETIRADOS = {
  'SGEB-1001': 'SSO-1001',
  'SGEB-1005': 'SSO-1005',
  'SGEB-1006': 'SSO-3002',
  'SGEB-1007': 'SSO-1008',
  'SGEB-2010': 'SSO-2006',
} as const

export function definicion(codigo: CodigoSGEB): DefinicionCodigo {
  return CODIGOS[codigo]
}
