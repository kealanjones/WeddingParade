-- Safety net: every balloon is copied into balloons_archive when it is
-- added, changed or deleted, so nothing is lost to a mistaken update or
-- delete. Guests cannot read or change the archive.

create table if not exists public.balloons_archive (
  archive_id bigint generated always as identity primary key,
  archived_at timestamptz not null default now(),
  action text not null,
  balloon jsonb not null
);

alter table public.balloons_archive enable row level security;
revoke all on public.balloons_archive from anon, authenticated;

create or replace function public.archive_balloon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into balloons_archive (action, balloon) values ('delete', to_jsonb(old));
    return old;
  end if;
  insert into balloons_archive (action, balloon) values (lower(tg_op), to_jsonb(new));
  return new;
end;
$$;

revoke all on function public.archive_balloon() from public, anon, authenticated;

drop trigger if exists balloons_archive on public.balloons;
create trigger balloons_archive
  after insert or update or delete on public.balloons
  for each row execute function public.archive_balloon();

-- copy in the balloons that already exist (once)
insert into public.balloons_archive (action, balloon)
select 'backfill', to_jsonb(b) from public.balloons b
where not exists (
  select 1 from public.balloons_archive a where a.balloon->>'id' = b.id::text
);
