-- Removes table-level privileges that the API roles never need (D-052).
--
-- Supabase grants ALL on public tables to anon and authenticated by default.
-- Besides SELECT/INSERT/UPDATE/DELETE (which RLS filters), ALL includes:
--   TRUNCATE   - empties a table; RLS and row-level triggers do NOT stop it,
--                so the insert-only ledgers (inventory, legal acceptances,
--                delivery proofs, order history) could be wiped;
--   REFERENCES - creating foreign keys that point at the table;
--   TRIGGER    - creating triggers on the table;
--   MAINTAIN   - (PostgreSQL 17) LOCK TABLE, VACUUM, REINDEX, CLUSTER...
-- PostgREST does not expose these today, so this is defense in depth: the
-- grants should match what the roles actually do.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;

-- Tables created later by migrations (run as postgres) get the same rule.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;
