-- Defense coverage state for incoming reports.
-- Run this once in Supabase SQL Editor before deploying bot build 2026-07-13.9+.

alter table public.b24_incoming
add column if not exists covered_by text,
add column if not exists covered_by_user_id text,
add column if not exists covered_at timestamptz;

create index if not exists b24_incoming_coverage_idx
on public.b24_incoming (map_id, chat_id, status, covered_by_user_id, arrival_at);
