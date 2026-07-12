import { Telegraf, Markup } from "telegraf";
import http from "node:http";

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const defaultGalaxy = normalizeGalaxy(process.env.DEFAULT_GALAXY || process.env.GALAXY || "B24");
const port = Number(process.env.PORT || 10000);
const webhookBaseUrl = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const approvedChatIds = parseCsv(process.env.APPROVED_CHAT_IDS);
const accessChatIds = parseCsv(process.env.ACCESS_CHAT_IDS || process.env.COMMAND_STAFF_CHAT_IDS);
const officerUserIds = parseCsv(process.env.OFFICER_USER_IDS);

if (!token) throw new Error("BOT_TOKEN is required");
if (!webAppUrl) throw new Error("WEB_APP_URL is required");
if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
if (!supabaseKey) throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required");

const bot = new Telegraf(token);
const galaxyPattern = /B\d{2}/i;
const claimPattern = /^[!$](claim|attack)\s+(.+)$/i;
const targetClaimPattern = /^[!$](claim|take)\s+([ADS]-?[A-Z0-9]{3,8})\s+(.+)$/i;
const attackedPattern = /^[!$](attacked|sos)\s+(.+)$/i;
const minePattern = /^[!$]mine\s+(.+)$/i;
const saveMePattern = /^[!$]save\s+me\s+(.+)$/i;
const staleIntelMs = 24 * 60 * 60 * 1000;
const webhookPath = `/telegram-${token.slice(-16).replace(/[^a-zA-Z0-9_-]/g, "")}`;
const webhookUrl = webhookBaseUrl ? `${webhookBaseUrl}${webhookPath}` : "";
const botBuild = "2026-07-12.10";
const preferredCommandAliases = {
  help: ["h", "he", "hel", "help"],
  status: ["st", "status"],
  scout: ["sc", "scout"],
  astros: ["as", "ast", "astr", "astro", "astros"]
};
const canonicalCommands = [
  "help", "status", "version", "map", "wakeup", "g", "setgalaxy", "guild",
  "claim", "take", "attack", "scout", "attacked", "sos", "intel", "astros",
  "stale", "score", "bases", "op", "join", "respond", "ready", "sent", "leave",
  "standdown", "cancelop", "board", "defense", "next", "myops", "incoming",
  "targets", "claimed", "mine", "me"
];

bot.use(async (ctx, next) => {
  const text = ctx.message?.text || ctx.channelPost?.text || ctx.callbackQuery?.data || "";
  console.log(`Telegram update ${ctx.updateType || "unknown"} chat=${ctx.chat?.id || "none"} from=${ctx.from?.id || "none"} text=${String(text).slice(0, 120)}`);
  return next();
});

bot.start(sendMapButton);
bot.command("map", sendMapButton);
bot.command("help", (ctx) => handleHelp(ctx, ctx.message?.text || "/help", "$"));
bot.command("id", (ctx) => ctx.reply(chatIdReport(ctx), { parse_mode: "HTML" }));
bot.command("status", (ctx) => ctx.reply(statusReport(ctx)));
bot.command("version", (ctx) => ctx.reply(versionReport()));
bot.command("board", async (ctx) => {
  if (!chatApproved(ctx)) return ctx.reply(notApprovedMessage(ctx), { parse_mode: "HTML" });
  if (!(await userCanUseSensitiveCommands(ctx))) return ctx.reply("You do not have permission to use VisionBot operation commands.");
  return handleBoard(ctx, ctx.message?.text || "/board", "$");
});

bot.on("text", handleText);
bot.on("channel_post", handleText);
bot.action(/^op:(join|ready|sent|leave|status|close):(.+)$/, handleOperationButton);
bot.action(/^intel:(B\d{2}:\d{2}:\d{2}(?::\d{2})?)$/, handleIntelButton);
bot.action(/^bases:(.+)$/, handleBasesButton);
bot.action(/^claim4h:(B\d{2}:\d{2}:\d{2}:\d{2})$/, handleClaimButton);

async function sendMapButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    return ctx.reply("You do not have permission to open the VisionBot map.");
  }
  const galaxy = await galaxyForContext(ctx);
  return ctx.reply(
    `${galaxy} Vision Tracker`,
    Markup.inlineKeyboard([
      Markup.button.url("Open Map", mapUrl(galaxy))
    ])
  );
}

async function handleText(ctx) {
  let text = normalizeIncomingText(ctx.message?.text || ctx.channelPost?.text || "");
  const mode = deliveryMode(text);

  if (mode === "$" && isPrivateChat(ctx)) {
    return ctx.reply("Use ! commands in DM. $ commands must be sent in an approved guild group so the result can post there.");
  }

  const ambiguous = ambiguousCommandMatches(text);
  if (ambiguous.length > 1) {
    return respond(ctx, mode, `That command is ambiguous: ${ambiguous.map((command) => `<code>${escapeHtml(mode)}${escapeHtml(command)}</code>`).join(", ")}. Type a few more letters.`, { parse_mode: "HTML" });
  }

  text = canonicalizeCommandText(text);
  const lower = text.trim().toLowerCase();

  if (isProtectedOperationalCommand(lower) && !chatApproved(ctx)) {
    return respond(ctx, mode, notApprovedMessage(ctx), { parse_mode: "HTML" });
  }
  if (isSensitiveOperationalCommand(lower) && !(await userCanUseSensitiveCommands(ctx))) {
    return respond(ctx, mode, "You do not have permission to use VisionBot operation commands.");
  }

  if (isCommand(lower, "help")) return handleHelp(ctx, text, mode);
  if (isExactCommand(lower, "status")) return ctx.reply(statusReport(ctx));
  if (isExactCommand(lower, "version")) return ctx.reply(versionReport());
  if (isExactCommand(lower, "map")) return sendMapButton(ctx);
  if (isExactCommand(lower, "wakeup")) return handleWakeup(ctx, mode);
  if (isCommand(lower, "g")) return handleUserGalaxy(ctx, text, mode);
  if (isCommand(lower, "setgalaxy")) return handleChatGalaxy(ctx, text, mode);
  if (isCommand(lower, "guild")) return handleGuild(ctx, text, mode);

  if (isProtectedOperationalCommand(lower) && !isPrivateChat(ctx)) await rememberActiveChat(ctx);

  if (isCommand(lower, "claim") || isCommand(lower, "take") || isCommand(lower, "attack")) return handleClaim(ctx, text, mode);
  if (isCommand(lower, "scout")) return handleScout(ctx, text, mode);
  if (isCommand(lower, "attacked") || isCommand(lower, "sos")) return handleAttacked(ctx, text, mode);
  if (isCommand(lower, "intel")) return handleIntel(ctx, text, mode);
  if (isAstrosCommand(lower)) return handleAstros(ctx, text, mode);
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

  const astroShortcut = parseAstrosShortcutCommand(text, await galaxyForContext(ctx));
  if (astroShortcut) {
    if (!chatApproved(ctx) || !(await userCanUseSensitiveCommands(ctx))) {
      return respond(ctx, mode, "You do not have permission to use VisionBot intel commands.");
    }
    const report = await buildAstrosReport(astroShortcut.query, astroShortcut.galaxy);
    return respond(ctx, mode, report, { parse_mode: "HTML" });
  }

  const lookup = parseLookupCommand(text, await galaxyForContext(ctx));
  if (!lookup) return handleUnknownCommand(ctx, text, mode);
  if (!chatApproved(ctx) || !(await userCanUseSensitiveCommands(ctx))) {
    return respond(ctx, mode, "You do not have permission to use VisionBot intel commands.");
  }

  const lookupMode = lookup.mode;
  const includeSavedBases = await userCanUseSensitiveCommands(ctx);
  const report = await buildLocationReport(lookup, { includeSavedBases });

  const keyboard = lookup.coord ? await intelKeyboard(lookup.coord) : {};
  return respond(ctx, lookupMode, report, {
    parse_mode: "HTML",
    ...keyboard
  });
}

async function handleOperationButton(ctx) {
  const [, action, operationId] = ctx.match || [];
  const operation = await findOperationById(operationId);
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for operation controls.");
    return;
  }
  if (!operation) {
    await ctx.answerCbQuery("That operation is no longer active.");
    return;
  }
  if (!(await validateOperationCallback(ctx, operation))) return;

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
      status: "stood_down",
      updated_at: new Date().toISOString()
    }, {
      map_id: `eq.${operation.map_id}`,
      operation_id: `eq.${operation.operation_id}`
    });
    await closeLinkedOperationRows(operation, "stood_down");
    await ctx.answerCbQuery(`${operation.short_id} stood down.`);
    await refreshOperationMessage(ctx, { ...operation, status: "stood_down" });
    return;
  }

  const state = action === "leave" ? "withdrawn" : action === "join" ? "joined" : action;
  const saved = await upsertOperationMember(ctx, operation, state, "");
  if (!saved) {
    await ctx.answerCbQuery("Could not update your operation status.");
    return;
  }
  await ctx.answerCbQuery(`${operation.short_id}: ${state}`);
  await refreshOperationMessage(ctx, operation);
}

async function handleIntelButton(ctx) {
  const coord = ctx.match?.[1] || "";
  const includeSavedBases = await userCanUseSensitiveCommands(ctx);
  const report = coord.split(":").length === 3
    ? await buildSystemReport(coord, { includeSavedBases })
    : await buildAstroReport(coord, { includeSavedBases });
  await ctx.answerCbQuery("Intel");
  return ctx.reply(report, {
    parse_mode: "HTML",
    ...(await intelKeyboard(coord))
  });
}

async function handleBasesButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission to view saved base lists.");
    return;
  }
  const query = decodeButtonValue(ctx.match?.[1] || "");
  await ctx.answerCbQuery("Bases");
  return sendBasesReport(ctx, "$", query);
}

async function handleClaimButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission to claim targets.");
    return;
  }
  const coord = ctx.match?.[1] || "";
  const text = `$claim ${coord} 240 button claim`;
  await ctx.answerCbQuery("Claiming 4h");
  return handleClaim(ctx, text, "$");
}

async function handleHelp(ctx, text, mode) {
  return respond(ctx, mode, await helpText(ctx, text), { parse_mode: "HTML" });
}

async function helpText(ctx, input = "") {
  const topic = String(input).trim().split(/\s+/)[1]?.toLowerCase() || "";
  const topics = {
    setup: [
      "<b>Setup Help</b>",
      "",
      "<code>/map [coord]</code> - open the map",
      "<code>$guild bind</code> - bind this group for operations",
      "<code>!guild status</code> - show your active operation group",
      "<code>!g B24</code> - set your personal galaxy",
      "<code>$setgalaxy B24</code> - set the guild chat galaxy"
    ],
    attack: [
      "<b>Attack Help</b>",
      "",
      "<code>$attack 02:00 [coord] [coord] [note]</code>",
      "Creates a target pool for a landing window.",
      "<code>!take A-7K4P9 [coord] 02:30 [note]</code>",
      "Claims one target from that pool at your chosen arrival time.",
      "",
      "<code>$attack [target] [eta-minutes] [note]</code>",
      "Creates and claims one attack target immediately.",
      "<code>!join A-7K4P9 [travel-minutes] [role]</code>",
      "<code>!ready A-7K4P9</code>",
      "<code>!sent A-7K4P9 [note]</code>",
      "<code>$standdown A-7K4P9 [reason]</code>"
    ],
    defense: [
      "<b>Defense Help</b>",
      "",
      "<code>$sos [defended-base] [hostile-origin] [eta-minutes] [note]</code>",
      "Creates and announces a defense operation.",
      "<code>!respond D-4M8Q2 [travel-minutes] [role]</code>",
      "<code>!ready D-4M8Q2</code>",
      "<code>!sent D-4M8Q2 [note]</code>",
      "<code>$board defense</code>"
    ],
    scout: [
      "<b>Scout Help</b>",
      "",
      "<code>$scout [coord] [due-minutes] [note]</code>",
      "Requests fresh scouting. If minutes are omitted, it stays active for 4 hours.",
      "<code>!join S-9R2JD [role]</code>",
      "<code>!ready S-9R2JD</code>",
      "<code>!sent S-9R2JD [note]</code>"
    ],
    operations: [
      "<b>Operations Help</b>",
      "",
      "<code>$op [operation-ID]</code> - show an operation card",
      "<code>$board [attack|defense|scout]</code> - show active operations",
      "<code>/board</code> - slash fallback",
      "<code>!next</code> - your urgent action list",
      "<code>$standdown [operation-ID] [reason]</code> - cancel/stand down"
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
      "<code>!history [coord]</code> is planned but not implemented yet."
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
      "<code>!me</code> - your personal dashboard",
      "<code>!me bases</code> - planned base-only view",
      "<code>!save me [coord] [note]</code> - save/update a base note",
      "<code>!bases [name]</code>/<code>$bases [name]</code> - list a player's saved bases",
      "",
      "Example:",
      "<code>!save me B24:06:10:20 needs defense</code>",
      "<code>$bases storebo</code>"
    ],
    alerts: [
      "<b>Alerts Help</b>",
      "",
      "<code>!watch mybases</code>, <code>!watch [coord]</code>, and <code>!digest [hours]</code> are planned but not implemented yet.",
      "Current reminders are operation launch/arrival reminders."
    ],
    guild: [
      "<b>Guild Scope Help</b>",
      "",
      "<code>$guild bind</code> - remember this group as your active operation group",
      "<code>!guild status</code> - show your active operation group",
      "",
      "Group operation commands also remember the group automatically."
    ],
    aliases: [
      "<b>Legacy Aliases</b>",
      "",
      "<code>!claim</code>/<code>$claim</code> - alias for attack creation",
      "<code>!attacked</code>/<code>$attacked</code> - alias for SOS",
      "<code>!targets</code>/<code>$targets</code> - alias for personal claims/attack board",
      "<code>!claimed</code>/<code>$claimed</code> - alias for attack board",
      "<code>!incoming</code>/<code>$incoming</code> - alias for defense board",
      "<code>!myops</code> - alias for <code>!next</code>",
      "<code>!save me</code>/<code>$save me</code> - alias for updating one of your bases"
    ]
  };

  if (topics[topic]) return topics[topic].join("\n");

  const status = await helpStatus(ctx);
  return [
    "<b>VisionBot Commands</b>",
    "",
    "<code>!</code> replies to you privately. In DMs, it uses your active guild.",
    "<code>$</code> posts in the current approved guild chat.",
    "Use <code>/start</code> once before private commands.",
    "",
    status,
    "",
    "<b>CREATE</b>",
    "<code>$attack 02:00 [coord] [coord] [note]</code>",
    "<code>$attack [target] [eta-min] [note]</code>",
    "<code>$sos [defended] [hostile] [eta-min] [note]</code>",
    "<code>$scout [coord] [due-min] [note]</code>",
    "",
    "<b>PARTICIPATE</b>",
    "<code>!take [attack-ID] [coord] [arrival-time]</code>",
    "<code>!join A-7K4P9 [travel-min] [role]</code>",
    "<code>!respond D-4M8Q2 [travel-min] [role]</code>",
    "<code>!ready [ID]</code>  <code>!sent [ID]</code>  <code>!leave [ID]</code>",
    "",
    "<b>MANAGE</b>",
    "<code>$board [attack|defense|scout]</code>  <code>/board</code>",
    "<code>$op [ID]</code>  <code>$standdown [ID] [reason]</code>",
    "",
    "<b>INTEL</b>",
    "<code>![coord]</code>  <code>$[coord]</code>",
    "<code>!intel</code>  <code>!stale</code>  <code>!score</code>",
    "",
    "<b>PERSONAL</b>",
    "<code>!next</code>  <code>!me</code>  <code>!mine [coord]</code>  <code>!bases [player]</code>",
    "",
    "<b>HELP</b>",
    "<code>!help [topic]</code>",
    "Topics: setup, attack, defense, scout, operations, intel, bases, guild, alerts, aliases"
  ].join("\n");
}

function deliveryMode(text) {
  const first = String(text || "").trim()[0];
  return first === "$" ? "$" : "!";
}

function normalizeIncomingText(text) {
  let value = String(text || "").trim();
  value = value.replace(/^@\w+\s+(?=[!$@/])/, "");
  value = value.replace(/\s+@\w+$/, "").trim();
  return value.replace(/^@(status|st|version|help|hel|he|h|map|g|setgalaxy|guild|claim|take|attack|scout|sc|attacked|sos|intel|as|ast|astr|astro|astros|stale|score|bases|op|join|respond|ready|sent|leave|standdown|cancelop|board|defense|next|myops|incoming|targets|claimed|mine|me|wakeup)\b/i, "$$$1");
}

function statusReport(ctx) {
  return `VisionBot is online.\nMode: ${webhookUrl ? "webhook" : "polling"}\nBuild: ${botBuild}\nChat: ${ctx.chat?.id || "unknown"}`;
}

function versionReport() {
  return `VisionBot build ${botBuild}`;
}

function isCommand(lowerText, command) {
  const lower = String(lowerText || "").trim();
  const parsed = commandToken(lower);
  if (!parsed.name) return false;
  const aliases = commandAliases(command);
  return aliases.some((alias) => alias.startsWith(parsed.name));
}

function isExactCommand(lowerText, command) {
  const parsed = commandToken(lowerText);
  return parsed.name === command;
}

function isAstrosCommand(lowerText) {
  return isCommand(lowerText, "astros");
}

function commandToken(text) {
  const match = String(text || "").trim().match(/^([!$\/])([a-z0-9_-]+)(?=\s|$)/i);
  return {
    prefix: match?.[1] || "",
    name: (match?.[2] || "").toLowerCase()
  };
}

function commandAliases(command) {
  return preferredCommandAliases[command] || [command];
}

function matchingCommands(name) {
  const exactMatches = new Set();
  for (const command of canonicalCommands) {
    if (commandAliases(command).includes(name)) exactMatches.add(command);
  }
  if (exactMatches.size) return [...exactMatches];

  const matches = new Set();
  for (const command of canonicalCommands) {
    if (commandAliases(command).some((alias) => alias.startsWith(name))) matches.add(command);
  }
  return [...matches];
}

function ambiguousCommandMatches(text) {
  const parsed = commandToken(text);
  if (!parsed.name || parsed.name.length < 1) return [];
  return matchingCommands(parsed.name);
}

function commandBody(text) {
  return String(text || "").trim().replace(/^[!$\/][a-z0-9_-]+(?:\s+|$)/i, "").trim();
}

function canonicalizeCommandText(text) {
  const trimmed = String(text || "").trim();
  const parsed = commandToken(trimmed);
  if (!parsed.prefix || !parsed.name) return trimmed;
  const matches = matchingCommands(parsed.name);
  if (matches.length !== 1) return trimmed;
  const body = commandBody(trimmed);
  return `${parsed.prefix}${matches[0]}${body ? ` ${body}` : ""}`;
}

function isProtectedOperationalCommand(lowerText) {
  return [
    "claim",
    "take",
    "attack",
    "map",
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
    "intel",
    "a",
    "as",
    "ast",
    "astr",
    "astro",
    "astros",
    "mine",
    "me",
    "save me",
    "guild"
  ].some((command) => isCommand(lowerText, command) || isExactCommand(lowerText, command));
}

function isSensitiveOperationalCommand(lowerText) {
  return [
    "claim",
    "take",
    "attack",
    "map",
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
    "bases",
    "intel",
    "a",
    "as",
    "ast",
    "astr",
    "astro",
    "astros",
    "mine",
    "me",
    "save me",
    "setgalaxy",
    "guild",
    "stale",
    "score"
  ].some((command) => isCommand(lowerText, command) || isExactCommand(lowerText, command));
}

function closestCommand(command) {
  const cleanCommand = commandName(command);
  const commands = ["help", "status", "map", "attack", "claim", "take", "sos", "scout", "intel", "astro", "astros", "stale", "score", "bases", "board", "incoming", "targets", "claimed", "join", "ready", "sent", "leave", "mine", "me"];
  let best = "";
  let bestDistance = 99;
  for (const candidate of commands) {
    if (!cleanCommand || cleanCommand === candidate) continue;
    const distance = editDistance(cleanCommand, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : "";
}

function commandName(text) {
  return String(text || "")
    .trim()
    .replace(/^[@!$/]+/, "")
    .split(/\s+/)[0]
    .replace(/[^a-z0-9_-].*$/i, "")
    .toLowerCase();
}

function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return rows[a.length][b.length];
}

function chatApproved(ctx) {
  if (!approvedChatIds.length) return true;
  if (ctx.chat?.type === "private") return true;
  const id = ctx.chat?.id ? String(ctx.chat.id) : "";
  return id ? approvedChatIds.includes(id) : false;
}

function chatIdReport(ctx) {
  return [
    "<b>VisionBot IDs</b>",
    `chat_id: <code>${escapeHtml(ctx.chat?.id || "")}</code>`,
    `chat_type: <code>${escapeHtml(ctx.chat?.type || "")}</code>`,
    `chat_title: <code>${escapeHtml(chatTitle(ctx))}</code>`,
    `user_id: <code>${escapeHtml(ctx.from?.id || "")}</code>`
  ].join("\n");
}

function notApprovedMessage(ctx) {
  const chatId = ctx.chat?.id ? String(ctx.chat.id) : "";
  return [
    "This chat is not approved for VisionBot operations.",
    chatId ? `Add this to <code>APPROVED_CHAT_IDS</code>: <code>${escapeHtml(chatId)}</code>` : ""
  ].filter(Boolean).join("\n");
}

async function userCanUseSensitiveCommands(ctx) {
  if (!ctx.from?.id) return false;
  const userId = telegramUserId(ctx);
  if (officerUserIds.includes(userId)) return true;

  if (accessChatIds.length) {
    return isMemberOfAnyAccessChat(ctx, userId);
  }

  if (isPrivateChat(ctx)) return true;
  return chatApproved(ctx);
}

async function isMemberOfAnyAccessChat(ctx, userId) {
  for (const chatId of accessChatIds) {
    try {
      const member = await ctx.telegram.getChatMember(chatId, userId);
      if (member && member.status !== "left" && member.status !== "kicked") return true;
    } catch (error) {
      console.error(`Access chat lookup failed for ${chatId}`, error.message);
    }
  }
  return false;
}

async function validateOperationCallback(ctx, operation) {
  if (!operation || operation.status !== "active") {
    await ctx.answerCbQuery("That operation is no longer active.");
    return false;
  }
  if (!chatApproved(ctx)) {
    await ctx.answerCbQuery("This chat is not approved.");
    return false;
  }
  const currentChatId = ctx.chat?.id ? String(ctx.chat.id) : "";
  if (currentChatId && !isPrivateChat(ctx) && String(operation.chat_id || "") !== currentChatId) {
    await ctx.answerCbQuery("That operation belongs to another guild group.");
    return false;
  }
  return true;
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

async function handleGuild(ctx, text, mode) {
  const action = String(text || "").trim().split(/\s+/)[1]?.toLowerCase() || "status";
  if (action === "bind") {
    if (isPrivateChat(ctx)) return respond(ctx, mode, "Use $guild bind in the guild group you want this bot to coordinate.");
    if (!(await rememberActiveChat(ctx))) return respond(ctx, mode, "Could not bind this group.");
    return respond(ctx, mode, `Active operation group set to ${escapeHtml(chatTitle(ctx))}.`, { parse_mode: "HTML" });
  }

  if (!ctx.from?.id) return respond(ctx, mode, "Use this from a user account so I know whose active group to check.");
  const settings = await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false);
  if (!settings?.active_chat_id) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  return respond(ctx, mode, `Active operation group: ${escapeHtml(settings.active_chat_label || settings.active_chat_id)}`, { parse_mode: "HTML" });
}

async function helpStatus(ctx) {
  const galaxy = await galaxyForContext(ctx);
  const chatLabel = !isPrivateChat(ctx) ? chatTitle(ctx) : "";
  const settings = ctx.from?.id ? await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false) : null;
  const activeLabel = chatLabel || settings?.active_chat_label || "";
  if (!activeLabel) {
    return [
      "<b>No active guild selected.</b>",
      "Use <code>$guild bind</code> in the guild group, then <code>!guild status</code>.",
      `Galaxy: ${escapeHtml(galaxy)}`,
      "Your role: Member"
    ].join("\n");
  }
  return [
    `Active guild: ${escapeHtml(activeLabel)}`,
    `Operation group: ${escapeHtml(activeLabel)}`,
    `Galaxy: ${escapeHtml(galaxy)}`,
    `Your role: ${await userRoleLabel(ctx)}`
  ].join("\n");
}

async function userRoleLabel(ctx) {
  if (!ctx.from?.id || !ctx.chat?.id || isPrivateChat(ctx)) return "Member";
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    if (member?.status === "creator") return "Owner";
    if (member?.status === "administrator") return "Officer";
  } catch {}
  return "Member";
}

async function handleClaim(ctx, text, mode) {
  if (/^[!$]attack\b/i.test(text)) {
    const plan = parseAttackPlan(text, await galaxyForContext(ctx));
    if (plan) return handleAttackPlan(ctx, plan, mode);
  }

  const targetClaim = parseTargetClaim(text, await galaxyForContext(ctx));
  if (targetClaim) return handleTargetClaim(ctx, targetClaim, mode);

  const match = text.trim().match(claimPattern);
  if (!match) return respond(ctx, mode, "Use: !claim B24:24:34:06 10 optional note");

  const parsed = parseTimedCoordinate(match[2], await galaxyForContext(ctx));
  if (!parsed?.coord || parsed.kind !== "astro") return respond(ctx, mode, "Use: !claim [coord] [minutes] [note]");

  const target = parsed.coord;
  const minutes = parsed.minutes;
  const note = parsed.note;
  if (!validMinutes(minutes)) return respond(ctx, mode, "Use minutes from now, 1 to 1440.");

  const now = new Date();
  const arrivalAt = new Date(now.getTime() + minutes * 60 * 1000);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const duplicate = await findActiveOperationByTarget(mapIdForCoord(target), scopeId, "attack", "target_coord", target);
  if (duplicate) {
    return respond(ctx, mode, `Existing attack ${escapeHtml(duplicate.short_id)} already targets ${escapeHtml(target)}. Use !join ${escapeHtml(duplicate.short_id)} instead.`, { parse_mode: "HTML" });
  }
  const operation = operationRow(ctx, {
    type: "attack",
    targetCoord: target,
    arrivalAt,
    note,
    chatId: scopeId
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
    chat_id: scopeId,
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

async function handleAttackPlan(ctx, plan, mode) {
  if (!plan.coords.length) return respond(ctx, mode, "Use: $attack 02:00 B24:11:70:31 B24:14:89:10 optional note");
  if (plan.coords.length > 40) return respond(ctx, mode, "Keep one attack plan to 40 targets or fewer.");

  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");

  const now = new Date();
  const operation = operationRow(ctx, {
    type: "attack",
    targetCoord: plan.coords[0],
    arrivalAt: plan.arrivalAt,
    note: plan.note || `${plan.coords.length} target attack pool`,
    chatId: scopeId
  });

  if (!(await insertRow("b24_operations", operation))) {
    return respond(ctx, mode, "Attack plan failed. I could not create the operation.");
  }

  const rows = plan.coords.map((coord) => ({
    map_id: mapIdForCoord(coord),
    claim_id: randomId(),
    operation_id: operation.operation_id,
    operation_short_id: operation.short_id,
    target_coord: coord,
    region_id: astroToRegion(coord),
    system_id: astroToSystem(coord),
    claimed_by: null,
    claimed_by_user_id: null,
    chat_id: scopeId,
    arrival_at: plan.arrivalAt.toISOString(),
    arrival_label: plan.label,
    confirmed_sent: false,
    confirmed_at: null,
    confirmed_by: "",
    fleet_label: "",
    note: plan.note,
    status: "active",
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  }));

  for (const row of rows) {
    if (!(await insertRow("b24_claims", row))) {
      return respond(ctx, mode, `Attack plan ${escapeHtml(operation.short_id)} was created, but one target row failed to save.`, { parse_mode: "HTML" });
    }
  }

  const message = [
    `<b>${escapeHtml(operation.short_id)} ATTACK PLAN</b>`,
    `Landing window starts: ${escapeHtml(plan.label)} (${formatEta(plan.arrivalAt)})`,
    `Targets: ${rows.length}`,
    plan.note ? `Note: ${escapeHtml(plan.note)}` : "",
    "",
    `Claim with: <code>!take ${escapeHtml(operation.short_id)} ${escapeHtml(rows[0].target_coord)} ${escapeHtml(plan.label)}</code>`,
    `Board: <code>$board attack</code>`
  ].filter(Boolean).join("\n");

  return respond(ctx, mode, message, {
    parse_mode: "HTML",
    ...attackPlanKeyboard(operation, rows)
  });
}

async function handleTargetClaim(ctx, targetClaim, mode) {
  const operation = await findOperation(ctx, targetClaim.shortId);
  if (!operation || operation.type !== "attack") {
    return respond(ctx, mode, `No active attack operation found for ${escapeHtml(targetClaim.shortId)}.`, { parse_mode: "HTML" });
  }

  const claim = await fetchOne("b24_claims", {
    operation_id: operation.operation_id,
    target_coord: targetClaim.coord,
    status: "active"
  }, operation.map_id);

  if (!claim) {
    return respond(ctx, mode, `${escapeHtml(targetClaim.coord)} is not an open target on ${escapeHtml(operation.short_id)}.`, { parse_mode: "HTML" });
  }
  if (claim.claimed_by_user_id && claim.claimed_by_user_id !== telegramUserId(ctx)) {
    return respond(ctx, mode, `${escapeHtml(targetClaim.coord)} is already claimed by ${escapeHtml(claim.claimed_by || "someone")}.`, { parse_mode: "HTML" });
  }

  const stamp = new Date().toISOString();
  const ok = await updateRows("b24_claims", {
    claimed_by: telegramName(ctx),
    claimed_by_user_id: telegramUserId(ctx),
    arrival_at: targetClaim.arrivalAt.toISOString(),
    arrival_label: targetClaim.label,
    note: targetClaim.note || claim.note || "",
    updated_at: stamp
  }, {
    map_id: `eq.${operation.map_id}`,
    claim_id: `eq.${claim.claim_id}`
  });
  if (!ok) return respond(ctx, mode, "Target claim failed. I could not update Supabase.");

  await upsertOperationMember(ctx, operation, "joined", `${targetClaim.coord}${targetClaim.note ? ` ${targetClaim.note}` : ""}`);
  return respond(ctx, mode, `${escapeHtml(telegramName(ctx))} claimed ${escapeHtml(targetClaim.coord)} for ${escapeHtml(operation.short_id)} at ${escapeHtml(targetClaim.label)}.`, { parse_mode: "HTML" });
}

async function handleScout(ctx, text, mode) {
  const body = commandBody(text);
  const parsed = parseScoutRequest(body, await galaxyForContext(ctx));
  if (!parsed) return respond(ctx, mode, "Use: $scout B24:44:76 120 optional note");

  const timed = parseTimedRemainder(parsed.remainder);
  const minutes = Number.isFinite(timed.minutes) ? timed.minutes : 240;
  if (!validMinutes(minutes)) return respond(ctx, mode, "Use minutes from now, 1 to 1440.");

  const now = new Date();
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const operation = operationRow(ctx, {
    type: "scout",
    targetCoord: parsed.coord,
    arrivalAt: new Date(now.getTime() + minutes * 60 * 1000),
    note: timed.note || parsed.remainder.trim(),
    chatId: scopeId
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
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const claims = await fetchRows("b24_claims", {
    claimed_by_user_id: `eq.${telegramUserId(ctx)}`,
    status: "eq.active",
    chat_id: `eq.${scopeId}`,
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
  const message = claims.length ? claims.map(formatClaimLine).join("\n") : `You have no active claimed targets in ${galaxy}.`;
  return respond(ctx, mode, message, {
    parse_mode: "HTML",
    ...claimListKeyboard(claims)
  });
}

async function handleClaimed(ctx, mode) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const claims = await fetchActiveClaims(galaxy, scopeId);
  return respond(ctx, mode, claims.length ? claims.map(formatClaimLine).join("\n") : `No active attacks claimed in ${galaxy}.`, {
    parse_mode: "HTML",
    ...claimListKeyboard(claims)
  });
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
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const duplicate = await findActiveOperationByTarget(mapIdForCoord(defended || attacker), scopeId, "defense", "defended_coord", defended);
  if (duplicate) {
    return respond(ctx, mode, `Existing defense ${escapeHtml(duplicate.short_id)} already covers ${escapeHtml(defended)}. Use !respond ${escapeHtml(duplicate.short_id)} instead.`, { parse_mode: "HTML" });
  }
  const operation = operationRow(ctx, {
    type: "defense",
    targetCoord: defended,
    defendedCoord: defended,
    hostileOrigin: attacker,
    arrivalAt,
    note,
    chatId: scopeId
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
    chat_id: scopeId,
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
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const incoming = await fetchActiveIncoming(galaxy, scopeId);
  return respond(ctx, mode, incoming.length ? incoming.map(formatIncomingLine).join("\n") : `No active hostile incoming reports in ${galaxy}.`, { parse_mode: "HTML" });
}

async function handleIntel(ctx, text, mode) {
  const query = text.replace(/^[!$]intel\s+/i, "").trim();
  const parsed = parseLocation(query, await galaxyForContext(ctx));
  if (!parsed) return respond(ctx, mode, "Use: !intel B24, B24:34, B24:34:06, or B24:34:06:10");

  const includeSavedBases = await userCanUseSensitiveCommands(ctx);
  const report = await buildLocationReport(parsed, { includeSavedBases });
  return respond(ctx, mode, report, {
    parse_mode: "HTML",
    ...(parsed.coord ? await intelKeyboard(parsed.coord) : {})
  });
}

async function handleAstros(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const query = commandBody(text);
  const report = await buildAstrosReport(query, galaxy);
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

async function handleUnknownCommand(ctx, text, mode) {
  const trimmed = String(text || "").trim();
  if (!/^[!$@/]/.test(trimmed)) return;
  const normalized = normalizeIncomingText(trimmed);
  const command = commandName(normalized);
  if (!command) return;

  const suggestions = {
    attck: "attack",
    atack: "attack",
    defence: "sos",
    defend: "sos",
    target: "attack",
    map: "map",
    astro: "astros",
    coords: "intel",
    coordinate: "intel"
  };
  const suggestion = suggestions[command] || closestCommand(command);
  const lines = [`I do not know <code>${escapeHtml(trimmed.split(/\s+/)[0])}</code>.`];
  if (suggestion && suggestion !== command) lines.push(`Did you mean <code>${escapeHtml(mode)}${escapeHtml(suggestion)}</code>?`);
  lines.push("", "Try <code>!help</code>, <code>!help attack</code>, <code>!help scout</code>, or <code>!help intel</code>.");
  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleBases(ctx, text, mode) {
  const query = text.replace(/^[!$]bases\s+/i, "").trim().replace(/^@/, "");
  if (!query) return respond(ctx, mode, "Use: !bases playername");
  return sendBasesReport(ctx, mode, query);
}

async function sendBasesReport(ctx, mode, query) {
  const galaxy = await galaxyForContext(ctx);
  const [savedRows, importedRows] = await Promise.all([
    fetchRows("b24_user_bases", {
      status: "eq.active"
    }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" }),
    fetchRows("b24_bases", {}, { mapId: galaxyToMapId(galaxy), order: "coord.asc" })
  ]);

  const needle = searchText(query);
  const ownerSuggestions = baseOwnerSuggestions([...savedRows, ...importedRows], needle);
  const exactOwner = ownerSuggestions.find((owner) => searchText(owner) === needle);
  if (!exactOwner && ownerSuggestions.length > 1) {
    const lines = [`Multiple base owners match ${escapeHtml(query)}:`, ...ownerSuggestions.slice(0, 12).map((owner) => `- ${escapeHtml(owner)}`)];
    return respond(ctx, mode, lines.join("\n"), {
      parse_mode: "HTML",
      ...basesSuggestionKeyboard(ownerSuggestions.slice(0, 8))
    });
  }

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
  return respond(ctx, mode, lines.join("\n"), {
    parse_mode: "HTML",
    ...baseListKeyboard(importedMatches, savedMatches)
  });
}

async function handleBoard(ctx, text, mode) {
  const kind = boardKind(text);
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const [operations, appClaims] = await Promise.all([
    fetchActiveOperations(galaxy, scopeId, kind),
    kind === "defense" || kind === "scout" ? [] : fetchBoardClaims(galaxy, scopeId)
  ]);
  const membersByOperation = await fetchMembersByOperation(operations);
  const claimsByOperation = await fetchClaimsByOperation(operations);
  const attacks = operations.filter((operation) => operation.type === "attack");
  const defenses = operations.filter((operation) => operation.type === "defense");
  const scouts = operations.filter((operation) => operation.type === "scout");
  const attackCount = attacks.length + appClaims.length;

  const lines = [`<b>${galaxy} Board</b>`];
  if (kind !== "defense" && kind !== "scout") {
    lines.push("", `<b>Attacks</b> (${attackCount})`);
    lines.push(...(attacks.length ? attacks.map((operation) => {
      return formatOperationLine(
        operation,
        membersByOperation.get(operation.operation_id) || [],
        claimsByOperation.get(operation.operation_id) || []
      );
    }) : []));
    lines.push(...(appClaims.length ? appClaims.map(formatBoardClaimLine) : []));
    if (!attackCount) lines.push("No active attack operations or app claims.");
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
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const [memberships, bases] = await Promise.all([
    fetchRows("b24_operation_members", {
      user_id: `eq.${telegramUserId(ctx)}`
    }, { mapId: galaxyToMapId(galaxy), order: "updated_at.asc" }),
    fetchRows("b24_user_bases", {
      user_id: `eq.${telegramUserId(ctx)}`,
      status: "eq.active"
    }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" })
  ]);
  const activeMemberships = memberships.filter((member) => member.state !== "withdrawn");
  const operations = await fetchOperationsForMemberships(galaxy, activeMemberships);
  const actionOps = operations.filter((operation) => operation.status === "active" && operation.chat_id === scopeId);
  const membersByOperation = await fetchMembersByOperation(actionOps);

  const lines = [
    `<b>${galaxy} Next Actions</b>`,
    "",
    `<b>Your Operations</b> (${actionOps.length})`,
    ...(actionOps.length ? actionOps.slice(0, 8).map((operation) => formatOperationLine(operation, membersByOperation.get(operation.operation_id) || [])) : ["No active operations need you."]),
    "",
    `<b>Your Saved Bases</b> (${bases.length})`
  ];

  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleOp(ctx, text, mode) {
  const parts = String(text || "").trim().split(/\s+/);
  const action = (parts[1] || "").toLowerCase();
  if (/^[ads]-?[a-z0-9]{3,8}$/i.test(action)) return handleOperationStatus(ctx, action, mode);
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
  if (travel.minutes && launchIsPast(operation, travel.minutes)) {
    return respond(ctx, mode, `You cannot arrive on time for ${escapeHtml(operation.short_id)}. Your launch time would already be past.`, { parse_mode: "HTML" });
  }
  const saved = await upsertOperationMember(ctx, operation, state, travel.note, travel.minutes);
  if (!saved) return respond(ctx, mode, `Could not update your status for ${escapeHtml(operation.short_id)}.`, { parse_mode: "HTML" });
  if (state === "sent") await syncLinkedClaimSent(ctx, operation, travel.note);
  if ((state === "joined" || state === "ready") && travel.minutes) await scheduleLaunchReminders(ctx, operation, travel.minutes);
  const label = state === "sent" ? "marked sent for" : state === "withdrawn" ? "left" : `${state} for`;
  return respond(ctx, mode, `${escapeHtml(telegramName(ctx))} ${label} ${escapeHtml(operation.short_id)}.`, { parse_mode: "HTML" });
}

async function syncLinkedClaimSent(ctx, operation, note = "") {
  const stamp = new Date().toISOString();
  const patch = {
    confirmed_sent: true,
    confirmed_at: stamp,
    confirmed_by: telegramName(ctx),
    updated_at: stamp
  };
  if (note) patch.fleet_label = note;
  return updateRows("b24_claims", patch, {
    map_id: `eq.${operation.map_id}`,
    operation_id: `eq.${operation.operation_id}`,
    claimed_by_user_id: `eq.${telegramUserId(ctx)}`,
    status: "eq.active"
  });
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
    status: "stood_down",
    note: parsed.note ? `${operation.note || ""}${operation.note ? " | " : ""}Closed: ${parsed.note}` : operation.note,
    updated_at: new Date().toISOString()
  }, {
    map_id: `eq.${operation.map_id}`,
    operation_id: `eq.${operation.operation_id}`
  });
  if (!ok) return respond(ctx, mode, "Could not close that operation.");
  await closeLinkedOperationRows(operation, "stood_down");
  await refreshOperationMessage(ctx, { ...operation, status: "stood_down" });
  return respond(ctx, mode, `${escapeHtml(operation.short_id)} stood down${parsed.note ? `: ${escapeHtml(parsed.note)}` : ""}`, { parse_mode: "HTML" });
}

async function closeLinkedOperationRows(operation, status) {
  const stamp = new Date().toISOString();
  await Promise.all([
    updateRows("b24_claims", {
      status,
      updated_at: stamp
    }, {
      map_id: `eq.${operation.map_id}`,
      operation_id: `eq.${operation.operation_id}`
    }),
    updateRows("b24_incoming", {
      status,
      updated_at: stamp
    }, {
      map_id: `eq.${operation.map_id}`,
      operation_id: `eq.${operation.operation_id}`
    }),
    updateRows("b24_scheduled_notifications", {
      cancelled_at: stamp,
      updated_at: stamp
    }, {
      map_id: `eq.${operation.map_id}`,
      operation_id: `eq.${operation.operation_id}`,
      sent_at: "is.null"
    })
  ]);
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

async function buildAstroReport(coord, options = {}) {
  const includeSavedBases = Boolean(options.includeSavedBases);
  const [astro, base, savedBases] = await Promise.all([
    fetchOne("b24_astros", { coord }, mapIdForCoord(coord)),
    fetchOne("b24_bases", { coord }, mapIdForCoord(coord)),
    includeSavedBases ? fetchRows("b24_user_bases", {
      base_coord: `eq.${coord}`,
      status: "eq.active"
    }, { mapId: mapIdForCoord(coord), order: "owner_label.asc" }) : []
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

async function buildSystemReport(systemCoord, options = {}) {
  const includeSavedBases = Boolean(options.includeSavedBases);
  const [rows, savedBases] = await Promise.all([
    fetchRows("b24_astros", {
      system_id: `eq.${systemCoord}`
    }, { mapId: mapIdForCoord(systemCoord), order: "coord.asc" }),
    includeSavedBases ? fetchRows("b24_user_bases", {
      system_id: `eq.${systemCoord}`,
      status: "eq.active"
    }, { mapId: mapIdForCoord(systemCoord), order: "base_coord.asc" }) : []
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

async function buildLocationReport(location, options = {}) {
  if (!location) return "I could not understand that location.";
  if (location.kind === "galaxy") return buildGalaxyReport(location.galaxy);
  if (location.kind === "region") return buildRegionReport(location.coord);
  if (location.kind === "system") return buildSystemReport(location.coord, options);
  return buildAstroReport(location.coord, options);
}

async function buildGalaxyReport(galaxy) {
  const mapId = galaxyToMapId(galaxy);
  const [astros, bases, operations, claims] = await Promise.all([
    fetchAllRows("b24_astros", {}, { mapId, select: "coord,system_id,region_id", order: "coord.asc" }),
    fetchAllRows("b24_bases", {}, { mapId, select: "coord", order: "coord.asc" }),
    fetchRows("b24_operations", { status: "eq.active" }, { mapId, order: "arrival_at.asc", limit: 1000 }),
    fetchRows("b24_claims", { status: "eq.active" }, { mapId, order: "arrival_at.asc", limit: 1000 })
  ]);
  const systems = new Set(astros.map((astro) => astro.system_id).filter(Boolean));
  const regions = new Set(astros.map((astro) => astro.region_id).filter(Boolean));
  const lines = [
    `<b>${escapeHtml(galaxy)}</b>`,
    `Known astros: ${astros.length}`,
    `Known systems: ${systems.size}`,
    `Regions with intel: ${regions.size} / 99`,
    `Known bases: ${bases.length}`,
    `Active operations: ${operations.length}`,
    `Active claims: ${claims.length}`,
    "",
    `Use <code>!${escapeHtml(galaxy)}:44</code> for a region or <code>$astros ${escapeHtml(galaxy)} craters</code> for terrain.`
  ];
  return lines.join("\n");
}

async function buildRegionReport(region) {
  const galaxy = galaxyFromCoord(region);
  const mapId = galaxyToMapId(galaxy);
  const [astros, bases, operations, claims] = await Promise.all([
    fetchRows("b24_astros", { region_id: `eq.${region}` }, { mapId, order: "coord.asc", limit: 1000 }),
    fetchRows("b24_bases", { region_id: `eq.${region}` }, { mapId, order: "coord.asc", limit: 1000 }),
    fetchRows("b24_operations", { status: "eq.active" }, { mapId, order: "arrival_at.asc", limit: 1000 }),
    fetchRows("b24_claims", { status: "eq.active", region_id: `eq.${region}` }, { mapId, order: "arrival_at.asc", limit: 1000 })
  ]);
  const systems = new Set(astros.map((astro) => astro.system_id).filter(Boolean));
  const staleCount = astros.filter((astro) => {
    const updated = new Date(astro.updated_at);
    return Number.isFinite(updated.getTime()) && Date.now() - updated.getTime() > staleIntelMs;
  }).length;
  const operationCount = operations.filter((operation) => operationRegion(operation) === region).length;
  return [
    `<b>${escapeHtml(region)}</b>`,
    `Known systems: ${systems.size}`,
    `Known astros: ${astros.length}`,
    `Known bases: ${bases.length}`,
    `Stale astros: ${staleCount}`,
    `Active operations: ${operationCount}`,
    `Active claims: ${claims.length}`,
    "",
    `Use <code>!${escapeHtml(region)}:76</code> for a system or <code>$astros ${escapeHtml(region)} craters</code> for terrain.`
  ].join("\n");
}

async function buildAstrosReport(query, fallbackGalaxy) {
  const parsed = parseAstrosQuery(query, fallbackGalaxy);
  if (!parsed.filter && !parsed.attrFilters.length) return buildAstroBreakdown(parsed.galaxy, parsed.region);
  return buildAstroSearch(parsed);
}

async function buildAstroBreakdown(galaxy, region = "") {
  const mapId = galaxyToMapId(galaxy);
  const filters = {};
  if (region) filters.region_id = `eq.${region}`;
  const rows = await fetchAllRows("b24_astros", filters, { mapId, select: "terrain,has_base", order: "terrain.asc" });
  if (!rows.length) return `No astro intel found for ${escapeHtml(region || galaxy)} yet.`;
  const counts = countBy(rows, "terrain");
  const title = region || galaxy;
  const lines = [`<b>Astro Breakdown ${escapeHtml(title)}</b>`];
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([terrain, total]) => lines.push(`${escapeHtml(terrain || "Unknown")}: ${total}`));
  lines.push("", `Total: ${rows.length}`, `With bases: ${rows.filter((row) => row.has_base).length}`);
  return lines.join("\n");
}

async function buildAstroSearch(parsed) {
  const filters = {};
  const titleParts = [parsed.filter || "astros", parsed.region || parsed.galaxy].filter(Boolean);
  if (parsed.region) filters.region_id = `eq.${parsed.region}`;
  if (parsed.filter) filters.terrain = `ilike.*${parsed.filter}*`;
  const pageSize = 50;
  const page = Math.max(1, parsed.page || 1);
  const from = (page - 1) * pageSize;
  let rows = [];
  let count = 0;
  if (parsed.attrFilters.length) {
    const allRows = await fetchAllRows("b24_astros", filters, {
      mapId: galaxyToMapId(parsed.galaxy),
      order: "coord.asc"
    });
    const matched = allRows.filter((astro) => astroMatchesAttributeFilters(astro, parsed.attrFilters));
    count = matched.length;
    rows = matched.slice(from, from + pageSize);
    titleParts.push(parsed.attrFilters.map(attributeFilterLabel).join(", "));
  } else {
    const result = await fetchRowsWithCount("b24_astros", filters, {
      mapId: galaxyToMapId(parsed.galaxy),
      order: "coord.asc",
      from,
      to: from + pageSize - 1
    });
    rows = result.rows;
    count = result.count;
  }
  if (!rows.length) return `No ${escapeHtml(parsed.filter || "matching")} astros found in ${escapeHtml(parsed.region || parsed.galaxy)}.`;
  const lines = [`<b>${escapeHtml(titleParts.join(" in "))}</b>`];
  rows.forEach((astro) => {
    const attrs = Array.isArray(astro.attributes) ? astro.attributes.join("/") : "";
    const base = astro.has_base ? " base" : "";
    lines.push(`${escapeHtml(astro.coord)} - ${escapeHtml(astro.terrain || "?")} ${escapeHtml(astro.astro_type || "?")}${attrs ? ` - ${escapeHtml(attrs)}` : ""}${base}`);
  });
  const shownTo = from + rows.length;
  const totalText = Number.isFinite(count) ? `${from + 1}-${shownTo} of ${count}` : `${rows.length}${rows.length === pageSize ? "+" : ""}`;
  lines.push("", `${totalText} found`);
  if (Number.isFinite(count) && shownTo < count) {
    lines.push(`Next: <code>$astros ${escapeHtml(astrosNextQuery(parsed, page + 1))}</code>`);
  }
  return lines.join("\n");
}

function parseAstrosQuery(query, fallbackGalaxy) {
  const original = String(query || "").trim();
  const pageMatch = original.match(/(?:^|\s)(?:page\s*|p)(\d+)(?=\s|$)/i);
  const page = pageMatch ? Math.max(1, Number(pageMatch[1])) : 1;
  const withoutPage = original.replace(/(?:^|\s)(?:page\s*|p)\d+(?=\s|$)/i, " ").trim();
  const attrFilters = parseAttributeFilters(withoutPage);
  const raw = attrFilters.reduce((value, filter) => value.replace(filter.tokenRegex, " "), withoutPage).trim();
  const explicitGalaxy = normalizeGalaxy((raw.toUpperCase().match(/\bB\d{2}\b/) || [])[0]);
  const fallback = normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  const location = parseAstrosLocation(raw, fallbackGalaxy);
  let remainder = raw;
  let galaxy = explicitGalaxy || fallback;
  let region = "";
  if (location) {
    galaxy = location.galaxy;
    region = location.region || "";
    remainder = location.remainder || "";
  } else if (explicitGalaxy) {
    remainder = raw.replace(new RegExp(`\\b${explicitGalaxy}\\b`, "i"), "").trim();
  }
  const filter = remainder
    .replace(/^[:\s]+/, "")
    .trim()
    .toLowerCase();
  return { galaxy, region, filter, page, attrFilters };
}

function astrosNextQuery(parsed, page) {
  const scope = parsed.region || parsed.galaxy;
  return [scope, parsed.filter, ...parsed.attrFilters.map((filter) => filter.token), `page ${page}`].filter(Boolean).join(" ");
}

function parseAstrosShortcutCommand(text, fallbackGalaxy = defaultGalaxy) {
  const trimmed = String(text || "").trim();
  const mode = trimmed[0];
  if (mode !== "!" && mode !== "$") return null;
  const body = trimmed.slice(1).trim();
  const match = body.match(/^(B\d{2}(?::?\d{1,2})?)(?:\s+)(?=[A-Za-z0-9])([\s\S]+)$/i);
  if (!match) return null;
  const galaxy = normalizeGalaxy(match[1].split(":")[0]) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  return { mode, galaxy, query: body };
}

function parseAstrosLocation(raw, fallbackGalaxy) {
  const text = String(raw || "").trim();
  let locationMatch = text.match(/^(B\d{2})(?::|\s+)?(\d{1,2})?(?=\s|:|$)/i);
  let consumed = "";
  let galaxy = "";
  let region = "";
  if (locationMatch) {
    consumed = locationMatch[0];
    galaxy = normalizeGalaxy(locationMatch[1]) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
    region = locationMatch[2] ? `${galaxy}:${Number(locationMatch[2])}` : "";
  } else {
    locationMatch = text.match(/^(B\d{2})(\d{2})(?=\s|:|$)/i);
    if (locationMatch) {
      consumed = locationMatch[0];
      galaxy = normalizeGalaxy(locationMatch[1]) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
      region = `${galaxy}:${Number(locationMatch[2])}`;
    }
  }
  if (!locationMatch || !region && !galaxy) {
    locationMatch = text.match(/^(\d{2})(?:\s+|:)?(\d{2})(?=\s|:|$)/);
    if (!locationMatch) return null;
    consumed = locationMatch[0];
    galaxy = normalizeGalaxy(`B${locationMatch[1]}`) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
    region = `${galaxy}:${Number(locationMatch[2])}`;
  }
  return {
    galaxy,
    region,
    remainder: text.slice(consumed.length).trim()
  };
}

function parseAttributeFilters(raw) {
  const attrMap = {
    a: { index: 0, name: "area" },
    s: { index: 1, name: "solar" },
    f: { index: 2, name: "fertility" },
    m: { index: 3, name: "metal" },
    g: { index: 4, name: "gas" },
    c: { index: 5, name: "crystal" }
  };
  return [...String(raw || "").matchAll(/(?:^|\s)([asfmcg])\s*(\d{1,3})(?=\s|$)/gi)].map((match) => {
    const key = match[1].toLowerCase();
    const value = Number(match[2]);
    const token = `${key}${value}`;
    return {
      ...attrMap[key],
      key,
      value,
      token,
      tokenRegex: new RegExp(`(?:^|\\s)${key}\\s*${value}(?=\\s|$)`, "i")
    };
  }).filter((filter) => Number.isFinite(filter.value));
}

function astroMatchesAttributeFilters(astro, attrFilters) {
  const attrs = Array.isArray(astro?.attributes) ? astro.attributes.map(Number) : [];
  return attrFilters.every((filter) => attrs[filter.index] >= filter.value);
}

function attributeFilterLabel(filter) {
  return `${filter.name} ${filter.value}+`;
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

function baseOwnerSuggestions(rows, needle) {
  if (!needle) return [];
  const owners = new Set();
  rows.forEach((row) => {
    const candidates = [
      row.owner_label,
      row.guild,
      row.label,
      [row.guild, row.label].filter(Boolean).join(" ")
    ].filter(Boolean);
    candidates.forEach((owner) => {
      if (searchText(owner).startsWith(needle)) owners.add(owner);
    });
  });
  return [...owners].sort((a, b) => a.localeCompare(b));
}

function basesSuggestionKeyboard(owners) {
  if (!owners.length) return {};
  return Markup.inlineKeyboard(owners.map((owner) => [
    Markup.button.callback(owner.slice(0, 40), `bases:${encodeButtonValue(owner)}`)
  ]));
}

function baseListKeyboard(importedRows, savedRows) {
  const coords = [...new Set([
    ...importedRows.map((row) => row.coord),
    ...savedRows.map((row) => row.base_coord)
  ].filter(Boolean))].slice(0, 8);
  if (!coords.length) return {};
  return Markup.inlineKeyboard(coords.map((coord) => [
    Markup.button.callback(`Intel ${coord}`, `intel:${coord}`),
    Markup.button.callback("Claim 4h", `claim4h:${coord}`),
    Markup.button.url("Map", mapUrl(galaxyFromCoord(coord), coord))
  ]));
}

function claimListKeyboard(claims) {
  const coords = [...new Set(claims.map((claim) => claim.target_coord).filter(Boolean))].slice(0, 8);
  if (!coords.length) return {};
  return Markup.inlineKeyboard(coords.map((coord) => [
    Markup.button.callback(`Intel ${coord}`, `intel:${coord}`),
    Markup.button.url("Map", mapUrl(galaxyFromCoord(coord), coord))
  ]));
}

async function intelKeyboard(coord) {
  const rows = [[Markup.button.url("Open Map", mapUrl(galaxyFromCoord(coord), coord))]];
  if (coord.split(":").length === 4) {
    rows.push([Markup.button.callback("Claim 4h", `claim4h:${coord}`)]);
    const base = await fetchOne("b24_bases", { coord }, mapIdForCoord(coord));
    const ownerButtons = [];
    if (base?.guild) ownerButtons.push(Markup.button.callback(`Bases ${base.guild}`, `bases:${encodeButtonValue(base.guild)}`));
    if (base?.label) ownerButtons.push(Markup.button.callback(`Bases ${base.label}`.slice(0, 40), `bases:${encodeButtonValue(base.label)}`));
    if (ownerButtons.length) rows.push(ownerButtons);
  }
  return Markup.inlineKeyboard(rows);
}

function encodeButtonValue(value) {
  return encodeURIComponent(String(value || "")).slice(0, 48);
}

function decodeButtonValue(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
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
    select: options.select || "*",
    order: options.order || "arrival_at.asc"
  });
  if (options.includeMap !== false) params.set("map_id", `eq.${options.mapId || galaxyToMapId(defaultGalaxy)}`);
  if (options.limit) params.set("limit", String(options.limit));
  Object.entries(filters).forEach(([key, value]) => params.set(key, value));
  return requestRows(table, params);
}

async function fetchRowsWithCount(table, filters, options = {}) {
  const params = new URLSearchParams({
    select: options.select || "*",
    order: options.order || "arrival_at.asc"
  });
  if (options.includeMap !== false) params.set("map_id", `eq.${options.mapId || galaxyToMapId(defaultGalaxy)}`);
  Object.entries(filters).forEach(([key, value]) => params.set(key, value));
  const from = Number.isInteger(options.from) ? options.from : 0;
  const to = Number.isInteger(options.to) ? options.to : from + (options.limit || 1000) - 1;
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "count=exact",
      Range: `${from}-${to}`
    }
  });
  if (!response.ok) {
    console.error(`${table} counted lookup failed`, await response.text());
    return { rows: [], count: 0 };
  }
  const contentRange = response.headers.get("content-range") || "";
  const count = Number(contentRange.split("/")[1]);
  return {
    rows: await response.json(),
    count: Number.isFinite(count) ? count : NaN
  };
}

async function fetchAllRows(table, filters, options = {}) {
  const pageSize = options.pageSize || 1000;
  const all = [];
  let count = NaN;
  for (let from = 0; from < 20000; from += pageSize) {
    const result = await fetchRowsWithCount(table, filters, {
      ...options,
      from,
      to: from + pageSize - 1
    });
    all.push(...result.rows);
    count = result.count;
    if (!result.rows.length || result.rows.length < pageSize || (Number.isFinite(count) && all.length >= count)) break;
  }
  return all;
}

function fetchActiveClaims(galaxy, chatId = "") {
  const filters = {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  };
  if (chatId) filters.chat_id = `eq.${chatId}`;
  return fetchRows("b24_claims", filters, { mapId: galaxyToMapId(galaxy), order: "arrival_at.asc" });
}

async function fetchBoardClaims(galaxy, chatId = "") {
  const allClaims = await fetchActiveClaims(galaxy);
  return allClaims.filter((claim) => {
    if (claim.operation_id) return false;
    if (!claim.chat_id) return true;
    return chatId && String(claim.chat_id) === String(chatId);
  });
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
    cancelled_at: "is.null",
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

async function fetchClaimsByOperation(operations) {
  const entries = await Promise.all(operations.map(async (operation) => {
    const claims = await fetchRows("b24_claims", {
      operation_id: `eq.${operation.operation_id}`,
      status: "eq.active"
    }, { mapId: operation.map_id, order: "target_coord.asc" });
    return [operation.operation_id, claims];
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

function operationRow(ctx, { type, targetCoord = "", defendedCoord = "", hostileOrigin = "", arrivalAt, note = "", chatId = "" }) {
  const coord = targetCoord || defendedCoord || hostileOrigin;
  const operationId = randomId();
  const prefixes = { attack: "A", defense: "D", scout: "S" };
  const shortId = `${prefixes[type] || "O"}-${operationId.slice(-5).toUpperCase()}`;
  const stamp = new Date().toISOString();
  return {
    map_id: mapIdForCoord(coord),
    operation_id: operationId,
    short_id: shortId,
    chat_id: chatId || chatScopeId(ctx),
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
  const userId = telegramUserId(ctx);
  const existing = await fetchOne("b24_operation_members", {
    operation_id: operation.operation_id,
    user_id: userId
  }, operation.map_id);
  const launchAt = travelMinutes ? new Date(new Date(operation.arrival_at).getTime() - travelMinutes * 60 * 1000).toISOString() : null;
  const patch = {
    display_name: telegramName(ctx),
    state,
    updated_at: stamp
  };
  if (note) {
    if (state === "joined") patch.role = note;
    else patch.note = note;
  }
  if (travelMinutes) {
    patch.travel_minutes = travelMinutes;
    patch.launch_at = launchAt;
  }
  if (state === "sent") patch.sent_at = stamp;
  if (state === "withdrawn") patch.withdrawn_at = stamp;

  if (existing) {
    return updateRows("b24_operation_members", patch, {
      map_id: `eq.${operation.map_id}`,
      operation_id: `eq.${operation.operation_id}`,
      user_id: `eq.${userId}`
    });
  }

  return insertRow("b24_operation_members", {
    map_id: operation.map_id,
    operation_id: operation.operation_id,
    user_id: userId,
    display_name: telegramName(ctx),
    role: state === "joined" && note ? note : "",
    fleet_label: "",
    fleet_value: "",
    travel_minutes: travelMinutes || null,
    launch_at: launchAt,
    state,
    sent_at: state === "sent" ? stamp : null,
    arrived_at: null,
    withdrawn_at: state === "withdrawn" ? stamp : null,
    note: state !== "joined" ? note : "",
    created_at: stamp,
    updated_at: stamp
  });
}

async function findOperation(ctx, shortId) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return null;
  return fetchOne("b24_operations", {
    short_id: normalizeShortId(shortId),
    chat_id: scopeId,
    status: "active"
  }, galaxyToMapId(galaxy));
}

async function findActiveOperationByTarget(mapId, chatId, type, column, coord) {
  if (!coord) return null;
  const rows = await fetchRows("b24_operations", {
    chat_id: `eq.${chatId}`,
    type: `eq.${type}`,
    [column]: `eq.${coord}`,
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  }, { mapId, order: "arrival_at.asc", limit: 1 });
  return rows[0] || null;
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
      if (!(await shouldSendNotification(notification))) {
        await cancelNotification(notification);
        continue;
      }
      const target = notification.user_id || notification.chat_id;
      if (!target) continue;
      await bot.telegram.sendMessage(target, notification.message || "VisionBot reminder");
      await markNotificationSent(notification);
    } catch (error) {
      console.error("notification send failed", notification.notification_id, error?.message || error);
    }
  }
}

async function shouldSendNotification(notification) {
  if (!notification.operation_id) return true;
  const operation = await findOperationById(notification.operation_id);
  if (!operation || operation.status !== "active") return false;
  if (notification.user_id && /^launch_/.test(notification.notification_type || "")) {
    const member = await fetchOne("b24_operation_members", {
      operation_id: notification.operation_id,
      user_id: notification.user_id
    }, notification.map_id);
    if (!member || member.state === "withdrawn" || member.state === "sent" || member.state === "arrived") return false;
  }
  return true;
}

function cancelNotification(notification) {
  return updateRows("b24_scheduled_notifications", {
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, {
    map_id: `eq.${notification.map_id}`,
    notification_id: `eq.${notification.notification_id}`
  });
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
  if (target) rows.push([Markup.button.url("Open Target", mapUrl(galaxyFromCoord(target), target))]);
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

function attackPlanKeyboard(operation, claims) {
  const rows = [];
  const firstTarget = claims[0]?.target_coord || operation.target_coord || "";
  if (firstTarget) rows.push([Markup.button.url("Open First Target", mapUrl(galaxyFromCoord(firstTarget), firstTarget))]);
  rows.push([
    Markup.button.callback("Status", `op:status:${operation.operation_id}`),
    Markup.button.callback("Stand down", `op:close:${operation.operation_id}`)
  ]);
  return Markup.inlineKeyboard(rows);
}

function formatClaimLine(claim) {
  const note = claim.note ? ` - ${escapeHtml(claim.note)}` : "";
  const status = claim.confirmed_sent ? "confirmed" : "planned";
  return `${escapeHtml(claim.target_coord)} - ${escapeHtml(claim.claimed_by || "Unknown")} - ${formatEta(new Date(claim.arrival_at))} - ${status}${note}`;
}

function formatOperationLine(operation, members = [], claims = []) {
  const target = operation.type === "defense"
    ? `${operation.defended_coord || "?"} <= ${operation.hostile_origin || "?"}`
    : operation.target_coord || "?";
  const activeMembers = members.filter((member) => member.state !== "withdrawn");
  const stateCounts = countBy(activeMembers, "state");
  const sent = stateCounts.sent || 0;
  const ready = stateCounts.ready || 0;
  const joined = activeMembers.length;
  const targetSummary = claims.length
    ? ` - ${claims.filter((claim) => claim.claimed_by_user_id).length}/${claims.length} targets claimed`
    : "";
  const claimLines = operation.type === "attack" && claims.length
    ? claims.slice(0, 6).map((claim) => {
      const claimer = claim.claimed_by ? ` by ${claim.claimed_by}` : " open";
      return `  ${claim.target_coord}${claimer} - ${formatEta(new Date(claim.arrival_at))}`;
    }).join("\n")
    : "";
  const line = `${escapeHtml(operation.short_id)} ${escapeHtml(operation.type)} ${escapeHtml(target)} - ${formatEta(new Date(operation.arrival_at))} - ${joined} joined / ${ready} ready / ${sent} sent${escapeHtml(targetSummary)}`;
  return claimLines ? `${line}\n${escapeHtml(claimLines)}` : line;
}

function formatBoardClaimLine(claim) {
  const target = claim.target_coord || "?";
  const claimer = claim.claimed_by ? ` by ${claim.claimed_by}` : "";
  const note = claim.note ? ` - ${claim.note}` : "";
  const sent = claim.confirmed_sent ? " - sent confirmed" : "";
  return `App claim ${escapeHtml(target)} - ${formatEta(new Date(claim.arrival_at))}${escapeHtml(claimer)}${escapeHtml(note)}${sent}`;
}

async function operationIntelSummary(operation) {
  if (operation.type === "defense") {
    const defended = operation.defended_coord ? await coordIntelSummary(operation.defended_coord) : "Defended: no coordinate";
    const hostile = operation.hostile_origin ? await coordIntelSummary(operation.hostile_origin) : "Hostile: no coordinate";
    return `Defended ${defended}\nIntel: Hostile ${hostile}`;
  }
  return coordIntelSummary(operation.target_coord);
}

async function coordIntelSummary(coord) {
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
  const activeMembers = members.filter((member) => member.state !== "withdrawn");
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
  lines.push("", `<b>Members</b> (${activeMembers.length})`);
  lines.push(...(activeMembers.length ? activeMembers.map(formatOperationMemberLine) : ["No one joined yet."]));
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

function parseAttackPlan(text, fallbackGalaxy) {
  const body = String(text || "").trim().replace(/^[!$]attack\s+/i, "").trim();
  const timeMatch = body.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\s+([\s\S]+)$/i);
  if (!timeMatch) return null;

  const start = parseClockTime(timeMatch[1], timeMatch[2], timeMatch[3]);
  if (!start) return null;

  const rest = timeMatch[7] || "";
  const coords = extractAstroCoords(rest, fallbackGalaxy);
  if (coords.length < 2) return null;

  const note = rest
    .replace(/B?\d{2}[:\s]?\d{1,2}[:\s]\d{1,2}[:\s]\d{1,2}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    label: start.label,
    arrivalAt: nextClockTime(start.label),
    coords,
    note
  };
}

function parseTargetClaim(text, fallbackGalaxy) {
  const match = String(text || "").trim().match(targetClaimPattern);
  if (!match) return null;

  const shortId = normalizeShortId(match[2]);
  const parsed = parseCoordinate(match[3], fallbackGalaxy);
  if (!parsed || parsed.kind !== "astro") return null;

  const timed = parseClaimTime(parsed.remainder);
  if (!timed) return null;

  return {
    shortId,
    coord: parsed.coord,
    arrivalAt: timed.arrivalAt,
    label: timed.label,
    note: timed.note
  };
}

function parseClaimTime(value) {
  const raw = String(value || "").trim();
  const minuteMatch = raw.match(/^:?\s*(\d{1,4})(?:m|min|minutes)?(?:\s+(.+))?$/i);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (!validMinutes(minutes)) return null;
    const arrivalAt = new Date(Date.now() + minutes * 60 * 1000);
    return {
      arrivalAt,
      label: formatClockLabel(arrivalAt),
      note: String(minuteMatch[2] || "").trim()
    };
  }

  const timeMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(.+))?$/i);
  if (!timeMatch) return null;
  const parsed = parseClockTime(timeMatch[1], timeMatch[2], timeMatch[3]);
  if (!parsed) return null;
  return {
    arrivalAt: nextClockTime(parsed.label),
    label: parsed.label,
    note: String(timeMatch[4] || "").trim()
  };
}

function extractAstroCoords(text, fallbackGalaxy) {
  const results = [];
  const seen = new Set();
  const raw = String(text || "");
  const regex = /(B\d{2})?\s*:?\s*(\d{1,2})\s*[: ]\s*(\d{1,2})\s*[: ]\s*(\d{1,2})/gi;
  let match;
  while ((match = regex.exec(raw))) {
    const galaxy = normalizeGalaxy(match[1]) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
    const nums = [match[2], match[3], match[4]].map(Number);
    if (!nums.every(validCoordPart)) continue;
    const coord = [galaxy, ...nums.map((num) => String(num).padStart(2, "0"))].join(":");
    if (!seen.has(coord)) {
      seen.add(coord);
      results.push(coord);
    }
  }
  return results;
}

function parseClockTime(hourValue, minuteValue = "00", ampm = "") {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const suffix = String(ampm || "").toLowerCase();
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "pm" && hour !== 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23) return null;
  return { label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

function nextClockTime(label) {
  const [hour, minute] = String(label || "").split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date;
}

function formatClockLabel(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseOperationAction(text) {
  const body = String(text || "").trim().replace(/^[!$](op\s+\w+|join|respond|ready|sent|leave|standdown|cancelop)\s*/i, "").trim();
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

function launchIsPast(operation, travelMinutes) {
  const launchAt = new Date(operation.arrival_at).getTime() - travelMinutes * 60 * 1000;
  return Number.isFinite(launchAt) && launchAt <= Date.now();
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

function isPrivateChat(ctx) {
  return ctx.chat?.type === "private";
}

function chatTitle(ctx) {
  return ctx.chat?.title || ctx.chat?.username || (ctx.chat?.id ? String(ctx.chat.id) : "this chat");
}

async function rememberActiveChat(ctx) {
  if (!ctx.from?.id || isPrivateChat(ctx) || !ctx.chat?.id) return false;
  const galaxy = await galaxyForContext(ctx);
  return upsertRow("b24_user_settings", {
    user_id: telegramUserId(ctx),
    galaxy,
    map_id: galaxyToMapId(galaxy),
    active_chat_id: String(ctx.chat.id),
    active_chat_label: chatTitle(ctx),
    updated_at: new Date().toISOString()
  }, "user_id");
}

async function operationScopeId(ctx) {
  if (!isPrivateChat(ctx)) return chatScopeId(ctx);
  if (!ctx.from?.id) return "";
  const settings = await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false);
  const activeChatId = settings?.active_chat_id || "";
  if (approvedChatIds.length && !approvedChatIds.includes(activeChatId)) return "";
  return activeChatId;
}

function parseLookupCommand(text, fallbackGalaxy = defaultGalaxy) {
  const trimmed = String(text || "").trim();
  const mode = trimmed[0];
  if (mode !== "!" && mode !== "$") return null;
  if (/^[!$]help\b/i.test(trimmed)) return null;

  const parsed = parseLocation(trimmed.slice(1), fallbackGalaxy);
  if (!parsed) return null;
  return { mode, ...parsed };
}

function parseLocation(value, fallbackGalaxy = defaultGalaxy) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;

  let working = raw.replace(/^!|\$/g, "").trim();
  let galaxy = normalizeGalaxy((working.match(/\bB\d{2}\b/) || [])[0]) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;

  if (working.startsWith(galaxy)) {
    working = working.slice(galaxy.length).trim();
  } else {
    const galaxyDigits = galaxy.slice(1);
    const leading = working.match(/^:?\s*(\d{2})(?=\D|$)([\s\S]*)$/);
    if (leading && leading[1] === galaxyDigits) {
      working = leading[2].trim();
    }
  }

  if (!working || working === ":" || working === galaxy.slice(1)) {
    return { kind: "galaxy", galaxy, coord: galaxy, remainder: "" };
  }

  const numberMatches = [...working.matchAll(/\d{1,2}/g)];
  if (!numberMatches.length) return null;
  const nums = numberMatches.slice(0, 3).map((match) => Number(match[0]));
  if (!nums.length || !nums.every(validCoordPart)) return null;
  const lastMatch = numberMatches[Math.min(numberMatches.length, 3) - 1];
  const remainder = working.slice(lastMatch.index + lastMatch[0].length).trim();
  const padded = nums.map((num) => String(num).padStart(2, "0"));

  if (nums.length === 1) {
    return { kind: "region", galaxy, coord: `${galaxy}:${nums[0]}`, remainder };
  }
  if (nums.length === 2) {
    return { kind: "system", galaxy, coord: `${galaxy}:${padded[0]}:${padded[1]}`, remainder };
  }
  return { kind: "astro", galaxy, coord: `${galaxy}:${padded[0]}:${padded[1]}:${padded[2]}`, remainder };
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

function parseScoutRequest(value, fallbackGalaxy) {
  const raw = String(value || "").trim().toUpperCase();
  const galaxy = normalizeGalaxy((raw.match(/B\d{2}/) || [])[0]) || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  let working = raw;
  if (working.startsWith(galaxy)) working = working.slice(galaxy.length).trim();
  else if (working.startsWith(galaxy.slice(1))) working = working.slice(2).trim();

  const match = working.match(/^:?\s*(\d{1,2})(?::|\s+)(\d{1,2})([\s\S]*)$/);
  if (!match) return null;
  const nums = [Number(match[1]), Number(match[2])];
  if (!nums.every(validCoordPart)) return null;
  const padded = nums.map((num) => String(num).padStart(2, "0"));
  return {
    kind: "system",
    galaxy,
    coord: `${galaxy}:${padded[0]}:${padded[1]}`,
    remainder: match[3] || ""
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

function operationRegion(operation) {
  if (!operation) return "";
  if (operation.region_id) return operation.region_id;
  if (operation.defended_region_id) return operation.defended_region_id;
  const coord = operation.target_coord || operation.defended_coord || operation.attacker_coord || operation.hostile_origin || "";
  return coord ? astroToRegion(coord) : "";
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

const webhookHandler = webhookUrl ? bot.webhookCallback(webhookPath) : null;

http.createServer((request, response) => {
  const path = new URL(request.url || "/", "http://localhost").pathname;
  if (webhookHandler && path === webhookPath) {
    console.log(`Webhook request received: ${request.method} ${path}`);
    return webhookHandler(request, response);
  }

  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end(`VisionBot is running\nMode: ${webhookUrl ? "webhook" : "polling"}\n`);
}).listen(port, "0.0.0.0", () => {
  console.log(`Health server listening on ${port}`);
});

startBot().catch((error) => {
  console.error("Bot startup failed", error);
  process.exitCode = 1;
});

async function startBot() {
  if (webhookUrl) {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Telegram webhook set to ${webhookUrl}`);
  } else {
    await bot.telegram.deleteWebhook();
    await bot.launch();
    console.log("Telegram polling started");
  }
  startNotificationWorker();
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
