// Sales blocks by municipality, date and time (D-051). Pure helpers: the
// database decides whether a sale is blocked; this only shapes the notice.

import { formatBogotaLongDateTime } from "@/shared/dates";

export type SalesChannel = "web" | "pos";

export type SalesBlock = {
  blockId: string;
  name: string;
  /** Written by the administrator for customers and cashiers. */
  message: string;
  /** When the current blocked period ends (UTC ISO). */
  endsAt: string;
};

/** Parses the {block_id, name, message, ends_at} object from the database. */
export function parseSalesBlock(raw: unknown): SalesBlock | null {
  const value = raw as { block_id?: unknown; name?: unknown; message?: unknown; ends_at?: unknown } | null;
  if (
    !value ||
    typeof value.block_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.message !== "string" ||
    typeof value.ends_at !== "string" ||
    Number.isNaN(Date.parse(value.ends_at))
  ) {
    return null;
  }
  return { blockId: value.block_id, name: value.name, message: value.message, endsAt: value.ends_at };
}

/** "Podrás comprar de nuevo desde el sábado, 7 de noviembre, 10:00 a. m." */
export function salesBlockUntilText(block: SalesBlock): string {
  const when = formatBogotaLongDateTime(block.endsAt);
  return `Podrás comprar de nuevo desde el ${when} (hora de Colombia).`;
}

export const SALES_BLOCKED_FALLBACK =
  "Las ventas están suspendidas en este momento. Tu carrito queda guardado.";
