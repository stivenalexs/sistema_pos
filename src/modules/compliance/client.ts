// Browser-safe API of the compliance module (D-077): pure rules and Client
// Components, nothing that runs only on the server. Client Components of
// other modules import from "@/modules/compliance/client"; server code can keep
// using "@/modules/compliance", which re-exports this file.
export * from "./domain/age";
export * from "./domain/age-gate";
export * from "./domain/sales-block";
export * from "./domain/sales-block-rule";
export { LEGAL_COPY, LEGAL_COPY_IS_PROVISIONAL, LEGAL_COPY_VERSION } from "./legal-copy";
