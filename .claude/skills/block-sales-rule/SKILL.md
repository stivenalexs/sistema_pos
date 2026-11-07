---
name: block-sales-rule
description: Reglas configurables para bloquear ventas por municipio, fecha y hora (ley seca, restricciones locales). Úsala al tocar el checkout o la configuración de restricciones.
---

# block-sales-rule

Objetivo: que administración pueda bloquear ventas sin tocar código (ver P-006: validar las restricciones reales con un abogado).

1. Tabla `sales_blocks`: `scope` (`global` o `municipality`), `municipality_id` opcional, `starts_at`, `ends_at` (`timestamptz`), recurrencia opcional por día de semana y franja horaria, `channels` (`web`, `pos`), `message` para el cliente, `active`, `created_by`.
2. Evaluación **en servidor**, con hora de `America/Bogota`, en dos momentos: al agregar al carrito (aviso) y al confirmar el pedido (bloqueo definitivo). El POS también la consulta.
3. El municipio de entrega sale de la dirección del pedido, no de una selección editable después.
4. El bloqueo no borra carritos: los deja guardados y explica por qué no se puede comprar y hasta cuándo.
5. Cambios en la tabla solo por administración, con registro de quién y cuándo.
6. Pruebas: bloqueo vigente, bloqueo que vence a mitad del checkout, municipio distinto, canal POS.
