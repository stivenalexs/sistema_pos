import { LEGAL_COPY, LEGAL_COPY_IS_PROVISIONAL } from "../legal-copy";

// Permanent legal notice (D-008, Decreto 120 de 2010). Shown on every page and
// in the checkout. The texts come only from legal-copy.ts.
export function PermanentNotice() {
  return (
    <footer className="border-t border-neutral-300 bg-neutral-100 px-4 py-4 text-center text-sm text-neutral-800">
      <p className="font-semibold">{LEGAL_COPY.permanentNotice.minors}</p>
      <p>{LEGAL_COPY.permanentNotice.health}</p>
      {LEGAL_COPY_IS_PROVISIONAL && process.env.NODE_ENV !== "production" ? (
        <p className="mt-2 text-xs text-amber-800">
          Textos legales provisionales: pendientes de aprobación.
        </p>
      ) : null}
    </footer>
  );
}
