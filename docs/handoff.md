# Traspaso entre sesiones

Estado al **2026-11-07**, rama `claude` (último commit antes de esta nota: `0ed609f`; el paso 14 está **sin commit** hasta que el responsable lo pida). Léelo después de `agents.md` y `docs/memoria.md`; las decisiones viven en la memoria, aquí solo está lo práctico para retomar.

## Dónde vamos

- **Pasos 1 a 14 de `plan.md` hechos**: base técnica, Supabase, catálogo y precios con RLS, cola de acciones y `ActionButton`, aviso 18+ y registro, inventario con reservas, carrito y pedidos, pagos con Wompi (probado con el sandbox real), facturación con Factus (probada solo con respuestas simuladas) y domicilios con mapa, tarifa por distancia, asignación de mensajeros y prueba de entrega (D-045).
- **Siguiente: paso 15 (bloqueos de venta por municipio, fecha y hora, skill `block-sales-rule`).** Los municipios ya existen en `delivery_zones`; para el POS no hay municipio del comprador (es la tienda). Depende en parte de P-006 (horarios y ley seca: se modelan como reglas configurables).
- **Para el paso 17:** crear personal interno (mensajeros, administradores) con `auth.admin.createUser` falla por el trigger del registro (ver D-045). La interfaz de asignación de domicilios, zonas, tarifas y la ubicación real de la tienda (`app_settings.store_location`, hoy un supuesto) también van allí.
- Pendientes de pasos ya hechos:
  - **Factus:** probar con el sandbox cuando el responsable ponga las credenciales `FACTUS_*` en `.env.local` (supuestos a confirmar en D-043 y D-044: consumidor final `222222222222`, `dv` del NIT, código de concepto `2` de la nota crédito, `reference_code` repetido, duración del token).
  - **Textos legales** (`legal-copy.ts`): siguen en borrador, no aprobados (D-035). No se tocan sin aprobación.
  - **P-006** (abogado) y **P-013** (documentos del mayorista) siguen abiertos.
- **Parte visual hecha (D-046, D-047):** tema oscuro "La Cava" tomado del login de Figma; imágenes de producto en Storage (políticas aprobadas; la pantalla de subida llega en el paso 17). El catálogo es un carrusel dentro de un barril (D-048, única excepción de movimiento). Las fotos de ejemplo se suben solas con `db:reset`. Al crear pantallas nuevas, usar las utilidades de `globals.css` y `PageHeader`/`PhotoShell` de `src/shared/ui`, nunca colores sueltos ni animaciones. El proyecto no saldrá a vender: se permiten supuestos marcados `SUPUESTO DEL PROYECTO` (D-041).

## Forma de trabajo acordada con el responsable

- Un paso por vez: plan corto sin código → aprobación → implementación con su skill → `typecheck`, `lint`, `test`, `build`, `npm run db:test` y `supabase db lint` → memoria → commit **solo cuando lo pide**.
- **Commit en dos pasos:** primero `git add` y revisión de secretos sobre el diff, después `git commit`. Nunca en el mismo comando.
- **Revisión humana obligatoria** antes del commit de: políticas RLS, `verify-signature.ts` (archivo protegido) y textos legales.
- **Uso:** revisar con `get_usage` antes de cada paso y detenerse al 80 % del límite de 5 horas, en un punto seguro.
- Antes de una API externa (Wompi, Factus), leer su documentación oficial y presentar los campos. Para Factus está la skill oficial `.claude/skills/facturas-crear-y-validar/`.

## Entorno local

- **Docker Desktop** debe estar corriendo (tarda ~2 minutos en arrancar). En la terminal Bash de Claude, `docker` no está en el PATH: anteponer `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH";`.
- `npm run db:start` / `db:reset` (vuelve a los datos de `supabase/seed.sql`; borra usuarios y pedidos de prueba) / `db:test` / `db:types`.
- Servidor: `preview_start` con la configuración `web` de `.claude/launch.json` (`npm run dev`, puerto 3000).
- `.env.local` es del responsable y Claude no lo lee. Ya tiene Supabase local, `WORKER_SECRET` y las cuatro llaves `WOMPI_*` de sandbox con `WOMPI_ENV=sandbox`. Faltan las `FACTUS_*`. Los nombres exactos están en `.env.example`.
- Para usar sus valores sin leerlos: `node --env-file=.env.local -e "..."` (imprimir solo resultados, nunca valores).
- Mailpit (correos de confirmación): `http://127.0.0.1:54324`.

## Trucos que ahorran tiempo

- **Personal interno de prueba (mensajero, administrador):** la API de administración no sirve (D-045). Crearlo por SQL dentro del contenedor (`docker exec supabase_db_sistema_pos psql -U postgres ...`): insertar en `auth.users` con `encrypted_password = extensions.crypt(clave, extensions.gen_salt('bf'))`, `raw_app_meta_data` con `staff_role`, las columnas de token en `''`, y su fila en `auth.identities`; para un mensajero, además su fila en `couriers`. En Git Bash, anteponer `MSYS_NO_PATHCONV=1` a `docker cp`/`docker exec` con rutas `/tmp/...`.
- **Probar domicilios sin navegador:** un pedido pasa a `paid` con un `PATCH` de servicio; `assign_delivery` se llama por `/rest/v1/rpc` con el token del administrador; la entrega se envía como `multipart` a `/api/deliveries/{pedido}/attempts` con la cookie del mensajero y después se corre el worker (`POST /api/workers/actions` con `WORKER_SECRET`), porque tras `db:reset` el Vault queda vacío y `pg_cron` no llama al worker.
- **Usuario de prueba:** registrarlo con `POST http://127.0.0.1:54321/auth/v1/signup` (clave publicable de `npx supabase status -o json`, `data` con `full_name`, `customer_type`, `birth_date`, `accept_age/terms/privacy: true`, `legal_version: "0-borrador"`) y confirmar con `update auth.users set email_confirmed_at = now() where email = '...'`.
- **Llamar a la API como un cliente sin navegador:** obtener la sesión con `POST /auth/v1/token?grant_type=password` y enviarla como cookie `sb-127-auth-token=base64-<base64url del JSON de la sesión>`. Borrar el archivo de la sesión al terminar.
- **El panel del navegador de Claude suele estar oculto.** Además, con el panel oculto React no muestra el contenido que llega por streaming dentro de `<Suspense>` (queda "Cargando…" aunque el HTML ya llegó, en un `div hidden id="S:0"`) y las capturas fallan; en ese caso verificar por HTTP. La página no siempre hidrata: los clics no responden. Comprobar la hidratación (`Object.keys(boton).some(k => k.startsWith('__react'))`) o usar el truco anterior.
- **El CDN de Wompi bloquea cualquier navegador automatizado y cualquier `redirect-url` a `localhost`** (403). En local el checkout va sin `redirect-url`; para volver a la app, abrirla como `http://lvh.me:3000`. Sin túnel, los pagos del sandbox se confirman con la conciliación: guardar el id de la transacción como pista y llamar `POST /api/workers/reconcile-payments` con `WORKER_SECRET` (solo toma intentos de más de 15 minutos).
- **Next.js 16:** `proxy.ts` en lugar de `middleware`; lo que lee la sesión necesita `await connection()` dentro de `<Suspense>`; un componente de navegador no importa el `index.ts` de un módulo con código de servidor; leer cookies en el layout raíz rompe las Server Actions con error (por eso `SessionNav` lee la sesión en el navegador). Documentación local en `node_modules/next/dist/docs/`.
- Las pruebas pgTAP dependen de los datos de `seed.sql`: si fallan pruebas de stock tras probar a mano, correr `npm run db:reset` primero.
