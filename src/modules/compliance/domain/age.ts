// Age rules (D-022, D-035). Pure functions, no I/O.
// The database applies the same rule as the final guarantee
// (private.validate_customer_signup).

import { BOGOTA_TIME_ZONE, bogotaToday } from "@/shared/dates";

export const LEGAL_AGE = 18;
export const COLOMBIA_TIME_ZONE = BOGOTA_TIME_ZONE;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date in Colombia as YYYY-MM-DD. */
export function todayInColombia(now: Date = new Date()): string {
  return bogotaToday(now);
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Latest birth date that is of age on `today`: today minus 18 years.
 * A 29 February that does not exist becomes 28 February, as in Postgres.
 */
export function latestAdultBirthDate(today: string): string {
  const match = ISO_DATE.exec(today);
  if (!match) throw new Error(`Invalid date: ${today}`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const year = y - LEGAL_AGE;
  const day = Math.min(d, daysInMonth(year, m));
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** True when a person born on `birthDate` is 18 or older on `today`. */
export function isOfLegalAge(birthDate: string, today: string): boolean {
  if (!isValidIsoDate(birthDate) || !isValidIsoDate(today)) return false;
  return birthDate <= latestAdultBirthDate(today);
}
