// Reads a form value as trimmed text (FormData values are unknown). Internal
// to the delivery module.

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
