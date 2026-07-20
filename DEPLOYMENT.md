# Lysander / VisionBot Deployment Control

Last reviewed: 2026-07-15

## Current Release State

Deployment status: BLOCKED.

Do not rerun the full historical SQL chain against production. The malformed non-SQL line in `supabase-defense-fixes.sql` has been removed, but the current hardening file still does not fully remove anonymous access. PM-001 must be completed and reviewed before treating the complete bootstrap chain as a repeatable production migration.

No deployment was performed during the Control Room review.

The selected `PM-004 / 24 - Battle History and Occupations` change is expected to require Render bot/API and GitHub Pages Mini App files only. It must not add a Supabase migration. This expectation is part of the task boundary; any discovered schema requirement must be returned to the Control Room instead of being added silently.

## Release Ownership

- Domain task: implements one approved scope, tests it, and updates project documents. It does not deploy.
- Reviewer task: checks regressions, security, migrations, and missing tests.
- Control Room: reconciles status and decides whether the batch is release-ready.
- Release task: assembles and executes one approved Supabase, Render, GitHub Pages, and Telegram verification checklist.

## Current Components

- GitHub Pages/static host: `index.html`, `styles.css`, `app.js`, `config.js`, and `assets/`.
- Render service: `bot/index.js` with `bot/package.json`; build from `bot/`, install dependencies, then run `npm start`.
- Supabase: schema/migration files named `supabase*.sql`.
- Telegram: bot webhook or polling, with the hosted Mini App URL.

This snapshot contains no `.git` directory, lockfile, `render.yaml`, CI workflow, or automated tests. A release must therefore confirm the actual source repository, commit SHA, dependency resolution, and Render settings outside this folder.

## Required Render Environment

Secrets must stay on Render and must never be copied into `config.js` or committed output.

```text
BOT_TOKEN
WEB_APP_URL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DEFAULT_GALAXY=B24
APPROVED_CHAT_IDS
ACCESS_CHAT_IDS
OFFICER_USER_IDS
MINI_APP_ACCESS_SECRET
MINI_APP_TOKEN_MINUTES=20
MINI_APP_EXPORT_TOKEN_DAYS=30
PRIMARY_GUILD_TAG=[APP]
WEBHOOK_URL
TELEGRAM_WEBHOOK_SECRET
REQUIRE_ACCESS_CONTROL=true
```

For hostile use, `APPROVED_CHAT_IDS`, `ACCESS_CHAT_IDS`, `OFFICER_USER_IDS`, `SUPABASE_SERVICE_ROLE_KEY`, and `TELEGRAM_WEBHOOK_SECRET` must be populated. Startup intentionally fails if `REQUIRE_ACCESS_CONTROL=true` and required controls are missing.

## Static Mini App Configuration

Production `config.js` should expose only the backend URL and non-secret display defaults:

```js
window.B24_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  BOT_API_URL: "https://b24-vision-bot.onrender.com",
  GALAXY: "B24"
};
```

`app.js` accepts either `GALAXY` or the legacy `MAP_ID`, but new configuration should use `GALAXY`. Never place a service-role key in browser files.

## Provisional Supabase Order

The following dependency order reflects the current files, but it is not approved for production until PM-001 repairs and consolidates it:

1. `supabase.sql`
2. `supabase-intel.sql`
3. `supabase-research-doctrine.sql`
4. `supabase-review-fixes.sql`
5. `supabase-defense-fixes.sql`
6. `supabase-intel-annotations.sql`
7. `supabase-battle-reports.sql`
8. `supabase-fleet-intel.sql`
9. `supabase-hardening.sql` - always last under the current design

Do not include `supabase-miniapp-claims.sql` in a secured production deployment. It recreates anonymous claim-write policies that the backend architecture no longer needs.

Never rerun `supabase.sql` or `supabase-intel.sql` after hardening in the current design; both can recreate permissive policies. PM-001 must replace this fragile rule with a safe repeatable migration chain.

For an already hardened database, `supabase-research-doctrine.sql` is a standalone additive migration and may be run by itself. Do not rerun the bootstrap files just to add research doctrine columns.

## Batch Release Procedure

### 1. Preflight

- [ ] Control Room marks the batch ready and identifies the exact included tasks.
- [ ] Reviewer signs off on code, security, SQL, migrations, and tests.
- [ ] Confirm the source repository, branch, commit SHA, and clean intended diff.
- [ ] Confirm no secrets exist in the diff, browser assets, logs, or generated bookmarklet.
- [ ] Run JavaScript syntax checks and the future automated test command.
- [ ] Review database changes for idempotency, destructive operations, backfill needs, and rollback.
- [ ] Record current Render deployment, GitHub Pages commit, bot build, and database backup point.

### 2. Supabase

- [ ] Take/confirm a recoverable backup or restoration point.
- [ ] Run only reviewed migrations in their approved order.
- [ ] Verify expected tables, columns, indexes, constraints, and policies.
- [ ] Verify anonymous access is denied as designed and service-role access succeeds.
- [ ] Do not run obsolete `supabase-miniapp-claims.sql`.

### 3. Render

- [ ] Verify every required environment variable and URL.
- [ ] Deploy the reviewed bot commit from the correct `bot/` root.
- [ ] Confirm startup succeeds, webhook registration succeeds, and `/status` reports the expected build.
- [ ] Inspect logs for errors without exposing message arguments or secrets.

### 4. GitHub Pages / Static Host

- [ ] Publish the matching `index.html`, `styles.css`, `app.js`, `config.js`, and assets from the same release batch.
- [ ] Bump cache-busting query values when `app.js` or `styles.css` changes.
- [ ] Confirm direct hosted access shows the access-required screen.
- [ ] Confirm a fresh `/map` link loads the matching Mini App build.

### 5. Telegram and Cross-Client Verification

- [ ] Run Phase 1 access/health checks from `TEST_QUEUE.md`.
- [ ] Verify one intel coordinate in Telegram and the Mini App matches.
- [ ] Verify Telegram-to-Mini-App and Mini-App-to-Telegram attack flow.
- [ ] Verify incoming report/coverage in both directions.
- [ ] Verify exact-base and region watch assignment in both directions.
- [ ] Verify a signed bookmarklet import appears in both clients and contains no Supabase key.
- [ ] Verify Astro Reports accepts one galaxy, a comma-separated list, `ALL`, and `RESUME`; confirm each completed galaxy is uploaded before the next begins and an interrupted run resumes at the first incomplete galaxy.
- [ ] Verify `/map B23` and `/map B24` open isolated maps without changing saved defaults.
- [ ] Verify a B23 room and B24 room can hold different `$setgalaxy` defaults simultaneously.
- [ ] Verify a normal B23 or B24 page export follows the galaxy visible in Astro Empires, while a Guild Reports scan partitions mixed-galaxy coordinates into their matching maps.
- [ ] Verify a Guild Reports scan prompts before starting, shows paced progress and cancellation, and imports Bases, Fleets, and Moving Fleets without bypassing member access checks.
- [ ] Verify a long-lived exporter continues after the short `/map` link expires and fails after the user is banned or removed.
- [ ] Verify expired/revoked map access fails closed.
- [ ] Verify battle report deduplication, owner/occupier separation, and history display if included in the batch.
- [ ] Verify `!history <coord>` and the Mini App coordinate history return only the active guild chat's records.
- [ ] Verify `!occupied` filters active occupations and excludes a conquest followed by liberation.
- [ ] Verify battle/event ordering uses effective event time rather than import/creation order.
- [ ] Watch one reminder path and check for duplicate delivery.

### 6. Closeout

- [ ] Record deployed commit/build IDs, SQL migrations, environment changes, test results, and known issues.
- [ ] Update `PROJECT_STATUS.md` and `MASTER_CHECKLIST.md`.
- [ ] Return to Control Room for the next task selection.

## Rollback Expectations

- Static host: redeploy the previous known-good commit/assets.
- Render: roll back to the previous known-good service build and matching environment.
- Supabase: prefer forward repair for additive migrations; use the recorded backup/restore point for destructive or policy failures.
- If app and bot versions become incompatible, restore both from the same release batch rather than rolling back only one client.
- Revoke exposed tokens/keys immediately if a secret reaches browser assets, logs, or source history.
