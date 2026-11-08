// Public API of the compliance module. Other modules import only from here (agents.md, section 3).
export * from "./domain/age";
export * from "./domain/age-gate";
export * from "./domain/sales-block";
export { LEGAL_COPY, LEGAL_COPY_IS_PROVISIONAL, LEGAL_COPY_VERSION } from "./legal-copy";
export { confirmAgeAction } from "./server/age-gate-actions";
export { getSalesBlock } from "./server/sales-blocks";
export { PermanentNotice } from "./ui/permanent-notice";
export { SalesBlockNotice } from "./ui/sales-block-notice";
