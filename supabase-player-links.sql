-- Verified links between a Telegram handle and the in-game owner name
-- observed at an imported base. Officers create these through:
--   $intel B24:13:45:10 @telegram_username

create table if not exists public.b24_player_links (
  chat_id text not null,
  telegram_username text not null,
  telegram_user_id text,
  game_username text not null,
  game_username_key text not null,
  evidence_coord text not null,
  evidence_map_id text not null,
  linked_by text,
  linked_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chat_id, telegram_username)
);

create index if not exists b24_player_links_game_username_idx
on public.b24_player_links (chat_id, game_username_key);

alter table public.b24_player_links enable row level security;

-- No anonymous policies. The Render bot reads and writes with the service-role key.
grant all on public.b24_player_links to service_role;

notify pgrst, 'reload schema';
