-- Uses identities established by security.sql; runs against disposable stubs only.
set role authenticated;
create temp table asset_fixture (id uuid, version integer);
insert into storage.objects(bucket_id,name) values
('archive-assets','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo.png'),
('archive-assets','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/draft.png');
insert into asset_fixture select id,version from public.archives_save(null,'event',
'{"title":"Asset test","slug":"asset-test","date":"2026-11-15","quarter":"Fall 2026","tags":[],"summary":"","coverImage":"/api/archive/asset?path=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa%2Fphoto.png","videoUrl":"","slidesUrl":"","body":"","description":"","type":"","url":""}',null);
reset role;
set role anon;
select public.test_assert(not public.archives_asset_is_published('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo.png'), 'draft asset is private');
select public.test_assert((select count(*)=0 from storage.objects), 'no draft storage objects for anon');
reset role;
set role authenticated;
do $$ begin
 perform public.archives_publish((select id from asset_fixture),1,array['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/draft.png']);
 raise exception 'unreferenced asset published';
exception when invalid_parameter_value then null; end $$;
select public.archives_publish(id,version,array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo.png']) from asset_fixture;
reset role;
set role anon;
select public.test_assert(public.archives_asset_is_published('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo.png'), 'published asset allowed');
select public.test_assert((select count(*)=1 from storage.objects), 'only published storage object visible');
select public.test_assert(not public.archives_asset_is_published('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/draft.png'), 'unreferenced upload private');
do $$ begin perform * from public.archive_published_assets; raise exception 'manifest exposed'; exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
select public.archives_set_status(id,'draft',2) from asset_fixture;
reset role;
set role anon;
select public.test_assert((select count(*)=0 from storage.objects), 'unpublished storage object private again');
reset role;
select 'published asset security tests passed' as result;
