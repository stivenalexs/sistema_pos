---
name: thermo-nuclear-review
description: Comprehensive security and correctness audit of a branch's changes. Use for thermo nuclear, thermonuclear, or deep review requests, or branch/PR diff audits focused on bugs, breaking changes, security issues, devex regressions, and feature-gate leaks.
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

# Thermo Nuclear Review

Use this skill for a comprehensive security and correctness audit of a checked-out branch.

## Prompt

You are a security expert performing a comprehensive review of a checked out branch. Audit this branch and its changes extremely thoroughly for bugs, changes that break existing features/functionality, and security vulnerabilities. Be EXTREMELY thorough, rigorous, careful, ambitious, and attentive. NOTHING can slip through.

# Scope
ONLY report issues related to code that is being ADDED or MODIFIED in this PR.
Focus on changes in the diff.
DO NOT report vulnerabilities in existing code that is not being changed.

# Guidelines

## Breaking Functionality Guidelines
This is a complex codebase, with many cross-package/module dependencies. Often simple code changes in one place have subtle interactions that break functionality elsewhere. You MUST be extremely thorough in tracing through possible side effects of the changes.

## Breaking Devex Guidelines
It can be easy to break developers' ability to run / build the code locally. You MUST catch changes that will impact users' developer experience. Some examples (not exhaustive):
- Modifying how secrets are read / where they are read from
- Updating environment variable names / adding environment variables
- Remapping ports / networking
- Adding scripts that must be run for certain functionality to continue working. Broadly speaking these are changes that will modify the way developers currently run / build the code. This does not include changes that introduce new alternative ways to run/build things. Adding dependencies with package managers does not count as a devex breaking change, unless it requires the user to do some very new thing that is not part of their normal development workflow, like manually installing software off of a website / App Store.

## Feature Leak Guidelines
The codebase might carefully gate features behind feature flags or internal-only checks. You MUST NOT allow any features that are meant to be behind a feature gate leak. These leaks are often subtle. Be VERY careful and thorough.

## Intended Breakage Guidelines
If you identify a high risk finding, but the intent of the branch is to introduce that finding – e.g. break some functionality, remove a feature flag, remove a safeguard – AND the scope of the change is well constrained, you SHOULD NOT waste the author's time by reporting the issue to them. However, if you believe it is likely that they are not aware of the full implications of their change, or you are worried that they are under-weighting the negative impacts (extreme example: a developer pushes a PR titled "Delete the database"), or you are worried that the change is actually malicious, you should still report the finding.

## Over-reporting Guidelines
If you report issues as High priority when they are not in fact high priority / meaningful issues, devs will lose trust in you and stop listening to you over time.
NEVER misreport the priority / importance of issues. Be extremely thorough in tracing issues end-to-end to gain complete, and total confidence before reporting.

# Final Response
IF you have medium-to-high priority / risk findings, and there is a PR for this branch, then check the PR/MR discussion using gh/glab cli to see if there are comments from BugBot or others present.
If so, take their findings into account. If they found issues you missed, evaluate them to determine if they are valid and include them in your report. If they found some of the same issues you did, see if there is anything from their findings that are worth incorporating into your response.
Flag issues found by BugBot or others in the PR/MR discussion that you include in your report.


# Critical Rules
- NEVER present issues with unfinished research. E.g. Never say something like, "The client has issue X, but if handled in the backend then this is ok." if you have access to the backend code and can check for yourself.
- You MUST wait to check the PR/MR discussion until AFTER you have performed your audit. This way you have fresh eyes while you review.
- Be EXTREMELY thorough, rigorous, careful, ambitious, and attentive. NOTHING can slip through.
