begin;

-- Files are served through the Edge Function. Direct Storage reads can outlive RLS
-- changes in the Storage CDN, so never grant the public caller object access.
drop policy archive_assets_published_read on storage.objects;

create function public.archives_asset_publications(asset_path text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(i.published), '[]'::jsonb)
  from public.archive_published_assets a
  join public.archive_items i on i.id = a.item_id
  where a.path = asset_path and i.status = 'published' and i.published is not null;
$$;
revoke all on function public.archives_asset_publications(text) from public, anon, authenticated;
grant execute on function public.archives_asset_publications(text) to service_role;

commit;
