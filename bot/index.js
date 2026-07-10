import { Telegraf, Markup } from "telegraf";

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const defaultGalaxy = normalizeGalaxy(process.env.DEFAULT_GALAXY || process.env.GALAXY || "B24");

if (!token) throw new Error("BOT_TOKEN is required");
if (!webAppUrl) throw new Error("WEB_APP_URL is required");
if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
if (!supabaseKey) throw new Error("SUPABASE_ANON_KEY is required");

const bot = new Telegraf(token);
const galaxyPattern = /B\d{2}/i;
const astroPattern = /(B\d{2}:\d{2}:\d{2}:\d{2})/i;
const coordPattern = /([!$])\s*(B\d{2}:\d{2}:\d{2}:\d{2})\b/i;
const claimPattern = /^!claim\s+(B\d{2}:\d{2}:\d{2}:\d{2})(?::(\d{1,4}))?(?:\s+(\d{1,4}))?(?:\s+(.+))?$/i;
const attackedPattern = /^!attacked\s+(B\d{2}:\d{2}:\d{2}:\d{2})(?::(\d{1,4}))?(?:\s+(\d{1,4}))?(?:\s+(.+))?$/i;
const minePattern = /^!mine\s+(\S+)(?:\s+(.+))?$/i;
const saveMePattern = /^!save\s+me\s+(\S+)(?:\s+(.+))?$/i;

bot.start(sendMapButton);
bot.command("map", sendMapButton);
bot.command("help", (ctx) => ctx.reply(helpText(), { parse_mode: "HTML" }));

bot.on("text", handleText);
bot.on("channel_post", handleText);

async function sendMapButton(ctx) {
  const galaxy = await galaxyForContext(ctx);
  return ctx.reply(
    `${galaxy} Vision Tracker`,
    Markup.inlineKeyboard([
      Markup.button.webApp("Open Map", mapUrl(galaxy))
    ])
  );
}

async function handleText(ctx) {
  const text = ctx.message?.text || ctx.channelPost?.text || "";
  const lower = text.trim().toLowerCase();

  if (lower === "!help") return ctx.reply(helpText(), { parse_mode: "HTML" });
  if (lower.startsWith("!g ")) return handleUserGalaxy(ctx, text);
  if (lower.startsWith("!setgalaxy ")) return handleChatGalaxy(ctx, text);
  if (lower.startsWith("!claim")) return handleClaim(ctx, text);
  if (lower.startsWith("!attacked")) return handleAttacked(ctx, text);
  if (lower === "!incoming") return handleIncoming(ctx);
  if (lower === "!targets") return handleTargets(ctx);
  if (lower === "!claimed") return handleClaimed(ctx);
  if (lower.startsWith("!mine")) return handleMine(ctx, text);
  if (lower === "!me") return handleMe(ctx);
  if (lower.startsWith("!save me")) return handleSaveMe(ctx, text);

  const match = text.match(coordPattern);
  if (!match) return;

  const mode = match[1];
  const coord = normalizeAstro(match[2]);
  const report = await buildAstroReport(coord);

  if (mode === "!") {
    if (!ctx.from?.id) return;
    try {
      await ctx.telegram.sendMessage(ctx.from.id, report, { parse_mode: "HTML" });
      if (ctx.chat.type !== "private") await ctx.reply(`Sent ${coord} intel privately.`);
    } catch {
      await ctx.reply(`I could not DM you. Open the bot privately first, then try ${mode}${coord} again.`);
    }
    return;
  }

  await ctx.reply(report, { parse_mode: "HTML" });
}

function helpText() {
  return [
    "<b>VisionBot Commands</b>",
    "",
    "<code>/map</code> - open your current galaxy map",
    "<code>!g B24</code> - set your personal galaxy",
    "<code>!setgalaxy B24</code> - set this chat's default galaxy",
    "<code>!B24:34:06:10</code> - DM planet intel to you",
    "<code>$B24:34:06:10</code> - post planet intel in this chat",
    "<code>!claim B24:24:34:06 10 note</code> - claim target landing in 10 minutes",
    "<code>!claim B24:24:34:06:10 note</code> - same, final :10 is minutes",
    "<code>!targets</code> - DM your active claims for this galaxy",
    "<code>!claimed</code> - list active claims for this galaxy",
    "<code>!attacked B24:34:06:10 25 note</code> - report hostile incoming, ETA 25m",
    "<code>!incoming</code> - list active hostile incoming for this galaxy",
    "<code>!mine B24:06:10:20 note</code> - save one of your bases",
    "<code>!me</code> - list your saved bases for this galaxy",
    "<code>!save me B24:06:10:20 defense request</code> - save a note on your base",
    "<code>!help</code> - show this help"
  ].join("\n");
}

async function handleUserGalaxy(ctx, text) {
  if (!ctx.from?.id) return ctx.reply("Use !g in a group or private chat so I know who to save.");
  const galaxy = normalizeGalaxy((text.match(galaxyPattern) || [])[0]);
  if (!galaxy) return ctx.reply("Use: !g B24");

  const saved = await upsertRow("b24_user_settings", {
    user_id: telegramUserId(ctx),
    galaxy,
    map_id: galaxyToMapId(galaxy),
    updated_at: new Date().toISOString()
  }, "user_id");

  if (!saved) return ctx.reply("Could not save your galaxy setting.");
  return ctx.reply(`Your default galaxy is now ${galaxy}.`);
}

async function handleChatGalaxy(ctx, text) {
  if (!ctx.chat?.id) return;
  const galaxy = normalizeGalaxy((text.match(galaxyPattern) || [])[0]);
  if (!galaxy) return ctx.reply("Use: !setgalaxy B24");

  const saved = await upsertRow("b24_chat_settings", {
    chat_id: String(ctx.chat.id),
    galaxy,
    map_id: galaxyToMapId(galaxy),
    updated_at: new Date().toISOString()
  }, "chat_id");

  if (!saved) return ctx.reply("Could not save this chat's galaxy setting.");
  return ctx.reply(`This chat's default galaxy is now ${galaxy}.`);
}

async function handleClaim(ctx, text) {
  const match = text.trim().match(claimPattern);
  if (!match) return ctx.reply("Use: !claim B24:24:34:06 10 optional note");

  const target = normalizeAstro(match[1]);
  const minutes = Number(match[2] || match[3]);
  const note = (match[4] || "").trim();
  if (!validMinutes(minutes)) return ctx.reply("Use minutes from now, 1 to 1440.");

  const now = new Date();
  const arrivalAt = new Date(now.getTime() + minutes * 60 * 1000);
  const claim = {
    map_id: mapIdForCoord(target),
    claim_id: randomId(),
    target_coord: target,
    region_id: astroToRegion(target),
    system_id: astroToSystem(target),
    claimed_by: telegramName(ctx),
    arrival_at: arrivalAt.toISOString(),
    arrival_label: "",
    confirmed_sent: false,
    confirmed_at: null,
    confirmed_by: "",
    fleet_label: "",
    note,
    status: "active",
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  if (!(await insertRow("b24_claims", claim))) return ctx.reply("Claim failed. I could not reach Supabase.");
  return ctx.reply(`Claimed ${escapeHtml(target)} for ${escapeHtml(claim.claimed_by)}\nLanding in ${minutes}m at ${escapeHtml(formatLocalSummary(arrivalAt))}${note ? `\nNote: ${escapeHtml(note)}` : ""}`, { parse_mode: "HTML" });
}

async function handleTargets(ctx) {
  if (!ctx.from?.id) return ctx.reply("Use !targets in a group or private chat so I know who to look up.");
  const galaxy = await galaxyForContext(ctx);
  const claims = await fetchRows("b24_claims", {
    claimed_by: `eq.${telegramName(ctx)}`,
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  const message = claims.length ? claims.map(formatClaimLine).join("\n") : `You have no active claimed targets in ${galaxy}.`;

  if (ctx.chat?.type === "private") return ctx.reply(message, { parse_mode: "HTML" });
  try {
    await ctx.telegram.sendMessage(ctx.from.id, message, { parse_mode: "HTML" });
    await ctx.reply(`Sent your ${galaxy} active targets privately.`);
  } catch {
    await ctx.reply("I could not DM you. Open the bot privately first, then try !targets again.");
  }
}

async function handleClaimed(ctx) {
  const galaxy = await galaxyForContext(ctx);
  const claims = await fetchRows("b24_claims", {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  return ctx.reply(claims.length ? claims.map(formatClaimLine).join("\n") : `No active attacks claimed in ${galaxy}.`, { parse_mode: "HTML" });
}

async function handleAttacked(ctx, text) {
  const match = text.trim().match(attackedPattern);
  if (!match) return ctx.reply("Use: !attacked B24:34:06:10 25 optional note");

  const attacker = normalizeAstro(match[1]);
  const minutes = Number(match[2] || match[3]);
  const note = (match[4] || "").trim();
  if (!validMinutes(minutes)) return ctx.reply("Use ETA minutes from now, 1 to 1440.");

  const now = new Date();
  const arrivalAt = new Date(now.getTime() + minutes * 60 * 1000);
  const incoming = {
    map_id: mapIdForCoord(attacker),
    incoming_id: randomId(),
    attacker_coord: attacker,
    region_id: astroToRegion(attacker),
    system_id: astroToSystem(attacker),
    eta_minutes: minutes,
    arrival_at: arrivalAt.toISOString(),
    reported_by: telegramName(ctx),
    note,
    status: "active",
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  if (!(await insertRow("b24_incoming", incoming))) return ctx.reply("Incoming report failed. I could not reach Supabase.");
  return ctx.reply(`Incoming reported from ${escapeHtml(attacker)}\nETA ${minutes}m at ${escapeHtml(formatLocalSummary(arrivalAt))}${note ? `\nNote: ${escapeHtml(note)}` : ""}`, { parse_mode: "HTML" });
}

async function handleIncoming(ctx) {
  const galaxy = await galaxyForContext(ctx);
  const incoming = await fetchRows("b24_incoming", {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  return ctx.reply(incoming.length ? incoming.map(formatIncomingLine).join("\n") : `No active hostile incoming reports in ${galaxy}.`, { parse_mode: "HTML" });
}

async function handleMine(ctx, text) {
  if (!ctx.from?.id) return ctx.reply("Use !mine in a group or private chat so I know who owns the base.");
  const match = text.trim().match(minePattern);
  if (!match) return ctx.reply("Use: !mine B24:06:10:20 optional note");

  const location = normalizeLocation(match[1]);
  const note = (match[2] || "").trim();
  if (!location) return ctx.reply("Use an AE location like B24:06:10:20, B24:06:10, or B24:06.");

  const stamp = new Date().toISOString();
  const row = {
    map_id: galaxyToMapId(location.galaxy),
    user_id: telegramUserId(ctx),
    base_coord: location.coord,
    region_id: location.region,
    system_id: location.system,
    owner_label: telegramName(ctx),
    note,
    status: "active",
    created_at: stamp,
    updated_at: stamp
  };
  if (!(await upsertRow("b24_user_bases", row, "map_id,user_id,base_coord"))) return ctx.reply("Base save failed. I could not reach Supabase.");
  return ctx.reply(`Saved ${escapeHtml(location.coord)} to your ${location.galaxy} base list${note ? `\nNote: ${escapeHtml(note)}` : ""}.`, { parse_mode: "HTML" });
}

async function handleMe(ctx) {
  if (!ctx.from?.id) return ctx.reply("Use !me in a group or private chat so I know who to look up.");
  const galaxy = await galaxyForContext(ctx);
  const rows = await fetchRows("b24_user_bases", {
    user_id: `eq.${telegramUserId(ctx)}`,
    status: "eq.active"
  }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" });
  const message = rows.length ? rows.map(formatUserBaseLine).join("\n") : `You have no saved bases in ${galaxy}. Add one with !mine ${galaxy}:06:10:20`;
  if (ctx.chat?.type === "private") return ctx.reply(message, { parse_mode: "HTML" });
  try {
    await ctx.telegram.sendMessage(ctx.from.id, message, { parse_mode: "HTML" });
    await ctx.reply(`Sent your ${galaxy} base list privately.`);
  } catch {
    await ctx.reply("I could not DM you. Open the bot privately first, then try !me again.");
  }
}

async function handleSaveMe(ctx, text) {
  if (!ctx.from?.id) return ctx.reply("Use !save me in a group or private chat so I know who owns the note.");
  const match = text.trim().match(saveMePattern);
  if (!match) return ctx.reply("Use: !save me B24:06:10:20 defense request");

  const location = normalizeLocation(match[1]);
  const note = (match[2] || "").trim();
  if (!location || !note) return ctx.reply("Use: !save me B24:06:10:20 defense request");

  const stamp = new Date().toISOString();
  const row = {
    map_id: galaxyToMapId(location.galaxy),
    user_id: telegramUserId(ctx),
    base_coord: location.coord,
    region_id: location.region,
    system_id: location.system,
    owner_label: telegramName(ctx),
    note,
    status: "active",
    created_at: stamp,
    updated_at: stamp
  };
  if (!(await upsertRow("b24_user_bases", row, "map_id,user_id,base_coord"))) return ctx.reply("Save failed. I could not reach Supabase.");
  return ctx.reply(`Saved note for ${escapeHtml(location.coord)}:\n${escapeHtml(note)}`, { parse_mode: "HTML" });
}

async function buildAstroReport(coord) {
  const [astro, base] = await Promise.all([
    fetchOne("b24_astros", { coord }, mapIdForCoord(coord)),
    fetchOne("b24_bases", { coord }, mapIdForCoord(coord))
  ]);

  if (!astro && !base) return `No intel found for ${escapeHtml(coord)} yet.`;

  const lines = [`<b>${escapeHtml(coord)}</b>`];
  if (astro) {
    const attrs = Array.isArray(astro.attributes) ? astro.attributes.join(" / ") : "";
    lines.push(`${escapeHtml(astro.terrain || "Unknown")} ${escapeHtml(astro.astro_type || "Astro")}`);
    if (attrs) lines.push(`Attributes: ${escapeHtml(attrs)}`);
    lines.push(`Base: ${astro.has_base ? "Yes" : "No"}`);
  }
  if (base) {
    if (base.guild) lines.push(`Guild: ${escapeHtml(base.guild)}`);
    if (base.label) lines.push(`Owner: ${escapeHtml(base.label)}`);
  }
  return lines.join("\n");
}

async function galaxyForContext(ctx) {
  const chatId = ctx.chat?.id ? String(ctx.chat.id) : "";
  if (chatId) {
    const chat = await fetchOne("b24_chat_settings", { chat_id: chatId }, null, false);
    if (chat?.galaxy) return normalizeGalaxy(chat.galaxy);
  }
  if (ctx.from?.id) {
    const user = await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false);
    if (user?.galaxy) return normalizeGalaxy(user.galaxy);
  }
  return defaultGalaxy;
}

async function fetchOne(table, filters, forcedMapId = null, includeMap = true) {
  const params = new URLSearchParams({ select: "*", limit: "1" });
  if (includeMap) params.set("map_id", `eq.${forcedMapId || galaxyToMapId(defaultGalaxy)}`);
  Object.entries(filters).forEach(([key, value]) => params.set(key, `eq.${value}`));
  const rows = await requestRows(table, params);
  return rows[0] || null;
}

async function fetchRows(table, filters, options = {}) {
  const params = new URLSearchParams({
    select: "*",
    map_id: `eq.${options.mapId || galaxyToMapId(defaultGalaxy)}`,
    order: options.order || "arrival_at.asc"
  });
  Object.entries(filters).forEach(([key, value]) => params.set(key, value));
  return requestRows(table, params);
}

async function requestRows(table, params) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  });
  if (!response.ok) {
    console.error(`${table} lookup failed`, await response.text());
    return [];
  }
  return response.json();
}

async function insertRow(table, row) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    console.error(`${table} insert failed`, await response.text());
    return false;
  }
  return true;
}

async function upsertRow(table, row, conflictColumns) {
  const params = new URLSearchParams({ on_conflict: conflictColumns });
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    console.error(`${table} upsert failed`, await response.text());
    return false;
  }
  return true;
}

function formatClaimLine(claim) {
  const note = claim.note ? ` - ${escapeHtml(claim.note)}` : "";
  const status = claim.confirmed_sent ? "confirmed" : "planned";
  return `${escapeHtml(claim.target_coord)} - ${escapeHtml(claim.claimed_by || "Unknown")} - ${formatEta(new Date(claim.arrival_at))} - ${status}${note}`;
}

function formatIncomingLine(incoming) {
  const note = incoming.note ? ` - ${escapeHtml(incoming.note)}` : "";
  return `${escapeHtml(incoming.attacker_coord)} - ETA ${formatEta(new Date(incoming.arrival_at))} - reported by ${escapeHtml(incoming.reported_by || "Unknown")}${note}`;
}

function formatUserBaseLine(base) {
  const note = base.note ? ` - ${escapeHtml(base.note)}` : "";
  return `${escapeHtml(base.base_coord)}${note}`;
}

function formatEta(date) {
  const diff = date.getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return "arrived";
  const total = Math.ceil(diff / 60000);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const time = formatLocalSummary(date);
  return hours ? `${hours}h ${minutes}m (${time})` : `${minutes}m (${time})`;
}

function formatLocalSummary(date) {
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function telegramName(ctx) {
  const from = ctx.from;
  if (!from) return "Telegram channel";
  if (from.username) return `@${from.username}`;
  return [from.first_name, from.last_name].filter(Boolean).join(" ") || `Telegram ${from.id}`;
}

function telegramUserId(ctx) {
  return ctx.from?.id ? String(ctx.from.id) : "unknown";
}

function normalizeLocation(value) {
  const parts = String(value || "").trim().toUpperCase().replace(/:+$/, "").split(":").filter(Boolean);
  const galaxy = normalizeGalaxy(parts[0]);
  if (!galaxy || parts.length < 2 || parts.length > 4) return null;
  const nums = parts.slice(1).map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 99)) return null;
  const padded = nums.map((num) => String(num).padStart(2, "0"));
  return {
    galaxy,
    coord: [galaxy, ...padded].join(":"),
    region: `${galaxy}:${nums[0]}`,
    system: nums.length >= 2 ? [galaxy, padded[0], padded[1]].join(":") : ""
  };
}

function normalizeAstro(value) {
  const match = String(value || "").toUpperCase().match(/^(B\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  return match ? `${match[1]}:${match[2]}:${match[3]}:${match[4]}` : "";
}

function normalizeGalaxy(value) {
  const match = String(value || "").toUpperCase().match(/^B\d{2}$/);
  return match ? match[0] : "";
}

function galaxyFromCoord(coord) {
  return normalizeGalaxy(String(coord || "").split(":")[0]) || defaultGalaxy;
}

function galaxyToMapId(galaxy) {
  return `${normalizeGalaxy(galaxy).toLowerCase()}-main`;
}

function mapIdForCoord(coord) {
  return galaxyToMapId(galaxyFromCoord(coord));
}

function astroToRegion(coord) {
  const parts = coord.split(":");
  return `${parts[0]}:${Number(parts[1])}`;
}

function astroToSystem(coord) {
  return coord.split(":").slice(0, 3).join(":");
}

function validMinutes(minutes) {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function mapUrl(galaxy) {
  const separator = webAppUrl.includes("?") ? "&" : "?";
  return `${webAppUrl}${separator}gal=${encodeURIComponent(galaxy)}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
