-- Run explicitly as a database administrator after reviewing the migration.
insert into public.archive_officers (email) values ('gsggill@ucdavis.edu')
on conflict (email) do nothing;
