// Browser-safe API of the pricing module (D-077): pure rules and Client
// Components, nothing that runs only on the server. Client Components of
// other modules import from "@/modules/pricing/client"; server code can keep
// using "@/modules/pricing", which re-exports this file.
export * from "./domain/pricing";
