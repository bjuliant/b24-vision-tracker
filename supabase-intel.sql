alter table public.b24_sectors
add column if not exists has_friendly boolean not null default false,
add column if not exists has_enemy boolean not null default false,
add column if not exists has_scout boolean not null default false,
add column if not exists has_reserved boolean not null default false;

update public.b24_sectors
set
  has_friendly = has_friendly or status = 'base',
  has_enemy = has_enemy or status = 'enemy',
  has_scout = has_scout or status = 'scout',
  has_reserved = has_reserved or status = 'reserved'
where map_id = 'b24-main';

create table if not exists public.b24_systems (
  map_id text not null,
  region_id text not null,
  system_id text not null,
  coord text not null,
  updated_at timestamptz not null default now(),
  primary key (map_id, coord)
);

create table if not exists public.b24_astros (
  map_id text not null,
  coord text not null,
  region_id text not null,
  system_id text not null,
  astro_no text not null,
  terrain text,
  astro_type text,
  attributes jsonb not null default '[]'::jsonb,
  has_base boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (map_id, coord)
);

create table if not exists public.b24_bases (
  map_id text not null,
  coord text not null,
  region_id text not null,
  system_id text not null,
  guild text,
  label text,
  updated_at timestamptz not null default now(),
  primary key (map_id, coord)
);

alter table public.b24_systems enable row level security;
alter table public.b24_astros enable row level security;
alter table public.b24_bases enable row level security;

drop policy if exists "Anyone can read B24 systems" on public.b24_systems;
create policy "Anyone can read B24 systems"
on public.b24_systems
for select
using (true);

drop policy if exists "Anyone can write B24 systems" on public.b24_systems;
create policy "Anyone can write B24 systems"
on public.b24_systems
for insert
with check (true);

drop policy if exists "Anyone can update B24 systems" on public.b24_systems;
create policy "Anyone can update B24 systems"
on public.b24_systems
for update
using (true)
with check (true);

drop policy if exists "Anyone can read B24 astros" on public.b24_astros;
create policy "Anyone can read B24 astros"
on public.b24_astros
for select
using (true);

drop policy if exists "Anyone can write B24 astros" on public.b24_astros;
create policy "Anyone can write B24 astros"
on public.b24_astros
for insert
with check (true);

drop policy if exists "Anyone can update B24 astros" on public.b24_astros;
create policy "Anyone can update B24 astros"
on public.b24_astros
for update
using (true)
with check (true);

drop policy if exists "Anyone can read B24 bases" on public.b24_bases;
create policy "Anyone can read B24 bases"
on public.b24_bases
for select
using (true);

drop policy if exists "Anyone can write B24 bases" on public.b24_bases;
create policy "Anyone can write B24 bases"
on public.b24_bases
for insert
with check (true);

drop policy if exists "Anyone can update B24 bases" on public.b24_bases;
create policy "Anyone can update B24 bases"
on public.b24_bases
for update
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_systems'
  ) then
    alter publication supabase_realtime add table public.b24_systems;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_astros'
  ) then
    alter publication supabase_realtime add table public.b24_astros;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_bases'
  ) then
    alter publication supabase_realtime add table public.b24_bases;
  end if;
end $$;
