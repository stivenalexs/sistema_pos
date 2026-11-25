// Restores a backup made by `npm run db:backup` into the LOCAL database only
// (D-078). It never takes a URL or a project: it runs inside the local
// Docker container of this project, so it cannot touch a hosted database.
//
// Steps: rebuild the schema from the migrations without the seed
// (`supabase db reset --no-seed`); then, in ONE transaction, empty every
// table the backup has data for (the migrations already insert reference
// rows: zones, fee rules, the own courier provider, settings...) and load
// data.sql. The dump starts with `SET session_replication_role = replica`,
// so triggers do not run again: stock balances, history and audit rows come
// back exactly as they were. If anything fails, nothing is loaded.
// Everything written after the backup is lost: that is the point.
//
// Usage: npm run db:restore -- backups/<date-time>

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const CONTAINER = "supabase_db_sistema_pos";

const dir = process.argv[2];
if (!dir || !existsSync(path.join(dir, "data.sql")) || !existsSync(path.join(dir, "meta.json"))) {
  console.error("Usage: npm run db:restore -- backups/<date-time> (a folder made by npm run db:backup)");
  process.exit(1);
}
const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8"));

// The backup's data only fits the schema it came from.
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
if (migrations.at(-1) !== meta.lastMigration) {
  console.error(
    `The backup was made with migration ${meta.lastMigration}, the code now ends at ${migrations.at(-1)}. ` +
      "Check out the backup's commit (" + meta.commit + ") before restoring.",
  );
  process.exit(1);
}

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...options });

console.log(`Restoring ${dir} (commit ${meta.commit.slice(0, 7)}, ${meta.createdAt}) into the LOCAL database.`);
run("npx", ["supabase", "db", "reset", "--local", "--no-seed"]);

// Every table the backup has data for, as pg_dump names them ("schema"."table").
const data = readFileSync(path.join(dir, "data.sql"), "utf8");
const tables = [...new Set([...data.matchAll(/^COPY ("[^"]+"\."[^"]+") /gm)].map((m) => m[1]))];
const prelude = path.join(dir, "restore-prelude.sql");
writeFileSync(prelude, `TRUNCATE TABLE ${tables.join(", ")} CASCADE;
`);

// Copy both files into the container and load them in a single transaction,
// stopping at the first error (a half-loaded database is worse than a failed
// restore).
const env = { ...process.env, MSYS_NO_PATHCONV: "1" };
run("docker", ["cp", path.resolve(prelude), `${CONTAINER}:/tmp/restore-prelude.sql`], { env });
run("docker", ["cp", path.resolve(dir, "data.sql"), `${CONTAINER}:/tmp/restore-data.sql`], { env });
run(
  "docker",
  [
    "exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q",
    "--single-transaction", "-f", "/tmp/restore-prelude.sql", "-f", "/tmp/restore-data.sql",
  ],
  { env },
);
run("docker", ["exec", CONTAINER, "rm", "-f", "/tmp/restore-prelude.sql", "/tmp/restore-data.sql"], { env });

console.log("Restored. Vault secrets are not in the backup: set the worker URLs again if needed (D-034).");
