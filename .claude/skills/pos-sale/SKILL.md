---
name: pos-sale
description: Registrar una venta física en el POS descontando el inventario compartido con la web y emitiendo su factura.
---

# pos-sale

Decisión base: la venta física debe reflejarse en la disponibilidad de la web (`docs/memoria.md`, D-009).

1. **Rol:** solo usuarios con rol `cashier` o superior (en `app_metadata`). Pantalla del POS sin animaciones.
2. **Es una acción asíncrona:** usa `async-action`. El botón "Cobrar" usa `ActionButton` y queda bloqueado hasta recibir el `tracking_id`.
3. **Descuento atómico:** la venta inserta movimientos de tipo `pos_sale` en `inventory_movements` en una sola operación condicionada a stock suficiente. Si no alcanza, falla con mensaje claro y no vende parcial sin que la persona lo decida.
4. **Concurrencia:** una venta POS y un pago web a la vez sobre la última botella nunca se venden dos veces; el descuento condicional lo garantiza.
5. **Precios:** se toman de la lista que corresponda (minorista por defecto; mayorista si se identifica al cliente) calculados en servidor.
6. **Factura:** encola emisión en Factus (`factus-invoice`). El tipo de documento para ventas POS lo confirma el contador (P-005).
7. **Pago físico:** efectivo, datáfono u otros medios se registran como tales; no pasan por Wompi.
8. **Sin internet:** si cae la conexión, el POS guarda la venta en cola local y sincroniza al volver. La sincronización usa `idempotency_key` para no duplicar.
9. **Edad:** el cajero confirma mayoría de edad al vender (casilla obligatoria registrada en la venta).
10. Pruebas: venta con stock justo, dos ventas simultáneas, sincronización tras corte de internet, anulación (genera movimiento inverso y nota crédito).
