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

- `!g B24` sets your personal default galaxy.
- `!setgalaxy B24` sets the current chat's default galaxy.
- `!B24:34:06:10` sends the planet intel to the user by private message.
- `$B24:34:06:10` posts the planet intel in the current chat.
- `!claim B24:24:34:06 10 optional note` claims a target landing 10 minutes from now.
- `!claim B24:24:34:06:10 optional note` also works; the final `:10` is treated as minutes from now.
- `!targets` sends your active claims privately.
- `!claimed` posts all active claimed attacks line by line.
- `!attacked B24:34:06:10 25 optional note` reports hostile incoming from that coordinate, ETA 25 minutes.
- `!attacked B24:34:06:10:25 optional note` also works; final `:25` is treated as ETA minutes.
- `!incoming` posts all active hostile incoming reports sorted by ETA.
- `!mine B24:06:10:20 optional note` saves one of your bases.
- `!mine B24:06:` also works as a rough region-level save until you add exact coordinates.
- `!me` sends your saved bases privately.
- `!save me B24:06:10:20 defense request` saves or updates a note on one of your bases.
- `!help` or `/help` shows available commands.

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
