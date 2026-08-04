# SGEB — API (AdonisJS 7)

Backend del Sistema de Gestión de Eventos de Banquetes. Monolito modular: un solo despliegue con módulos aislados, diseñado para que el módulo de identidad pueda extraerse después sin migración de datos.

Este proyecto se generó con `create-adonisjs` (starter kit oficial de API para v7) y se adaptó al SGEB. **No es un esqueleto suelto**: trae `ace.js`, `bin/`, `config/`, `tsconfig.json` y todo el andamiaje del framework.

**Verificado en Node 24.12.0 y PostgreSQL 16:** `npm install` sin `ERESOLVE` · `npm run typecheck` sin errores · servidor arrancando y respondiendo con el envelope · 37 tablas migradas, revertidas y re-aplicadas sin residuos · 29 modelos mapeados · 28 pruebas en verde.

---

## Instalación

```bash
node -v          # DEBE ser >= 24. Adonis 7 no arranca con Node 22.
npm install
cp .env.example .env
node ace generate:key
```

Luego llena `.env`. **Todas las variables sin valor por defecto son obligatorias**: la validación de `start/env.ts` falla al arrancar, no en la primera petición. Es deliberado — un servidor que levanta sin `SSO_JWKS_URL` funciona hasta que alguien intenta autenticarse, y para entonces el síntoma aparece lejos de la causa.

```bash
npm run dev      # http://localhost:3333
```

Para desarrollo local sin acceso a los VPS, levanta PostgreSQL con Docker y apunta `DB_HOST=127.0.0.1`:

```bash
docker run -d --name sgeb-db -p 5432:5432 \
  -e POSTGRES_USER=sgeb -e POSTGRES_PASSWORD=devlocal -e POSTGRES_DB=sgeb postgres:16
```

---

## Contratos que este código implementa

Son la fuente de verdad; viven fuera del repo.

| Documento | Qué define |
|---|---|
| `openapi-sgeb.yaml` v1.3 | 104 operaciones en 66 rutas |
| `openapi-sso.yaml` v2.1 | Proveedor de identidad, OAuth 2.1 + PKCE |
| `diccionario-errores-sgeb.md` v1.3 | 65 códigos vigentes |
| `diccionario-errores-sso.md` v2.1 | Serie SSO-xxxx |
| `Diccionario_Datos_Auth_SGEB_v3.md` | 29 tablas de dominio + 9 de identidad |
| `Entorno_Tecnologico_Framework_SGEB_v0_4.docx` | Patrones por capa; §8 = SSO |

---

## Qué se quitó del starter kit y por qué

El kit oficial de API viene con autenticación propia. Nada de eso aplica aquí:

| Paquete | Motivo |
|---|---|
| `@adonisjs/auth` + access tokens | La identidad la emite el proveedor SSO. Esta API es **servidor de recursos**: valida firmas, no emite tokens |
| `@adonisjs/session` | API sin estado, con Bearer. No hay cookies de sesión |
| `@adonisjs/shield` | Protege contra CSRF, que aplica a formularios con cookies |
| `@tuyau/core` | Cliente RPC tipado para frontends Adonis. Los nuestros son React y Swift contra OpenAPI |
| `better-sqlite3` | La base es PostgreSQL en el VPS 3 |
| `providers/api_provider.ts` | Envolvía respuestas en `data`. **Chocaba con nuestro envelope**: habría producido `{data:{result,data}}` |

Ese último punto merece atención: si algún día se adopta la API de Transformers de v7, tiene que ser con `serialize.withoutWrapping`, o cada respuesta sale con doble envoltura.

Se agregaron `pg`, `jose` (validación de JWT contra JWKS) y `mqtt` (Cubaitor vía el broker del VPS 4).

---

## Estructura

```
app/
├── exceptions/handler.ts         Manejador global → envelope
├── shared/                       Infraestructura transversal
│   ├── envelope.ts               El envelope result/data
│   ├── responder.ts              Respuestas de éxito
│   ├── errors/
│   │   ├── catalogo.ts           Los 65 códigos, traducidos del diccionario
│   │   └── sgeb_error.ts         La excepción de dominio
│   └── middleware/
│       ├── trace_id.ts           Trace-Id por petición
│       ├── jwt_auth.ts           Validación de firma contra JWKS
│       ├── resolver_sujeto.ts    UUID → usuario interno, una vez por petición
│       └── rol.ts                Autorización por rol
└── modules/
    ├── identidad/                AISLADO. Ver regla de oro.
    ├── eventos/                  Salones, eventos, mesas, cronograma
    ├── participaciones/          Ciclo del mesero, llegada, asignaciones
    ├── menu/                     Insumos, bebidas, envases
    ├── ordenes/                  Órdenes y dispensado
    ├── cubaitor/                 IoT: dispositivos y configuración de pines
    ├── cierre/                   Mermas y pagos
    └── dashboard/                Agregados de solo lectura
```

Cada módulo lleva `controllers/`, `services/`, `models/` y `validators/`. Los alias `#shared/*` y `#modules/*` están en `package.json`.

---

## Las cinco reglas

### 1. El envelope no es negociable

Toda respuesta —éxito o error, cualquier estatus HTTP— sale como `{ result, data }`. El frontend nunca lee el estatus para decidir lógica: lee `result.code`.

Éxitos vía `responder`; fallos vía `throw new SgebError(...)`. **Un controlador nunca construye un envelope de error a mano.**

```ts
// ✅
return responder.creado(ctx, salon)
throw new SgebError('SGEB-4016', { tecnico: `... ${n} filas en EVENTO.` })

// ❌
return ctx.response.status(409).send({ result: { code: 'SGEB-4016', ... } })
```

### 2. Los servicios no conocen HTTP

Un servicio recibe datos y devuelve datos o lanza. No recibe `ctx`, no toca `response`, no sabe qué estatus saldrá. Eso lo hace probable sin levantar un servidor y reutilizable desde una tarea programada.

### 3. Toda baja es lógica

Ningún `DELETE` borra físicamente un registro con historia operativa: marca `activo = 0`. Si el borrado rompería historia, responde **SGEB-4016** y ofrece desactivar. Consultar después ese recurso devuelve **SGEB-3004** ("ya no está disponible"), no SGEB-3001 ("no existe") — el usuario necesita distinguirlos.

### 4. El entero de usuario no sale del backend

`USUARIO` es la única entidad con identificador público UUID. `id_usuario` es llave de JOIN y nada más.

La traducción ocurre **una vez por petición** en `resolver_sujeto.ts`. Además, `Usuario.id` lleva `serializeAs: null`: el entero no se escapa aunque alguien serialice el modelo completo por descuido en una relación anidada.

El resto del dominio (evento, orden, mesa, salón…) conserva enteros. No sobrecorregir.

### 5. Regla de oro: el dominio no toca identidad

Ningún módulo de negocio importa modelos de identidad ni consulta sus tablas. Todo pasa por `IdentidadService`.

```ts
// ❌ Esto mata la extracción del SSO
const filas = await Usuario.query().join('evento', ...)

// ✅
const perfiles = await this.identidad.perfiles(uuids)
```

`IdentidadService` es una **clase abstracta**, no una interfaz: una interfaz de TypeScript desaparece al compilar y no puede servir de llave en el contenedor. Así se inyecta por tipo y se puede sustituir en pruebas con `container.swap(IdentidadService, ...)`.

`providers/identidad_provider.ts` es el punto de conmutación: el día de la extracción se cambia `IdentidadLocal` por `IdentidadRemota` ahí y en ningún otro lugar.

Vale la pena una regla de ESLint que prohíba importar `#modules/identidad/models/*` desde otros módulos.

---

## Cómo se atiende una petición

```
Petición
  └─ trace_id          X-Trace-Id (existe aunque no haya ruta)
  └─ cors
  └─ jwt_auth          Firma vs JWKS → ctx.sujeto {uuid, rol}   [1002/1003]
  └─ resolver_sujeto   UUID → interno → ctx.usuario {id}
  └─ rol               ctx.sujeto.rol vs permitidos             [1004]
  └─ controlador       valida (VineJS) → llama servicio → responder
       └─ servicio     lógica; lanza SgebError
                            ↓ cualquier excepción
                       exceptions/handler.ts → envelope
```

**El orden de los middleware no es intercambiable.** `resolver_sujeto` sin `jwt_auth` truena en tiempo de ejecución.

---

## Traducción de excepciones

`app/exceptions/handler.ts` es el único lugar donde una excepción de infraestructura se convierte en código de negocio:

| Origen | Código |
|---|---|
| `SgebError` | El suyo |
| VineJS `required` | SGEB-2001 |
| VineJS `minLength` / `maxLength` | SGEB-2003 |
| VineJS `enum` / `in` | SGEB-2004 |
| VineJS (otras) | SGEB-2002 |
| PostgreSQL `23505` sobre correo | SGEB-2006 |
| PostgreSQL `23505` (otros únicos) | SGEB-2013 |
| PostgreSQL `23503` (FK) | SGEB-3002 |
| `ECONNREFUSED` / `ETIMEDOUT` | SGEB-5002 |
| Ruta inexistente | SGEB-3001 |
| Cualquier otra | SGEB-5001 + Trace-Id |

Solo se traducen los constraints con equivalente de negocio. Una violación que no previmos es defecto nuestro, no algo que el usuario pueda corregir: cae en 5001/5002.

---

## Comportamiento verificado

```bash
$ curl localhost:3333/v1/no-existe
{"result":{"code":"SGEB-3001","message":"No encontramos la información solicitada.",
 "technical_message":"Ruta no registrada: GET /v1/no-existe."},"data":null}

$ curl localhost:3333/v1/usuarios/me                        # HTTP 401
{"result":{"code":"SGEB-1003","message":"No pudimos validar tu sesión. Inicia sesión nuevamente.",
 "technical_message":"Encabezado Authorization ausente o sin esquema Bearer. Ruta: GET /v1/usuarios/me."},"data":null}

$ curl -H "X-Trace-Id: mi-traza-123" localhost:3333/v1/no-existe -D -
x-trace-id: mi-traza-123                                    # se respeta el del cliente
```

En producción `technical_message` no sale: lo filtra `limpiarParaCliente`.

---

## Reglas de logging

- `technical_message` **nunca** llega al cliente en producción.
- Nunca loguear contraseñas, tokens completos (solo prefijo `a3f9…`) ni CLABEs sin enmascarar (`0120…8903`).
- Los 5xx se registran completos; los 4xx en `debug`. Un capitán intentando borrar un salón en uso no es un incidente.
- El `technical_message` referencia usuarios por **UUID**, no por entero: es lo único que permite cruzar un incidente con los logs del SSO.

---

## Gobernanza de códigos

1. Un código **nunca** cambia de significado.
2. Los retirados **no se reciclan** (ver `RETIRADOS` en `catalogo.ts`).
3. Un código nuevo se documenta en el diccionario **antes** de usarse en código.
4. `catalogo.ts` y el `.md` se mantienen sincronizados. Conviene un test que compare ambos y falle en CI si divergen.

---

## Base de datos

**37 tablas**: las 29 del Diccionario de Datos en `public` y las 8 del módulo de identidad en `auth`. Seis migraciones, probadas contra PostgreSQL 16: aplicadas, revertidas y re-aplicadas sin dejar tablas ni tipos ENUM huérfanos.

| Migración | Contenido |
|---|---|
| `…001_create_usuarios_y_roles` | ROL (con los 3 roles precargados), USUARIO, DATOS_BANCARIOS |
| `…002_create_auth_module_tables` | Esquema `auth` + sus 8 tablas |
| `…003_create_eventos_core` | SALON, EVENTO, MESA, PARTICIPACION_EVENTO, CONFIRMACION_LLEGADA, ASIGNACION_MESA |
| `…004_create_checklists_y_menu` | CHECKLIST y sus 3 tablas, INSUMO, BEBIDA, RECETA_INGREDIENTE, ENVASE |
| `…005_create_iot_y_ordenes` | CUBAITOR, CONFIG_DISPENSADO, ORDEN, ORDEN_DETALLE, DISPENSADO |
| `…006_create_comunicacion_y_cierre` | CRONOGRAMA_EVENTO, SOLICITUD_SERVICIO, NOTIFICACION, CALIFICACION, PAGO, REPORTE_MERMA, MERMA_DETALLE |

Del módulo de identidad son 8 y no 9: `CREDENCIAL_BIOMETRICA` no se crea, porque la decisión v0.4 retiró la biometría como método de autenticación y la confirmación de llegada usa atestación local.

### Dónde vive USUARIO, y por qué

En `public`, no en `auth`. Es la tabla más referenciada del sistema —EVENTO la apunta dos veces, más PARTICIPACION_EVENTO, REPORTE_MERMA y DATOS_BANCARIOS—; ponerla en `auth` obligaría a cinco tablas de dominio a apuntar hacia afuera, o a renunciar a esas llaves foráneas.

**Es una tabla de dominio que además guarda credenciales**, no al revés. El esquema `auth` aloja solo las 8 tablas que existen únicamente para autenticar y que se mudan completas el día de la extracción.

Por eso las FK cruzan en una sola dirección: `auth.*` → `public.usuario`, nunca al revés. Verificado por consulta y fijado por una prueba automatizada:

```
FKs public → auth: 0
```

Al extraer el módulo, sus tablas viajan con una proyección de USUARIO que se convierte en CUENTA con `uuid_usuario` como PK (Anexo D del Diccionario v3). Del lado del SGEB, USUARIO queda como copia sombra sin `password_hash`. **Ninguna tabla de dominio se ve afectada**, que es exactamente el objetivo.

### Discrepancias encontradas en el Diccionario de Datos

Se resolvieron al implementar. Conviene corregirlas también en el documento para que no reaparezcan.

| # | Tabla | Discrepancia | Resolución |
|---|---|---|---|
| 1 | CONFIRMACION_LLEGADA | `longitud DECIMAL(10,8)` solo admite **dos** dígitos enteros (máx. 99.99999999). Torreón está en −103.4 | **DECIMAL(11,8)**, igual que en SALON |
| 2 | SALON | Tipo `VARCHAR(30)` para `nombre`, pero las reglas permiten 80 | VARCHAR(80) |
| 3 | EVENTO | Tipo `VARCHAR(40)` para `titulo`, pero las reglas permiten 120 | VARCHAR(120) |
| 4 | DATOS_BANCARIOS | `titular_cuenta VARCHAR(50)` con regex `{3,500}` | VARCHAR(50); el regex es errata |
| 5 | NOTIFICACION | `mensaje VARCHAR(100)` pero la sanitización dice "truncar a 255" | VARCHAR(100) |
| 6 | ORDEN | El enumerado usa `entregada`; `openapi-sgeb.yaml` usaba `servida` | **Resuelto**: se adopta el Diccionario. `openapi-sgeb.yaml` v1.4 ya usa `entregada` |

**La #1 es la grave.** No es un detalle de estilo: `DECIMAL(10,8)` provoca `numeric field overflow` al guardar cualquier longitud de tres dígitos, así que **toda confirmación de llegada fallaría en la sede del propio negocio**. Reproducido en PostgreSQL:

```
ERROR: numeric field overflow
DETAIL: A field with precision 10, scale 8 must round to an absolute value less than 10^2.
```

La #6 quedó resuelta a favor del Diccionario: `openapi-sgeb.yaml` v1.4 cambió el filtro de `/eventos/{id}/ordenes` y la sección `barra` del dashboard (`servidas` → `entregadas`, más el conteo de `dispensando`, que antes no se reportaba).

**Ojo con los dos enumerados de orden**, que se parecen y no son lo mismo:

| Tabla | Valores |
|---|---|
| `ORDEN.estado` | pendiente · en_preparacion · **dispensando** · **entregada** · cancelada · pausada_por_insumo |
| `ORDEN_DETALLE.estado` | pendiente · **dispensada** · entregada · pausada_por_insumo |

Un detalle puede estar `dispensada` mientras la orden sigue `en_preparacion`, porque otro renglón no ha salido de la barra.

### Invariantes que impone la base, no la aplicación

Están en la base porque una regla que solo vive en el código se salta desde una consola de `psql`, desde un script de migración de datos o desde un endpoint que alguien escriba sin conocerla. Cada uno tiene su prueba en `tests/unit/esquema_invariantes.spec.ts`.

| Restricción | Qué impide |
|---|---|
| `datos_bancarios_una_activa_por_usuario` | Dos CLABEs activas del mismo mesero → ambigüedad al dispersar el pago |
| `llave_firma_una_activa` | Dos llaves de firma activas → los tokens se firman de forma no determinista |
| `invitacion_una_pendiente_por_correo` | Dos capitanes invitando a la misma persona → cuenta duplicada |
| `participacion_evento (id_evento, id_usuario)` | Doble toque en la app → dos lugares del cupo consumidos |
| `mesa (id_evento, etiqueta)` | Dos "Mesa 1" en el mismo evento. Entre eventos sí se permite |
| `config_dispensado_pin_unico_por_evento` | Dos insumos en el mismo GPIO (SGEB-4019) → la bebida sale con el líquido equivocado |
| `calificacion.token_comensal UNIQUE` | Segunda calificación del mismo comensal (SGEB-4010); es lo único que deduplica, porque el comensal es anónimo |
| `CHECK evento_fin_posterior_a_inicio` | Eventos que terminan antes de empezar |
| `CHECK evento_geocerca_valida` | Radios fuera de 10–1000 m |
| `CHECK config_disponible_no_excede_cargado` | Más líquido disponible que cargado |

Los índices parciales (los tres primeros) no se pueden hacer con un `UNIQUE` ordinario: hay que permitir muchas filas inactivas y solo una activa. Eso es exactamente un índice parcial con `WHERE`.

### Base de pruebas

```bash
createdb sgeb_test
NODE_ENV=test node ace migration:run
node ace test unit          # 28 pruebas
```

Cada prueba corre en una transacción que se revierte al terminar, así el orden de ejecución no importa.

**Detalle que muerde al probar restricciones:** PostgreSQL aborta la transacción completa al primer error, y toda consulta posterior responde `current transaction is aborted`. Por eso las violaciones esperadas se envuelven en un `SAVEPOINT` (helper `debeFallar`). Es el mismo patrón que necesita la aplicación cuando quiere intentar un `INSERT` y reaccionar al duplicado sin abortar toda la operación.

---

## Modelos

Los 29 modelos Lucid, uno por tabla del Diccionario, distribuidos por módulo. Cada uno se prueba contra el esquema real en `tests/unit/modelos_dominio.spec.ts`: un `columnName` equivocado compila sin problema y truena en la primera consulta, así que esas pruebas mueven el fallo al CI.

Tres decisiones que se repiten en todos:

**`consume` en los DECIMAL.** El driver de PostgreSQL entrega los decimales como cadena para no perder precisión. Sin convertirlos, calcular la distancia a la geocerca haría aritmética con strings y daría `NaN`. Aplica a coordenadas, tarifas, costos, caudales y montos.

**`serializeAs: null` en los enteros de usuario.** `Evento.idCapitan`, `ParticipacionEvento.idUsuario`, `ReporteMerma.idGeneradoPor` y `DatosBancarios.idUsuario` son llaves internas de JOIN y no salen del backend. Hacia afuera se expone el UUID, que el servicio resuelve vía `IdentidadService`.

**Enmascarado en el propio modelo.** `DatosBancarios.clabe` y `Pago.clabeDestino` se serializan como `0121…8903`. Ponerlo en el modelo y no en cada controlador significa que no hay forma de olvidarlo. `Calificacion.tokenComensal` directamente no se serializa: devolverlo permitiría cruzar calificaciones con el orden de escaneo y deducir quién dijo qué, que es justo lo que el anonimato debe impedir.

---

## Módulo de identidad

Proveedor OAuth 2.1 + OpenID Connect, **verificado de punta a punta**.

### Antes del primer login

```bash
openssl rand -hex 32          # → SSO_MASTER_KEY en .env
node ace sso:rotar-llave      # sin esto no hay con qué firmar (SSO-5001)
```

### Es SSO de verdad

La sesión del proveedor (`auth.sesion_sso`) es lo que lo convierte en inicio de sesión único:

```
2. credenciales           → pantalla de verificación
3. código 2FA             → 302 mx.mediocres.sgeb://callback?code=…
   cookie de sesión SSO   → plantada
4. canje                  → access_token, expira en 900 s

5. SEGUNDA APP (panel web) con la misma sesión → 302 directo al callback
   ¿pidió credenciales? NO  ← esto es el SSO

6. logout                 → sesión destruida y cadena revocada
7. tras logout            → vuelve a pedir credenciales
```

La cookie es `HttpOnly`, `Secure` y `SameSite=Lax`. Lax y no Strict a propósito: con Strict el navegador no la enviaría en el redirect de vuelta desde el cliente, y el salto entre aplicaciones nunca ocurriría.

### Servicios

| Servicio | Responsabilidad |
|---|---|
| `LlaveFirmaService` | Genera pares RSA/EC, cifra la privada en reposo, rota con periodo de gracia, publica el JWKS |
| `TokenService` | Emite access/id/refresh, rota con detección de reúso |
| `AutorizacionService` | Registro de clientes, validación PKCE, ciclo del código de autorización |
| `CredencialesService` | Login, bloqueo por fuerza bruta, 2FA, dispositivos confiables |
| `SesionSsoService` | La sesión del proveedor: lo que hace posible el salto entre apps |
| `InvitacionService` | Alta por deeplink, con validación del dígito de control de la CLABE |
| `RecuperacionService` | Restablecimiento por enlace de un solo uso |

### Tres decisiones de fondo

**Firma asimétrica, nunca HMAC.** La API valida con la llave pública. Con un secreto compartido, comprometer la API permitiría además *emitir* tokens, y la extracción del módulo dejaría de ser posible sin tocar ambos lados.

**Llave privada cifrada con AES-256-GCM y llave maestra fuera de la base.** Si ambas vivieran en el mismo lugar, un volcado bastaría para firmar tokens arbitrarios. GCM y no CBC porque es autenticado: detecta manipulación en vez de devolver basura que parece una llave.

**El JWKS publica activas y retiradas, nunca revocadas.** "Retirada" = ya no firma pero sus tokens valen hasta expirar; sacarla cerraría todas las sesiones vivas. "Revocada" = se comprometió, y debe dejar de validar de inmediato.

### Las pantallas del proveedor

Las siete (S1–S7) se sirven como HTML generado en el servidor, desde `pantallas.ts`. Sin framework de plantillas ni bundle: son formularios sin estado que se abren en el navegador del sistema y tienen que cargar rápido en el WiFi de un salón.

Todo valor que viene de la petición pasa por `esc()`. El correo se repinta en el formulario tras un fallo, y sin escapar sería un XSS **en el origen del proveedor** — justo donde vive la cookie de sesión. Hay una prueba que lo fija.

### Alta del mesero

El mesero nunca se registra solo: el capitán invita, y el deeplink es lo único que permite crear la cuenta. La invitación vive 72 h, se guarda hasheada y es de un solo uso.

El registro crea `USUARIO` y `DATOS_BANCARIOS` en **una sola transacción**, pero los datos viven separados: la CLABE nunca toca las tablas de autenticación. Se valida el dígito de control con el algoritmo del Banco de México — una CLABE mal tecleada que pasa a nómina termina en una transferencia rechazada o, peor, enviada a la cuenta de otra persona.

### Recuperación de contraseña

Restablecer **cierra todas las sesiones abiertas y levanta los bloqueos**. Quien recupera su contraseña suele sospechar que su cuenta está comprometida; dejar vivas las sesiones anteriores permitiría al intruso seguir dentro con un refresh token que ya no depende de esa contraseña.

La respuesta es idéntica exista o no el correo (SSO-0002), y hay una prueba que compara los dos HTML byte a byte.

### El patrón que hay que respetar al escribir servicios

Tres bugs de la misma familia aparecieron al escribir las pruebas, y los tres eran explotables:

```ts
// ❌ El throw hace rollback y DESHACE la revocación
await db.transaction(async (trx) => {
  if (tokenReusado) {
    await revocarCadena(trx)      // se pierde
    throw new SsoError('SSO-1007')
  }
})

// ✅ Marcar dentro, aplicar fuera
let reusoDeUsuario: number | null = null
try {
  return await db.transaction(async (trx) => {
    if (tokenReusado) { reusoDeUsuario = idUsuario; throw new SsoError('SSO-1007') }
  })
} finally {
  if (reusoDeUsuario !== null) await this.revocarCadena(reusoDeUsuario)
}
```

Afectaba a la revocación por reúso de refresh token, a la del segundo canje de código, y al contador de intentos del código 2FA. **Este último es el peor**: el contador nunca subía, así que el límite de 5 intentos no existía y un código de seis dígitos se podía adivinar por fuerza bruta sin freno.

Regla general: **si un efecto debe sobrevivir al `throw`, no puede vivir en la transacción que el `throw` revierte.**

### Cuidado con `response.redirect()`

AdonisJS reenvía la query string de la petición original, así que un destino que ya lleva parámetros termina con dos signos de interrogación:

```
/interno/login?ticket=abc?response_type=code&client_id=…
```

El ticket queda contaminado y el flujo se rompe en el primer paso. Los controladores de identidad usan un helper `redirigir()` que arma el 302 a mano. **Aplica a cualquier redirect con parámetros en el resto del proyecto.**

### Comandos

```bash
node ace sso:rotar-llave     # obligatorio antes del primer login
node ace sso:purgar          # tarea diaria: flujos y códigos vencidos
node ace sso:demo            # solo desarrollo: siembra usuarios de prueba
```

`sso:purgar` **no** borra `INTENTO_LOGIN`, `BLOQUEO_CUENTA` ni `REFRESH_TOKEN`. Los dos primeros son la evidencia para investigar un incidente; el tercero tiene que seguir existiendo para poder **detectar** su reúso — borrarlo haría que un token robado se viera igual que uno inventado.

---

## Servicios de dominio

Escritos y probados: **eventos, participaciones y confirmación de llegada**. Cada regla del diccionario tiene su prueba en `tests/unit/dominio_reglas.spec.ts`.

### Dos máquinas de estados

El orden del enumerado **es** la secuencia válida; las transiciones fuera de orden responden SGEB-4011.

```
EVENTO         borrador → publicado → en_curso → finalizado
                    ↘         ↘          ↘      cancelado
PARTICIPACION  aparto → seleccionado → confirmo_asistencia →
               confirmo_llegada → asignado → vinculo → salida
```

`finalizado`, `cancelado` y `salida` son terminales: de ellos cuelgan pagos ya calculados.

### Reglas cubiertas

| Código | Regla |
|---|---|
| SGEB-4001 | El salón no admite dos eventos vigentes el mismo día. En borrador todavía no ocupa: es un plan, no un compromiso |
| SGEB-4002 | Cupo lleno. El conteo va dentro de la transacción con `forUpdate` |
| SGEB-4005 | Sin checklist de montaje aprobado no hay asignación de mesas |
| SGEB-4006 | Una mesa, un mesero a la vez |
| SGEB-4007 | `num_mesas` no excede la capacidad del salón |
| SGEB-4011 | Transiciones inválidas, y el doble apartado del mismo evento |
| SGEB-4013 | Operar sobre un evento en el estado equivocado |
| SGEB-4020 | El mesero no libera su lugar a menos de 12 h del inicio |
| SGEB-4003/4004/4024/4025/4026 | Confirmación de llegada (ver abajo) |

### Decisiones que vale la pena conocer

**Publicar exige al menos una mesa.** Sin mesas no hay QR que escanear ni nada que asignar.

**El radio de geocerca solo se edita en borrador.** Cambiarlo después invalidaría retroactivamente asistencias ya confirmadas, y de esas asistencias dependen pagos.

**El QR lo genera el servidor.** Aceptarlo del cliente permitiría fijar un código conocido y suplantar la mesa de otro evento. Regenerarlo invalida el anterior de inmediato (SGEB-3003).

**Vincular exige escanear el QR de esa mesa.** El código está impreso en la mesa, así que vincular implica haber estado ahí. Aceptar el QR de otra rompería esa evidencia.

**Liberar una mesa no borra la asignación.** El histórico de quién atendió qué mesa es lo que permite resolver una queja del comensal después del evento.

**`inicio` tiene que caer el mismo día que `fecha`.** Si no, el cronograma y la ventana de llegada se calculan contra días distintos y los meseros reciben avisos el día equivocado.

### Confirmación de llegada

El orden de las verificaciones importa, y va de lo específico a lo genérico: dispositivo → biometría → precisión del GPS → geocerca. Si se revisara la geocerca primero, alguien usando el teléfono de un compañero vería "acércate al recinto" estando dentro.

**La distancia se calcula en el servidor** (Haversine) y nunca se acepta del cliente: si la app enviara la distancia ya resuelta, bastaría con mandar "estoy a 3 metros" para saltarse la geocerca sin siquiera falsear el GPS.

**Todo intento queda registrado, exitoso o no.** Los fallidos son la evidencia con la que el capitán resuelve una disputa de asistencia, y de la asistencia depende el pago.

SGEB-4026 se distingue de SGEB-4003 a propósito: uno afirma que el mesero está fuera, el otro admite que no se pudo determinar. Tratar una medición inconcluyente como asistencia denegada produce disputas que el registro no puede resolver.

### Nueva traducción en el manejador de excepciones

Las violaciones de `CHECK` (código `23514`) ahora se traducen a **SGEB-2008** en vez de caer en SGEB-5001. Llegar hasta la base significa que faltó un guardián en el servicio, pero el usuario sí puede corregir lo que capturó; el `technical_message` nombra el constraint para que el equipo sepa qué validación agregar.

Salió de una prueba real: finalizar un evento cuyo `inicio` estaba en el futuro reventaba contra `evento_fin_posterior_a_inicio` y devolvía un error técnico sobre algo perfectamente entendible.

---

### API expuesta

Los servicios ya tienen controladores, validadores y rutas.

| Grupo | Middleware | Rutas |
|---|---|---|
| Publico (comensal por QR) | ninguno | `/v1/publico/mesas/:codigo_qr` |
| Cualquier rol autenticado | auth, sujeto | perfil propio, consulta de eventos y participaciones |
| Capitan y admin | auth, sujeto, rol | salones, alta y edicion de eventos, mesas, asignaciones |
| Mesero | auth, sujeto, rol | apartar, liberar, confirmar llegada, vincular mesa |

Dos decisiones que se ven en el reparto:

**El capitan solo ve sus eventos; el admin ve todos.** Se resuelve en el controlador y no en el servicio, porque depende de quien pregunta, no de la regla en si.

**Vincular la mesa es del mesero, no del capitan.** El capitan asigna desde el panel; vincular exige escanear el QR impreso, y eso solo lo puede hacer quien esta parado frente a la mesa.

### Como se validan las entradas

Los validadores de VineJS cubren formato, longitudes y rangos, con los limites del Diccionario. Las reglas que dependen de **otros datos** (que el salon este libre, que las mesas quepan, que el capitan tenga el rol) no caben ahi: necesitan consultar la base y viven en el servicio, con su propio codigo de negocio.

El manejador global mapea cada regla de VineJS a su codigo:

```
titulo ausente        -> SGEB-2001    tipo: 'boda'          -> SGEB-2004
titulo: 'ab'          -> SGEB-2003    radioGeocercaM: 5000  -> SGEB-2012
```

Y `data.errores_campos` conserva el detalle, porque el frontend pinta el error bajo cada campo.

### De donde salen las llaves para validar el JWT

`SSO_JWKS_MODE` decide el transporte:

- `local` — se leen de la base, en el mismo proceso. Es lo correcto hoy: pedirse el JWKS por HTTP a uno mismo obligaria a estar escuchando para validar el primer token, lo que rompe las pruebas y complica el arranque.
- `remoto` — se piden por HTTP al proveedor, como se haria contra Keycloak o Auth0. Es el modo definitivo.

**Lo que no cambia entre modos es la validacion**: mismo algoritmo, mismo emisor, misma audiencia, misma verificacion de firma. Al extraer el modulo se pone `remoto` y ya. Es la misma costura que `IdentidadLocal` / `IdentidadRemota`.

### `import type` rompe la inyeccion de dependencias

```ts
// MAL: el contenedor no puede inyectarlo
import type { IdentidadService } from '#modules/identidad/identidad_service'

// BIEN
import { IdentidadService } from '#modules/identidad/identidad_service'
```

El contenedor lee los metadatos que TypeScript emite para los parametros del constructor. `import type` se borra al compilar, asi que el metadato queda como `Object` y la inyeccion falla en tiempo de ejecucion con `Cannot inject [Function: Object]`.

**El typecheck no lo detecta**, porque a nivel de tipos todo cuadra. Solo aparece al pasar por HTTP con el contenedor resolviendo de verdad. Aplica a cualquier clase que se inyecte, en todo el proyecto.

---

### Menu, ordenes y dispensado

El camino completo: el mesero levanta la ORDEN, cada renglon es un ORDEN_DETALLE, y cada apertura de electrovalvula deja un DISPENSADO que permite auditar cuanto liquido salio de verdad contra cuanto se pidio.

#### De la receta a los mililitros

`RecetaCalculo` traduce "una cuba en vaso de 350 ml" a "45 ml de ron y 252 de refresco". Los tres modos del Diccionario:

| Modo | Que hace | Para que |
|---|---|---|
| `FIJO_ML` | Mililitros exactos, sin importar el envase | El alcohol. Una cuba lleva 45 ml de ron tanto en vaso como en jarra, o la bebida saldria mas fuerte solo por pedirla en envase grande |
| `PROPORCION` | Fraccion del volumen del envase | Ingredientes que si deben escalar, como un jarabe |
| `RESTO` | Lo que sobre | El refresco, que rellena hasta arriba |

El factor de llenado por defecto es **0.85**: el hielo ocupa espacio, y llenar al 100 % derrama al servir.

`ordenServido` importa fisicamente: el alcohol va primero y el refresco al final, porque el vaso lleva hielo y el orden inverso lo desborda. El calculo ordena por ese campo, no por el orden de captura.

Los **segundos de valvula** salen del caudal calibrado del pin, no de una constante: cada manguera y cada altura de botella dan un caudal distinto, y usar un valor teorico serviria tragos de volumen equivocado.

#### Botella vacia: se verifica TODO antes de abrir nada

`procesarDetalle` calcula la receta, verifica **todos** los insumos, y solo entonces registra dispensados y descuenta volumen. Si alguno no alcanza, **nada se sirve**: la orden entera se pausa (SGEB-4008 / SGEB-4009) en vez de servir medio vaso y dejar al comensal con una bebida que igual hay que tirar.

El descuento va dentro de la transaccion con `forUpdate` sobre la configuracion del pin. Sin el, dos meseros pidiendo cubas a la vez leerian ambos "quedan 200 ml" y el segundo serviria de una botella agotada.

**La pausa se aplica FUERA de la transaccion**, con el patron ya conocido. Hacerla dentro la desharia el rollback del `throw`, la orden quedaria en `pendiente`, el mesero volveria a intentar y el sistema nunca registraria que hay una botella vacia esperando al capitan.

#### Recarga

`recargar()` es la contraparte operativa de SGEB-4009: el capitan cambia la botella fisica, marca la recarga, y las ordenes que esperaban ese insumo vuelven a la cola sin que el mesero las recapture. Tambien reactiva el insumo si estaba en `agotado`.

#### Reporte del dispositivo

La diferencia entre `segundos_calculado` y `segundos_real` delata una calibracion desviada antes de que se note en el inventario. Se guarda tal cual, sin corregirla: el volumen ya descontado fue el teorico, y ajustarlo aqui mezclaria dos fuentes de verdad.

Con menos del 90 % de lo pedido el dispensado queda `parcial`: la bebida salio incompleta y el mesero tiene que verla antes de llevarla a la mesa. Sin reporte dentro del tiempo esperado, SGEB-5006 y valvula forzada a cierre.

#### El Cubaitor caido no bloquea el evento

Sin heartbeat dentro del umbral, el dashboard lo marca fuera de linea y se habilita el dispensado manual (RNF-13). Detener la barra porque un ESP32 dejo de responder seria peor que servir a mano.

#### Validaciones del catalogo

- Las porciones `PROPORCION` de una receta no pasan de 1.00. Sin esta comprobacion, dos ingredientes al 60 % pedirian 120 % del vaso y el RESTO saldria negativo justo al servir, frente al comensal.
- Un insumo dentro de la receta de una bebida activa no se puede dar de baja (SGEB-4016): esa bebida quedaria imposible de preparar.
- Marcar un insumo como `agotado` pausa las ordenes que lo usan. Preferible pausarlas de golpe a que cada mesero descubra el problema al intentar servir.

---

#### Rutas de la barra

| Grupo | Rutas |
|---|---|
| Capitan y admin | alta de insumos, bebidas, recetas, envases; Cubaitor; configuracion de pines; recarga |
| Cualquier rol autenticado | consulta del menu, tablero de ordenes, dispensar, reportar |
| Mesero | levantar la orden |

Tres decisiones visibles ahi:

**El mesero consulta el menu pero no lo administra.** Lo necesita para levantar la orden en la mesa; darle de alta insumos no.

**Levantar la orden es del mesero; dispensar no.** Quien atiende la barra puede ser un mesero con puesto `barra` o el propio capitan, asi que dispensar y reportar viven en el grupo de cualquier rol autenticado.

**El semaforo del Cubaitor responde 200 aunque el dispositivo este caido.** No es un error de la peticion, es informacion: el evento continua con dispensado manual (RNF-13). Un 503 haria que el frontend pintara una alerta de fallo cuando lo que hay es una barra trabajando a mano.

#### Capturar una violacion de constraint exige un SAVEPOINT

```ts
// MAL: el catch devuelve un error bonito sobre una transaccion ya inservible
try {
  return await Modelo.create(datos)
} catch (e) { if (e.code === '23505') throw new SgebError('SGEB-4019') }

// BIEN: el INSERT aislado en una transaccion anidada
try {
  return await db.transaction(async (trx) => Modelo.create(datos, { client: trx }))
} catch (e) { if (e.code === '23505') throw new SgebError('SGEB-4019') }
```

PostgreSQL aborta la transaccion **completa** ante cualquier error, y toda consulta posterior responde `current transaction is aborted`. Si la llamada ocurre dentro de una transaccion mayor —otro servicio orquestando varios pasos, o una prueba envuelta en transaccion— el `catch` maneja el error pero deja la transaccion muerta, y lo siguiente falla con un mensaje que no tiene nada que ver.

Aplicado en `configurarPin` (SGEB-4019) y en `apartar` (SGEB-4011). **Regla general: si vas a capturar una violacion de constraint y continuar, aislala en un savepoint.**

Es hermano del patron de rondas anteriores. Uno dice que los efectos que deben sobrevivir al `throw` van fuera de la transaccion; este dice que los errores que se van a capturar van dentro de una anidada.

---

### Cierre: mermas y pagos

Aqui se mueve dinero, asi que las reglas son mas duras que en el resto del dominio.

**Tres bloqueos antes de calcular pagos**, en este orden:

1. El evento debe estar `finalizado`. Calcular sobre uno en curso produce importes que despues hay que corregir a mano.
2. Ninguna participacion sin salida verificada (SGEB-4015). Un mesero que no registro salida puede haberse ido antes de tiempo, y de eso depende si se le paga completo.
3. Todos con CLABE vigente (SGEB-4012). Sin cuenta no hay a donde transferir, y descubrirlo al dispersar deja pagos a medias.

**`GET /eventos/:id/cierre` existe para que el capitan vea que le falta ANTES de intentar pagar.** Recibir un error tras pulsar "pagar" es peor que tener la lista de pendientes delante en la pantalla de cierre.

**El calculo es idempotente y respeta lo ya dispersado.** Volver a llamarlo no duplica pagos; un pago en estado `pagado` es historia y no se recalcula, aunque despues cambie la tarifa del evento. Uno `pendiente` o `fallido` si se actualiza: puede que la tarifa cambiara o que el mesero corrigiera su CLABE tras un rechazo.

**`pagado` es terminal.** El pago se hace por transferencia manual, sin integracion con banca: no hay a quien preguntarle si de verdad llego, asi que revertirlo dejaria el registro contradiciendo al banco.

**La CLABE se guarda como snapshot** en el pago y se enmascara al serializar (`0121…8909`). Si el mesero cambia de cuenta despues, el registro sigue diciendo a donde se transfirio realmente el dinero.

**El costo de merma distingue "cero" de "sin valorar".** El capitan no siempre puede valorar un plato roto en el momento, asi que la respuesta reporta `costo_total` y `piezas_sin_costear` por separado: un total de $40 con cinco piezas sin costear dice algo distinto de un total de $40 con todo costeado.

---

### Checklists

La pieza que faltaba en medio del flujo del evento: sin checklist de montaje aprobado no hay asignacion de mesas (SGEB-4005).

Tres niveles que conviene no confundir:

```
CHECKLIST            la plantilla reutilizable: "Montaje de salon"
CHECKLIST_ITEM       sus tareas: "Colocar manteleria", cantidad esperada 20
CHECKLIST_INSTANCIA  la aplicacion concreta a UNA participacion
CHECKLIST_RESPUESTA  lo que ese mesero marco, item por item
```

**El servidor calcula `completado`, no el cliente.** Si la app pudiera declararlo, bastaria con enviar `completado: true` para saltarse el montaje entero. Se deriva de las respuestas y se recalcula en cada llamada.

**La aprobacion es del capitan y no automatica.** Que el mesero marque las casillas dice que el cree haber terminado; quien verifica es otra persona. Solo el checklist de tipo `montaje` pone `checklist_ok = true`; los de servicio y cierre se aprueban igual pero alimentan otros bloqueos.

**Una instancia aprobada no se reabre.** Permitir editar despues dejaria al mesero atendiendo mesas con un montaje que ya no coincide con lo que el capitan aprobo.

**Instanciar es idempotente.** Refrescar la pantalla de montaje no debe generar instancias duplicadas: el capitan veria el mismo checklist tres veces sin saber cual aprobar.

**Editar la plantilla da de baja los items viejos, no los borra.** Las respuestas historicas apuntan a ellos, y borrarlos dejaria reportes de montaje sin poder decir que se reviso. Con instancias abiertas en eventos vigentes la edicion se bloquea (SGEB-4017): un mesero podria estar a media revision y ver como le cambian las tareas bajo los pies.

---

## Lo que falta

1. **Correo** para códigos 2FA, invitaciones y recuperación. Hoy el código se escribe en el log fuera de producción (`[DEV] Codigo de verificacion: 123456`), que es lo que permite desarrollar sin servidor de correo.
2. **Endpoint de invitación para el capitán** — el servicio existe y está probado; falta exponerlo con validador y permisos.
3. **Cliente MQTT** — hoy `procesarDetalle` devuelve las instrucciones (pin, volumen, segundos); falta publicarlas en el broker del VPS 4 y recibir el reporte.
4. **Dashboard** — al final: agrega lo que los demás producen.
5. **Gestión de dispositivos y sesiones** desde el perfil del usuario.

---

## Notas de v7

- **Node 24 obligatorio.** Aplica también a los VPS de DigitalOcean y a CI.
- TypeScript ~6.0, ESLint 10, `@poppinss/ts-exec` en lugar de `ts-node`.
- `indexEntities()` en `adonisrc.ts` es obligatorio.
- `Request` / `Response` se renombraron a `HttpRequest` / `HttpResponse`.
- Globs de test: `*.spec.{ts,js}`, no `*.spec(.ts|.js)`.
- Al instalar paquetes de Japa, usar las versiones de v7: `@japa/plugin-adonisjs@^5.2.0` (el 4.x tiene peer `core@^6.17` y rompe `npm install`). Si sale `ERESOLVE`, **no taparlo con `--legacy-peer-deps` ni `--force`**: instala un árbol inconsistente y el fallo reaparece en ejecución.
