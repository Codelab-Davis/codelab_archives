-- Asset publication is explicit and atomic with the published content snapshot.
-- The web editor derives this manifest from actual Markdown links/images and URL fields.
create table public.archive_published_assets (
  item_id uuid not null references public.archive_items(id),
  path text not null check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9._-]+$'),
  primary key (item_id, path)
);
alter table public.archive_published_assets enable row level security;
revoke all on public.archive_published_assets from public, anon, authenticated;

create function public.archives_asset_is_published(asset_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.archive_published_assets a
    join public.archive_items i on i.id = a.item_id
    where a.path = asset_path and i.status = 'published' and i.published is not null
  );
$$;
revoke all on function public.archives_asset_is_published(text) from public;
grant execute on function public.archives_asset_is_published(text) to anon, authenticated;
create policy archive_assets_published_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'archive-assets' and public.archives_asset_is_published(name));

drop function public.archives_publish(uuid, integer);
create function public.archives_publish(input_id uuid, expected_version integer, input_assets text[] default '{}')
returns public.archive_items language plpgsql security definer set search_path = '' as $$
declare item public.archive_items; asset text; canonical text;
begin
  if not public.archives_is_officer() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if expected_version is null then raise exception 'expected_version required' using errcode = '22023'; end if;
  if input_assets is null or cardinality(input_assets) > 200 then raise exception 'Invalid asset manifest' using errcode = '22023'; end if;
  select * into item from public.archive_items where id = input_id for update;
  if not found then raise exception 'Archive item not found' using errcode = 'P0002'; end if;
  if item.version <> expected_version then raise exception 'Version conflict' using errcode = '40001'; end if;
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
revoke all on function public.archives_publish(uuid,integer,text[]) from public, anon;
grant execute on function public.archives_publish(uuid,integer,text[]) to authenticated;
