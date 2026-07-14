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
const webhookPathSecret = process.env.WEBHOOK_PATH_SECRET || token?.slice(-16).replace(/[^a-zA-Z0-9_-]/g, "");
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const requireAccessControl = /^(1|true|yes)$/i.test(process.env.REQUIRE_ACCESS_CONTROL || "");
const accessMemberCache = new Map();

if (!token) throw new Error("BOT_TOKEN is required");
if (!webAppUrl) throw new Error("WEB_APP_URL is required");
if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
if (!supabaseKey) throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required");
if (requireAccessControl) {
  const missing = [
    approvedChatIds.length ? "" : "APPROVED_CHAT_IDS",
    accessChatIds.length ? "" : "ACCESS_CHAT_IDS",
    officerUserIds.length ? "" : "OFFICER_USER_IDS",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? "" : "SUPABASE_SERVICE_ROLE_KEY",
    telegramWebhookSecret ? "" : "TELEGRAM_WEBHOOK_SECRET"
  ].filter(Boolean);
  if (missing.length) throw new Error(`REQUIRE_ACCESS_CONTROL is enabled but missing: ${missing.join(", ")}`);
}

const bot = new Telegraf(token);
const galaxyPattern = /B\d{2}/i;
const claimPattern = /^[!$](claim|attack)\s+(.+)$/i;
const targetClaimPattern = /^[!$](claim|take)\s+([ADS]-?[A-Z0-9]{3,8})\s+(.+)$/i;
const attackedPattern = /^[!$](attacked|sos)\s+(.+)$/i;
const minePattern = /^[!$]mine\s+(.+)$/i;
const saveMePattern = /^[!$]save\s+me\s+(.+)$/i;
const staleIntelMs = 24 * 60 * 60 * 1000;
const webhookPath = `/telegram-${webhookPathSecret}`;
const webhookUrl = webhookBaseUrl ? `${webhookBaseUrl}${webhookPath}` : "";
const botBuild = "2026-07-14.2";
const preferredCommandAliases = {
  help: ["h", "he", "hel", "help"],
  ohelp: ["oh", "ohelp"],
  onboardme: ["enlist", "on", "onboard", "onboardme"],
  status: ["st", "status"],
  buildplan: ["bp", "buildplan"],
  scout: ["sc", "scout"],
  scoutings: ["scoutings"],
  astros: ["as", "ast", "astr", "astro", "astros"],
  sectors: ["sec", "sector", "sectors"],
  report: ["rep", "repo", "repor", "report"],
  attacks: ["attacks"],
  friend: ["fr", "fri", "frie", "frien", "friend"],
  enemy: ["e", "en", "ene", "enem", "enemy"]
};
const canonicalCommands = [
  "help", "ohelp", "onboardme", "approve", "officer", "demote", "ban", "access",
  "status", "version", "map", "wakeup", "buildplan", "g", "setgalaxy", "guild",
  "claim", "take", "attack", "scout", "scoutings", "attacked", "sos", "intel", "astros",
  "stale", "score", "bases", "sectors", "op", "join", "respond", "ready", "sent", "leave",
  "standdown", "cancelop", "board", "defense", "next", "myops", "incoming", "report", "attacks",
  "targets", "claimed", "mine", "me", "friend", "enemy"
];

const buildPlans = new Map([
  [1, { scope: "your current base", build: "8 MR / 4 RF / 8 SY / 5 SPO / 3 CM / 5 CM", next: 2 }],
  [2, { scope: "BOTH bases", build: "7 MR / 2 RF / 2 SY / 5 SPO / 5 CM", next: 3 }],
  [3, { scope: "ALL 3 bases", build: "8 MR / 3 RF / 3 SY / 5 SPO / 7 CM", next: 4 }],
  [4, { scope: "ALL 4 bases", build: "9 MR / 4 RF / 4 SY / 5 SPO / 8 CM", next: 5 }],
  [5, { scope: "ALL 5 bases", build: "10 MR / 5 RF / 4 SY / 10 SPO / 9 CM", next: 6 }],
  [6, { scope: "ALL 6 bases", build: "11 MR / 6 RF / 5 SY / 1 NF / 2 EC / 10 SPO / 10 CM", next: 7 }],
  [7, { scope: "ALL 7 bases", build: "12 MR / 7 RF / 6 SY / 2 NF / 3 EC / 10 SPO / 11 CM", next: 8 }],
  [8, { scope: "ALL 8 bases", build: "13 MR / 8 RF / 8 SY / 3 NF / 4 EC / 15 SPO / 12 CM", next: 9 }],
  [9, { scope: "ALL 9 bases", build: "14 MR / 9 RF / 8 SY / 4 NF / 5 EC / 15 SPO / 14 CM", next: 10 }],
  [10, { scope: "ALL 10 bases", build: "15 MR / 10 RF / 8 SY / 5 NF / 6 EC / 15 SPO / 15 CM", next: 11 }],
  [11, { scope: "ALL 11 bases", build: "16 MR / 11 RF / 8 SY / 6 NF / 7 EC / 1 AF / 15 SPO / 16 CM", next: 12 }],
  [12, { scope: "ALL 12 bases", build: "17 MR / 12 RF / 8 SY / 7 NF / 8 EC / 2 AF / 20 SPO / 17 CM", next: 13 }],
  [13, { scope: "ALL 13 bases", build: "20 MR / 15 RF / 16 SY / 10 NF / 11 EC / 5 AF / 20 SPO / 20 CM / 3 CAP", next: 14 }],
  [14, { scope: "ALL 14 bases", build: "22 MR / 17 RF / 16 SY / 1 OSY / 12 NF / 14 EC / 7 AF / 20 SPO / 21 CM / 5 CAP", next: 15 }],
  [15, { scope: "ALL 15 bases", build: "24 MR / 17 RF / 16 SY / 4 OSY / 14 NF / 14 EC / 9 AF / 25 SPO / 22 CM / 7 CAP", next: 16 }],
  [16, { scope: "ALL 16 bases", build: "25 MR / 17 RF / 18 SY / 5 OSY / 15 NF / 16 EC / 10 AF / 25 SPO / 22 CM / 9 CAP", next: 17 }]
]);

bot.use(async (ctx, next) => {
  const text = ctx.message?.text || ctx.channelPost?.text || ctx.callbackQuery?.data || "";
  console.log(`Telegram update ${ctx.updateType || "unknown"} chat=${ctx.chat?.id || "none"} from=${ctx.from?.id || "none"} text=${sanitizeLogText(text)}`);
  return next();
});

bot.catch((error, ctx) => {
  console.error("Unhandled bot error", {
    updateType: ctx?.updateType || "unknown",
    chat: ctx?.chat?.id || "none",
    from: ctx?.from?.id || "none",
    message: error?.message || String(error)
  });
  if (ctx?.reply) {
    return ctx.reply("Lysander hit an internal error while handling that. Try again in a moment.");
  }
});

bot.start(handleStart);
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
bot.action(/^attackpool:([A-Z]-[A-Z0-9]{3,8})(?::(\d{1,3}))?(?::(B\d{2}:\d{2}:\d{2}:\d{2}))?$/, handleAttackPoolButton);
bot.action(/^attacktake:([A-Z]-[A-Z0-9]{3,8}):(B\d{2}:\d{2}:\d{2}:\d{2}):(\d{1,3})(?::(\d{1,3}))?$/, handleAttackTakeButton);
bot.action(/^attackadd:([A-Z]-[A-Z0-9]{3,8}):(B\d{2}:\d{2}:\d{2}:\d{2})$/, handleAttackAddButton);
bot.action(/^quickattack:(\d):(B\d{2}):(.*)$/, handleQuickAttackButton);
bot.action(/^quickscout:(B\d{2}):(.*)$/, handleQuickScoutButton);
bot.action(/^scoutagenda:(B\d{2}):(G-[A-Z0-9]{5})$/, handleScoutAgendaButton);
bot.action(/^scoutwatchlist:(B\d{2}):(G-[A-Z0-9]{5}):(\d{1,3})$/, handleScoutWatchListButton);
bot.action(/^scoutwatchtarget:(B\d{2}):(G-[A-Z0-9]{5}):(\d{1,3})$/, handleScoutWatchTargetButton);
bot.action(/^scoutwatchtake:(B\d{2}):(G-[A-Z0-9]{5}):(\d{1,3})$/, handleScoutWatchTakeButton);
bot.action(/^scoutwatchrelease:(B\d{2}):(G-[A-Z0-9]{5}):(\d{1,3})$/, handleScoutWatchReleaseButton);
bot.action(/^scoutagendaattack:(B\d{2}):(G-[A-Z0-9]{5}):(\d)$/, handleScoutAgendaAttackButton);
bot.action(/^scoutagendacancel:(B\d{2}):(G-[A-Z0-9]{5})$/, handleScoutAgendaCancelButton);
bot.action(/^defpool:(\d{1,3})$/, handleDefensePoolButton);
bot.action(/^defcover:([^:]+):(\d{1,3})$/, handleDefenseCoverButton);
bot.action("quick:next", handleQuickNextButton);
bot.action(/^noop:(.+)$/, async (ctx) => ctx.answerCbQuery(String(ctx.match?.[1] || "").slice(0, 80)));

async function sendMapButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    return ctx.reply("You do not have permission to open the VisionBot map.");
  }
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  return ctx.reply(
    `${galaxy} Vision Tracker`,
    Markup.inlineKeyboard([
      Markup.button.url("Open Map", mapUrl(galaxy, "", scopeId))
    ])
  );
}

async function handleStart(ctx) {
  const hasAccess = await userCanUseSensitiveCommands(ctx);
  const lines = [
    "<b>Lysander</b>",
    "Guild intel and operations assistant.",
    "",
    hasAccess ? "Access: active" : "Access: not active yet",
    "",
    "Start here:",
    "<code>!enlist</code> - request or refresh your access",
    "<code>!help</code> - show normal commands",
    "<code>!map</code> - open the map after access is active"
  ];
  const options = { parse_mode: "HTML" };
  if (hasAccess) {
    const galaxy = await galaxyForContext(ctx);
    const scopeId = await operationScopeId(ctx);
    Object.assign(options, Markup.inlineKeyboard([
      [
        Markup.button.url("Open Map", mapUrl(galaxy, "", scopeId)),
        Markup.button.callback("Next", "quick:next")
      ]
    ]));
  }
  return ctx.reply(lines.join("\n"), options);
}

async function handleQuickNextButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for next actions.");
    return;
  }
  await ctx.answerCbQuery("Next actions");
  return handleNext(ctx, "!next", "!");
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
  if (isCommand(lower, "ohelp")) return handleOfficerHelp(ctx, mode);
  if (isCommand(lower, "onboardme")) return handleOnboardMe(ctx, text, mode);
  if (isCommand(lower, "approve") || isCommand(lower, "officer") || isCommand(lower, "demote") || isCommand(lower, "ban") || isCommand(lower, "access")) {
    return handleAccessCommand(ctx, text, mode);
  }
  if (isExactCommand(lower, "status")) return ctx.reply(statusReport(ctx));
  if (isExactCommand(lower, "version")) return ctx.reply(versionReport());
  if (isExactCommand(lower, "map")) return sendMapButton(ctx);
  if (isExactCommand(lower, "wakeup")) return handleWakeup(ctx, mode);
  if (isCommand(lower, "buildplan")) return handleBuildPlan(ctx, text, mode);
  if (isCommand(lower, "g")) return handleUserGalaxy(ctx, text, mode);
  if (isCommand(lower, "setgalaxy")) return handleChatGalaxy(ctx, text, mode);
  if (isCommand(lower, "guild")) return handleGuild(ctx, text, mode);

  if (isProtectedOperationalCommand(lower) && !isPrivateChat(ctx)) await rememberActiveChat(ctx);

  if (isCommand(lower, "claim") || isCommand(lower, "take") || isCommand(lower, "attack")) return handleClaim(ctx, text, mode);
  if (isCommand(lower, "attacks")) return handleAttacks(ctx, text, mode);
  if (isCommand(lower, "scoutings")) return handleScoutings(ctx, text, mode);
  if (isCommand(lower, "scout")) return handleScout(ctx, text, mode);
  if (isCommand(lower, "attacked") || isCommand(lower, "sos")) return handleAttacked(ctx, text, mode);
  if (isCommand(lower, "report")) return handleIncomingReport(ctx, text, mode);
  if (isCommand(lower, "intel")) return handleIntel(ctx, text, mode);
  if (isAstrosCommand(lower)) return handleAstros(ctx, text, mode);
  if (isCommand(lower, "sectors")) return handleSectors(ctx, text, mode);
  if (isCommand(lower, "stale")) return handleStale(ctx, text, mode);
  if (isCommand(lower, "score")) return handleScore(ctx, text, mode);
  if (isCommand(lower, "bases")) return handleBases(ctx, text, mode);
  if (isCommand(lower, "friend")) return handleStance(ctx, text, mode, "friend");
  if (isCommand(lower, "enemy")) return handleStance(ctx, text, mode, "enemy");
  if (isCommand(lower, "op")) return handleOp(ctx, text, mode);
  if (isCommand(lower, "join") || isCommand(lower, "respond")) return handleOperationMember(ctx, text, mode, "joined");
  if (isCommand(lower, "ready")) return handleOperationMember(ctx, text, mode, "ready");
  if (isCommand(lower, "sent")) return handleOperationMember(ctx, text, mode, "sent");
  if (isCommand(lower, "leave")) return handleOperationMember(ctx, text, mode, "withdrawn");
  if (isCommand(lower, "standdown") || isCommand(lower, "cancelop")) return handleCloseOperation(ctx, text, mode);
  if (isCommand(lower, "defense")) return handleDefensePool(ctx, text, mode);
  if (isCommand(lower, "board")) return handleBoard(ctx, text, mode);
  if (isCommand(lower, "next") || isExactCommand(lower, "myops")) return handleNext(ctx, text, mode);
  if (isCommand(lower, "incoming")) return handleIncoming(ctx, text, mode);
  if (isExactCommand(lower, "targets")) return handleTargets(ctx, mode);
  if (isExactCommand(lower, "claimed")) return handleClaimed(ctx, mode);
  if (isCommand(lower, "mine")) return handleMine(ctx, text, mode);
  if (isCommand(lower, "me")) return handleMe(ctx, text, mode);
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
  const scopeId = await operationScopeId(ctx);
  const report = await buildLocationReport(lookup, { includeSavedBases, scopeId });

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
  const scopeId = await operationScopeId(ctx);
  const report = coord.split(":").length === 3
    ? await buildSystemReport(coord, { includeSavedBases, scopeId })
    : await buildAstroReport(coord, { includeSavedBases, scopeId });
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
  try {
    return await respond(ctx, mode, await helpText(ctx, text), { parse_mode: "HTML" });
  } catch (error) {
    console.error("help command failed", error?.message || error);
    return ctx.reply(basicHelpText());
  }
}

async function handleOfficerHelp(ctx, mode) {
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    return respond(ctx, mode, "Officer help is only available to Lysander officers/owners.");
  }
  return respond(ctx, mode, officerHelpText(), { parse_mode: "HTML" });
}

async function helpText(ctx, input = "") {
  const topic = commandName(String(input).trim().split(/\s+/)[1] || "");
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
      "<code>!attack 02:00 clowntown 4</code>",
      "Creates a simple attack plan: time, name, number of hourly waves.",
      "<code>!attacks</code>",
      "Lists active attack plans as numbered rows.",
      "<code>!attacks 1</code>",
      "Opens attack #1 target pool.",
      "<code>!attack add 1 24324510, 24351330, paste, paste</code>",
      "Officer-only: adds targets to a numbered attack plan.",
      "<code>!take A-7K4P9 [coord] 02:30 [note]</code>",
      "Claims one target from that pool at your chosen arrival time.",
      "",
      "<code>$attack 02:00 [coord] [coord] [note]</code>",
      "Older shortcut: creates a pool and adds targets in one command.",
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
      "Requests fresh scouting. Use a full base coordinate when you need orbit/fleet surveillance.",
      "If minutes are omitted, it stays active for 4 hours.",
      "<code>$scout B24:45:21:10 240 orbit watch</code>",
      "Ask someone to park a scout at that exact enemy base coordinate.",
      "<code>$scoutings</code>",
      "Shows persistent base-watch agendas created from a base list. Officers can turn an agenda into an attack pool or cancel it.",
      "<code>$sectors [APP]</code>",
      "Find sectors near APP-held sectors that do not already contain an APP base.",
      "<code>$sectors B24 near [APP] not [APP]</code>",
      "Explicit version of the same region-level scouting query.",
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
      "<code>!intel [coord] [TAG]</code> - officer-only manual alliance assessment",
      "<code>!friend [tag|coord]</code> - show matching intel with a green dot",
      "<code>!enemy [tag|coord]</code> - show matching intel with a red dot",
      "",
      "Examples:",
      "<code>!B24:34:06:10</code>",
      "<code>!intel B24:34:06:10</code>",
      "<code>!intel 24452110 [ROTC]</code>",
      "<code>$B23:44:76:20</code>",
      "<code>!B24 02 76 10</code>",
      "<code>!24 02 76 10</code>",
      "<code>!24027610</code>",
      "<code>!B24:02:76</code> - list all known astros in a system",
      "<code>$sectors [APP]</code> - list scout candidate sectors near APP",
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
      "<b>Report new incoming</b>",
      "<code>$report [attacker] [defended] [eta] [size] [note]</code>",
      "Quick report format. ETA can be minutes, <code>1:30</code>, or <code>1:12:03</code>.",
      "<code>!sos [your base] [attacker coord] [eta minutes] [note]</code>",
      "<code>$sos [your base] [attacker coord] [eta minutes] [note]</code>",
      "Creates a defense operation when the defended base is known.",
      "<code>$report [pasted rows]</code>",
      "Import copied incoming rows that contain source, destination, ETA, and optional size.",
      "",
      "<b>View incoming</b>",
      "<code>$incoming [coord|system|region|tag]</code>",
      "Show active hostile incoming for a base, system, sector, or guild tag.",
      "<code>$incoming clear [coord|system|region|tag|all]</code>",
      "Clear false incoming reports.",
      "",
      "Examples:",
      "<code>$report B24:18:40:10 B24:34:64:40 1:12:03 8,950</code>",
      "<code>$sos B24:45:10:30 B24:34:06:10 25 incoming dread</code>",
      "<code>!attacked B24:45:10:30 B24:34:06:10 25 incoming dread</code>",
      "<code>$incoming B24:36</code>",
      "<code>$incoming [APP]</code>",
      "<code>$incoming clear B24:36</code>"
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
      "<code>$bases B24 [ROTC]</code> - list bases for a tag in a specific galaxy",
      "",
      "Example:",
      "<code>!save me B24:06:10:20 needs defense</code>",
      "<code>$bases storebo</code>",
      "<code>$bases B24 rotc page 2</code>"
    ],
    alerts: [
      "<b>Alerts Help</b>",
      "",
      "<code>!watch mybases</code>, <code>!watch [coord]</code>, and <code>!digest [hours]</code> are planned but not implemented yet.",
      "Current reminders are operation launch/arrival reminders."
    ],
    doctrine: [
      "<b>Doctrine Help</b>",
      "",
      "<code>!buildplan [1-16]</code>",
      "Shows the guild base doctrine for that expansion stage.",
      "<code>!bp [1-16]</code>",
      "Short alias.",
      "",
      "Examples:",
      "<code>!buildplan 1</code>",
      "<code>!buildplan 12</code>"
    ],
    buildplan: [
      "<b>Doctrine Help</b>",
      "",
      "<code>!buildplan [1-16]</code>",
      "Shows the guild base doctrine for that expansion stage.",
      "<code>!bp [1-16]</code>",
      "Short alias.",
      "",
      "Examples:",
      "<code>!buildplan 1</code>",
      "<code>!buildplan 12</code>"
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

  const status = await safeHelpStatus(ctx);
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
    "<code>!attack 02:00 clowntown 4</code>",
    "<code>!attacks</code> / <code>!attack add 1 [coords]</code>",
    "<code>$attack [target] [eta-min] [note]</code>",
    "<code>$sos [defended] [hostile] [eta-min] [note]</code>",
    "<code>$report [attacker] [defended] [eta] [size]</code>",
    "<code>$scout [coord] [due-min] [note]</code>",
    "",
    "<b>PARTICIPATE</b>",
    "<code>!take [attack-ID] [coord] [arrival-time]</code>",
    "<code>!join A-7K4P9 [travel-min] [role]</code>",
    "<code>!respond D-4M8Q2 [travel-min] [role]</code>",
    "<code>!ready [ID]</code>  <code>!sent [ID]</code>  <code>!leave [ID]</code>",
    "",
    "<b>MANAGE</b>",
    "<code>$board [attack|defense|scout]</code>  <code>$scoutings</code>  <code>/board</code>",
    "<code>$op [ID]</code>  <code>$standdown [ID] [reason]</code>",
    "",
    "<b>INTEL</b>",
    "<code>![coord]</code>  <code>$[coord]</code>",
    "<code>!intel</code>  <code>!sectors [APP]</code>  <code>!stale</code>  <code>!score</code>",
    "<code>!friend [tag|coord]</code>  <code>!enemy [tag|coord]</code>",
    "",
    "<b>PERSONAL</b>",
    "<code>!next</code>  <code>!me</code>  <code>!mine [coord]</code>  <code>!bases [player]</code>",
    "<code>!buildplan [1-16]</code> - guild base doctrine",
    "",
    "<b>HELP</b>",
    "<code>!help [topic]</code>",
    "Topics: setup, attack, defense, scout, operations, intel, incoming, bases, doctrine, guild, alerts, aliases",
    "",
    "Officers: <code>$ohelp</code>"
  ].join("\n");
}

function officerHelpText() {
  return [
    "<b>Officer Commands</b>",
    "",
    "<b>Access</b>",
    "<code>$enlist</code> - create/update your access request",
    "<code>$approve [user]</code> - approve a member",
    "<code>$officer [user]</code> - promote to officer",
    "<code>$demote [user]</code> - demote to member",
    "<code>$ban [user]</code> - block access",
    "<code>$access [user]</code> - show a user's access state",
    "",
    "<b>Operations</b>",
    "<code>$guild bind</code> - bind this group as the active operation group",
    "<code>$setgalaxy B24</code> - set the guild chat galaxy",
    "<code>$attacks</code> - list active attack plans",
    "<code>$attack add [ID] [coord]</code> - add targets to a plan",
    "<code>$standdown [operation-ID] [reason]</code> - close an operation",
    "<code>$incoming clear [coord|system|region|tag|all]</code> - clear false incoming reports",
    "<code>/id</code> - show chat/user IDs for setup",
    "",
    "Tip: reply to someone's message with <code>$approve</code>, <code>$officer</code>, <code>$demote</code>, <code>$ban</code>, or <code>$access</code>."
  ].join("\n");
}

function basicHelpText() {
  return [
    "Lysander Commands",
    "",
    "/status - check bot status",
    "/map - open the map",
    "$help - public help in an approved group",
    "!help - private help",
    "$incoming - show incoming",
    "$report attacker defended eta size - report incoming",
    "$astros B24 craters a85 m4 c2 - search astros",
    "$bases [TAG] - list known bases",
    "!buildplan [1-16] - base doctrine",
    "",
    "Full help had a temporary problem. Check Render logs for the line after: help command failed."
  ].join("\n");
}

async function handleOnboardMe(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "I need a Telegram user to onboard.");
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "Use <code>$onboardme</code> in the guild group first, or bind an active guild with <code>$guild bind</code>.", { parse_mode: "HTML" });
  const accessGroupMember = accessChatIds.length ? await isMemberOfAnyAccessChat(ctx, telegramUserId(ctx)) : false;
  const existing = await fetchAccessMember(scopeId, telegramUserId(ctx));
  if (existing?.status === "banned") return respond(ctx, mode, "Your Lysander access is blocked for this guild.");
  const status = accessGroupMember ? "active" : existing?.status || "pending";
  const role = existing?.role || "member";
  const saved = await upsertAccessMember({
    chatId: scopeId,
    userId: telegramUserId(ctx),
    username: ctx.from.username || "",
    displayName: telegramName(ctx),
    role,
    status,
    approvedBy: accessGroupMember ? "access-group" : existing?.approved_by || "",
    approvedAt: accessGroupMember ? new Date().toISOString() : existing?.approved_at || null
  });
  if (!saved) return respond(ctx, mode, "I could not save your onboarding record. Has the Supabase access table been created?");
  return respond(ctx, mode, status === "active"
    ? `Onboarded as ${role}. Lysander access is active for this guild.`
    : "Onboarding request saved. An officer can approve you with <code>$approve</code>.", { parse_mode: "HTML" });
}

async function handleAccessCommand(ctx, text, mode) {
  if (!(await userCanUseOfficerCommands(ctx))) {
    return respond(ctx, mode, "Only Lysander officers/owners can manage access.");
  }
  const command = commandName(text);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active guild scope. Use this in the guild group or run <code>$guild bind</code> first.", { parse_mode: "HTML" });
  const target = await resolveAccessTarget(ctx, commandBody(text), scopeId);
  if (!target) return respond(ctx, mode, `Use: <code>$${command} @username</code> or reply to a user's message with <code>$${command}</code>.`, { parse_mode: "HTML" });
  if (target.ambiguous?.length) {
    return respond(ctx, mode, [
      `Multiple users match <code>${escapeHtml(commandBody(text))}</code>:`,
      ...target.ambiguous.slice(0, 8).map((row) => `- ${escapeHtml(accessMemberLabel(row))}`)
    ].join("\n"), { parse_mode: "HTML" });
  }

  if (command === "access") {
    const row = target.row || await fetchAccessMember(scopeId, target.userId);
    return respond(ctx, mode, formatAccessStatus(row, target), { parse_mode: "HTML" });
  }

  const next = accessCommandState(command);
  if (!next) return respond(ctx, mode, "Unknown access command.");
  const existing = target.row || await fetchAccessMember(scopeId, target.userId);
  const saved = await upsertAccessMember({
    chatId: scopeId,
    userId: target.userId,
    username: target.username || existing?.username || "",
    displayName: target.displayName || existing?.display_name || target.userId,
    role: next.role || existing?.role || "member",
    status: next.status,
    approvedBy: telegramUserId(ctx),
    approvedAt: next.status === "active" ? new Date().toISOString() : existing?.approved_at || null
  });
  if (!saved) return respond(ctx, mode, "Could not update access. Has the Supabase access table been created?");
  return respond(ctx, mode, `${escapeHtml(target.displayName || existing?.display_name || target.userId)} is now ${next.status}/${next.role || existing?.role || "member"}.`, { parse_mode: "HTML" });
}

function deliveryMode(text) {
  const first = String(text || "").trim()[0];
  return first === "$" ? "$" : "!";
}

function normalizeIncomingText(text) {
  let value = String(text || "").trim();
  value = value.replace(/^@\w+\s+(?=[!$@/])/, "");
  value = value.replace(/\s+@\w+$/, "").trim();
  return value.replace(/^@(status|st|version|ohelp|oh|enlist|onboardme|onboard|on|approve|officer|demote|ban|access|help|hel|he|h|map|g|setgalaxy|guild|buildplan|bp|claim|take|attack|attacks|scoutings|scout|sc|attacked|sos|report|rep|intel|as|ast|astr|astro|astros|sec|sector|sectors|stale|score|bases|friend|fr|enemy|en|op|join|respond|ready|sent|leave|standdown|cancelop|board|defense|next|myops|incoming|targets|claimed|mine|me|wakeup)\b/i, "$$$1");
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
    "attacks",
    "map",
    "buildplan",
    "scout",
    "scoutings",
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
    "report",
    "targets",
    "claimed",
    "intel",
    "a",
    "as",
    "ast",
    "astr",
    "astro",
    "astros",
    "sectors",
    "mine",
    "me",
    "friend",
    "enemy",
    "save me",
    "guild"
  ].some((command) => isCommand(lowerText, command) || isExactCommand(lowerText, command));
}

function isSensitiveOperationalCommand(lowerText) {
  return [
    "claim",
    "take",
    "attack",
    "attacks",
    "map",
    "buildplan",
    "scout",
    "scoutings",
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
    "report",
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
    "sectors",
    "mine",
    "me",
    "friend",
    "enemy",
    "save me",
    "setgalaxy",
    "guild",
    "stale",
    "score"
  ].some((command) => isCommand(lowerText, command) || isExactCommand(lowerText, command));
}

function closestCommand(command) {
  const cleanCommand = commandName(command);
  const commands = ["help", "ohelp", "onboardme", "approve", "officer", "demote", "ban", "access", "status", "map", "buildplan", "attack", "attacks", "claim", "take", "sos", "report", "scout", "intel", "astro", "astros", "sectors", "stale", "score", "bases", "board", "incoming", "targets", "claimed", "join", "ready", "sent", "leave", "mine", "me"];
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

  const scopeId = await operationScopeId(ctx);
  if (scopeId) {
    const access = await fetchAccessMember(scopeId, userId);
    if (access?.status === "banned") return false;
    if (access?.status === "active" && ["member", "officer", "owner"].includes(access.role)) return true;
  }

  if (accessChatIds.length) {
    const accessGroupMember = await isMemberOfAnyAccessChat(ctx, userId);
    if (accessGroupMember) return true;
    if (scopeId) {
      const access = await fetchAccessMember(scopeId, userId);
      if (access && access.status !== "active") return false;
    }
    return false;
  }

  if (isPrivateChat(ctx)) return true;
  return chatApproved(ctx);
}

async function userCanUseOfficerCommands(ctx) {
  if (!ctx.from?.id) return false;
  const userId = telegramUserId(ctx);
  if (officerUserIds.includes(userId)) return true;
  const scopeId = await operationScopeId(ctx);
  if (scopeId) {
    const access = await fetchAccessMember(scopeId, userId);
    if (access?.status === "banned") return false;
    if (access?.status === "active" && ["officer", "owner"].includes(access.role)) return true;
  }
  if (!ctx.chat?.id || isPrivateChat(ctx)) return false;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return member?.status === "creator" || member?.status === "administrator";
  } catch {
    return false;
  }
}

async function safeUserCanUseOfficerCommands(ctx) {
  try {
    return await userCanUseOfficerCommands(ctx);
  } catch (error) {
    console.error("officer permission lookup failed", error?.message || error);
    return false;
  }
}

async function fetchAccessMember(chatId, userId) {
  if (!chatId || !userId) return null;
  return fetchOne("b24_access_members", { chat_id: chatId, user_id: userId }, null, false);
}

async function upsertAccessMember({ chatId, userId, username, displayName, role, status, approvedBy = "", approvedAt = null }) {
  const now = new Date().toISOString();
  return upsertRow("b24_access_members", {
    chat_id: String(chatId),
    user_id: String(userId),
    username: String(username || "").replace(/^@/, ""),
    display_name: String(displayName || userId),
    role,
    status,
    approved_by: approvedBy || null,
    approved_at: approvedAt,
    last_seen_at: now,
    updated_at: now
  }, "chat_id,user_id");
}

async function resolveAccessTarget(ctx, query, scopeId) {
  const replied = ctx.message?.reply_to_message?.from || ctx.channelPost?.reply_to_message?.from;
  if (replied?.id) {
    return {
      userId: String(replied.id),
      username: replied.username || "",
      displayName: replied.username ? `@${replied.username}` : [replied.first_name, replied.last_name].filter(Boolean).join(" ") || `Telegram ${replied.id}`
    };
  }

  const raw = String(query || "").trim();
  if (!raw) return null;
  const needle = searchText(raw);
  const rows = await fetchRows("b24_access_members", { chat_id: `eq.${scopeId}` }, {
    includeMap: false,
    order: "updated_at.desc"
  });
  const exact = rows.filter((row) => {
    return String(row.user_id) === raw
      || searchText(row.username) === needle
      || searchText(row.display_name) === needle;
  });
  const partial = exact.length ? exact : rows.filter((row) => {
    return searchText(row.username).startsWith(needle) || searchText(row.display_name).startsWith(needle);
  });
  if (partial.length > 1) return { ambiguous: partial };
  if (partial.length === 1) {
    const row = partial[0];
    return {
      row,
      userId: String(row.user_id),
      username: row.username || "",
      displayName: row.display_name || row.username || row.user_id
    };
  }
  return null;
}

function accessCommandState(command) {
  switch (command) {
    case "approve":
      return { status: "active", role: "member" };
    case "officer":
      return { status: "active", role: "officer" };
    case "demote":
      return { status: "active", role: "member" };
    case "ban":
      return { status: "banned", role: "member" };
    default:
      return null;
  }
}

function accessMemberLabel(row) {
  const handle = row.username ? `@${row.username}` : "";
  return [row.display_name, handle, row.user_id].filter(Boolean).join(" ");
}

function formatAccessStatus(row, target) {
  if (!row) return `No access record found for <code>${escapeHtml(target.displayName || target.userId)}</code>.`;
  return [
    `<b>Access ${escapeHtml(row.display_name || row.username || row.user_id)}</b>`,
    `User ID: <code>${escapeHtml(row.user_id)}</code>`,
    row.username ? `Username: @${escapeHtml(row.username)}` : "",
    `Status: ${escapeHtml(row.status || "pending")}`,
    `Role: ${escapeHtml(row.role || "member")}`,
    row.approved_by ? `Approved by: <code>${escapeHtml(row.approved_by)}</code>` : "",
    row.updated_at ? `Updated: ${escapeHtml(formatLocalSummary(new Date(row.updated_at)))}` : ""
  ].filter(Boolean).join("\n");
}

async function isMemberOfAnyAccessChat(ctx, userId) {
  for (const chatId of accessChatIds) {
    const cached = cachedAccessMember(chatId, userId);
    if (cached !== null) {
      if (cached) return true;
      continue;
    }

    try {
      const member = await ctx.telegram.getChatMember(chatId, userId);
      const allowed = Boolean(member && member.status !== "left" && member.status !== "kicked");
      cacheAccessMember(chatId, userId, allowed);
      if (allowed) return true;
    } catch (error) {
      console.error(`Access chat lookup failed for ${chatId}`, error.message);
      cacheAccessMember(chatId, userId, false, 30 * 1000);
    }
  }
  return false;
}

function cachedAccessMember(chatId, userId) {
  const entry = accessMemberCache.get(`${chatId}:${userId}`);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.allowed;
}

function cacheAccessMember(chatId, userId, allowed, ttlMs = 5 * 60 * 1000) {
  accessMemberCache.set(`${chatId}:${userId}`, {
    allowed,
    expiresAt: Date.now() + ttlMs
  });
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

async function handleBuildPlan(ctx, text, mode) {
  const stage = Number((commandBody(text).match(/\d{1,2}/) || [])[0] || 0);
  if (!buildPlans.has(stage)) {
    return respond(ctx, mode, [
      "<b>Base Doctrine</b>",
      "",
      "Use <code>!buildplan 1</code> through <code>!buildplan 16</code>.",
      "Short form: <code>!bp 4</code>.",
      "",
      "Example: <code>!buildplan 6</code>"
    ].join("\n"), { parse_mode: "HTML" });
  }
  return respond(ctx, mode, formatBuildPlan(stage), { parse_mode: "HTML" });
}

function formatBuildPlan(stage) {
  const plan = buildPlans.get(stage);
  return [
    `<b>${stage} BASE DOCTRINE</b>`,
    "",
    `Build on ${escapeHtml(plan.scope)}:`,
    "",
    `<code>${escapeHtml(plan.build)}</code>`,
    "",
    "When complete:",
    `-&gt; Establish Base #${plan.next}`
  ].join("\n");
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

async function safeHelpStatus(ctx) {
  try {
    return await helpStatus(ctx);
  } catch (error) {
    console.error("help status lookup failed", error?.message || error);
    return [
      "Active guild: unknown",
      `Galaxy: ${escapeHtml(defaultGalaxy)}`,
      "Your role: Member"
    ].join("\n");
  }
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
    const add = parseAttackAdd(text, await galaxyForContext(ctx));
    if (add) return handleAttackAdd(ctx, add, mode);
    const namedPlan = parseNamedAttackPlan(text);
    if (namedPlan) return handleNamedAttackPlan(ctx, namedPlan, mode);
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

async function handleAttacks(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const pageInfo = parsePageFromQuery(commandBody(text));
  const body = pageInfo.query.trim();
  const shortId = normalizeShortId(body.match(/^([A-Z]-?[A-Z0-9]{3,8})$/i)?.[1] || "");
  if (shortId) return handleAttackPool(ctx, shortId, mode, pageInfo.page);
  const attackNumber = parseAttackNumber(body);
  if (attackNumber) {
    const operation = await findAttackByNumber(galaxy, scopeId, attackNumber);
    if (!operation) return respond(ctx, mode, `No active attack #${attackNumber} found.`);
    return handleAttackPool(ctx, operation.short_id, mode, pageInfo.page);
  }
  if (/^clear$/i.test(body)) {
    return respond(ctx, mode, "Use <code>$standdown A-12345 reason</code> to close one attack plan. <code>$attacks</code> only lists plans.", { parse_mode: "HTML" });
  }

  const attacks = await fetchActiveOperations(galaxy, scopeId, "attack");
  const claimsByOperation = await fetchClaimsByOperation(attacks);
  const lines = [`<b>${galaxy} Attack Plans</b>`];
  if (!attacks.length) {
    lines.push("No active attack plans.");
    lines.push("", "Create one: <code>!attack 02:00 clowntown 4</code>");
    const operations = await fetchActiveOperations(galaxy, scopeId);
    const canQuickCreate = !operations.length && await safeUserCanUseOfficerCommands(ctx);
    return respond(ctx, mode, lines.join("\n"), {
      parse_mode: "HTML",
      ...quickSetupKeyboard(galaxy, "", canQuickCreate)
    });
  }

  lines.push(...attacks.map((operation, index) => {
    const claims = claimsByOperation.get(operation.operation_id) || [];
    const targets = groupAttackTargets(operation, claims);
    const claimedWaves = targets.reduce((sum, target) => sum + target.claimedWaves, 0);
    const totalWaves = targets.reduce((sum, target) => sum + target.totalWaves, 0);
    return `${index + 1} - ${escapeHtml(formatAttackListDate(operation.arrival_at))} ${escapeHtml(attackDisplayName(operation))} ${escapeHtml(formatClockLabel(new Date(operation.arrival_at)))} - ${claimedWaves}/${totalWaves || 0}`;
  }));
  lines.push("", "Add targets: <code>!attack add 1 24324510, 24351330, paste, paste</code>");
  lines.push("Open a pool: <code>!attacks 1</code>");
  lines.push("Show board: <code>$board attack</code>");
  return respond(ctx, mode, lines.join("\n"), {
    parse_mode: "HTML",
    ...attackListKeyboard(attacks)
  });
}

async function handleNamedAttackPlan(ctx, plan, mode) {
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const galaxy = await galaxyForContext(ctx);

  const operation = operationRow(ctx, {
    type: "attack",
    targetCoord: "",
    arrivalAt: plan.arrivalAt,
    note: attackNote(plan.name, plan.waves),
    chatId: scopeId
  });
  operation.map_id = galaxyToMapId(galaxy);

  if (!(await insertRow("b24_operations", operation))) {
    return respond(ctx, mode, "Attack plan failed. I could not create the operation.");
  }

  const attacks = await fetchActiveOperations(galaxy, scopeId, "attack");
  const number = attackNumberForOperation(attacks, operation) || "?";
  const message = [
    `<b>Attack #${escapeHtml(number)} created</b>`,
    `${escapeHtml(formatAttackListDate(operation.arrival_at))} ${escapeHtml(plan.name)} ${escapeHtml(plan.label)}`,
    `Waves: ${plan.waves}`,
    "",
    `Add targets: <code>!attack add ${escapeHtml(number)} 24324510, 24351330, paste, paste</code>`,
    `Show attacks: <code>!attacks</code>`
  ].join("\n");

  return respond(ctx, mode, message, {
    parse_mode: "HTML",
    ...attackPlanKeyboard(operation, [])
  });
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

async function handleAttackPool(ctx, shortId, mode, page = 1) {
  const operation = await findOperation(ctx, shortId);
  if (!operation || operation.type !== "attack") {
    return respond(ctx, mode, `No active attack plan found for ${escapeHtml(shortId)}.`, { parse_mode: "HTML" });
  }

  const claims = await fetchOperationClaims(operation);
  const message = await formatAttackPool(operation, claims, page);
  return respond(ctx, mode, message, {
    parse_mode: "HTML",
    ...attackPoolKeyboard(operation, claims, page)
  });
}

async function handleAttackAdd(ctx, add, mode) {
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    return respond(ctx, mode, "Only Lysander officers/owners can add targets to attack plans.");
  }
  if (!add.coords.length) {
    return respond(ctx, mode, "Use: <code>!attack add 1 24324510, 24351330, paste, paste</code>", { parse_mode: "HTML" });
  }
  let operation = null;
  if (add.attackNumber) {
    const galaxy = await galaxyForContext(ctx);
    const scopeId = await operationScopeId(ctx);
    operation = scopeId ? await findAttackByNumber(galaxy, scopeId, add.attackNumber) : null;
  } else {
    operation = await findOperation(ctx, add.shortId);
  }
  if (!operation || operation.type !== "attack") {
    const label = add.attackNumber ? `#${add.attackNumber}` : add.shortId;
    return respond(ctx, mode, `No active attack plan found for ${escapeHtml(label)}.`, { parse_mode: "HTML" });
  }
  const result = await addTargetsToAttack(ctx, operation, add.coords, add.note);
  const scopeId = await operationScopeId(ctx);
  const attacks = scopeId ? await fetchActiveOperations(await galaxyForContext(ctx), scopeId, "attack") : [];
  const attackNumber = attackNumberForOperation(attacks, operation) || operation.short_id;
  return respond(ctx, mode, [
    `Attack ${escapeHtml(attackNumber)} target update`,
    `Added: ${result.added}`,
    `Already present: ${result.skipped}`,
    "",
    `Open pool: <code>!attacks ${escapeHtml(attackNumber)}</code>`,
    `Board: <code>$board attack</code>`
  ].join("\n"), { parse_mode: "HTML" });
}

async function handleAttackAddButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission to add attack targets.");
    return;
  }
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    await ctx.answerCbQuery("Officer access required.");
    return;
  }
  const [, shortId, coord] = ctx.match || [];
  const operation = await findOperation(ctx, shortId);
  if (!operation || operation.type !== "attack") {
    await ctx.answerCbQuery("Attack plan not found.");
    return;
  }
  const result = await addTargetsToAttack(ctx, operation, [coord], "added from base list");
  await ctx.answerCbQuery(result.added ? `Added ${coord}` : `${coord} already present`);
  return ctx.reply(`${operation.short_id}: ${coord} ${result.added ? "added to target pool" : "was already in the target pool"}.\nOpen: $attacks ${operation.short_id}`);
}

async function handleQuickAttackButton(ctx) {
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    await ctx.answerCbQuery("Officer access required.");
    return;
  }
  const [, hoursText, galaxyText, encodedQuery] = ctx.match || [];
  const hours = Number(hoursText);
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const query = decodeButtonValue(encodedQuery || "");
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) {
    await ctx.answerCbQuery("No active operation group.");
    return;
  }

  const targets = query ? await matchingBaseCoords(galaxy, scopeId, query) : [];
  if (query && !targets.length) {
    await ctx.answerCbQuery("No matching bases found.");
    return ctx.reply(`No matching bases remain for ${escapeHtml(query)} in ${galaxy}.`, { parse_mode: "HTML" });
  }

  const arrivalAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const name = quickAttackName(query);
  const operation = operationRow(ctx, {
    type: "attack",
    targetCoord: targets[0] || "",
    arrivalAt,
    note: attackNote(name, 4),
    chatId: scopeId
  });
  operation.map_id = galaxyToMapId(galaxy);
  if (!(await insertRow("b24_operations", operation))) {
    await ctx.answerCbQuery("Attack plan could not be saved.");
    return;
  }
  const result = targets.length ? await addTargetsToAttack(ctx, operation, targets, `quick setup: ${name}`) : { added: 0 };
  const attacks = await fetchActiveOperations(galaxy, scopeId, "attack");
  const number = attackNumberForOperation(attacks, operation) || "?";
  await ctx.answerCbQuery(`Attack #${number} created`);
  return ctx.reply([
    `<b>Attack #${escapeHtml(number)} created</b>`,
    `${escapeHtml(name)} - lands in ${escapeHtml(formatEta(arrivalAt))}`,
    "Waves: 4",
    targets.length ? `Targets added: ${result.added}/${targets.length}` : "No targets yet. Add them with !attack add.",
    "",
    `Open pool: <code>$attacks ${escapeHtml(number)}</code>`
  ].join("\n"), {
    parse_mode: "HTML",
    ...attackPlanKeyboard(operation, [])
  });
}

async function handleQuickScoutButton(ctx) {
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    await ctx.answerCbQuery("Officer access required.");
    return;
  }
  const [, galaxyText, encodedQuery] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const query = decodeButtonValue(encodedQuery || "");
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) {
    await ctx.answerCbQuery("No active operation group.");
    return;
  }
  const targets = await matchingBaseCoords(galaxy, scopeId, query);
  if (!targets.length) {
    await ctx.answerCbQuery("No matching bases found.");
    return;
  }

  // The date keeps the existing operation schema usable; agenda display never treats it as a real ETA.
  const arrivalAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  const agendaKey = newScoutAgendaKey();
  const agendaName = quickScoutName(query);
  let created = 0;
  for (const targetCoord of targets) {
    const operation = operationRow(ctx, {
      type: "scout",
      targetCoord,
      arrivalAt,
      note: scoutAgendaNote(agendaKey, agendaName),
      chatId: scopeId
    });
    operation.map_id = galaxyToMapId(galaxy);
    if (await insertRow("b24_operations", operation)) created += 1;
  }
  await ctx.answerCbQuery(`Created ${created} scout requests`);
  return ctx.reply([
    `<b>${escapeHtml(agendaName)} created</b>`,
    `${created}/${targets.length} exact-base watches are active until cancelled.`,
    `Open: <code>$scoutings</code>`,
    `When intel is ready, create an attack from this same target pool.`
  ].join("\n"), { parse_mode: "HTML" });
}

async function handleScoutings(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const agendas = groupScoutAgendas(await fetchScoutAgendas(galaxy, scopeId));
  if (!agendas.length) {
    return respond(ctx, mode, [
      `<b>${galaxy} Scouting Agendas</b>`,
      "No persistent scouting agendas.",
      "Start from a base list: <code>$bases [tag or player]</code>"
    ].join("\n"), { parse_mode: "HTML" });
  }

  const lines = [`<b>${galaxy} Scouting Agendas</b>`];
  agendas.forEach((agenda, index) => lines.push(`${index + 1}. ${escapeHtml(agenda.name)} - ${agenda.operations.length} base watches - active until cancelled`));
  return respond(ctx, mode, lines.join("\n"), {
    parse_mode: "HTML",
    ...scoutAgendaListKeyboard(galaxy, agendas)
  });
}

async function handleScoutAgendaButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for scouting agendas.");
    return;
  }
  const [, galaxyText, agendaKey] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const agenda = scopeId ? await findScoutAgenda(galaxy, scopeId, agendaKey) : null;
  if (!agenda) {
    await ctx.answerCbQuery("Scouting agenda not found.");
    return;
  }
  const assignments = await scoutAgendaAssignments(agenda);
  await ctx.answerCbQuery("Scouting agenda");
  return ctx.reply(formatScoutAgenda(agenda, assignments), {
    parse_mode: "HTML",
    ...scoutAgendaKeyboard(galaxy, agenda, assignments, await safeUserCanUseOfficerCommands(ctx))
  });
}

async function handleScoutWatchListButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for scouting agendas.");
    return;
  }
  const [, galaxyText, agendaKey, pageText] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const agenda = scopeId ? await findScoutAgenda(galaxy, scopeId, agendaKey) : null;
  if (!agenda) {
    await ctx.answerCbQuery("Scouting agenda not found.");
    return;
  }
  const page = Math.max(1, Number(pageText) || 1);
  const assignments = await scoutAgendaAssignments(agenda);
  await ctx.answerCbQuery("Watch targets");
  return ctx.reply(formatScoutWatchList(agenda, assignments, page), {
    parse_mode: "HTML",
    ...scoutWatchListKeyboard(galaxy, agenda, assignments, page)
  });
}

async function handleScoutWatchTargetButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for scouting agendas.");
    return;
  }
  const [, galaxyText, agendaKey, indexText] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const agenda = scopeId ? await findScoutAgenda(galaxy, scopeId, agendaKey) : null;
  const index = Number(indexText) - 1;
  const operation = agenda?.operations[index];
  if (!operation) {
    await ctx.answerCbQuery("Watch target not found.");
    return;
  }
  const assignments = await scoutAgendaAssignments(agenda);
  const assignment = assignments.get(operation.operation_id);
  const mine = assignment?.user_id === telegramUserId(ctx);
  await ctx.answerCbQuery(assignment ? "Watch assignment" : "Choose watch ship");
  return ctx.reply(formatScoutWatchTarget(operation, assignment), {
    parse_mode: "HTML",
    ...scoutWatchTargetKeyboard(galaxy, agenda, index + 1, assignment, mine)
  });
}

async function handleScoutWatchTakeButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for scouting agendas.");
    return;
  }
  const [, galaxyText, agendaKey, indexText] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const agenda = scopeId ? await findScoutAgenda(galaxy, scopeId, agendaKey) : null;
  const index = Number(indexText) - 1;
  const operation = agenda?.operations[index];
  if (!operation) {
    await ctx.answerCbQuery("Watch target not found.");
    return;
  }
  const assignments = await scoutAgendaAssignments(agenda);
  const existing = assignments.get(operation.operation_id);
  if (existing && existing.user_id !== telegramUserId(ctx)) {
    await ctx.answerCbQuery(`Already watched by ${String(existing.display_name || "another member").slice(0, 40)}.`);
    return;
  }
  const saved = await upsertOperationMember(ctx, operation, "joined", "watch");
  if (!saved) {
    await ctx.answerCbQuery("Could not save that watch assignment.");
    return;
  }
  await ctx.answerCbQuery("Watch assigned");
  return ctx.reply(`${escapeHtml(telegramName(ctx))} is now watching <code>${escapeHtml(operation.target_coord)}</code>.`, { parse_mode: "HTML" });
}

async function handleScoutWatchReleaseButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for scouting agendas.");
    return;
  }
  const [, galaxyText, agendaKey, indexText] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const agenda = scopeId ? await findScoutAgenda(galaxy, scopeId, agendaKey) : null;
  const operation = agenda?.operations[Number(indexText) - 1];
  if (!operation) {
    await ctx.answerCbQuery("Watch target not found.");
    return;
  }
  const assignments = await scoutAgendaAssignments(agenda);
  const existing = assignments.get(operation.operation_id);
  if (!existing || existing.user_id !== telegramUserId(ctx)) {
    await ctx.answerCbQuery("Only the assigned watcher can release this target.");
    return;
  }
  const saved = await upsertOperationMember(ctx, operation, "withdrawn", "watch released");
  if (!saved) {
    await ctx.answerCbQuery("Could not release that watch assignment.");
    return;
  }
  await ctx.answerCbQuery("Watch released");
  return ctx.reply(`<code>${escapeHtml(operation.target_coord)}</code> is open for a watcher.`, { parse_mode: "HTML" });
}

async function handleScoutAgendaAttackButton(ctx) {
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    await ctx.answerCbQuery("Officer access required.");
    return;
  }
  const [, galaxyText, agendaKey, hoursText] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const agenda = scopeId ? await findScoutAgenda(galaxy, scopeId, agendaKey) : null;
  if (!agenda?.operations.length) {
    await ctx.answerCbQuery("Scouting agenda not found.");
    return;
  }
  const hours = Math.max(1, Math.min(4, Number(hoursText) || 4));
  const arrivalAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const coords = agenda.operations.map((operation) => operation.target_coord).filter(Boolean);
  const operation = operationRow(ctx, {
    type: "attack",
    targetCoord: coords[0] || "",
    arrivalAt,
    note: attackNote(`${agenda.name} Attack`, 4),
    chatId: scopeId
  });
  operation.map_id = galaxyToMapId(galaxy);
  if (!(await insertRow("b24_operations", operation))) {
    await ctx.answerCbQuery("Attack plan could not be saved.");
    return;
  }
  const result = await addTargetsToAttack(ctx, operation, coords, `from scouting agenda ${agenda.key}`);
  const attacks = await fetchActiveOperations(galaxy, scopeId, "attack");
  const number = attackNumberForOperation(attacks, operation) || "?";
  await ctx.answerCbQuery(`Attack #${number} created`);
  return ctx.reply([
    `<b>Attack #${escapeHtml(number)} created from ${escapeHtml(agenda.name)}</b>`,
    `Lands in ${escapeHtml(formatEta(arrivalAt))}`,
    `Targets added: ${result.added}/${coords.length}`,
    "Waves: 4",
    `Open pool: <code>$attacks ${escapeHtml(number)}</code>`
  ].join("\n"), { parse_mode: "HTML", ...attackPlanKeyboard(operation, []) });
}

async function handleScoutAgendaCancelButton(ctx) {
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    await ctx.answerCbQuery("Officer access required.");
    return;
  }
  const [, galaxyText, agendaKey] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const agenda = scopeId ? await findScoutAgenda(galaxy, scopeId, agendaKey) : null;
  if (!agenda) {
    await ctx.answerCbQuery("Scouting agenda not found.");
    return;
  }
  const stamp = new Date().toISOString();
  const outcomes = await Promise.all(agenda.operations.map((operation) => updateRows("b24_operations", {
    status: "stood_down",
    updated_at: stamp
  }, {
    map_id: `eq.${operation.map_id}`,
    operation_id: `eq.${operation.operation_id}`
  })));
  await ctx.answerCbQuery("Agenda cancelled");
  return ctx.reply(`${escapeHtml(agenda.name)} cancelled: ${outcomes.filter(Boolean).length}/${agenda.operations.length} watch requests closed.`, { parse_mode: "HTML" });
}

async function handleAttackPoolButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for attack plans.");
    return;
  }
  const [, shortId, pageText, selectedCoord] = ctx.match || [];
  const page = Math.max(1, Number(pageText || 1));
  const operation = await findOperation(ctx, shortId);
  if (!operation || operation.type !== "attack") {
    await ctx.answerCbQuery("Attack plan not found.");
    return;
  }
  await ctx.answerCbQuery(selectedCoord ? `Waves for ${selectedCoord}` : `Opening ${operation.short_id}`);
  const claims = await fetchOperationClaims(operation);
  const message = await formatAttackPool(operation, claims, page, selectedCoord);
  const options = {
    parse_mode: "HTML",
    ...attackPoolKeyboard(operation, claims, page, selectedCoord)
  };
  if (selectedCoord || pageText) {
    try {
      return await ctx.editMessageText(message, options);
    } catch (error) {
      // Telegram refuses edits when content is unchanged or too old; a fresh pool still works.
    }
  }
  return ctx.reply(message, options);
}

async function handleAttackTakeButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission to claim targets.");
    return;
  }
  const [, shortId, coord, offsetText, pageText] = ctx.match || [];
  const operation = await findOperation(ctx, shortId);
  if (!operation || operation.type !== "attack") {
    await ctx.answerCbQuery("Attack plan not found.");
    return;
  }
  const offsetMinutes = Number(offsetText || 0);
  const arrivalAt = new Date(new Date(operation.arrival_at).getTime() + offsetMinutes * 60 * 1000);
  const label = formatClockLabel(arrivalAt);
  const result = await handleTargetClaim(ctx, {
    shortId: operation.short_id,
    coord,
    arrivalAt,
    label,
    note: offsetMinutes ? `wave +${offsetMinutes}m` : "wave 1"
  }, "$", { silent: true });
  if (!result?.ok) {
    await ctx.answerCbQuery(result?.message || "Claim failed.");
    return;
  }
  await ctx.answerCbQuery(`Claimed ${coord} W${result.slotIndex}`);
  const claims = await fetchOperationClaims(operation);
  const page = Number(pageText || 1) || 1;
  const message = await formatAttackPool(operation, claims, page, coord);
  try {
    return await ctx.editMessageText(message, {
      parse_mode: "HTML",
      ...attackPoolKeyboard(operation, claims, page, coord)
    });
  } catch (error) {
    return ctx.reply(result.message, { parse_mode: "HTML" });
  }
}

async function addTargetsToAttack(ctx, operation, coords, note = "") {
  const cleanCoords = [...new Set(coords.map(normalizeAstro).filter(Boolean))]
    .filter((coord) => mapIdForCoord(coord) === operation.map_id);
  if (!cleanCoords.length) return { added: 0, skipped: 0 };

  const existing = await fetchRows("b24_claims", {
    operation_id: `eq.${operation.operation_id}`,
    status: "eq.active"
  }, { mapId: operation.map_id, order: "target_coord.asc", limit: 1000 });
  const existingTargets = new Set(existing.map((claim) => claim.target_coord));
  const stamp = new Date().toISOString();
  let added = 0;
  let skipped = 0;
  for (const coord of cleanCoords) {
    if (existingTargets.has(coord)) {
      skipped += 1;
      continue;
    }
    const row = {
      map_id: operation.map_id,
      claim_id: randomId(),
      operation_id: operation.operation_id,
      operation_short_id: operation.short_id,
      target_coord: coord,
      region_id: astroToRegion(coord),
      system_id: astroToSystem(coord),
      claimed_by: null,
      claimed_by_user_id: null,
      chat_id: operation.chat_id,
      arrival_at: operation.arrival_at,
      arrival_label: formatClockLabel(new Date(operation.arrival_at)),
      confirmed_sent: false,
      confirmed_at: null,
      confirmed_by: "",
      fleet_label: "",
      note,
      status: "active",
      created_at: stamp,
      updated_at: stamp
    };
    if (await insertRow("b24_claims", row)) {
      added += 1;
      existingTargets.add(coord);
    }
  }
  return { added, skipped };
}

async function handleTargetClaim(ctx, targetClaim, mode, options = {}) {
  const operation = await findOperation(ctx, targetClaim.shortId);
  if (!operation || operation.type !== "attack") {
    const message = `No active attack operation found for ${targetClaim.shortId}.`;
    return options.silent ? { ok: false, message } : respond(ctx, mode, escapeHtml(message), { parse_mode: "HTML" });
  }

  let targetRows = await fetchRows("b24_claims", {
    operation_id: `eq.${operation.operation_id}`,
    target_coord: `eq.${targetClaim.coord}`,
    status: "eq.active"
  }, { mapId: operation.map_id, order: "arrival_at.asc", limit: 100 });
  if (!targetRows.length) {
    const operationClaims = await fetchOperationClaims(operation);
    targetRows = operationClaims.filter((row) => row.target_coord === targetClaim.coord);
  }
  const slotIndex = Math.max(1, Math.round((targetClaim.arrivalAt.getTime() - new Date(operation.arrival_at).getTime()) / 3600000) + 1);
  const waveCount = attackWaveCount(operation);

  if (!targetRows.length) {
    const message = `${targetClaim.coord} is not an open target on ${operation.short_id}.`;
    return options.silent ? { ok: false, message } : respond(ctx, mode, escapeHtml(message), { parse_mode: "HTML" });
  }
  if (slotIndex > waveCount) {
    const message = `${operation.short_id} only has ${waveCount} waves.`;
    return options.silent ? { ok: false, message } : respond(ctx, mode, escapeHtml(message), { parse_mode: "HTML" });
  }
  let claim = targetRows.find((row) => claimWaveIndex(operation, row) === slotIndex);
  if (!claim) {
    const template = targetRows[0];
    claim = {
      ...template,
      claim_id: randomId(),
      claimed_by: null,
      claimed_by_user_id: null,
      arrival_at: targetClaim.arrivalAt.toISOString(),
      arrival_label: targetClaim.label,
      confirmed_sent: false,
      confirmed_at: null,
      confirmed_by: "",
      fleet_label: "",
      note: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (!(await insertRow("b24_claims", claim))) {
      const message = "Target claim failed. I could not create that wave slot in Supabase.";
      return options.silent ? { ok: false, message } : respond(ctx, mode, message);
    }
  }
  if (claim.claimed_by_user_id && claim.claimed_by_user_id !== telegramUserId(ctx)) {
    const message = `${targetClaim.coord} wave ${slotIndex} is already claimed by ${claim.claimed_by || "someone"}.`;
    return options.silent ? { ok: false, message } : respond(ctx, mode, escapeHtml(message), { parse_mode: "HTML" });
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
  if (!ok) {
    const message = "Target claim failed. I could not update Supabase.";
    return options.silent ? { ok: false, message } : respond(ctx, mode, message);
  }

  await upsertOperationMember(ctx, operation, "joined", `${targetClaim.coord}${targetClaim.note ? ` ${targetClaim.note}` : ""}`);
  const message = `${telegramName(ctx)} claimed ${targetClaim.coord} W${slotIndex} for ${operation.short_id} at ${targetClaim.label}.`;
  return options.silent
    ? { ok: true, message, operation, slotIndex, coord: targetClaim.coord }
    : respond(ctx, mode, escapeHtml(message), { parse_mode: "HTML" });
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

  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");

  const imported = parseIncomingExportRows(match[2], galaxy);
  if (imported.length > 1) {
    const saved = await insertIncomingRows(ctx, imported, scopeId);
    return respond(ctx, mode, `Imported ${saved}/${imported.length} incoming reports. Use <code>$incoming</code>, <code>$incoming B24:36</code>, or <code>$incoming [APP]</code>.`, { parse_mode: "HTML" });
  }

  const parsed = parseIncomingReport(match[2], galaxy);
  if (!parsed?.attackerCoord) {
    const generic = parseGenericIncomingReport(match[2], galaxy);
    if (generic) {
      const saved = await insertIncomingRows(ctx, [generic], scopeId);
      return respond(ctx, mode, saved
        ? `Reported generic incoming: ETA ${formatEta(generic.arrivalAt)}${generic.note ? ` - ${escapeHtml(generic.note)}` : ""}`
        : "Incoming report failed. I could not reach Supabase.", { parse_mode: "HTML" });
    }
    return respond(ctx, mode, "Use: $sos [your base] [attacker coord] [eta minutes] [note], or $sos 1:30 4500 rotc");
  }

  const defended = parsed.defendedCoord;
  const attacker = parsed.attackerCoord;
  const minutes = parsed.minutes;
  const note = parsed.note;
  if (!validMinutes(minutes)) return respond(ctx, mode, "Use ETA minutes from now, 1 to 1440.");

  const now = new Date();
  const arrivalAt = new Date(now.getTime() + minutes * 60 * 1000);
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
    covered_by: null,
    covered_by_user_id: null,
    covered_at: null,
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

async function handleIncoming(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const query = commandBody(text);
  if (/^(help|usage|\?)$/i.test(query)) return respond(ctx, mode, await helpText(ctx, "!help incoming"), { parse_mode: "HTML" });
  if (/^clear\b/i.test(query)) return clearIncomingReports(ctx, mode, galaxy, scopeId, query.replace(/^clear\b/i, "").trim());
  const imported = parseIncomingExportRows(query, galaxy);
  if (imported.length) {
    const saved = await insertIncomingRows(ctx, imported, scopeId);
    return respond(ctx, mode, `Imported ${saved}/${imported.length} incoming reports. Use <code>$incoming</code>, <code>$incoming B24:36</code>, or <code>$incoming [APP]</code>.`, { parse_mode: "HTML" });
  }

  const incoming = await fetchActiveIncoming(galaxy, scopeId);
  const pageInfo = parseIncomingPage(query);
  const filtered = filterIncomingReports(incoming, pageInfo.query, galaxy);
  const enriched = await enrichIncomingReports(filtered, galaxy);
  const pageSize = 15;
  const from = (pageInfo.page - 1) * pageSize;
  const pageRows = enriched.slice(from, from + pageSize);
  const label = pageInfo.query ? ` matching ${escapeHtml(pageInfo.query)}` : "";
  if (!pageRows.length) return respond(ctx, mode, `No active hostile incoming reports${label} in ${galaxy}.`, { parse_mode: "HTML" });
  const lines = [`<pre>${pageRows.map(formatIncomingLine).join("\n")}</pre>`, "", `${from + 1}-${from + pageRows.length} of ${enriched.length} incoming`];
  if (from + pageRows.length < enriched.length) {
    lines.push(`Next: <code>$incoming ${escapeHtml([pageInfo.query, `page ${pageInfo.page + 1}`].filter(Boolean).join(" "))}</code>`);
  }
  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleDefensePool(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const pageInfo = parseIncomingPage(commandBody(text));
  const incoming = await fetchActiveIncoming(galaxy, scopeId);
  const filtered = filterIncomingReports(incoming, pageInfo.query, galaxy);
  const enriched = await enrichIncomingReports(filtered, galaxy);
  const message = formatDefensePool(galaxy, enriched, pageInfo.page, pageInfo.query);
  return respond(ctx, mode, message, {
    parse_mode: "HTML",
    ...defensePoolKeyboard(enriched, pageInfo.page)
  });
}

async function handleDefensePoolButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission to view defense.");
    return;
  }
  const page = Number(ctx.match?.[1] || 1) || 1;
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) {
    await ctx.answerCbQuery("No active guild scope.");
    return;
  }
  const incoming = await enrichIncomingReports(await fetchActiveIncoming(galaxy, scopeId), galaxy);
  try {
    return await ctx.editMessageText(formatDefensePool(galaxy, incoming, page), {
      parse_mode: "HTML",
      ...defensePoolKeyboard(incoming, page)
    });
  } catch {
    return ctx.reply(formatDefensePool(galaxy, incoming, page), {
      parse_mode: "HTML",
      ...defensePoolKeyboard(incoming, page)
    });
  }
}

async function handleDefenseCoverButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission to cover incoming.");
    return;
  }
  const [, incomingId, pageText] = ctx.match || [];
  const incoming = await fetchOne("b24_incoming", { incoming_id: incomingId }, null, false);
  if (!incoming || incoming.status !== "active") {
    await ctx.answerCbQuery("Incoming report not found.");
    return;
  }
  if (new Date(incoming.arrival_at).getTime() <= Date.now()) {
    await ctx.answerCbQuery("That incoming has already landed.");
    return;
  }
  if (incoming.covered_by_user_id) {
    await ctx.answerCbQuery(`Already covered by ${incoming.covered_by || "someone"}.`);
  } else {
    const ok = await updateRows("b24_incoming", {
      covered_by: telegramName(ctx),
      covered_by_user_id: telegramUserId(ctx),
      covered_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      map_id: `eq.${incoming.map_id}`,
      incoming_id: `eq.${incoming.incoming_id}`
    });
    if (!ok) {
      await ctx.answerCbQuery("Could not save coverage.");
      return;
    }
    await ctx.answerCbQuery("Covered.");
  }

  const page = Number(pageText || 1) || 1;
  const galaxy = galaxyFromCoord(incoming.defended_coord || incoming.attacker_coord) || defaultGalaxy;
  const scopeId = incoming.chat_id || await operationScopeId(ctx);
  const rows = scopeId ? await enrichIncomingReports(await fetchActiveIncoming(galaxy, scopeId), galaxy) : [incoming];
  try {
    return await ctx.editMessageText(formatDefensePool(galaxy, rows, page), {
      parse_mode: "HTML",
      ...defensePoolKeyboard(rows, page)
    });
  } catch {
    return ctx.reply(`${escapeHtml(telegramName(ctx))} covered incoming at ${escapeHtml(formatClockLabel(new Date(incoming.arrival_at)))}.`, { parse_mode: "HTML" });
  }
}

async function handleIncomingReport(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const query = commandBody(text).replace(/^[!$\/]report\s+/i, "").trim();
  if (!query || /^(help|usage|\?)$/i.test(query)) {
    return respond(ctx, mode, await helpText(ctx, "!help incoming"), { parse_mode: "HTML" });
  }

  const imported = parseIncomingExportRows(query, galaxy);
  if (imported.length) {
    const saved = await insertIncomingRows(ctx, imported, scopeId);
    return respond(ctx, mode, `Reported ${saved}/${imported.length} incoming. Use <code>$incoming</code> to view.`, { parse_mode: "HTML" });
  }

  const generic = parseGenericIncomingReport(query, galaxy);
  if (generic) {
    const saved = await insertIncomingRows(ctx, [generic], scopeId);
    return respond(ctx, mode, saved
      ? `Reported generic incoming: ETA ${formatEta(generic.arrivalAt)}${generic.note ? ` - ${escapeHtml(generic.note)}` : ""}`
      : "Incoming report failed. I could not reach Supabase.", { parse_mode: "HTML" });
  }

  return respond(ctx, mode, [
    "Use: <code>$report [attacker] [defended] [eta] [size] [note]</code>",
    "Example: <code>$report B24:18:40:10 B24:34:64:40 1:12:03 8,950</code>",
    "Or paste incoming rows after <code>$report</code>."
  ].join("\n"), { parse_mode: "HTML" });
}

async function clearIncomingReports(ctx, mode, galaxy, scopeId, query) {
  const incoming = await fetchActiveIncoming(galaxy, scopeId);
  const filter = /^all$/i.test(query) ? "" : query;
  const matched = filterIncomingReports(incoming, filter, galaxy);
  if (!matched.length) return respond(ctx, mode, `No active incoming reports matched ${escapeHtml(query || "all")}.`, { parse_mode: "HTML" });
  const stamp = new Date().toISOString();
  let cleared = 0;
  for (const row of matched) {
    const ok = await updateRows("b24_incoming", {
      status: "false_report",
      updated_at: stamp
    }, {
      map_id: `eq.${row.map_id}`,
      incoming_id: `eq.${row.incoming_id}`
    });
    if (ok) cleared += 1;
    if (row.operation_id) {
      await updateRows("b24_operations", {
        status: "stood_down",
        note: row.note ? `${row.note} | Incoming cleared by ${telegramName(ctx)}` : `Incoming cleared by ${telegramName(ctx)}`,
        updated_at: stamp
      }, {
        map_id: `eq.${row.map_id}`,
        operation_id: `eq.${row.operation_id}`
      });
    }
  }
  return respond(ctx, mode, `Cleared ${cleared}/${matched.length} incoming report${matched.length === 1 ? "" : "s"}.`);
}

async function insertIncomingRows(ctx, rows, scopeId) {
  const now = new Date().toISOString();
  let saved = 0;
  for (const row of rows) {
    const coord = row.defendedCoord || row.attackerCoord || "";
    const incoming = {
      map_id: coord ? mapIdForCoord(coord) : galaxyToMapId(row.galaxy || defaultGalaxy),
      incoming_id: randomId(),
      operation_id: null,
      operation_short_id: null,
      defended_coord: row.defendedCoord || null,
      defended_region_id: row.defendedCoord ? astroToRegion(row.defendedCoord) : null,
      defended_system_id: row.defendedCoord ? astroToSystem(row.defendedCoord) : null,
      attacker_coord: row.attackerCoord || null,
      region_id: row.attackerCoord ? astroToRegion(row.attackerCoord) : null,
      system_id: row.attackerCoord ? astroToSystem(row.attackerCoord) : null,
      eta_minutes: row.etaMinutes,
      arrival_at: row.arrivalAt.toISOString(),
      reported_by: telegramName(ctx),
      reported_by_user_id: telegramUserId(ctx),
      chat_id: scopeId,
      hostile_fleet: row.rawLine,
      severity: "",
      verified: false,
      covered_by: null,
      covered_by_user_id: null,
      covered_at: null,
      note: row.note,
      status: "active",
      created_at: now,
      updated_at: now
    };
    if (await insertRow("b24_incoming", incoming)) saved += 1;
  }
  return saved;
}

async function handleIntel(ctx, text, mode) {
  const query = commandBody(text);
  const galaxy = await galaxyForContext(ctx);
  const parsed = parseLocation(query, galaxy);
  if (!parsed) {
    if (query) return sendBasesReport(ctx, mode, query);
    return respond(ctx, mode, "Use: !intel B24, B24:34, B24:34:06, B24:34:06:10, or !intel [player/guild]");
  }

  const scopeId = await operationScopeId(ctx);
  if (parsed.kind === "astro" && parsed.remainder) {
    const alliance = normalizeStanceTarget(parsed.remainder);
    if (!alliance) return respond(ctx, mode, "Use: !intel B24:45:21:10 [ROTC]");
    if (!(await safeUserCanUseOfficerCommands(ctx))) {
      return respond(ctx, mode, "Only Lysander officers can set a manual alliance assessment.");
    }
    if (!scopeId) return respond(ctx, mode, "No active operation group set. Open the approved guild group first.");

    const stamp = new Date().toISOString();
    const saved = await upsertRow("b24_intel_annotations", {
      map_id: galaxyToMapId(parsed.galaxy),
      chat_id: scopeId,
      coord: parsed.coord,
      alliance,
      updated_by: telegramName(ctx),
      updated_by_user_id: telegramUserId(ctx),
      created_at: stamp,
      updated_at: stamp
    }, "map_id,chat_id,coord");
    if (!saved) {
      return respond(ctx, mode, "Manual alliance save failed. Run supabase-intel-annotations.sql, then verify SUPABASE_SERVICE_ROLE_KEY in Render.");
    }

    const report = await buildLocationReport({ ...parsed, remainder: "" }, { includeSavedBases: true, scopeId });
    return respond(ctx, mode, `Lysander alliance saved: <code>${escapeHtml(parsed.coord)}</code> -> <b>${escapeHtml(alliance)}</b>\n\n${report}`, {
      parse_mode: "HTML",
      ...(await intelKeyboard(parsed.coord))
    });
  }

  const includeSavedBases = await userCanUseSensitiveCommands(ctx);
  const report = await buildLocationReport(parsed, { includeSavedBases, scopeId });
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

async function handleSectors(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const query = commandBody(text);
  const report = await buildSectorScoutReport(query, galaxy);
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
  const parsed = parseBasesQuery(commandBody(text).replace(/^@/, ""), await galaxyForContext(ctx));
  if (!parsed.query) return respond(ctx, mode, "Use: !bases playername or !bases B24 [ROTC]");
  if (looksLikeAstroSearch(parsed.query)) {
    return respond(ctx, mode, `That is an astro search. Use <code>${escapeHtml(mode)}astros ${escapeHtml(parsed.galaxy)} ${escapeHtml(parsed.query)}</code> for terrain, attributes, empty/occupied, or alliance filters.`, { parse_mode: "HTML" });
  }
  return sendBasesReport(ctx, mode, parsed.query, parsed.galaxy);
}

async function handleStance(ctx, text, mode, stance) {
  const raw = commandBody(text);
  if (!raw) return respond(ctx, mode, `Use: !${stance} [tag] or !${stance} B24:92:15:10`);
  const galaxy = await galaxyForContext(ctx);
  const parsed = parseLocation(raw, galaxy);
  const mapId = parsed?.coord ? mapIdForCoord(parsed.coord) : galaxyToMapId(galaxy);
  const now = new Date().toISOString();
  const rows = [];

  if (parsed?.kind === "astro") {
    rows.push(stanceRow(mapId, "coord", parsed.coord, stance, ctx, now));
    if (stance === "enemy") {
      const base = await fetchOne("b24_bases", { coord: parsed.coord }, mapId);
      const tag = normalizeStanceTarget(base?.guild);
      if (tag) rows.push(stanceRow(mapId, "tag", tag, "enemy", ctx, now));
    }
  } else {
    const tag = normalizeStanceTarget(raw);
    if (!tag) return respond(ctx, mode, `Use a coordinate or tag, like <code>!${stance} [ROTC]</code>.`, { parse_mode: "HTML" });
    rows.push(stanceRow(mapId, "tag", tag, stance, ctx, now));
  }

  const saved = [];
  for (const row of rows) {
    if (await upsertRow("b24_stances", row, "map_id,scope_type,scope_value")) saved.push(row);
  }
  if (!saved.length) return respond(ctx, mode, "Stance update failed. I could not reach Supabase.");

  const icon = stanceIcon(stance);
  const lines = saved.map((row) => `${icon} ${escapeHtml(row.scope_value)} marked ${escapeHtml(row.stance)}`);
  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function sendBasesReport(ctx, mode, query, galaxyOverride = "") {
  const galaxy = normalizeGalaxy(galaxyOverride) || await galaxyForContext(ctx);
  const pageInfo = parsePageFromQuery(query);
  query = pageInfo.query;
  const queryCommand = galaxyOverride ? `${galaxy} ${query}` : query;
  const scopeId = await operationScopeId(ctx);
  const [savedRows, importedRows, annotations] = await Promise.all([
    fetchRows("b24_user_bases", {
      status: "eq.active"
    }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" }),
    fetchRows("b24_bases", {}, { mapId: galaxyToMapId(galaxy), order: "coord.asc" }),
    scopeId ? fetchRows("b24_intel_annotations", {
      chat_id: `eq.${scopeId}`
    }, { mapId: galaxyToMapId(galaxy), order: "coord.asc" }) : []
  ]);
  const stances = await fetchStanceMap(galaxy);
  const canManageOperations = Boolean(scopeId && await safeUserCanUseOfficerCommands(ctx));
  const activeOperations = canManageOperations
    ? await fetchActiveOperations(galaxy, scopeId)
    : [];
  const activeAttackPlans = activeOperations.filter((operation) => operation.type === "attack");
  const addPlan = newestAttackPlan(activeAttackPlans);

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
  const annotationMatches = annotations.filter((row) => searchText(row.alliance).includes(needle));

  if (!savedMatches.length && !importedMatches.length && !annotationMatches.length) {
    return respond(ctx, mode, `No saved or imported bases found for ${escapeHtml(query)} in ${galaxy}.`, { parse_mode: "HTML" });
  }

  const owners = [...new Set([
    ...savedMatches.map((row) => row.owner_label || query),
    ...importedMatches.map((row) => [row.guild, row.label].filter(Boolean).join(" ") || query),
    ...annotationMatches.map((row) => `Lysander ${row.alliance}`)
  ])].join(", ");
  const lines = [
    `<b>${escapeHtml(owners)}</b>`,
    `${importedMatches.length} imported / ${savedMatches.length} saved / ${annotationMatches.length} Lysander-assessed bases in ${galaxy}`
  ];
  if (importedMatches.length) {
    lines.push("", "<b>Imported Intel</b>");
    importedMatches.forEach((row) => lines.push(formatImportedBaseLine(row, stances)));
  }
  if (savedMatches.length) {
    lines.push("", "<b>Saved By Users</b>");
    savedMatches.forEach((row) => lines.push(formatUserBaseLine(row)));
  }
  if (annotationMatches.length) {
    lines.push("", "<b>Lysander Assessments</b>");
    annotationMatches.forEach((row) => lines.push(`${escapeHtml(row.coord)} - Lysander alliance ${escapeHtml(row.alliance)}`));
  }
  const rowsForButtons = [...importedMatches, ...annotationMatches];
  const totalActionable = uniqueBaseCoords(rowsForButtons, savedMatches).length;
  const quickSetupRows = quickSetupKeyboardRows(
    galaxy,
    query,
    Boolean(canManageOperations && !activeOperations.length && totalActionable)
  );
  const shownFrom = Math.min(totalActionable, (pageInfo.page - 1) * 8 + 1);
  const shownTo = Math.min(totalActionable, pageInfo.page * 8);
  if (addPlan && totalActionable > 8) {
    lines.push("", `Buttons: ${shownFrom}-${shownTo} of ${totalActionable}`);
    if (shownTo < totalActionable) lines.push(`Next buttons: <code>$bases ${escapeHtml(queryCommand)} page ${pageInfo.page + 1}</code>`);
  }
  if (addPlan) {
    const addPlanNumber = attackNumberForOperation(activeAttackPlans, addPlan) || "?";
    lines.push("", `Officer shortcut: buttons add rows to attack <code>${escapeHtml(addPlanNumber)}</code> (${escapeHtml(attackDisplayName(addPlan))}).`);
    if (activeAttackPlans.length > 1) lines.push(`Other plans: <code>$attacks</code>`);
  } else if (quickSetupRows.length) {
    lines.push("", "<b>Quick Setup</b>");
    lines.push(`Create <b>${escapeHtml(quickAttackName(query))}</b> from all ${totalActionable} matching bases, or create a 4-hour scout agenda.`);
  }
  return respond(ctx, mode, lines.join("\n"), {
    parse_mode: "HTML",
    ...baseListKeyboard(rowsForButtons, savedMatches, pageInfo.page, addPlan, activeAttackPlans, quickSetupRows)
  });
}

async function handleBoard(ctx, text, mode) {
  const kind = boardKind(text);
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const [operations, appClaims, incomingRows] = await Promise.all([
    fetchActiveOperations(galaxy, scopeId, kind),
    kind === "defense" || kind === "scout" ? [] : fetchBoardClaims(galaxy, scopeId),
    kind === "attack" || kind === "scout" ? [] : fetchActiveIncoming(galaxy, scopeId)
  ]);
  const membersByOperation = await fetchMembersByOperation(operations);
  const claimsByOperation = await fetchClaimsByOperation(operations);
  const attacks = operations.filter((operation) => operation.type === "attack");
  const incomingOperationIds = new Set(incomingRows.map((row) => row.operation_id).filter(Boolean));
  const defenses = operations.filter((operation) => operation.type === "defense" && !incomingOperationIds.has(operation.operation_id));
  const scouts = operations.filter((operation) => operation.type === "scout");
  const attackCount = attacks.length + appClaims.length;

  const lines = [`<b>${galaxy} Board</b>`];
  if (kind !== "defense" && kind !== "scout") {
    lines.push("", `<b>Attacks</b> (${attackCount})`);
    const attackLines = [
      ...attacks.map((operation) => {
        return formatBoardOperationCompact(
          operation,
          membersByOperation.get(operation.operation_id) || [],
          claimsByOperation.get(operation.operation_id) || []
        );
      }),
      ...appClaims.map(formatBoardClaimCompact)
    ];
    lines.push(...(attackLines.length ? [`<pre>${attackLines.join("\n")}</pre>`] : []));
    if (!attackCount) lines.push("No active attack operations or app claims.");
  }
  if (kind !== "attack" && kind !== "scout") {
    const defenseLines = [
      ...incomingRows.map(formatDefenseBoardIncomingCompact),
      ...defenses.map((operation) => formatBoardOperationCompact(operation, membersByOperation.get(operation.operation_id) || []))
    ];
    lines.push("", `<b>Defense</b> (${defenseLines.length})`);
    lines.push(...(defenseLines.length ? [`<pre>${defenseLines.join("\n")}</pre>`] : ["No active defense operations."]));
  }
  if (kind !== "attack" && kind !== "defense") {
    lines.push("", `<b>Scouts</b> (${scouts.length})`);
    lines.push(...(scouts.length ? [`<pre>${scouts.map((operation) => formatBoardOperationCompact(operation, membersByOperation.get(operation.operation_id) || [])).join("\n")}</pre>`] : ["No active scout operations."]));
  }

  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleNext(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !next in a group or private chat so I know who to look up.");
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No active operation group set. Use $guild bind in your guild group first.");
  const scope = parseNextScope(text);
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
  const incoming = scope.kind === "empire" ? [] : await incomingForUserBases(galaxy, scopeId, bases, telegramUserId(ctx));
  const filteredOps = actionOps
    .filter((operation) => scope.kind === "all" || scope.kind === "combat" || operation.type === scope.kind)
    .filter((operation) => new Date(operation.arrival_at).getTime() <= Date.now() + scope.hours * 60 * 60 * 1000);
  const filteredIncoming = incoming
    .filter((row) => new Date(row.arrival_at).getTime() <= Date.now() + scope.hours * 60 * 60 * 1000);

  const lines = [
    `<b>${galaxy} Next Actions</b>`,
    `${scope.label}`,
    "",
    `<b>Operations</b> (${filteredOps.length})`,
    ...(filteredOps.length
      ? [`<pre>${filteredOps.slice(0, 8).map((operation) => formatBoardOperationCompact(operation, membersByOperation.get(operation.operation_id) || [])).join("\n")}</pre>`]
      : ["No active operations need you."]),
    "",
    `<b>Incoming Near Your Bases</b> (${filteredIncoming.length})`,
    ...(filteredIncoming.length
      ? [`<pre>${filteredIncoming.slice(0, 8).map(formatIncomingLine).join("\n")}</pre>`]
      : ["No active incoming matched your saved bases."]),
    "",
    `<b>Empire</b>`,
    `Saved bases: ${bases.length}`,
    bases.length ? `Use <code>!me bases</code> to list them.` : `Add one with <code>!mine ${galaxy}:06:10:20</code>.`,
    "",
    "Views: <code>!next combat</code>, <code>!next empire</code>, <code>!next 24h</code>"
  ];

  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

function parseNextScope(text) {
  const body = commandBody(text).trim().toLowerCase();
  const hoursMatch = body.match(/\b(\d{1,3})\s*h\b/);
  const hours = hoursMatch ? Math.max(1, Math.min(168, Number(hoursMatch[1]))) : 24;
  const kind = /\bempire\b/.test(body)
    ? "empire"
    : /\battack\b/.test(body)
      ? "attack"
      : /\bdefen[cs]e\b/.test(body)
        ? "defense"
        : /\bscout\b/.test(body)
          ? "scout"
          : /\bcombat\b/.test(body)
            ? "combat"
            : "all";
  const label = kind === "all"
    ? `Window: next ${hours}h`
    : `Window: next ${hours}h / ${kind}`;
  return { hours, kind, label };
}

async function incomingForUserBases(galaxy, scopeId, bases, userId) {
  const baseCoords = new Set(bases.map((base) => base.base_coord).filter(Boolean));
  const systems = new Set([...baseCoords].map(astroToSystem));
  const regions = new Set([...baseCoords].map(astroToRegion));
  const incoming = await fetchActiveIncoming(galaxy, scopeId);
  return incoming.filter((row) => {
    if (String(row.reported_by_user_id || "") === String(userId)) return true;
    if (row.defended_coord && baseCoords.has(row.defended_coord)) return true;
    if (row.defended_system_id && systems.has(row.defended_system_id)) return true;
    if (row.defended_region_id && regions.has(row.defended_region_id)) return true;
    return false;
  });
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

async function handleMe(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !me in a group or private chat so I know who to look up.");
  const galaxy = await galaxyForContext(ctx);
  const body = commandBody(text).trim().toLowerCase();
  const rows = await fetchRows("b24_user_bases", {
    user_id: `eq.${telegramUserId(ctx)}`,
    status: "eq.active"
  }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" });
  if (body === "bases") {
    const message = rows.length
      ? [`<b>Your Saved Bases</b> (${rows.length})`, ...rows.map(formatUserBaseLine)].join("\n")
      : `You have no saved bases in ${galaxy}. Add one with <code>!mine ${galaxy}:06:10:20</code>`;
    return respond(ctx, mode, message, { parse_mode: "HTML" });
  }

  const scopeId = await operationScopeId(ctx);
  const access = scopeId ? await fetchAccessMember(scopeId, telegramUserId(ctx)) : null;
  const lines = [
    `<b>${escapeHtml(telegramName(ctx))}</b>`,
    `Galaxy: ${escapeHtml(galaxy)}`,
    scopeId ? `Active guild: ${escapeHtml(await operationScopeLabel(ctx, scopeId))}` : "Active guild: none",
    `Access: ${escapeHtml(access ? `${access.status}/${access.role}` : "not onboarded")}`,
    `Saved bases: ${rows.length}`,
    "",
    "Use <code>!next</code> for immediate actions.",
    "Use <code>!me bases</code> for your base list."
  ];
  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
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
  const [astro, base, savedBases, stances, annotation] = await Promise.all([
    fetchOne("b24_astros", { coord }, mapIdForCoord(coord)),
    fetchOne("b24_bases", { coord }, mapIdForCoord(coord)),
    includeSavedBases ? fetchRows("b24_user_bases", {
      base_coord: `eq.${coord}`,
      status: "eq.active"
    }, { mapId: mapIdForCoord(coord), order: "owner_label.asc" }) : [],
    fetchStanceMap(galaxyFromCoord(coord)),
    fetchIntelAnnotation(coord, options.scopeId)
  ]);

  if (!astro && !base && !savedBases.length) return `No intel found for ${escapeHtml(coord)} yet.`;

  const icon = base ? stanceIcon(resolveBaseStance(base, stances)) : "";
  const lines = [`<b>${escapeHtml(`${icon ? `${icon} ` : ""}${coord}`)}</b>`];
  if (astro) {
    const attrs = Array.isArray(astro.attributes) ? astro.attributes.join(" / ") : "";
    lines.push(`${escapeHtml(astro.terrain || "Unknown")} ${escapeHtml(astro.astro_type || "Astro")}`);
    if (attrs) lines.push(`Attributes: ${escapeHtml(attrs)}`);
    lines.push(`Base: ${astro.has_base ? "Yes" : "No"}`);
  }
  if (base) {
    const stance = resolveBaseStance(base, stances);
    if (stance) lines.push(`Stance: ${escapeHtml(stance)}`);
    if (base.guild) lines.push(`Guild: ${escapeHtml(base.guild)}`);
    if (base.label) lines.push(`Owner: ${escapeHtml(base.label)}`);
  }
  if (annotation?.alliance) lines.push(`Lysander alliance: ${escapeHtml(annotation.alliance)}`);
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
  if (!parsed.filter && !parsed.attrFilters.length && !parsed.bodyType) return buildAstroBreakdown(parsed.galaxy, parsed.region);
  return buildAstroSearch(parsed);
}

async function buildSectorScoutReport(query, fallbackGalaxy) {
  const parsed = parseSectorScoutQuery(query, fallbackGalaxy);
  const mapId = galaxyToMapId(parsed.galaxy);
  const [bases, astros] = await Promise.all([
    fetchAllRows("b24_bases", {}, { mapId, select: "coord,region_id,guild,label,updated_at", order: "coord.asc" }),
    fetchAllRows("b24_astros", {}, { mapId, select: "coord,region_id,has_base", order: "coord.asc" })
  ]);

  const nearRegions = regionsForTags(bases, parsed.nearTags);
  if (!nearRegions.size) {
    return `No ${escapeHtml(parsed.nearTags.map((tag) => tag.value).join(", "))} base regions found in ${escapeHtml(parsed.galaxy)}.`;
  }
  const excludedRegions = regionsForTags(bases, parsed.excludedTags);
  const adjacentCandidates = adjacentRegionSet(nearRegions);
  const candidateRegions = [...adjacentCandidates]
    .filter((region) => !excludedRegions.has(region))
    .filter((region) => !region.endsWith(":0"))
    .sort(compareRegionIds);

  const astroCounts = countRegions(astros);
  const baseCounts = countRegions(bases);
  const title = [
    `<b>Scout Regions ${escapeHtml(parsed.galaxy)}</b>`,
    `Near: ${escapeHtml(parsed.nearTags.map((tag) => tag.value).join(", "))}`,
    `Without: ${escapeHtml(parsed.excludedTags.map((tag) => tag.value).join(", "))}`,
    `Source regions: ${nearRegions.size} | Candidates: ${candidateRegions.length}`,
    ""
  ];

  if (!candidateRegions.length) {
    return [...title, "No adjacent sectors match that filter."].join("\n");
  }

  const lines = [...title, "<pre>"];
  candidateRegions.slice(0, 60).forEach((region) => {
    const astrosKnown = String(astroCounts.get(region) || 0).padStart(2, " ");
    const basesKnown = String(baseCounts.get(region) || 0).padStart(2, " ");
    lines.push(`${displayRegionId(region).padEnd(6, " ")} astros ${astrosKnown} bases ${basesKnown}`);
  });
  lines.push("</pre>");
  if (candidateRegions.length > 60) lines.push(`${candidateRegions.length - 60} more not shown.`);
  lines.push("", `Use <code>$sectors ${escapeHtml(parsed.galaxy)} ${escapeHtml(parsed.excludedTags[0]?.value || "[APP]")}</code> for the quick form.`);
  return lines.join("\n");
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
  if (parsed.attrFilters.length || parsed.excludedTags.length || parsed.includedTags.length || parsed.nearTags.length || parsed.emptyOnly || parsed.bodyType) {
    const allRows = await fetchAllRows("b24_astros", filters, {
      mapId: galaxyToMapId(parsed.galaxy),
      order: "coord.asc"
    });
    const excludedFootprint = await tagBaseFootprint(parsed, "excludedTags");
    const includedFootprint = await tagBaseFootprint(parsed, "includedTags");
    const nearFootprints = await tagAdjacentFootprints(parsed);
    const matched = allRows.filter((astro) => {
      return astroMatchesAttributeFilters(astro, parsed.attrFilters)
        && (!parsed.bodyType || String(astro.astro_type || "").toLowerCase() === parsed.bodyType)
        && (!parsed.emptyOnly || !astro.has_base)
        && !excludedFootprint.coords.has(astro.coord)
        && !excludedFootprint.regions.has(astro.region_id)
        && (!parsed.includedTags.length || includedFootprint.coords.has(astro.coord) || includedFootprint.regions.has(astro.region_id))
        && nearFootprints.every((footprint) => footprint.adjacentRegions.has(astro.region_id));
    });
    count = matched.length;
    rows = matched.slice(from, from + pageSize);
    titleParts.push([
      ...parsed.attrFilters.map(attributeFilterLabel),
      parsed.bodyType ? `${parsed.bodyType} only` : "",
      parsed.emptyOnly ? "empty only" : "",
      ...parsed.includedTags.map((tag) => `with ${tag.value}`),
      ...parsed.nearTags.map((tag) => `near ${tag.value}`),
      ...parsed.excludedTags.map((tag) => `without ${tag.value}`)
    ].filter(Boolean).join(", "));
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
  let withoutPage = original.replace(/(?:^|\s)(?:page\s*|p)\d+(?=\s|$)/i, " ").trim();
  const bodyTypeMatch = withoutPage.match(/(?:^|\s)(planets?)(?=\s|$)/i);
  const bodyType = bodyTypeMatch ? "planet" : "";
  withoutPage = withoutPage.replace(/(?:^|\s)planets?(?=\s|$)/ig, " ").trim();
  const emptyOnly = /(?:^|\s)(?:empty|unoccupied|nobase|no-base)(?=\s|$)/i.test(withoutPage);
  withoutPage = withoutPage.replace(/(?:^|\s)(?:empty|unoccupied|nobase|no-base)(?=\s|$)/ig, " ").trim();
  const excludedTags = parseExcludedTags(withoutPage);
  excludedTags.forEach((tag) => {
    withoutPage = withoutPage.replace(tag.regex, " ");
  });
  const includedTags = parseIncludedTags(withoutPage);
  includedTags.forEach((tag) => {
    withoutPage = withoutPage.replace(tag.regex, " ");
  });
  const nearTags = parseNearTags(withoutPage);
  nearTags.forEach((tag) => {
    withoutPage = withoutPage.replace(tag.regex, " ");
  });
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
  return { galaxy, region, filter, page, attrFilters, excludedTags, includedTags, nearTags, emptyOnly, bodyType };
}

function parseSectorScoutQuery(query, fallbackGalaxy) {
  const original = String(query || "").trim();
  const explicitGalaxy = normalizeGalaxy((original.toUpperCase().match(/\bB\d{2}\b/) || [])[0]);
  const galaxy = explicitGalaxy || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  let working = explicitGalaxy ? original.replace(new RegExp(`\\b${explicitGalaxy}\\b`, "i"), " ") : original;
  let nearTags = parseNearTags(working);
  nearTags.forEach((tag) => {
    working = working.replace(tag.regex, " ");
  });
  let excludedTags = parseExcludedTags(working);
  excludedTags.forEach((tag) => {
    working = working.replace(tag.regex, " ");
  });
  working = working.replace(/\b(sectors?|regions?|scout|without|near|adjacent)\b/gi, " ").trim();
  const plainTag = normalizeStanceTarget(working.split(/\s+/).find(Boolean) || "");
  if (!nearTags.length && !excludedTags.length) {
    const tag = plainTag || "[APP]";
    nearTags = [{ value: tag }];
    excludedTags = [{ value: tag }];
  } else if (nearTags.length && !excludedTags.length) {
    excludedTags = nearTags.map((tag) => ({ value: tag.value }));
  } else if (!nearTags.length && excludedTags.length) {
    nearTags = excludedTags.map((tag) => ({ value: tag.value }));
  }
  return { galaxy, nearTags, excludedTags };
}

function astrosNextQuery(parsed, page) {
  const scope = parsed.region || parsed.galaxy;
  return [scope, parsed.filter, ...parsed.attrFilters.map((filter) => filter.token), parsed.bodyType, parsed.emptyOnly ? "empty" : "", ...parsed.includedTags.map((tag) => `yes ${tag.value}`), ...parsed.nearTags.map((tag) => `near ${tag.value}`), ...parsed.excludedTags.map((tag) => `no ${tag.value}`), `page ${page}`].filter(Boolean).join(" ");
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
  return [...String(raw || "").matchAll(/(?:^|\s)(?:([asfmcg])\s*(\d{1,3})|(\d{1,3})\s*([asfmcg]))(?=\s|$)/gi)].map((match) => {
    const key = String(match[1] || match[4] || "").toLowerCase();
    const value = Number(match[2] || match[3]);
    const token = `${key}${value}`;
    return {
      ...attrMap[key],
      key,
      value,
      token,
      tokenRegex: new RegExp(`(?:^|\\s)(?:${key}\\s*${value}|${value}\\s*${key})(?=\\s|$)`, "i")
    };
  }).filter((filter) => Number.isFinite(filter.value));
}

function parseExcludedTags(raw) {
  return parseTagFilters(raw, "(?:no|not|without)");
}

function parseIncludedTags(raw) {
  return parseTagFilters(raw, "(?:yes|with|only)");
}

function parseNearTags(raw) {
  return parseTagFilters(raw, "(?:near|adjacent|nextto|next-to)");
}

function parseTagFilters(raw, keywordPattern) {
  const regex = new RegExp(`(?:^|\\s)${keywordPattern}\\s+(\\[[^\\]]{1,24}\\]|\\S{1,24})(?=\\s|$)`, "gi");
  return [...String(raw || "").matchAll(regex)].map((match) => {
    const value = normalizeStanceTarget(match[1]);
    return {
      value,
      regex: new RegExp(`(?:^|\\s)${keywordPattern}\\s+${escapeRegExp(match[1])}(?=\\s|$)`, "i")
    };
  }).filter((tag) => tag.value);
}

async function tagBaseFootprint(parsed, tagKey) {
  const tags = parsed[tagKey] || [];
  if (!tags.length) return { coords: new Set(), regions: new Set() };
  const rows = await fetchRows("b24_bases", {}, {
    mapId: galaxyToMapId(parsed.galaxy),
    order: "coord.asc"
  });
  const selected = new Set(tags.map((tag) => tag.value));
  const matches = rows.filter((row) => selected.has(normalizeStanceTarget(row.guild)));
  return {
    coords: new Set(matches.map((row) => row.coord).filter(Boolean)),
    regions: new Set(matches.map((row) => row.region_id || (row.coord ? astroToRegion(row.coord) : "")).filter(Boolean))
  };
}

function regionsForTags(baseRows, tags) {
  const selected = new Set((tags || []).map((tag) => normalizeStanceTarget(tag.value)).filter(Boolean));
  if (!selected.size) return new Set();
  return new Set(baseRows
    .filter((row) => selected.has(normalizeStanceTarget(row.guild)))
    .map((row) => row.region_id || (row.coord ? astroToRegion(row.coord) : ""))
    .filter(Boolean));
}

function countRegions(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const region = row.region_id || (row.coord ? astroToRegion(row.coord) : "");
    if (!region) return;
    counts.set(region, (counts.get(region) || 0) + 1);
  });
  return counts;
}

function compareRegionIds(a, b) {
  const [galaxyA, regionA] = String(a).split(":");
  const [galaxyB, regionB] = String(b).split(":");
  return galaxyA.localeCompare(galaxyB) || Number(regionA) - Number(regionB);
}

function displayRegionId(region) {
  const match = String(region || "").match(/^(B\d{2}):(\d{1,2})$/i);
  if (!match) return String(region || "?");
  return `${normalizeGalaxy(match[1])}:${String(Number(match[2])).padStart(2, "0")}`;
}

async function tagAdjacentFootprints(parsed) {
  if (!parsed.nearTags.length) return [];
  const baseFootprints = await Promise.all(parsed.nearTags.map(async (tag) => {
    const footprint = await tagBaseFootprint({ ...parsed, selectedNearTag: [tag] }, "selectedNearTag");
    return {
      tag: tag.value,
      coords: footprint.coords,
      regions: footprint.regions,
      adjacentRegions: adjacentRegionSet(footprint.regions)
    };
  }));
  return baseFootprints;
}

function adjacentRegionSet(regions) {
  const adjacent = new Set();
  [...regions].forEach((region) => {
    adjacentRegions(region).forEach((nearRegion) => adjacent.add(nearRegion));
  });
  return adjacent;
}

function adjacentRegions(regionId) {
  const match = String(regionId || "").match(/^(B\d{2}):(\d{1,2})$/i);
  if (!match) return [];
  const galaxy = normalizeGalaxy(match[1]);
  const regionNumber = Number(match[2]);
  if (!galaxy || !Number.isInteger(regionNumber) || regionNumber < 0 || regionNumber > 99) return [];
  const row = Math.floor(regionNumber / 10);
  const col = regionNumber % 10;
  const regions = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow < 0 || nextRow > 9 || nextCol < 0 || nextCol > 9) continue;
      const nextRegion = nextRow * 10 + nextCol;
      if (nextRegion === 0) continue;
      regions.push(`${galaxy}:${nextRegion}`);
    }
  }
  return regions;
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

function formatImportedBaseLine(row, stances = null) {
  const owner = [row.guild, row.label].filter(Boolean).join(" ") || "Unknown owner";
  const age = row.updated_at ? ` - ${intelAgeLabel(row.updated_at)}` : "";
  const icon = stanceIcon(resolveBaseStance(row, stances));
  return `${icon}${icon ? " " : ""}${escapeHtml(row.coord)} - ${escapeHtml(owner)}${age}`;
}

function resolveBaseStance(row, stances = null) {
  if (!stances) return "";
  const coordStance = stances.coord.get(row.coord);
  if (coordStance) return coordStance;
  const tag = normalizeStanceTarget(row.guild);
  return tag ? stances.tag.get(tag) || "" : "";
}

function stanceIcon(stance) {
  if (stance === "friend") return "🟢";
  if (stance === "enemy") return "🔴";
  return "";
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

function quickSetupKeyboardRows(galaxy, query = "", enabled = false) {
  if (!enabled) return [];
  const encodedQuery = encodeURIComponent(String(query || "")).slice(0, 30);
  const attackButton = (hours) => Markup.button.callback(
    `Create attack ${hours}h`,
    `quickattack:${hours}:${galaxy}:${encodedQuery}`
  );
  const rows = [
    [attackButton(1), attackButton(2)],
    [attackButton(3), attackButton(4)]
  ];
  if (query) rows.push([Markup.button.callback("Create scout agenda", `quickscout:${galaxy}:${encodedQuery}`)]);
  return rows;
}

function quickSetupKeyboard(galaxy, query = "", enabled = false) {
  const rows = quickSetupKeyboardRows(galaxy, query, enabled);
  return rows.length ? Markup.inlineKeyboard(rows) : {};
}

function quickAttackName(query = "") {
  const clean = String(query || "")
    .replace(/[\[\]]/g, "")
    .replace(/[^a-z0-9 _-]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "Main Attack";
  return `${clean.slice(0, 28)} Bash`;
}

function quickScoutName(query = "") {
  const attackName = quickAttackName(query);
  return attackName === "Main Attack" ? "Main Watch" : attackName.replace(/\s+Bash$/i, " Watch");
}

function newScoutAgendaKey() {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, "X");
  return `G-${suffix}`;
}

function scoutAgendaNote(key, name) {
  return `agenda:${key}|${String(name || "Scout Watch").slice(0, 48)}`;
}

function scoutAgendaInfo(operation) {
  if (operation?.type !== "scout") return null;
  const match = String(operation.note || "").match(/^agenda:(G-[A-Z0-9]{5})\|(.+)$/i);
  return match ? { key: match[1].toUpperCase(), name: match[2].trim() || "Scout Watch" } : null;
}

function groupScoutAgendas(operations) {
  const grouped = new Map();
  operations.forEach((operation) => {
    const info = scoutAgendaInfo(operation);
    if (!info) return;
    if (!grouped.has(info.key)) grouped.set(info.key, { ...info, operations: [] });
    grouped.get(info.key).operations.push(operation);
  });
  return [...grouped.values()]
    .map((agenda) => ({ ...agenda, operations: agenda.operations.sort((a, b) => String(a.target_coord).localeCompare(String(b.target_coord))) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchScoutAgendas(galaxy, scopeId) {
  const scouts = await fetchActiveOperations(galaxy, scopeId, "scout");
  return scouts.filter((operation) => scoutAgendaInfo(operation));
}

async function findScoutAgenda(galaxy, scopeId, agendaKey) {
  const agendas = groupScoutAgendas(await fetchScoutAgendas(galaxy, scopeId));
  return agendas.find((agenda) => agenda.key === String(agendaKey || "").toUpperCase()) || null;
}

async function scoutAgendaAssignments(agenda) {
  const entries = await Promise.all(agenda.operations.map(async (operation) => {
    const members = await fetchOperationMembers(operation);
    const assigned = members.find((member) => member.state !== "withdrawn" && String(member.role || "").toLowerCase() === "watch");
    return [operation.operation_id, assigned || null];
  }));
  return new Map(entries);
}

function formatScoutAgenda(agenda, assignments = new Map()) {
  const coords = agenda.operations.map((operation) => operation.target_coord).filter(Boolean);
  const covered = agenda.operations.filter((operation) => assignments.has(operation.operation_id)).length;
  return [
    `<b>${escapeHtml(agenda.name)} SCOUTING AGENDA</b>`,
    `Status: persistent until cancelled`,
    `Watch targets: ${coords.length} | Assigned: ${covered} | Open: ${coords.length - covered}`,
    "",
    `<pre>${agenda.operations.map((operation, index) => {
      const assignment = assignments.get(operation.operation_id);
      const state = assignment ? assignment.display_name || "assigned" : "open";
      return `${String(index + 1).padStart(2, "0")} ${operation.target_coord} ${state}`;
    }).join("\n")}</pre>`,
    "",
    "Choose Watch targets to take responsibility for a coordinate."
  ].join("\n");
}

function scoutAgendaListKeyboard(galaxy, agendas) {
  return Markup.inlineKeyboard(agendas.slice(0, 8).map((agenda) => [
    Markup.button.callback(`Open ${agenda.name}`.slice(0, 40), `scoutagenda:${galaxy}:${agenda.key}`)
  ]));
}

function scoutAgendaKeyboard(galaxy, agenda, assignments, canManage) {
  const rows = [[Markup.button.callback(`Watch targets (${agenda.operations.length})`, `scoutwatchlist:${galaxy}:${agenda.key}:1`)]];
  if (canManage) {
    rows.push([
      Markup.button.callback("Attack 1h", `scoutagendaattack:${galaxy}:${agenda.key}:1`),
      Markup.button.callback("Attack 2h", `scoutagendaattack:${galaxy}:${agenda.key}:2`)
    ], [
      Markup.button.callback("Attack 3h", `scoutagendaattack:${galaxy}:${agenda.key}:3`),
      Markup.button.callback("Attack 4h", `scoutagendaattack:${galaxy}:${agenda.key}:4`)
    ], [
      Markup.button.callback("Cancel agenda", `scoutagendacancel:${galaxy}:${agenda.key}`)
    ]);
  }
  return rows.length ? Markup.inlineKeyboard(rows) : {};
}

function formatScoutWatchList(agenda, assignments, page = 1) {
  const pageSize = 12;
  const from = (page - 1) * pageSize;
  const shown = agenda.operations.slice(from, from + pageSize);
  const covered = agenda.operations.filter((operation) => assignments.has(operation.operation_id)).length;
  return [
    `<b>${escapeHtml(agenda.name)} WATCH TARGETS</b>`,
    `Assigned: ${covered}/${agenda.operations.length} | Open: ${agenda.operations.length - covered}`,
    `Page ${page}/${Math.max(1, Math.ceil(agenda.operations.length / pageSize))}`,
    "",
    `<pre>${shown.map((operation, offset) => {
      const assignment = assignments.get(operation.operation_id);
      const state = assignment ? assignment.display_name || "assigned" : "open";
      return `${String(from + offset + 1).padStart(2, "0")} ${operation.target_coord} ${state}`;
    }).join("\n")}</pre>`,
    "Tap a target to claim or review its watch assignment."
  ].join("\n");
}

function scoutWatchListKeyboard(galaxy, agenda, assignments, page = 1) {
  const pageSize = 12;
  const from = (page - 1) * pageSize;
  const rows = agenda.operations.slice(from, from + pageSize).map((operation, offset) => {
    const index = from + offset + 1;
    const assignment = assignments.get(operation.operation_id);
    const status = assignment ? `${assignment.display_name || "assigned"}` : "open";
    return [Markup.button.callback(`${String(index).padStart(2, "0")} ${operation.target_coord} - ${status}`.slice(0, 60), `scoutwatchtarget:${galaxy}:${agenda.key}:${index}`)];
  });
  const totalPages = Math.max(1, Math.ceil(agenda.operations.length / pageSize));
  if (page < totalPages) rows.push([Markup.button.callback("Next targets", `scoutwatchlist:${galaxy}:${agenda.key}:${page + 1}`)]);
  if (page > 1) rows.push([Markup.button.callback("Previous targets", `scoutwatchlist:${galaxy}:${agenda.key}:${page - 1}`)]);
  return Markup.inlineKeyboard(rows);
}

function formatScoutWatchTarget(operation, assignment) {
  if (!assignment) {
    return [
      `<b>WATCH ${escapeHtml(operation.target_coord)}</b>`,
      "Open watch target.",
      "Take responsibility for watching this coordinate."
    ].join("\n");
  }
  return [
    `<b>WATCH ${escapeHtml(operation.target_coord)}</b>`,
    `Assigned: ${escapeHtml(assignment.display_name || "Unknown")}`,
    "Status: watch assigned"
  ].join("\n");
}

function scoutWatchTargetKeyboard(galaxy, agenda, index, assignment, mine) {
  if (assignment) {
    return mine
      ? Markup.inlineKeyboard([[Markup.button.callback("Release watch", `scoutwatchrelease:${galaxy}:${agenda.key}:${index}`)]])
      : {};
  }
  return Markup.inlineKeyboard([[Markup.button.callback("Take watch", `scoutwatchtake:${galaxy}:${agenda.key}:${index}`)]]);
}

async function matchingBaseCoords(galaxy, scopeId, query) {
  const needle = searchText(query);
  if (!needle) return [];
  const mapId = galaxyToMapId(galaxy);
  const [savedBases, bases, annotations] = await Promise.all([
    fetchAllRows("b24_user_bases", { status: "eq.active" }, { mapId, order: "base_coord.asc" }),
    fetchAllRows("b24_bases", {}, { mapId, order: "coord.asc" }),
    scopeId
      ? fetchAllRows("b24_intel_annotations", { chat_id: `eq.${scopeId}` }, { mapId, order: "coord.asc" })
      : []
  ]);
  return [...new Set([
    ...savedBases
      .filter((row) => searchText(row.owner_label).includes(needle))
      .map((row) => row.base_coord),
    ...bases
      .filter((row) => searchText(`${row.guild || ""} ${row.label || ""}`).includes(needle))
      .map((row) => row.coord),
    ...annotations
      .filter((row) => searchText(row.alliance).includes(needle))
      .map((row) => row.coord)
  ].filter(Boolean))].sort();
}

function baseListKeyboard(importedRows, savedRows, page = 1, addPlan = null, attacks = [], setupRows = []) {
  const pageSize = 8;
  const coords = uniqueBaseCoords(importedRows, savedRows).slice((page - 1) * pageSize, page * pageSize);
  if (!coords.length && !setupRows.length) return {};
  // Without an active plan, Quick Setup is the only meaningful action on a base list.
  if (!addPlan?.short_id) return setupRows.length ? Markup.inlineKeyboard(setupRows) : {};
  const addPlanNumber = addPlan ? attackNumberForOperation(attacks, addPlan) : 0;
  const rows = [...setupRows, ...coords.map((coord) => {
    const row = [
      Markup.button.callback(`Intel ${coord}`, `intel:${coord}`)
    ];
    row.push(Markup.button.callback(`Add ${addPlanNumber || addPlan.short_id}`, `attackadd:${addPlan.short_id}:${coord}`));
    return row;
  })];
  return Markup.inlineKeyboard(rows);
}

function uniqueBaseCoords(importedRows, savedRows) {
  return [...new Set([
    ...importedRows.map((row) => row.coord),
    ...savedRows.map((row) => row.base_coord)
  ].filter(Boolean))];
}

function parsePageFromQuery(query) {
  const raw = String(query || "").trim();
  const match = raw.match(/(?:^|\s)(?:page\s*|p)(\d+)(?=\s|$)/i);
  const page = match ? Math.max(1, Number(match[1])) : 1;
  return {
    page,
    query: raw.replace(/(?:^|\s)(?:page\s*|p)\d+(?=\s|$)/i, " ").trim()
  };
}

function parseBasesQuery(query, fallbackGalaxy = defaultGalaxy) {
  let raw = String(query || "").trim();
  let galaxy = normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  const explicitGalaxy = raw.match(/^(B\d{2})(?:\b|:)\s*/i);
  const leadingDigits = raw.match(/^(\d{2})\s+/);

  if (explicitGalaxy) {
    galaxy = normalizeGalaxy(explicitGalaxy[1]) || galaxy;
    raw = raw.slice(explicitGalaxy[0].length).trim();
  } else if (leadingDigits) {
    galaxy = normalizeGalaxy(`B${leadingDigits[1]}`) || galaxy;
    raw = raw.slice(leadingDigits[0].length).trim();
  }

  return { galaxy, query: raw };
}

async function fetchStanceMap(galaxy) {
  const rows = await fetchRows("b24_stances", {}, {
    mapId: galaxyToMapId(galaxy),
    order: "scope_type.asc,scope_value.asc"
  });
  return {
    coord: new Map(rows.filter((row) => row.scope_type === "coord").map((row) => [row.scope_value, row.stance])),
    tag: new Map(rows.filter((row) => row.scope_type === "tag").map((row) => [normalizeStanceTarget(row.scope_value), row.stance]))
  };
}

function stanceRow(mapId, scopeType, scopeValue, stance, ctx, timestamp) {
  return {
    map_id: mapId,
    scope_type: scopeType,
    scope_value: scopeType === "tag" ? normalizeStanceTarget(scopeValue) : scopeValue,
    stance,
    updated_by: telegramName(ctx),
    updated_by_user_id: telegramUserId(ctx),
    updated_at: timestamp
  };
}

function normalizeStanceTarget(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const bracket = raw.match(/\[[^\]]{1,24}\]/);
  if (bracket) return bracket[0].toUpperCase();
  const clean = raw.replace(/[^a-z0-9 _-]/gi, "").trim();
  if (!clean) return "";
  return `[${clean.toUpperCase()}]`;
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
  const rows = [];
  if (coord.split(":").length === 4) {
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

function looksLikeAstroSearch(value) {
  const raw = String(value || "").toLowerCase();
  return /(?:^|\s)(?:(?:a|s|f|m|g|c)\s*\d+|\d+\s*(?:a|s|f|m|g|c))\b/.test(raw) ||
    /\b(?:asteroid|arid|craters?|earthly|gas|glacial|metallic|oceanic|radioactive|rocky|tundra|volcanic|empty|occupied)\b/.test(raw) ||
    /\b(?:no|yes)\s+\[?[a-z0-9_-]+\]?\b/.test(raw);
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

async function fetchIntelAnnotation(coord, scopeId) {
  if (!coord || !scopeId) return null;
  return fetchOne("b24_intel_annotations", {
    coord,
    chat_id: String(scopeId)
  }, mapIdForCoord(coord));
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
    if (!claim.chat_id) return false;
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
    const claims = await fetchOperationClaims(operation);
    return [operation.operation_id, claims];
  }));
  return new Map(entries);
}

function fetchOperationClaims(operation) {
  return fetchRows("b24_claims", {
    operation_id: `eq.${operation.operation_id}`,
    status: "eq.active"
  }, { mapId: operation.map_id, order: "target_coord.asc,arrival_at.asc", limit: 1000 });
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
    Markup.button.callback("Target Pool", `attackpool:${operation.short_id}`),
    Markup.button.callback("Status", `op:status:${operation.operation_id}`),
    Markup.button.callback("Stand down", `op:close:${operation.operation_id}`)
  ]);
  return Markup.inlineKeyboard(rows);
}

function attackListKeyboard(attacks) {
  const rows = attacks.slice(0, 8).map((operation, index) => [
    Markup.button.callback(`Open ${index + 1}`, `attackpool:${operation.short_id}`),
    Markup.button.callback("Stand down", `op:close:${operation.operation_id}`),
    Markup.button.url("Open", mapUrl(galaxyFromCoord(operation.target_coord || defaultGalaxy), operation.target_coord || ""))
  ]);
  return rows.length ? Markup.inlineKeyboard(rows) : {};
}

function attackPoolKeyboard(operation, claims, page = 1, selectedCoord = "") {
  const targets = groupAttackTargets(operation, claims);
  const pageData = attackPoolPage(targets, page);
  const waveSlots = attackWaveSlots(operation).slice(0, 6);
  const rows = [];
  for (const [index, target] of pageData.rows.entries()) {
    const targetNumber = String(pageData.from + index).padStart(2, "0");
    if (target.target_coord === selectedCoord) {
      rows.push([Markup.button.callback(`${targetNumber} ${target.target_coord} ${target.state}`, `attackpool:${operation.short_id}:${pageData.page}`)]);
      for (let i = 0; i < waveSlots.length; i += 3) {
        rows.push(waveSlots.slice(i, i + 3).map((slot) => {
          const waveClaim = target.byWave.get(String(slot.index));
          const label = waveClaim?.claimed_by_user_id
            ? `W${slot.index} ${compactLabel(waveClaim.claimed_by || "claimed", 10)}`
            : `W${slot.index}`;
          const action = waveClaim?.claimed_by_user_id
            ? `noop:W${slot.index} claimed`
            : `attacktake:${operation.short_id}:${target.target_coord}:${slot.offsetMinutes}:${pageData.page}`;
          return Markup.button.callback(label, action);
        }));
      }
      continue;
    }
    rows.push([Markup.button.callback(
      `${targetNumber} ${target.target_coord} ${target.state}`,
      `attackpool:${operation.short_id}:${pageData.page}:${target.target_coord}`
    )]);
  }
  const nav = [];
  if (pageData.page > 1) nav.push(Markup.button.callback("Prev", `attackpool:${operation.short_id}:${pageData.page - 1}`));
  if (pageData.page < pageData.pages) nav.push(Markup.button.callback("Next", `attackpool:${operation.short_id}:${pageData.page + 1}`));
  if (nav.length) rows.push(nav);
  if (operation.target_coord) rows.push([Markup.button.url("Open First Target", mapUrl(galaxyFromCoord(operation.target_coord), operation.target_coord))]);
  rows.push([Markup.button.callback("Status", `op:status:${operation.operation_id}`)]);
  return rows.length ? Markup.inlineKeyboard(rows) : {};
}

function defensePoolKeyboard(incoming, page = 1) {
  const pageData = attackPoolPage(incoming, page);
  const rows = [];
  for (const [index, row] of pageData.rows.entries()) {
    if (row.covered_by_user_id) continue;
    const rowNumber = String(pageData.from + index).padStart(2, "0");
    rows.push([Markup.button.callback(
      `${rowNumber} cover ${defenseButtonLabel(row)}`,
      `defcover:${row.incoming_id}:${pageData.page}`
    )]);
  }
  const nav = [];
  if (pageData.page > 1) nav.push(Markup.button.callback("Prev", `defpool:${pageData.page - 1}`));
  if (pageData.page < pageData.pages) nav.push(Markup.button.callback("Next", `defpool:${pageData.page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback("Refresh", `defpool:${pageData.page}`)]);
  return rows.length ? Markup.inlineKeyboard(rows) : {};
}

async function formatAttackPool(operation, claims, page = 1, selectedCoord = "") {
  const targets = groupAttackTargets(operation, claims);
  const pageData = attackPoolPage(targets, page);
  const openTargets = targets.filter((target) => target.claimedWaves < target.totalWaves);
  const claimedWaves = targets.reduce((sum, target) => sum + target.claimedWaves, 0);
  const sentWaves = targets.reduce((sum, target) => sum + target.sentWaves, 0);
  const totalWaves = targets.reduce((sum, target) => sum + target.totalWaves, 0);
  const lines = [
    `<b>${escapeHtml(attackDisplayName(operation))} TARGET POOL</b>`,
    `Landing window starts: ${escapeHtml(formatClockLabel(new Date(operation.arrival_at)))} (${formatEta(new Date(operation.arrival_at))})`,
    `Waves: ${attackWaveCount(operation)}`,
    `Targets: ${targets.length} | Open: ${openTargets.length} | Waves claimed: ${claimedWaves}/${totalWaves} | Sent: ${sentWaves}`,
    pageData.pages > 1 ? `Page: ${pageData.page}/${pageData.pages}` : "",
    ""
  ].filter(Boolean);

  if (!targets.length) {
    lines.push("No targets in this pool yet.");
    lines.push(`Add: <code>$attack add ${escapeHtml(operation.short_id)} B24:44:76:10</code>`);
    return lines.join("\n");
  }

  const rows = pageData.rows.map((target, index) => formatAttackPoolClaim(operation, target, pageData.from + index));
  lines.push("<pre>");
  lines.push(...rows);
  lines.push("</pre>");
  lines.push(`${pageData.from}-${pageData.to} of ${targets.length} shown.`);

  const firstOpen = pageData.rows.find((target) => target.claimedWaves < target.totalWaves) || openTargets[0];
  if (firstOpen) {
    lines.push("");
    const firstOpenSlot = attackWaveSlots(operation).find((slot) => !firstOpen.byWave.get(String(slot.index))?.claimed_by_user_id) || attackWaveSlots(operation)[0];
    lines.push(`Claim: <code>!take ${escapeHtml(operation.short_id)} ${escapeHtml(firstOpen.target_coord)} ${escapeHtml(firstOpenSlot.label)}</code>`);
    lines.push(selectedCoord
      ? `Tap an open wave for ${escapeHtml(selectedCoord)}. Buttons show waves 1-${Math.min(attackWaveCount(operation), 6)}.`
      : "Tap a target button to show its wave buttons.");
    if (attackWaveCount(operation) > 6) lines.push("Use the command for later waves.");
  }
  if (pageData.page < pageData.pages) lines.push(`Next page: <code>!attacks ${escapeHtml(operation.short_id)} page ${pageData.page + 1}</code>`);
  lines.push(`Board: <code>$board attack</code>`);
  return lines.join("\n");
}

function formatDefensePool(galaxy, incoming, page = 1, query = "") {
  const pageData = attackPoolPage(incoming, page);
  const open = incoming.filter((row) => !row.covered_by_user_id).length;
  const covered = incoming.length - open;
  const title = query ? `${galaxy} DEFENSE ${query}` : `${galaxy} DEFENSE`;
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    `Incoming: ${incoming.length} | Open: ${open} | Covered: ${covered}`,
    pageData.pages > 1 ? `Page: ${pageData.page}/${pageData.pages}` : "",
    ""
  ].filter(Boolean);

  if (!incoming.length) {
    lines.push("No active incoming reports.");
    lines.push("Report: <code>$report B24:18:40:10 B24:34:64:40 1:12:03 8,950</code>");
    return lines.join("\n");
  }

  lines.push("<pre>");
  lines.push(...pageData.rows.map((row, index) => formatDefensePoolLine(row, pageData.from + index)));
  lines.push("</pre>");
  lines.push(`${pageData.from}-${pageData.to} of ${incoming.length} shown.`);
  const firstOpen = pageData.rows.find((row) => !row.covered_by_user_id);
  if (firstOpen) lines.push("", "Tap a cover button when defense is assigned.");
  if (pageData.page < pageData.pages) lines.push(`Next page: <code>$defense page ${pageData.page + 1}</code>`);
  lines.push(`Board: <code>$board defense</code>`);
  return lines.join("\n");
}

function attackPoolPage(claims, page = 1) {
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(claims.length / pageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (safePage - 1) * pageSize;
  const rows = claims.slice(start, start + pageSize);
  return {
    page: safePage,
    pages,
    rows,
    from: claims.length ? start + 1 : 0,
    to: Math.min(claims.length, start + rows.length)
  };
}

function attackNote(name, waves) {
  return `${String(name || "attack").trim()} | waves:${waves}`;
}

function attackDisplayName(operation) {
  return String(operation?.note || "attack")
    .replace(/\s*\|\s*waves:\d+\s*$/i, "")
    .trim() || "attack";
}

function attackWaveCount(operation) {
  const waves = Number((String(operation?.note || "").match(/\|\s*waves:(\d+)/i) || [])[1]);
  return Number.isInteger(waves) && waves >= 1 && waves <= 12 ? waves : 3;
}

function attackWaveSlots(operation) {
  const baseTime = new Date(operation.arrival_at).getTime();
  const count = attackWaveCount(operation);
  return Array.from({ length: count }, (_, index) => {
    const arrivalAt = new Date(baseTime + index * 60 * 60 * 1000);
    return {
      index: index + 1,
      offsetMinutes: index * 60,
      arrivalAt,
      label: formatClockLabel(arrivalAt)
    };
  });
}

function claimWaveIndex(operation, claim) {
  const baseTime = new Date(operation.arrival_at).getTime();
  const claimTime = new Date(claim.arrival_at || operation.arrival_at).getTime();
  if (!Number.isFinite(baseTime) || !Number.isFinite(claimTime)) return 1;
  return Math.max(1, Math.round((claimTime - baseTime) / 3600000) + 1);
}

function claimWaveKey(operation, claim) {
  return String(claimWaveIndex(operation, claim));
}

function groupAttackTargets(operation, claims) {
  const grouped = new Map();
  const slots = attackWaveSlots(operation);
  for (const claim of claims) {
    if (!claim.target_coord) continue;
    if (!grouped.has(claim.target_coord)) {
      grouped.set(claim.target_coord, {
        target_coord: claim.target_coord,
        region_id: claim.region_id,
        system_id: claim.system_id,
        claims: [],
        byWave: new Map()
      });
    }
    const group = grouped.get(claim.target_coord);
    group.claims.push(claim);
    group.byWave.set(claimWaveKey(operation, claim), claim);
  }
  return [...grouped.values()].sort((a, b) => a.target_coord.localeCompare(b.target_coord)).map((group) => {
    const claimedSlots = slots.filter((slot) => group.byWave.get(String(slot.index))?.claimed_by_user_id);
    const sentSlots = slots.filter((slot) => group.byWave.get(String(slot.index))?.confirmed_sent);
    return {
      ...group,
      totalWaves: slots.length,
      claimedWaves: claimedSlots.length,
      sentWaves: sentSlots.length,
      state: sentSlots.length === slots.length ? "sent" : claimedSlots.length === slots.length ? "full" : claimedSlots.length ? `${claimedSlots.length}/${slots.length}` : "open"
    };
  });
}

function formatAttackListDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "unknown date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function parseAttackNumber(value) {
  const match = String(value || "").trim().match(/^#?(\d{1,2})$/);
  if (!match) return 0;
  const number = Number(match[1]);
  return Number.isInteger(number) && number >= 1 ? number : 0;
}

async function findAttackByNumber(galaxy, scopeId, attackNumber) {
  const attacks = await fetchActiveOperations(galaxy, scopeId, "attack");
  return attacks[attackNumber - 1] || null;
}

function attackNumberForOperation(attacks, operation) {
  const index = attacks.findIndex((row) => row.operation_id === operation.operation_id);
  return index >= 0 ? index + 1 : 0;
}

function newestAttackPlan(attacks) {
  return [...attacks].sort((a, b) => {
    const bCreated = new Date(b.created_at || b.updated_at || b.arrival_at || 0).getTime();
    const aCreated = new Date(a.created_at || a.updated_at || a.arrival_at || 0).getTime();
    return bCreated - aCreated;
  })[0] || null;
}

function formatAttackPoolClaim(operation, target, number = 0) {
  const label = number ? `${String(number).padStart(2, "0")} ` : "";
  const coord = String(target.target_coord || "?").padEnd(12, " ");
  const clock = formatClockLabel(new Date(operation.arrival_at)).padEnd(5, " ");
  const state = String(target.state || "open").padEnd(7, " ");
  return escapeHtml(`${label}${coord} ${clock} ${state}`.trimEnd());
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
  const targets = operation.type === "attack" && claims.length ? groupAttackTargets(operation, claims) : [];
  const claimedWaves = targets.reduce((sum, targetRow) => sum + targetRow.claimedWaves, 0);
  const totalWaves = targets.reduce((sum, targetRow) => sum + targetRow.totalWaves, 0);
  const targetSummary = totalWaves ? ` - ${claimedWaves}/${totalWaves} waves claimed` : "";
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

function formatBoardOperationCompact(operation, members = [], claims = []) {
  const eta = formatCompactEta(new Date(operation.arrival_at));
  const scoutAgenda = scoutAgendaInfo(operation);
  const activeMembers = members.filter((member) => member.state !== "withdrawn");
  const stateCounts = countBy(activeMembers, "state");
  const joined = String(activeMembers.length).padStart(2, " ");
  const ready = String(stateCounts.ready || 0).padStart(2, " ");
  const sent = String(stateCounts.sent || 0).padStart(2, " ");
  const id = String(operation.short_id || "?").padEnd(7, " ");

  if (scoutAgenda) {
    const target = String(operation.target_coord || "?").padEnd(12, " ");
    return escapeHtml(`WATCH ${id} ${target} ${compactLabel(scoutAgenda.name, 14)}`);
  }

  if (operation.type === "defense") {
    const defended = operation.defended_coord || operation.target_coord || "?";
    const hostile = operation.hostile_origin || "?";
    return escapeHtml(`${eta} ${id} ${defended} <= ${hostile} j${joined} r${ready} s${sent}`);
  }

  const target = operation.target_coord || "?";
  if (operation.type === "attack" && !operation.target_coord && claims.length) {
    const name = compactLabel(attackDisplayName(operation), 14).padEnd(14, " ");
    const targets = groupAttackTargets(operation, claims);
    const claimedWaves = targets.reduce((sum, attackTarget) => sum + attackTarget.claimedWaves, 0);
    const totalWaves = targets.reduce((sum, attackTarget) => sum + attackTarget.totalWaves, 0);
    const claimSummary = `c${String(claimedWaves).padStart(2, " ")}/${String(totalWaves).padStart(2, " ")}`;
    return escapeHtml(`${eta} ${id} ${name} ${claimSummary} j${joined} r${ready} s${sent}`);
  }
  const base = `${eta} ${id} ${target}`;
  const targets = claims.length ? groupAttackTargets(operation, claims) : [];
  const claimedWaves = targets.reduce((sum, attackTarget) => sum + attackTarget.claimedWaves, 0);
  const totalWaves = targets.reduce((sum, attackTarget) => sum + attackTarget.totalWaves, 0);
  const claimSummary = totalWaves ? ` c${String(claimedWaves).padStart(2, " ")}/${String(totalWaves).padStart(2, " ")}` : "";
  return escapeHtml(`${base} j${joined} r${ready} s${sent}${claimSummary}`);
}

function formatBoardClaimCompact(claim) {
  const eta = formatCompactEta(new Date(claim.arrival_at));
  const target = String(claim.target_coord || "?").padEnd(12, " ");
  const who = compactLabel(claim.claimed_by || "open", 12).padEnd(12, " ");
  const state = claim.confirmed_sent ? "sent" : claim.claimed_by_user_id ? "planned" : "open";
  return escapeHtml(`${eta} ${target} ${who} ${state}`);
}

function compactLabel(value, max = 12) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}.`;
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
  const scoutAgenda = scoutAgendaInfo(operation);
  if (scoutAgenda) {
    return [
      `<b>${escapeHtml(operation.short_id)} SCOUT WATCH</b>`,
      `Agenda: ${escapeHtml(scoutAgenda.name)}`,
      `Target: ${escapeHtml(operation.target_coord || "?")}`,
      "Status: persistent until the agenda is cancelled",
      `Intel: ${escapeHtml(intel)}`,
      "",
      `<b>Members</b> (${activeMembers.length})`,
      ...(activeMembers.length ? activeMembers.map(formatOperationMemberLine) : ["No scout assigned yet."])
    ].join("\n");
  }
  if (operation.type === "attack" && !operation.target_coord) {
    const claims = await fetchOperationClaims(operation);
    const targets = groupAttackTargets(operation, claims);
    const claimed = targets.reduce((sum, target) => sum + target.claimedWaves, 0);
    const sent = targets.reduce((sum, target) => sum + target.sentWaves, 0);
    const totalWaves = targets.reduce((sum, target) => sum + target.totalWaves, 0);
    const lines = [
      `<b>${escapeHtml(operation.short_id)} ATTACK PLAN</b>`,
      `Name: ${escapeHtml(attackDisplayName(operation))}`,
      `Landing: ${formatEta(new Date(operation.arrival_at))}`,
      `Waves: ${attackWaveCount(operation)}`,
      `Targets: ${targets.length} | Waves claimed: ${claimed}/${totalWaves} | Sent: ${sent}`,
      `Commander: ${escapeHtml(operation.commander_label || "Unknown")}`,
      "",
      `<b>Members</b> (${activeMembers.length})`
    ];
    lines.push(...(activeMembers.length ? activeMembers.map(formatOperationMemberLine) : ["No one joined yet."]));
    lines.push("", `Pool: <code>!attacks ${escapeHtml(operation.short_id)}</code>`);
    return lines.join("\n");
  }
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
  const details = incomingNoteParts(incoming.note);
  const eta = formatCompactEta(new Date(incoming.arrival_at));
  const reporter = escapeHtml(incoming.reported_by || "Unknown");
  if (incoming.defended_coord) {
    const origin = incoming.attacker_coord || details.player || "?";
    const tag = details.tag || details.playerTag || "";
    return `${eta} ${escapeHtml(incoming.defended_coord)} &lt;= ${escapeHtml(origin)} ${escapeHtml(tag.padEnd(7))} ${escapeHtml(details.size.padStart(7))}`.trimEnd();
  }
  if (!incoming.attacker_coord) {
    const bases = incoming.reporter_base_hint ? ` (${escapeHtml(incoming.reporter_base_hint)})` : " (base unknown)";
    const extra = [details.size, details.tag, details.extra].filter(Boolean).join(" ");
    return `${eta} ${reporter}${bases}${extra ? ` ${escapeHtml(extra)}` : ""}`;
  }
  return `${eta} ${escapeHtml(incoming.attacker_coord)} ${escapeHtml(details.tag.padEnd(7))} ${escapeHtml(details.size.padStart(7))}`.trimEnd();
}

function formatDefensePoolLine(incoming, rowNumber) {
  const eta = formatCompactEta(new Date(incoming.arrival_at)).padEnd(6, " ");
  const defended = String(incoming.defended_coord || incoming.reporter_base_hint || "?").padEnd(12, " ");
  const attacker = String(incoming.attacker_coord || incomingNoteParts(incoming.note).tag || "?").padEnd(12, " ");
  const state = incoming.covered_by_user_id
    ? `covered ${compactLabel(incoming.covered_by || "someone", 10)}`
    : "open";
  return escapeHtml(`${String(rowNumber).padStart(2, "0")} ${eta} ${defended} <= ${attacker} ${state}`);
}

function formatDefenseBoardIncomingCompact(incoming) {
  const eta = formatCompactEta(new Date(incoming.arrival_at));
  const defended = incoming.defended_coord || incoming.reporter_base_hint || "?";
  const attacker = incoming.attacker_coord || incomingNoteParts(incoming.note).tag || "?";
  const details = incomingNoteParts(incoming.note);
  const state = incoming.covered_by_user_id
    ? `covered ${compactLabel(incoming.covered_by || "someone", 10)}`
    : "open";
  const size = details.size ? ` ${details.size}` : "";
  return escapeHtml(`${eta} ${defended} <= ${attacker}${size} ${state}`);
}

function defenseButtonLabel(incoming) {
  const defended = incoming.defended_coord || incoming.reporter_base_hint || "?";
  const attacker = incoming.attacker_coord || incomingNoteParts(incoming.note).tag || "?";
  return compactLabel(`${formatCompactEta(new Date(incoming.arrival_at))} ${defended} <= ${attacker}`, 48);
}

function incomingNoteParts(note) {
  const text = String(note || "");
  const tag = (text.match(/\bfrom\s+(\[[^\]]+\])/i) || [])[1] || "";
  const player = (text.match(/\bplayer\s+([^|]+)/i) || [])[1]?.trim() || "";
  const playerTag = (player.match(/(\[[^\]]+\])/) || [])[1] || "";
  const size = (text.match(/\bsize\s+([\d,]+)/i) || [])[1] || "";
  const extra = text
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && !/^from\s+/i.test(part) && !/^to\s+/i.test(part) && !/^size\s+/i.test(part))
    .join(" ");
  return { tag, player, playerTag, size, extra };
}

async function enrichIncomingReports(incoming, galaxy) {
  const genericUserIds = [...new Set(incoming
    .filter((row) => !row.defended_coord && !row.attacker_coord && row.reported_by_user_id)
    .map((row) => row.reported_by_user_id))];
  if (!genericUserIds.length) return incoming;
  const bases = await fetchRows("b24_user_bases", {
    status: "eq.active"
  }, { mapId: galaxyToMapId(galaxy), order: "base_coord.asc" });
  const basesByUser = new Map();
  bases.forEach((base) => {
    if (!genericUserIds.includes(String(base.user_id))) return;
    if (!basesByUser.has(String(base.user_id))) basesByUser.set(String(base.user_id), []);
    basesByUser.get(String(base.user_id)).push(base.base_coord);
  });
  return incoming.map((row) => {
    const userBases = basesByUser.get(String(row.reported_by_user_id || "")) || [];
    return {
      ...row,
      reporter_base_hint: userBases.length ? userBases.slice(0, 3).join(", ") + (userBases.length > 3 ? ` +${userBases.length - 3}` : "") : ""
    };
  });
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
  const extracted = extractAstroCoordsWithRemainder(rest, fallbackGalaxy);
  const coords = extracted.coords;
  if (!coords.length) return null;

  return {
    label: start.label,
    arrivalAt: nextClockTime(start.label),
    coords,
    note: extracted.note
  };
}

function parseNamedAttackPlan(text) {
  const body = String(text || "").trim().replace(/^[!$]attack\s+/i, "").trim();
  const match = body.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+?)\s+(\d{1,2})(?:\s*(?:h|hr|hrs|hour|hours|w|wave|waves))?$/i);
  if (!match) return null;

  const start = parseClockTime(match[1], match[2], match[3]);
  if (!start) return null;

  const name = String(match[4] || "").trim();
  const waves = Number(match[5]);
  if (!name || !Number.isInteger(waves) || waves < 1 || waves > 12) return null;

  return {
    label: start.label,
    arrivalAt: nextClockTime(start.label),
    name,
    waves
  };
}

function parseAttackAdd(text, fallbackGalaxy) {
  const body = String(text || "").trim().replace(/^[!$]attack\s+/i, "").trim();
  const match = body.match(/^add\s+([A-Z]-?[A-Z0-9]{3,8}|\d{1,2})\s+([\s\S]+)$/i);
  if (!match) return null;
  const extracted = extractAstroCoordsWithRemainder(match[2], fallbackGalaxy);
  const attackNumber = parseAttackNumber(match[1]);
  return {
    attackNumber,
    shortId: attackNumber ? "" : normalizeShortId(match[1]),
    coords: extracted.coords,
    note: extracted.note
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
  return extractAstroCoordsWithRemainder(text, fallbackGalaxy).coords;
}

function extractAstroCoordsWithRemainder(text, fallbackGalaxy) {
  const results = [];
  const seen = new Set();
  const noteParts = [];
  let rest = String(text || "").trim();

  while (rest) {
    const parsed = parseCoordinate(rest, fallbackGalaxy);
    if (parsed?.kind === "astro") {
      if (!seen.has(parsed.coord)) {
        seen.add(parsed.coord);
        results.push(parsed.coord);
      }
      rest = String(parsed.remainder || "").trim();
      continue;
    }

    const tokenMatch = rest.match(/^(\S+)(?:\s+([\s\S]+))?$/);
    if (!tokenMatch) break;
    const token = tokenMatch[1];
    const cleaned = token.replace(/^[\[(]+/, "").replace(/[\]),.;]+$/, "");
    const tokenParsed = parseCoordinate(cleaned, fallbackGalaxy);
    if (tokenParsed?.kind === "astro") {
      if (!seen.has(tokenParsed.coord)) {
        seen.add(tokenParsed.coord);
        results.push(tokenParsed.coord);
      }
    } else {
      noteParts.push(token);
    }
    rest = String(tokenMatch[2] || "").trim();
  }

  return {
    coords: results,
    note: noteParts.join(" ").replace(/\s+/g, " ").trim()
  };
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

function formatCompactEta(date) {
  const diff = date.getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return "00h00m";
  const total = Math.ceil(diff / 60000);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}h${String(minutes).padStart(2, "0")}m`;
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

async function operationScopeLabel(ctx, scopeId = "") {
  if (!isPrivateChat(ctx)) return chatTitle(ctx);
  if (!ctx.from?.id) return scopeId || "unknown";
  const settings = await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false);
  if (scopeId && String(settings?.active_chat_id || "") === String(scopeId) && settings?.active_chat_label) {
    return settings.active_chat_label;
  }
  return scopeId || settings?.active_chat_label || "unknown";
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

  // Let the coordinate parser own compact formats such as 24452110 and 21452110.
  const directCoordinate = parseCoordinate(raw, fallbackGalaxy);
  if (directCoordinate) return directCoordinate;

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
  const exported = parseIncomingExportStream(String(value || "").replace(/\s+/g, " ").trim(), fallbackGalaxy);
  if (exported.length === 1) {
    const row = exported[0];
    return {
      defendedCoord: row.defendedCoord,
      attackerCoord: row.attackerCoord,
      minutes: row.etaMinutes,
      note: row.note || row.rawLine
    };
  }

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

function parseGenericIncomingReport(value, fallbackGalaxy) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,4}(?::\d{2}){0,2})(?:\s+([\d,]+))?(?:\s+(.+))?$/i);
  if (!match) return null;
  const duration = parseIncomingDuration(match[1]);
  if (!duration) return null;
  const size = match[2] ? `size ${match[2]}` : "";
  const note = [size, match[3] || ""].filter(Boolean).join(" | ");
  return {
    galaxy: normalizeGalaxy(fallbackGalaxy) || defaultGalaxy,
    attackerCoord: null,
    defendedCoord: null,
    etaMinutes: Math.max(1, Math.ceil(duration.ms / 60000)),
    arrivalAt: new Date(Date.now() + duration.ms),
    note,
    rawLine: raw
  };
}

function parseIncomingExportRows(value, fallbackGalaxy) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const streamRows = parseIncomingExportStream(normalized, fallbackGalaxy);
  if (streamRows.length) return streamRows;

  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const plain = parsePlainIncomingLine(line, fallbackGalaxy);
    if (plain) {
      rows.push(plain);
      continue;
    }
    const coords = [...line.matchAll(/\bB\d{2}:\d{2}:\d{2}:\d{2}\b/gi)].map((match) => normalizeCoordText(match[0], fallbackGalaxy));
    if (coords.length < 2) continue;
    const eta = parseEtaDuration(line);
    if (!eta) continue;
    const sizeMatch = line.match(/\bsize\s+([\d,]+)/i);
    const tags = [...line.matchAll(/\[[^\]]{1,24}\]/g)].map((match) => match[0]);
    const attackerCoord = coords[0];
    const defendedCoord = coords[1];
    rows.push({
      attackerCoord,
      defendedCoord,
      etaMinutes: Math.max(1, Math.ceil(eta.ms / 60000)),
      arrivalAt: new Date(Date.now() + eta.ms),
      note: [
        tags[0] ? `from ${tags[0]}` : "",
        tags[1] ? `to ${tags[1]}` : "",
        sizeMatch ? `size ${sizeMatch[1]}` : ""
      ].filter(Boolean).join(" | "),
      rawLine: line
    });
  }
  return rows;
}

function parsePlainIncomingLine(line, fallbackGalaxy) {
  const text = String(line || "").trim();
  const match = text.match(/\b(B\d{2}:\d{2}:\d{2}:\d{2})\b\s+(.{0,160}?)\b(B\d{2}:\d{2}:\d{2}:\d{2})\b\s+(?:ETA\s+)?(\d{1,4}(?::\d{2}){0,2})(?:\s+(?:Size\s+)?([\d,]+))?(?:\s+(.+))?$/i);
  if (!match) return null;
  const attackerCoord = normalizeCoordText(match[1], fallbackGalaxy);
  const defendedCoord = normalizeCoordText(match[3], fallbackGalaxy);
  const eta = parseIncomingDuration(match[4]);
  if (!eta) return null;
  const tags = [...text.matchAll(/\[[^\]]{1,24}\]/g)].map((tagMatch) => tagMatch[0]);
  const size = match[5] ? `size ${match[5]}` : "";
  const extra = (match[6] || "").trim();
  return {
    attackerCoord,
    defendedCoord,
    etaMinutes: Math.max(1, Math.ceil(eta.ms / 60000)),
    arrivalAt: new Date(Date.now() + eta.ms),
    note: [
      tags[0] ? `from ${tags[0]}` : "",
      tags[1] ? `to ${tags[1]}` : "",
      size,
      extra
    ].filter(Boolean).join(" | "),
    rawLine: text
  };
}

function parseIncomingExportStream(value, fallbackGalaxy) {
  const rows = [];
  const rowPattern = /\b(B\d{2}:\d{2}:\d{2}:\d{2})\b\s+(.{0,120}?)\s*->\s*\b(B\d{2}:\d{2}:\d{2}:\d{2})\b\s+(.{0,120}?)\s+ETA\s+(\d{1,3}:\d{2}(?::\d{2})?)(?:\s+Size\s+([\d,]+))?/gi;
  for (const match of String(value || "").matchAll(rowPattern)) {
    const attackerCoord = normalizeCoordText(match[1], fallbackGalaxy);
    const defendedCoord = normalizeCoordText(match[3], fallbackGalaxy);
    const eta = parseEtaDuration(`ETA ${match[5]}`);
    if (!eta) continue;
    const sourceLabel = match[2].trim();
    const defendedLabel = match[4].trim();
    const tags = [...`${sourceLabel} ${defendedLabel}`.matchAll(/\[[^\]]{1,24}\]/g)].map((tagMatch) => tagMatch[0]);
    rows.push({
      attackerCoord,
      defendedCoord,
      etaMinutes: Math.max(1, Math.ceil(eta.ms / 60000)),
      arrivalAt: new Date(Date.now() + eta.ms),
      note: [
        tags[0] ? `from ${tags[0]}` : "",
        tags[1] ? `to ${tags[1]}` : "",
        match[6] ? `size ${match[6]}` : ""
      ].filter(Boolean).join(" | "),
      rawLine: `${attackerCoord} ${sourceLabel} -> ${defendedCoord} ${defendedLabel} ETA ${match[5]}${match[6] ? ` Size ${match[6]}` : ""}`
    });
  }
  return rows;
}

function parseEtaDuration(value) {
  const match = String(value || "").match(/\bETA\s+(\d{1,3}):(\d{2})(?::(\d{2}))?\b/i);
  if (!match) return null;
  return parseIncomingDuration(match[3] ? `${match[1]}:${match[2]}:${match[3]}` : `${match[1]}:${match[2]}`);
}

function parseIncomingDuration(value) {
  const parts = String(value || "").trim().split(":").map(Number);
  if (!parts.length || parts.length > 3 || !parts.every(Number.isFinite)) return null;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 1) {
    minutes = parts[0];
    if (minutes < 1 || minutes > 1440) return null;
    return { ms: minutes * 60 * 1000 };
  } else if (parts.length === 2) {
    hours = parts[0];
    minutes = parts[1];
  } else {
    hours = parts[0];
    minutes = parts[1];
    seconds = parts[2];
  }
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59 || hours < 0) return null;
  return { ms: ((hours * 60 + minutes) * 60 + seconds) * 1000 };
}

function normalizeCoordText(coord, fallbackGalaxy) {
  const parsed = parseCoordinate(coord, fallbackGalaxy);
  return parsed?.coord || String(coord || "").toUpperCase();
}

function filterIncomingReports(incoming, query, fallbackGalaxy) {
  const raw = String(query || "").trim();
  if (!raw) return incoming;
  const parsed = parseLocation(raw, fallbackGalaxy);
  if (parsed?.kind === "astro") {
    return incoming.filter((row) => row.defended_coord === parsed.coord || row.attacker_coord === parsed.coord);
  }
  if (parsed?.kind === "system") {
    return incoming.filter((row) => row.defended_system_id === parsed.coord || row.system_id === parsed.coord);
  }
  if (parsed?.kind === "region") {
    return incoming.filter((row) => row.defended_region_id === parsed.coord || row.region_id === parsed.coord);
  }
  const tag = normalizeStanceTarget(raw);
  const needle = searchText(tag || raw);
  return incoming.filter((row) => {
    const haystack = searchText([row.hostile_fleet, row.note, row.reported_by, row.attacker_coord, row.defended_coord].filter(Boolean).join(" "));
    return haystack.includes(needle);
  });
}

function parseIncomingPage(query) {
  const raw = String(query || "").trim();
  const match = raw.match(/(?:^|\s)(?:page\s*|p)(\d+)(?=\s|$)/i);
  return {
    page: match ? Math.max(1, Number(match[1])) : 1,
    query: raw.replace(/(?:^|\s)(?:page\s*|p)\d+(?=\s|$)/i, " ").trim()
  };
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
  const fullCompact = raw.replace(/^[!$]/, "").trim().match(/^(\d{2})(\d{2})(\d{2})(\d{2})(?!\d)([\s\S]*)$/);
  if (fullCompact) {
    const [, galaxyPart, regionPart, systemPart, astroPart, remainder] = fullCompact;
    const nums = [regionPart, systemPart, astroPart].map(Number);
    if (nums.every(validCoordPart)) return coordinateResult(`B${galaxyPart}`, nums, remainder || "");
  }
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

  const compactAstro = working.match(/^:?\s*(\d{2})(\d{2})(\d{2})(?!\d)([\s\S]*)$/);
  if (compactAstro) {
    const nums = [compactAstro[1], compactAstro[2], compactAstro[3]].map(Number);
    if (nums.every(validCoordPart)) return coordinateResult(galaxy, nums, compactAstro[4] || "");
  }

  const compactSystem = working.match(/^:?\s*(\d{2})(\d{2})(?!\d)([\s\S]*)$/);
  if (compactSystem) {
    const nums = [compactSystem[1], compactSystem[2]].map(Number);
    if (nums.every(validCoordPart)) return coordinateResult(galaxy, nums, compactSystem[3] || "");
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

function mapUrl(galaxy, loc = "", chatId = "") {
  const separator = webAppUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ gal: galaxy, v: botBuild });
  if (loc) params.set("loc", loc);
  if (chatId) params.set("chat_id", String(chatId));
  return `${webAppUrl}${separator}${params.toString()}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeLogText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const command = commandName(text);
  const sensitive = new Set(["report", "incoming", "sos", "attack", "claim", "take", "sent", "mine", "save"]);
  if (sensitive.has(command)) return `${text.slice(0, 24)}... [redacted]`;
  return text.slice(0, 120);
}

const webhookHandler = webhookUrl ? bot.webhookCallback(webhookPath) : null;

http.createServer((request, response) => {
  const path = new URL(request.url || "/", "http://localhost").pathname;
  if (webhookHandler && path === webhookPath) {
    if (telegramWebhookSecret && request.headers["x-telegram-bot-api-secret-token"] !== telegramWebhookSecret) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Forbidden\n");
      return;
    }
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
    const webhookOptions = {
      allowed_updates: ["message", "channel_post", "callback_query"]
    };
    if (telegramWebhookSecret) webhookOptions.secret_token = telegramWebhookSecret;
    await bot.telegram.setWebhook(webhookUrl, webhookOptions);
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
