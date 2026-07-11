# B24 Vision Tracker

A Telegram Mini App starter for a shared 10x10 guild intel map. The upper-left tile is `00` and stores no data; the playable sectors are `B24:1` through `B24:99`.

## Files

- `index.html`, `styles.css`, `app.js`: the Mini App
- `config.js`: optional Supabase credentials
- `supabase.sql`: database table, policies, and realtime setup
- `supabase-intel.sql`: extra tables for systems, astros, bases, and multi-flag sectors
- `bot/`: a tiny Telegram bot that sends an `Open Map` button

## Run Locally

Open `index.html` in a browser. Without Supabase credentials, updates are saved in local browser storage.

## Add Live Sync

1. Create a free Supabase project.
2. Open the SQL editor and run `supabase.sql`, then run `supabase-intel.sql`.
3. Copy `config.example.js` to `config.js`.
4. Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
5. Host the folder on GitHub Pages, Netlify, Vercel, or Cloudflare Pages.

## Telegram Intel Lookups

The bot can answer coordinate lookups from Supabase:

- `!g [galaxy]` sets your personal default galaxy.
- `!setgalaxy [galaxy]` sets the current chat's default galaxy.
- `![coord]` sends planet intel to the user by private message.
- `$[coord]` posts planet intel in the current chat.
- `!claim [coord] [minutes] [note]` claims a target landing in that many minutes.
- `!targets` sends your active claims privately.
- `!claimed` posts all active claimed attacks line by line.
- `!attacked [coord] [minutes] [note]` reports hostile incoming from that coordinate.
- `!incoming` posts all active hostile incoming reports sorted by ETA.
- `!mine [coord] [note]` saves one of your bases.
- `!me` sends your saved bases privately.
- `!save me [coord] [note]` saves or updates a note on one of your bases.
- `!wakeup` runs a 60 second startup countdown.
- `!help` or `/help` shows available commands. Use `!help claim`, `!help intel`, `!help incoming`, `!help bases`, or `!help galaxy` for examples.

For group lookups, disable bot privacy in `@BotFather` with `/setprivacy`, or Telegram may hide normal `!` and `$` messages from the bot. For channel lookups, add the bot to the channel with permission to post. Users must start the bot privately once before it can DM them.

Bot environment variables:

- `BOT_TOKEN`
- `WEB_APP_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `DEFAULT_GALAXY`, usually `B24`

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
