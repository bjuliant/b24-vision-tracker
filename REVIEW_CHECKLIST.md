# VisionBot Review Checklist

Ordered so each step supports the next one.

## Foundation

- [x] Make `!` private and `$` public consistently.
- [x] Add `/help` and mention fallback for Telegram privacy mode.
- [x] Rename player base lookup to `!bases`; reserve `!intel` for coordinate intel.
- [x] Require SOS/incoming reports to include the defended coordinate.
- [x] Store stable Telegram user IDs and chat IDs on operational records.

## Operations

- [x] Add operation tables and operation member tables.
- [x] Create attack operations from `$claim`.
- [x] Create defense operations from `$sos`.
- [x] Add member state commands: `!join`, `!respond`, `!ready`, `!sent`, `!leave`.
- [x] Add public operation boards: `$board`, `$board attack`, `$board defense`, `/board`.
- [x] Add inline buttons: Join, Ready, Sent, Leave, Status.
- [x] Store the public operation message ID.
- [x] Edit the existing operation card when members change.
- [x] Allow operation standdown/close from the operation card.
- [x] Add officer/admin checks for closing operations.

## Reminders

- [x] Add scheduled notification table.
- [x] Schedule launch reminders when someone joins with travel time.
- [x] Schedule arrival reminders for operations.
- [x] Add a polling worker that sends due reminders.
- [x] Mark reminders sent so bot restarts do not resend them.

## Mini App

- [x] Display operation counts on selected sector.
- [x] Add an operations panel below sector intel.
- [x] Allow opening the Mini App directly to a sector/astro.
- [x] Highlight operation target from bot links.

## Intel Quality

- [x] Display intel age on operation cards.
- [x] Warn when target intel is stale.
- [x] Add `!stale` for sectors/targets needing refreshed scouting.
- [x] Add scout request operations.

## Security

- [x] Decide the guild/chat isolation model.
- [x] Restrict operational reads/writes by approved chat or guild.
- [x] Restrict close/standdown to commander/officers.
- [x] Revisit public anon Supabase policies before hostile use.

## Stabilization Review

- [x] Replace group Mini App `webApp` buttons with normal URL buttons.
- [x] Fix `!respond` operation parsing.
- [x] Add active guild/chat scope so DM commands can operate on group operations.
- [x] Preserve member details when ready/sent/leave updates state.
- [x] Close linked claims, incoming reports, and reminders when standing down.
- [x] Skip reminders when operation/member state makes them obsolete.
- [x] Show real member counts in `!next`.
- [x] Exclude withdrawn members from joined counts.
- [x] Show hostile-origin intel on defense operation cards.
- [x] Increase short operation ID length.
- [x] Reject impossible travel times that would launch in the past.
- [x] Warn before duplicate active target/defense operations.

## Later

- [ ] Battle calculators.
  - Needs Astro Empires combat formulas and ship stat assumptions before implementation.
- [x] Target scoring.
- [ ] Revenge/history records.
  - Needs command shape: what counts as a revenge record, who can add/remove, and how long to retain it.
- [ ] Deeper analytics.
  - Needs concrete reports/charts after real guild usage creates data.
