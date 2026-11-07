# Traspaso entre sesiones

Estado al **2026-11-07**, rama `claude` (último commit antes de esta nota: `dd629ae`). Léelo después de `agents.md` y `docs/memoria.md`; las decisiones viven en la memoria, aquí solo está lo práctico para retomar.

## Dónde vamos

- **Pasos 1 a 13 de `plan.md` hechos** (fases 0 a 5): base técnica, Supabase, catálogo y precios con RLS, cola de acciones y `ActionButton`, aviso 18+ y registro, inventario con reservas, carrito y pedidos, pagos con Wompi (probado con el sandbox real) y facturación con Factus (probada solo con respuestas simuladas).
- **Siguiente: paso 14 (domicilios, skill `delivery-proof`).** Antes de planearlo hay que resolver **P-010** con el responsable: cómo se obtienen las coordenadas de la entrega (se propuso que el cliente marque su ubicación en un mapa) y qué municipios forman el "área metropolitana" de la tarifa (D-005, D-021). Hoy `place_order` rechaza `delivery`; solo existe recogida en tienda.
- Pendientes de pasos ya hechos:
  - **Factus:** probar con el sandbox cuando el responsable ponga las credenciales `FACTUS_*` en `.env.local` (supuestos a confirmar en D-043 y D-044: consumidor final `222222222222`, `dv` del NIT, código de concepto `2` de la nota crédito, `reference_code` repetido, duración del token).
  - **Textos legales** (`legal-copy.ts`): siguen en borrador, no aprobados (D-035). No se tocan sin aprobación.
  - **P-006** (abogado) y **P-013** (documentos del mayorista) siguen abiertos.
- Parte visual: aplazada por decisión del responsable (D-037). El proyecto no saldrá a vender: se permiten supuestos marcados `SUPUESTO DEL PROYECTO` (D-041).

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

- **Usuario de prueba:** registrarlo con `POST http://127.0.0.1:54321/auth/v1/signup` (clave publicable de `npx supabase status -o json`, `data` con `full_name`, `customer_type`, `birth_date`, `accept_age/terms/privacy: true`, `legal_version: "0-borrador"`) y confirmar con `update auth.users set email_confirmed_at = now() where email = '...'`.
- **Llamar a la API como un cliente sin navegador:** obtener la sesión con `POST /auth/v1/token?grant_type=password` y enviarla como cookie `sb-127-auth-token=base64-<base64url del JSON de la sesión>`. Borrar el archivo de la sesión al terminar.
- **El panel del navegador de Claude suele estar oculto** y entonces la página no hidrata: los clics no responden. Comprobar la hidratación (`Object.keys(boton).some(k => k.startsWith('__react'))`) o usar el truco anterior.
- **El CDN de Wompi bloquea cualquier navegador automatizado y cualquier `redirect-url` a `localhost`** (403). En local el checkout va sin `redirect-url`; para volver a la app, abrirla como `http://lvh.me:3000`. Sin túnel, los pagos del sandbox se confirman con la conciliación: guardar el id de la transacción como pista y llamar `POST /api/workers/reconcile-payments` con `WORKER_SECRET` (solo toma intentos de más de 15 minutos).
- **Next.js 16:** `proxy.ts` en lugar de `middleware`; lo que lee la sesión necesita `await connection()` dentro de `<Suspense>`; un componente de navegador no importa el `index.ts` de un módulo con código de servidor; leer cookies en el layout raíz rompe las Server Actions con error (por eso `SessionNav` lee la sesión en el navegador). Documentación local en `node_modules/next/dist/docs/`.
- Las pruebas pgTAP dependen de los datos de `seed.sql`: si fallan pruebas de stock tras probar a mano, correr `npm run db:reset` primero.
