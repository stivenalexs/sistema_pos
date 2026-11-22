---
name: thermos
description: "Launch both thermo-nuclear review subagents in parallel, then synthesize their findings. Use for thermos, double thermo review, or combined bug/security and code-quality branch audits."
disable-model-invocation: true
---

> **Origen:** [ahonn/dotfiles](https://github.com/ahonn/dotfiles), commit `27f1e58` (archivo introducido en `d403f25`, 2026-09-10), licencia MIT (`.claude/skills/thermos/LICENSE`). Copia fijada a pedido del responsable y revisada: solo Markdown, sin scripts (D-071). Para actualizar: revisar el diff en GitHub, reemplazar el archivo y cambiar el commit aquí y en la memoria.

## Alcance en este proyecto (manda sobre el texto original)

- **Solo reporta.** Ningún hallazgo se aplica sin aprobación del responsable (agents.md §8). No edites archivos.
- **Alcance:** cuando el responsable pide revisar todo el repositorio (paso 19 de `plan.md`), revisa el código existente aunque no esté en un diff; la regla original de "solo código añadido o modificado" aplica solo cuando se revisa una rama o un PR.
- **Sin PR:** no hay `gh` ni `glab` en este entorno; omite la lectura de la discusión del PR.
- **No propongas cambiar el monolito modular ni el stack** (agents.md §2 y §8): Next.js, Supabase, cola en Postgres, Wompi, Factus.
- **Migraciones:** una corrección de esquema se propone como migración nueva; nunca editar una migración existente (agents.md §6).
- **Prohibido leer** `.env*` y cualquier secreto. `src/modules/compliance/legal-copy.ts` y `verify-signature.ts` son protegidos: se reportan hallazgos, no se proponen ediciones directas sin revisión humana.
- **Reglas y decisiones:** `agents.md` y `docs/memoria.md` mandan; un hallazgo que contradiga una decisión registrada (D-XXX) se reporta como tal, citándola, no como error.
- **Idioma:** el informe va en español (Colombia), con archivo, línea, severidad y escenario de falla.

# Thermos

Run the two thermo review passes as async background subagents in parallel, then synthesize their results.

## Workflow

1. Determine the review scope from the user request, PR, current branch, or relevant changed files.
2. Gather the diff and any file/context excerpts needed for reviewers to evaluate the change without guessing.
3. Launch both subagents in the same message with `run_in_background: true`:
   - `subagent_type: "thermo-nuclear-review-subagent"` for bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks.
   - `subagent_type: "thermo-nuclear-code-quality-review-subagent"` for maintainability, structure, file-size growth, spaghetti, abstractions, and codebase-health risks.
4. Pass each subagent the same scoped diff/file context and ask it to return prioritized findings with file references and evidence.
5. After both finish, synthesize the results with findings first, deduplicated across reviewers. Weight overlapping findings more heavily, resolve disagreements with your own judgment, and keep summaries brief.

If individual background summaries are already visible to the user, do not restate them wholesale. Surface the unified verdict, the highest-signal findings, and any remaining uncertainty.
