# Plan de reversa

Cómo volver atrás si un despliegue falla. Es el punto 11 de `pre-deploy-checklist` (D-070). Las decisiones están en `docs/memoria.md` (D-078). Este documento es la guía práctica.

**Estado:** el proyecto todavía no tiene entorno alojado (D-041, D-070). La app se publicará en **Vercel** y la base de datos estará en un proyecto alojado de **Supabase**. Lo que depende del plan contratado de cada uno queda marcado como `PENDIENTE DE CONFIRMAR`.

Fuentes oficiales consultadas el 2026-11-22:

- Vercel, Instant Rollback: <https://vercel.com/docs/instant-rollback>
- Supabase, Backups: <https://supabase.com/docs/guides/platform/backups>
- Supabase CLI, `db dump`: <https://supabase.com/docs/reference/cli/supabase-db-dump>

## 1. Qué se puede revertir y qué no

| Pieza | ¿Se revierte? | Cómo |
|---|---|---|
| Código de la app | Sí, en segundos | Instant Rollback de Vercel (sección 4.A) |
| Variables de entorno de Vercel | **No** las revierte el rollback | Se devuelven a mano antes del rollback |
| Esquema de la base | Solo hacia adelante | Una migración nueva que deshace la anterior (las existentes nunca se editan, agents.md §6) |
| Datos de la base | Sí, con pérdida | Respaldo diario o PITR de Supabase (sección 4.C). Se pierde todo lo posterior al punto elegido |
| Archivos de Storage (firmas, imágenes) | **No** | Los respaldos de la base no los incluyen; un archivo borrado no vuelve |
| Secretos del Vault (URLs y secreto del worker) | **No** están en los respaldos propios | Se vuelven a configurar (D-034) |
| Pago aprobado en Wompi | **No** | Reembolso en el panel de Wompi y registro en `/admin/reembolsos` (D-055, D-072) |
| Factura aceptada por la DIAN | **No** | Nota crédito (D-044, D-069); la factura nunca se borra |
| Correos enviados | **No** | Si un correo salió mal, se escribe otro al cliente |

## 2. Antes de cada despliegue

1. **Anotar lo que está en producción.** Guardar el commit (`git rev-parse HEAD`), la última migración aplicada y el despliegue actual de Vercel (su id o URL). Si algo falla, se vuelve exactamente a ese punto.
2. **Respaldo propio de la base**, además de los respaldos de Supabase. Lleva tres archivos. Los nombres de las opciones son los de la CLI 2.x del proyecto; la serie 3 cambia `--linked` y `--db-url` por `--remote`.

   ```powershell
   npx supabase db dump --linked --role-only -f roles.sql
   ```
   ```powershell
   npx supabase db dump --linked -f schema.sql
   ```
   ```powershell
   npx supabase db dump --linked --data-only --use-copy --schema public,private,auth,pgmq -f data.sql
   ```

   - **El esquema `auth` hay que pedirlo aparte.** `db dump` deja fuera por defecto los esquemas que administra Supabase, y en `auth` están las cuentas de los clientes y del personal.
   - **Un respaldo es un secreto.** Trae datos personales: nombres, correos, direcciones, fechas de nacimiento declaradas y la cédula de quien recibió cada domicilio (`delivery_proofs`, D-045). Las firmas no, porque están en Storage. También trae la clave de las huellas de la recogida (`private.pickup_secrets`, D-067). Se guarda cifrado y fuera del repositorio. `backups/` ya está en `.gitignore`.
   - Los respaldos propios **no traen** los archivos de Storage ni los secretos del Vault.
3. **Migraciones que la versión anterior de la app pueda usar.** Primero se agrega (columna, función o tabla nueva) y la app vieja sigue funcionando. Se quita lo viejo solo en un despliegue posterior, cuando ya ninguna versión en uso lo necesita. Así, si se revierte la app, la base nueva le sigue sirviendo.
4. **Migración inversa escrita de antemano** para cada migración riesgosa (las que borran o cambian columnas, o reemplazan funciones críticas como `place_order`, `apply_payment_event` o `record_delivery_attempt`). Se deja lista, probada en local y sin aplicar.
5. **Archivos de Storage.** `PENDIENTE DE CONFIRMAR` cómo descargarlos en lote. La documentación consultada no lo cubre.

## 3. Durante el despliegue

1. **Pausar el worker y la conciliación**: se vacían en el Vault `actions_worker_url` y `payments_reconcile_url`. Sin ellas, `pg_cron` no llama a la app (D-034, D-040).
   - Mientras tanto, los webhooks de Wompi siguen llegando: se verifican, se guardan y se encolan, y se procesan al reanudar.
   - Si el webhook responde un error, Wompi lo reintenta más tarde (D-040).
2. Aplicar las migraciones (`npx supabase db push --linked`). Si una falla, **no se despliega la app**.
3. Desplegar la app en Vercel.
4. Comprobar:
   - el catálogo, un pedido de prueba y `/admin`;
   - `/admin/cola`, sin cola detenida;
   - el resumen del panel, sin saldos de inventario descuadrados.
5. Reanudar el worker: volver a poner las dos URLs en el Vault.

## 4. Volver atrás

Se decide según qué falló.

### A. Falla la app y la base está bien

Instant Rollback de Vercel:

- En el panel del proyecto, ficha **Production Deployment**, opción **Instant Rollback**, o desde **Deployments**.
- Vercel vuelve a apuntar el dominio al despliegue anterior, sin compilar de nuevo.
- **Límites según el plan de Vercel:**
  - Hobby: solo al despliegue de producción inmediatamente anterior.
  - Pro y Enterprise: a cualquiera que haya estado en producción.
  - Solo un rollback a la vez por proyecto.
  - `PENDIENTE DE CONFIRMAR` qué plan se contrata.
- **Las variables de entorno no se revierten.** Si el despliegue fallido las cambió, se devuelven a mano.
  - Las `NEXT_PUBLIC_*` van dentro de la compilación (D-034), así que el despliegue anterior ya trae las suyas.
- **Después del rollback, los nuevos push a la rama de producción no se publican solos.** Cuando el arreglo esté listo, se publica con `vercel promote <id o URL>` o con **Promote** en el panel, y eso reactiva la asignación automática.
- Si el despliegue fallido aplicó migraciones, la app anterior debe poder usarlas (regla de la sección 2.3). Si no puede, se va al caso B.

### B. Falla una migración, o la app anterior no puede usar la base nueva

- Se aplica la **migración inversa** preparada (sección 2.4), como migración nueva. Las migraciones existentes nunca se editan (agents.md §6).
- `PENDIENTE DE CONFIRMAR`:
  - si `supabase db push` aplica cada archivo de migración en su propia transacción;
  - y, por tanto, si una migración que falla a mitad deja la base sin cambios.
- Comprobar después:
  - las pruebas de la base contra una copia local (`npm run db:test`);
  - la conciliación de inventario en cero (`reconcile_stock()` no devuelve filas).

### C. Los datos quedaron dañados

Último recurso, porque **se pierde todo lo escrito después del punto elegido**: pedidos, pagos, movimientos de inventario y aceptaciones legales.

1. **Elegir cómo restaurar.**
   - Respaldo diario de Supabase: 7 días en Pro, 14 en Team y hasta 30 en Enterprise.
   - PITR (recuperación a un punto en el tiempo): complemento de pago, con precisión de segundos. Al activarlo, Supabase deja de tomar respaldos diarios.
   - El plan Free no trae respaldos diarios descritos. Ahí solo sirven los respaldos propios de la sección 2.2.
   - `PENDIENTE DE CONFIRMAR` el plan contratado.
2. **Restaurar primero en un proyecto nuevo** si se quiere conservar lo actual para compararlo; Supabase lo recomienda así.
   - Restaurar sobre el mismo proyecto lo deja **inaccesible mientras dura**: hay que anunciar la caída.
   - Para un respaldo propio en un proyecto nuevo, la documentación pide antes `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;`. Así las tablas no heredan permisos de más (D-052).
3. **Después de restaurar:**
   - Volver a poner los secretos del Vault (D-034).
   - Restablecer las contraseñas de roles propios, si se crearon (Supabase no las guarda en los respaldos diarios).
   - Conciliar los pagos con Wompi: un pago aprobado después del punto restaurado ya no está en la base. Se busca en el panel de Wompi y se decide si se recrea o se reembolsa.
   - Revisar en Factus las facturas y notas crédito emitidas después del punto restaurado.
   - Conciliación de inventario en cero.
   - Correr `pre-deploy-checklist`.

## 5. Ensayo en local

Para practicar sin tocar nada alojado:

```powershell
npm run db:backup
```
```powershell
npm run db:restore -- backups/<fecha-hora>
```

- `db:backup` respalda la base local (roles, esquema y datos de `public`, `private`, `auth` y la cola) en `backups/<fecha-hora>/`, con un `meta.json` que dice el commit y la última migración.
- `db:restore` solo restaura en la base local de Docker: no recibe URL ni proyecto.
  1. Se niega si el código actual no termina en la misma migración que el respaldo.
  2. Reconstruye el esquema con las migraciones (`db reset --no-seed`).
  3. En una sola transacción, vacía las tablas que trae el respaldo y carga los datos. Las migraciones ya insertan datos de referencia (municipios, tarifas, ajustes), así que sin vaciarlas el respaldo choca. Si algo falla, no queda nada a medias.
  4. Los triggers no se vuelven a ejecutar (`session_replication_role = replica`), así que saldos, historial y auditoría vuelven tal cual.

**Ensayo del 2026-11-22:**

1. Un cliente y un pedido para recoger de 2 aguardientes: 1 pedido, 6 movimientos, 120 en existencia, 2 reservadas.
2. Respaldo.
3. Otro pedido y una entrada de 24 unidades: 2 pedidos, 8 movimientos, 144 en existencia.
4. Restauración: la base volvió exactamente al punto del respaldo.
   - 1 pedido, 6 movimientos, 120 en existencia y 2 reservadas.
   - Conciliación en cero.
   - La huella de la cédula sigue validando, porque la clave de `private.pickup_secrets` volvió con el respaldo.
5. Un pedido nuevo funcionó sobre la base restaurada.

El primer intento falló por los datos de referencia de las migraciones, y eso llevó a la corrección del paso 3 de `db:restore`.

## 6. Pendientes de confirmar

- El plan de Vercel (Hobby o Pro) y el de Supabase (Free, Pro o con PITR).
- Quién ejecuta el rollback y con qué cuenta, y dónde se guardan, cifrados, los respaldos propios.
- Cómo respaldar en lote los archivos de Storage.
- Si `supabase db push` aplica cada migración en una transacción propia.
