// Colombian cédula as typed by a person (D-045, D-067). Pure, used by the
// browser for early feedback and by the server; the database checks again.

/** Digits of a cédula as typed (dots, spaces, dashes allowed), or null if not 5 to 12 digits. */
export function normalizeIdDocument(value: string): string | null {
  const digits = value.replace(/[.\s-]/g, "");
  return /^[0-9]{5,12}$/.test(digits) ? digits : null;
}
