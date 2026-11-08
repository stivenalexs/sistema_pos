-- Table-level privileges of the API roles (D-052). Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

create function pg_temp.tables_with(p_role text, p_privilege text) returns text language sql as $$
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and has_table_privilege(p_role, c.oid, p_privilege);
$$;

select is(pg_temp.tables_with('authenticated', 'TRUNCATE') || pg_temp.tables_with('anon', 'TRUNCATE'), '',
  'grants: no API role can TRUNCATE a public table');
select is(pg_temp.tables_with('authenticated', 'TRIGGER') || pg_temp.tables_with('anon', 'TRIGGER'), '',
  'grants: no API role can create triggers');
select is(pg_temp.tables_with('authenticated', 'REFERENCES') || pg_temp.tables_with('anon', 'REFERENCES'), '',
  'grants: no API role can reference tables');
select is(pg_temp.tables_with('authenticated', 'MAINTAIN') || pg_temp.tables_with('anon', 'MAINTAIN'), '',
  'grants: no API role can lock or maintain tables');

-- A table created later by a migration gets the same rule.
create table public.zz_grants_probe (id int);
select ok(
  not has_table_privilege('authenticated', 'public.zz_grants_probe', 'TRUNCATE')
  and has_table_privilege('authenticated', 'public.zz_grants_probe', 'SELECT'),
  'grants: new tables keep SELECT for RLS but no TRUNCATE'
);

select * from finish();
rollback;
