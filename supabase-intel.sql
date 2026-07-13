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

create table if not exists public.b24_stances (
  map_id text not null,
  scope_type text not null check (scope_type in ('coord', 'tag')),
  scope_value text not null,
  stance text not null check (stance in ('friend', 'enemy')),
  updated_by text,
  updated_by_user_id text,
  updated_at timestamptz not null default now(),
  primary key (map_id, scope_type, scope_value)
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
add column if not exists fleet_label text,
add column if not exists claimed_by_user_id text,
add column if not exists chat_id text;

create table if not exists public.b24_incoming (
  map_id text not null,
  incoming_id text not null,
  defended_coord text,
  defended_region_id text,
  defended_system_id text,
  attacker_coord text,
  region_id text,
  system_id text,
  eta_minutes integer,
  arrival_at timestamptz not null,
  reported_by text,
  hostile_fleet text,
  severity text,
  verified boolean not null default false,
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, incoming_id)
);

alter table public.b24_incoming
add column if not exists defended_coord text,
add column if not exists defended_region_id text,
add column if not exists defended_system_id text,
add column if not exists hostile_fleet text,
add column if not exists severity text,
add column if not exists verified boolean not null default false,
add column if not exists reported_by_user_id text,
add column if not exists chat_id text,
add column if not exists covered_by text,
add column if not exists covered_by_user_id text,
add column if not exists covered_at timestamptz;

alter table public.b24_incoming
alter column attacker_coord drop not null,
alter column region_id drop not null,
alter column system_id drop not null;

create table if not exists public.b24_operations (
  map_id text not null,
  operation_id text not null,
  short_id text not null,
  chat_id text,
  type text not null,
  target_coord text,
  defended_coord text,
  hostile_origin text,
  arrival_at timestamptz,
  commander_user_id text,
  commander_label text,
  message_chat_id text,
  message_id text,
  status text not null default 'active',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, operation_id),
  unique (map_id, short_id)
);

create table if not exists public.b24_operation_members (
  map_id text not null,
  operation_id text not null,
  user_id text not null,
  display_name text,
  role text,
  fleet_label text,
  fleet_value text,
  travel_minutes integer,
  launch_at timestamptz,
  state text not null default 'joined',
  sent_at timestamptz,
  arrived_at timestamptz,
  withdrawn_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, operation_id, user_id)
);

create table if not exists public.b24_scheduled_notifications (
  map_id text not null,
  notification_id text not null,
  operation_id text,
  user_id text,
  chat_id text,
  notification_type text not null,
  send_at timestamptz not null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, notification_id)
);

alter table public.b24_scheduled_notifications
add column if not exists cancelled_at timestamptz;

alter table public.b24_operation_members
add column if not exists withdrawn_at timestamptz;

alter table public.b24_operations
add column if not exists message_chat_id text,
add column if not exists message_id text;

alter table public.b24_claims
add column if not exists operation_id text,
add column if not exists operation_short_id text;

alter table public.b24_incoming
add column if not exists operation_id text,
add column if not exists operation_short_id text;

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
  active_chat_id text,
  active_chat_label text,
  updated_at timestamptz not null default now()
);

alter table public.b24_user_settings
add column if not exists active_chat_id text,
add column if not exists active_chat_label text;

create table if not exists public.b24_chat_settings (
  chat_id text primary key,
  galaxy text not null default 'B24',
  map_id text not null default 'b24-main',
  updated_at timestamptz not null default now()
);

alter table public.b24_systems enable row level security;
alter table public.b24_astros enable row level security;
alter table public.b24_bases enable row level security;
alter table public.b24_stances enable row level security;
alter table public.b24_claims enable row level security;
alter table public.b24_incoming enable row level security;
alter table public.b24_operations enable row level security;
alter table public.b24_operation_members enable row level security;
alter table public.b24_scheduled_notifications enable row level security;
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

drop policy if exists "Anyone can read B24 stances" on public.b24_stances;
create policy "Anyone can read B24 stances"
on public.b24_stances
for select
using (true);

drop policy if exists "Anyone can write B24 stances" on public.b24_stances;
create policy "Anyone can write B24 stances"
on public.b24_stances
for insert
with check (true);

drop policy if exists "Anyone can update B24 stances" on public.b24_stances;
create policy "Anyone can update B24 stances"
on public.b24_stances
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

drop policy if exists "Anyone can read B24 operations" on public.b24_operations;
create policy "Anyone can read B24 operations"
on public.b24_operations
for select
using (true);

drop policy if exists "Anyone can write B24 operations" on public.b24_operations;
create policy "Anyone can write B24 operations"
on public.b24_operations
for insert
with check (true);

drop policy if exists "Anyone can update B24 operations" on public.b24_operations;
create policy "Anyone can update B24 operations"
on public.b24_operations
for update
using (true)
with check (true);

drop policy if exists "Anyone can read B24 operation members" on public.b24_operation_members;
create policy "Anyone can read B24 operation members"
on public.b24_operation_members
for select
using (true);

drop policy if exists "Anyone can write B24 operation members" on public.b24_operation_members;
create policy "Anyone can write B24 operation members"
on public.b24_operation_members
for insert
with check (true);

drop policy if exists "Anyone can update B24 operation members" on public.b24_operation_members;
create policy "Anyone can update B24 operation members"
on public.b24_operation_members
for update
using (true)
with check (true);

drop policy if exists "Anyone can read B24 scheduled notifications" on public.b24_scheduled_notifications;
create policy "Anyone can read B24 scheduled notifications"
on public.b24_scheduled_notifications
for select
using (true);

drop policy if exists "Anyone can write B24 scheduled notifications" on public.b24_scheduled_notifications;
create policy "Anyone can write B24 scheduled notifications"
on public.b24_scheduled_notifications
for insert
with check (true);

drop policy if exists "Anyone can update B24 scheduled notifications" on public.b24_scheduled_notifications;
create policy "Anyone can update B24 scheduled notifications"
on public.b24_scheduled_notifications
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
      and tablename = 'b24_operations'
  ) then
    alter publication supabase_realtime add table public.b24_operations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_operation_members'
  ) then
    alter publication supabase_realtime add table public.b24_operation_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'b24_scheduled_notifications'
  ) then
    alter publication supabase_realtime add table public.b24_scheduled_notifications;
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
