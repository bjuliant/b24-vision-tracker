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
- [x] Restrict operational commands by approved chat or guild.
- [x] Add user permission gate for sensitive operation commands with `ACCESS_CHAT_IDS` / `OFFICER_USER_IDS`.
- [x] Keep coordinate intel lookup commands open for public use.
- [x] Restrict close/standdown to commander/officers.
- [x] Revisit public anon Supabase policies before hostile use.
- [ ] Remove anonymous reads from operational Supabase tables before hostile/multi-guild production use.
- [ ] Route Mini App operation writes through the backend instead of direct public Supabase writes.

## Stabilization Review

- [x] Add missing `withdrawn_at` schema column for `!leave`.
- [x] Stop reporting operation member updates as successful when Supabase rejects the write.
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
- [x] Include Mini App claims on `$board` / `@board`.
- [x] Guard operation callback buttons with permission and operation-scope checks.
- [x] Make `$` commands sent in DM post to the active guild group, or explicitly reject them.
- [ ] Make operation creation and closure transactional.
- [ ] Add atomic reminder claiming to avoid duplicate reminders if multiple bot instances run.

## Hostile-Use Review

- [x] Restrict coordinate/intel lookup to approved guild/access users.
- [x] Sensitive commands such as `@board`, `$board`, `$attack`, `$sos`, `$incoming`, and `$targets` require permission.
- [x] Permission can be granted by membership in a configured Telegram access group/channel.
- [x] Remove saved user bases and private notes from public coordinate/system intel.
- [x] Require sensitive-command authorization for `Bases` inline callback buttons.
- [x] Reject or quarantine Mini App claims when `chat_id` is missing.
- [x] Fail closed when board claims are missing `chat_id`.
- [ ] Scope Mini App claim and operation reads/subscriptions by verified guild/chat.
- [x] Add hardening drops for `Mini App can write/update B24 claims` policies.
- [ ] Remove anonymous map-intel writes after backend import exists.
- [ ] Store Mini App wave times as absolute timestamps rather than clock-only labels.
- [x] Sync `!sent` operation-member state to linked claim `confirmed_sent`.
- [x] Restrict `/map`, `$map`, and `@map` to approved/access users.
- [x] Show a Mini App access-required screen when GitHub Pages is opened directly outside Telegram.
- [x] Add `!astros` / `$astros` galaxy breakdown and terrain search.
- [x] Return helpful responses for unknown command-like messages instead of silently ignoring them.
- [x] Add partial coordinate summaries for galaxy and region lookups.
- [ ] Validate Mini App Telegram `initData` on the backend before trusting app actions.
- [ ] Give the Mini App a backend operation creation endpoint so app claims create full operations.
- [ ] Restrict Mini App reads by verified active guild/chat scope.
- [ ] Remove `supabase-miniapp-claims.sql` once backend claim creation exists.

## July 12 Architecture Review

- [x] Review P0/P1/P2 findings and separate patch-sized fixes from backend/RPC redesign work.
- [x] Fix Mini App exporter identity so scanner/import rows keep the Telegram user label and ID when available.
- [x] Isolate Mini App local cache by galaxy plus active chat scope.
- [x] Add optional Telegram webhook secret validation and safer bot-level error handling.
- [x] Add safe SQL prep for reminder queue state/locking and useful runtime indexes.
- [x] Add Lysander-managed guild access table.
- [x] Add `$onboardme` for users to request guild access.
- [x] Add officer-only `$approve`, `$officer`, `$demote`, `$ban`, and `$access`.
- [x] Hide access-management commands from normal help and expose them through `$ohelp`.
- [x] Let database access roles participate in sensitive/officer permission checks.
- [ ] Replace ordinary map URLs with signed Mini App session links generated by the bot backend.
- [ ] Move Mini App reads/writes behind backend endpoints using service-role Supabase access.
- [ ] Add transactional RPCs for operation creation, campaign creation, closure, and target claiming.
- [ ] Replace multi-target campaign-over-claims with operation target and target assignment tables.
- [ ] Add automated parser, command, permission, reminder, and Mini App tests.
- [ ] Split `bot/index.js` into command/domain/db modules and generate help from a command registry.

## July 12 Product Roadmap Review

Ordered by the natural Astro Empires progression: gather intel, expand, coordinate operations, then add heavier planners.

- [x] Identify that Lysander's product goal is shifting from "stores guild info" to "tells each person what to do next."
- [x] Add first-pass `!next` action center using existing data: personal operations, incoming near saved bases, saved-base count, and scoped views such as `!next combat`, `!next empire`, and `!next 24h`.
- [x] Make `!me` a profile/dashboard entry instead of only dumping bases.
- [x] Implement `!me bases` as the base-only view already promised in help.
- [ ] Add ID-less contextual actions: `!ready`, `!sent`, `!leave`, and `!take` should auto-pick when only one relevant operation exists.
- [ ] Add reply-to-operation shortcuts such as `ready`, `sent`, `18m cover`, and `can't arrive`.
- [ ] Add a guided `/start` / `!setup` onboarding wizard for guild, galaxy, timezone, base, notifications, and first import.
- [ ] Add base snapshots and `!base sync` before build/research recommendations.
- [ ] Add doctrine-driven build planning after base snapshots exist.
- [ ] Add research, production, and unlock-path planning after build planning has base data.
- [ ] Upgrade astro search into purpose-based scoring and expansion reservations.
- [ ] Add end-to-end expansion workflow: reserve, outpost sent, base founded, role assigned.
- [ ] Implement watchlists and smart alerts for bases, players, guilds, sectors, operations, stale intel, and incoming.
- [ ] Add role-specific `!digest` and `$briefing` outputs.
- [ ] Add immutable intel history, diffs, source records, and confidence scoring.
- [ ] Add scout coverage and route planning.
- [ ] Add defense triage and responder matching.
- [ ] Add operation requirements and auto-assignment board.
- [ ] Add battle/counter/wave/profit calculators after formulas and assumptions are agreed.
- [ ] Add result/debrief/rebuild/debris settlement workflows.
- [ ] Add occupation/unrest/revolt/liberation tracking.
- [ ] Expand friend/enemy stances into diplomacy, treaties, incidents, and attack clearance.
- [ ] Add trade-route matching and guild economy coordination.

## Later

- [ ] Battle calculators.
  - Needs Astro Empires combat formulas and ship stat assumptions before implementation.
- [x] Target scoring.
- [ ] Revenge/history records.
  - Needs command shape: what counts as a revenge record, who can add/remove, and how long to retain it.
- [ ] Deeper analytics.
  - Needs concrete reports/charts after real guild usage creates data.
