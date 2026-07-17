# B24 Vision Tracker

A Telegram Mini App starter for a shared 10x10 guild intel map. The upper-left tile is `00` and stores no data; the playable sectors are `B24:1` through `B24:99`.

## Product Charter

Lysander is a staff officer, not an autopilot.

It collects, organizes, calculates, compares, reminds, and records. It does not play Astro Empires for the member.

The project rule is: automate bookkeeping, assist judgment, require human ownership for decisions and in-game actions.

- Recommendations should show reasoning and assumptions.
- Guild commitments should identify the person accepting responsibility.
- In-game actions must be performed by a player.
- Completion should be confirmed by a player or supported by a fresh observation.
- The bot may reduce typing, calculation, searching, duplication, and confusion. It should not remove player judgment, responsibility, or participation.

## Files

- `index.html`, `styles.css`, `app.js`: the Mini App
- `config.js`: optional Supabase credentials
- `supabase.sql`: database table, policies, and realtime setup
- `supabase-intel.sql`: extra tables for systems, astros, bases, and multi-flag sectors
- `supabase-research-doctrine.sql`: additive migration for each member's saved research branch
- `bot/`: a tiny Telegram bot that sends an `Open Map` button

## Run Locally

Open `index.html` in a browser. Without Supabase credentials, updates are saved in local browser storage.

## Add Live Sync

1. Create a free Supabase project.
2. Open the SQL editor and run `supabase.sql`, then run `supabase-intel.sql`.
3. Run any one-time migration files needed by the current bot build.
4. Put `SUPABASE_SERVICE_ROLE_KEY` on the Render bot only.
5. Set `BOT_API_URL` in `config.js` to the Render service and leave browser Supabase credentials blank for the secured Mini App.
6. Host the static Mini App on GitHub Pages, Netlify, Vercel, or Cloudflare Pages.

For production hardening, read `SECURITY_MODEL.md` first. Run `supabase-hardening.sql` last. Rerunning the permissive bootstrap SQL afterward can recreate anonymous policies.

For an existing hardened project, do not rerun the bootstrap SQL. Run only the reviewed additive migration required by the new build. Research doctrines require `supabase-research-doctrine.sql` once.

## Telegram Intel Lookups

The bot can answer coordinate lookups from Supabase:

Prefix a command with `!` to get the reply privately. Prefix the same command with `$` to post the reply in the current group or channel. If Telegram privacy hides `$help` in a group, use `/help` instead; slash commands are visible to the bot. With privacy enabled, mentioning the bot also works, such as `@b24Visionbot $help`.

- `/map [galaxy] [coord]` opens that galaxy once without changing any saved default, for example `/map B23`.
- `!galaxy [galaxy]` sets your personal default galaxy; `!g` remains a short alias.
- `$setgroup [galaxy]` sets the current Telegram room's default galaxy. `$setgalaxy` remains an alias.
- `$guild bind` remembers the current group as your active operation group for later DM commands.
- `!guild status` shows your active operation group.
- `![coord]` sends planet intel to the user by private message.
- `$[coord]` posts planet intel in the current chat.
- `!intel` or `$intel [coord]` looks up a coordinate.
- `!claim` or `$claim [coord] [minutes] [note]` claims a target landing in that many minutes.
- `!next` or `!myops` sends your personal dashboard.
- `$board` or `/board` lists active attacks and defenses publicly.
- `$op status [ID]` posts a public operation summary.
- `!join [ID] [role/note]` joins an operation.
- `!respond [ID] [role/note]` joins a defense operation.
- `!ready [ID]` marks you ready.
- `!sent [ID] [fleet row/note]` confirms you launched.
- `!leave [ID] [reason]` withdraws from an operation.
- `$standdown [ID] [reason]` closes an operation.
- `$defense` shows the public defense board.
- `!targets` or `$targets` is an old alias for your active claims.
- `!claimed` or `$claimed` is an old alias for active attack claims.
- `!sos` or `$sos [your base] [attacker coord] [minutes] [note]` reports hostile incoming against a defended base.
- `!attacked` or `$attacked [your base] [attacker coord] [minutes] [note]` is an alias for SOS.
- `!incoming` or `$incoming` lists all active hostile incoming reports sorted by ETA.
- `!mine` or `$mine [coord] [note]` saves one of your bases.
- `!me` or `$me` shows your saved bases.
- `!bases` or `$bases [name]` lists another player's saved bases in the current galaxy.
- `!save me` or `$save me [coord] [note]` saves or updates a note on one of your bases.
- `!buildplan [1-16]` shows the structure doctrine for that many bases.
- `!researchplan [1-16]` shows the expansion research doctrine; Base 8 is the branch point.
- `!researchplan [growth|economy|production|science|defense|mobility|fleet|balanced]` explains a doctrine.
- `!research doctrine [branch]` saves the branch used by numbered plans from Base 9 onward.
- `!researchplan fleet [unit]` shows a fleet specialization such as `battleship` or `dreadnought`.
- `!wakeup` runs a 60 second startup countdown.
- `!help`, `$help`, or `/help` shows available commands. Use `!help claim`, `!help intel`, `!help incoming`, `!help bases`, `!help board`, or `!help galaxy` for examples.

For group lookups, disable bot privacy in `@BotFather` with `/setprivacy`, or Telegram may hide normal `!` and `$` messages from the bot. For channel lookups, add the bot to the channel with permission to post. Users must start the bot privately once before it can DM them.

Bot environment variables:

- `BOT_TOKEN`
- `WEB_APP_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`, optional for the bot only; use this before running Supabase hardening SQL
- `DEFAULT_GALAXY`, usually `B24`
- `APPROVED_CHAT_IDS`, optional comma-separated Telegram group/channel IDs allowed to use operation commands
- `ACCESS_CHAT_IDS`, optional comma-separated Telegram group/channel IDs whose members may use sensitive operation commands
- `OFFICER_USER_IDS`, optional comma-separated Telegram user IDs that always have sensitive command access
- `MINI_APP_ACCESS_SECRET`, a long random private value used to sign expiring `/map` links; if omitted, the bot token is used
- `MINI_APP_TOKEN_MINUTES`, optional map-link lifetime from 5 to 60 minutes; defaults to 20
- `MINI_APP_EXPORT_TOKEN_DAYS`, optional galaxy-bound exporter lifetime from 1 to 90 days; defaults to 30
- `PRIMARY_GUILD_TAG`, your own guild tag used for automatic map coverage, usually `[APP]`

Recommended hostile-use setup:

1. Create a private Telegram access group for guild command staff.
2. Add VisionBot to that access group, preferably as admin so membership checks work reliably.
3. Put that group ID in `ACCESS_CHAT_IDS`.
4. Put your actual operation room/group ID in `APPROVED_CHAT_IDS`.

All map, intel, coverage, scouting, and operation commands require an approved guild member. There is no public-intel exception.

## Create The Telegram Bot

1. Message `@BotFather` in Telegram.
2. Run `/newbot` and copy the bot token.
3. Run `/setmenubutton`, choose the bot, and paste your hosted Mini App URL.
4. Optional: run `/setdomain` with the same domain.

## Run The Bot

From the `bot` folder:

```bash
npm install
BOT_TOKEN=123:abc WEB_APP_URL=https://your-site.example npm start
```

In PowerShell:

```powershell
$env:BOT_TOKEN="123:abc"
$env:WEB_APP_URL="https://your-site.example"
npm start
```

Send `/map` to the bot, then pin its message in your guild chat.

## Secure Mini App Map

`/map` now creates a signed, short-lived link tied to the requesting Telegram user and their approved operation group. The Mini App verifies that link against the Render bot before it loads live coverage or accepts a watch claim. Opening the GitHub Pages URL directly shows the access screen.

Set these on Render before deploying the map update:

```text
MINI_APP_ACCESS_SECRET=<long random value>
MINI_APP_TOKEN_MINUTES=20
MINI_APP_EXPORT_TOKEN_DAYS=30
PRIMARY_GUILD_TAG=[APP]
```

The hosted map uses `BOT_API_URL` in `config.js`; it should point to the Render service, for example `https://b24-vision-bot.onrender.com`.

### Shared Attack Plans

Signed Mini App sessions read and update the same `b24_operations` and `b24_claims` records used by Lysander's `$attacks` command. Members can claim, release, and mark their own waves sent. Officers can create plans, add targets, and stand plans down. These actions go through the authenticated Render API; the browser does not receive a service-role key.

### Shared Defense and Incoming

Signed Mini App sessions also read the same `b24_incoming` records used by `$incoming` and `$board defense`. Members can report hostile arrivals, take defense coverage, and release their own coverage through Render. Officers can clear a false report; if it belongs to a linked defense operation, its unsent reminders are cancelled as well.

### Shared Scouting

The Mini App reads the same persistent exact-base and region scouting agendas used by `$scouting`. Members can take or release watch responsibility and see all of their current watches. Officers can create or cancel agendas and can turn an exact-base watch list into a four-hour attack plan. Telegram and the Mini App update the same `b24_operations` and `b24_operation_members` rows.

### Shared Intel and Secure Export

Selecting a sector loads its systems, astros, bases, stances, and freshness from Render. Manual imports and the generated AE bookmarklet post to the signed `/api/miniapp/import` endpoint; the exporter never contains a Supabase key. Copying the exporter from an authorized map now requests a separate galaxy-bound credential that defaults to 30 days. It remains tied to the Telegram user and APP scope, and every import rechecks current access, so banning or removing the member revokes it.

### Multiple Galaxies on Borealis

Lysander supports multiple Borealis galaxies without mixing their intel or operations. Every record remains isolated by `map_id` (`b23-main`, `b24-main`, and so on).

- Use `/map B23` for a one-time B23 map without changing your defaults.
- Use `!galaxy B23` in DM or a group to save your personal default.
- Use `$setgroup B23` in an approved Telegram room to make that room operate in B23. `$setgalaxy` remains an alias.
- Copy the exporter separately from each galaxy map. A B23 exporter imports only B23 data, while a B24 exporter imports only B24 data.

A B23 room and a B24 room can therefore create claims, scouting agendas, and attacks at the same time using the same bot and database.

The signed Mini App provides selected-coordinate battle history from base/astro rows, and Telegram supports protected `!history` / `!occupied` reads. Both keep recorded ownership separate from the current occupier and scope sensitive history records to the active guild chat. Manual import preview/confirmation remains follow-up work.

The current migration intentionally supports Borealis only. Multi-server isolation and server switching remain deferred until a second server is selected and tested end to end.
