---
name: supabase-migration
description: Crear o cambiar tablas, políticas RLS o funciones SQL en Supabase. Úsala siempre que haya un cambio de esquema.
---

# supabase-migration

1. Lee `docs/memoria.md` y revisa que el cambio no contradiga decisiones.
2. Crea una migración **nueva** en `supabase/migrations/` con nombre `YYYYMMDDHHMMSS_descripcion_corta.sql`. Nunca edites una migración existente.
3. Tablas: `snake_case` plural, `id uuid` por defecto, `created_at` y `updated_at` en `timestamptz`, dinero en `*_cop` entero.
4. **RLS obligatoria** en la misma migración: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` y al menos una política por operación necesaria. Sin política, nadie accede: es lo esperado.
5. Roles: lee el tipo de cliente y el rol interno desde `auth.jwt() -> 'app_metadata'`. Nunca desde `user_metadata`.
6. Estructuras que deben ser atómicas (descuento de stock, reservas) van en funciones SQL, no en varias llamadas desde la app.
7. Restricciones `UNIQUE` para claves de idempotencia y referencias externas (pedido, evento de Wompi, factura).
8. Regenera los tipos de TypeScript y corre `typecheck`.
9. Revisión final: ¿toda tabla nueva tiene RLS? ¿hay índices para las consultas previstas? ¿se puede revertir o es solo de avance?
10. Registra decisiones de esquema relevantes en `docs/memoria.md`.

Prohibido: usar la `service_role` en código de navegador; desactivar RLS "temporalmente".
