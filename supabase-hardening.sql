-- Optional production hardening.
--
-- Run this only after the bot host has SUPABASE_SERVICE_ROLE_KEY set.
-- This keeps public reads available for the Mini App, but removes anon
-- writes from operational tables so hostile users cannot spoof claims,
-- incoming reports, operation cards, reminders, or saved bases directly.

drop policy if exists "Anyone can write B24 claims" on public.b24_claims;
drop policy if exists "Anyone can update B24 claims" on public.b24_claims;

drop policy if exists "Anyone can write B24 incoming" on public.b24_incoming;
drop policy if exists "Anyone can update B24 incoming" on public.b24_incoming;

drop policy if exists "Anyone can write B24 operations" on public.b24_operations;
drop policy if exists "Anyone can update B24 operations" on public.b24_operations;

drop policy if exists "Anyone can write B24 operation members" on public.b24_operation_members;
drop policy if exists "Anyone can update B24 operation members" on public.b24_operation_members;

drop policy if exists "Anyone can write B24 scheduled notifications" on public.b24_scheduled_notifications;
drop policy if exists "Anyone can update B24 scheduled notifications" on public.b24_scheduled_notifications;

drop policy if exists "Anyone can write B24 user bases" on public.b24_user_bases;
drop policy if exists "Anyone can update B24 user bases" on public.b24_user_bases;

drop policy if exists "Anyone can write B24 user settings" on public.b24_user_settings;
drop policy if exists "Anyone can update B24 user settings" on public.b24_user_settings;

drop policy if exists "Anyone can write B24 chat settings" on public.b24_chat_settings;
drop policy if exists "Anyone can update B24 chat settings" on public.b24_chat_settings;
