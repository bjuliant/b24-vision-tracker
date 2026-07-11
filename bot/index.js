import { Telegraf, Markup } from "telegraf";
import http from "node:http";

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const defaultGalaxy = normalizeGalaxy(process.env.DEFAULT_GALAXY || process.env.GALAXY || "B24");
const port = Number(process.env.PORT || 10000);
const approvedChatIds = parseCsv(process.env.APPROVED_CHAT_IDS);

if (!token) throw new Error("BOT_TOKEN is required");
if (!webAppUrl) throw new Error("WEB_APP_URL is required");
if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
if (!supabaseKey) throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required");

const bot = new Telegraf(token);
const galaxyPattern = /B\d{2}/i;
const claimPattern = /^[!$]claim\s+(.+)$/i;
const attackedPattern = /^[!$](attacked|sos)\s+(.+)$/i;
const minePattern = /^[!$]mine\s+(.+)$/i;
const saveMePattern = /^[!$]save\s+me\s+(.+)$/i;
const staleIntelMs = 24 * 60 * 60 * 1000;

bot.start(sendMapButton);
bot.command("map", sendMapButton);
bot.command("help", (ctx) => ctx.reply(helpText(ctx.message?.text || ""), { parse_mode: "HTML" }));
bot.command("board", (ctx) => {
  if (!chatApproved(ctx)) return ctx.reply("This chat is not approved for VisionBot operations.");
  return handleBoard(ctx, ctx.message?.text || "/board", "$");
});

bot.on("text", handleText);
bot.on("channel_post", handleText);
bot.action(/^op:(join|ready|sent|leave|status|close):(.+)$/, handleOperationButton);

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
  const text = normalizeIncomingText(ctx.message?.text || ctx.channelPost?.text || "");
  const lower = text.trim().toLowerCase();
  const mode = deliveryMode(text);

  if (isProtectedOperationalCommand(lower) && !chatApproved(ctx)) {
    return respond(ctx, mode, "This chat is not approved for VisionBot operations.");
  }

  if (isCommand(lower, "help")) return respond(ctx, mode, helpText(text), { parse_mode: "HTML" });
  if (isExactCommand(lower, "wakeup")) return handleWakeup(ctx, mode);
  if (isCommand(lower, "g")) return handleUserGalaxy(ctx, text, mode);
  if (isCommand(lower, "setgalaxy")) return handleChatGalaxy(ctx, text, mode);
  if (isCommand(lower, "claim")) return handleClaim(ctx, text, mode);
  if (isCommand(lower, "scout")) return handleScout(ctx, text, mode);
  if (isCommand(lower, "attacked") || isCommand(lower, "sos")) return handleAttacked(ctx, text, mode);
  if (isCommand(lower, "intel")) return handleIntel(ctx, text, mode);
  if (isCommand(lower, "stale")) return handleStale(ctx, text, mode);
  if (isCommand(lower, "score")) return handleScore(ctx, text, mode);
  if (isCommand(lower, "bases")) return handleBases(ctx, text, mode);
  if (isCommand(lower, "op")) return handleOp(ctx, text, mode);
  if (isCommand(lower, "join") || isCommand(lower, "respond")) return handleOperationMember(ctx, text, mode, "joined");
  if (isCommand(lower, "ready")) return handleOperationMember(ctx, text, mode, "ready");
  if (isCommand(lower, "sent")) return handleOperationMember(ctx, text, mode, "sent");
  if (isCommand(lower, "leave")) return handleOperationMember(ctx, text, mode, "withdrawn");
  if (isCommand(lower, "standdown") || isCommand(lower, "cancelop")) return handleCloseOperation(ctx, text, mode);
  if (isCommand(lower, "board") || isExactCommand(lower, "defense")) return handleBoard(ctx, text, mode);
  if (isExactCommand(lower, "next") || isExactCommand(lower, "myops")) return handleNext(ctx, mode);
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

async function handleOperationButton(ctx) {
  const [, action, operationId] = ctx.match || [];
  const operation = await findOperationById(operationId);
  if (!operation) {
    await ctx.answerCbQuery("That operation is no longer active.");
    return;
  }

  if (action === "status") {
    await ctx.answerCbQuery("Refreshing status.");
    await refreshOperationMessage(ctx, operation);
    return;
  }

  if (action === "close") {
    if (!(await canCloseOperation(ctx, operation))) {
      await ctx.answerCbQuery("Only the commander or a group admin can close this.");
      return;
    }
    await updateRows("b24_operations", {
      status: "closed",
      updated_at: new Date().toISOString()
    }, {
      map_id: `eq.${operation.map_id}`,
      operation_id: `eq.${operation.operation_id}`
    });
    await ctx.answerCbQuery(`${operation.short_id} closed.`);
    await refreshOperationMessage(ctx, { ...operation, status: "closed" });
    return;
  }

  const state = action === "leave" ? "withdrawn" : action === "join" ? "joined" : action;
  await upsertOperationMember(ctx, operation, state, "");
  await ctx.answerCbQuery(`${operation.short_id}: ${state}`);
  await refreshOperationMessage(ctx, operation);
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
    scout: [
      "<b>Scout Help</b>",
      "",
      "<code>!scout [system-or-astro] [minutes] [note]</code>",
      "<code>$scout [system-or-astro] [minutes] [note]</code>",
      "Create a scout request operation. If minutes are omitted, it stays active for 4 hours.",
      "",
      "Examples:",
      "<code>$scout B24:44:76 120 need eyes before wave 2</code>",
      "<code>!scout B24:44:76:10 portal check</code>"
    ],
    intel: [
      "<b>Intel Lookup Help</b>",
      "",
      "<code>![coord]</code> - DM intel to you",
      "<code>$[coord]</code> - post intel in the current chat",
      "<code>!intel [coord]</code> - DM intel to you",
      "<code>$intel [coord]</code> - post intel in the current chat",
      "",
      "Examples:",
      "<code>!B24:34:06:10</code>",
      "<code>!intel B24:34:06:10</code>",
      "<code>$B23:44:76:20</code>",
      "<code>!B24 02 76 10</code>",
      "<code>!24 02 76 10</code>",
      "<code>!24027610</code>",
      "<code>!B24:02:76</code> - list all known astros in a system",
      "",
      "Player base lists moved to <code>!bases [name]</code>."
    ],
    stale: [
      "<b>Stale Intel Help</b>",
      "",
      "<code>!stale</code> - DM stale intel in your current galaxy",
      "<code>$stale B24:44</code> - post stale intel for a sector",
      "<code>!stale B24:44:76</code> - stale intel for a system",
      "<code>!stale B24:44:76:10</code> - age for one astro",
      "",
      "Intel older than 24 hours is marked stale."
    ],
    score: [
      "<b>Target Score Help</b>",
      "",
      "<code>!score</code> - DM top scored known bases in your galaxy",
      "<code>$score B24:44</code> - post top scored targets in a sector",
      "<code>!score B24:44:76</code> - score a system",
      "<code>!score B24:44:76:10</code> - score one astro",
      "",
      "Score is a lightweight priority hint: known base + owner intel + astro attributes. It is not a battle calculator."
    ],
    incoming: [
      "<b>Incoming Help</b>",
      "",
      "<code>!sos [your base] [attacker coord] [eta minutes] [note]</code>",
      "<code>$sos [your base] [attacker coord] [eta minutes] [note]</code>",
      "Report hostile incoming against a defended base and sort it by ETA. Use <code>!</code> privately or <code>$</code> publicly.",
      "",
      "Examples:",
      "<code>$sos B24:45:10:30 B24:34:06:10 25 incoming dread</code>",
      "<code>!attacked B24:45:10:30 B24:34:06:10 25 incoming dread</code>",
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
      "",
      "Example:",
      "<code>!save me B24:06:10:20 needs defense</code>",
      "<code>$bases storebo</code>"
    ],
    board: [
      "<b>Board Help</b>",
      "",
      "<code>$board</code> - public attack and defense board",
      "<code>$board attack</code> - public active claims",
      "<code>$board defense</code> - public active incoming/SOS reports",
      "<code>$board scout</code> - public scout requests",
      "<code>$op status A-123</code> - public operation status",
      "<code>!next</code> - DM your personal dashboard",
      "",
      "Slash fallback: <code>/board</code> posts publicly even when Telegram privacy hides $ commands."
    ],
    op: [
      "<b>Operation Help</b>",
      "",
      "<code>$claim [target] [minutes] [note]</code> creates an attack operation.",
      "<code>$sos [your base] [attacker] [minutes] [note]</code> creates a defense operation.",
      "<code>!join A-123 [role/note]</code> joins privately.",
      "<code>!respond A-123 [role/note]</code> joins a defense.",
      "<code>!ready A-123</code> marks you ready.",
      "<code>!sent A-123 [fleet row/note]</code> confirms launch.",
      "<code>!leave A-123 [reason]</code> withdraws.",
      "<code>$op status A-123</code> posts status.",
      "<code>$standdown A-123 [reason]</code> closes it."
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
    "<code>!intel</code>/<code>$intel</code> - coordinate intel lookup",
    "<code>!stale</code>/<code>$stale</code> - list stale intel",
    "<code>!score</code>/<code>$score</code> - score known targets",
    "<code>!claim</code>/<code>$claim</code> - claim an attack target",
    "<code>!scout</code>/<code>$scout</code> - request scouting",
    "<code>!join</code>/<code>!respond</code>/<code>!ready</code>/<code>!sent</code>/<code>!leave</code> - operation participation",
    "<code>!next</code>/<code>!myops</code> - personal dashboard",
    "<code>$board</code> or <code>/board</code> - public attack/defense board",
    "<code>!targets</code>/<code>$targets</code> - old alias for your claims",
    "<code>!claimed</code>/<code>$claimed</code> - old alias for attack board",
    "<code>!sos</code>/<code>$sos</code> - report incoming against your base",
    "<code>!attacked</code>/<code>$attacked</code> - alias for sos",
    "<code>!incoming</code>/<code>$incoming</code> - list hostile incoming",
    "<code>!bases</code>/<code>$bases</code> - list a player's saved bases",
    "<code>!mine</code>/<code>$mine</code> - save one of your bases",
    "<code>!me</code>/<code>$me</code> - show your saved bases",
    "<code>!save me</code>/<code>$save me</code> - save a note on your base",
    "",
    "Details: <code>!help claim</code>, <code>!help scout</code>, <code>!help op</code>, <code>!help intel</code>, <code>!help stale</code>, <code>!help score</code>, <code>!help incoming</code>, <code>!help bases</code>, <code>!help board</code>, <code>!help galaxy</code>"
  ].join("\n");
}

function deliveryMode(text) {
  const first = String(text || "").trim()[0];
  return first === "$" ? "$" : "!";
}

function normalizeIncomingText(text) {
  return String(text || "")
    .trim()
    .replace(/^@\w+\s+/, "")
    .replace(/\s+@\w+$/, "")
    .trim();
}

function isCommand(lowerText, command) {
  const lower = String(lowerText || "").trim();
  return lower === `!${command}` || lower === `$${command}` || lower.startsWith(`!${command} `) || lower.startsWith(`$${command} `);
}

function isExactCommand(lowerText, command) {
  const lower = String(lowerText || "").trim();
  return lower === `!${command}` || lower === `$${command}`;
}

function isProtectedOperationalCommand(lowerText) {
  return [
    "claim",
    "scout",
    "attacked",
    "sos",
    "op",
    "join",
    "respond",
    "ready",
    "sent",
    "leave",
    "standdown",
    "cancelop",
    "board",
    "defense",
    "next",
    "myops",
    "incoming",
    "targets",
    "claimed",
    "mine",
    "me",
    "save me"
  ].some((command) => isCommand(lowerText, command) || isExactCommand(lowerText, command));
}

function chatApproved(ctx) {
  if (!approvedChatIds.length) return true;
  if (ctx.chat?.type === "private") return true;
  const id = ctx.chat?.id ? String(ctx.chat.id) : "";
  return id ? approvedChatIds.includes(id) : false;
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
  const operation = operationRow(ctx, {
    type: "attack",
    targetCoord: target,
    arrivalAt,
    note
  });
  const claim = {
    map_id: mapIdForCoord(target),
    claim_id: randomId(),
    operation_id: operation.operation_id,
    operation_short_id: operation.short_id,
    target_coord: target,
    region_id: astroToRegion(target),
    system_id: astroToSystem(target),
    claimed_by: telegramName(ctx),
    claimed_by_user_id: telegramUserId(ctx),
    chat_id: chatScopeId(ctx),
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

  if (!(await insertRow("b24_operations", operation))) return respond(ctx, mode, "Claim failed. I could not create the operation.");
  if (!(await insertRow("b24_claims", claim))) return respond(ctx, mode, "Claim failed. I could not reach Supabase.");
  await upsertOperationMember(ctx, operation, "joined", "commander");
  await scheduleOperationArrivalReminders(operation);
  const members = await fetchOperationMembers(operation);
  const message = await respond(ctx, mode, await formatOperationStatus(operation, members), operationMessageOptions(operation));
  await saveOperationMessage(operation, message);
  return message;
}

async function handleScout(ctx, text, mode) {
  const body = text.replace(/^[!$]scout\b/i, "").trim();
  const parsed = parseCoordinate(body, await galaxyForContext(ctx));
  if (!parsed) return respond(ctx, mode, "Use: $scout B24:44:76 120 optional note");

  const timed = parseTimedRemainder(parsed.remainder);
  const minutes = Number.isFinite(timed.minutes) ? timed.minutes : 240;
  if (!validMinutes(minutes)) return respond(ctx, mode, "Use minutes from now, 1 to 1440.");

  const now = new Date();
  const operation = operationRow(ctx, {
    type: "scout",
    targetCoord: parsed.coord,
    arrivalAt: new Date(now.getTime() + minutes * 60 * 1000),
    note: timed.note || parsed.remainder.trim()
  });

  if (!(await insertRow("b24_operations", operation))) return respond(ctx, mode, "Scout request failed. I could not create the operation.");
  await upsertOperationMember(ctx, operation, "joined", "scout request");
  await scheduleOperationArrivalReminders(operation);
  const members = await fetchOperationMembers(operation);
  const message = await respond(ctx, mode, await formatOperationStatus(operation, members), operationMessageOptions(operation));
  await saveOperationMessage(operation, message);
  return message;
}

async function handleTargets(ctx, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !targets in a group or private chat so I know who to look up.");
  const galaxy = await galaxyForContext(ctx);
  const claims = await fetchRows("b24_claims", {
    claimed_by_user_id: `eq.${telegramUserId(ctx)}`,
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  const message = claims.length ? claims.map(formatClaimLine).join("\n") : `You have no active claimed targets in ${galaxy}.`;
  return respond(ctx, mode, message, { parse_mode: "HTML" });
}

async function handleClaimed(ctx, mode) {
  const galaxy = await galaxyForContext(ctx);
  const claims = await fetchActiveClaims(galaxy, chatScopeId(ctx));
  return respond(ctx, mode, claims.length ? claims.map(formatClaimLine).join("\n") : `No active attacks claimed in ${galaxy}.`, { parse_mode: "HTML" });
}

async function handleAttacked(ctx, text, mode) {
  const match = text.trim().match(attackedPattern);
  if (!match) return respond(ctx, mode, "Use: $sos B24:45:10:30 B24:34:06:10 25 optional note");

  const parsed = parseIncomingReport(match[2], await galaxyForContext(ctx));
  if (!parsed?.attackerCoord) return respond(ctx, mode, "Use: $sos [your base] [attacker coord] [eta minutes] [note]");

  const defended = parsed.defendedCoord;
  const attacker = parsed.attackerCoord;
  const minutes = parsed.minutes;
  const note = parsed.note;
  if (!validMinutes(minutes)) return respond(ctx, mode, "Use ETA minutes from now, 1 to 1440.");

  const now = new Date();
  const arrivalAt = new Date(now.getTime() + minutes * 60 * 1000);
  const operation = operationRow(ctx, {
    type: "defense",
    targetCoord: defended,
    defendedCoord: defended,
    hostileOrigin: attacker,
    arrivalAt,
    note
  });
  const incoming = {
    map_id: mapIdForCoord(defended || attacker),
    incoming_id: randomId(),
    operation_id: operation.operation_id,
    operation_short_id: operation.short_id,
    defended_coord: defended || null,
    defended_region_id: defended ? astroToRegion(defended) : null,
    defended_system_id: defended ? astroToSystem(defended) : null,
    attacker_coord: attacker,
    region_id: astroToRegion(attacker),
    system_id: astroToSystem(attacker),
    eta_minutes: minutes,
    arrival_at: arrivalAt.toISOString(),
    reported_by: telegramName(ctx),
    reported_by_user_id: telegramUserId(ctx),
    chat_id: chatScopeId(ctx),
    hostile_fleet: "",
    severity: "",
    verified: false,
    note,
    status: "active",
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  if (!(await insertRow("b24_operations", operation))) return respond(ctx, mode, "Incoming report failed. I could not create the operation.");
  if (!(await insertRow("b24_incoming", incoming))) return respond(ctx, mode, "Incoming report failed. I could not reach Supabase.");
  await upsertOperationMember(ctx, operation, "joined", "victim/reporter");
  await scheduleOperationArrivalReminders(operation);
  const members = await fetchOperationMembers(operation);
  const message = await respond(ctx, mode, await formatOperationStatus(operation, members), operationMessageOptions(operation));
  await saveOperationMessage(operation, message);
  return message;
}

async function handleIncoming(ctx, mode) {
  const galaxy = await galaxyForContext(ctx);
  const incoming = await fetchActiveIncoming(galaxy, chatScopeId(ctx));
  return respond(ctx, mode, incoming.length ? incoming.map(formatIncomingLine).join("\n") : `No active hostile incoming reports in ${galaxy}.`, { parse_mode: "HTML" });
}

async function handleIntel(ctx, text, mode) {
  const query = text.replace(/^[!$]intel\s+/i, "").trim();
  const parsed = parseCoordinate(query, await galaxyForContext(ctx));
  if (!parsed) return respond(ctx, mode, "Use: !intel B24:34:06:10 or !bases playername");

  const report = parsed.kind === "system"
    ? await buildSystemReport(parsed.coord)
    : await buildAstroReport(parsed.coord);
  return respond(ctx, mode, report, { parse_mode: "HTML" });
}

async function handleStale(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const query = text.replace(/^[!$]stale\b/i, "").trim();
  const report = await buildStaleReport(query, galaxy);
  return respond(ctx, mode, report, { parse_mode: "HTML" });
}

async function handleScore(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const query = text.replace(/^[!$]score\b/i, "").trim();
  const report = await buildScoreReport(query, galaxy);
  return respond(ctx, mode, report, { parse_mode: "HTML" });
}

async function handleBases(ctx, text, mode) {
  const query = text.replace(/^[!$]bases\s+/i, "").trim().replace(/^@/, "");
  if (!query) return respond(ctx, mode, "Use: !bases playername");

  const galaxy = await galaxyForContext(ctx);
  const [savedRows, importedRows] = await Promise.all([
    fetchRows("b24_user_bases", {
      status: "eq.active"
    }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" }),
    fetchRows("b24_bases", {}, { mapId: galaxyToMapId(galaxy), order: "coord.asc" })
  ]);

  const needle = searchText(query);
  const savedMatches = savedRows.filter((row) => {
    return searchText(row.owner_label).includes(needle);
  });
  const importedMatches = importedRows.filter((row) => {
    return searchText(`${row.guild || ""} ${row.label || ""}`).includes(needle);
  });

  if (!savedMatches.length && !importedMatches.length) {
    return respond(ctx, mode, `No saved or imported bases found for ${escapeHtml(query)} in ${galaxy}.`, { parse_mode: "HTML" });
  }

  const owners = [...new Set([
    ...savedMatches.map((row) => row.owner_label || query),
    ...importedMatches.map((row) => [row.guild, row.label].filter(Boolean).join(" ") || query)
  ])].join(", ");
  const lines = [
    `<b>${escapeHtml(owners)}</b>`,
    `${importedMatches.length} imported / ${savedMatches.length} saved bases in ${galaxy}`
  ];
  if (importedMatches.length) {
    lines.push("", "<b>Imported Intel</b>");
    importedMatches.forEach((row) => lines.push(formatImportedBaseLine(row)));
  }
  if (savedMatches.length) {
    lines.push("", "<b>Saved By Users</b>");
    savedMatches.forEach((row) => lines.push(formatUserBaseLine(row)));
  }
  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleBoard(ctx, text, mode) {
  const kind = boardKind(text);
  const galaxy = await galaxyForContext(ctx);
  const operations = await fetchActiveOperations(galaxy, chatScopeId(ctx), kind);
  const membersByOperation = await fetchMembersByOperation(operations);
  const attacks = operations.filter((operation) => operation.type === "attack");
  const defenses = operations.filter((operation) => operation.type === "defense");
  const scouts = operations.filter((operation) => operation.type === "scout");

  const lines = [`<b>${galaxy} Board</b>`];
  if (kind !== "defense" && kind !== "scout") {
    lines.push("", `<b>Attacks</b> (${attacks.length})`);
    lines.push(...(attacks.length ? attacks.map((operation) => formatOperationLine(operation, membersByOperation.get(operation.operation_id) || [])) : ["No active attack operations."]));
  }
  if (kind !== "attack" && kind !== "scout") {
    lines.push("", `<b>Defense</b> (${defenses.length})`);
    lines.push(...(defenses.length ? defenses.map((operation) => formatOperationLine(operation, membersByOperation.get(operation.operation_id) || [])) : ["No active defense operations."]));
  }
  if (kind !== "attack" && kind !== "defense") {
    lines.push("", `<b>Scouts</b> (${scouts.length})`);
    lines.push(...(scouts.length ? scouts.map((operation) => formatOperationLine(operation, membersByOperation.get(operation.operation_id) || [])) : ["No active scout operations."]));
  }

  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleNext(ctx, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !next in a group or private chat so I know who to look up.");
  const galaxy = await galaxyForContext(ctx);
  const [memberships, bases] = await Promise.all([
    fetchRows("b24_operation_members", {
      user_id: `eq.${telegramUserId(ctx)}`
    }, { mapId: galaxyToMapId(galaxy), order: "updated_at.asc" }),
    fetchRows("b24_user_bases", {
      user_id: `eq.${telegramUserId(ctx)}`,
      status: "eq.active"
    }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" })
  ]);
  const operations = await fetchOperationsForMemberships(galaxy, memberships);
  const actionOps = operations.filter((operation) => operation.status === "active" && operation.chat_id === chatScopeId(ctx));

  const lines = [
    `<b>${galaxy} Next Actions</b>`,
    "",
    `<b>Your Operations</b> (${actionOps.length})`,
    ...(actionOps.length ? actionOps.slice(0, 8).map((operation) => formatOperationLine(operation)) : ["No active operations need you."]),
    "",
    `<b>Your Saved Bases</b> (${bases.length})`
  ];

  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleOp(ctx, text, mode) {
  const parts = String(text || "").trim().split(/\s+/);
  const action = (parts[1] || "").toLowerCase();
  if (action === "status") return handleOperationStatus(ctx, parts.slice(2).join(" "), mode);
  if (action === "close" || action === "cancel" || action === "standdown") return handleCloseOperation(ctx, `${mode}standdown ${parts.slice(2).join(" ")}`, mode);
  return respond(ctx, mode, "Use: $op status A-123 or $op close A-123 reason");
}

async function handleOperationMember(ctx, text, mode, state) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use this from a user account so I know who is joining.");
  const parsed = parseOperationAction(text);
  if (!parsed.shortId) return respond(ctx, mode, `Use: !${state === "joined" ? "join" : state} A-123 optional note`);

  const operation = await findOperation(ctx, parsed.shortId);
  if (!operation) return respond(ctx, mode, `No active operation found for ${escapeHtml(parsed.shortId)} in this chat.`, { parse_mode: "HTML" });

  const travel = parseTravelNote(parsed.note);
  await upsertOperationMember(ctx, operation, state, travel.note, travel.minutes);
  if ((state === "joined" || state === "ready") && travel.minutes) await scheduleLaunchReminders(ctx, operation, travel.minutes);
  const label = state === "sent" ? "marked sent for" : state === "withdrawn" ? "left" : `${state} for`;
  return respond(ctx, mode, `${escapeHtml(telegramName(ctx))} ${label} ${escapeHtml(operation.short_id)}.`, { parse_mode: "HTML" });
}

async function handleOperationStatus(ctx, value, mode) {
  const operation = await findOperation(ctx, value);
  if (!operation) return respond(ctx, mode, `No active operation found for ${escapeHtml(value || "that ID")} in this chat.`, { parse_mode: "HTML" });
  const members = await fetchOperationMembers(operation);
  return respond(ctx, mode, await formatOperationStatus(operation, members), operationMessageOptions(operation));
}

async function handleCloseOperation(ctx, text, mode) {
  const parsed = parseOperationAction(text);
  if (!parsed.shortId) return respond(ctx, mode, "Use: $standdown A-123 optional reason");
  const operation = await findOperation(ctx, parsed.shortId);
  if (!operation) return respond(ctx, mode, `No active operation found for ${escapeHtml(parsed.shortId)} in this chat.`, { parse_mode: "HTML" });
  if (!(await canCloseOperation(ctx, operation))) return respond(ctx, mode, "Only the operation commander or a group admin can close that operation.");

  const ok = await updateRows("b24_operations", {
    status: "closed",
    note: parsed.note ? `${operation.note || ""}${operation.note ? " | " : ""}Closed: ${parsed.note}` : operation.note,
    updated_at: new Date().toISOString()
  }, {
    map_id: `eq.${operation.map_id}`,
    operation_id: `eq.${operation.operation_id}`
  });
  if (!ok) return respond(ctx, mode, "Could not close that operation.");
  return respond(ctx, mode, `${escapeHtml(operation.short_id)} closed${parsed.note ? `: ${escapeHtml(parsed.note)}` : ""}`, { parse_mode: "HTML" });
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

async function buildStaleReport(query, fallbackGalaxy) {
  const parsed = query ? parseCoordinate(query, fallbackGalaxy) : null;
  const region = query && !parsed ? parseRegion(query, fallbackGalaxy) : "";
  const galaxy = parsed?.galaxy || galaxyFromCoord(region) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  const mapId = galaxyToMapId(galaxy);
  const cutoff = new Date(Date.now() - staleIntelMs).toISOString();

  if (parsed?.kind === "astro") return buildAstroAgeReport(parsed.coord);

  const filters = { updated_at: `lt.${cutoff}` };
  let title = galaxy;
  if (parsed?.kind === "system") {
    filters.system_id = `eq.${parsed.coord}`;
    title = parsed.coord;
  } else if (region) {
    filters.region_id = `eq.${region}`;
    title = region;
  }

  const [astros, bases] = await Promise.all([
    fetchRows("b24_astros", filters, { mapId, order: "updated_at.asc", limit: 12 }),
    fetchRows("b24_bases", filters, { mapId, order: "updated_at.asc", limit: 12 })
  ]);

  if (!astros.length && !bases.length) return `No stale intel older than ${formatAgeWindow(staleIntelMs)} found for ${escapeHtml(title)}.`;

  const lines = [`<b>Stale Intel ${escapeHtml(title)}</b>`];
  if (astros.length) {
    lines.push("", "<b>Astros</b>");
    astros.forEach((astro) => lines.push(staleAstroLine(astro)));
  }
  if (bases.length) {
    lines.push("", "<b>Bases</b>");
    bases.forEach((base) => lines.push(staleBaseLine(base)));
  }
  return lines.join("\n");
}

async function buildScoreReport(query, fallbackGalaxy) {
  const parsed = query ? parseCoordinate(query, fallbackGalaxy) : null;
  const region = query && !parsed ? parseRegion(query, fallbackGalaxy) : "";
  const galaxy = parsed?.galaxy || galaxyFromCoord(region) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  const mapId = galaxyToMapId(galaxy);

  if (parsed?.kind === "astro") {
    const [astro, base] = await Promise.all([
      fetchOne("b24_astros", { coord: parsed.coord }, mapId),
      fetchOne("b24_bases", { coord: parsed.coord }, mapId)
    ]);
    if (!astro && !base) return `No intel found for ${escapeHtml(parsed.coord)} yet.`;
    return [`<b>Target Score ${escapeHtml(parsed.coord)}</b>`, scoreLine(astro || { coord: parsed.coord, attributes: [] }, base)].join("\n");
  }

  const filters = {};
  let title = galaxy;
  if (parsed?.kind === "system") {
    filters.system_id = `eq.${parsed.coord}`;
    title = parsed.coord;
  } else if (region) {
    filters.region_id = `eq.${region}`;
    title = region;
  } else {
    filters.has_base = "eq.true";
  }

  const astros = await fetchRows("b24_astros", filters, { mapId, order: "coord.asc", limit: 100 });
  if (!astros.length) return `No scoreable astro intel found for ${escapeHtml(title)} yet.`;

  const scored = await Promise.all(astros.map(async (astro) => {
    const base = await fetchOne("b24_bases", { coord: astro.coord }, mapId);
    return { astro, base, score: targetScore(astro, base) };
  }));

  scored.sort((a, b) => b.score - a.score || a.astro.coord.localeCompare(b.astro.coord));
  const lines = [`<b>Target Scores ${escapeHtml(title)}</b>`, "Known base + owner intel + astro attributes. Not combat math."];
  scored.slice(0, 15).forEach(({ astro, base }) => lines.push(scoreLine(astro, base)));
  return lines.join("\n");
}

function scoreLine(astro, base) {
  const score = targetScore(astro, base);
  const attrs = attributeTotal(astro);
  const owner = base ? ` - ${escapeHtml([base.guild, base.label].filter(Boolean).join(" ") || "known base")}` : "";
  const baseText = astro?.has_base || base ? " base" : "";
  return `${escapeHtml(astro.coord)} - ${score} pts - ${escapeHtml(astro.terrain || "?")} ${escapeHtml(astro.astro_type || "?")} attr ${attrs}${baseText}${owner}`;
}

function targetScore(astro, base) {
  return attributeTotal(astro) + (astro?.has_base || base ? 50 : 0) + (base?.guild || base?.label ? 20 : 0);
}

function attributeTotal(astro) {
  return Array.isArray(astro?.attributes)
    ? astro.attributes.map(Number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0)
    : 0;
}

async function buildAstroAgeReport(coord) {
  const [astro, base] = await Promise.all([
    fetchOne("b24_astros", { coord }, mapIdForCoord(coord)),
    fetchOne("b24_bases", { coord }, mapIdForCoord(coord))
  ]);
  if (!astro && !base) return `No intel found for ${escapeHtml(coord)} yet.`;
  const lines = [`<b>Intel Age ${escapeHtml(coord)}</b>`];
  if (astro) lines.push(staleAstroLine(astro));
  if (base) lines.push(staleBaseLine(base));
  return lines.join("\n");
}

function staleAstroLine(astro) {
  const age = intelAgeLabel(astro.updated_at);
  return `${escapeHtml(astro.coord)} - ${escapeHtml(astro.terrain || "?")} ${escapeHtml(astro.astro_type || "?")} - ${age}`;
}

function staleBaseLine(base) {
  const age = intelAgeLabel(base.updated_at);
  const owner = [base.guild, base.label].filter(Boolean).join(" ");
  return `${escapeHtml(base.coord)} - ${escapeHtml(owner || "Unknown base")} - ${age}`;
}

function formatImportedBaseLine(row) {
  const owner = [row.guild, row.label].filter(Boolean).join(" ") || "Unknown owner";
  const age = row.updated_at ? ` - ${intelAgeLabel(row.updated_at)}` : "";
  return `${escapeHtml(row.coord)} - ${escapeHtml(owner)}${age}`;
}

function searchText(value) {
  return String(value || "")
    .replace(/^@/, "")
    .replace(/[\[\]]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function intelAgeLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "unknown age";
  return `${formatAge(date)} old${Date.now() - date.getTime() > staleIntelMs ? " - STALE" : ""}`;
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
    order: options.order || "arrival_at.asc"
  });
  if (options.includeMap !== false) params.set("map_id", `eq.${options.mapId || galaxyToMapId(defaultGalaxy)}`);
  if (options.limit) params.set("limit", String(options.limit));
  Object.entries(filters).forEach(([key, value]) => params.set(key, value));
  return requestRows(table, params);
}

function fetchActiveClaims(galaxy, chatId = "") {
  const filters = {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  };
  if (chatId) filters.chat_id = `eq.${chatId}`;
  return fetchRows("b24_claims", filters, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
}

function fetchActiveIncoming(galaxy, chatId = "") {
  const filters = {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  };
  if (chatId) filters.chat_id = `eq.${chatId}`;
  return fetchRows("b24_incoming", filters, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
}

function fetchActiveOperations(galaxy, chatId = "", kind = "all") {
  const filters = {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  };
  if (chatId) filters.chat_id = `eq.${chatId}`;
  if (kind === "attack" || kind === "defense" || kind === "scout") filters.type = `eq.${kind}`;
  return fetchRows("b24_operations", filters, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
}

function fetchDueNotifications() {
  return fetchRows("b24_scheduled_notifications", {
    sent_at: "is.null",
    send_at: `lte.${new Date().toISOString()}`
  }, { mapId: null, includeMap: false, order: "send_at.asc", limit: 25 });
}

async function fetchMembersByOperation(operations) {
  const entries = await Promise.all(operations.map(async (operation) => {
    const members = await fetchOperationMembers(operation);
    return [operation.operation_id, members];
  }));
  return new Map(entries);
}

async function fetchOperationsForMemberships(galaxy, memberships) {
  if (!memberships.length) return [];
  const ids = new Set(memberships.map((member) => member.operation_id));
  const operations = await fetchRows("b24_operations", {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  return operations.filter((operation) => ids.has(operation.operation_id));
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

async function updateRows(table, row, filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => params.set(key, value));
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    console.error(`${table} update failed`, await response.text());
    return false;
  }
  return true;
}

function operationRow(ctx, { type, targetCoord = "", defendedCoord = "", hostileOrigin = "", arrivalAt, note = "" }) {
  const coord = targetCoord || defendedCoord || hostileOrigin;
  const operationId = randomId();
  const prefixes = { attack: "A", defense: "D", scout: "S" };
  const shortId = `${prefixes[type] || "O"}-${operationId.slice(-3).toUpperCase()}`;
  const stamp = new Date().toISOString();
  return {
    map_id: mapIdForCoord(coord),
    operation_id: operationId,
    short_id: shortId,
    chat_id: chatScopeId(ctx),
    type,
    target_coord: targetCoord || null,
    defended_coord: defendedCoord || null,
    hostile_origin: hostileOrigin || null,
    arrival_at: arrivalAt.toISOString(),
    commander_user_id: telegramUserId(ctx),
    commander_label: telegramName(ctx),
    status: "active",
    note,
    created_at: stamp,
    updated_at: stamp
  };
}

async function upsertOperationMember(ctx, operation, state, note = "", travelMinutes = null) {
  const stamp = new Date().toISOString();
  const launchAt = travelMinutes ? new Date(new Date(operation.arrival_at).getTime() - travelMinutes * 60 * 1000).toISOString() : null;
  return upsertRow("b24_operation_members", {
    map_id: operation.map_id,
    operation_id: operation.operation_id,
    user_id: telegramUserId(ctx),
    display_name: telegramName(ctx),
    role: state === "joined" && note ? note : "",
    fleet_label: "",
    fleet_value: "",
    travel_minutes: travelMinutes,
    launch_at: launchAt,
    state,
    sent_at: state === "sent" ? stamp : null,
    arrived_at: null,
    note: state !== "joined" ? note : "",
    created_at: stamp,
    updated_at: stamp
  }, "map_id,operation_id,user_id");
}

async function findOperation(ctx, shortId) {
  const galaxy = await galaxyForContext(ctx);
  return fetchOne("b24_operations", {
    short_id: normalizeShortId(shortId),
    chat_id: chatScopeId(ctx),
    status: "active"
  }, galaxyToMapId(galaxy));
}

function findOperationById(operationId) {
  return fetchOne("b24_operations", {
    operation_id: operationId
  }, null, false);
}

function fetchOperationMembers(operation) {
  return fetchRows("b24_operation_members", {
    operation_id: `eq.${operation.operation_id}`
  }, { mapId: operation.map_id, order: "updated_at.asc" });
}

async function scheduleOperationArrivalReminders(operation) {
  const arrival = new Date(operation.arrival_at);
  const label = operation.type === "defense"
    ? `${operation.short_id} hostile arrival at ${operation.defended_coord || "target"}`
    : `${operation.short_id} target arrival at ${operation.target_coord || "target"}`;
  await scheduleNotification(operation, {
    type: "arrival_10",
    sendAt: new Date(arrival.getTime() - 10 * 60 * 1000),
    message: `${label} in 10 minutes.`
  });
  await scheduleNotification(operation, {
    type: "arrival_now",
    sendAt: arrival,
    message: `${label} is due now.`
  });
}

async function scheduleLaunchReminders(ctx, operation, travelMinutes) {
  const arrival = new Date(operation.arrival_at);
  const launchAt = new Date(arrival.getTime() - travelMinutes * 60 * 1000);
  await scheduleNotification(operation, {
    type: "launch_10",
    userId: telegramUserId(ctx),
    sendAt: new Date(launchAt.getTime() - 10 * 60 * 1000),
    message: `${operation.short_id}: launch in 10 minutes for arrival at ${formatLocalSummary(arrival)}.`
  });
  await scheduleNotification(operation, {
    type: "launch_2",
    userId: telegramUserId(ctx),
    sendAt: new Date(launchAt.getTime() - 2 * 60 * 1000),
    message: `${operation.short_id}: launch in 2 minutes.`
  });
  await scheduleNotification(operation, {
    type: "launch_due",
    userId: telegramUserId(ctx),
    sendAt: launchAt,
    message: `${operation.short_id}: launch time is now.`
  });
}

function scheduleNotification(operation, { type, userId = "", sendAt, message }) {
  if (!(sendAt instanceof Date) || !Number.isFinite(sendAt.getTime()) || sendAt.getTime() <= Date.now()) return false;
  return upsertRow("b24_scheduled_notifications", {
    map_id: operation.map_id,
    notification_id: `${operation.operation_id}-${userId || operation.chat_id}-${type}`,
    operation_id: operation.operation_id,
    user_id: userId || null,
    chat_id: userId ? null : operation.chat_id,
    notification_type: type,
    send_at: sendAt.toISOString(),
    sent_at: null,
    message,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, "map_id,notification_id");
}

async function pollScheduledNotifications() {
  const due = await fetchDueNotifications();
  for (const notification of due) {
    try {
      const target = notification.user_id || notification.chat_id;
      if (!target) continue;
      await bot.telegram.sendMessage(target, notification.message || "VisionBot reminder");
      await markNotificationSent(notification);
    } catch (error) {
      console.error("notification send failed", notification.notification_id, error?.message || error);
    }
  }
}

function markNotificationSent(notification) {
  return updateRows("b24_scheduled_notifications", {
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, {
    map_id: `eq.${notification.map_id}`,
    notification_id: `eq.${notification.notification_id}`
  });
}

function startNotificationWorker() {
  setInterval(() => {
    pollScheduledNotifications().catch((error) => console.error("notification poll failed", error?.message || error));
  }, 30000);
  pollScheduledNotifications().catch((error) => console.error("notification poll failed", error?.message || error));
}

async function saveOperationMessage(operation, message) {
  if (!message?.chat?.id || !message?.message_id) return false;
  return updateRows("b24_operations", {
    message_chat_id: String(message.chat.id),
    message_id: String(message.message_id),
    updated_at: new Date().toISOString()
  }, {
    map_id: `eq.${operation.map_id}`,
    operation_id: `eq.${operation.operation_id}`
  });
}

async function refreshOperationMessage(ctx, operation) {
  const fresh = await findOperationById(operation.operation_id) || operation;
  const members = await fetchOperationMembers(fresh);
  const text = await formatOperationStatus(fresh, members);
  const options = operationMessageOptions(fresh);
  try {
    if (fresh.message_chat_id && fresh.message_id) {
      await ctx.telegram.editMessageText(fresh.message_chat_id, Number(fresh.message_id), undefined, text, options);
      return true;
    }
    await ctx.editMessageText(text, options);
    return true;
  } catch {
    await ctx.reply(text, options);
    return false;
  }
}

async function canCloseOperation(ctx, operation) {
  if (!ctx.from?.id) return false;
  if (telegramUserId(ctx) === String(operation.commander_user_id || "")) return true;
  if (!ctx.chat?.id) return false;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return member?.status === "creator" || member?.status === "administrator";
  } catch {
    return false;
  }
}

function operationMessageOptions(operation) {
  return {
    parse_mode: "HTML",
    ...operationKeyboard(operation)
  };
}

function operationKeyboard(operation) {
  const disabled = operation.status !== "active";
  if (disabled) return {};
  const target = operation.target_coord || operation.defended_coord || operation.hostile_origin || "";
  const rows = [];
  if (target) rows.push([Markup.button.webApp("Open Target", mapUrl(galaxyFromCoord(target), target))]);
  rows.push(
    [
      Markup.button.callback("Join", `op:join:${operation.operation_id}`),
      Markup.button.callback("Ready", `op:ready:${operation.operation_id}`),
      Markup.button.callback("Sent", `op:sent:${operation.operation_id}`)
    ],
    [
      Markup.button.callback("Leave", `op:leave:${operation.operation_id}`),
      Markup.button.callback("Status", `op:status:${operation.operation_id}`),
      Markup.button.callback("Stand down", `op:close:${operation.operation_id}`)
    ]
  );
  return Markup.inlineKeyboard(rows);
}

function formatClaimLine(claim) {
  const note = claim.note ? ` - ${escapeHtml(claim.note)}` : "";
  const status = claim.confirmed_sent ? "confirmed" : "planned";
  return `${escapeHtml(claim.target_coord)} - ${escapeHtml(claim.claimed_by || "Unknown")} - ${formatEta(new Date(claim.arrival_at))} - ${status}${note}`;
}

function formatOperationLine(operation, members = []) {
  const target = operation.type === "defense"
    ? `${operation.defended_coord || "?"} <= ${operation.hostile_origin || "?"}`
    : operation.target_coord || "?";
  const stateCounts = countBy(members, "state");
  const sent = stateCounts.sent || 0;
  const ready = stateCounts.ready || 0;
  const joined = members.length;
  return `${escapeHtml(operation.short_id)} ${escapeHtml(operation.type)} ${escapeHtml(target)} - ${formatEta(new Date(operation.arrival_at))} - ${joined} joined / ${ready} ready / ${sent} sent`;
}

async function operationIntelSummary(operation) {
  const coord = operation.type === "defense"
    ? operation.defended_coord || operation.hostile_origin
    : operation.target_coord;
  if (!coord) return "no target coordinate";

  if (coord.split(":").length === 3) {
    const rows = await fetchRows("b24_astros", {
      system_id: `eq.${coord}`
    }, { mapId: mapIdForCoord(coord), order: "updated_at.desc", limit: 20 });
    if (!rows.length) return `${coord}: no system intel found`;
    const updatedAt = latestTimestamp(...rows.map((row) => row.updated_at));
    const baseCount = rows.filter((row) => row.has_base).length;
    const stale = updatedAt && Date.now() - updatedAt.getTime() > staleIntelMs ? " - STALE" : "";
    return `${coord}: ${rows.length} astros, ${baseCount} marked base${baseCount === 1 ? "" : "s"} - ${formatAge(updatedAt)} old${stale}`;
  }

  const mapId = mapIdForCoord(coord);
  const [astro, base] = await Promise.all([
    fetchOne("b24_astros", { coord }, mapId),
    fetchOne("b24_bases", { coord }, mapId)
  ]);

  const updatedAt = latestTimestamp(astro?.updated_at, base?.updated_at);
  if (!astro && !base) return `${coord}: none found`;

  const parts = [coord];
  if (astro) parts.push(`${astro.terrain || "Unknown"} ${astro.astro_type || "Astro"}`);
  if (base) parts.push(`${base.guild || "Unguilded"} ${base.label || "base"}`);
  if (updatedAt) {
    const stale = Date.now() - updatedAt.getTime() > staleIntelMs ? " - STALE" : "";
    parts.push(`${formatAge(updatedAt)} old${stale}`);
  }
  return parts.join(" - ");
}

async function formatOperationStatus(operation, members) {
  const intel = await operationIntelSummary(operation);
  const lines = [
    `<b>${escapeHtml(operation.short_id)} ${escapeHtml(operation.type.toUpperCase())}</b>`,
    operation.type === "defense"
      ? `Defend: ${escapeHtml(operation.defended_coord || "?")}\nHostile: ${escapeHtml(operation.hostile_origin || "?")}`
      : `Target: ${escapeHtml(operation.target_coord || "?")}`,
    `Arrival: ${formatEta(new Date(operation.arrival_at))}`,
    `Commander: ${escapeHtml(operation.commander_label || "Unknown")}`,
    `Intel: ${escapeHtml(intel)}`
  ];
  if (operation.note) lines.push(`Note: ${escapeHtml(operation.note)}`);
  lines.push("", `<b>Members</b> (${members.length})`);
  lines.push(...(members.length ? members.map(formatOperationMemberLine) : ["No one joined yet."]));
  return lines.join("\n");
}

function formatOperationMemberLine(member) {
  const note = member.note || member.role ? ` - ${escapeHtml(member.note || member.role)}` : "";
  return `${escapeHtml(member.display_name || member.user_id)} - ${escapeHtml(member.state || "joined")}${note}`;
}

function formatIncomingLine(incoming) {
  const note = incoming.note ? ` - ${escapeHtml(incoming.note)}` : "";
  const eta = formatEta(new Date(incoming.arrival_at));
  const reporter = escapeHtml(incoming.reported_by || "Unknown");
  if (incoming.defended_coord) {
    return `${escapeHtml(incoming.defended_coord)} <= ${escapeHtml(incoming.attacker_coord)} - ETA ${eta} - reported by ${reporter}${note}`;
  }
  return `${escapeHtml(incoming.attacker_coord)} - ETA ${eta} - reported by ${reporter}${note}`;
}

function formatUserBaseLine(base) {
  const note = base.note ? ` - ${escapeHtml(base.note)}` : "";
  return `${escapeHtml(base.base_coord)}${note}`;
}

function boardKind(text) {
  const raw = String(text || "").trim().toLowerCase();
  if (/^[!$]defense\b/.test(raw)) return "defense";
  if (/\b(defense|defence|incoming|sos)\b/.test(raw)) return "defense";
  if (/\b(attack|attacks|claims|claimed)\b/.test(raw)) return "attack";
  if (/\b(scout|scouts|scouting)\b/.test(raw)) return "scout";
  return "all";
}

function parseOperationAction(text) {
  const body = String(text || "").trim().replace(/^[!$](op\s+\w+|join|ready|sent|leave|standdown|cancelop)\s*/i, "").trim();
  const match = body.match(/^([ADS]-?[A-Z0-9]{3,6})(?:\s+([\s\S]+))?$/i);
  if (!match) return { shortId: "", note: "" };
  return {
    shortId: normalizeShortId(match[1]),
    note: (match[2] || "").trim()
  };
}

function normalizeShortId(value) {
  const cleaned = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  if (/^[ADS]\d/.test(cleaned) || /^[ADS][A-Z0-9]{3,6}$/.test(cleaned)) return `${cleaned[0]}-${cleaned.slice(1)}`;
  return cleaned;
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
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

function formatAge(date) {
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatAgeWindow(ms) {
  const hours = Math.round(ms / 3600000);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function latestTimestamp(...values) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] || null;
}

function formatLocalSummary(date) {
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseTravelNote(note) {
  const raw = String(note || "").trim();
  const match = raw.match(/^(?:travel\s*)?(\d{1,4})m?(?:\s+(.+))?$/i);
  if (!match) return { minutes: null, note: raw };
  const minutes = Number(match[1]);
  return {
    minutes: validMinutes(minutes) ? minutes : null,
    note: String(match[2] || "").trim()
  };
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

function chatScopeId(ctx) {
  if (ctx.chat?.id) return String(ctx.chat.id);
  if (ctx.from?.id) return `user:${ctx.from.id}`;
  return "unknown";
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

function parseIncomingReport(value, fallbackGalaxy) {
  const first = parseCoordinate(value, fallbackGalaxy);
  if (!first || first.kind !== "astro") return null;

  const second = parseCoordinate(first.remainder, first.galaxy);
  if (second?.kind === "astro") {
    const timed = parseTimedRemainder(second.remainder);
    return {
      defendedCoord: first.coord,
      attackerCoord: second.coord,
      minutes: timed.minutes,
      note: timed.note
    };
  }

  return null;
}

function parseTimedRemainder(value) {
  const minuteMatch = String(value || "").trim().match(/^:?\s*(\d{1,4})(?:\s+(.+))?$/);
  if (!minuteMatch) return { minutes: NaN, note: "" };
  return {
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

function parseRegion(value, fallbackGalaxy) {
  const raw = String(value || "").trim().toUpperCase();
  const galaxy = normalizeGalaxy((raw.match(/B\d{2}/) || [])[0]) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  let working = raw.replace(/^!|\$/g, "").trim();
  if (working.startsWith(galaxy)) working = working.slice(galaxy.length).trim();
  else if (working.startsWith(galaxy.slice(1))) working = working.slice(2).trim();
  const match = working.match(/^:?\s*(\d{1,2})\s*$/);
  if (!match) return "";
  const region = Number(match[1]);
  return validCoordPart(region) ? `${galaxy}:${region}` : "";
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

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapUrl(galaxy, loc = "") {
  const separator = webAppUrl.includes("?") ? "&" : "?";
  const base = `${webAppUrl}${separator}gal=${encodeURIComponent(galaxy)}`;
  return loc ? `${base}&loc=${encodeURIComponent(loc)}` : base;
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
startNotificationWorker();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
