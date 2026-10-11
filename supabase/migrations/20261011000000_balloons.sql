-- Sop and Bop's Wedding Balloon Parade: table, security rules and storage.

create table if not exists public.balloons (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  note text check (note is null or char_length(note) <= 280),
  image_path text not null check (image_path ~ '^[0-9a-f-]{36}\.png$'),
  source text not null check (source in ('photo', 'drawn')),
  approved boolean not null default false
);

alter table public.balloons enable row level security;

-- Guests can add balloons and read approved ones, nothing else.
revoke all on public.balloons from anon, authenticated;
grant select on public.balloons to anon, authenticated;
grant insert (id, name, note, image_path, source) on public.balloons to anon, authenticated;

drop policy if exists "guests add unapproved balloons" on public.balloons;
create policy "guests add unapproved balloons"
  on public.balloons for insert
  to anon, authenticated
  with check (approved = false);

drop policy if exists "everyone sees approved balloons" on public.balloons;
create policy "everyone sees approved balloons"
  on public.balloons for select
  to anon, authenticated
  using (approved = true);

-- Total submitted (approved or not), for the waiting screen.
create or replace function public.balloon_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.balloons;
$$;

revoke all on function public.balloon_count() from public;
grant execute on function public.balloon_count() to anon, authenticated;

-- Public bucket for the cut-out PNGs (max 3 MB each).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('balloons', 'balloons', true, 3145728, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Guests may upload new PNGs (no listing, overwriting or deleting).
drop policy if exists "guests upload balloon pngs" on storage.objects;
create policy "guests upload balloon pngs"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'balloons'
    and name ~ '^[0-9a-f-]{36}\.png$'
  );
