# VisionBot Security Model

## Current model

VisionBot scopes operational data by Telegram chat ID.

- Attack, defense, scout, claim, incoming, and member records store `chat_id`.
- Board and operation queries filter to the current `chat_id`.
- Users are identified by stable Telegram `user_id` values.
- Operation close/standdown is limited to the commander or Telegram chat admins.

## Deployment allowlist

Set `APPROVED_CHAT_IDS` on the bot host to restrict operational commands to known Telegram groups/channels.

Example:

```text
APPROVED_CHAT_IDS=-1001234567890,-1009876543210
```

When this variable is empty, the bot allows all chats for easier testing.

## Remaining risk

The Mini App still uses public Supabase anon policies so guild members can sync easily. Before hostile use, put `SUPABASE_SERVICE_ROLE_KEY` on the bot host, then run `supabase-hardening.sql` to remove public anon writes from operational tables.
