# Memoria del proyecto

Registro de decisiones. Se lee al iniciar cada sesión (referenciado desde `agents.md`).

**Cómo agregar una entrada:** al final de la sección "Decisiones", con el siguiente número `D-XXX`: fecha (AAAA-MM-DD), decisión, motivo, alternativas descartadas. Si una decisión sustituye otra, marca la anterior como `SUSTITUIDA por D-XXX` (no se borra). Los supuestos van en "Pendientes de confirmar" hasta que la persona responsable los confirme.

## Decisiones

### Negocio
- **D-001 (2026-11-06)** Tienda web de licor mayorista y minorista, **solo Colombia y solo Antioquia**, con POS físico incluido.
- **D-002 (2026-11-06)** Dos tipos de cliente: `wholesale` y `retail`, con catálogos y precios diferenciados.
- **D-003 (2026-11-06)** Mayoristas ven productos **nacionales e importados**; minoristas ven **solo nacionales**. Los importados son exclusivos de mayoristas.
- **D-004 (2026-11-06)** Mayoristas compran **por caja**, con mínimos por caja distintos a los del minorista. Minoristas compran **por unidad/cantidad cuando la opción se activa** en el producto.
- **D-005 (2026-11-06)** Domicilio con cargo: $6.000 si la distancia es menor o igual a 1 km, $15.000 si es mayor. La tarifa aplica **solo al área metropolitana**. Mayoristas con pedido de **20 o más cajas** no pagan envío y el costo lo asume la tienda. Las tarifas viven en una tabla configurable, no en el código.
- **D-006 (2026-11-06)** Domicilios con **mensajeros propios y con terceros**.
- **D-007 (2026-11-06)** Para ambos perfiles, al recibir el pedido se exige **mostrar y firmar con número de cédula**. Se guarda prueba de entrega.
- **D-008 (2026-11-06)** Aviso de mayoría de edad (18+) al entrar y verificación de edad. Ley 124 de 1994 prohíbe el expendio a menores; el aviso debe ser visible de forma permanente (Decreto 120 de 2010).
- **D-009 (2026-11-06)** La venta en el punto físico (**POS**) debe descontar la disponibilidad de la web. No existe inventario previo: **el POS y el inventario se construyen dentro del proyecto**. (La palabra "posts" en el planteamiento original era un error de digitación de "POS".)

### Tecnología
- **D-010 (2026-11-06)** Frontend: Next.js (App Router) + TypeScript + Tailwind.
- **D-011 (2026-11-06)** Backend: monolito modular en Next.js + Supabase (Postgres, RLS, funciones) + cola en Postgres. Descartados: NestJS aparte y FastAPI (más piezas y otro lenguaje o servidor); Nuxt y Astro (peor encaje con el resto del ecosistema elegido).
- **D-012 (2026-11-06)** Base de datos y autenticación: Supabase. Rol de usuario en `app_metadata`.
- **D-013 (2026-11-06)** Pagos: Wompi, con PSE considerado para ambos perfiles. La fuente de verdad del pago es el webhook.
- **D-014 (2026-11-06)** Facturación electrónica: Factus. La factura se emite en un worker solo tras pago aprobado, con referencia única por pedido.
- **D-015 (2026-11-06)** Herramienta de desarrollo: Claude Code. `CLAUDE.md` importa `agents.md` y `docs/memoria.md`.
- **D-016 (2026-11-06)** Herramientas externas aceptadas con alcance limitado (ver `agents.md`, sección 8): Motion AI Kit (versión gratuita), servidor MCP context-mode, skill antislop (solo textos comerciales) y thermos (revisión manual antes de fusionar).

### Infraestructura (no negociable)
- **D-017 (2026-11-06)** Procesamiento en paralelo: el cliente nunca espera el procesamiento para seguir navegando. Patrón "aceptar rápido, procesar después": acción guardada, encolada y respuesta `202` con `tracking_id`; workers consumen la cola.
- **D-018 (2026-11-06)** Todo botón de pago o acción se congela hasta que se procese o hasta que se asigne el `tracking_id`. Tres capas contra duplicados: UI, `idempotency_key`, restricción única en BD.
- **D-019 (2026-11-06)** Inventario mediante libro de movimientos de solo inserción (`inventory_movements`), con descuento atómico y reservas con vencimiento.

### Seguridad del repositorio
- **D-020 (2026-11-06)** Protección de secretos en dos niveles. (1) `.gitignore` excluye `.env`, `.env.*`, `*.env`, `supabase/.env*` y `*.pem`, pero conserva `.env.example`. (2) `.claude/settings.json` deniega a Claude `Read`, `Edit` y `Write` sobre `.env`, `.env.local`, `.env.*.local`, `.env.development`, `.env.production`, `.env.test`, `.env.staging`, `*.env` y `*.pem`, y los comandos `cat`/`type` sobre `.env*`, `printenv` y `env`. **`.env.example` queda fuera del bloqueo** porque solo contiene nombres de variables sin valores y Claude debe poder mantenerlo (paso 5 del plan). Motivo: agents.md sección 6 y 8. Alternativa descartada: denegar el comodín `.env*`, que también bloquearía `.env.example`, porque en Claude Code las reglas de denegación prevalecen sobre las de permiso. Limitación conocida: el bloqueo de comandos de shell es por coincidencia de texto y no cubre toda forma posible de leer un archivo; la regla de no leer secretos sigue vigente.

## Pendientes de confirmar (supuestos del asistente, no decisiones)

- **P-001** Medición del 1 km del domicilio: se propone distancia en línea recta con PostGIS (gratis); por ruta exigiría un servicio de mapas de pago.
- **P-002** Nivel de verificación de edad: se propone fecha de nacimiento + aceptación en el registro + prueba de entrega con cédula, con registro de auditoría. No se pide foto del documento al registrarse.
- **P-003** Vencimiento de reservas de stock para pagos pendientes (PSE): se propone 30 minutos.
- **P-004** Si el minorista también puede comprar por caja, y si hay mínimo en unidades al activar la compra por cantidad.
- **P-005** Tratamiento tributario (IVA, impuesto al consumo departamental) de nacionales e importados, y qué documento electrónico se emite en ventas POS: consultar al contador.
- **P-006** Derecho de retracto, horarios y "ley seca" municipales, publicidad de licor y habeas data (Ley 1581): consultar a un abogado.
- **P-007** Disponibilidad de Supabase Queues (pgmq) en el plan contratado; si no, usar tabla de cola propia o un servicio gestionado.
- **P-008** Si los mensajeros de terceros se integran por API o solo se les asigna el pedido manualmente.
- **P-009** Confirmar que "thernos" es la skill `thermos`.
