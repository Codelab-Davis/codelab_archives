-- Officer addresses must be provisioned by a database administrator, not via the API.
create table public.archive_officers (
  email text primary key check (email = lower(email) and email ~ '^[^@]+@ucdavis\.edu$')
);
alter table public.archive_officers enable row level security;
revoke all on public.archive_officers from anon, authenticated;

create function public.archives_is_officer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    auth.uid() is not null
    and (auth.jwt()->>'email') ~* '^[^@]+@ucdavis\.edu$'
    and auth.jwt()->'app_metadata'->>'provider' = 'google'
    and exists (select 1 from auth.users u
      join auth.identities i on i.user_id = u.id and i.provider = 'google'
      join public.archive_officers o on o.email = lower(u.email)
      where u.id = auth.uid() and u.email_confirmed_at is not null
        and lower(u.email) = lower(auth.jwt()->>'email')
        and lower(i.identity_data->>'email') = lower(u.email)
        and i.identity_data->>'email_verified' = 'true') ,
    false
  );
$$;
revoke all on function public.archives_is_officer() from public;
grant execute on function public.archives_is_officer() to anon, authenticated;

create table public.archive_items (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('event', 'file')),
 slug text not null,
 draft jsonb not null,
 published jsonb,
 status text not null default 'draft' check (status in ('draft','published','archived')),
 version integer not null default 1 check (version > 0),
 updated_at timestamptz not null default now(),
 check ((status = 'published') = (published is not null))
);
create unique index archive_items_published_slug on public.archive_items(kind, (published->>'slug')) where published is not null;
create table public.archive_revisions (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.archive_items(id),
 kind text not null,
 slug text not null,
 draft jsonb not null,
 published jsonb,
 status text not null,
 version integer not null,
 action text not null check (action in ('save','publish','archive','unpublish','restore')),
 actor_email text not null,
 created_at timestamptz not null default now(),
 unique (item_id, version)
);
alter table public.archive_items enable row level security;
alter table public.archive_revisions enable row level security;
revoke all on public.archive_items, public.archive_revisions from anon, authenticated;
grant select on public.archive_items, public.archive_revisions to authenticated;
create policy archive_items_officer_read on public.archive_items for select to authenticated using (public.archives_is_officer());
create policy archive_revisions_officer_read on public.archive_revisions for select to authenticated using (public.archives_is_officer());
-- The view intentionally never exposes the draft, including after edits to a published item.
create view public.archive_published as
 select id, kind, published->>'slug' as slug, published, status, version, updated_at
 from public.archive_items where status = 'published' and published is not null;
grant select on public.archive_published to anon, authenticated;

create function public.archives_validate_content(content jsonb) returns boolean
language sql immutable set search_path = '' as $$
 select coalesce(jsonb_typeof(content) = 'object'
   and content ?& array['title','slug','date','quarter','tags','summary','coverImage','videoUrl','slidesUrl','body','description','type','url']
   and not exists (select 1 from jsonb_object_keys(content) k where k not in ('title','slug','date','quarter','tags','summary','coverImage','videoUrl','slidesUrl','body','description','type','url'))
   and not exists (select 1 from jsonb_each(content) e where e.key <> 'tags' and jsonb_typeof(e.value) <> 'string')
   and jsonb_typeof(content->'tags') = 'array'
   and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(content->'tags') = 'array' then content->'tags' else '[]'::jsonb end) t where jsonb_typeof(t) <> 'string')
   and length(content->>'title') between 1 and 300
   and length(content->>'slug') <= 200
   and (content->>'slug') ~ '^[A-Za-z0-9]+([ -][A-Za-z0-9]+)*$'
   and length(content::text) <= 1048576
 , false);
$$;

create function public.archives_record_revision(item public.archive_items, revision_action text) returns void
language sql security definer set search_path = '' as $$
 insert into public.archive_revisions(item_id,kind,slug,draft,published,status,version,action,actor_email)
 values (item.id,item.kind,item.slug,item.draft,item.published,item.status,item.version,revision_action,lower(auth.jwt()->>'email'));
$$;
revoke all on function public.archives_record_revision(public.archive_items,text) from public, anon, authenticated;

create function public.archives_save(input_id uuid, input_kind text, input_content jsonb, expected_version integer)
returns public.archive_items language plpgsql security definer set search_path = '' as $$
declare item public.archive_items;
begin
 if not public.archives_is_officer() then raise exception 'Forbidden' using errcode = '42501'; end if;
 if input_kind not in ('event','file') or input_kind is null or not public.archives_validate_content(input_content) then raise exception 'Invalid archive content' using errcode = '22023'; end if;
 if input_id is null then
   if expected_version is not null then raise exception 'New items require null expected_version' using errcode = '22023'; end if;
   insert into public.archive_items(kind,slug,draft) values(input_kind,input_content->>'slug',input_content) returning * into item;
 else
   if expected_version is null then raise exception 'expected_version required' using errcode = '22023'; end if;
   select * into item from public.archive_items where id = input_id for update;
   if not found then raise exception 'Archive item not found' using errcode = 'P0002'; end if;
   if item.version <> expected_version then raise exception 'Version conflict' using errcode = '40001'; end if;
   if item.kind <> input_kind then raise exception 'Cannot change kind' using errcode = '22023'; end if;
   update public.archive_items set draft = input_content, slug = input_content->>'slug', version = version + 1, updated_at = clock_timestamp() where id = input_id returning * into item;
 end if;
 perform public.archives_record_revision(item,'save'); return item;
end $$;

create function public.archives_publish(input_id uuid, expected_version integer)
returns public.archive_items language plpgsql security definer set search_path = '' as $$
declare item public.archive_items;
begin
 if not public.archives_is_officer() then raise exception 'Forbidden' using errcode = '42501'; end if;
 if expected_version is null then raise exception 'expected_version required' using errcode = '22023'; end if;
 select * into item from public.archive_items where id = input_id for update;
 if not found then raise exception 'Archive item not found' using errcode = 'P0002'; end if;
 if item.version <> expected_version then raise exception 'Version conflict' using errcode = '40001'; end if;
 update public.archive_items set published = draft, status = 'published', version = version + 1, updated_at = clock_timestamp() where id = input_id returning * into item;
 perform public.archives_record_revision(item,'publish'); return item;
end $$;

create function public.archives_set_status(input_id uuid, input_status text, expected_version integer)
returns public.archive_items language plpgsql security definer set search_path = '' as $$
declare item public.archive_items;
begin
 if not public.archives_is_officer() then raise exception 'Forbidden' using errcode = '42501'; end if;
 if input_status is null or input_status not in ('draft','archived') or expected_version is null then raise exception 'Invalid status or version' using errcode = '22023'; end if;
 select * into item from public.archive_items where id = input_id for update;
 if not found then raise exception 'Archive item not found' using errcode = 'P0002'; end if;
 if item.version <> expected_version then raise exception 'Version conflict' using errcode = '40001'; end if;
 update public.archive_items set status = input_status, published = null, version = version + 1, updated_at = clock_timestamp() where id = input_id returning * into item;
 perform public.archives_record_revision(item,case when input_status = 'archived' then 'archive' else 'unpublish' end); return item;
end $$;

create function public.archives_restore(input_id uuid, revision_id uuid, expected_version integer)
returns public.archive_items language plpgsql security definer set search_path = '' as $$
declare item public.archive_items; rev public.archive_revisions;
begin
 if not public.archives_is_officer() then raise exception 'Forbidden' using errcode = '42501'; end if;
 if expected_version is null then raise exception 'expected_version required' using errcode = '22023'; end if;
 select * into item from public.archive_items where id = input_id for update;
 if not found then raise exception 'Archive item not found' using errcode = 'P0002'; end if;
 if item.version <> expected_version then raise exception 'Version conflict' using errcode = '40001'; end if;
 select * into rev from public.archive_revisions where id = revision_id and item_id = input_id;
 if not found then raise exception 'Revision not found' using errcode = 'P0002'; end if;
 -- Restore the draft only; publishing is always an explicit separate action.
 update public.archive_items set draft = rev.draft, slug = rev.draft->>'slug', version = version + 1, updated_at = clock_timestamp() where id = input_id returning * into item;
 perform public.archives_record_revision(item,'restore'); return item;
end $$;
revoke all on function public.archives_save(uuid,text,jsonb,integer), public.archives_publish(uuid,integer), public.archives_set_status(uuid,text,integer), public.archives_restore(uuid,uuid,integer) from public, anon;
grant execute on function public.archives_save(uuid,text,jsonb,integer), public.archives_publish(uuid,integer), public.archives_set_status(uuid,text,integer), public.archives_restore(uuid,uuid,integer) to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('archive-assets','archive-assets',false,10485760,array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy archive_assets_read on storage.objects for select to authenticated using (bucket_id = 'archive-assets' and public.archives_is_officer());
create policy archive_assets_insert on storage.objects for insert to authenticated with check (bucket_id = 'archive-assets' and public.archives_is_officer());
-- Existing object keys are immutable to officers; replacements must use new keys.
