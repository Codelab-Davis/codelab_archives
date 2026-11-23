-- An outdated editor version is a permanent conflict, so return HTTP 409 through PostgREST
-- instead of a retryable PostgreSQL serialization failure.

create or replace function public.archives_save(input_id uuid, input_kind text, input_content jsonb, expected_version integer)
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
   if item.version <> expected_version then raise exception 'Version conflict' using errcode = 'PT409'; end if;
   if item.kind <> input_kind then raise exception 'Cannot change kind' using errcode = '22023'; end if;
   update public.archive_items set draft = input_content, slug = input_content->>'slug', version = version + 1, updated_at = clock_timestamp() where id = input_id returning * into item;
 end if;
 perform public.archives_record_revision(item,'save'); return item;
end $$;

create or replace function public.archives_publish(input_id uuid, expected_version integer, input_assets text[] default '{}')
returns public.archive_items language plpgsql security definer set search_path = '' as $$
declare item public.archive_items; asset text; canonical text;
begin
  if not public.archives_is_officer() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if expected_version is null then raise exception 'expected_version required' using errcode = '22023'; end if;
  if input_assets is null or cardinality(input_assets) > 200 then raise exception 'Invalid asset manifest' using errcode = '22023'; end if;
  select * into item from public.archive_items where id = input_id for update;
  if not found then raise exception 'Archive item not found' using errcode = 'P0002'; end if;
  if item.version <> expected_version then raise exception 'Version conflict' using errcode = 'PT409'; end if;
  foreach asset in array input_assets loop
    if asset is null or asset !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9._-]+$' then
      raise exception 'Invalid asset path' using errcode = '22023';
    end if;
    -- Upload keys contain exactly one slash and otherwise URI-unreserved characters.
    canonical := '/api/archive/asset?path=' || replace(asset, '/', '%2F');
    if not (item.draft->>'coverImage' = canonical or item.draft->>'url' = canonical
      or item.draft->>'videoUrl' = canonical or item.draft->>'slidesUrl' = canonical
      or position(canonical in item.draft->>'body') > 0) then
      raise exception 'Asset must be referenced in content' using errcode = '22023';
    end if;
    if not exists(select 1 from storage.objects where bucket_id = 'archive-assets' and name = asset) then
      raise exception 'Uploaded asset not found' using errcode = '22023';
    end if;
  end loop;
  delete from public.archive_published_assets where item_id = input_id;
  insert into public.archive_published_assets(item_id,path)
    select input_id, p from (select distinct unnest(input_assets) as p) assets;
  update public.archive_items set published = draft, status = 'published', version = version + 1,
    updated_at = clock_timestamp() where id = input_id returning * into item;
  perform public.archives_record_revision(item,'publish');
  return item;
end $$;

create or replace function public.archives_set_status(input_id uuid, input_status text, expected_version integer)
returns public.archive_items language plpgsql security definer set search_path = '' as $$
declare item public.archive_items;
begin
 if not public.archives_is_officer() then raise exception 'Forbidden' using errcode = '42501'; end if;
 if input_status is null or input_status not in ('draft','archived') or expected_version is null then raise exception 'Invalid status or version' using errcode = '22023'; end if;
 select * into item from public.archive_items where id = input_id for update;
 if not found then raise exception 'Archive item not found' using errcode = 'P0002'; end if;
 if item.version <> expected_version then raise exception 'Version conflict' using errcode = 'PT409'; end if;
 update public.archive_items set status = input_status, published = null, version = version + 1, updated_at = clock_timestamp() where id = input_id returning * into item;
 perform public.archives_record_revision(item,case when input_status = 'archived' then 'archive' else 'unpublish' end); return item;
end $$;

create or replace function public.archives_restore(input_id uuid, revision_id uuid, expected_version integer)
returns public.archive_items language plpgsql security definer set search_path = '' as $$
declare item public.archive_items; rev public.archive_revisions;
begin
 if not public.archives_is_officer() then raise exception 'Forbidden' using errcode = '42501'; end if;
 if expected_version is null then raise exception 'expected_version required' using errcode = '22023'; end if;
 select * into item from public.archive_items where id = input_id for update;
 if not found then raise exception 'Archive item not found' using errcode = 'P0002'; end if;
 if item.version <> expected_version then raise exception 'Version conflict' using errcode = 'PT409'; end if;
 select * into rev from public.archive_revisions where id = revision_id and item_id = input_id;
 if not found then raise exception 'Revision not found' using errcode = 'P0002'; end if;
 -- Restore the draft only; publishing is always an explicit separate action.
 update public.archive_items set draft = rev.draft, slug = rev.draft->>'slug', version = version + 1, updated_at = clock_timestamp() where id = input_id returning * into item;
 perform public.archives_record_revision(item,'restore'); return item;
end $$;
