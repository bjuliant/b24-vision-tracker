create table if not exists public.b24_sectors (
  map_id text not null,
  sector_id text not null,
  status text not null check (status in ('unknown', 'scout', 'base', 'enemy', 'reserved')),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (map_id, sector_id)
);

alter table public.b24_sectors enable row level security;

create policy "Anyone can read B24 sectors"
on public.b24_sectors
for select
using (true);

create policy "Anyone can update B24 sectors"
on public.b24_sectors
for insert
with check (true);

create policy "Anyone can modify B24 sectors"
on public.b24_sectors
for update
using (true)
with check (true);

alter publication supabase_realtime add table public.b24_sectors;
