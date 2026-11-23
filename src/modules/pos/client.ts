// Browser-safe API of the pos module (D-077): pure rules and Client
// Components, nothing that runs only on the server. Client Components of
// other modules import from "@/modules/pos/client"; server code can keep
// using "@/modules/pos", which re-exports this file.
export * from "./domain/pos";
export { PosTerminal } from "./ui/pos-terminal";
