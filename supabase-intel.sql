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

create table if not exists public.b24_claims (
  map_id text not null,
  claim_id text not null,
  target_coord text not null,
  region_id text not null,
  system_id text not null,
  claimed_by text,
  arrival_at timestamptz,
  arrival_label text,
  confirmed_sent boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by text,
  fleet_label text,
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, claim_id)
);

alter table public.b24_claims
add column if not exists confirmed_sent boolean not null default false,
add column if not exists confirmed_at timestamptz,
add column if not exists confirmed_by text,
add column if not exists fleet_label text;

create table if not exists public.b24_incoming (
  map_id text not null,
  incoming_id text not null,
  attacker_coord text not null,
  region_id text not null,
  system_id text not null,
  eta_minutes integer,
  arrival_at timestamptz not null,
  reported_by text,
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, incoming_id)
);

create table if not exists public.b24_user_bases (
  map_id text not null,
  user_id text not null,
  base_coord text not null,
  region_id text not null,
  system_id text,
  owner_label text,
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, user_id, base_coord)
);

create table if not exists public.b24_user_settings (
  user_id text primary key,
  galaxy text not null default 'B24',
  map_id text not null default 'b24-main',
  updated_at timestamptz not null default now()
);

create table if not exists public.b24_chat_settings (
  chat_id text primary key,
  galaxy text not null default 'B24',
  map_id text not null default 'b24-main',
  updated_at timestamptz not null default now()
);

alter table public.b24_systems enable row level security;
alter table public.b24_astros enable row level security;
alter table public.b24_bases enable row level security;
alter table public.b24_claims enable row level security;
alter table public.b24_incoming enable row level security;
alter table public.b24_user_bases enable row level security;
alter table public.b24_user_settings enable row level security;
alter table public.b24_chat_settings enable row level security;

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

drop policy if exists "Anyone can read B24 claims" on public.b24_claims;
create policy "Anyone can read B24 claims"
on public.b24_claims
for select
using (true);

drop policy if exists "Anyone can write B24 claims" on public.b24_claims;
create policy "Anyone can write B24 claims"
on public.b24_claims
for insert
with check (true);

drop policy if exists "Anyone can update B24 claims" on public.b24_claims;
create policy "Anyone can update B24 claims"
on public.b24_claims
for update
using (true)
with check (true);

drop policy if exists "Anyone can read B24 incoming" on public.b24_incoming;
create policy "Anyone can read B24 incoming"
on public.b24_incoming
for select
using (true);

drop policy if exists "Anyone can write B24 incoming" on public.b24_incoming;
create policy "Anyone can write B24 incoming"
on public.b24_incoming
for insert
with check (true);

drop policy if exists "Anyone can update B24 incoming" on public.b24_incoming;
create policy "Anyone can update B24 incoming"
on public.b24_incoming
for update
using (true)
with check (true);

drop policy if exists "Anyone can read B24 user bases" on public.b24_user_bases;
create policy "Anyone can read B24 user bases"
on public.b24_user_bases
for select
using (true);

drop policy if exists "Anyone can write B24 user bases" on public.b24_user_bases;
create policy "Anyone can write B24 user bases"
on public.b24_user_bases
for insert
with check (true);

drop policy if exists "Anyone can update B24 user bases" on public.b24_user_bases;
create policy "Anyone can update B24 user bases"
on public.b24_user_bases
for update
using (true)
with check (true);

drop policy if exists "Anyone can read B24 user settings" on public.b24_user_settings;
create policy "Anyone can read B24 user settings"
on public.b24_user_settings
for select
using (true);

drop policy if exists "Anyone can write B24 user settings" on public.b24_user_settings;
create policy "Anyone can write B24 user settings"
on public.b24_user_settings
for insert
with check (true);

drop policy if exists "Anyone can update B24 user settings" on public.b24_user_settings;
create policy "Anyone can update B24 user settings"
on public.b24_user_settings
for update
using (true)
with check (true);

drop policy if exists "Anyone can read B24 chat settings" on public.b24_chat_settings;
create policy "Anyone can read B24 chat settings"
on public.b24_chat_settings
for select
using (true);

drop policy if exists "Anyone can write B24 chat settings" on public.b24_chat_settings;
create policy "Anyone can write B24 chat settings"
on public.b24_chat_settings
for insert
with check (true);

drop policy if exists "Anyone can update B24 chat settings" on public.b24_chat_settings;
create policy "Anyone can update B24 chat settings"
on public.b24_chat_settings
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

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_claims'
  ) then
    alter publication supabase_realtime add table public.b24_claims;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_incoming'
  ) then
    alter publication supabase_realtime add table public.b24_incoming;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_user_bases'
  ) then
    alter publication supabase_realtime add table public.b24_user_bases;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_user_settings'
  ) then
    alter publication supabase_realtime add table public.b24_user_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_chat_settings'
  ) then
    alter publication supabase_realtime add table public.b24_chat_settings;
  end if;
end $$;
