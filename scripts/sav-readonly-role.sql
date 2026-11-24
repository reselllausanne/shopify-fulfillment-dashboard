-- Read-only Postgres role for the SAV agent. Run once as owner (Supabase SQL editor). Set a real password.
-- Never grant on health_*, StockXToken, PartnerUser.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sav_readonly') then
    create role sav_readonly login password 'CHANGE_ME' nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;
alter role sav_readonly set default_transaction_read_only = on;
alter role sav_readonly set statement_timeout = '20s';
grant usage on schema public to sav_readonly;
grant select on all tables in schema public to sav_readonly;
revoke all on table public."StockXToken", public."PartnerUser" from sav_readonly;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename ilike 'health\_%' loop
    execute format('revoke all on table public.%I from sav_readonly', t);
  end loop;
end $$;
