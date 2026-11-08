// Sales block rules typed by the administrator (D-051, D-060). Pure: no I/O.
// Dates and times are always written in Colombia time. Bogotá has no
// daylight saving time, so its offset is a fixed -05:00.

import type { SalesChannel } from "./sales-block";

export const BOGOTA_OFFSET = "-05:00";

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

export const CHANNEL_LABELS: Record<SalesChannel, string> = { web: "Tienda web", pos: "POS (caja)" };

/** "2026-11-14T18:00" in Colombia time → ISO instant, or null. */
export function bogotaLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${BOGOTA_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO instant → "2026-11-14T18:00" in Colombia time (for datetime-local inputs). */
export function isoToBogotaLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export type SalesBlockRuleInput = {
  name: string;
  kind: "date_range" | "weekly";
  zoneId: string | null;
  channels: SalesChannel[];
  startsAt: string | null;
  endsAt: string | null;
  weekdays: number[] | null;
  startTime: string | null;
  endTime: string | null;
  message: string;
};

export type RawRuleInput = {
  name: string;
  kind: string;
  zoneId: string;
  channels: string[];
  startsAt: string;
  endsAt: string;
  weekdays: string[];
  startTime: string;
  endTime: string;
  message: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseSalesBlockRule(
  raw: RawRuleInput,
): { ok: true; value: SalesBlockRuleInput } | { ok: false; message: string } {
  const name = raw.name.trim();
  if (name.length < 3 || name.length > 80) return { ok: false, message: "Escribe un nombre entre 3 y 80 caracteres." };
  const message = raw.message.trim();
  if (message.length < 3 || message.length > 300) {
    return { ok: false, message: "Escribe el mensaje para el cliente y el cajero (entre 3 y 300 caracteres)." };
  }
  if (raw.zoneId !== "all" && !UUID.test(raw.zoneId)) return { ok: false, message: "Elige el municipio." };
  const channels = [...new Set(raw.channels)].filter((c): c is SalesChannel => c === "web" || c === "pos");
  if (channels.length === 0 || channels.length !== raw.channels.length) {
    return { ok: false, message: "Elige al menos un canal: tienda web o POS." };
  }
  if (raw.kind !== "date_range" && raw.kind !== "weekly") return { ok: false, message: "Tipo de regla no válido." };

  const startsAt = raw.startsAt ? bogotaLocalToIso(raw.startsAt) : null;
  const endsAt = raw.endsAt ? bogotaLocalToIso(raw.endsAt) : null;
  if ((raw.startsAt && !startsAt) || (raw.endsAt && !endsAt)) return { ok: false, message: "Revisa las fechas." };
  if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, message: "El fin debe ser después del inicio." };

  const base = { name, message, zoneId: raw.zoneId === "all" ? null : raw.zoneId, channels };
  if (raw.kind === "date_range") {
    if (!startsAt || !endsAt) return { ok: false, message: "Un rango de fechas necesita inicio y fin." };
    return {
      ok: true,
      value: { ...base, kind: "date_range", startsAt, endsAt, weekdays: null, startTime: null, endTime: null },
    };
  }

  const weekdays = [...new Set(raw.weekdays.map(Number))].sort();
  if (weekdays.length === 0 || weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return { ok: false, message: "Elige al menos un día de la semana." };
  }
  if (!TIME.test(raw.startTime) || !TIME.test(raw.endTime)) return { ok: false, message: "Escribe la hora de inicio y de fin." };
  if (raw.startTime === raw.endTime) return { ok: false, message: "La hora de inicio y la de fin no pueden ser iguales." };
  return {
    ok: true,
    value: { ...base, kind: "weekly", startsAt, endsAt, weekdays, startTime: raw.startTime, endTime: raw.endTime },
  };
}
