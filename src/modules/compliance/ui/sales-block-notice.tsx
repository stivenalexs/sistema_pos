import { type SalesBlock, salesBlockUntilText } from "../domain/sales-block";

// Notice shown while sales are blocked (D-051). No animation (agents.md §8).
export function SalesBlockNotice({ block }: { block: SalesBlock }) {
  return (
    <div role="status" className="notice notice-warning flex flex-col gap-1">
      <p className="font-medium">{block.message}</p>
      <p className="text-sm">{salesBlockUntilText(block)} Tu carrito queda guardado.</p>
    </div>
  );
}
