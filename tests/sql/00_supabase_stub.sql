-- Stub mínimo do ambiente Supabase para testes locais (não é usado em produção).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
grant all on schema public to service_role;
