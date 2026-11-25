// Dates and times shown in Colombian time (agents.md §4, D-075). Timestamps
// are stored in UTC and shown in America/Bogota; calendar days (YYYY-MM-DD,
// no time) are shown as they are. Pure: no I/O.

export const BOGOTA_TIME_ZONE = "America/Bogota";

// Intl puts narrow no-break spaces in "10:00 a. m."; plain spaces read the
// same and do not break emails or plain-text logs.
const plainSpaces = (text: string) => text.replace(/[  ]/g, " ");

const MEDIUM = new Intl.DateTimeFormat("es-CO", { timeZone: BOGOTA_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const SHORT_WITH_WEEKDAY = new Intl.DateTimeFormat("es-CO", {
  timeZone: BOGOTA_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const LONG_WITH_WEEKDAY = new Intl.DateTimeFormat("es-CO", {
  timeZone: BOGOTA_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
});
// Calendar days carry no time zone: they are read and shown in UTC so the
// day never moves.
const DAY_SHORT = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const DAY_LONG = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const ISO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: BOGOTA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

type Instant = string | Date;
const toDate = (value: Instant) => (value instanceof Date ? value : new Date(value));

/** "8 nov 2026, 2:49 p. m." */
export function formatBogotaDateTime(value: Instant): string {
  return plainSpaces(MEDIUM.format(toDate(value)));
}

/** "dom, 8 nov, 2:49 p. m." */
export function formatBogotaShortDateTime(value: Instant): string {
  return plainSpaces(SHORT_WITH_WEEKDAY.format(toDate(value)));
}

/** "domingo, 8 de noviembre, 2:49 p. m." */
export function formatBogotaLongDateTime(value: Instant): string {
  return plainSpaces(LONG_WITH_WEEKDAY.format(toDate(value)));
}

/** A calendar day "YYYY-MM-DD": "lun, 9 nov" (short) or "lunes, 9 de noviembre" (long). */
export function formatCalendarDay(isoDate: string, style: "short" | "long" = "long"): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return plainSpaces((style === "short" ? DAY_SHORT : DAY_LONG).format(date));
}

/** Today's date in Colombia as YYYY-MM-DD. */
export function bogotaToday(now: Date = new Date()): string {
  return ISO_DAY.format(now);
}
