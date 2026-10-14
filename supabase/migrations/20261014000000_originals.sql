-- Guests' original photos (before the cut-out), kept privately as a backup.
-- Guests can only add new files here: no reading, listing, overwriting or
-- deleting. You can see them in the dashboard under Storage -> originals.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('originals', 'originals', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "guests upload original photos" on storage.objects;
create policy "guests upload original photos"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'originals'
    and name ~ '^[0-9a-f-]{36}\.jpg$'
  );
