-- Minimal Supabase-like roles and tables. This is not a Storage/Auth HTTP emulator.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;
grant usage on schema auth, storage to anon, authenticated;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create table auth.identities (user_id uuid, provider text, identity_data jsonb);
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
