-- Small review fixes that are safe to run on an existing VisionBot database.

alter table public.b24_operation_members
add column if not exists withdrawn_at timestamptz;

-- Lysander-managed Telegram access records. This lets the bot make
-- per-guild member/officer decisions without editing Render env vars.
create table if not exists public.b24_access_members (
  chat_id text not null,
  user_id text not null,
  username text,
  display_name text,
  role text not null default 'member',
  status text not null default 'pending',
  access_mode text not null default 'group',
  approved_by text,
  approved_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chat_id, user_id),
  check (role in ('member', 'officer', 'owner')),
  check (status in ('pending', 'active', 'banned')),
  constraint b24_access_members_access_mode_check check (access_mode in ('group', 'private'))
);

alter table public.b24_access_members
add column if not exists access_mode text not null default 'group';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'b24_access_members_access_mode_check'
      and conrelid = 'public.b24_access_members'::regclass
  ) then
    alter table public.b24_access_members
    add constraint b24_access_members_access_mode_check
    check (access_mode in ('group', 'private'));
  end if;
end $$;

alter table public.b24_access_members enable row level security;

drop policy if exists "Anyone can read B24 access members" on public.b24_access_members;
drop policy if exists "Anyone can write B24 access members" on public.b24_access_members;
drop policy if exists "Anyone can update B24 access members" on public.b24_access_members;

-- Telegram rooms approved to enter one canonical guild operation scope.
-- Keep this table service-role-only; it is authorization/routing state.
create table if not exists public.b24_approved_chats (
  guild_id text not null default 'APP',
  chat_id text not null,
  scope_chat_id text not null,
  chat_title text,
  status text not null default 'active',
  is_primary boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, chat_id),
  check (status in ('active', 'revoked'))
);

alter table public.b24_approved_chats enable row level security;

drop policy if exists "Anyone can read B24 approved chats" on public.b24_approved_chats;
drop policy if exists "Anyone can write B24 approved chats" on public.b24_approved_chats;
drop policy if exists "Anyone can update B24 approved chats" on public.b24_approved_chats;
drop policy if exists "Anyone can delete B24 approved chats" on public.b24_approved_chats;

-- Preparation for atomic reminder claiming. The current bot can keep using
-- sent_at, while a later worker can lock pending rows without duplicate sends.
alter table public.b24_scheduled_notifications
add column if not exists state text default 'pending',
add column if not exists locked_at timestamptz,
add column if not exists locked_by text,
add column if not exists attempt_count integer default 0,
add column if not exists last_error text,
add column if not exists next_attempt_at timestamptz;

-- Runtime indexes for the current bot queries. These are intentionally
-- non-destructive and safe to run on an existing alpha database.
create index if not exists b24_claims_board_idx
on public.b24_claims (map_id, chat_id, status, arrival_at);

create index if not exists b24_incoming_board_idx
on public.b24_incoming (map_id, chat_id, status, arrival_at);

create index if not exists b24_operations_board_idx
on public.b24_operations (map_id, chat_id, status, type, arrival_at);

create index if not exists b24_operations_short_id_idx
on public.b24_operations (map_id, short_id);

create index if not exists b24_operation_members_lookup_idx
on public.b24_operation_members (operation_id, user_id, state);

create index if not exists b24_notifications_due_idx
on public.b24_scheduled_notifications (state, next_attempt_at, send_at)
where sent_at is null and cancelled_at is null;

create index if not exists b24_astros_search_idx
on public.b24_astros (map_id, terrain, has_base);

create index if not exists b24_astros_region_idx
on public.b24_astros (map_id, region_id);

create index if not exists b24_bases_guild_idx
on public.b24_bases (map_id, guild);

create index if not exists b24_access_members_user_idx
on public.b24_access_members (user_id, status, role);

create index if not exists b24_access_members_lookup_idx
on public.b24_access_members (chat_id, status, role, updated_at);

create index if not exists b24_approved_chats_scope_idx
on public.b24_approved_chats (guild_id, scope_chat_id, status);

create index if not exists b24_approved_chats_status_idx
on public.b24_approved_chats (guild_id, status, updated_at);
