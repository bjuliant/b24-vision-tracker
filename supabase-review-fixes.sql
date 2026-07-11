-- Small review fixes that are safe to run on an existing VisionBot database.

alter table public.b24_operation_members
add column if not exists withdrawn_at timestamptz;
