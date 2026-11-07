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

### Pendientes resueltos (paso 2 del plan, 2026-11-06)
- **D-021 (2026-11-06)** Resuelve P-001. El kilómetro del domicilio se mide **en línea recta** con PostGIS, desde la tienda hasta la dirección de entrega. Motivo: es gratis y corre dentro de Supabase. Descartados: distancia por ruta (exige un servicio de mapas de pago) y tarifas por barrio o zona.
- **D-022 (2026-11-06)** Resuelve P-002. Verificación de edad: **fecha de nacimiento (≥18) y aceptación en el registro, con auditoría, y cédula verificada en la entrega** (D-007). No se pide foto del documento al registrarse. Descartados: foto de la cédula en el registro (guarda datos sensibles bajo habeas data y exige revisión manual) y solo fecha sin auditoría.
- **D-023 (2026-11-06)** Resuelve P-003. Las reservas de stock de pedidos web pendientes de pago vencen a los **30 minutos**. El valor vive en configuración, no en el código. Descartados: 15 minutos (puede vencer en pagos PSE lentos) y 60 minutos (bloquea stock demasiado tiempo frente al POS).
- **D-024 (2026-11-06)** Resuelve P-004 y precisa D-004. El minorista compra **solo por unidad**; la compra por caja es exclusiva del mayorista. Cuando un producto permite la compra por unidad, define su **cantidad mínima en unidades por producto** (por defecto 1). Descartados: caja para minoristas (siempre o configurable), compra sin mínimo y mínimo por valor del pedido.
- **D-025 (2026-11-06)** Resuelve P-007 de forma condicionada. La cola usa **Supabase Queues (pgmq)**. La disponibilidad de la extensión se verifica al conectar el proyecto (paso 5 del plan). Si no está disponible, se usa una tabla de cola propia con `FOR UPDATE SKIP LOCKED`, y eso se registra como decisión nueva. Descartado por ahora: tabla propia desde el inicio.
- **D-026 (2026-11-06)** Resuelve P-008. Los mensajeros de terceros se manejan con **asignación manual**: el administrador asigna el pedido y actualiza su estado. Una integración por API con una empresa concreta queda para una fase posterior, si se necesita. Descartados por ahora: integración por API y modelo mixto.
- **D-027 (2026-11-06)** Resuelve P-009. "thernos" era un error de digitación de la skill **`thermos`**, como dice agents.md sección 8.
- **D-028 (2026-11-06)** Herramientas externas, paso 3 del plan.
  - **Motion AI Kit:** instalado con `npx motion-ai@14.2.0` (MIT), solo para este proyecto y solo para Claude Code. Agregó la skill `.claude/skills/motion/` y el servidor MCP alojado `motion` (`https://mcp.motion.dev`) en `.mcp.json`. **Retirados a mano** el servidor `motion-plus` y el agente `.claude/agents/motion-reviewer.md`, porque solo funcionan con Motion+ (de pago) y D-016 limita al plan gratuito. Las reglas de agents.md §8 mandan sobre las de la skill: nunca ocultar el estado bloqueado de `ActionButton`, respetar `prefers-reduced-motion`, nada de animación en checkout ni en el POS, y CSS para lo simple. La librería `motion` de la aplicación se agrega cuando exista el proyecto Next.js. Al actualizar la versión, el instalador vuelve a escribir `motion-plus` y el agente; hay que retirarlos de nuevo.
  - **context-mode: no se instala por ahora.** Al revisarlo se vio que instalado como plugin choca con el proyecto. Sus hooks resumen las lecturas de archivos de más de 16 KB, y agents.md §8 exige leer completos las migraciones, las políticas RLS y los webhooks. Sus herramientas de ejecución corren código en un sandbox donde no aplica el bloqueo de `.env` de D-020. Además puede crear su propio `CLAUDE.md`. La serie 2.x tampoco es estable: 9 versiones entre el 2026-11-04 y el 2026-11-06. Licencia ELv2. Alternativa descartada por ahora: instalarlo solo como MCP, con la versión `1.0.169` fijada y sus herramientas de ejecución denegadas. Si se retoma, esa es la vía propuesta.

## Pendientes de confirmar (supuestos del asistente, no decisiones)

- ~~**P-001**~~ Resuelto en D-021.
- ~~**P-002**~~ Resuelto en D-022.
- ~~**P-003**~~ Resuelto en D-023.
- ~~**P-004**~~ Resuelto en D-024.
- **P-005** Tratamiento tributario (IVA, impuesto al consumo departamental) de nacionales e importados, y qué documento electrónico se emite en ventas POS: consultar al contador. **Sigue abierto (2026-11-06)**. Bloquea los pasos 13 y 16. Mientras tanto, impuestos y tipos de documento se diseñan como tablas configurables.
- **P-006** Derecho de retracto, horarios y "ley seca" municipales, publicidad de licor y habeas data (Ley 1581): consultar a un abogado. **Sigue abierto (2026-11-06)**. Los horarios y la ley seca se modelan como reglas configurables (paso 15) y los textos legales quedan provisionales hasta su aprobación.
- ~~**P-007**~~ Resuelto en D-025 (con verificación en el paso 5).
- ~~**P-008**~~ Resuelto en D-026.
- ~~**P-009**~~ Resuelto en D-027.
- **P-010** Cómo se obtienen las coordenadas de la dirección de entrega para medir la distancia en línea recta (D-021). Se propone que el cliente marque su ubicación en un mapa al registrar la dirección. La alternativa es convertir la dirección escrita en coordenadas (geocodificación), que suele ser un servicio de pago o con límites de uso. Las direcciones colombianas ("Cra 43A # 1-50") geocodifican de forma poco precisa. También falta definir qué municipios forman el "área metropolitana" de D-005.
