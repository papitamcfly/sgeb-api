import vine from '@vinejs/vine'

/** Límites del Diccionario, tablas 2 y 3. */
const NOMBRE = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü ' \-]{2,30}$/

export const crearUsuarioValidator = vine.compile(
  vine.object({
    idRol: vine.number().min(1).max(255),
    nombre: vine.string().trim().regex(NOMBRE),
    apellidoPaterno: vine.string().trim().regex(NOMBRE),
    apellidoMaterno: vine.string().trim().regex(NOMBRE).nullable().optional(),
    correo: vine.string().trim().email().maxLength(100),
    telefono: vine.string().trim().regex(/^\+?[0-9]{10,15}$/).nullable().optional(),
    /** No lleva contraseña: la define el usuario en la pantalla del proveedor. */
  })
)

export const actualizarUsuarioValidator = vine.compile(
  vine.object({
    nombre: vine.string().trim().regex(NOMBRE).optional(),
    apellidoPaterno: vine.string().trim().regex(NOMBRE).optional(),
    apellidoMaterno: vine.string().trim().regex(NOMBRE).nullable().optional(),
    telefono: vine.string().trim().regex(/^\+?[0-9]{10,15}$/).nullable().optional(),
  })
)

export const estadoUsuarioValidator = vine.compile(vine.object({ activo: vine.boolean() }))

export const datosBancariosValidator = vine.compile(
  vine.object({
    /** 18 dígitos; el dígito de control lo valida el servicio (SGEB-2005). */
    clabe: vine.string().trim().regex(/^\d{18}$/),
    banco: vine.string().trim().minLength(2).maxLength(30),
    titularCuenta: vine.string().trim().minLength(3).maxLength(50),
  })
)

export const filtrosUsuarioValidator = vine.compile(
  vine.object({
    rol: vine.enum(['admin', 'capitan', 'mesero'] as const).optional(),
    activo: vine.boolean().optional(),
    q: vine.string().trim().maxLength(60).optional(),
  })
)

/**
 * Token de Firebase Cloud Messaging. Sin longitud fija: ha crecido entre
 * versiones del SDK, de ahí el rango amplio.
 */
export const dispositivoPushValidator = vine.compile(
  vine.object({
    token: vine.string().trim().minLength(32).maxLength(4096),
    plataforma: vine.enum(['ios', 'android', 'web'] as const),
  })
)
