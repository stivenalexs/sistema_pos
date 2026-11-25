// Browser-safe API of the inventory module (D-077): pure rules and Client
// Components, nothing that runs only on the server. Client Components of
// other modules import from "@/modules/inventory/client"; server code can keep
// using "@/modules/inventory", which re-exports this file.
export * from "./domain/inventory";
