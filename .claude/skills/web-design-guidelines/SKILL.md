---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance (accessibility, focus, forms, motion, typography, images, layout, touch). Audit only. Use when asked to "review my UI", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

<!--
Origen: vercel-labs/agent-skills, skills/web-design-guidelines/SKILL.md,
commit 1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62 (licencia MIT según su README).
Pautas: vercel-labs/web-interface-guidelines, command.md,
commit 434b7f91364665f2f733b310ec54809bf8f37937 (MIT, ver LICENSE-guidelines).
Adaptada para este proyecto (D-061): lee las pautas de la copia local fijada
en lugar de descargarlas, y las reglas del proyecto mandan sobre las pautas.
Para actualizar: revisar el diff de command.md en GitHub, reemplazar
guidelines.md y cambiar el commit aquí y en docs/memoria.md.
-->

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## Alcance en este proyecto (agents.md §8, D-061)

- **Solo auditoría.** Reporta hallazgos; no cambia código. Las correcciones se aplican solo con aprobación del responsable.
- **No descargues las pautas.** Usa la copia fijada en `guidelines.md` de esta carpeta.
- **No agregues dependencias** (por ejemplo `nuqs`, `virtua`) ni herramientas; si una regla las sugiere, repórtalo como sugerencia.

## Reglas del proyecto que mandan sobre las pautas

Si una pauta contradice estas reglas, no la reportes como falla:

- **Textos en español de Colombia, sin "Title Case":** "Crear cuenta", no "Crear Cuenta". La guía de redacción en inglés (voz, mayúsculas, `&`) no aplica.
- **Botones de acción congelados (agents.md §5.2, D-018, D-046):** `ActionButton` y `FormSubmitButton` se bloquean en el primer clic y muestran "Procesando…" (u otro texto con `…`) con borde punteado dorado. **Sin spinner ni animación.** No reportes "submit stays enabled" ni "spinner during request".
- **Movimiento (agents.md §8, D-046, D-048, D-050):** nada se anima en el carrito, el checkout, el pago, el pedido, el POS ni el mensajero. La única excepción es el carrusel del catálogo, con `prefers-reduced-motion` respetado.
- **Tema oscuro único (D-046):** colores solo desde las variables de `globals.css`.
- **Límites de módulos y precios en el servidor** (agents.md §3 y §5) no se tocan para cumplir una pauta.

## How It Works

1. Read the guidelines from `guidelines.md` in this folder
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the guidelines, except where the project rules above override them
4. Output findings in the terse `file:line` format

## Usage

When a user provides a file or pattern argument:
1. Read `guidelines.md`
2. Read the specified files
3. Apply all rules from the guidelines and the project rules
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
