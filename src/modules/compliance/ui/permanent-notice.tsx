import { LEGAL_COPY, LEGAL_COPY_IS_PROVISIONAL } from "../legal-copy";

// Permanent legal notice (D-008, Decreto 120 de 2010). Shown on every page and
// in the checkout. The texts come only from legal-copy.ts; this file only
// sets their look (D-046).
export function PermanentNotice() {
  return (
    <footer className="border-t border-line bg-surface px-4 py-5 text-center text-sm text-ink">
      <p className="font-semibold text-gold">{LEGAL_COPY.permanentNotice.minors}</p>
      <p className="mt-1 text-muted">{LEGAL_COPY.permanentNotice.health}</p>
      {LEGAL_COPY_IS_PROVISIONAL && process.env.NODE_ENV !== "production" ? (
        <p className="mt-2 text-xs text-warning">
          Textos legales provisionales: pendientes de aprobación.
        </p>
      ) : null}
    </footer>
  );
}
