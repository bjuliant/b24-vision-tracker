# B24 Vision Tracker

A Telegram Mini App starter for a shared 10x10 guild map. The upper-left tile is `00` and stores no data; the playable sectors are `B24:1` through `B24:99`.

## Files

- `index.html`, `styles.css`, `app.js`: the Mini App
- `config.js`: optional Supabase credentials
- `supabase.sql`: database table, policies, and realtime setup
- `bot/`: a tiny Telegram bot that sends an `Open Map` button

## Run Locally

Open `index.html` in a browser. Without Supabase credentials, updates are saved in local browser storage.

## Add Live Sync

1. Create a free Supabase project.
2. Open the SQL editor and run `supabase.sql`.
3. Copy `config.example.js` to `config.js`.
4. Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
5. Host the folder on GitHub Pages, Netlify, Vercel, or Cloudflare Pages.

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
