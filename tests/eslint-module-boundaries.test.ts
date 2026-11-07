import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Verifies the agents.md section 3 rule: modules talk to each other only
// through their public index.ts.
const eslint = new ESLint({ cwd: process.cwd() });

async function boundaryErrors(code: string, file: string): Promise<number> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(process.cwd(), file),
  });
  return (result?.messages ?? []).filter(
    (m) => m.ruleId === "no-restricted-imports",
  ).length;
}

const ORDERS_FILE = "src/modules/orders/server/create-order.ts";

describe("module boundaries", () => {
  it("allows importing another module through its public index", async () => {
    expect(
      await boundaryErrors('export * from "@/modules/pricing";\n', ORDERS_FILE),
    ).toBe(0);
  });

  it("allows relative imports inside the same module", async () => {
    expect(
      await boundaryErrors('export * from "../domain/order";\n', ORDERS_FILE),
    ).toBe(0);
  });

  it("blocks alias imports of another module's internals", async () => {
    expect(
      await boundaryErrors(
        'export * from "@/modules/pricing/server/get-price";\n',
        ORDERS_FILE,
      ),
    ).toBe(1);
  });

  it("blocks relative imports of another module's internals", async () => {
    expect(
      await boundaryErrors(
        'export * from "../../pricing/domain/price";\n',
        ORDERS_FILE,
      ),
    ).toBe(1);
  });

  it("blocks reaching into modules from outside src/modules", async () => {
    expect(
      await boundaryErrors(
        'export * from "../modules/pricing/server/get-price";\n',
        "src/app/page.tsx",
      ),
    ).toBe(1);
  });
});
