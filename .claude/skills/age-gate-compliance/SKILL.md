---
name: age-gate-compliance
description: Aviso de mayoría de edad, verificación de edad en el registro, auditoría y textos legales. Úsala en cualquier cambio que toque cumplimiento de venta de licor.
---

# age-gate-compliance

Base legal (a validar con abogado): la Ley 124 de 1994 prohíbe el expendio de bebidas embriagantes a menores de edad, y el Decreto 120 de 2010 exige exhibir de forma visible la prohibición. Ver `docs/memoria.md`, D-008.

1. **Aviso al entrar:** pantalla de 18+ antes de mostrar el catálogo. Un "sí" recordado en cookie no sustituye la verificación del registro.
2. **Aviso permanente:** texto visible en el pie y en el checkout. Está en `src/modules/compliance/legal-copy.ts`. **No lo modifiques ni lo reescribas**; si hace falta un cambio, propónlo a una persona para aprobación.
3. **Registro:** fecha de nacimiento obligatoria; se rechaza si la persona tiene menos de 18 años. Se calcula la edad en servidor.
4. **Auditoría:** guarda la aceptación del aviso, la fecha de nacimiento declarada, la fecha/hora y la versión del texto legal aceptada. Minimiza datos personales (habeas data).
5. **Entrega:** el pedido no se marca entregado sin la prueba con cédula (ver `delivery-proof`).
6. **Bloqueos:** si hay una regla activa de `block-sales-rule`, el checkout debe impedir la compra con un mensaje claro.
7. **Publicidad y textos comerciales:** cualquier copy de marketing de licor se revisa con una persona; no pasa por `antislop` si es texto legal.
8. Pruebas: menor de 18 en registro, intento de saltar el aviso, versión del texto legal registrada, pedido sin prueba de entrega.

Pendiente: nivel exacto de verificación (P-002) y revisión legal (P-006).
