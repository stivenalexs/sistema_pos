---
name: async-action
description: Implementar cualquier acción que deba procesarse en paralelo con ID de seguimiento, botón bloqueado e idempotencia (pagos, pedidos, ventas POS, solicitudes de domicilio).
---

# async-action

Patrón "aceptar rápido, procesar después". Sigue estos pasos en orden.

1. **Tabla `actions`** (si no existe): `id` (= `tracking_id`), `idempotency_key` UNIQUE, `type`, `user_id`, `status` (`queued`, `processing`, `succeeded`, `failed`), `payload`, `result`, `attempts`, `created_at`, `updated_at`.
2. **Cliente:** genera un `idempotency_key` (UUID) por intención, no por clic. Envía el botón con `ActionButton` de `src/shared`.
3. **Endpoint:** valida entrada y permisos, inserta en `actions` (si la clave ya existe, devuelve el `tracking_id` existente), encola el trabajo y responde `202 { tracking_id }` en menos de un segundo. Nada pesado en la petición.
4. **ActionButton:** se bloquea de inmediato al clic. Se libera cuando llega el `tracking_id` (acciones rápidas) o cuando la acción termina (pagos). Siempre muestra estado: "Procesando…", éxito o error con opción de reintentar usando la **misma** clave.
5. **Worker:** toma el mensaje de la cola, marca `processing`, ejecuta el caso de uso, guarda `result`, marca `succeeded` o `failed`. Idempotente: reejecutar no duplica efectos. Reintentos con backoff y tope; al agotarlos, `failed` visible para administración.
6. **Seguimiento:** el cliente consulta el estado por Supabase Realtime o por polling a `/api/actions/{tracking_id}`.
7. **Pruebas mínimas:** doble clic rápido, dos pestañas, reintento tras error de red, worker que falla a mitad y reintenta.

Prohibido: `<button>` suelto para acciones; confiar solo en el bloqueo de la interfaz; generar una clave nueva al reintentar.
