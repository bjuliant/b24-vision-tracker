import { Telegraf, Markup } from "telegraf";
import http from "node:http";

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const defaultGalaxy = normalizeGalaxy(process.env.DEFAULT_GALAXY || process.env.GALAXY || "B24");
const port = Number(process.env.PORT || 10000);

if (!token) throw new Error("BOT_TOKEN is required");
if (!webAppUrl) throw new Error("WEB_APP_URL is required");
if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
if (!supabaseKey) throw new Error("SUPABASE_ANON_KEY is required");

const bot = new Telegraf(token);
const galaxyPattern = /B\d{2}/i;
const claimPattern = /^[!$]claim\s+(.+)$/i;
const attackedPattern = /^[!$]attacked\s+(.+)$/i;
const minePattern = /^[!$]mine\s+(.+)$/i;
const saveMePattern = /^[!$]save\s+me\s+(.+)$/i;

bot.start(sendMapButton);
bot.command("map", sendMapButton);
bot.command("help", (ctx) => ctx.reply(helpText(ctx.message?.text || ""), { parse_mode: "HTML" }));

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
  const mode = deliveryMode(text);

  if (isCommand(lower, "help")) return respond(ctx, mode, helpText(text), { parse_mode: "HTML" });
  if (isExactCommand(lower, "wakeup")) return handleWakeup(ctx, mode);
  if (isCommand(lower, "g")) return handleUserGalaxy(ctx, text, mode);
  if (isCommand(lower, "setgalaxy")) return handleChatGalaxy(ctx, text, mode);
  if (isCommand(lower, "claim")) return handleClaim(ctx, text, mode);
  if (isCommand(lower, "attacked")) return handleAttacked(ctx, text, mode);
  if (isCommand(lower, "intel") || isCommand(lower, "bases")) return handlePlayerIntel(ctx, text, mode);
  if (isExactCommand(lower, "incoming")) return handleIncoming(ctx, mode);
  if (isExactCommand(lower, "targets")) return handleTargets(ctx, mode);
  if (isExactCommand(lower, "claimed")) return handleClaimed(ctx, mode);
  if (isCommand(lower, "mine")) return handleMine(ctx, text, mode);
  if (isExactCommand(lower, "me")) return handleMe(ctx, mode);
  if (isCommand(lower, "save me")) return handleSaveMe(ctx, text, mode);

  const lookup = parseLookupCommand(text, await galaxyForContext(ctx));
  if (!lookup) return;

  const lookupMode = lookup.mode;
  const report = lookup.kind === "system"
    ? await buildSystemReport(lookup.coord)
    : await buildAstroReport(lookup.coord);

  if (lookupMode === "!") {
    return respond(ctx, lookupMode, report, { parse_mode: "HTML" });
  }

  await respond(ctx, lookupMode, report, { parse_mode: "HTML" });
}

function helpText(input = "") {
  const topic = String(input).trim().split(/\s+/)[1]?.toLowerCase() || "";
  const topics = {
    claim: [
      "<b>Claim Help</b>",
      "",
      "<code>!claim [coord] [minutes] [note]</code>",
      "<code>$claim [coord] [minutes] [note]</code>",
      "Claim an attack target landing in a number of minutes. Use <code>!</code> for a private confirmation or <code>$</code> to post it publicly.",
      "",
      "Examples:",
      "<code>!claim B24:24:34:06 10 fighters</code>",
      "<code>$claim B23:11:22:30:45 wave 2</code>"
    ],
    intel: [
      "<b>Intel Lookup Help</b>",
      "",
      "<code>![coord]</code> - DM intel to you",
      "<code>$[coord]</code> - post intel in the current chat",
      "",
      "Examples:",
      "<code>!B24:34:06:10</code>",
      "<code>$B23:44:76:20</code>",
      "<code>!B24 02 76 10</code>",
      "<code>!24 02 76 10</code>",
      "<code>!24027610</code>",
      "<code>!B24:02:76</code> - list all known astros in a system"
    ],
    incoming: [
      "<b>Incoming Help</b>",
      "",
      "<code>!attacked [attacker coord] [eta minutes] [note]</code>",
      "<code>$attacked [attacker coord] [eta minutes] [note]</code>",
      "Report hostile incoming and sort it by ETA. Use <code>!</code> privately or <code>$</code> publicly.",
      "",
      "Examples:",
      "<code>!attacked B24:34:06:10 25 incoming dread</code>",
      "<code>$incoming</code>"
    ],
    bases: [
      "<b>Base List Help</b>",
      "",
      "<code>!mine [coord] [note]</code> - save one of your bases",
      "<code>$mine [coord] [note]</code> - save one publicly",
      "<code>!me</code> - DM your saved bases",
      "<code>$me</code> - post your saved bases here",
      "<code>!save me [coord] [note]</code> - save/update a base note",
      "<code>!bases [name]</code>/<code>$bases [name]</code> - list a player's saved bases",
      "<code>!intel [name]</code>/<code>$intel [name]</code> - list a player's saved bases",
      "",
      "Example:",
      "<code>!save me B24:06:10:20 needs defense</code>",
      "<code>$bases storebo</code>"
    ],
    galaxy: [
      "<b>Galaxy Help</b>",
      "",
      "<code>!g [galaxy]</code> - set your personal galaxy",
      "<code>!setgalaxy [galaxy]</code> - set this chat's galaxy",
      "",
      "Examples:",
      "<code>!g B24</code>",
      "<code>!setgalaxy B23</code>"
    ]
  };

  if (topics[topic]) return topics[topic].join("\n");

  return [
    "<b>VisionBot Commands</b>",
    "",
    "<code>!</code> commands DM you. <code>$</code> commands post in the chat.",
    "",
    "<code>/map</code> - open your current galaxy map",
    "<code>!g</code> - set your personal galaxy",
    "<code>!setgalaxy</code> - set this chat's galaxy",
    "<code>![coord]</code> - DM planet intel to you",
    "<code>$[coord]</code> - post planet intel here",
    "<code>!claim</code>/<code>$claim</code> - claim an attack target",
    "<code>!targets</code>/<code>$targets</code> - show your active claims",
    "<code>!claimed</code>/<code>$claimed</code> - list active claims",
    "<code>!attacked</code>/<code>$attacked</code> - report hostile incoming",
    "<code>!incoming</code>/<code>$incoming</code> - list hostile incoming",
    "<code>!bases</code>/<code>$bases</code> - list a player's saved bases",
    "<code>!intel</code>/<code>$intel</code> - old alias for player bases",
    "<code>!mine</code>/<code>$mine</code> - save one of your bases",
    "<code>!me</code>/<code>$me</code> - show your saved bases",
    "<code>!save me</code>/<code>$save me</code> - save a note on your base",
    "<code>!wakeup</code> - run startup countdown",
    "",
    "Details: <code>!help claim</code>, <code>!help intel</code>, <code>!help incoming</code>, <code>!help bases</code>, <code>!help galaxy</code>"
  ].join("\n");
}

function deliveryMode(text) {
  const first = String(text || "").trim()[0];
  return first === "$" ? "$" : "!";
}

function isCommand(lowerText, command) {
  const lower = String(lowerText || "").trim();
  return lower === `!${command}` || lower === `$${command}` || lower.startsWith(`!${command} `) || lower.startsWith(`$${command} `);
}

function isExactCommand(lowerText, command) {
  const lower = String(lowerText || "").trim();
  return lower === `!${command}` || lower === `$${command}`;
}

async function respond(ctx, mode, message, options = {}) {
  if (mode === "$" || ctx.chat?.type === "private") return ctx.reply(message, options);
  if (!ctx.from?.id) return ctx.reply("Use $ for public channel commands. I cannot privately reply to channel posts.");
  try {
    return await ctx.telegram.sendMessage(ctx.from.id, message, options);
  } catch {
    return ctx.reply("I could not DM you. Open the bot privately first, then try the command again.");
  }
}

async function sendCountdownMessage(ctx, mode, message) {
  if (mode === "$" || ctx.chat?.type === "private") {
    const sent = await ctx.reply(message);
    return { chatId: ctx.chat.id, messageId: sent.message_id };
  }
  if (!ctx.from?.id) {
    const sent = await ctx.reply("Use $wakeup in channels. I cannot privately reply to channel posts.");
    return { chatId: ctx.chat.id, messageId: sent.message_id };
  }
  try {
    const sent = await ctx.telegram.sendMessage(ctx.from.id, message);
    return { chatId: ctx.from.id, messageId: sent.message_id };
  } catch {
    const sent = await ctx.reply("I could not DM you. Open the bot privately first, then try !wakeup again.");
    return { chatId: ctx.chat.id, messageId: sent.message_id };
  }
}

async function handleWakeup(ctx, mode) {
  const checkpoints = [60, 45, 30, 15, 5];
  const message = await sendCountdownMessage(ctx, mode, "VisionBot startup sequence: 60s");

  for (const seconds of checkpoints.slice(1)) {
    await wait((checkpoints[checkpoints.indexOf(seconds) - 1] - seconds) * 1000);
    try {
      await ctx.telegram.editMessageText(
        message.chatId,
        message.messageId,
        undefined,
        `VisionBot startup sequence: ${seconds}s`
      );
    } catch {
      await respond(ctx, mode, `VisionBot startup sequence: ${seconds}s`);
    }
  }

  await wait(5000);
  try {
    await ctx.telegram.editMessageText(
      message.chatId,
      message.messageId,
      undefined,
      "VisionBot is awake. Use !help for commands."
    );
  } catch {
    await respond(ctx, mode, "VisionBot is awake. Use !help for commands.");
  }
}

async function handleUserGalaxy(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !g in a group or private chat so I know who to save.");
  const galaxy = normalizeGalaxy((text.match(galaxyPattern) || [])[0]);
  if (!galaxy) return respond(ctx, mode, "Use: !g B24");

  const saved = await upsertRow("b24_user_settings", {
    user_id: telegramUserId(ctx),
    galaxy,
    map_id: galaxyToMapId(galaxy),
    updated_at: new Date().toISOString()
  }, "user_id");

  if (!saved) return respond(ctx, mode, "Could not save your galaxy setting.");
  return respond(ctx, mode, `Your default galaxy is now ${galaxy}.`);
}

async function handleChatGalaxy(ctx, text, mode) {
  if (!ctx.chat?.id) return;
  const galaxy = normalizeGalaxy((text.match(galaxyPattern) || [])[0]);
  if (!galaxy) return respond(ctx, mode, "Use: !setgalaxy B24");

  const saved = await upsertRow("b24_chat_settings", {
    chat_id: String(ctx.chat.id),
    galaxy,
    map_id: galaxyToMapId(galaxy),
    updated_at: new Date().toISOString()
  }, "chat_id");

  if (!saved) return respond(ctx, mode, "Could not save this chat's galaxy setting.");
  return respond(ctx, mode, `This chat's default galaxy is now ${galaxy}.`);
}

async function handleClaim(ctx, text, mode) {
  const match = text.trim().match(claimPattern);
  if (!match) return respond(ctx, mode, "Use: !claim B24:24:34:06 10 optional note");

  const parsed = parseTimedCoordinate(match[1], await galaxyForContext(ctx));
  if (!parsed?.coord || parsed.kind !== "astro") return respond(ctx, mode, "Use: !claim [coord] [minutes] [note]");

  const target = parsed.coord;
  const minutes = parsed.minutes;
  const note = parsed.note;
  if (!validMinutes(minutes)) return respond(ctx, mode, "Use minutes from now, 1 to 1440.");

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

  if (!(await insertRow("b24_claims", claim))) return respond(ctx, mode, "Claim failed. I could not reach Supabase.");
  return respond(ctx, mode, `Claimed ${escapeHtml(target)} for ${escapeHtml(claim.claimed_by)}\nLanding in ${minutes}m at ${escapeHtml(formatLocalSummary(arrivalAt))}${note ? `\nNote: ${escapeHtml(note)}` : ""}`, { parse_mode: "HTML" });
}

async function handleTargets(ctx, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !targets in a group or private chat so I know who to look up.");
  const galaxy = await galaxyForContext(ctx);
  const claims = await fetchRows("b24_claims", {
    claimed_by: `eq.${telegramName(ctx)}`,
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  const message = claims.length ? claims.map(formatClaimLine).join("\n") : `You have no active claimed targets in ${galaxy}.`;
  return respond(ctx, mode, message, { parse_mode: "HTML" });
}

async function handleClaimed(ctx, mode) {
  const galaxy = await galaxyForContext(ctx);
  const claims = await fetchRows("b24_claims", {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  return respond(ctx, mode, claims.length ? claims.map(formatClaimLine).join("\n") : `No active attacks claimed in ${galaxy}.`, { parse_mode: "HTML" });
}

async function handleAttacked(ctx, text, mode) {
  const match = text.trim().match(attackedPattern);
  if (!match) return respond(ctx, mode, "Use: !attacked B24:34:06:10 25 optional note");

  const parsed = parseTimedCoordinate(match[1], await galaxyForContext(ctx));
  if (!parsed?.coord || parsed.kind !== "astro") return respond(ctx, mode, "Use: !attacked [coord] [eta minutes] [note]");

  const attacker = parsed.coord;
  const minutes = parsed.minutes;
  const note = parsed.note;
  if (!validMinutes(minutes)) return respond(ctx, mode, "Use ETA minutes from now, 1 to 1440.");

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

  if (!(await insertRow("b24_incoming", incoming))) return respond(ctx, mode, "Incoming report failed. I could not reach Supabase.");
  return respond(ctx, mode, `Incoming reported from ${escapeHtml(attacker)}\nETA ${minutes}m at ${escapeHtml(formatLocalSummary(arrivalAt))}${note ? `\nNote: ${escapeHtml(note)}` : ""}`, { parse_mode: "HTML" });
}

async function handleIncoming(ctx, mode) {
  const galaxy = await galaxyForContext(ctx);
  const incoming = await fetchRows("b24_incoming", {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  return respond(ctx, mode, incoming.length ? incoming.map(formatIncomingLine).join("\n") : `No active hostile incoming reports in ${galaxy}.`, { parse_mode: "HTML" });
}

async function handlePlayerIntel(ctx, text, mode) {
  const query = text.replace(/^[!$](intel|bases)\s+/i, "").trim().replace(/^@/, "");
  if (!query) return respond(ctx, mode, "Use: !bases playername");

  const galaxy = await galaxyForContext(ctx);
  const rows = await fetchRows("b24_user_bases", {
    status: "eq.active"
  }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" });

  const needle = query.toLowerCase();
  const matches = rows.filter((row) => {
    return String(row.owner_label || "").replace(/^@/, "").toLowerCase().includes(needle);
  });

  if (!matches.length) return respond(ctx, mode, `No saved bases found for ${escapeHtml(query)} in ${galaxy}.`, { parse_mode: "HTML" });

  const owners = [...new Set(matches.map((row) => row.owner_label || query))].join(", ");
  const lines = [`<b>${escapeHtml(owners)}</b>`, `${matches.length} saved bases in ${galaxy}`];
  matches.forEach((row) => lines.push(formatUserBaseLine(row)));
  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleMine(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !mine in a group or private chat so I know who owns the base.");
  const match = text.trim().match(minePattern);
  if (!match) return respond(ctx, mode, "Use: !mine B24:06:10:20 optional note");

  const parsed = parseCoordinate(match[1], await galaxyForContext(ctx));
  const location = parsed ? normalizeLocation(parsed.coord) : null;
  const note = parsed?.remainder.trim() || "";
  if (!location) return respond(ctx, mode, "Use an AE location like B24:06:10:20, B24:06:10, or B24:06.");

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
  if (!(await upsertRow("b24_user_bases", row, "map_id,user_id,base_coord"))) return respond(ctx, mode, "Base save failed. I could not reach Supabase.");
  return respond(ctx, mode, `Saved ${escapeHtml(location.coord)} to your ${location.galaxy} base list${note ? `\nNote: ${escapeHtml(note)}` : ""}.`, { parse_mode: "HTML" });
}

async function handleMe(ctx, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !me in a group or private chat so I know who to look up.");
  const galaxy = await galaxyForContext(ctx);
  const rows = await fetchRows("b24_user_bases", {
    user_id: `eq.${telegramUserId(ctx)}`,
    status: "eq.active"
  }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" });
  const message = rows.length ? rows.map(formatUserBaseLine).join("\n") : `You have no saved bases in ${galaxy}. Add one with !mine ${galaxy}:06:10:20`;
  return respond(ctx, mode, message, { parse_mode: "HTML" });
}

async function handleSaveMe(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !save me in a group or private chat so I know who owns the note.");
  const match = text.trim().match(saveMePattern);
  if (!match) return respond(ctx, mode, "Use: !save me B24:06:10:20 defense request");

  const parsed = parseCoordinate(match[1], await galaxyForContext(ctx));
  const location = parsed ? normalizeLocation(parsed.coord) : null;
  const note = parsed?.remainder.trim() || "";
  if (!location || !note) return respond(ctx, mode, "Use: !save me B24:06:10:20 defense request");

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
  if (!(await upsertRow("b24_user_bases", row, "map_id,user_id,base_coord"))) return respond(ctx, mode, "Save failed. I could not reach Supabase.");
  return respond(ctx, mode, `Saved note for ${escapeHtml(location.coord)}:\n${escapeHtml(note)}`, { parse_mode: "HTML" });
}

async function buildAstroReport(coord) {
  const [astro, base, savedBases] = await Promise.all([
    fetchOne("b24_astros", { coord }, mapIdForCoord(coord)),
    fetchOne("b24_bases", { coord }, mapIdForCoord(coord)),
    fetchRows("b24_user_bases", {
      base_coord: `eq.${coord}`,
      status: "eq.active"
    }, { mapId: mapIdForCoord(coord), order: "owner_label.asc" })
  ]);

  if (!astro && !base && !savedBases.length) return `No intel found for ${escapeHtml(coord)} yet.`;

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
  if (savedBases.length) {
    lines.push("Saved by:");
    savedBases.forEach((saved) => {
      const note = saved.note ? ` - ${escapeHtml(saved.note)}` : "";
      lines.push(`${escapeHtml(saved.owner_label || "Unknown")}${note}`);
    });
  }
  return lines.join("\n");
}

async function buildSystemReport(systemCoord) {
  const [rows, savedBases] = await Promise.all([
    fetchRows("b24_astros", {
      system_id: `eq.${systemCoord}`
    }, { mapId: mapIdForCoord(systemCoord), order: "coord.asc" }),
    fetchRows("b24_user_bases", {
      system_id: `eq.${systemCoord}`,
      status: "eq.active"
    }, { mapId: mapIdForCoord(systemCoord), order: "base_coord.asc" })
  ]);

  if (!rows.length && !savedBases.length) return `No astros found for ${escapeHtml(systemCoord)} yet.`;

  const savedByCoord = new Map();
  savedBases.forEach((saved) => {
    if (!savedByCoord.has(saved.base_coord)) savedByCoord.set(saved.base_coord, []);
    savedByCoord.get(saved.base_coord).push(saved);
  });

  const lines = [`<b>${escapeHtml(systemCoord)}</b>`, `${rows.length} known astros`];
  rows.forEach((astro) => {
    const attrs = Array.isArray(astro.attributes) ? astro.attributes.join("/") : "";
    const saved = savedByCoord.get(astro.coord) || [];
    const savedText = saved.length ? ` - saved by ${escapeHtml(saved.map((base) => base.owner_label || "Unknown").join(", "))}` : "";
    const base = astro.has_base || saved.length ? " base" : "";
    lines.push(`${escapeHtml(astro.coord)} - ${escapeHtml(astro.terrain || "?")} ${escapeHtml(astro.astro_type || "?")}${attrs ? ` - ${escapeHtml(attrs)}` : ""}${base}${savedText}`);
  });

  const listed = new Set(rows.map((astro) => astro.coord));
  savedBases
    .filter((saved) => !listed.has(saved.base_coord))
    .forEach((saved) => {
      const note = saved.note ? ` - ${escapeHtml(saved.note)}` : "";
      lines.push(`${escapeHtml(saved.base_coord)} - saved by ${escapeHtml(saved.owner_label || "Unknown")}${note}`);
    });

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

function parseLookupCommand(text, fallbackGalaxy = defaultGalaxy) {
  const trimmed = String(text || "").trim();
  const mode = trimmed[0];
  if (mode !== "!" && mode !== "$") return null;
  if (/^[!$]help\b/i.test(trimmed)) return null;

  const parsed = parseCoordinate(trimmed.slice(1), fallbackGalaxy);
  if (!parsed) return null;
  return { mode, ...parsed };
}

function parseTimedCoordinate(value, fallbackGalaxy) {
  const parsed = parseCoordinate(value, fallbackGalaxy);
  if (!parsed) return null;
  const remainder = parsed.remainder.trim();
  const minuteMatch = remainder.match(/^:?\s*(\d{1,4})(?:\s+(.+))?$/);
  if (!minuteMatch) return { ...parsed, minutes: NaN, note: "" };
  return {
    ...parsed,
    minutes: Number(minuteMatch[1]),
    note: (minuteMatch[2] || "").trim()
  };
}

function parseCoordinate(value, fallbackGalaxy) {
  const raw = String(value || "").trim().toUpperCase();
  const galaxy = normalizeGalaxy((raw.match(/B\d{2}/) || [])[0]) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  let working = raw.replace(/^!|\$/g, "").trim();

  if (working.startsWith(galaxy)) working = working.slice(galaxy.length).trim();
  else if (working.startsWith(galaxy.slice(1))) working = working.slice(2).trim();

  const colon = working.match(/^:?\s*(\d{1,2})(?::|\s+)(\d{1,2})(?::|\s+)?(\d{1,2})?([\s\S]*)$/);
  if (colon) {
    const nums = [colon[1], colon[2], colon[3]].filter(Boolean).map(Number);
    if (nums.every(validCoordPart) && (nums.length === 2 || nums.length === 3)) {
      return coordinateResult(galaxy, nums, colon[4] || "");
    }
  }

  const compact = working.replace(/\D/g, "");
  if (compact.length >= 4) {
    const withoutGalaxy = compact.startsWith(galaxy.slice(1)) ? compact.slice(2) : compact;
    if (withoutGalaxy.length === 4 || withoutGalaxy.length >= 6) {
      const nums = [withoutGalaxy.slice(0, 2), withoutGalaxy.slice(2, 4)];
      if (withoutGalaxy.length >= 6) nums.push(withoutGalaxy.slice(4, 6));
      const rest = working.slice(working.indexOf(withoutGalaxy) + withoutGalaxy.length);
      const parsedNums = nums.map(Number);
      if (parsedNums.every(validCoordPart)) return coordinateResult(galaxy, parsedNums, rest || "");
    }
  }

  return null;
}

function coordinateResult(galaxy, nums, remainder) {
  const padded = nums.map((num) => String(num).padStart(2, "0"));
  const coord = [galaxy, ...padded].join(":");
  return {
    kind: nums.length === 3 ? "astro" : "system",
    coord,
    galaxy,
    remainder: remainder || ""
  };
}

function validCoordPart(value) {
  return Number.isInteger(value) && value >= 0 && value <= 99;
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("VisionBot is running\n");
}).listen(port, "0.0.0.0", () => {
  console.log(`Health server listening on ${port}`);
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
