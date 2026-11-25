// Backs up the LOCAL database (D-078): roles, schema and data of public,
// private, auth and the queue, plus which commit and migration it belongs
// to. Writes backups/<UTC date-time>/, which git ignores: a backup holds
// personal data and the pickup HMAC key (private.pickup_secrets), so it is
// handled like a secret. Needs Docker and `npm run db:start`.
//
// It is the rehearsal of the production backup in docs/plan-reversa.md;
// it never connects to a hosted project.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCHEMAS = "public,private,auth,pgmq";

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const dir = path.join("backups", stamp);
mkdirSync(dir, { recursive: true });

function dump(args, file) {
  execFileSync("npx", ["supabase", "db", "dump", "--local", ...args, "-f", path.join(dir, file)], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
}

dump(["--role-only"], "roles.sql");
dump([], "schema.sql");
dump(["--data-only", "--use-copy", "--schema", SCHEMAS], "data.sql");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
writeFileSync(
  path.join(dir, "meta.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      commit: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      lastMigration: migrations.at(-1) ?? null,
      schemas: SCHEMAS.split(","),
      note: "Local backup. Restore with: npm run db:restore -- " + dir.replaceAll("\\", "/"),
    },
    null,
    2,
  ) + "\n",
);

console.log(`Backup written to ${dir} (roles.sql, schema.sql, data.sql, meta.json).`);
