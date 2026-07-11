# VisionBot Security Model

## Current model

VisionBot scopes operational data by Telegram chat ID.

- Attack, defense, scout, claim, incoming, and member records store `chat_id`.
- Board and operation queries filter to the current `chat_id`.
- Users are identified by stable Telegram `user_id` values.
- Operation close/standdown is limited to the commander or Telegram chat admins.
- Coordinate intel lookup commands remain intentionally open.
- Sensitive operation commands require permission when `ACCESS_CHAT_IDS` is set.

## Public vs restricted commands

Public commands are safe to expose because they return map/coordinate intelligence:

```text
![coord]
$[coord]
!intel <coord>
$intel <coord>
!help
/map
```

Restricted commands reveal or mutate operational plans and require access:

```text
$board, @board, /board
$attack / $claim
$sos / $attacked
$scout
!join, !respond, !ready, !sent, !leave
!targets, !claimed, !incoming, !next
!bases, !mine, !me, !save me
$guild, $setgalaxy, $standdown
```

Set `ACCESS_CHAT_IDS` to one or more Telegram group/channel IDs. If a user is a member of any access chat, VisionBot allows restricted commands for that user. Add VisionBot to that access chat so it can call Telegram `getChatMember`.

Example:

```text
ACCESS_CHAT_IDS=-1001111111111
OFFICER_USER_IDS=123456789,987654321
```

`OFFICER_USER_IDS` is a manual override for trusted Telegram user IDs.

## Deployment allowlist

Set `APPROVED_CHAT_IDS` on the bot host to restrict operational commands to known Telegram groups/channels.

Example:

```text
APPROVED_CHAT_IDS=-1001234567890,-1009876543210
```

When this variable is empty, the bot allows all chats for easier testing.

`APPROVED_CHAT_IDS` controls where operation commands may be used. `ACCESS_CHAT_IDS` controls who may use them.

## Remaining risk

The Mini App still uses public Supabase anon policies so guild members can sync easily. Before hostile use, put `SUPABASE_SERVICE_ROLE_KEY` on the bot host, then run `supabase-hardening.sql` to remove public anon writes from operational tables.

The next secure milestone is to route Mini App operation writes through the Render bot backend, validate Telegram init data, and remove anonymous reads/writes from operational tables.
