import { Telegraf, Markup } from "telegraf";
import http from "node:http";
import { createHmac } from "node:crypto";
import {
  BATTLE_HISTORY_COMMAND_ALIASES,
  BATTLE_HISTORY_COMMANDS,
  createBattleHistoryReader,
  formatHistoryTelegram,
  formatOccupiedTelegram,
  validateMiniAppHistoryRequest
} from "./battle-history.js";
import { resolveCommandMatches } from "./command-routing.js";
import { explicitGalaxyScope, personalGalaxySettings, readOnlyGalaxyQueryOptions, selectGalaxyPreference } from "./galaxy-context.js";
import { signMiniAppToken, verifyMiniAppToken } from "./miniapp-token.js";
import { buildGalaxyMapUrl, naturalGalaxySort, rowBelongsToMiniAppGalaxy, selectMiniAppGalaxy } from "./miniapp-galaxy.js";
import { approvalOfficerMessage, enlistmentOfficerMessage, officerNotificationRecipientIds } from "./access-notifications.js";

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
const miniAppAccessSecret = process.env.MINI_APP_ACCESS_SECRET || token;
const miniAppTokenMinutes = Math.max(5, Math.min(60, Number(process.env.MINI_APP_TOKEN_MINUTES || 20)));
const miniAppExportTokenDays = Math.max(1, Math.min(90, Number(process.env.MINI_APP_EXPORT_TOKEN_DAYS || 30)));
const primaryGuildTag = normalizeStanceTarget(process.env.PRIMARY_GUILD_TAG || "APP");
const primaryGuildId = String(process.env.PRIMARY_GUILD_ID || "APP").trim().toUpperCase() || "APP";
const configuredGuildScopeChatId = String(
  process.env.GUILD_SCOPE_CHAT_ID || approvedChatIds[0] || accessChatIds[0] || ""
).trim();
const accessMemberCache = new Map();
const approvedChatCache = new Map();
let primaryScopeCache = { value: "", expiresAt: 0 };
let importedGalaxyCache = { value: [], expiresAt: 0 };

if (!token) throw new Error("BOT_TOKEN is required");
if (!webAppUrl) throw new Error("WEB_APP_URL is required");
if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
if (!supabaseKey) throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required");
if (requireAccessControl) {
  const missing = [
    approvedChatIds.length || process.env.GUILD_SCOPE_CHAT_ID ? "" : "APPROVED_CHAT_IDS or GUILD_SCOPE_CHAT_ID",
    accessChatIds.length ? "" : "ACCESS_CHAT_IDS",
    officerUserIds.length ? "" : "OFFICER_USER_IDS",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? "" : "SUPABASE_SERVICE_ROLE_KEY",
    telegramWebhookSecret ? "" : "TELEGRAM_WEBHOOK_SECRET"
  ].filter(Boolean);
  if (missing.length) throw new Error(`REQUIRE_ACCESS_CONTROL is enabled but missing: ${missing.join(", ")}`);
}

const bot = new Telegraf(token);
const claimPattern = /^[!$](claim|attack)\s+(.+)$/i;
const targetClaimPattern = /^[!$](claim|take)\s+([ADS]-?[A-Z0-9]{3,8})\s+(.+)$/i;
const attackedPattern = /^[!$](attacked|sos)\s+(.+)$/i;
const minePattern = /^[!$]mine\s+(.+)$/i;
const saveMePattern = /^[!$]save\s+me\s+(.+)$/i;
const staleIntelMs = 24 * 60 * 60 * 1000;
const webhookPath = `/telegram-${webhookPathSecret}`;
const webhookUrl = webhookBaseUrl ? `${webhookBaseUrl}${webhookPath}` : "";
const botBuild = "2026-07-17.5";
const preferredCommandAliases = {
  help: ["h", "he", "hel", "help"],
  ohelp: ["oh", "ohelp"],
  onboardme: ["enlist", "on", "onboard", "onboardme"],
  approvechat: ["approvechat"],
  status: ["st", "status"],
  galaxy: ["g", "galaxy"],
  setgroup: ["setgroup"],
  buildplan: ["bp", "buildplan"],
  research: ["research"],
  researchplan: ["rp", "researchplan"],
  scout: ["sc", "scout"],
  scouts: ["scouting", "scoutings", "scouts"],
  watches: ["watched", "watches"],
  astros: ["as", "ast", "astr", "astro", "astros"],
  sectors: ["sec", "sector", "sectors"],
  regions: ["region", "regions"],
  report: ["rep", "repo", "repor", "report"],
  attacks: ["attacks"],
  friend: ["fr", "fri", "frie", "frien", "friend"],
  enemy: ["e", "en", "ene", "enem", "enemy"],
  history: BATTLE_HISTORY_COMMAND_ALIASES.history,
  occupied: BATTLE_HISTORY_COMMAND_ALIASES.occupied
};
const canonicalCommands = [
  "help", "ohelp", "onboardme", "approve", "approvechat", "officer", "demote", "ban", "access",
  "status", "version", "map", "wakeup", "buildplan", "research", "researchplan", "galaxy", "setgroup", "setgalaxy", "guild",
  "claim", "take", "attack", "scout", "scouts", "watches", "attacked", "sos", "intel", "astros",
  "stale", "score", "bases", "sectors", "regions", "op", "join", "respond", "ready", "sent", "leave",
  "standdown", "cancelop", "board", "defense", "next", "myops", "incoming", "report", "attacks",
  "targets", "claimed", "mine", "me", "friend", "enemy", ...BATTLE_HISTORY_COMMANDS
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

const researchPlans = new Map([
  [1, {
    target: "C2 -> E6 -> SD4 -> E8 -> WD1",
    guidance: "Maintain RL8 and SY8. This unlocks Robotic Factories, the Outpost Ship, and the Shipyards needed to build it.",
    reserve: 200,
    next: 2,
    priorities: ["Computer 2", "Energy 6", "Stellar Drive 4", "Energy 8", "Warp Drive 1"]
  }],
  [2, {
    target: "C4 / E8 / L2 / SD4 / WD1",
    guidance: "This is a pacing target, not a hard expansion requirement. Research only above the protected reserve.",
    reserve: 300,
    next: 3,
    priorities: ["Protect the Base #3 reserve", "Computer toward 4", "Laser toward 2"]
  }],
  [3, {
    target: "C6 / E8 / L4 / SD4 / WD1",
    guidance: "This is a pacing target, not a hard expansion requirement. Research only above the protected reserve.",
    reserve: 600,
    next: 4,
    priorities: ["Protect the Base #4 reserve", "Computer toward 6", "Laser toward 4"]
  }],
  [4, {
    target: "C8 / E8 / L6 / SD4 / WD1",
    guidance: "This is a pacing target, not a hard expansion requirement. Research only above the protected reserve.",
    reserve: 1100,
    next: 5,
    priorities: ["Protect the Base #5 reserve", "Computer toward 8", "Laser toward 6"]
  }],
  [5, {
    target: "C10 / E8 / L8 / SD4 / WD1",
    guidance: "Reach Computer 10 and Laser 8 before the six-base development cycle is complete.",
    reserve: 2100,
    next: 6,
    unlocks: ["Economic Centers at Computer 10", "Nanite Factories at Computer 10 + Laser 8"],
    priorities: ["Computer toward 10", "Laser toward 8", "Establish Base #6"]
  }],
  [6, {
    target: "C10 / E8 / L8 / SD4 / WD1",
    guidance: "Hold the core target. Optional Energy 10 only when energy or area is blocking development.",
    reserve: 5100,
    next: 7,
    priorities: ["Protect the Base #7 reserve", "Pause nonessential research", "Optional Energy 10 only when blocked"]
  }],
  [7, {
    target: "C10 / E8 / L8 / SD4 / WD1",
    guidance: "Freeze nonessential research. Optional Warp Drive 2 only when Outpost travel is the actual bottleneck.",
    reserve: 10100,
    next: 8,
    priorities: ["Protect the Base #8 reserve", "Freeze optional research", "Optional Warp Drive 2 only for a travel bottleneck"]
  }],
  [8, {
    target: "C10 / E8 / L8 / SD4 / WD1",
    guidance: "Expansion sprint complete. Select the next doctrine: economy, defense, fleet, or advanced expansion.",
    reserve: null,
    next: null,
    priorities: ["Choose the next strategic doctrine", "Keep expansion reserves separate from optional research"]
  }]
]);

const researchDoctrinePlans = {
  growth: {
    label: "Guide-Compatible Growth",
    goal: "Continue the Version 5 base guide through Base 16.",
    priorities: [
      "E10",
      "C20",
      "AI1-4",
      "C21-24",
      "E11-24",
      "TC1",
      "AI5-6",
      "CY1-2"
    ],
    unlocks: [
      "AI4 before the 11-base build: Android Factories",
      "C24 + E24 + TC1 before the 13-base build: Capitals",
      "AI6 + CY2 before the 14-base build: Orbital Shipyards",
      "Research bases: RL18 for AI, RL22 for CY, RL24 for TC"
    ],
    tradeoff: "Avoid unrelated combat research when it delays a structure unlock or expansion reserve."
  },
  economy: {
    label: "Economy",
    goal: "Increase income, usable area, and empire-wide economic capacity.",
    priorities: ["E10", "C20", "E20", "C24", "E24", "TC1", "AI4"],
    unlocks: [
      "Economic Centers",
      "Terraform",
      "Antimatter Plants",
      "Orbital Bases",
      "Biosphere Modification",
      "Capitals"
    ],
    tradeoff: "This path develops income and area faster, but delays combat and fleet specialization."
  },
  production: {
    label: "Production",
    goal: "Maximize structure construction and fleet-production capacity.",
    priorities: ["Hold C10 + L8 for Nanite Factories", "C20", "AI1-4", "AI5-6", "CY1-2"],
    unlocks: [
      "C10 + L8: Nanite Factories",
      "AI4: Android Factories",
      "CY2: Orbital Shipyards",
      "Each Cybernetics level improves construction and production empire-wide"
    ],
    tradeoff: "AI and Cybernetics are expensive. Protect expansion and fleet-production reserves first."
  },
  science: {
    label: "Science",
    goal: "Increase research output and connect dedicated research bases.",
    priorities: ["C20", "Primary research base RL18", "AI1-4", "AI5-6", "C24", "E24", "Linked bases RL20", "Primary base RL24", "TC1+"],
    unlocks: [
      "AI gives an empire-wide research bonus",
      "TC permits research links between developed research bases",
      "Supports advanced infrastructure and combat technologies"
    ],
    tradeoff: "Research infrastructure consumes credits that could become fleets, economic structures, or new bases."
  },
  defense: {
    label: "Defense",
    goal: "Unlock progressively stronger shielded base defenses.",
    priorities: [
      "Phase 1 Ion: E10 -> S2; L10 -> E12 -> I1; A10",
      "Phase 2 Photon: P8 -> E16 -> PH1; A14; S6",
      "Phase 3 Disruptor: L18 -> E20 -> D1; A18; S8",
      "Phase 4 Shield: I10 / S14",
      "Phase 4 Ring: PH10 / A22 / S12"
    ],
    unlocks: ["Ion Turrets", "Photon Turrets", "Disruptor Turrets", "Planetary Shield or Planetary Ring"],
    tradeoff: "Advance one meaningful defense phase at a time instead of researching every weapon tree evenly."
  },
  mobility: {
    label: "Mobility",
    goal: "Reduce response times and improve offensive reach.",
    priorities: ["E14", "ST1+", "E20", "WD12", "Continue WD for warp fleets", "Continue SD for rapid-response stellar fleets"],
    unlocks: ["Stealth after E14", "Jump Gates at E20 + WD12", "Faster travel through the drive used by the fleet"],
    tradeoff: "Speed does not replace economy or fleet strength. Stop near E20 / WD12 / ST1 unless travel remains the real bottleneck."
  },
  fleet: {
    label: "Fleet",
    goal: "Reach one selected unit unlock without funding unrelated capital-ship technologies.",
    priorities: ["Choose corvette, carrier, heavycruiser, battleship, dreadnought, titan, or leviathan"],
    unlocks: [],
    tradeoff: "A minimum unlock only makes a unit available; it does not make that unit the best economic choice."
  },
  balanced: {
    label: "Balanced",
    goal: "Continue growth without becoming economically or militarily hollow.",
    priorities: ["E10", "C20", "AI4", "A10 / S2 / I1", "C24 / E24 / TC1", "AI6 / CY2", "WD12 only when geography justifies it"],
    unlocks: ["Growth structures first", "One useful defensive tier", "One selected fleet specialization", "Mobility when travel is an actual constraint"],
    tradeoff: "Avoid researching every weapon tree evenly."
  }
};

const growthResearchStages = new Map([
  [9, "Push Computer 20, then begin AI. Deadline: AI4 before the 11-base build."],
  [10, "Complete AI4 and prepare one research base for RL24. Android Factories must be available for the 11-base build."],
  [11, "Push Computer 24 and Energy 24 toward Tachyon Communications 1."],
  [12, "Complete C24 / E24 / TC1. Capitals must be available for the 13-base build."],
  [13, "Push AI4 -> AI6, then Cybernetics 1 -> 2. Orbital Shipyards must be available for the 14-base build."],
  [14, "Core structure unlock path complete. Hold TC1 / CY2 and spend surplus on the secondary doctrine."],
  [15, "Continue the selected secondary doctrine while protecting Base 16 expansion credits."],
  [16, "Base-guide horizon reached. Choose economy, production, defense, mobility, science, or a fleet specialization."]
]);

const fleetResearchPlans = {
  corvette: {
    label: "Corvette",
    minimum: "Use the verified current game-table requirement for your server.",
    emphasis: ["Stellar Drive", "Armour", "The weapon technology used by the current corvette design"],
    note: "The reviewed doctrine did not include a verified Corvette minimum, so Lysander will not invent one."
  },
  carrier: {
    label: "Carrier",
    minimum: "Use the verified current game-table requirement for your server.",
    emphasis: ["Warp Drive", "Armour", "Fighter technology and the weapon path used by the escort fleet"],
    note: "The reviewed doctrine did not include a verified Carrier minimum, so Lysander will not invent one."
  },
  heavycruiser: {
    label: "Heavy Cruiser",
    minimum: "P6 / WD4 / A12 / S4",
    emphasis: ["Armour", "Plasma", "Shielding", "Warp Drive when mobility is limiting"]
  },
  battleship: {
    label: "Battleship",
    minimum: "I6 / WD8 / A16 / S8",
    emphasis: ["Armour", "Ion", "Shielding", "Warp Drive when mobility is limiting"]
  },
  dreadnought: {
    label: "Dreadnought",
    minimum: "PH6 / WD12 / A20 / S10",
    emphasis: ["Armour", "Photon", "Shielding", "Warp Drive"]
  },
  titan: {
    label: "Titan",
    minimum: "D6 / WD14 / A22 / S14",
    emphasis: ["Armour", "Disruptor", "Shielding", "Warp Drive"]
  },
  leviathan: {
    label: "Leviathan",
    minimum: "PH12 / WD18 / A24 / S16",
    emphasis: ["Armour", "Photon", "Shielding", "Warp Drive"]
  }
};

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
bot.command("status", async (ctx) => ctx.reply(await statusReport(ctx)));
bot.command("version", (ctx) => ctx.reply(versionReport()));
bot.command("board", async (ctx) => {
  if (!(await chatApproved(ctx))) return ctx.reply(notApprovedMessage(ctx), { parse_mode: "HTML" });
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
bot.action(/^regionagenda:(B\d{2}):([^:]{1,24})$/, handleRegionAgendaButton);
bot.action(/^scoutagenda:(B\d{2}):(G-[A-Z0-9]{5})$/, handleScoutAgendaButton);
bot.action(/^scoutregionmap:(B\d{2}):(G-[A-Z0-9]{5})$/, handleScoutRegionMapButton);
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
  const requestedGalaxy = explicitGalaxyFromText(ctx.message?.text || ctx.channelPost?.text || "");
  const galaxy = requestedGalaxy || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const accessUrl = mapUrlForContext(ctx, galaxy, "", scopeId);
  return ctx.reply(
    `${galaxy} Vision Tracker`,
    Markup.inlineKeyboard([
      Markup.button.url("Open Map", accessUrl)
    ])
  );
}

async function handleStart(ctx) {
  const lines = [
    "<b>Lysander</b>",
    "Guild intel and operations assistant.",
    "",
    "Start here:",
    "<code>!enlist</code> - request or refresh your access",
    "<code>!next</code> - show your current next step",
    "<code>!help</code> - show normal commands"
  ];
  return ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback("Next", "quick:next")]])
  });
}

async function handleQuickNextButton(ctx) {
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

  if (isExactCommand(lower, "approvechat")) return handleApproveChat(ctx, text, mode);

  if (isProtectedOperationalCommand(lower) && !(await chatApproved(ctx))) {
    return respond(ctx, mode, notApprovedMessage(ctx), { parse_mode: "HTML" });
  }
  // !next is intentionally available to pending recruits so it can explain
  // their next onboarding step without exposing operational information.
  const isOnboardingGuidance = isCommand(lower, "next");
  if (isSensitiveOperationalCommand(lower) && !isOnboardingGuidance && !(await userCanUseSensitiveCommands(ctx))) {
    return respond(ctx, mode, "You do not have permission to use VisionBot operation commands.");
  }

  if (isCommand(lower, "help")) return handleHelp(ctx, text, mode);
  if (isCommand(lower, "ohelp")) return handleOfficerHelp(ctx, mode);
  if (isCommand(lower, "onboardme")) return handleOnboardMe(ctx, text, mode);
  if (isCommand(lower, "approve") || isCommand(lower, "officer") || isCommand(lower, "demote") || isCommand(lower, "ban") || isCommand(lower, "access")) {
    return handleAccessCommand(ctx, text, mode);
  }
  if (isExactCommand(lower, "status")) return ctx.reply(await statusReport(ctx), { parse_mode: "HTML" });
  if (isExactCommand(lower, "version")) return ctx.reply(versionReport());
  if (isCommand(lower, "map")) return sendMapButton(ctx);
  if (isExactCommand(lower, "wakeup")) return handleWakeup(ctx, mode);
  if (isCommand(lower, "buildplan")) return handleBuildPlan(ctx, text, mode);
  if (isCommand(lower, "research")) return handleResearchDoctrine(ctx, text, mode);
  if (isCommand(lower, "researchplan")) return handleResearchPlan(ctx, text, mode);
  if (isCommand(lower, "galaxy")) return handleUserGalaxy(ctx, text, mode);
  if (isCommand(lower, "setgroup") || isCommand(lower, "setgalaxy")) return handleChatGalaxy(ctx, text, mode);
  if (isCommand(lower, "guild")) return handleGuild(ctx, text, mode);

  if (isProtectedOperationalCommand(lower) && !isPrivateChat(ctx)) await rememberActiveChat(ctx);

  if (isCommand(lower, "claim") || isCommand(lower, "take") || isCommand(lower, "attack")) return handleClaim(ctx, text, mode);
  if (isCommand(lower, "attacks")) return handleAttacks(ctx, text, mode);
  if (isCommand(lower, "scouts")) return handleScoutings(ctx, text, mode);
  if (isCommand(lower, "watches")) return handleWatches(ctx, text, mode);
  if (isCommand(lower, "scout")) return handleScout(ctx, text, mode);
  if (isCommand(lower, "attacked") || isCommand(lower, "sos")) return handleAttacked(ctx, text, mode);
  if (isCommand(lower, "report")) return handleIncomingReport(ctx, text, mode);
  if (isCommand(lower, "history")) return handleHistory(ctx, text, mode);
  if (isCommand(lower, "occupied")) return handleOccupied(ctx, text, mode);
  if (isCommand(lower, "intel")) return handleIntel(ctx, text, mode);
  if (isAstrosCommand(lower)) return handleAstros(ctx, text, mode);
  if (isCommand(lower, "sectors")) return handleSectors(ctx, text, mode);
  if (isCommand(lower, "regions")) return handleRegions(ctx, text, mode);
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
  if (isExactCommand(lower, "targets")) return handleTargets(ctx, text, mode);
  if (isExactCommand(lower, "claimed")) return handleClaimed(ctx, text, mode);
  if (isCommand(lower, "mine")) return handleMine(ctx, text, mode);
  if (isCommand(lower, "me")) return handleMe(ctx, text, mode);
  if (isCommand(lower, "save me")) return handleSaveMe(ctx, text, mode);

  const astroShortcut = parseAstrosShortcutCommand(text, await galaxyForContext(ctx));
  if (astroShortcut) {
    if (!(await chatApproved(ctx)) || !(await userCanUseSensitiveCommands(ctx))) {
      return respond(ctx, mode, "You do not have permission to use VisionBot intel commands.");
    }
    const report = await buildAstrosReport(astroShortcut.query, astroShortcut.galaxy);
    return respond(ctx, mode, report, { parse_mode: "HTML" });
  }

  const lookup = parseLookupCommand(text, await galaxyForContext(ctx));
  if (!lookup) return handleUnknownCommand(ctx, text, mode);
  if (!(await chatApproved(ctx)) || !(await userCanUseSensitiveCommands(ctx))) {
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
  const requestedTopic = commandName(String(input).trim().split(/\s+/)[1] || "");
  const topicAliases = {
    astro: "astros",
    search: "astros",
    history: "history",
    hist: "history",
    occupied: "history",
    occ: "history",
    stale: "stale",
    score: "score",
    build: "buildplan",
    bp: "buildplan",
    research: "researchplan",
    rp: "researchplan",
    sos: "defense",
    report: "incoming",
    scouts: "scout",
    scouting: "scout",
    scoutings: "scout",
    watches: "scout",
    watched: "scout",
    attacks: "attack",
    board: "operations",
    op: "operations"
  };
  const topic = topicAliases[requestedTopic] || requestedTopic;
  const topics = {
    setup: [
      "<b>Setup Help</b>",
      "",
      "<code>!enlist</code> - request APP access",
      "<code>$approvechat</code> - approve this Telegram room (officer)",
      "<code>/map [B23] [coord]</code> - open one galaxy without changing your defaults",
      "<code>!guild status</code> - show the shared APP operation scope",
      "<code>!galaxy B23</code> - set your personal galaxy (<code>!g</code> also works)",
      "<code>$setgroup B23</code> - set this Telegram room's galaxy",
      "<code>$setgalaxy B23</code> - older alias for <code>$setgroup</code>"
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
      "<code>$scouts</code>",
      "Shows persistent base-watch agendas created from a base list. Officers can turn an agenda into an attack pool or cancel it.",
      "<code>!watches</code>",
      "Shows the watch targets currently assigned to you. <code>$scoutings</code> and <code>!watched</code> still work as aliases.",
      "<code>$sectors [APP]</code>",
      "Find sectors near APP-held sectors that do not already contain an APP base.",
      "<code>$sectors B24 near [APP] not [APP]</code>",
      "Explicit version of the same region-level scouting query.",
      "<code>$regions B24</code>",
      "Lists every B24 region without friendly-base or scout coverage. Officers can turn it into a persistent region-watch agenda.",
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
      "<code>!friend [tag|coord]</code> - officer-only: mark a shared friendly classification",
      "<code>!enemy [tag|coord]</code> - officer-only: mark a shared hostile classification",
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
      "<code>!history [coord]</code> - coordinate battle, revolt, liberation, and fleet-observation timeline",
      "<code>!occupied [player|guild|region]</code> - current active occupations only"
    ],
    astros: [
      "<b>Astro Search Help</b>",
      "",
      "<code>!astros [filters]</code> - send search results to you privately",
      "<code>$astros [filters]</code> - post search results in this approved APP room",
      "",
      "<b>Scope and terrain</b>",
      "<code>$astros B24 craters</code> - all Craters astros in B24",
      "<code>$astros B24:36 craters</code> - Craters astros in B24:36 only",
      "<code>$astros B24 metallic planet</code> - planets only; excludes moons and asteroids",
      "",
      "<b>Attribute minimums</b>",
      "Use <code>a</code> area, <code>s</code> solar, <code>f</code> fertility, <code>m</code> metal, <code>g</code> gas, and <code>c</code> crystal.",
      "Both <code>m4</code> and <code>4m</code> work. Multiple filters are combined.",
      "<code>$astros B24:36 m4 f5 c2</code>",
      "<code>$astros B24 craters a85 m4 c2 s3 f5</code>",
      "",
      "<b>Base and alliance filters</b>",
      "<code>empty</code> - only astros without a base",
      "<code>no [APP]</code> - exclude regions containing that alliance",
      "<code>yes [ROTC]</code> - only that alliance's known bases",
      "<code>near [APP]</code> - only regions adjacent to APP-held regions",
      "<code>$astros B24 craters planet empty no [APP] near [ROTC]</code>",
      "",
      "<b>Paging</b>",
      "Add <code>page 2</code> (or <code>p2</code>) to continue a long result set.",
      "<code>$astros B24 craters m4 page 2</code>"
    ],
    history: [
      "<b>Battle History Help</b>",
      "",
      "<code>!history B24:14:64:30</code> - privately show a coordinate timeline",
      "<code>$history B24:14:64:30</code> - post the same scoped timeline in the approved guild chat",
      "<code>!occupied</code> - list current active occupations",
      "<code>!occupied [APP]</code> - filter by owner or occupier guild/player",
      "<code>!occupied B24:14</code> - filter by region",
      "",
      "Owner and occupier are separate. Current state comes from the occupation row; battles and events are historical evidence."
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
      "<code>!researchplan [1-16]</code>",
      "Shows lean expansion research through Base 7, then follows your selected branch.",
      "<code>!researchplan 8</code>",
      "Shows the post-opening doctrine branches.",
      "<code>!research doctrine [branch]</code>",
      "Saves your branch; growth is the default.",
      "<code>!researchplan 5 detail</code>",
      "Shows targets, unlocks, and research priorities.",
      "<code>!rp [1-8]</code>",
      "Short alias.",
      "",
      "Examples:",
      "<code>!buildplan 1</code>",
      "<code>!buildplan 12</code>",
      "<code>!researchplan 5 detail</code>"
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
    researchplan: [
      "<b>Expansion Research Help</b>",
      "",
      "<code>!researchplan [1-16]</code>",
      "Shows the expansion target or your saved post-opening branch for that base count.",
      "<code>!researchplan [1-7] detail</code>",
      "Adds unlocks, priorities, and the abbreviation key.",
      "<code>!researchplan [1-7] credits [amount]</code>",
      "Checks whether the next-base reserve is protected.",
      "<code>!researchplan [growth|economy|production|science|defense|mobility|fleet|balanced]</code>",
      "Shows a full branch without changing your saved choice.",
      "<code>!research doctrine [branch]</code>",
      "Saves the branch used by numbered plans from Base 9 onward.",
      "<code>!rp [1-16]</code>",
      "Short alias.",
      "",
      "Examples:",
      "<code>!researchplan 1</code>",
      "<code>!researchplan 5 detail</code>",
      "<code>!researchplan 5 credits 730</code>",
      "<code>!researchplan fleet battleship</code>",
      "<code>!research doctrine balanced</code>",
      "<code>!rp 7</code>"
    ],
    guild: [
      "<b>Guild Scope Help</b>",
      "",
      "Approved Lysander members are APP members automatically.",
      "<code>$approvechat</code> - approve this Telegram room (officer)",
      "<code>$approvechat status</code> - show this room's approval state",
      "<code>!guild status</code> - show the shared APP operation scope",
      "",
      "Every approved APP room reads and writes the same operations."
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
      "<code>!save me</code>/<code>$save me</code> - alias for updating one of your bases",
      "<code>$guild bind</code> - legacy alias for <code>$approvechat</code>"
    ]
  };

  if (topics[topic]) return topics[topic].join("\n");

  const status = await safeHelpStatus(ctx);
  return [
    "<b>Lysander</b>",
    "",
    "<code>!</code> replies to you privately. In an approved APP room, <code>$</code> posts to the room.",
    "Use <code>!next</code> whenever you are unsure what comes next.",
    "Lists and searches span imported galaxies unless you begin with <code>Bxx</code>.",
    "",
    status,
    "",
    "<b>START</b>",
    "<code>!enlist</code> - request APP access",
    "<code>!next</code> - your setup, watches, and urgent work",
    "<code>!g B23</code> - switch your personal galaxy",
    "<code>/map</code> - open the galaxy map",
    "",
    "<b>INTEL</b>",
    "<code>![coord]</code> - coordinate or system intel",
    "<code>!bases [player|tag]</code> - known bases",
    "<code>!astros [filters]</code> - search astros",
    "<code>!history [coord]</code> - battle and occupation history",
    "",
    "<b>SCOUT AND WATCH</b>",
    "<code>!scouts</code> - active scouting agendas",
    "<code>!watches</code> - your watch commitments",
    "<code>!scout [coord]</code> - claim or request a scout",
    "",
    "<b>OPERATIONS</b>",
    "<code>!attacks</code> - current attack plans",
    "<code>!claimed</code> - your commitments",
    "<code>!incoming</code> - incoming near saved bases",
    "<code>!next</code> - your immediate actions",
    "",
    "<b>EMPIRE</b>",
    "<code>!me</code> - profile and saved bases",
    "<code>!mine [coord]</code> - save one of your bases",
    "<code>!buildplan [1-16]</code> - base doctrine",
    "<code>!researchplan [1-16]</code> - expansion research doctrine",
    "",
    "<b>HELP</b>",
    "<code>!help [topic]</code>",
    "Topics: setup, attack, defense, scout, operations, intel, astros, history, stale, score, bases, incoming, doctrine, guild, aliases",
    "",
    "Officer reference: <code>$ohelp</code>"
  ].join("\n");
}

function officerHelpText() {
  return [
    "<b>Officer Commands</b>",
    "",
    "<b>Access</b>",
    "<code>$enlist</code> - create/update your access request",
    "<code>$approve [user] [private]</code> - approve a member",
    "<code>$officer [user]</code> - promote to officer",
    "<code>$demote [user]</code> - demote to member",
    "<code>$ban [user]</code> - block access",
    "<code>$access [user] [private|group]</code> - show/change access mode",
    "",
    "<b>Operations</b>",
    "<code>$approvechat</code> - approve this room for APP operations",
    "<code>$approvechat status</code> - show this room's approval state",
    "<code>$setgroup B23</code> - set this Telegram room's galaxy",
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
    "Lysander",
    "",
    "!enlist - request APP access",
    "!next - see your next step",
    "/map - open the map",
    "![coord] - coordinate intel",
    "!bases [player|tag] - known bases",
    "!astros [filters] - search astros",
    "!attacks - attack plans",
    "!scouts - scouting agendas",
    "!watches - your watch commitments",
    "!me / !mine [coord] - your bases",
    "!buildplan [1-16] / !researchplan [1-16] - doctrine",
    "",
    "Try !help [topic] for more detail."
  ].join("\n");
}

async function handleOnboardMe(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "I need a Telegram user to onboard.");
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP room is available yet. Ask an officer to run <code>$approvechat</code> in the APP room.", { parse_mode: "HTML" });
  const existing = await fetchAccessMember(scopeId, telegramUserId(ctx));
  if (existing?.status === "banned") return respond(ctx, mode, "Your Lysander access is blocked for this guild.");
  const status = existing?.status || "pending";
  const role = existing?.role || "member";
  const saved = await upsertAccessMember({
    chatId: scopeId,
    userId: telegramUserId(ctx),
    username: ctx.from.username || "",
    displayName: telegramName(ctx),
    role,
    status,
    accessMode: existing?.access_mode || "group",
    approvedBy: existing?.approved_by || "",
    approvedAt: existing?.approved_at || null
  });
  if (!saved) return respond(ctx, mode, "I could not save your onboarding record. Has the Supabase access table been created?");
  const scopeLabel = await operationScopeLabel(ctx, scopeId).catch(() => String(scopeId));
  await notifyAccessOfficers(scopeId, enlistmentOfficerMessage({
    guild: primaryGuildId,
    scopeLabel,
    status,
    member: {
      userId: telegramUserId(ctx),
      username: ctx.from.username || "",
      displayName: telegramName(ctx)
    }
  }));
  return respond(ctx, mode, status === "active"
    ? `Enlisted as ${role}. Lysander access is active for APP${existing?.access_mode === "private" ? " in private mode" : ""}.`
    : "APP enlistment saved. An officer can approve you with <code>$approve</code>.", { parse_mode: "HTML" });
}

async function handleAccessCommand(ctx, text, mode) {
  if (!(await userCanUseOfficerCommands(ctx))) {
    return respond(ctx, mode, "Only Lysander officers/owners can manage access.");
  }
  const command = commandName(text);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP scope exists. Approve a room with <code>$approvechat</code> first.", { parse_mode: "HTML" });
  const body = commandBody(text);
  const accessModeMatch = body.match(/(?:^|\s)(private|group)\s*$/i);
  const requestedAccessMode = accessModeMatch ? accessModeMatch[1].toLowerCase() : "";
  const targetQuery = accessModeMatch ? body.slice(0, accessModeMatch.index).trim() : body;
  const target = await resolveAccessTarget(ctx, targetQuery, scopeId);
  if (!target) {
    const suffix = ["approve", "access"].includes(command) ? " [private|group]" : "";
    return respond(ctx, mode, `Use: <code>$${command} @username${suffix}</code> or reply to a user's message with <code>$${command}${suffix}</code>.`, { parse_mode: "HTML" });
  }
  if (target.ambiguous?.length) {
    return respond(ctx, mode, [
      `Multiple users match <code>${escapeHtml(targetQuery)}</code>:`,
      ...target.ambiguous.slice(0, 8).map((row) => `- ${escapeHtml(accessMemberLabel(row))}`)
    ].join("\n"), { parse_mode: "HTML" });
  }

  const existing = target.row || await fetchAccessMember(scopeId, target.userId);
  if (command === "access" && !requestedAccessMode) {
    const row = existing;
    return respond(ctx, mode, formatAccessStatus(row, target), { parse_mode: "HTML" });
  }
  if (command === "access" && !existing) {
    return respond(ctx, mode, `No enlistment record exists for ${escapeHtml(target.displayName || target.userId)}. Ask them to run <code>!enlist</code> first.`, { parse_mode: "HTML" });
  }

  const next = command === "access"
    ? { status: existing.status, role: existing.role }
    : accessCommandState(command);
  if (!next) return respond(ctx, mode, "Unknown access command.");
  const accessMode = requestedAccessMode || existing?.access_mode || "group";
  const saved = await upsertAccessMember({
    chatId: scopeId,
    userId: target.userId,
    username: target.username || existing?.username || "",
    displayName: target.displayName || existing?.display_name || target.userId,
    role: next.role || existing?.role || "member",
    status: next.status,
    accessMode,
    approvedBy: telegramUserId(ctx),
    approvedAt: next.status === "active" ? new Date().toISOString() : existing?.approved_at || null
  });
  if (!saved) return respond(ctx, mode, "Could not update access. Has the Supabase access table been created?");
  if (command === "approve") {
    const scopeLabel = await operationScopeLabel(ctx, scopeId).catch(() => String(scopeId));
    await notifyAccessOfficers(scopeId, approvalOfficerMessage({
      guild: primaryGuildId,
      scopeLabel,
      accessMode,
      member: {
        userId: target.userId,
        username: target.username || existing?.username || "",
        displayName: target.displayName || existing?.display_name || target.userId
      },
      approvedBy: {
        userId: telegramUserId(ctx),
        username: ctx.from?.username || "",
        displayName: telegramName(ctx)
      }
    }));
  }
  return respond(ctx, mode, `${escapeHtml(target.displayName || existing?.display_name || target.userId)} is now ${next.status}/${next.role || existing?.role || "member"} with ${accessMode} access.`, { parse_mode: "HTML" });
}

function deliveryMode(text) {
  const first = String(text || "").trim()[0];
  return first === "$" ? "$" : "!";
}

function normalizeIncomingText(text) {
  let value = String(text || "").trim();
  value = value.replace(/^@\w+\s+(?=[!$@/])/, "");
  value = value.replace(/\s+@\w+$/, "").trim();
  return value.replace(/^@(status|st|version|ohelp|oh|enlist|onboardme|onboard|on|approvechat|approve|officer|demote|ban|access|help|hel|he|h|map|g|galaxy|setgroup|setgalaxy|guild|research|researchplan|rp|buildplan|bp|claim|take|attack|attacks|scoutings|scouting|scouts|watched|watches|scout|sc|attacked|sos|report|rep|history|hist|occupied|occ|intel|as|ast|astr|astro|astros|sec|sector|sectors|region|regions|stale|score|bases|friend|fr|enemy|en|op|join|respond|ready|sent|leave|standdown|cancelop|board|defense|next|myops|incoming|targets|claimed|mine|me|wakeup)\b/i, "$$$1");
}

function explicitGalaxyFromText(text) {
  return explicitGalaxyScope(text);
}

// Read-only views can span every imported galaxy. Commands that write data
// always resolve a concrete galaxy before reaching this helper.
function queryOptionsForGalaxy(galaxy, options = {}) {
  return readOnlyGalaxyQueryOptions(galaxy, options);
}

function displayGalaxyScope(galaxy) {
  return normalizeGalaxy(galaxy) || "All Imported Galaxies";
}

function galaxyFromMapId(mapId) {
  return normalizeGalaxy(String(mapId || "").replace(/-main$/i, ""));
}

function stripLeadingGalaxyScope(query, galaxy) {
  const normalized = normalizeGalaxy(galaxy);
  if (!normalized) return String(query || "").trim();
  return String(query || "")
    .replace(new RegExp(`^\\s*${normalized}(?=\\s|$)\\s*`, "i"), "")
    .trim();
}

async function statusReport(ctx) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx).catch(() => "");
  const roomApproved = await chatApproved(ctx).catch(() => false);
  const hasAccess = await safeUserCanUseSensitiveCommands(ctx);
  const isOfficer = await safeUserCanUseOfficerCommands(ctx);
  let access = null;
  try {
    if (scopeId && ctx.from?.id) access = await fetchAccessMember(scopeId, telegramUserId(ctx));
  } catch (error) {
    console.error("status access lookup failed", error?.message || error);
  }
  const accessLabel = access?.status === "banned"
    ? "blocked"
    : hasAccess
      ? "active"
      : access?.status === "pending"
        ? "pending approval"
        : "not enlisted";
  const roomLabel = isPrivateChat(ctx) ? "Private DM" : chatTitle(ctx);
  const lines = [
    "<b>Lysander Status</b>",
    `Online: ${webhookUrl ? "webhook" : "polling"}`,
    `Build: <code>${escapeHtml(botBuild)}</code>`,
    "Server: Borealis",
    `Galaxy: ${escapeHtml(galaxy)}`,
    `Room: ${escapeHtml(roomLabel)}`,
    `Room access: ${roomApproved ? "approved" : "not approved"}`,
    `APP access: ${accessLabel}`,
    `Operation scope: ${scopeId ? "APP configured" : "not configured"}`
  ];
  if (isPrivateChat(ctx)) lines.push(`Private commands: ${hasAccess ? "ready" : "not ready"}`);
  if (isOfficer) {
    lines.push("", "<b>Officer Diagnostics</b>");
    lines.push(`Room ID: <code>${escapeHtml(ctx.chat?.id || "unknown")}</code>`);
    lines.push(`Scope ID: <code>${escapeHtml(scopeId || "none")}</code>`);
    lines.push(`Access record: ${access ? "found" : "missing"}`);
  }
  return lines.join("\n");
}

function versionReport() {
  return `VisionBot build ${botBuild}`;
}

function isCommand(lowerText, command) {
  const parsed = commandToken(lowerText);
  if (!parsed.name) return false;
  return matchingCommands(parsed.name).includes(command);
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
  return resolveCommandMatches(name, canonicalCommands, preferredCommandAliases);
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
    "research",
    "researchplan",
    "scout",
    "scouts",
    "watches",
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
    ...BATTLE_HISTORY_COMMANDS,
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
    "regions",
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
    "research",
    "researchplan",
    "scout",
    "scouts",
    "watches",
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
    ...BATTLE_HISTORY_COMMANDS,
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
    "regions",
    "mine",
    "me",
    "friend",
    "enemy",
    "save me",
    "setgroup",
    "setgalaxy",
    "guild",
    "stale",
    "score"
  ].some((command) => isCommand(lowerText, command) || isExactCommand(lowerText, command));
}

function closestCommand(command) {
  const cleanCommand = commandName(command);
  const commands = ["help", "ohelp", "onboardme", "approvechat", "approve", "officer", "demote", "ban", "access", "status", "map", "galaxy", "setgroup", "buildplan", "research", "researchplan", "attack", "attacks", "claim", "take", "sos", "report", "history", "occupied", "scout", "scouts", "watches", "intel", "astro", "astros", "sectors", "regions", "stale", "score", "bases", "board", "incoming", "targets", "claimed", "join", "ready", "sent", "leave", "mine", "me"];
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

function cachedApprovedScope(chatId) {
  const entry = approvedChatCache.get(String(chatId || ""));
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.scopeId;
}

function cacheApprovedScope(chatId, scopeId, ttlMs = 60 * 1000) {
  approvedChatCache.set(String(chatId || ""), {
    scopeId: String(scopeId || ""),
    expiresAt: Date.now() + ttlMs
  });
}

async function fetchApprovedChat(chatId) {
  if (!chatId) return null;
  return fetchOne("b24_approved_chats", {
    guild_id: primaryGuildId,
    chat_id: String(chatId),
    status: "active"
  }, null, false);
}

async function primaryApprovedScope() {
  if (configuredGuildScopeChatId) return configuredGuildScopeChatId;
  if (primaryScopeCache.expiresAt > Date.now()) return primaryScopeCache.value;

  const rows = await fetchRows("b24_approved_chats", {
    guild_id: `eq.${primaryGuildId}`,
    status: "eq.active"
  }, {
    includeMap: false,
    order: "is_primary.desc,approved_at.asc",
    limit: 1
  });
  const scopeId = String(rows[0]?.scope_chat_id || "");
  primaryScopeCache = { value: scopeId, expiresAt: Date.now() + 60 * 1000 };
  return scopeId;
}

async function resolveGuildScopeForChat(chatId) {
  const id = String(chatId || "");
  if (!id) return "";
  const cached = cachedApprovedScope(id);
  if (cached !== null) return cached;

  const approved = await fetchApprovedChat(id);
  if (approved?.scope_chat_id) {
    cacheApprovedScope(id, approved.scope_chat_id);
    return String(approved.scope_chat_id);
  }

  if (approvedChatIds.includes(id)) {
    const legacyScope = configuredGuildScopeChatId || id;
    cacheApprovedScope(id, legacyScope);
    return legacyScope;
  }

  // Preserve unrestricted local/dev installs until access control is enabled.
  if (!requireAccessControl && !approvedChatIds.length && !configuredGuildScopeChatId) {
    cacheApprovedScope(id, id);
    return id;
  }

  cacheApprovedScope(id, "", 30 * 1000);
  return "";
}

async function isRecognizedGuildScope(scopeId) {
  const id = String(scopeId || "");
  if (!id) return false;
  if (id === configuredGuildScopeChatId || approvedChatIds.includes(id)) return true;
  const rows = await fetchRows("b24_approved_chats", {
    guild_id: `eq.${primaryGuildId}`,
    scope_chat_id: `eq.${id}`,
    status: "eq.active"
  }, { includeMap: false, select: "scope_chat_id", limit: 1 });
  return rows.length > 0;
}

async function chatApproved(ctx) {
  if (ctx.chat?.type === "private") return true;
  const id = ctx.chat?.id ? String(ctx.chat.id) : "";
  return Boolean(await resolveGuildScopeForChat(id));
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
  return [
    "This room is not approved for APP operations.",
    "An APP officer can approve it here with <code>$approvechat</code>."
  ].filter(Boolean).join("\n");
}

async function userCanUseSensitiveCommands(ctx) {
  if (!ctx.from?.id) return false;
  const userId = telegramUserId(ctx);
  if (officerUserIds.includes(userId)) return true;

  const scopeId = await operationScopeId(ctx);
  let access = null;
  if (scopeId) {
    access = await fetchAccessMember(scopeId, userId);
    if (access?.status === "banned") return false;
  }

  const activeAccess = access?.status === "active" &&
    ["member", "officer", "owner"].includes(access.role);

  // Private access is an explicit officer-granted exception for members who
  // must use Lysander without remaining visible in an APP Telegram room.
  if (activeAccess && access.access_mode === "private" && isPrivateChat(ctx)) return true;

  if (accessChatIds.length) {
    const accessGroupMember = await isMemberOfAnyAccessChat(ctx, userId);
    // Both checks matter: access-group membership is the revocation switch,
    // while the database row proves the user enlisted and was approved.
    return accessGroupMember && activeAccess;
  }

  if (activeAccess) return true;

  if (!requireAccessControl && !approvedChatIds.length && !configuredGuildScopeChatId) return true;
  return false;
}

async function userCanUseOfficerCommands(ctx) {
  if (!ctx.from?.id) return false;
  const userId = telegramUserId(ctx);
  if (officerUserIds.includes(userId)) return true;
  const scopeId = await operationScopeId(ctx);
  if (scopeId) {
    const access = await fetchAccessMember(scopeId, userId);
    if (access?.status === "banned") return false;
    const activeOfficer = access?.status === "active" && ["officer", "owner"].includes(access.role);
    if (activeOfficer && access.access_mode === "private" && isPrivateChat(ctx)) return true;
    if (activeOfficer && accessChatIds.length) return isMemberOfAnyAccessChat(ctx, userId);
    if (activeOfficer) return true;
  }
  // Telegram room administration does not grant Lysander officer access.
  // It is only accepted by userCanApproveChats() for the initial trusted-room
  // bootstrap; normal officer actions require an active database role.
  return false;
}

async function userCanApproveChats(ctx) {
  if (!ctx.from?.id || isPrivateChat(ctx)) return false;
  const userId = telegramUserId(ctx);
  if (officerUserIds.includes(userId)) return true;

  const currentChatId = String(ctx.chat?.id || "");
  const isConfiguredBootstrapRoom = currentChatId === configuredGuildScopeChatId ||
    approvedChatIds.includes(currentChatId);

  // A Telegram admin may bootstrap a room already trusted in Render. This
  // avoids locking the owner out before the first database officer exists.
  if (isConfiguredBootstrapRoom) {
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
      if (member?.status === "creator" || member?.status === "administrator") return true;
    } catch {}
  }

  const scopeId = await primaryApprovedScope();
  if (scopeId) {
    const access = await fetchAccessMember(scopeId, userId);
    return access?.status === "active" && ["officer", "owner"].includes(access.role);
  }

  // Bootstrap only: the first approved room may be created by its Telegram admin.
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

async function safeUserCanUseSensitiveCommands(ctx) {
  try {
    return await userCanUseSensitiveCommands(ctx);
  } catch (error) {
    console.error("member permission lookup failed", error?.message || error);
    return false;
  }
}

async function fetchAccessMember(chatId, userId) {
  if (!chatId || !userId) return null;
  return fetchOne("b24_access_members", { chat_id: chatId, user_id: userId }, null, false);
}

async function upsertAccessMember({ chatId, userId, username, displayName, role, status, accessMode = "group", approvedBy = "", approvedAt = null }) {
  const now = new Date().toISOString();
  return upsertRow("b24_access_members", {
    chat_id: String(chatId),
    user_id: String(userId),
    username: String(username || "").replace(/^@/, ""),
    display_name: String(displayName || userId),
    role,
    status,
    access_mode: accessMode === "private" ? "private" : "group",
    approved_by: approvedBy || null,
    approved_at: approvedAt,
    last_seen_at: now,
    updated_at: now
  }, "chat_id,user_id");
}

async function notifyAccessOfficers(scopeId, message) {
  try {
    const rows = await fetchRows("b24_access_members", { chat_id: `eq.${scopeId}` }, {
      includeMap: false,
      select: "user_id,role,status"
    });
    const recipientIds = officerNotificationRecipientIds(rows, officerUserIds);
    const results = await Promise.allSettled(recipientIds.map((userId) => bot.telegram.sendMessage(userId, message)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`Officer access notification failed for ${recipientIds[index]}`, result.reason?.message || result.reason);
      }
    });
    return results.filter((result) => result.status === "fulfilled").length;
  } catch (error) {
    console.error("Officer access notification lookup failed", error?.message || error);
    return 0;
  }
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
    `Access mode: ${escapeHtml(row.access_mode || "group")}`,
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

function cacheAccessMember(chatId, userId, allowed, ttlMs = 60 * 1000) {
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
  if (!(await chatApproved(ctx))) {
    await ctx.answerCbQuery("This chat is not approved.");
    return false;
  }
  const currentScopeId = await operationScopeId(ctx);
  if (currentScopeId && String(operation.chat_id || "") !== String(currentScopeId)) {
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

async function handleResearchDoctrine(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "I need a Telegram user to save a research doctrine.");
  const body = commandBody(text).replace(/^doctrine\b/i, "").trim();
  if (!body) {
    const selected = await selectedResearchDoctrine(ctx);
    const fleet = selected.doctrine === "fleet" && selected.fleet ? ` / ${fleetResearchPlans[selected.fleet]?.label || selected.fleet}` : "";
    return respond(ctx, mode, [
      "<b>RESEARCH DOCTRINE</b>",
      "",
      `Current: <b>${escapeHtml(researchDoctrinePlans[selected.doctrine].label)}${escapeHtml(fleet)}</b>`,
      "",
      "Change it with:",
      "<code>!research doctrine growth</code>",
      "<code>!research doctrine economy</code>",
      "<code>!research doctrine production</code>",
      "<code>!research doctrine science</code>",
      "<code>!research doctrine defense</code>",
      "<code>!research doctrine mobility</code>",
      "<code>!research doctrine fleet battleship</code>",
      "<code>!research doctrine balanced</code>"
    ].join("\n"), { parse_mode: "HTML" });
  }

  const doctrine = findResearchDoctrine(body);
  if (!doctrine) return respond(ctx, mode, "Unknown doctrine. Use !researchplan 8 to see the available branches.");
  const fleet = doctrine === "fleet" ? findFleetResearchPlan(body) : "";
  if (doctrine === "fleet" && !fleet) {
    return respond(ctx, mode, formatFleetResearchMenu(), { parse_mode: "HTML" });
  }

  const saved = await upsertRow("b24_user_settings", {
    user_id: telegramUserId(ctx),
    research_doctrine: doctrine,
    research_fleet: fleet || null,
    research_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, "user_id");
  if (!saved) {
    return respond(ctx, mode, "I could not save that doctrine. Run supabase-research-doctrine.sql, then try again.");
  }
  const plan = researchDoctrinePlans[doctrine];
  const fleetLabel = fleet ? ` / ${fleetResearchPlans[fleet].label}` : "";
  return respond(ctx, mode, [
    "<b>RESEARCH DOCTRINE SAVED</b>",
    "",
    `Doctrine: <b>${escapeHtml(plan.label)}${escapeHtml(fleetLabel)}</b>`,
    "",
    "Next priority:",
    escapeHtml(fleet ? fleetResearchPlans[fleet].minimum : plan.priorities[0]),
    "",
    "Numbered plans from Base 9 onward now use this doctrine.",
    "Change it anytime with <code>!research doctrine [branch]</code>."
  ].join("\n"), { parse_mode: "HTML" });
}

async function handleResearchPlan(ctx, text, mode) {
  const body = commandBody(text);
  const stage = Number((body.match(/\b(?:[1-9]|1[0-6])\b/) || [])[0] || 0);
  const detailed = /\bdetail(?:ed)?\b/i.test(body);
  const creditsMatch = body.match(/\bcredits?\s+([\d,]+)/i);
  const currentCredits = creditsMatch ? Number(creditsMatch[1].replace(/,/g, "")) : null;
  const requestedDoctrine = findResearchDoctrine(body);

  if (!stage && requestedDoctrine) {
    if (requestedDoctrine === "fleet") {
      const fleet = findFleetResearchPlan(body);
      return respond(ctx, mode, fleet ? formatFleetResearchPlan(fleet) : formatFleetResearchMenu(), { parse_mode: "HTML" });
    }
    return respond(ctx, mode, formatResearchDoctrine(requestedDoctrine), { parse_mode: "HTML" });
  }

  if (!stage) {
    return respond(ctx, mode, [
      "<b>Expansion Research Doctrine</b>",
      "",
      "Bases 1-7: lean expansion targets and protected reserves.",
      "Base 8: choose a post-opening doctrine.",
      "Bases 9-16: follow your saved doctrine.",
      "",
      "Examples:",
      "<code>!researchplan 5 detail</code>",
      "<code>!researchplan 5 credits 730</code>",
      "<code>!researchplan 8</code>",
      "<code>!researchplan economy</code>",
      "<code>!researchplan fleet battleship</code>",
      "<code>!research doctrine balanced</code>"
    ].join("\n"), { parse_mode: "HTML" });
  }

  if (stage === 8) return respond(ctx, mode, formatResearchBranchPoint(), { parse_mode: "HTML" });

  if (stage >= 9) {
    const selected = requestedDoctrine
      ? { doctrine: requestedDoctrine, fleet: requestedDoctrine === "fleet" ? findFleetResearchPlan(body) : "" }
      : await selectedResearchDoctrine(ctx);
    return respond(ctx, mode, formatDoctrineResearchStage(stage, selected.doctrine, selected.fleet), { parse_mode: "HTML" });
  }

  const output = Number.isFinite(currentCredits)
    ? formatResearchReserveCheck(stage, currentCredits)
    : detailed
      ? formatResearchPlanDetail(stage)
      : formatResearchPlan(stage);
  return respond(ctx, mode, output, { parse_mode: "HTML" });
}

async function selectedResearchDoctrine(ctx) {
  const settings = ctx.from?.id
    ? await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false)
    : null;
  const doctrine = researchDoctrinePlans[settings?.research_doctrine] ? settings.research_doctrine : "growth";
  const fleet = fleetResearchPlans[settings?.research_fleet] ? settings.research_fleet : "";
  return { doctrine, fleet };
}

function findResearchDoctrine(value) {
  const text = String(value || "").toLowerCase();
  return Object.keys(researchDoctrinePlans).find((name) => new RegExp(`\\b${name}\\b`, "i").test(text)) || "";
}

function findFleetResearchPlan(value) {
  const compact = String(value || "").toLowerCase().replace(/[^a-z]/g, "");
  return Object.keys(fleetResearchPlans).find((name) => compact.includes(name)) || "";
}

function formatResearchBranchPoint() {
  return [
    "<b>8-BASE RESEARCH BRANCH</b>",
    "",
    "Rapid-expansion opening complete.",
    "",
    "Current minimum baseline:",
    "<code>C10 / E8 / L8 / SD4 / WD1</code>",
    "",
    "Choose what this empire is becoming:",
    "<code>!researchplan growth</code> - continue the base guide",
    "<code>!researchplan economy</code> - income and area",
    "<code>!researchplan production</code> - construction and shipyards",
    "<code>!researchplan science</code> - research output and links",
    "<code>!researchplan defense</code> - shielded base defenses",
    "<code>!researchplan mobility</code> - speed, stealth, and gates",
    "<code>!researchplan fleet</code> - unit specialization",
    "<code>!researchplan balanced</code> - growth with practical defenses",
    "",
    "Save a choice: <code>!research doctrine growth</code>",
    "Growth is used by default until you choose."
  ].join("\n");
}

function formatResearchDoctrine(doctrine) {
  const plan = researchDoctrinePlans[doctrine];
  const lines = [
    `<b>${escapeHtml(plan.label.toUpperCase())} DOCTRINE</b>`,
    "",
    "<b>Goal</b>",
    escapeHtml(plan.goal),
    "",
    "<b>Priority</b>",
    ...plan.priorities.map((item, index) => `${index + 1}. ${escapeHtml(item)}`)
  ];
  if (plan.unlocks.length) lines.push("", "<b>Unlocks and milestones</b>", ...plan.unlocks.map((item) => `- ${escapeHtml(item)}`));
  lines.push("", "<b>Tradeoff</b>", escapeHtml(plan.tradeoff), "", `Save: <code>!research doctrine ${doctrine}</code>`);
  return lines.join("\n");
}

function formatFleetResearchMenu() {
  return [
    "<b>FLEET DOCTRINE</b>",
    "",
    "Choose one specialization:",
    "<code>!researchplan fleet corvette</code>",
    "<code>!researchplan fleet carrier</code>",
    "<code>!researchplan fleet heavycruiser</code>",
    "<code>!researchplan fleet battleship</code>",
    "<code>!researchplan fleet dreadnought</code>",
    "<code>!researchplan fleet titan</code>",
    "<code>!researchplan fleet leviathan</code>",
    "",
    "Save one with <code>!research doctrine fleet battleship</code>."
  ].join("\n");
}

function formatFleetResearchPlan(fleet) {
  const plan = fleetResearchPlans[fleet];
  const lines = [
    `<b>${escapeHtml(plan.label.toUpperCase())} DOCTRINE</b>`,
    "",
    "<b>Minimum unlock</b>",
    `<code>${escapeHtml(plan.minimum)}</code>`,
    "",
    "<b>Research emphasis after unlock</b>",
    ...plan.emphasis.map((item, index) => `${index + 1}. ${escapeHtml(item)}`),
    "",
    "Reach the minimum without researching unrelated capital-ship technologies.",
    "The unlock does not guarantee this unit is currently the best economic choice."
  ];
  if (plan.note) lines.push("", `<i>${escapeHtml(plan.note)}</i>`);
  lines.push("", `Save: <code>!research doctrine fleet ${fleet}</code>`);
  return lines.join("\n");
}

function formatDoctrineResearchStage(stage, doctrine, fleet = "") {
  const validDoctrine = researchDoctrinePlans[doctrine] ? doctrine : "growth";
  if (validDoctrine === "growth") {
    return [
      `<b>${stage} BASES - GROWTH</b>`,
      "",
      escapeHtml(growthResearchStages.get(stage)),
      "",
      "Full path: <code>!researchplan growth</code>",
      "Change doctrine: <code>!research doctrine [branch]</code>"
    ].join("\n");
  }
  if (validDoctrine === "fleet") {
    if (!fleet || !fleetResearchPlans[fleet]) {
      return [
        `<b>${stage} BASES - FLEET</b>`,
        "",
        "No fleet specialization is saved yet.",
        "",
        formatFleetResearchMenu()
      ].join("\n");
    }
    return [`<b>${stage} BASES - ${escapeHtml(fleetResearchPlans[fleet].label.toUpperCase())}</b>`, "", formatFleetResearchPlan(fleet)].join("\n");
  }
  const plan = researchDoctrinePlans[validDoctrine];
  return [
    `<b>${stage} BASES - ${escapeHtml(plan.label.toUpperCase())}</b>`,
    "",
    escapeHtml(plan.goal),
    "",
    "Continue the saved branch priorities:",
    ...plan.priorities.map((item, index) => `${index + 1}. ${escapeHtml(item)}`),
    "",
    stage === 16 ? "Base-guide horizon reached. Continue this specialization or deliberately adopt a hybrid." : "Protect the next expansion reserve before optional research.",
    "",
    `Full path: <code>!researchplan ${validDoctrine}</code>`,
    "Change doctrine: <code>!research doctrine [branch]</code>"
  ].join("\n");
}

function formatResearchPlan(stage) {
  const plan = researchPlans.get(stage);
  const lines = [
    `<b>${stage} ${stage === 1 ? "BASE" : "BASES"}: EXPANSION RESEARCH</b>`,
    "",
    `<code>${escapeHtml(plan.target)}</code>`,
    "",
    escapeHtml(plan.guidance)
  ];
  if (plan.reserve) {
    lines.push("", `Protected reserve: <b>${plan.reserve.toLocaleString("en-US")} credits</b>`);
  }
  if (plan.next) {
    lines.push("", "When complete:", `-&gt; Establish Base #${plan.next}`);
  }
  lines.push("", `Detail: <code>!researchplan ${stage} detail</code>`);
  return lines.join("\n");
}

function formatResearchPlanDetail(stage) {
  const plan = researchPlans.get(stage);
  const lines = [
    `<b>${stage}-BASE EXPANSION RESEARCH</b>`,
    "",
    "<b>Required target</b>",
    ...expandResearchTarget(plan.target).map((item) => escapeHtml(item))
  ];
  if (plan.unlocks?.length) {
    lines.push("", "<b>Unlocks</b>", ...plan.unlocks.map((item) => `- ${escapeHtml(item)}`));
  }
  if (plan.reserve) {
    lines.push("", "<b>Colonization reserve</b>", `${plan.reserve.toLocaleString("en-US")} credits protected`);
  }
  lines.push("", "<b>Priority</b>", ...plan.priorities.map((item, index) => `${index + 1}. ${escapeHtml(item)}`));
  lines.push(
    "",
    `<i>${escapeHtml(plan.guidance)}</i>`,
    "",
    "<b>Abbreviations</b>",
    "C Computer | E Energy | L Laser",
    "SD Stellar Drive | WD Warp Drive",
    "RL Research Labs | SY Shipyards",
    "",
    "Lysander does not currently receive your live credits or technology levels, so this is doctrine guidance rather than a live affordability check."
  );
  return lines.join("\n");
}

function formatResearchReserveCheck(stage, currentCredits) {
  const plan = researchPlans.get(stage);
  if (!plan.reserve || !plan.next) {
    return [
      "<b>EXPANSION SPRINT COMPLETE</b>",
      "",
      "Base #8 has no next-base reserve in this doctrine.",
      `Current credits: <b>${currentCredits.toLocaleString("en-US")}</b>`,
      "Choose the next economy, defense, fleet, or advanced-expansion doctrine."
    ].join("\n");
  }
  const difference = currentCredits - plan.reserve;
  if (difference < 0) {
    return [
      "<b>RESEARCH HOLD</b>",
      "",
      "Your next base is the current priority.",
      "",
      `Required Base #${plan.next} reserve: <b>${plan.reserve.toLocaleString("en-US")}</b>`,
      `Current credits: <b>${currentCredits.toLocaleString("en-US")}</b>`,
      `Shortfall: <b>${Math.abs(difference).toLocaleString("en-US")}</b>`,
      "",
      "Recommendation:",
      "Pause optional research and continue saving for the next base."
    ].join("\n");
  }
  return [
    "<b>RESEARCH AVAILABLE</b>",
    "",
    `Base #${plan.next} reserve protected: <b>${plan.reserve.toLocaleString("en-US")}</b>`,
    `Surplus credits: <b>${difference.toLocaleString("en-US")}</b>`,
    "",
    "Doctrine target:",
    `<code>${escapeHtml(plan.target)}</code>`,
    "",
    escapeHtml(plan.guidance)
  ].join("\n");
}

function expandResearchTarget(target) {
  const names = {
    C: "Computer",
    E: "Energy",
    L: "Laser",
    SD: "Stellar Drive",
    WD: "Warp Drive"
  };
  return String(target || "")
    .split(/\s*(?:\/|->)\s*/)
    .map((token) => token.match(/^(SD|WD|C|E|L)(\d+)$/i))
    .filter(Boolean)
    .map((match) => `${names[match[1].toUpperCase()]} ${match[2]}`);
}

async function handleUserGalaxy(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !galaxy in a group or private chat so I know who to save.");
  const galaxy = explicitGalaxyFromText(text);
  if (!galaxy) return respond(ctx, mode, "Use: !galaxy B23\nShort form: !g B23");

  const saved = await upsertRow("b24_user_settings", personalGalaxySettings(telegramUserId(ctx), galaxy), "user_id");

  if (!saved) return respond(ctx, mode, "Could not save your galaxy setting.");
  return respond(ctx, mode, `Your default galaxy is now ${galaxy}.`);
}

async function handleChatGalaxy(ctx, text, mode) {
  if (!ctx.chat?.id) return;
  if (isPrivateChat(ctx)) return respond(ctx, mode, "Use !galaxy B23 in DM to set your personal galaxy.");
  const galaxy = explicitGalaxyFromText(text);
  if (!galaxy) return respond(ctx, mode, "Use: $setgroup B23");
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, notApprovedMessage(ctx), { parse_mode: "HTML" });

  const saved = await upsertRow("b24_chat_settings", {
    chat_id: String(ctx.chat.id),
    galaxy,
    map_id: galaxyToMapId(galaxy),
    updated_at: new Date().toISOString()
  }, "chat_id");

  if (!saved) return respond(ctx, mode, "Could not save this chat's galaxy setting.");
  return respond(ctx, mode, `This Telegram room now uses ${galaxy}. APP operations remain shared, while each galaxy's data stays separate.`);
}

async function handleApproveChat(ctx, text, mode) {
  if (isPrivateChat(ctx) || !ctx.chat?.id) {
    return respond(ctx, mode, "Use <code>$approvechat</code> inside the Telegram room you want Lysander to approve.", { parse_mode: "HTML" });
  }
  if (!(await userCanApproveChats(ctx))) {
    return respond(ctx, mode, "Only an active APP officer/owner can approve Telegram rooms.");
  }

  const action = commandBody(text).toLowerCase() || "approve";
  const chatId = String(ctx.chat.id);
  if (action === "status") {
    const approved = await fetchApprovedChat(chatId);
    const scopeId = await resolveGuildScopeForChat(chatId);
    return respond(ctx, mode, [
      "<b>APP Room Access</b>",
      `Room: ${escapeHtml(chatTitle(ctx))}`,
      `Status: ${scopeId ? "approved" : "not approved"}`,
      scopeId ? `Shared APP scope: <code>${escapeHtml(scopeId)}</code>` : "",
      approved?.approved_by ? `Approved by: <code>${escapeHtml(approved.approved_by)}</code>` : ""
    ].filter(Boolean).join("\n"), { parse_mode: "HTML" });
  }
  if (action !== "approve") {
    return respond(ctx, mode, "Use <code>$approvechat</code> or <code>$approvechat status</code>.", { parse_mode: "HTML" });
  }

  const existing = await fetchApprovedChat(chatId);
  const scopeId = String(existing?.scope_chat_id || await primaryApprovedScope() || configuredGuildScopeChatId || chatId);
  const saved = await upsertRow("b24_approved_chats", {
    guild_id: primaryGuildId,
    chat_id: chatId,
    scope_chat_id: scopeId,
    chat_title: chatTitle(ctx),
    status: "active",
    is_primary: chatId === scopeId,
    approved_by: telegramUserId(ctx),
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, "guild_id,chat_id");
  if (!saved) {
    return respond(ctx, mode, "Could not approve this room. Run the latest Supabase review-fixes SQL first.");
  }

  approvedChatCache.delete(chatId);
  primaryScopeCache = { value: scopeId, expiresAt: Date.now() + 60 * 1000 };
  await rememberActiveChat(ctx);
  return respond(ctx, mode, [
    `<b>${escapeHtml(chatTitle(ctx))} approved</b>`,
    `Guild: ${escapeHtml(primaryGuildId)}`,
    `Shared operation scope: <code>${escapeHtml(scopeId)}</code>`,
    "Members with active APP access can now use Lysander here."
  ].join("\n"), { parse_mode: "HTML" });
}

async function handleGuild(ctx, text, mode) {
  const action = String(text || "").trim().split(/\s+/)[1]?.toLowerCase() || "status";
  if (action === "bind") {
    return handleApproveChat(ctx, "$approvechat", mode);
  }
  if (action !== "status") {
    return respond(ctx, mode, [
      "<b>APP Membership</b>",
      "Everyone approved by Lysander is an APP member.",
      "<code>!guild status</code> - show the shared APP operation scope",
      "<code>$approvechat</code> - approve the current room (officer)",
      "",
      `<code>${escapeHtml(action)}</code> was not applied. You do not need to select APP manually.`
    ].join("\n"), { parse_mode: "HTML" });
  }

  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. An officer can run <code>$approvechat</code> in the room.", { parse_mode: "HTML" });
  return respond(ctx, mode, [
    `<b>Guild: ${escapeHtml(primaryGuildId)}</b>`,
    `Shared operation scope: <code>${escapeHtml(scopeId)}</code>`,
    `Current room: ${escapeHtml(isPrivateChat(ctx) ? await operationScopeLabel(ctx, scopeId) : chatTitle(ctx))}`
  ].join("\n"), { parse_mode: "HTML" });
}

async function helpStatus(ctx) {
  const galaxy = await galaxyForContext(ctx);
  const chatLabel = !isPrivateChat(ctx) ? chatTitle(ctx) : "";
  const settings = ctx.from?.id ? await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false) : null;
  const activeLabel = chatLabel || settings?.active_chat_label || "";
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) {
    return [
      "<b>No approved APP room selected.</b>",
      "Ask an officer to use <code>$approvechat</code> in the APP room, then use <code>!enlist</code>.",
      `Galaxy: ${escapeHtml(galaxy)}`,
      "Your role: Member"
    ].join("\n");
  }
  return [
    `Active guild: ${escapeHtml(primaryGuildId)}`,
    `Operation room: ${escapeHtml(activeLabel || scopeId)}`,
    `Galaxy: ${escapeHtml(galaxy)}`,
    "Your role: Member"
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
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
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
  const workingGalaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
  const rawQuery = commandBody(text);
  const queryGalaxy = explicitGalaxyFromText(rawQuery);
  const pageInfo = parsePageFromQuery(stripLeadingGalaxyScope(rawQuery, queryGalaxy));
  const body = pageInfo.query.trim();
  const shortId = normalizeShortId(body.match(/^([A-Z]-?[A-Z0-9]{3,8})$/i)?.[1] || "");
  if (shortId) return handleAttackPool(ctx, shortId, mode, pageInfo.page);
  const attackNumber = parseAttackNumber(body);
  if (attackNumber) {
    const operation = await findAttackByNumber(queryGalaxy || workingGalaxy, scopeId, attackNumber);
    if (!operation) return respond(ctx, mode, `No active attack #${attackNumber} found.`);
    return handleAttackPool(ctx, operation.short_id, mode, pageInfo.page);
  }
  if (/^clear$/i.test(body)) {
    return respond(ctx, mode, "Use <code>$standdown A-12345 reason</code> to close one attack plan. <code>$attacks</code> only lists plans.", { parse_mode: "HTML" });
  }

  const attacks = await fetchActiveOperations(queryGalaxy, scopeId, "attack");
  const claimsByOperation = await fetchClaimsByOperation(attacks);
  const lines = [`<b>${displayGalaxyScope(queryGalaxy)} Attack Plans</b>`];
  if (!attacks.length) {
    lines.push("No active attack plans.");
    lines.push("", "Create one: <code>!attack 02:00 clowntown 4</code>");
    const operations = await fetchActiveOperations(queryGalaxy, scopeId);
    const canQuickCreate = !operations.length && await safeUserCanUseOfficerCommands(ctx);
    return respond(ctx, mode, lines.join("\n"), {
      parse_mode: "HTML",
      ...(queryGalaxy ? quickSetupKeyboard(queryGalaxy, "", canQuickCreate) : {})
    });
  }

  lines.push(...attacks.map((operation, index) => {
    const claims = claimsByOperation.get(operation.operation_id) || [];
    const targets = groupAttackTargets(operation, claims);
    const claimedWaves = targets.reduce((sum, target) => sum + target.claimedWaves, 0);
    const totalWaves = targets.reduce((sum, target) => sum + target.totalWaves, 0);
    const prefix = queryGalaxy ? "" : `${galaxyFromMapId(operation.map_id)} `;
    return `${index + 1} - ${prefix}${escapeHtml(formatAttackListDate(operation.arrival_at))} ${escapeHtml(attackDisplayName(operation))} ${escapeHtml(formatClockLabel(new Date(operation.arrival_at)))} - ${claimedWaves}/${totalWaves || 0}`;
  }));
  if (queryGalaxy) lines.push("", "Add targets: <code>!attack add 1 24324510, 24351330, paste, paste</code>");
  lines.push(queryGalaxy ? "Open a pool: <code>!attacks 1</code>" : "Use an Open button, or <code>!attacks B24</code> to work with numbered plans.");
  lines.push("Show board: <code>$board attack</code>");
  return respond(ctx, mode, lines.join("\n"), {
    parse_mode: "HTML",
    ...attackListKeyboard(attacks)
  });
}

async function handleNamedAttackPlan(ctx, plan, mode) {
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
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
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");

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
    await ctx.answerCbQuery("No approved APP room is active.");
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
    await ctx.answerCbQuery("No approved APP room is active.");
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
    `Open: <code>$scouts</code>`,
    `When intel is ready, create an attack from this same target pool.`
  ].join("\n"), { parse_mode: "HTML" });
}

async function handleRegionAgendaButton(ctx) {
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    await ctx.answerCbQuery("Officer access required.");
    return;
  }
  const [, galaxyText, encodedTag] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) {
    await ctx.answerCbQuery("No approved APP room is active.");
    return;
  }
  const coverage = await regionCoverage(galaxy, scopeId);
  const targets = regionsWithoutCoverage(galaxy, coverage);
  if (!targets.length) {
    await ctx.answerCbQuery("Every region is covered.");
    return;
  }
  const arrivalAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  const agendaKey = newScoutAgendaKey();
  const agendaName = `${galaxy} Region Coverage`;
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
  await ctx.answerCbQuery(`Created ${created} region watches`);
  return ctx.reply([
    `<b>${escapeHtml(agendaName)} created</b>`,
    `${created}/${targets.length} uncovered regions are active until cancelled.`,
    "Members can take responsibility for each region with <code>$scouts</code>."
  ].join("\n"), { parse_mode: "HTML" });
}

async function handleScoutings(ctx, text, mode) {
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
  const queryGalaxy = explicitGalaxyFromText(commandBody(text));
  const scopeLabel = displayGalaxyScope(queryGalaxy);
  const agendas = groupScoutAgendas(await fetchScoutAgendas(queryGalaxy, scopeId));
  if (!agendas.length) {
    return respond(ctx, mode, [
      `<b>${scopeLabel} Scouting Agendas</b>`,
      "No persistent scouting agendas.",
      "Start from a base list: <code>$bases [tag or player]</code>"
    ].join("\n"), { parse_mode: "HTML" });
  }

  const lines = [`<b>${scopeLabel} Scouting Agendas</b>`];
  agendas.forEach((agenda, index) => {
    const prefix = queryGalaxy ? "" : `${galaxyFromMapId(agenda.operations[0]?.map_id)} `;
    lines.push(`${index + 1}. ${prefix}${escapeHtml(agenda.name)} - ${agenda.operations.length} ${scoutAgendaTargetKind(agenda)} watches - active until cancelled`);
  });
  if (!queryGalaxy) lines.push("", "Use <code>$scouts B24</code> to open a map-specific agenda.");
  return respond(ctx, mode, lines.join("\n"), {
    parse_mode: "HTML",
    ...(queryGalaxy ? scoutAgendaListKeyboard(queryGalaxy, agendas) : {})
  });
}

async function handleWatches(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !watches from your Telegram account so I know whose assignments to find.");
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
  const queryGalaxy = explicitGalaxyFromText(commandBody(text));
  const scopeLabel = displayGalaxyScope(queryGalaxy);
  const agendas = groupScoutAgendas(await fetchScoutAgendas(queryGalaxy, scopeId));
  const userId = telegramUserId(ctx);
  const watches = [];
  for (const agenda of agendas) {
    const assignments = await scoutAgendaAssignments(agenda);
    agenda.operations.forEach((operation) => {
      const assignment = assignments.get(operation.operation_id);
      if (assignment?.user_id === userId) watches.push({ agenda, coord: operation.target_coord });
    });
  }
  if (!watches.length) {
    return respond(ctx, mode, `<b>${escapeHtml(scopeLabel)} My Watches</b>\nNo active watch assignments. Open <code>$scouts</code> to take one.`, { parse_mode: "HTML" });
  }
  const regionWatches = watches.filter((watch) => /^B\d{2}:\d{1,2}$/.test(String(watch.coord || "")));
  const baseWatches = watches.filter((watch) => !regionWatches.includes(watch));
  const formatWatch = (watch, index) => `${String(index + 1).padStart(2, "0")} ${escapeHtml(watch.coord)} - ${escapeHtml(watch.agenda.name)}`;
  const lines = [
    `<b>${escapeHtml(scopeLabel)} My Watches</b>`,
    `${watches.length} active watch assignment${watches.length === 1 ? "" : "s"}.`,
  ];
  if (regionWatches.length) {
    lines.push("", `<b>Region Coverage (${regionWatches.length})</b>`, ...regionWatches.map(formatWatch));
  }
  if (baseWatches.length) {
    lines.push("", `<b>Base Watches (${baseWatches.length})</b>`, ...baseWatches.map(formatWatch));
  }
  lines.push("", "Use <code>$scouts</code> to open an agenda or release a watch.");
  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
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

async function handleScoutRegionMapButton(ctx) {
  if (!(await userCanUseSensitiveCommands(ctx))) {
    await ctx.answerCbQuery("You do not have permission for scouting agendas.");
    return;
  }
  const [, galaxyText, agendaKey] = ctx.match || [];
  const galaxy = normalizeGalaxy(galaxyText) || await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  const agenda = scopeId ? await findScoutAgenda(galaxy, scopeId, agendaKey) : null;
  if (!agenda || scoutAgendaTargetKind(agenda) !== "region") {
    await ctx.answerCbQuery("Region watch agenda not found.");
    return;
  }
  const assignments = await scoutAgendaAssignments(agenda);
  const coverage = await regionCoverage(galaxy, scopeId);
  await ctx.answerCbQuery("Region watch grid");
  return ctx.reply(formatScoutRegionMap(galaxy, agenda, assignments, coverage), {
    parse_mode: "HTML",
    ...scoutRegionMapKeyboard(galaxy, agenda, assignments, coverage)
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
  if (scoutAgendaTargetKind(agenda) !== "base") {
    await ctx.answerCbQuery("Region watches cannot become an attack pool.");
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
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
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

async function handleTargets(ctx, text, mode) {
  return handleClaimed(ctx, text, mode);
}

async function handleClaimed(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !claimed in a group or private chat so I know who to look up.");
  const queryGalaxy = explicitGalaxyFromText(commandBody(text));
  const scopeLabel = displayGalaxyScope(queryGalaxy);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
  const userId = telegramUserId(ctx);
  const now = new Date().toISOString();
  const [claims, memberships, coveredIncoming] = await Promise.all([
    fetchRows("b24_claims", {
      claimed_by_user_id: `eq.${userId}`,
      status: "eq.active",
      chat_id: `eq.${scopeId}`,
      arrival_at: `gt.${now}`
    }, queryOptionsForGalaxy(queryGalaxy, { order: "arrival_at.asc" })),
    fetchRows("b24_operation_members", {
      user_id: `eq.${userId}`
    }, queryOptionsForGalaxy(queryGalaxy, { order: "updated_at.asc" })),
    fetchRows("b24_incoming", {
      covered_by_user_id: `eq.${userId}`,
      status: "eq.active",
      chat_id: `eq.${scopeId}`,
      arrival_at: `gt.${now}`
    }, queryOptionsForGalaxy(queryGalaxy, { order: "arrival_at.asc" }))
  ]);

  const activeMemberships = memberships.filter((member) => member.state !== "withdrawn");
  const operations = (await fetchOperationsForMemberships(queryGalaxy, activeMemberships))
    .filter((operation) => operation.chat_id === scopeId);
  const memberByOperation = new Map(activeMemberships.map((member) => [member.operation_id, member]));
  const claimedOperationIds = new Set(claims.map((claim) => claim.operation_id).filter(Boolean));
  const attackMemberships = operations.filter((operation) => operation.type === "attack" && !claimedOperationIds.has(operation.operation_id));
  const defenseMemberships = operations.filter((operation) => operation.type === "defense");
  const scoutMemberships = operations.filter((operation) => operation.type === "scout");

  const lines = [`<b>${escapeHtml(scopeLabel)} Your Commitments</b>`];
  appendCommitmentSection(lines, "Attacks", [
    ...claims.map((claim) => `ATTACK ${formatClaimLine(claim)}`),
    ...attackMemberships.map((operation) => formatPersonalOperationCommitment(operation, memberByOperation.get(operation.operation_id)))
  ]);
  appendCommitmentSection(lines, "Defense", [
    ...coveredIncoming.map(formatPersonalDefenseCommitment),
    ...defenseMemberships.map((operation) => formatPersonalOperationCommitment(operation, memberByOperation.get(operation.operation_id)))
  ]);
  appendCommitmentSection(lines, "Scouting", scoutMemberships.map((operation) => (
    formatPersonalOperationCommitment(operation, memberByOperation.get(operation.operation_id))
  )));

  if (!claims.length && !attackMemberships.length && !coveredIncoming.length && !defenseMemberships.length && !scoutMemberships.length) {
    lines.push("", `You have no active attack, defense, or scouting commitments in ${escapeHtml(scopeLabel)}.`);
  }
  return respond(ctx, mode, lines.join("\n"), {
    parse_mode: "HTML",
    ...claimListKeyboard(claims)
  });
}

function appendCommitmentSection(lines, title, rows) {
  lines.push("", `<b>${escapeHtml(title)}</b> (${rows.length})`);
  lines.push(...(rows.length ? rows : ["None."]));
}

function formatPersonalOperationCommitment(operation, member) {
  const target = operation.type === "defense"
    ? `${operation.defended_coord || operation.target_coord || "?"} <= ${operation.hostile_origin || "?"}`
    : operation.target_coord || operation.short_id || "?";
  const state = member?.state || member?.role || "joined";
  const timing = scoutAgendaInfo(operation) ? "active watch" : formatEta(new Date(operation.arrival_at));
  return `${escapeHtml(operation.type.toUpperCase())} ${escapeHtml(target)} - ${escapeHtml(state)} - ${timing}`;
}

function formatPersonalDefenseCommitment(row) {
  const defended = row.defended_coord || "?";
  const attacker = row.attacker_coord || "?";
  return `DEFENSE ${escapeHtml(defended)} &lt;= ${escapeHtml(attacker)} - covered - ${formatEta(new Date(row.arrival_at))}`;
}

async function handleAttacked(ctx, text, mode) {
  const match = text.trim().match(attackedPattern);
  if (!match) return respond(ctx, mode, "Use: $sos B24:45:10:30 B24:34:06:10 25 optional note");

  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");

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
  const workingGalaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
  const rawQuery = commandBody(text);
  if (/^(help|usage|\?)$/i.test(rawQuery)) return respond(ctx, mode, await helpText(ctx, "!help incoming"), { parse_mode: "HTML" });
  if (/^clear\b/i.test(rawQuery)) return clearIncomingReports(ctx, mode, workingGalaxy, scopeId, rawQuery.replace(/^clear\b/i, "").trim());
  const imported = parseIncomingExportRows(rawQuery, workingGalaxy);
  if (imported.length) {
    const saved = await insertIncomingRows(ctx, imported, scopeId);
    return respond(ctx, mode, `Imported ${saved}/${imported.length} incoming reports. Use <code>$incoming</code>, <code>$incoming B24:36</code>, or <code>$incoming [APP]</code>.`, { parse_mode: "HTML" });
  }

  const queryGalaxy = explicitGalaxyFromText(rawQuery);
  const query = stripLeadingGalaxyScope(rawQuery, queryGalaxy);
  const scopeLabel = displayGalaxyScope(queryGalaxy);
  const incoming = await fetchActiveIncoming(queryGalaxy, scopeId);
  const pageInfo = parseIncomingPage(query);
  const filtered = filterIncomingReports(incoming, pageInfo.query, queryGalaxy);
  const enriched = await enrichIncomingReports(filtered, queryGalaxy);
  const pageSize = 15;
  const from = (pageInfo.page - 1) * pageSize;
  const pageRows = enriched.slice(from, from + pageSize);
  const label = pageInfo.query ? ` matching ${escapeHtml(pageInfo.query)}` : "";
  if (!pageRows.length) return respond(ctx, mode, `No active hostile incoming reports${label} in ${escapeHtml(scopeLabel)}.`, { parse_mode: "HTML" });
  const lines = [`<pre>${pageRows.map(formatIncomingLine).join("\n")}</pre>`, "", `${from + 1}-${from + pageRows.length} of ${enriched.length} incoming`];
  if (from + pageRows.length < enriched.length) {
    lines.push(`Next: <code>$incoming ${escapeHtml([queryGalaxy, pageInfo.query, `page ${pageInfo.page + 1}`].filter(Boolean).join(" "))}</code>`);
  }
  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleDefensePool(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
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
    await ctx.answerCbQuery("No approved APP room is active.");
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
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
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
    if (!scopeId) {
      return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
    }

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

async function handleHistory(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const parsed = parseLocation(commandBody(text), galaxy);
  if (!parsed || parsed.kind !== "astro") {
    return respond(ctx, mode, `Use: <code>${escapeHtml(mode)}history ${escapeHtml(galaxy)}:14:64:30</code>`, { parse_mode: "HTML" });
  }
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run <code>$approvechat</code> in the room.", { parse_mode: "HTML" });
  const history = await battleHistoryReader.coordinateHistory({
    authorized: true,
    mapId: galaxyToMapId(parsed.galaxy),
    chatId: scopeId,
    coord: parsed.coord,
    limit: 8
  });
  return respond(ctx, mode, formatHistoryTelegram(history, { escapeHtml }), { parse_mode: "HTML" });
}

async function handleOccupied(ctx, text, mode) {
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run <code>$approvechat</code> in the room.", { parse_mode: "HTML" });
  const rawQuery = commandBody(text);
  const galaxy = explicitGalaxyFromText(rawQuery);
  const query = (galaxy ? parseRegion(rawQuery, galaxy) : "") || rawQuery;
  const rows = await battleHistoryReader.activeOccupations({
    authorized: true,
    mapId: galaxy ? galaxyToMapId(galaxy) : "",
    chatId: scopeId,
    query,
    limit: 20
  });
  return respond(ctx, mode, formatOccupiedTelegram({ galaxy: displayGalaxyScope(galaxy), query: rawQuery, rows }, { escapeHtml }), { parse_mode: "HTML" });
}

function formatHistoryNumber(value) {
  return Number(value).toLocaleString("en-US");
}

async function handleAstros(ctx, text, mode) {
  const query = commandBody(text);
  const report = await buildAstrosReport(query, explicitGalaxyFromText(query));
  return respond(ctx, mode, report, { parse_mode: "HTML" });
}

async function handleSectors(ctx, text, mode) {
  const galaxy = await galaxyForContext(ctx);
  const query = commandBody(text);
  const report = await buildSectorScoutReport(query, galaxy);
  return respond(ctx, mode, report, { parse_mode: "HTML" });
}

async function handleRegions(ctx, text, mode) {
  const fallbackGalaxy = await galaxyForContext(ctx);
  const parsed = parseRegionCoverageQuery(commandBody(text), fallbackGalaxy);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
  const coverage = await regionCoverage(parsed.galaxy, scopeId);
  const regions = regionsWithoutCoverage(parsed.galaxy, coverage);
  const agenda = await ensureRegionCoverageAgenda(ctx, parsed.galaxy, scopeId, regions);
  const assignments = agenda ? await scoutAgendaAssignments(agenda) : new Map();
  return respond(ctx, mode, formatScoutRegionMap(parsed.galaxy, agenda, assignments, coverage), {
    parse_mode: "HTML",
    ...scoutRegionMapKeyboard(parsed.galaxy, agenda, assignments, coverage)
  });
}

async function handleStale(ctx, text, mode) {
  const query = text.replace(/^[!$]stale\b/i, "").trim();
  const report = await buildStaleReport(query, explicitGalaxyFromText(query));
  return respond(ctx, mode, report, { parse_mode: "HTML" });
}

async function handleScore(ctx, text, mode) {
  const query = text.replace(/^[!$]score\b/i, "").trim();
  const report = await buildScoreReport(query, explicitGalaxyFromText(query));
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
  const rawQuery = commandBody(text).replace(/^@/, "");
  const parsed = parseBasesQuery(rawQuery, explicitGalaxyFromText(rawQuery));
  if (!parsed.query) return respond(ctx, mode, "Use: !bases playername or !bases B24 [ROTC]");
  if (looksLikeAstroSearch(parsed.query)) {
    const astroScope = parsed.galaxy ? `${parsed.galaxy} ` : "";
    return respond(ctx, mode, `That is an astro search. Use <code>${escapeHtml(mode)}astros ${escapeHtml(astroScope)}${escapeHtml(parsed.query)}</code> for terrain, attributes, empty/occupied, or alliance filters.`, { parse_mode: "HTML" });
  }
  return sendBasesReport(ctx, mode, parsed.query, parsed.galaxy);
}

async function handleStance(ctx, text, mode, stance) {
  if (!(await safeUserCanUseOfficerCommands(ctx))) {
    return respond(ctx, mode, "Only Lysander officers can change shared friend/enemy classifications.");
  }
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
  // Browsing without a Bxx prefix is intentionally cross-galaxy. Creating
  // an agenda or attack stays scoped and is therefore only offered below
  // when the caller explicitly chose a galaxy.
  const galaxy = normalizeGalaxy(galaxyOverride);
  const scopeLabel = displayGalaxyScope(galaxy);
  const pageInfo = parsePageFromQuery(query);
  query = pageInfo.query;
  const queryCommand = [galaxy, query].filter(Boolean).join(" ");
  const scopeId = await operationScopeId(ctx).catch((error) => {
    console.error("Base report scope lookup failed", error);
    return "";
  });
  const baseLookups = await Promise.allSettled([
    fetchRows("b24_user_bases", {
      status: "eq.active"
    }, queryOptionsForGalaxy(galaxy, { order: "base_coord.asc" })),
    fetchRows("b24_bases", {}, queryOptionsForGalaxy(galaxy, { order: "coord.asc" })),
    scopeId ? fetchRows("b24_intel_annotations", {
      chat_id: `eq.${scopeId}`
    }, queryOptionsForGalaxy(galaxy, { order: "coord.asc" })) : []
  ]);
  const [savedRows, importedRows, annotations] = baseLookups.map((result, index) => {
    if (result.status === "fulfilled") return Array.isArray(result.value) ? result.value : [];
    const labels = ["saved bases", "imported bases", "intel annotations"];
    console.error(`Base report ${labels[index]} lookup failed`, result.reason);
    return [];
  });

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
    return respond(ctx, mode, `No saved or imported bases found for ${escapeHtml(query)} in ${escapeHtml(scopeLabel)}.`, { parse_mode: "HTML" });
  }

  const stances = galaxy ? await fetchStanceMap(galaxy) : new Map();
  const canManageOperations = Boolean(galaxy && scopeId && await safeUserCanUseOfficerCommands(ctx));
  const activeOperations = canManageOperations
    ? await fetchActiveOperations(galaxy, scopeId).catch((error) => {
      console.error("Base report operation lookup failed", error);
      return [];
    })
    : [];
  const activeAttackPlans = activeOperations.filter((operation) => operation.type === "attack");
  const addPlan = newestAttackPlan(activeAttackPlans);

  const owners = [...new Set([
    ...savedMatches.map((row) => row.owner_label || query),
    ...importedMatches.map((row) => [row.guild, row.label].filter(Boolean).join(" ") || query),
    ...annotationMatches.map((row) => `Lysander ${row.alliance}`)
  ])];
  const reportEntries = [
    ...importedMatches.map((row) => ({ section: "Imported Intel", kind: "imported", row })),
    ...savedMatches.map((row) => ({ section: "Saved By Users", kind: "saved", row })),
    ...annotationMatches.map((row) => ({ section: "Lysander Assessments", kind: "annotation", row }))
  ];
  const reportPageSize = 25;
  const reportPageCount = Math.max(1, Math.ceil(reportEntries.length / reportPageSize));
  const reportPage = Math.min(pageInfo.page, reportPageCount);
  const reportStart = (reportPage - 1) * reportPageSize;
  const reportEnd = Math.min(reportEntries.length, reportStart + reportPageSize);
  const pageEntries = reportEntries.slice(reportStart, reportEnd);
  const compactOwnerTitle = owners.length <= 6
    ? owners.join(", ")
    : `${scopeLabel} bases matching ${query}`;
  const lines = [
    `<b>${escapeHtml(compactOwnerTitle)}</b>`,
    `${importedMatches.length} imported / ${savedMatches.length} saved / ${annotationMatches.length} Lysander-assessed bases in ${escapeHtml(scopeLabel)}`
  ];
  let currentSection = "";
  for (const entry of pageEntries) {
    if (entry.section !== currentSection) {
      lines.push("", `<b>${entry.section}</b>`);
      currentSection = entry.section;
    }
    if (entry.kind === "imported") lines.push(formatImportedBaseLine(entry.row, stances));
    if (entry.kind === "saved") lines.push(formatUserBaseLine(entry.row));
    if (entry.kind === "annotation") {
      lines.push(`${escapeHtml(entry.row.coord)} - Lysander alliance ${escapeHtml(entry.row.alliance)}`);
    }
  }
  if (reportPageCount > 1) {
    lines.push("", `Page ${reportPage}/${reportPageCount} (${reportStart + 1}-${reportEnd} of ${reportEntries.length})`);
    if (reportPage > 1) lines.push(`Previous: <code>$bases ${escapeHtml(queryCommand)} page ${reportPage - 1}</code>`);
    if (reportPage < reportPageCount) lines.push(`Next: <code>$bases ${escapeHtml(queryCommand)} page ${reportPage + 1}</code>`);
  }
  const rowsForButtons = [...importedMatches, ...annotationMatches];
  const totalActionable = uniqueBaseCoords(rowsForButtons, savedMatches).length;
  const quickSetupRows = quickSetupKeyboardRows(
    galaxy,
    query,
    Boolean(canManageOperations && !activeOperations.length && totalActionable)
  );
  const pageImportedRows = pageEntries
    .filter((entry) => entry.kind === "imported" || entry.kind === "annotation")
    .map((entry) => entry.row);
  const pageSavedRows = pageEntries.filter((entry) => entry.kind === "saved").map((entry) => entry.row);
  const pageActionCount = uniqueBaseCoords(pageImportedRows, pageSavedRows).length;
  if (addPlan && pageActionCount > 8) lines.push("", `Action buttons: first 8 bases on page ${reportPage}.`);
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
    ...baseListKeyboard(pageImportedRows, pageSavedRows, 1, addPlan, activeAttackPlans, quickSetupRows)
  });
}

async function handleBoard(ctx, text, mode) {
  const kind = boardKind(text);
  const queryGalaxy = explicitGalaxyFromText(commandBody(text));
  const scopeLabel = displayGalaxyScope(queryGalaxy);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) return respond(ctx, mode, "No approved APP operation room is active. Ask an officer to run $approvechat in the room.");
  const [operations, appClaims, incomingRows] = await Promise.all([
    fetchActiveOperations(queryGalaxy, scopeId, kind),
    kind === "defense" || kind === "scout" ? [] : fetchBoardClaims(queryGalaxy, scopeId),
    kind === "attack" || kind === "scout" ? [] : fetchActiveIncoming(queryGalaxy, scopeId)
  ]);
  const membersByOperation = await fetchMembersByOperation(operations);
  const claimsByOperation = await fetchClaimsByOperation(operations);
  const attacks = operations.filter((operation) => operation.type === "attack");
  const incomingOperationIds = new Set(incomingRows.map((row) => row.operation_id).filter(Boolean));
  const defenses = operations.filter((operation) => operation.type === "defense" && !incomingOperationIds.has(operation.operation_id));
  const scouts = operations.filter((operation) => operation.type === "scout");
  const attackCount = attacks.length + appClaims.length;

  const formatOperation = (operation, members = [], claims = []) => {
    const prefix = queryGalaxy ? "" : `${galaxyFromMapId(operation.map_id)} `;
    return `${prefix}${formatBoardOperationCompact(operation, members, claims)}`;
  };
  const lines = [`<b>${escapeHtml(scopeLabel)} Board</b>`];
  if (kind !== "defense" && kind !== "scout") {
    lines.push("", `<b>Attacks</b> (${attackCount})`);
    const attackLines = [
      ...attacks.map((operation) => {
        return formatOperation(
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
      ...defenses.map((operation) => formatOperation(operation, membersByOperation.get(operation.operation_id) || []))
    ];
    lines.push("", `<b>Defense</b> (${defenseLines.length})`);
    lines.push(...(defenseLines.length ? [`<pre>${defenseLines.join("\n")}</pre>`] : ["No active defense operations."]));
  }
  if (kind !== "attack" && kind !== "defense") {
    lines.push("", `<b>Scouts</b> (${scouts.length})`);
    lines.push(...(scouts.length ? [`<pre>${scouts.map((operation) => formatOperation(operation, membersByOperation.get(operation.operation_id) || [])).join("\n")}</pre>`] : ["No active scout operations."]));
  }

  return respond(ctx, mode, lines.join("\n"), { parse_mode: "HTML" });
}

async function handleNext(ctx, text, mode) {
  if (!ctx.from?.id) return respond(ctx, mode, "Use !next in a group or private chat so I know who to look up.");
  const workingGalaxy = await galaxyForContext(ctx);
  const queryGalaxy = explicitGalaxyFromText(commandBody(text));
  const scopeLabel = displayGalaxyScope(queryGalaxy);
  const scopeId = await operationScopeId(ctx);
  if (!scopeId) {
    return respond(ctx, mode, [
      "<b>Next Step</b>",
      "No APP operation room is configured yet.",
      "An APP officer must run <code>$approvechat</code> in the operation room first."
    ].join("\n"), { parse_mode: "HTML" });
  }

  const userId = telegramUserId(ctx);
  let access = null;
  try {
    access = await fetchAccessMember(scopeId, userId);
  } catch (error) {
    console.error("next access lookup failed", error?.message || error);
  }
  const hasAccess = await safeUserCanUseSensitiveCommands(ctx);
  if (!hasAccess) {
    if (access?.status === "banned") {
      return respond(ctx, mode, "<b>Access Blocked</b>\nContact an APP officer if you believe this is a mistake.", { parse_mode: "HTML" });
    }
    if (access?.status === "pending") {
      return respond(ctx, mode, [
        "<b>Enlistment Pending</b>",
        "Your APP enlistment is waiting for officer approval.",
        "An officer can approve you with <code>$approve</code> by replying to one of your messages."
      ].join("\n"), { parse_mode: "HTML" });
    }
    return respond(ctx, mode, [
      "<b>Next Step</b>",
      "Request APP access with <code>!enlist</code>.",
      "After approval, run <code>!next</code> again for your personal setup steps."
    ].join("\n"), { parse_mode: "HTML" });
  }

  const scope = parseNextScope(`${mode}next ${stripLeadingGalaxyScope(commandBody(text), queryGalaxy)}`);
  const [memberships, bases] = await Promise.all([
    fetchRows("b24_operation_members", {
      user_id: `eq.${userId}`
    }, queryOptionsForGalaxy(queryGalaxy, { order: "updated_at.asc" })),
    fetchRows("b24_user_bases", {
      user_id: `eq.${telegramUserId(ctx)}`,
      status: "eq.active"
    }, queryOptionsForGalaxy(queryGalaxy, { order: "base_coord.asc" }))
  ]);
  const activeMemberships = memberships.filter((member) => member.state !== "withdrawn");
  const operations = await fetchOperationsForMemberships(queryGalaxy, activeMemberships);
  const actionOps = operations.filter((operation) => operation.status === "active" && operation.chat_id === scopeId);
  const membersByOperation = await fetchMembersByOperation(actionOps);
  const incoming = scope.kind === "empire" ? [] : await incomingForUserBases(queryGalaxy, scopeId, bases, telegramUserId(ctx));
  const filteredOps = actionOps
    .filter((operation) => scope.kind === "all" || scope.kind === "combat" || operation.type === scope.kind)
    .filter((operation) => new Date(operation.arrival_at).getTime() <= Date.now() + scope.hours * 60 * 60 * 1000);
  const filteredIncoming = incoming
    .filter((row) => new Date(row.arrival_at).getTime() <= Date.now() + scope.hours * 60 * 60 * 1000);

  const setupLines = bases.length
    ? [
      "<b>Empire</b>",
      `Saved bases: ${bases.length}`,
      "Review them with <code>!me bases</code>."
    ]
    : [
      "<b>Setup</b>",
      `Save one of your bases: <code>!mine ${workingGalaxy}:06:10:20</code>`,
      `Working galaxy: ${escapeHtml(workingGalaxy)}. Change it with <code>!g B23</code> when needed.`,
      "Then run <code>!next</code> again."
    ];
  const readyLines = scope.kind === "all" && !filteredOps.length && !filteredIncoming.length
    ? [
      "",
      "<b>Ready for Operations</b>",
      "Check <code>!attacks</code>, <code>!scouts</code>, or <code>!watches</code> for shared work."
    ]
    : [];

  const lines = [
    `<b>${escapeHtml(scopeLabel)} Next Actions</b>`,
    `${scope.label}`,
    "",
    `<b>Operations</b> (${filteredOps.length})`,
    ...(filteredOps.length
      ? [`<pre>${filteredOps.slice(0, 8).map((operation) => `${queryGalaxy ? "" : `${galaxyFromMapId(operation.map_id)} `}${formatBoardOperationCompact(operation, membersByOperation.get(operation.operation_id) || [])}`).join("\n")}</pre>`]
      : ["No active operations need you."]),
    "",
    `<b>Incoming Near Your Bases</b> (${filteredIncoming.length})`,
    ...(filteredIncoming.length
      ? [`<pre>${filteredIncoming.slice(0, 8).map(formatIncomingLine).join("\n")}</pre>`]
      : ["No active incoming matched your saved bases."]),
    "",
    ...setupLines,
    ...readyLines,
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
  const [astro, base, savedBases, stances, annotation, history] = await Promise.all([
    fetchOne("b24_astros", { coord }, mapIdForCoord(coord)),
    fetchOne("b24_bases", { coord }, mapIdForCoord(coord)),
    includeSavedBases ? fetchRows("b24_user_bases", {
      base_coord: `eq.${coord}`,
      status: "eq.active"
    }, { mapId: mapIdForCoord(coord), order: "owner_label.asc" }) : [],
    fetchStanceMap(galaxyFromCoord(coord)),
    fetchIntelAnnotation(coord, options.scopeId),
    options.scopeId ? battleHistoryReader.coordinateHistory({
      authorized: true,
      mapId: mapIdForCoord(coord),
      chatId: options.scopeId,
      coord,
      limit: 20
    }) : { timeline: [], occupation: null }
  ]);

  const latestBattle = history.timeline.find((item) => item.kind === "battle") || null;
  if (!astro && !base && !savedBases.length && !latestBattle && !history.occupation) return `No intel found for ${escapeHtml(coord)} yet.`;

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
  if (latestBattle) {
    lines.push("", `<b>Latest battle</b>: ${escapeHtml(latestBattle.effectiveAt || "time unknown")} - ${escapeHtml(latestBattle.outcome)}`);
    lines.push(`${escapeHtml(latestBattle.attacker)} vs ${escapeHtml(latestBattle.defender)}`);
    if (latestBattle.losses.total != null) {
      lines.push(`Destroyed: ${formatHistoryNumber(latestBattle.losses.total)} | Debris: ${formatHistoryNumber(latestBattle.debris || 0)}`);
    }
  }
  if (history.occupation?.active) {
    lines.push("", "<b>Current occupation</b>", `Owner: ${escapeHtml(history.occupation.owner)}`, `Occupier: ${escapeHtml(history.occupation.occupier)}`);
  } else if (history.occupation && history.occupation.state !== "unresolved") {
    lines.push("", `<b>Current occupation</b>: none active (${escapeHtml(history.occupation.state)})`);
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
  const galaxy = parsed?.galaxy || galaxyFromCoord(region) || normalizeGalaxy(fallbackGalaxy);
  const cutoff = new Date(Date.now() - staleIntelMs).toISOString();

  if (parsed?.kind === "astro") return buildAstroAgeReport(parsed.coord);

  const filters = { updated_at: `lt.${cutoff}` };
  let title = displayGalaxyScope(galaxy);
  if (parsed?.kind === "system") {
    filters.system_id = `eq.${parsed.coord}`;
    title = parsed.coord;
  } else if (region) {
    filters.region_id = `eq.${region}`;
    title = region;
  }

  const [astros, bases] = await Promise.all([
    fetchRows("b24_astros", filters, queryOptionsForGalaxy(galaxy, { order: "updated_at.asc", limit: 12 })),
    fetchRows("b24_bases", filters, queryOptionsForGalaxy(galaxy, { order: "updated_at.asc", limit: 12 }))
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
  const galaxy = parsed?.galaxy || galaxyFromCoord(region) || normalizeGalaxy(fallbackGalaxy);

  if (parsed?.kind === "astro") {
    const mapId = mapIdForCoord(parsed.coord);
    const [astro, base] = await Promise.all([
      fetchOne("b24_astros", { coord: parsed.coord }, mapId),
      fetchOne("b24_bases", { coord: parsed.coord }, mapId)
    ]);
    if (!astro && !base) return `No intel found for ${escapeHtml(parsed.coord)} yet.`;
    return [`<b>Target Score ${escapeHtml(parsed.coord)}</b>`, scoreLine(astro || { coord: parsed.coord, attributes: [] }, base)].join("\n");
  }

  const filters = {};
  let title = displayGalaxyScope(galaxy);
  if (parsed?.kind === "system") {
    filters.system_id = `eq.${parsed.coord}`;
    title = parsed.coord;
  } else if (region) {
    filters.region_id = `eq.${region}`;
    title = region;
  } else {
    filters.has_base = "eq.true";
  }

  const astros = await fetchRows("b24_astros", filters, queryOptionsForGalaxy(galaxy, { order: "coord.asc", limit: 100 }));
  if (!astros.length) return `No scoreable astro intel found for ${escapeHtml(title)} yet.`;

  const scored = await Promise.all(astros.map(async (astro) => {
    const base = await fetchOne("b24_bases", { coord: astro.coord }, mapIdForCoord(astro.coord));
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
  const filters = {};
  if (region) filters.region_id = `eq.${region}`;
  const rows = await fetchAllRows("b24_astros", filters, queryOptionsForGalaxy(galaxy, { select: "terrain,has_base", order: "terrain.asc" }));
  const title = region || displayGalaxyScope(galaxy);
  if (!rows.length) return `No astro intel found for ${escapeHtml(title)} yet.`;
  const counts = countBy(rows, "terrain");
  const lines = [`<b>Astro Breakdown ${escapeHtml(title)}</b>`];
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([terrain, total]) => lines.push(`${escapeHtml(terrain || "Unknown")}: ${total}`));
  lines.push("", `Total: ${rows.length}`, `With bases: ${rows.filter((row) => row.has_base).length}`);
  return lines.join("\n");
}

async function buildAstroSearch(parsed) {
  const filters = {};
  const scopeLabel = parsed.region || displayGalaxyScope(parsed.galaxy);
  const titleParts = [parsed.filter || "astros", scopeLabel].filter(Boolean);
  if (parsed.region) filters.region_id = `eq.${parsed.region}`;
  if (parsed.filter) filters.terrain = `ilike.*${parsed.filter}*`;
  const pageSize = 50;
  const page = Math.max(1, parsed.page || 1);
  const from = (page - 1) * pageSize;
  let rows = [];
  let count = 0;
  if (parsed.attrFilters.length || parsed.excludedTags.length || parsed.includedTags.length || parsed.nearTags.length || parsed.emptyOnly || parsed.bodyType) {
    const allRows = await fetchAllRows("b24_astros", filters, {
      ...queryOptionsForGalaxy(parsed.galaxy),
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
      ...queryOptionsForGalaxy(parsed.galaxy),
      order: "coord.asc",
      from,
      to: from + pageSize - 1
    });
    rows = result.rows;
    count = result.count;
  }
  if (!rows.length) return `No ${escapeHtml(parsed.filter || "matching")} astros found in ${escapeHtml(scopeLabel)}.`;
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
  const fallback = normalizeGalaxy(fallbackGalaxy);
  const location = parseAstrosLocation(raw, fallback);
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

function parseRegionCoverageQuery(query, fallbackGalaxy) {
  const raw = String(query || "").trim();
  const explicitGalaxy = normalizeGalaxy((raw.toUpperCase().match(/\bB\d{2}\b/) || [])[0]);
  const galaxy = explicitGalaxy || normalizeGalaxy(fallbackGalaxy) || defaultGalaxy;
  return { galaxy };
}

async function regionCoverage(galaxy, scopeId) {
  const mapId = galaxyToMapId(galaxy);
  const [sectorRows, savedBases, importedBases, stances] = await Promise.all([
    fetchAllRows("b24_sectors", {}, { mapId, select: "sector_id,status,has_friendly,has_scout" }),
    fetchAllRows("b24_user_bases", { status: "eq.active" }, { mapId, select: "region_id,base_coord" }),
    fetchAllRows("b24_bases", {}, { mapId, select: "region_id,coord,guild" }),
    fetchStanceMap(galaxy)
  ]);
  const covered = new Set(sectorRows
    .filter((row) => row.has_friendly || row.has_scout || row.status === "base" || row.status === "scout")
    .map((row) => `${galaxy}:${Number(row.sector_id)}`)
    .filter((region) => /^B\d{2}:(?:[1-9]|[1-9]\d)$/.test(region)));
  savedBases
    .map((base) => base.region_id || astroToRegion(base.base_coord || ""))
    .filter(Boolean)
    .forEach((region) => covered.add(`${galaxy}:${Number(String(region).split(":")[1])}`));

  const friendlyTags = new Set([...stances.tag.entries()]
    .filter(([, stance]) => stance === "friend")
    .map(([tag]) => tag));
  const friendlyBaseRegions = new Set(importedBases
    .filter((base) => friendlyTags.has(normalizeStanceTarget(base.guild)))
    .map((base) => base.region_id || astroToRegion(base.coord || ""))
    .filter(Boolean)
    .map((region) => `${galaxy}:${Number(String(region).split(":")[1])}`));
  friendlyBaseRegions.forEach((region) => covered.add(region));

  const scoutOperations = await fetchActiveOperations(galaxy, scopeId, "scout");
  const assignments = await Promise.all(scoutOperations.map(async (operation) => {
    const members = await fetchOperationMembers(operation);
    return {
      operation,
      assigned: members.some((member) => member.state !== "withdrawn" && ["joined", "ready", "sent"].includes(member.state))
    };
  }));
  assignments
    .filter((entry) => entry.assigned)
    .map((entry) => operationRegion(entry.operation))
    .filter(Boolean)
    .forEach((region) => covered.add(`${galaxy}:${Number(String(region).split(":")[1])}`));

  covered.friendlyTags = friendlyTags;
  covered.friendlyBaseRegions = friendlyBaseRegions;
  return covered;
}

function regionsWithoutCoverage(galaxy, covered) {
  const regions = [];
  for (let region = 1; region <= 99; region += 1) {
    const regionId = `${galaxy}:${region}`;
    if (!covered.has(regionId)) regions.push(regionId);
  }
  return regions;
}

async function ensureRegionCoverageAgenda(ctx, galaxy, scopeId, uncoveredRegions) {
  const agendaName = `${galaxy} Region Coverage`;
  let agendas = groupScoutAgendas(await fetchScoutAgendas(galaxy, scopeId));
  let agenda = agendas.find((item) => item.name === agendaName) || null;
  if (!uncoveredRegions.length) return agenda;

  const existingTargets = new Set((agenda?.operations || []).map((operation) => operation.target_coord));
  const missingTargets = uncoveredRegions.filter((region) => !existingTargets.has(region));
  if (!missingTargets.length) return agenda;

  const arrivalAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  const agendaKey = agenda?.key || newScoutAgendaKey();
  for (const targetCoord of missingTargets) {
    const operation = operationRow(ctx, {
      type: "scout",
      targetCoord,
      arrivalAt,
      note: scoutAgendaNote(agendaKey, agendaName),
      chatId: scopeId
    });
    operation.map_id = galaxyToMapId(galaxy);
    await insertRow("b24_operations", operation);
  }
  agendas = groupScoutAgendas(await fetchScoutAgendas(galaxy, scopeId));
  return agendas.find((item) => item.key === agendaKey) || agendas.find((item) => item.name === agendaName) || null;
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
    ...queryOptionsForGalaxy(parsed.galaxy),
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
    .map((agenda) => ({ ...agenda, operations: agenda.operations.sort((a, b) => String(a.target_coord).localeCompare(String(b.target_coord), undefined, { numeric: true })) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scoutAgendaTargetKind(agenda) {
  return agenda?.operations?.every((operation) => /^B\d{2}:\d{1,2}$/.test(String(operation.target_coord || "")))
    ? "region"
    : "base";
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
  const covered = agenda.operations.filter((operation) => Boolean(assignments.get(operation.operation_id))).length;
  const targetKind = scoutAgendaTargetKind(agenda);
  return [
    `<b>${escapeHtml(agenda.name)} SCOUTING AGENDA</b>`,
    `Status: persistent until cancelled`,
    `Watch ${targetKind}s: ${coords.length} | Assigned: ${covered} | Open: ${coords.length - covered}`,
    "",
    `<pre>${agenda.operations.map((operation, index) => {
      const assignment = assignments.get(operation.operation_id);
      const state = assignment ? assignment.display_name || "assigned" : "open";
      return `${String(index + 1).padStart(2, "0")} ${operation.target_coord} ${state}`;
    }).join("\n")}</pre>`,
    "",
    `Choose Watch ${targetKind}s to take responsibility for a ${targetKind}.`
  ].join("\n");
}

function scoutAgendaListKeyboard(galaxy, agendas) {
  return Markup.inlineKeyboard(agendas.slice(0, 8).map((agenda) => [
    Markup.button.callback(`Open ${agenda.name}`.slice(0, 40), `scoutagenda:${galaxy}:${agenda.key}`)
  ]));
}

function scoutAgendaKeyboard(galaxy, agenda, assignments, canManage) {
  const targetKind = scoutAgendaTargetKind(agenda);
  const rows = [];
  if (targetKind === "region") {
    rows.push([Markup.button.callback("Region map (10x10)", `scoutregionmap:${galaxy}:${agenda.key}`)]);
  }
  rows.push([Markup.button.callback(`Watch ${targetKind}s (${agenda.operations.length})`, `scoutwatchlist:${galaxy}:${agenda.key}:1`)]);
  if (canManage && targetKind === "base") {
    rows.push([
      Markup.button.callback("Attack 1h", `scoutagendaattack:${galaxy}:${agenda.key}:1`),
      Markup.button.callback("Attack 2h", `scoutagendaattack:${galaxy}:${agenda.key}:2`)
    ], [
      Markup.button.callback("Attack 3h", `scoutagendaattack:${galaxy}:${agenda.key}:3`),
      Markup.button.callback("Attack 4h", `scoutagendaattack:${galaxy}:${agenda.key}:4`)
    ]);
  }
  if (canManage) {
    rows.push([
      Markup.button.callback("Cancel agenda", `scoutagendacancel:${galaxy}:${agenda.key}`)
    ]);
  }
  return rows.length ? Markup.inlineKeyboard(rows) : {};
}

function formatScoutWatchList(agenda, assignments, page = 1) {
  const pageSize = 12;
  const from = (page - 1) * pageSize;
  const shown = agenda.operations.slice(from, from + pageSize);
  const covered = agenda.operations.filter((operation) => Boolean(assignments.get(operation.operation_id))).length;
  const targetKind = scoutAgendaTargetKind(agenda);
  return [
    `<b>${escapeHtml(agenda.name)} WATCH ${targetKind.toUpperCase()}S</b>`,
    `Assigned: ${covered}/${agenda.operations.length} | Open: ${agenda.operations.length - covered}`,
    `Page ${page}/${Math.max(1, Math.ceil(agenda.operations.length / pageSize))}`,
    "",
    `<pre>${shown.map((operation, offset) => {
      const assignment = assignments.get(operation.operation_id);
      const state = assignment ? assignment.display_name || "assigned" : "open";
      return `${String(from + offset + 1).padStart(2, "0")} ${operation.target_coord} ${state}`;
    }).join("\n")}</pre>`,
    `Tap a ${targetKind} to claim or review its watch assignment.`
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
  const targetKind = /^B\d{2}:\d{1,2}$/.test(String(operation.target_coord || "")) ? "region" : "coordinate";
  if (!assignment) {
    return [
      `<b>WATCH ${escapeHtml(operation.target_coord)}</b>`,
      `Open watch ${targetKind}.`,
      `Take responsibility for watching this ${targetKind}.`
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

function formatScoutRegionMap(galaxy, agenda, assignments, coverage) {
  const assigned = agenda?.operations?.filter((operation) => Boolean(assignments.get(operation.operation_id))).length || 0;
  const uncovered = regionsWithoutCoverage(galaxy, coverage).length;
  const friendlyTags = [...(coverage?.friendlyTags || [])].join(", ") || "none";
  const friendlyBaseRegions = coverage?.friendlyBaseRegions?.size || 0;
  return [
    `<b>${escapeHtml(agenda?.name || "Region Coverage")} MAP</b>`,
    `Uncovered: ${uncovered} | Active watch assignments: ${assigned}`,
    `Friendly tags: ${escapeHtml(friendlyTags)} | Base regions: ${friendlyBaseRegions}`,
    "",
    "🟥 needs coverage   🟩 base, scout, or watch assigned",
    "Tap a red region to take responsibility for its watch."
  ].join("\n");
}

function scoutRegionMapKeyboard(galaxy, agenda, assignments, coverage) {
  const targets = new Map((agenda?.operations || []).map((operation, index) => [
    `${galaxy}:${Number(String(operation.target_coord || "").split(":")[1])}`,
    { operation, index: index + 1 }
  ]));
  const rows = [];
  for (let start = 1; start <= 99; start += 10) {
    const row = [];
    for (let region = start; region < Math.min(start + 10, 100); region += 1) {
      const id = `${galaxy}:${region}`;
      const target = targets.get(id);
      const label = String(region).padStart(2, "0");
      if (!target) {
        row.push(Markup.button.callback(`🟩${label}`, "noop:covered"));
        continue;
      }
      const assigned = assignments.get(target.operation.operation_id);
      const covered = assigned || coverage.has(id);
      row.push(Markup.button.callback(`${covered ? "🟩" : "🟥"}${label}`, covered ? "noop:covered" : `scoutwatchtarget:${galaxy}:${agenda.key}:${target.index}`));
    }
    rows.push(row);
  }
  return Markup.inlineKeyboard(rows);
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

function parseBasesQuery(query, fallbackGalaxy = "") {
  let raw = String(query || "").trim();
  let galaxy = normalizeGalaxy(fallbackGalaxy);
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
  const rows = await fetchRows("b24_stances", {}, queryOptionsForGalaxy(galaxy, {
    order: "scope_type.asc,scope_value.asc"
  })).catch(() => []);
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
  return Markup.inlineKeyboard(coords.map((coord) => [Markup.button.callback(`Intel ${coord}`, `intel:${coord}`)]));
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
  const roomId = !isPrivateChat(ctx) && ctx.chat?.id ? String(ctx.chat.id) : "";
  const scopeId = await operationScopeId(ctx);
  const userId = telegramUserId(ctx);
  const room = roomId
    ? await fetchOne("b24_chat_settings", { chat_id: roomId }, null, false)
    : null;
  const user = userId
    ? await fetchOne("b24_user_settings", { user_id: userId }, null, false)
    : null;
  const shared = scopeId && String(scopeId) !== roomId
    ? await fetchOne("b24_chat_settings", { chat_id: String(scopeId) }, null, false)
    : room;

  return normalizeGalaxy(selectGalaxyPreference({
    isPrivate: isPrivateChat(ctx),
    roomGalaxy: normalizeGalaxy(room?.galaxy),
    userGalaxy: normalizeGalaxy(user?.galaxy),
    sharedGalaxy: normalizeGalaxy(shared?.galaxy),
    defaultGalaxy
  })) || defaultGalaxy;
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
  const params = new URLSearchParams({ select: options.select || "*" });
  if (options.order) params.set("order", options.order);
  if (options.includeMap !== false) params.set("map_id", `eq.${options.mapId || galaxyToMapId(defaultGalaxy)}`);
  if (options.limit) params.set("limit", String(options.limit));
  Object.entries(filters).forEach(([key, value]) => params.set(key, value));
  return requestRows(table, params);
}

async function fetchRowsWithCount(table, filters, options = {}) {
  const params = new URLSearchParams({ select: options.select || "*" });
  if (options.order) params.set("order", options.order);
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
  const maxRows = options.maxRows || 20000;
  const all = [];
  let count = NaN;
  for (let from = 0; from < maxRows; from += pageSize) {
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

const battleHistoryReader = createBattleHistoryReader(fetchAllRows);

function fetchActiveClaims(galaxy, chatId = "") {
  const filters = {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  };
  if (chatId) filters.chat_id = `eq.${chatId}`;
  return fetchRows("b24_claims", filters, queryOptionsForGalaxy(galaxy, { order: "arrival_at.asc" }));
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
  return fetchRows("b24_incoming", filters, queryOptionsForGalaxy(galaxy, { order: "arrival_at.asc" }));
}

function fetchActiveOperations(galaxy, chatId = "", kind = "all") {
  const filters = {
    status: "eq.active",
    arrival_at: `gt.${new Date().toISOString()}`
  };
  if (chatId) filters.chat_id = `eq.${chatId}`;
  if (kind === "attack" || kind === "defense" || kind === "scout") filters.type = `eq.${kind}`;
  return fetchRows("b24_operations", filters, queryOptionsForGalaxy(galaxy, { order: "arrival_at.asc" }));
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
  }, queryOptionsForGalaxy(galaxy, { order: "arrival_at.asc" }));
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

async function upsertRows(table, rows, conflictColumns, chunkSize = 500) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let saved = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const params = new URLSearchParams({ on_conflict: conflictColumns });
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(chunk)
    });
    if (!response.ok) {
      const details = await response.text();
      console.error(`${table} batch upsert failed`, details);
      throw new Error(`Could not save ${table.replace(/^b24_/, "")} import rows.`);
    }
    saved += chunk.length;
  }
  return saved;
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
  const rows = [];
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
    Markup.button.callback("Stand down", `op:close:${operation.operation_id}`)
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
  }, { ...queryOptionsForGalaxy(galaxy), order: "base_coord.asc" });
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
  const scopeId = await resolveGuildScopeForChat(ctx.chat.id);
  if (!scopeId) return false;
  const galaxy = await galaxyForContext(ctx);
  return upsertRow("b24_user_settings", {
    user_id: telegramUserId(ctx),
    galaxy,
    map_id: galaxyToMapId(galaxy),
    active_chat_id: scopeId,
    active_chat_label: `${primaryGuildId} via ${chatTitle(ctx)}`,
    updated_at: new Date().toISOString()
  }, "user_id");
}

async function operationScopeId(ctx) {
  if (!isPrivateChat(ctx)) return resolveGuildScopeForChat(ctx.chat?.id);
  if (!ctx.from?.id) return "";
  const settings = await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false);
  const activeChatId = settings?.active_chat_id || "";
  if (activeChatId && await isRecognizedGuildScope(activeChatId)) return activeChatId;
  return primaryApprovedScope();
}

async function operationScopeLabel(ctx, scopeId = "") {
  if (!isPrivateChat(ctx)) return `${primaryGuildId} via ${chatTitle(ctx)}`;
  if (!ctx.from?.id) return scopeId || "unknown";
  const settings = await fetchOne("b24_user_settings", { user_id: telegramUserId(ctx) }, null, false);
  if (scopeId && String(settings?.active_chat_id || "") === String(scopeId) && settings?.active_chat_label) {
    return settings.active_chat_label;
  }
  return settings?.active_chat_label || (scopeId ? `${primaryGuildId} operations` : "unknown");
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

function mapUrlForContext(ctx, galaxy, loc = "", chatId = "") {
  const payload = {
    u: telegramUserId(ctx),
    c: String(chatId || chatScopeId(ctx) || ""),
    g: normalizeGalaxy(galaxy) || defaultGalaxy,
    l: loc || "",
    p: "map",
    e: Date.now() + miniAppTokenMinutes * 60 * 1000
  };
  return buildGalaxyMapUrl(webAppUrl, {
    galaxy: payload.g,
    version: botBuild,
    access: signMiniAppToken(miniAppAccessSecret, payload),
    loc
  });
}

function verifyMiniAppAccess(value) {
  return verifyMiniAppToken(miniAppAccessSecret, value);
}

async function importedMiniAppGalaxies() {
  if (importedGalaxyCache.expiresAt > Date.now()) return importedGalaxyCache.value;
  const tables = ["b24_systems", "b24_astros", "b24_bases"];
  const results = await Promise.all(tables.map((table) => fetchAllRows(table, {}, {
    includeMap: false,
    select: "map_id",
    order: "map_id.asc",
    pageSize: 1000,
    maxRows: 100000
  }).catch(() => [])));
  const galaxies = naturalGalaxySort(results.flat().map((row) => row.map_id));
  importedGalaxyCache = { value: galaxies, expiresAt: Date.now() + 5 * 60 * 1000 };
  return galaxies;
}

async function verifiedMiniAppSession(accessToken, allowedPurposes = ["map"], requestedGalaxy = "") {
  const session = verifyMiniAppAccess(accessToken);
  if (!session) return null;
  if (!allowedPurposes.includes(session.p)) return null;
  if (!(await isRecognizedGuildScope(session.c))) return null;
  const member = await fetchAccessMember(session.c, session.u);
  if (!member || member.status !== "active" || !["member", "officer", "owner"].includes(member.role)) return null;
  if (accessChatIds.length && member.access_mode !== "private" &&
      !(await isMemberOfAnyAccessChat({ telegram: bot.telegram }, session.u))) return null;
  const galaxies = await importedMiniAppGalaxies();
  const selectedGalaxy = selectMiniAppGalaxy({
    requestedGalaxy,
    tokenGalaxy: session.g,
    availableGalaxies: galaxies
  });
  if (!selectedGalaxy) return null;
  return { ...session, g: selectedGalaxy, linkGalaxy: session.g, galaxies, member };
}

function createExporterAccess(session) {
  const expiresAt = Date.now() + miniAppExportTokenDays * 24 * 60 * 60 * 1000;
  return {
    access: signMiniAppToken(miniAppAccessSecret, {
      u: session.u,
      c: session.c,
      g: session.g,
      l: "",
      p: "export",
      e: expiresAt
    }),
    expiresAt
  };
}

function miniAppContext(session) {
  return {
    telegram: bot.telegram,
    from: {
      id: session.u,
      username: session.member.username || "",
      first_name: session.member.display_name || `Telegram ${session.u}`
    },
    chat: { id: session.c, type: "group", title: "VisionBot Map" }
  };
}

async function miniAppCoverage(session) {
  const galaxy = session.g;
  const mapId = galaxyToMapId(galaxy);
  const [bases, systems, stances, scoutOperations] = await Promise.all([
    fetchAllRows("b24_bases", {}, { mapId, select: "region_id,coord,guild,label,updated_at", order: "coord.asc" }),
    fetchAllRows("b24_systems", {}, { mapId, select: "region_id,system_id", order: "coord.asc" }),
    fetchStanceMap(galaxy),
    fetchActiveOperations(galaxy, session.c, "scout")
  ]);
  const assignmentEntries = await Promise.all(scoutOperations
    .filter((operation) => scoutAgendaInfo(operation) && /^B\d{2}:\d{1,2}$/.test(String(operation.target_coord || "")))
    .map(async (operation) => {
    const members = await fetchOperationMembers(operation);
    const watch = members.find((member) => member.state !== "withdrawn" && String(member.role || "").toLowerCase() === "watch");
    return [operation.target_coord, watch || null];
  }));
  const watches = new Map(assignmentEntries.filter(([, member]) => member));
  const byRegion = new Map(Array.from({ length: 99 }, (_, index) => [`${galaxy}:${index + 1}`, {
    region: `${galaxy}:${index + 1}`,
    app: false,
    friendly: false,
    enemy: false,
    watchNeeded: false,
    watchAssigned: false,
    watchOwner: "",
    watchOwnerId: "",
    bases: [],
    systems: []
  }]));
  bases.forEach((base) => {
    const region = astroToRegion(base.region_id || base.coord || "");
    const entry = byRegion.get(region);
    if (!entry) return;
    const tag = normalizeStanceTarget(base.guild);
    entry.bases.push({
      coord: base.coord,
      guild: base.guild || "",
      label: base.label || "Unknown owner",
      updatedAt: base.updated_at || ""
    });
    if (tag === primaryGuildTag) entry.app = true;
    else if (stances.tag.get(tag) === "friend") entry.friendly = true;
    else if (tag) entry.enemy = true;
  });
  systems.forEach((system) => {
    const region = astroToRegion(system.region_id || system.system_id || "");
    const entry = byRegion.get(region);
    if (entry && system.system_id) entry.systems.push(String(system.system_id));
  });
  watches.forEach((watch, region) => {
    const entry = byRegion.get(region);
    if (!entry) return;
    entry.watchAssigned = true;
    entry.watchOwner = watch.display_name || "Guild member";
    entry.watchOwnerId = String(watch.user_id || "");
  });
  byRegion.forEach((entry) => {
    entry.watchNeeded = !entry.app && !entry.watchAssigned;
  });
  return [...byRegion.values()];
}

async function miniAppMapState(session) {
  const [sectors, claims, operations, incoming] = await Promise.all([
    miniAppCoverage(session),
    fetchActiveClaims(session.g, session.c),
    fetchActiveOperations(session.g, session.c),
    fetchActiveIncoming(session.g, session.c)
  ]);
  return {
    sectors,
    claims: claims.filter((row) => rowBelongsToMiniAppGalaxy(row, session.g)),
    operations: operations.filter((row) => rowBelongsToMiniAppGalaxy(row, session.g)),
    incoming: incoming.filter((row) => rowBelongsToMiniAppGalaxy(row, session.g))
  };
}

async function updateMiniAppClaim(session, body) {
  const action = String(body.action || "create").toLowerCase();
  const mapId = galaxyToMapId(session.g);
  if (action === "create") {
    const target = normalizeAstro(body.target);
    const arrivalAt = new Date(body.arrivalAt || "");
    if (!target || mapIdForCoord(target) !== mapId) throw new Error(`Choose a target in ${session.g}.`);
    if (!Number.isFinite(arrivalAt.getTime()) || arrivalAt.getTime() <= Date.now()) throw new Error("Choose a future arrival time.");
    const stamp = new Date().toISOString();
    const row = {
      map_id: mapId,
      claim_id: String(body.claimId || randomId()).slice(0, 100),
      target_coord: target,
      region_id: astroToRegion(target),
      system_id: astroToSystem(target),
      claimed_by: session.member.display_name || `Telegram ${session.u}`,
      claimed_by_user_id: session.u,
      chat_id: session.c,
      arrival_at: arrivalAt.toISOString(),
      arrival_label: String(body.arrivalLabel || "").slice(0, 40),
      confirmed_sent: false,
      confirmed_at: null,
      confirmed_by: "",
      fleet_label: "",
      note: String(body.note || "").trim().slice(0, 500),
      status: "active",
      created_at: stamp,
      updated_at: stamp
    };
    if (!(await insertRow("b24_claims", row))) throw new Error("Could not save the claim.");
  } else {
    const claim = await fetchOne("b24_claims", {
      claim_id: String(body.claimId || ""),
      chat_id: session.c
    }, mapId);
    if (!claim) throw new Error("Claim not found in this galaxy.");
    const ownsClaim = String(claim.claimed_by_user_id || "") === session.u;
    if (!ownsClaim && !miniAppOfficer(session)) throw new Error("Only the claimant or an officer can change this claim.");
    const stamp = new Date().toISOString();
    const patch = action === "release"
      ? { status: "cancelled", updated_at: stamp }
      : action === "confirm"
        ? {
          confirmed_sent: Boolean(body.confirmed),
          confirmed_at: body.confirmed ? stamp : null,
          confirmed_by: body.confirmed ? (session.member.display_name || `Telegram ${session.u}`) : "",
          fleet_label: body.confirmed ? String(body.fleetLabel || claim.fleet_label || "").slice(0, 120) : "",
          updated_at: stamp
        }
        : null;
    if (!patch) throw new Error("Unknown claim action.");
    if (!(await updateRows("b24_claims", patch, {
      map_id: `eq.${mapId}`,
      claim_id: `eq.${claim.claim_id}`,
      chat_id: `eq.${session.c}`
    }))) throw new Error("Could not update the claim.");
  }
  return miniAppMapState(session);
}

async function miniAppAttacks(session) {
  const operations = await fetchActiveOperations(session.g, session.c, "attack");
  const claimsByOperation = await fetchClaimsByOperation(operations);
  const role = String(session.member.role || "member").toLowerCase();
  return {
    role,
    canManage: role === "officer" || role === "owner",
    userId: session.u,
    attacks: operations.map((operation, index) => {
      const claims = claimsByOperation.get(operation.operation_id) || [];
      const targets = groupAttackTargets(operation, claims);
      const slots = attackWaveSlots(operation);
      const claimedWaves = targets.reduce((sum, target) => sum + target.claimedWaves, 0);
      const sentWaves = targets.reduce((sum, target) => sum + target.sentWaves, 0);
      return {
        id: operation.operation_id,
        shortId: operation.short_id,
        number: index + 1,
        name: attackDisplayName(operation),
        commander: operation.commander_label || "Unknown",
        commanderUserId: String(operation.commander_user_id || ""),
        arrivalAt: operation.arrival_at,
        waveCount: slots.length,
        targetCount: targets.length,
        claimedWaves,
        sentWaves,
        totalWaves: targets.length * slots.length,
        canManage: role === "officer" || role === "owner" || String(operation.commander_user_id || "") === session.u,
        targets: targets.map((target) => ({
          coord: target.target_coord,
          state: target.state,
          claimedWaves: target.claimedWaves,
          sentWaves: target.sentWaves,
          totalWaves: target.totalWaves,
          waves: slots.map((slot) => {
            const claim = target.byWave.get(String(slot.index));
            const claimedByUserId = String(claim?.claimed_by_user_id || "");
            return {
              index: slot.index,
              label: slot.label,
              arrivalAt: slot.arrivalAt.toISOString(),
              claimId: claim?.claim_id || "",
              state: claim?.confirmed_sent ? "sent" : claimedByUserId ? "claimed" : "open",
              claimedBy: claim?.claimed_by || "",
              claimedByUserId,
              mine: Boolean(claimedByUserId && claimedByUserId === session.u)
            };
          })
        }))
      };
    })
  };
}

async function miniAppFindAttack(session, value) {
  const attacks = await fetchActiveOperations(session.g, session.c, "attack");
  const wanted = String(value || "").toUpperCase();
  return attacks.find((operation) => operation.operation_id === value || String(operation.short_id || "").toUpperCase() === wanted) || null;
}

function miniAppOfficer(session) {
  return session.member.role === "officer" || session.member.role === "owner";
}

async function miniAppClaimWave(session, body) {
  const operation = await miniAppFindAttack(session, body.operationId);
  if (!operation) throw new Error("Attack plan not found or no longer active.");
  const coord = normalizeAstro(body.coord);
  const slot = attackWaveSlots(operation).find((item) => item.index === Number(body.wave));
  if (!coord || !slot) throw new Error("Choose a valid target and wave.");
  const result = await handleTargetClaim(miniAppContext(session), {
    shortId: operation.short_id,
    coord,
    arrivalAt: slot.arrivalAt,
    label: slot.label,
    note: slot.index === 1 ? "wave 1" : `wave +${slot.offsetMinutes}m`
  }, "$", { silent: true });
  if (!result?.ok) throw new Error(result?.message || "Could not claim that wave.");
}

async function miniAppOwnWave(session, body) {
  const operation = await miniAppFindAttack(session, body.operationId);
  if (!operation) throw new Error("Attack plan not found or no longer active.");
  const coord = normalizeAstro(body.coord);
  const slot = attackWaveSlots(operation).find((item) => item.index === Number(body.wave));
  if (!coord || !slot) throw new Error("Choose a valid target and wave.");
  const claims = await fetchOperationClaims(operation);
  const claim = claims.find((row) => row.target_coord === coord && claimWaveIndex(operation, row) === slot.index);
  if (!claim || String(claim.claimed_by_user_id || "") !== session.u) throw new Error("That wave is not claimed by you.");
  return { operation, claim, slot };
}

async function miniAppReleaseWave(session, body) {
  const { operation, claim } = await miniAppOwnWave(session, body);
  if (claim.confirmed_sent) throw new Error("A sent wave cannot be released. Ask an officer to correct it.");
  const stamp = new Date().toISOString();
  const ok = await updateRows("b24_claims", {
    claimed_by: null,
    claimed_by_user_id: null,
    confirmed_sent: false,
    confirmed_at: null,
    confirmed_by: "",
    fleet_label: "",
    updated_at: stamp
  }, {
    map_id: `eq.${operation.map_id}`,
    claim_id: `eq.${claim.claim_id}`,
    claimed_by_user_id: `eq.${session.u}`
  });
  if (!ok) throw new Error("Could not release that wave.");
}

async function miniAppMarkWaveSent(session, body) {
  const { operation, claim } = await miniAppOwnWave(session, body);
  const stamp = new Date().toISOString();
  const ok = await updateRows("b24_claims", {
    confirmed_sent: true,
    confirmed_at: stamp,
    confirmed_by: session.member.display_name || "Guild member",
    fleet_label: String(body.note || "").trim().slice(0, 200),
    updated_at: stamp
  }, {
    map_id: `eq.${operation.map_id}`,
    claim_id: `eq.${claim.claim_id}`,
    claimed_by_user_id: `eq.${session.u}`
  });
  if (!ok) throw new Error("Could not mark that wave sent.");
  await upsertOperationMember(miniAppContext(session), operation, "sent", String(body.note || "").trim().slice(0, 200));
}

async function miniAppCreateAttack(session, body) {
  if (!miniAppOfficer(session)) throw new Error("Officer access is required to create an attack.");
  const name = String(body.name || "").trim().slice(0, 60);
  const waves = Number(body.waves);
  const arrivalAt = new Date(body.arrivalAt);
  const now = Date.now();
  if (!name) throw new Error("Give the attack a name.");
  if (!Number.isInteger(waves) || waves < 1 || waves > 12) throw new Error("Waves must be between 1 and 12.");
  if (!Number.isFinite(arrivalAt.getTime()) || arrivalAt.getTime() <= now || arrivalAt.getTime() > now + 7 * 24 * 60 * 60 * 1000) {
    throw new Error("Landing time must be within the next 7 days.");
  }
  const coords = [...new Set((Array.isArray(body.targets) ? body.targets : extractAstroCoords(String(body.targets || ""), session.g))
    .map(normalizeAstro)
    .filter((coord) => coord && mapIdForCoord(coord) === galaxyToMapId(session.g)))].slice(0, 40);
  const context = miniAppContext(session);
  const operation = operationRow(context, {
    type: "attack",
    targetCoord: coords[0] || "",
    arrivalAt,
    note: attackNote(name, waves),
    chatId: session.c
  });
  operation.map_id = galaxyToMapId(session.g);
  if (!(await insertRow("b24_operations", operation))) throw new Error("Could not create the attack plan.");
  if (coords.length) await addTargetsToAttack(context, operation, coords, `Mini App setup: ${name}`);
}

async function miniAppAddAttackTargets(session, body) {
  if (!miniAppOfficer(session)) throw new Error("Officer access is required to add attack targets.");
  const operation = await miniAppFindAttack(session, body.operationId);
  if (!operation) throw new Error("Attack plan not found or no longer active.");
  const coords = extractAstroCoords(String(body.targets || ""), session.g).slice(0, 40);
  if (!coords.length) throw new Error("Paste at least one full astro coordinate.");
  await addTargetsToAttack(miniAppContext(session), operation, coords, "Mini App target add");
}

async function miniAppStandDownAttack(session, body) {
  const operation = await miniAppFindAttack(session, body.operationId);
  if (!operation) throw new Error("Attack plan not found or no longer active.");
  if (!miniAppOfficer(session) && String(operation.commander_user_id || "") !== session.u) {
    throw new Error("Only the commander or an officer can stand down this attack.");
  }
  const stamp = new Date().toISOString();
  const ok = await updateRows("b24_operations", {
    status: "stood_down",
    updated_at: stamp
  }, {
    map_id: `eq.${operation.map_id}`,
    operation_id: `eq.${operation.operation_id}`,
    chat_id: `eq.${session.c}`
  });
  if (!ok) throw new Error("Could not stand down that attack.");
  await closeLinkedOperationRows(operation, "stood_down");
}

async function updateMiniAppAttack(session, body) {
  const action = String(body.action || "").toLowerCase();
  if (action === "claim") await miniAppClaimWave(session, body);
  else if (action === "release") await miniAppReleaseWave(session, body);
  else if (action === "sent") await miniAppMarkWaveSent(session, body);
  else if (action === "create") await miniAppCreateAttack(session, body);
  else if (action === "add-targets") await miniAppAddAttackTargets(session, body);
  else if (action === "stand-down") await miniAppStandDownAttack(session, body);
  else throw new Error("Unknown attack action.");
  return miniAppAttacks(session);
}

async function miniAppIncoming(session) {
  const rows = await enrichIncomingReports(await fetchActiveIncoming(session.g, session.c), session.g);
  const role = String(session.member.role || "member").toLowerCase();
  return {
    role,
    canManage: role === "officer" || role === "owner",
    userId: session.u,
    incoming: rows.map((row) => {
      const details = incomingNoteParts(row.note);
      const fleetSize = details.size || (String(row.hostile_fleet || "").match(/\bsize\s+([\d,]+)/i) || [])[1] || "";
      const coveredByUserId = String(row.covered_by_user_id || "");
      return {
        id: row.incoming_id,
        operationId: row.operation_id || "",
        operationShortId: row.operation_short_id || "",
        attackerCoord: row.attacker_coord || "",
        defendedCoord: row.defended_coord || "",
        defendedLabel: row.reporter_base_hint || "",
        arrivalAt: row.arrival_at,
        size: fleetSize,
        attackerGuild: details.tag || details.playerTag || "",
        attackerPlayer: details.player || "",
        reporter: row.reported_by || "Unknown",
        reporterUserId: String(row.reported_by_user_id || ""),
        coveredBy: row.covered_by || "",
        coveredByUserId,
        coveredAt: row.covered_at || "",
        mine: Boolean(coveredByUserId && coveredByUserId === session.u),
        note: details.extra || ""
      };
    })
  };
}

async function miniAppBattles(session, coordValue) {
  const normalized = normalizeAstro(coordValue);
  const coord = validateMiniAppHistoryRequest({
    session,
    coord: normalized,
    expectedMapId: session ? galaxyToMapId(session.g) : "",
    coordinateMapId: normalized ? mapIdForCoord(normalized) : ""
  });
  return battleHistoryReader.coordinateHistory({
    authorized: true,
    mapId: galaxyToMapId(session.g),
    chatId: session.c,
    coord,
    limit: 30
  });
}

async function miniAppFindIncoming(session, incomingId) {
  const row = await fetchOne("b24_incoming", {
    incoming_id: String(incomingId || ""),
    chat_id: session.c,
    status: "active"
  }, galaxyToMapId(session.g));
  if (!row || new Date(row.arrival_at).getTime() <= Date.now()) return null;
  return row;
}

async function miniAppReportIncoming(session, body) {
  const reportText = String(body.reportText || "").trim();
  let rows = reportText ? parseIncomingExportRows(reportText, session.g) : [];
  if (!rows.length && reportText) {
    const generic = parseGenericIncomingReport(reportText, session.g);
    if (generic) rows = [generic];
  }
  if (!rows.length) {
    const attackerCoord = normalizeAstro(body.attackerCoord);
    const defendedCoord = normalizeAstro(body.defendedCoord);
    const duration = parseIncomingDuration(body.eta);
    if (!defendedCoord || mapIdForCoord(defendedCoord) !== galaxyToMapId(session.g)) {
      throw new Error(`Enter a defended astro in ${session.g}.`);
    }
    if (body.attackerCoord && (!attackerCoord || mapIdForCoord(attackerCoord) !== galaxyToMapId(session.g))) {
      throw new Error(`Enter an attacker astro in ${session.g}, or leave it blank.`);
    }
    if (!duration || duration.ms < 60 * 1000 || duration.ms > 24 * 60 * 60 * 1000) {
      throw new Error("ETA must be between 1 minute and 24 hours, such as 45 or 1:12:03.");
    }
    const size = String(body.size || "").replace(/[^\d]/g, "").slice(0, 12);
    const note = String(body.note || "").trim().slice(0, 240);
    rows = [{
      galaxy: session.g,
      attackerCoord: attackerCoord || null,
      defendedCoord,
      etaMinutes: Math.max(1, Math.ceil(duration.ms / 60000)),
      arrivalAt: new Date(Date.now() + duration.ms),
      note: [size ? `size ${Number(size).toLocaleString("en-US")}` : "", note].filter(Boolean).join(" | "),
      rawLine: [attackerCoord, defendedCoord, body.eta, size, note].filter(Boolean).join(" ")
    }];
  }
  const validRows = rows.filter((row) => {
    const coord = row.defendedCoord || row.attackerCoord || "";
    return coord && mapIdForCoord(coord) === galaxyToMapId(session.g);
  }).slice(0, 100);
  if (!validRows.length) throw new Error(`No valid ${session.g} incoming rows were found.`);
  const saved = await insertIncomingRows(miniAppContext(session), validRows, session.c);
  if (!saved) throw new Error("Could not save the incoming report.");
}

async function miniAppCoverIncoming(session, body) {
  const row = await miniAppFindIncoming(session, body.incomingId);
  if (!row) throw new Error("Incoming report not found or has already landed.");
  if (row.covered_by_user_id && String(row.covered_by_user_id) !== session.u) {
    throw new Error(`Already covered by ${row.covered_by || "another member"}.`);
  }
  const stamp = new Date().toISOString();
  const ok = await updateRows("b24_incoming", {
    covered_by: session.member.display_name || `Telegram ${session.u}`,
    covered_by_user_id: session.u,
    covered_at: stamp,
    updated_at: stamp
  }, {
    map_id: `eq.${row.map_id}`,
    incoming_id: `eq.${row.incoming_id}`,
    chat_id: `eq.${session.c}`,
    covered_by_user_id: "is.null"
  });
  if (!ok) throw new Error("Could not save defense coverage.");
  const saved = await miniAppFindIncoming(session, row.incoming_id);
  if (String(saved?.covered_by_user_id || "") !== session.u) {
    throw new Error(`Already covered by ${saved?.covered_by || "another member"}.`);
  }
}

async function miniAppReleaseIncoming(session, body) {
  const row = await miniAppFindIncoming(session, body.incomingId);
  if (!row) throw new Error("Incoming report not found or has already landed.");
  if (String(row.covered_by_user_id || "") !== session.u) throw new Error("Only the assigned defender can release this coverage.");
  const ok = await updateRows("b24_incoming", {
    covered_by: null,
    covered_by_user_id: null,
    covered_at: null,
    updated_at: new Date().toISOString()
  }, {
    map_id: `eq.${row.map_id}`,
    incoming_id: `eq.${row.incoming_id}`,
    chat_id: `eq.${session.c}`,
    covered_by_user_id: `eq.${session.u}`
  });
  if (!ok) throw new Error("Could not release defense coverage.");
}

async function miniAppClearIncoming(session, body) {
  if (!miniAppOfficer(session)) throw new Error("Officer access is required to clear an incoming report.");
  const row = await miniAppFindIncoming(session, body.incomingId);
  if (!row) throw new Error("Incoming report not found or has already landed.");
  const stamp = new Date().toISOString();
  const ok = await updateRows("b24_incoming", {
    status: "false_report",
    updated_at: stamp
  }, {
    map_id: `eq.${row.map_id}`,
    incoming_id: `eq.${row.incoming_id}`,
    chat_id: `eq.${session.c}`
  });
  if (!ok) throw new Error("Could not clear the incoming report.");
  if (row.operation_id) {
    const operation = await findOperationById(row.operation_id);
    if (operation) {
      await updateRows("b24_operations", {
        status: "stood_down",
        note: row.note ? `${row.note} | Incoming cleared from Mini App` : "Incoming cleared from Mini App",
        updated_at: stamp
      }, {
        map_id: `eq.${operation.map_id}`,
        operation_id: `eq.${operation.operation_id}`
      });
      await updateRows("b24_scheduled_notifications", {
        cancelled_at: stamp,
        updated_at: stamp
      }, {
        map_id: `eq.${operation.map_id}`,
        operation_id: `eq.${operation.operation_id}`,
        sent_at: "is.null"
      });
    }
  }
}

async function updateMiniAppIncoming(session, body) {
  const action = String(body.action || "").toLowerCase();
  if (action === "report") await miniAppReportIncoming(session, body);
  else if (action === "cover") await miniAppCoverIncoming(session, body);
  else if (action === "release") await miniAppReleaseIncoming(session, body);
  else if (action === "clear") await miniAppClearIncoming(session, body);
  else throw new Error("Unknown incoming action.");
  return miniAppIncoming(session);
}

async function miniAppScouting(session) {
  const role = String(session.member.role || "member").toLowerCase();
  const grouped = groupScoutAgendas(await fetchScoutAgendas(session.g, session.c));
  const agendas = await Promise.all(grouped.map(async (agenda) => {
    const assignments = await scoutAgendaAssignments(agenda);
    const targets = agenda.operations.map((operation) => {
      const assignment = assignments.get(operation.operation_id);
      const assignedUserId = String(assignment?.user_id || "");
      return {
        operationId: operation.operation_id,
        coord: operation.target_coord || "",
        assigned: Boolean(assignment),
        assignedTo: assignment?.display_name || "",
        assignedUserId,
        mine: Boolean(assignedUserId && assignedUserId === session.u)
      };
    });
    return {
      key: agenda.key,
      name: agenda.name,
      kind: scoutAgendaTargetKind(agenda),
      targetCount: targets.length,
      assignedCount: targets.filter((target) => target.assigned).length,
      openCount: targets.filter((target) => !target.assigned).length,
      targets
    };
  }));
  return {
    role,
    canManage: role === "officer" || role === "owner",
    userId: session.u,
    agendas,
    myWatches: agendas.flatMap((agenda) => agenda.targets
      .filter((target) => target.mine)
      .map((target) => ({ agendaKey: agenda.key, agendaName: agenda.name, kind: agenda.kind, coord: target.coord, operationId: target.operationId })))
  };
}

async function miniAppScoutOperation(session, operationId) {
  const operation = await fetchOne("b24_operations", {
    operation_id: String(operationId || ""),
    chat_id: session.c,
    type: "scout",
    status: "active"
  }, galaxyToMapId(session.g));
  return operation && scoutAgendaInfo(operation) ? operation : null;
}

async function miniAppTakeScoutWatch(session, body) {
  const operation = await miniAppScoutOperation(session, body.operationId);
  if (!operation) throw new Error("Scout target not found or no longer active.");
  const members = await fetchOperationMembers(operation);
  const assigned = members.find((member) => member.state !== "withdrawn" && String(member.role || "").toLowerCase() === "watch");
  if (assigned && String(assigned.user_id || "") !== session.u) {
    throw new Error(`Already watched by ${assigned.display_name || "another member"}.`);
  }
  if (!(await upsertOperationMember(miniAppContext(session), operation, "joined", "watch"))) {
    throw new Error("Could not save that watch assignment.");
  }
}

async function miniAppReleaseScoutWatch(session, body) {
  const operation = await miniAppScoutOperation(session, body.operationId);
  if (!operation) throw new Error("Scout target not found or no longer active.");
  const members = await fetchOperationMembers(operation);
  const assigned = members.find((member) => member.state !== "withdrawn" && String(member.role || "").toLowerCase() === "watch");
  if (!assigned || String(assigned.user_id || "") !== session.u) {
    throw new Error("Only the assigned watcher can release this target.");
  }
  if (!(await upsertOperationMember(miniAppContext(session), operation, "withdrawn", "watch released"))) {
    throw new Error("Could not release that watch assignment.");
  }
}

function miniAppScoutTargets(session, body) {
  const kind = String(body.kind || "base").toLowerCase() === "region" ? "region" : "base";
  const raw = Array.isArray(body.targets) ? body.targets.join(" ") : String(body.targets || "");
  if (kind === "base") {
    return [...new Set(extractAstroCoords(raw, session.g))]
      .filter((coord) => mapIdForCoord(coord) === galaxyToMapId(session.g))
      .slice(0, 250);
  }
  const matches = raw.toUpperCase().match(/B\d{2}:\d{1,2}/g) || [];
  return [...new Set(matches.map((value) => parseRegion(value, session.g)).filter(Boolean))].slice(0, 99);
}

async function miniAppCreateScoutAgenda(session, body) {
  if (!miniAppOfficer(session)) throw new Error("Officer access is required to create a scouting agenda.");
  const kind = String(body.kind || "base").toLowerCase() === "region" ? "region" : "base";
  let targets = miniAppScoutTargets(session, body);
  if (kind === "region" && !targets.length) {
    const coverage = await miniAppCoverage(session);
    targets = coverage.filter((region) => region.watchNeeded).map((region) => region.region);
  }
  if (!targets.length) throw new Error(kind === "region" ? "No uncovered regions were found." : "Paste at least one full base coordinate.");
  const name = String(body.name || (kind === "region" ? `${session.g} Region Coverage` : "Scout Watch")).trim().slice(0, 48);
  const key = newScoutAgendaKey();
  const arrivalAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  const context = miniAppContext(session);
  const rows = targets.map((targetCoord) => {
    const operation = operationRow(context, {
      type: "scout",
      targetCoord,
      arrivalAt,
      note: scoutAgendaNote(key, name),
      chatId: session.c
    });
    operation.map_id = galaxyToMapId(session.g);
    return operation;
  });
  const saved = await upsertRows("b24_operations", rows, "map_id,operation_id", 250);
  if (saved !== rows.length) throw new Error("Some scouting targets could not be saved.");
}

async function miniAppCancelScoutAgenda(session, body) {
  if (!miniAppOfficer(session)) throw new Error("Officer access is required to cancel a scouting agenda.");
  const agenda = await findScoutAgenda(session.g, session.c, body.agendaKey);
  if (!agenda) throw new Error("Scouting agenda not found.");
  const stamp = new Date().toISOString();
  const outcomes = await Promise.all(agenda.operations.map((operation) => updateRows("b24_operations", {
    status: "stood_down",
    updated_at: stamp
  }, {
    map_id: `eq.${operation.map_id}`,
    operation_id: `eq.${operation.operation_id}`,
    chat_id: `eq.${session.c}`
  })));
  if (outcomes.some((outcome) => !outcome)) throw new Error("Some scouting targets could not be cancelled.");
}

async function miniAppAttackFromScoutAgenda(session, body) {
  if (!miniAppOfficer(session)) throw new Error("Officer access is required to create an attack.");
  const agenda = await findScoutAgenda(session.g, session.c, body.agendaKey);
  if (!agenda || scoutAgendaTargetKind(agenda) !== "base") throw new Error("Exact-base scouting agenda not found.");
  const hours = Math.max(1, Math.min(4, Number(body.hours) || 4));
  const coords = agenda.operations.map((operation) => operation.target_coord).filter(Boolean);
  const arrivalAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const context = miniAppContext(session);
  const operation = operationRow(context, {
    type: "attack",
    targetCoord: coords[0] || "",
    arrivalAt,
    note: attackNote(`${agenda.name} Attack`, 4),
    chatId: session.c
  });
  operation.map_id = galaxyToMapId(session.g);
  if (!(await insertRow("b24_operations", operation))) throw new Error("Could not create the attack plan.");
  await addTargetsToAttack(context, operation, coords, `from scouting agenda ${agenda.key}`);
}

async function updateMiniAppScouting(session, body) {
  const action = String(body.action || "").toLowerCase();
  if (action === "take") await miniAppTakeScoutWatch(session, body);
  else if (action === "release") await miniAppReleaseScoutWatch(session, body);
  else if (action === "create") await miniAppCreateScoutAgenda(session, body);
  else if (action === "cancel") await miniAppCancelScoutAgenda(session, body);
  else if (action === "create-attack") await miniAppAttackFromScoutAgenda(session, body);
  else throw new Error("Unknown scouting action.");
  return miniAppScouting(session);
}

async function miniAppIntel(session, regionValue = "") {
  const region = parseRegion(regionValue || `${session.g}:1`, session.g) || `${session.g}:1`;
  const mapId = galaxyToMapId(session.g);
  const [systems, astros, bases, stances] = await Promise.all([
    fetchAllRows("b24_systems", { region_id: `eq.${region}` }, { mapId, order: "coord.asc" }),
    fetchAllRows("b24_astros", { region_id: `eq.${region}` }, { mapId, order: "coord.asc" }),
    fetchAllRows("b24_bases", { region_id: `eq.${region}` }, { mapId, order: "coord.asc" }),
    fetchRows("b24_stances", {}, { mapId, order: "scope_type.asc,scope_value.asc", limit: 1000 }).catch(() => [])
  ]);
  return {
    region,
    systems: systems.map((row) => ({ coord: row.coord, systemId: row.system_id, updatedAt: row.updated_at })),
    astros: astros.map((row) => ({
      coord: row.coord,
      systemId: row.system_id,
      astroNo: row.astro_no,
      terrain: row.terrain || "",
      type: row.astro_type || "",
      attributes: Array.isArray(row.attributes) ? row.attributes : [],
      hasBase: Boolean(row.has_base),
      updatedAt: row.updated_at
    })),
    bases: bases.map((row) => ({ coord: row.coord, systemId: row.system_id, guild: row.guild || "", label: row.label || "", updatedAt: row.updated_at })),
    stances: stances.map((row) => ({ type: row.scope_type, value: row.scope_value, stance: row.stance }))
  };
}

function stableMiniAppImportId(parts) {
  return createHmac("sha256", miniAppAccessSecret).update(parts.join("|")).digest("hex").slice(0, 24);
}

function miniAppPageTimestamp(text) {
  const match = String(text || "").match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4}),\s+(\d{2}):(\d{2}):(\d{2})\b/i);
  if (!match) return new Date();
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase());
  const value = new Date(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
  return Number.isFinite(value.getTime()) ? value : new Date();
}

function miniAppDurationMs(value) {
  const parts = String(value || "").split(":").map(Number);
  if (!parts.length || parts.length > 3 || !parts.every(Number.isFinite)) return 0;
  if (parts.length === 3) return (((parts[0] * 60) + parts[1]) * 60 + parts[2]) * 1000;
  if (parts.length === 2) return ((parts[0] * 60) + parts[1]) * 60000;
  return parts[0] * 60000;
}

function miniAppGuildTag(value) {
  const match = String(value || "").replace(/\\([\[\]])/g, "$1").match(/\[([^\]]{1,24})\]/);
  return match ? normalizeStanceTarget(match[1]) : "";
}

function miniAppMovementRows(payload, sourceText, session) {
  const observedAt = miniAppPageTimestamp(sourceText);
  return (Array.isArray(payload.fleetMovements) ? payload.fleetMovements : []).map((row) => {
    const coord = normalizeAstro(row.defendedCoord || row.destinationCoord || row.coord);
    const duration = miniAppDurationMs(row.eta || row.etaText || "");
    const suppliedArrival = new Date(row.arrivalAt || row.arrival_at || "");
    const arrival = Number.isFinite(suppliedArrival.getTime()) ? suppliedArrival : new Date(observedAt.getTime() + duration);
    if (!coord || mapIdForCoord(coord) !== galaxyToMapId(session.g) || !duration || arrival <= observedAt) return null;
    const fleetId = String(row.fleetId || "").replace(/\D/g, "").slice(0, 40);
    const playerId = String(row.playerId || "").replace(/\D/g, "").slice(0, 40);
    const guild = miniAppGuildTag(row.guild || row.player || row.rawLine);
    return {
      movementId: `move-${stableMiniAppImportId([fleetId, coord, arrival.toISOString(), row.player || ""])}`,
      server: String(row.server || "Borealis").slice(0, 80), fleetId, fleetName: String(row.fleetName || "").slice(0, 240),
      playerId, player: String(row.player || "").replace(/^\[[^\]]+\]\s*/, "").slice(0, 160), guild,
      destinationCoord: coord, arrivalAt: arrival.toISOString(), etaSeconds: Math.round(duration / 1000),
      size: finiteNumberOrNull(String(row.size || "").replace(/,/g, "")), sourceKind: String(row.sourceKind || "scanner").slice(0, 40),
      observedAt: observedAt.toISOString(), rawLine: String(row.rawLine || "").slice(0, 4000)
    };
  }).filter(Boolean).slice(0, 5000);
}

function miniAppSplitBattleReports(text) {
  const raw = String(text || "");
  const matches = [...raw.matchAll(/Battle Report\s*\r?\nLocation\b/gi)];
  return matches.map((match, index) => raw.slice(match.index, matches[index + 1]?.index ?? raw.length));
}

function miniAppLabeled(lines, label, start = 0, end = lines.length) {
  const pattern = new RegExp(`^${label}(?:\\s+|$)`, "i");
  const line = lines.slice(start, end).find((item) => pattern.test(item));
  return line ? line.replace(pattern, "").trim() : "";
}

function miniAppBattleParty(lines, start, end) {
  const playerText = miniAppLabeled(lines, "Player", start, end);
  const match = playerText.match(/^(.*?)\s+lvl\s+([\d.]+)$/i);
  const identity = (match?.[1] || playerText).replace(/^\[|\]$/g, "").trim();
  const guild = miniAppGuildTag(identity);
  const fleetText = miniAppLabeled(lines, "Fleet Name", start, end);
  return {
    guild,
    player: identity.replace(/^\[[^\]]+\]\s*/, "").trim(),
    level: finiteNumberOrNull(match?.[2]),
    fleet: fleetText.replace(/\s*\(Destroyed\)\s*/i, "").trim(),
    destroyed: /\(Destroyed\)/i.test(fleetText),
    commandCenters: finiteNumberOrNull(miniAppLabeled(lines, "Command Centers", start, end)),
    startDefenses: finiteNumberOrNull(miniAppLabeled(lines, "Start Defenses", start, end).replace(/%$/, "")),
    endDefenses: finiteNumberOrNull(miniAppLabeled(lines, "End Defenses", start, end).replace(/%$/, ""))
  };
}

function miniAppBattleUnits(lines, start, end) {
  return lines.slice(start, end).map((line) => {
    const match = line.match(/^(.+?)\s+([\d,.?]+)\s+([\d,.?]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/);
    return match ? { unit: match[1].trim(), start: finiteNumberOrNull(match[2]?.replace(/,/g, "")), end: finiteNumberOrNull(match[3]?.replace(/,/g, "")), attack: finiteNumberOrNull(match[4]), armour: finiteNumberOrNull(match[5]), shield: finiteNumberOrNull(match[6]) } : null;
  }).filter(Boolean);
}

function miniAppBattleReportsFromText(text, galaxy) {
  return miniAppSplitBattleReports(text).map((raw) => {
    const lines = raw.replace(/\*\*/g, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const attackHeaders = lines.map((line, index) => line.toLowerCase() === "attack force" ? index : -1).filter((index) => index >= 0);
    const defenseHeaders = lines.map((line, index) => line.toLowerCase() === "defensive force" ? index : -1).filter((index) => index >= 0);
    const coord = normalizeAstro((raw.match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "i")) || [])[0]);
    if (!coord || attackHeaders.length < 2 || defenseHeaders.length < 2) return null;
    const attacker = miniAppBattleParty(lines, attackHeaders[0] + 1, defenseHeaders[0]);
    const defender = miniAppBattleParty(lines, defenseHeaders[0] + 1, attackHeaders[1]);
    const attackerUnits = miniAppBattleUnits(lines, attackHeaders[1] + 1, defenseHeaders[1]);
    const defenderUnits = miniAppBattleUnits(lines, defenseHeaders[1] + 1, lines.length);
    const destroyed = raw.match(/Total cost of units destroyed:\s*([\d,]+)\s*\(\s*Attacker:\s*([\d,]+)\s*;\s*Defender:\s*([\d,]+)/i);
    const loot = raw.match(/Loot:\s*\(\s*Attacker:\s*([+\-]?[\d,]+)\s*;\s*Defender:\s*([+\-]?[\d,]+)/i);
    const experience = raw.match(/Experience:\s*\(\s*Attacker:\s*([+\-]?[\d,]+)\s*;\s*Defender:\s*([+\-]?[\d,]+)/i);
    const occupied = /attacker conquered the base/i.test(raw);
    const battleTime = miniAppLabeled(lines, "Time");
    if (!battleTime || !/Total cost of units destroyed|New debris in space|conquered the base/i.test(raw)) return null;
    const attackerEnd = attackerUnits.reduce((sum, row) => sum + (row.end || 0), 0);
    const defenderEnd = defenderUnits.reduce((sum, row) => sum + (row.end || 0), 0);
    return { complete: true, server: miniAppLabeled(lines, "Server"), coord, locationLabel: miniAppLabeled(lines, "Location").replace(coord, "").replace(/[()]/g, "").trim(), battleTime, attacker, defender, attackerUnits, defenderUnits, totals: { destroyed: finiteNumberOrNull(destroyed?.[1]?.replace(/,/g, "")), attackerDestroyed: finiteNumberOrNull(destroyed?.[2]?.replace(/,/g, "")), defenderDestroyed: finiteNumberOrNull(destroyed?.[3]?.replace(/,/g, "")), attackerLoot: finiteNumberOrNull(loot?.[1]?.replace(/,/g, "")), defenderLoot: finiteNumberOrNull(loot?.[2]?.replace(/,/g, "")), attackerExperience: finiteNumberOrNull(experience?.[1]?.replace(/,/g, "")), defenderExperience: finiteNumberOrNull(experience?.[2]?.replace(/,/g, "")), debris: finiteNumberOrNull((raw.match(/New debris in space:\s*([\d,]+)/i) || [])[1]?.replace(/,/g, "")), pillage: finiteNumberOrNull((raw.match(/got\s+([\d,]+)\s+credits for pillaging/i) || [])[1]?.replace(/,/g, "")) }, occupied, liberated: false, outcome: occupied ? "occupied" : (!attackerEnd && !defenderEnd ? "mutual_destruction" : attackerEnd && !defenderEnd ? "attacker_win" : !attackerEnd && defenderEnd ? "defender_win" : "inconclusive"), resultText: raw.slice(-2000), rawReport: raw };
  }).filter(Boolean);
}

function miniAppFleetObservationFromText(text, sourceUrl, galaxy) {
  const raw = String(text || "");
  if (!/Fleet Size:\s*[\d,]+/i.test(raw) || !/\bUnits\b/i.test(raw)) return [];
  const coord = normalizeAstro((raw.match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "i")) || [])[0]);
  const fleetId = (String(sourceUrl || "").match(/[?&]fleet=(\d+)/i) || [])[1] || "";
  const fleetName = (raw.match(/\b(Fleet\s+\d+)(?:\s+-|\b)/i) || [])[1] || "";
  const size = finiteNumberOrNull((raw.match(/Fleet Size:\s*([\d,]+)/i) || [])[1]?.replace(/,/g, ""));
  const detectionSeconds = finiteNumberOrNull((raw.match(/Detection time:\s*(\d+)s/i) || [])[1]);
  const unitBlock = raw.split(/\bUnits\b/i)[1]?.split(/Fleet Size:/i)[0] || "";
  const units = unitBlock.split(/\r?\n/).map((line) => {
    const match = line.replace(/\*\*/g, "").trim().match(/^(.+?)\s+([\d,]+)$/);
    return match ? { unit: match[1].trim(), quantity: finiteNumberOrNull(match[2].replace(/,/g, "")) } : null;
  }).filter(Boolean).slice(0, 100);
  const observedAt = miniAppPageTimestamp(raw).toISOString();
  return [{
    observationId: `fleet-${stableMiniAppImportId([fleetId, coord, observedAt, size])}`,
    server: (raw.match(/Server\s+([A-Za-z][A-Za-z0-9 _-]+)/i) || [])[1] || "Borealis",
    fleetId, fleetName, coord, size, units, detectionSeconds,
    sourceKind: "fleet_overview", observedAt, rawLine: raw.slice(0, 4000)
  }];
}

function miniAppOccupationRowsFromText(text, sourceUrl, galaxy) {
  const raw = String(text || "");
  const coord = normalizeAstro((raw.match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "i")) || [])[0]);
  if (!coord) return [];
  const observedAt = miniAppPageTimestamp(raw).toISOString();
  const server = (raw.match(/Server\s+([A-Za-z][A-Za-z0-9 _-]+)/i) || [])[1] || "Borealis";
  if (/\bRevolt Successful\b/i.test(raw)) {
    return [{ coord, server, state: "liberated", revoltState: "successful", observedAt, resolvedAt: observedAt, sourceKind: "revolt_page" }];
  }
  const revoltIndex = raw.search(/Revolt\s*\(you must destroy occupier's fleet first\)/i);
  if (revoltIndex < 0) return [];
  const nearbyLines = raw.slice(Math.max(0, revoltIndex - 3000), revoltIndex).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  const playerLine = nearbyLines.find((line) => /\[[^\]]+\].*\b[\d,]+\s*$/.test(line)) || "";
  const fleetMatch = playerLine.match(/^(.*?)\s+\[([^\]]+)\]\s+(.+?)\s+([\d,]+)\s*$/);
  const size = finiteNumberOrNull(fleetMatch?.[4]?.replace(/,/g, ""));
  return [{
    coord, server, occupierGuild: normalizeStanceTarget(fleetMatch?.[2] || miniAppGuildTag(playerLine)),
    occupierPlayer: String(fleetMatch?.[3] || "").trim().slice(0, 160),
    occupyingFleetName: String(fleetMatch?.[1] || "").trim().slice(0, 240),
    occupyingFleetSize: size, state: "occupied", revoltState: "blocked", observedAt,
    sourceKind: "occupation_page"
  }];
}

function miniAppGameEventsFromText(text, galaxy) {
  const raw = String(text || "");
  const observedAt = miniAppPageTimestamp(raw).toISOString();
  const server = (raw.match(/Server\s+([A-Za-z][A-Za-z0-9 _-]+)/i) || [])[1] || "Borealis";
  const events = [];
  for (const match of raw.matchAll(/Revolt Report[\s\S]*?Revolts at\s+([^\r\n]+?)\s+caused this base occupation to end\./gi)) {
    const coord = normalizeAstro((match[0].match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "i")) || [])[0]);
    events.push({ type: "revolt_success", coord, baseLabel: match[1].trim(), occurredAt: observedAt, server, rawLine: match[0].slice(0, 2000) });
  }
  for (const match of raw.matchAll(/Trade Route Attacked[\s\S]*?(?=Trade Route Attacked|Revolt Report|Battle Report\s*\r?\nLocation|$)/gi)) {
    const coord = normalizeAstro((match[0].match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "i")) || [])[0]);
    events.push({ type: "trade_route_attacked", coord, actorGuild: miniAppGuildTag(match[0]), occurredAt: observedAt, server, rawLine: match[0].slice(0, 2000) });
  }
  return events;
}

async function miniAppImportIntel(session, body) {
  const mapId = galaxyToMapId(session.g);
  const stamp = new Date().toISOString();
  const payload = body.intel && typeof body.intel === "object" ? body.intel : {};
  const sourceText = String(payload.sourceText || "").slice(0, 1000000);
  const sourceUrl = String(payload.sourceUrl || "").slice(0, 2000);
  const stances = await fetchStanceMap(session.g);
  const systems = [...new Map((Array.isArray(payload.systems) ? payload.systems : []).map((row) => {
    const location = normalizeLocation(row.coord || row);
    if (!location || location.galaxy !== session.g || location.coord.split(":").length !== 3) return ["", null];
    return [location.coord, { map_id: mapId, coord: location.coord, region_id: location.region, system_id: location.coord.split(":")[2], updated_at: stamp }];
  }).filter(([coord]) => coord)).values()].slice(0, 10000);
  const bases = [...new Map((Array.isArray(payload.bases) ? payload.bases : []).map((row) => {
    const coord = normalizeAstro(row.coord);
    if (!coord || mapIdForCoord(coord) !== mapId) return ["", null];
    const sourceKind = String(row.sourceKind || row.source_kind || "").trim().toLowerCase();
    const importedGuild = String(row.guild || "").trim();
    const guild = importedGuild || (sourceKind === "personal_base" ? primaryGuildTag : "");
    let label = String(row.label || "")
      .replace(/^\s*\d{1,2}-;-\s*/, " ")
      .replace(coord, " ");
    if (guild) label = label.split(guild).join(" ");
    label = label.replace(/\s+/g, " ").trim();
    if (sourceKind === "personal_base") {
      label = String(session.member.display_name || session.member.username || session.u || "Guild member").trim();
    }
    return [coord, { map_id: mapId, coord, region_id: astroToRegion(coord), system_id: astroToSystem(coord), guild: guild.slice(0, 80), label: label.slice(0, 240), updated_at: stamp }];
  }).filter(([coord]) => coord)).values()].slice(0, 10000);
  const astros = [...new Map((Array.isArray(payload.astros) ? payload.astros : []).map((row) => {
    const coord = normalizeAstro(row.coord);
    if (!coord || mapIdForCoord(coord) !== mapId) return ["", null];
    const attributes = (Array.isArray(row.attributes) ? row.attributes : []).slice(0, 6).map(Number);
    return [coord, { map_id: mapId, coord, region_id: astroToRegion(coord), system_id: astroToSystem(coord), astro_no: coord.split(":")[3], terrain: String(row.terrain || "").slice(0, 40), astro_type: String(row.type || row.astroType || "").slice(0, 40), attributes: attributes.every(Number.isFinite) ? attributes : [], has_base: Boolean(row.hasBase ?? row.has_base), updated_at: stamp }];
  }).filter(([coord]) => coord)).values()].slice(0, 10000);
  const movementRows = miniAppMovementRows(payload, sourceText, session).map((row) => {
    const coordStance = stances.coord.get(row.destinationCoord);
    const tagStance = row.guild ? stances.tag.get(row.guild) : "";
    const classification = coordStance === "enemy" || tagStance === "enemy"
      ? "hostile"
      : coordStance === "friend" || tagStance === "friend" || row.guild === primaryGuildTag
        ? "friendly"
        : "unknown";
    return {
      map_id: mapId,
      movement_id: row.movementId,
      server: row.server,
      fleet_id: row.fleetId || null,
      fleet_name: row.fleetName || null,
      player_id: row.playerId || null,
      player: row.player || null,
      guild: row.guild || null,
      destination_coord: row.destinationCoord,
      destination_region_id: astroToRegion(row.destinationCoord),
      destination_system_id: astroToSystem(row.destinationCoord),
      arrival_at: row.arrivalAt,
      eta_seconds: row.etaSeconds,
      arrival_precision: "countdown",
      size: row.size,
      classification,
      source_kind: row.sourceKind,
      observed_at: row.observedAt,
      raw_line: row.rawLine,
      imported_by: session.member.display_name || "VisionBot exporter",
      imported_by_user_id: session.u,
      chat_id: session.c,
      status: new Date(row.arrivalAt).getTime() > Date.now() ? "active" : "arrived",
      updated_at: stamp
    };
  });
  const manualIncoming = (Array.isArray(payload.incoming) ? payload.incoming : []).map((row) => {
    const defendedCoord = normalizeAstro(row.defendedCoord || row.defended_coord);
    const attackerCoord = normalizeAstro(row.attackerCoord || row.attacker_coord);
    const arrivalAt = new Date(row.arrivalAt || row.arrival_at);
    if (!defendedCoord || mapIdForCoord(defendedCoord) !== mapId || !Number.isFinite(arrivalAt.getTime()) || arrivalAt.getTime() <= Date.now()) return null;
    const sourceId = String(row.incomingId || row.incoming_id || row.fleetId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    return {
      map_id: mapId,
      incoming_id: sourceId ? `scan-${sourceId}` : `scan-${stableMiniAppImportId([defendedCoord, attackerCoord, row.player || "", row.size || "", arrivalAt.toISOString()])}`,
      defended_coord: defendedCoord,
      defended_region_id: astroToRegion(defendedCoord),
      defended_system_id: astroToSystem(defendedCoord),
      attacker_coord: attackerCoord || null,
      region_id: attackerCoord ? astroToRegion(attackerCoord) : null,
      system_id: attackerCoord ? astroToSystem(attackerCoord) : null,
      eta_minutes: Math.max(1, Math.ceil((arrivalAt.getTime() - Date.now()) / 60000)),
      arrival_at: arrivalAt.toISOString(),
      reported_by: session.member.display_name || "VisionBot exporter",
      reported_by_user_id: session.u,
      chat_id: session.c,
      hostile_fleet: String(row.rawLine || "").slice(0, 2000),
      severity: "",
      verified: false,
      note: String(row.note || "").slice(0, 500),
      status: "active",
      updated_at: stamp
    };
  }).filter(Boolean).slice(0, 2000);
  const movementIncoming = movementRows.filter((row) => row.classification === "hostile" && row.status === "active").map((row) => ({
    map_id: mapId,
    incoming_id: `movement-${row.movement_id}`,
    defended_coord: row.destination_coord,
    defended_region_id: row.destination_region_id,
    defended_system_id: row.destination_system_id,
    attacker_coord: null,
    region_id: null,
    system_id: null,
    eta_minutes: Math.max(1, Math.ceil((new Date(row.arrival_at).getTime() - Date.now()) / 60000)),
    arrival_at: row.arrival_at,
    reported_by: session.member.display_name || "VisionBot exporter",
    reported_by_user_id: session.u,
    chat_id: session.c,
    hostile_fleet: row.raw_line || [row.guild, row.player, row.fleet_name].filter(Boolean).join(" "),
    severity: "",
    verified: true,
    note: [row.guild, row.player, row.fleet_name, row.size ? `size ${row.size}` : ""].filter(Boolean).join(" | ").slice(0, 500),
    status: "active",
    updated_at: stamp
  }));
  const incoming = [...new Map([...manualIncoming, ...movementIncoming].map((row) => [row.incoming_id, row])).values()].slice(0, 5000);
  const sourceBattleReports = miniAppBattleReportsFromText(sourceText, session.g);
  const suppliedBattleReports = Array.isArray(payload.battleReports) ? payload.battleReports : [];
  const battleReports = [...suppliedBattleReports, ...sourceBattleReports].map((row) => {
    const coord = normalizeAstro(row.coord);
    if (!coord || mapIdForCoord(coord) !== mapId || !row.complete) return null;
    const rawReport = String(row.rawReport || row.raw_report || "").slice(0, 200000);
    const attacker = row.attacker && typeof row.attacker === "object" ? row.attacker : {};
    const defender = row.defender && typeof row.defender === "object" ? row.defender : {};
    const totals = row.totals && typeof row.totals === "object" ? row.totals : {};
    const reportId = `battle-${stableMiniAppImportId([
      String(row.server || ""),
      coord,
      String(row.battleTime || row.battle_time || ""),
      String(attacker.playerId || attacker.player || ""),
      String(defender.playerId || defender.player || ""),
      rawReport
    ])}`;
    return {
      map_id: mapId,
      report_id: reportId,
      server: String(row.server || "").slice(0, 80),
      coord,
      region_id: astroToRegion(coord),
      system_id: astroToSystem(coord),
      location_label: String(row.locationLabel || row.location_label || "").slice(0, 240),
      battle_time: String(row.battleTime || row.battle_time || "").slice(0, 40),
      attacker_guild: String(attacker.guild || "").slice(0, 80),
      attacker_player: String(attacker.player || "").slice(0, 160),
      attacker_player_id: String(attacker.playerId || "").slice(0, 40),
      attacker_level: finiteNumberOrNull(attacker.level),
      attacker_fleet: String(attacker.fleet || "").slice(0, 240),
      attacker_destroyed: Boolean(attacker.destroyed),
      attacker_command_centers: finiteNumberOrNull(attacker.commandCenters),
      defender_guild: String(defender.guild || "").slice(0, 80),
      defender_player: String(defender.player || "").slice(0, 160),
      defender_player_id: String(defender.playerId || "").slice(0, 40),
      defender_level: finiteNumberOrNull(defender.level),
      defender_fleet: String(defender.fleet || "").slice(0, 240),
      defender_destroyed: Boolean(defender.destroyed),
      defender_command_centers: finiteNumberOrNull(defender.commandCenters),
      start_defenses: finiteNumberOrNull(defender.startDefenses),
      end_defenses: finiteNumberOrNull(defender.endDefenses),
      attacker_units: Array.isArray(row.attackerUnits) ? row.attackerUnits.slice(0, 100) : [],
      defender_units: Array.isArray(row.defenderUnits) ? row.defenderUnits.slice(0, 100) : [],
      destroyed_total: finiteNumberOrNull(totals.destroyed),
      attacker_destroyed_cost: finiteNumberOrNull(totals.attackerDestroyed),
      defender_destroyed_cost: finiteNumberOrNull(totals.defenderDestroyed),
      attacker_loot: finiteNumberOrNull(totals.attackerLoot),
      defender_loot: finiteNumberOrNull(totals.defenderLoot),
      attacker_experience: finiteNumberOrNull(totals.attackerExperience),
      defender_experience: finiteNumberOrNull(totals.defenderExperience),
      debris: finiteNumberOrNull(totals.debris),
      pillage_credits: finiteNumberOrNull(totals.pillage),
      outcome: String(row.outcome || "inconclusive").slice(0, 40),
      occupied: Boolean(row.occupied),
      liberated: Boolean(row.liberated),
      result_text: String(row.resultText || row.result_text || "").slice(0, 2000),
      raw_report: rawReport,
      imported_by: session.member.display_name || "VisionBot importer",
      imported_by_user_id: session.u,
      chat_id: session.c,
      updated_at: stamp
    };
  }).filter(Boolean);
  const uniqueBattleReports = [...new Map(battleReports.map((row) => [row.report_id, row])).values()].slice(0, 500);
  const suppliedObservations = Array.isArray(payload.fleetObservations) ? payload.fleetObservations : [];
  const pageObservations = miniAppFleetObservationFromText(sourceText, sourceUrl, session.g);
  const battleObservations = uniqueBattleReports.flatMap((report) => [
    {
      observationId: `battle-${report.report_id}-attacker`, server: report.server, fleetName: report.attacker_fleet,
      playerId: report.attacker_player_id, player: report.attacker_player, guild: report.attacker_guild,
      coord: report.coord, units: report.attacker_units, destroyed: report.attacker_destroyed,
      side: "attacker", sourceKind: "battle_report", observedAt: report.battle_time, rawLine: report.raw_report
    },
    {
      observationId: `battle-${report.report_id}-defender`, server: report.server, fleetName: report.defender_fleet,
      playerId: report.defender_player_id, player: report.defender_player, guild: report.defender_guild,
      coord: report.coord, units: report.defender_units, destroyed: report.defender_destroyed,
      side: "defender", sourceKind: "battle_report", observedAt: report.battle_time, rawLine: report.raw_report
    }
  ]);
  const fleetObservations = [...suppliedObservations, ...pageObservations, ...battleObservations].map((row) => {
    const coord = normalizeAstro(row.coord);
    if (coord && mapIdForCoord(coord) !== mapId) return null;
    const observedDate = new Date(row.observedAt || row.observed_at || stamp);
    const observedAt = Number.isFinite(observedDate.getTime()) ? observedDate.toISOString() : stamp;
    const observationId = String(row.observationId || row.observation_id || "") || `obs-${stableMiniAppImportId([row.server || "", row.fleetId || "", row.fleetName || "", coord || "", observedAt, row.side || ""])}`;
    return {
      map_id: mapId, observation_id: observationId.slice(0, 100), server: String(row.server || "Borealis").slice(0, 80),
      fleet_id: String(row.fleetId || row.fleet_id || "").slice(0, 40) || null,
      fleet_name: String(row.fleetName || row.fleet_name || "").slice(0, 240) || null,
      player_id: String(row.playerId || row.player_id || "").slice(0, 40) || null,
      player: String(row.player || "").slice(0, 160) || null, guild: String(row.guild || "").slice(0, 80) || null,
      coord: coord || null, size: finiteNumberOrNull(row.size), units: Array.isArray(row.units) ? row.units.slice(0, 100) : [],
      detection_seconds: finiteNumberOrNull(row.detectionSeconds || row.detection_seconds), destroyed: Boolean(row.destroyed),
      side: String(row.side || "").slice(0, 20) || null, source_kind: String(row.sourceKind || row.source_kind || "observation").slice(0, 40),
      observed_at: observedAt, raw_line: String(row.rawLine || row.raw_line || "").slice(0, 10000),
      imported_by: session.member.display_name || "VisionBot importer", imported_by_user_id: session.u, chat_id: session.c, updated_at: stamp
    };
  }).filter(Boolean);
  const uniqueFleetObservations = [...new Map(fleetObservations.map((row) => [row.observation_id, row])).values()].slice(0, 2000);
  const sourceOccupations = miniAppOccupationRowsFromText(sourceText, sourceUrl, session.g);
  const battleOccupations = uniqueBattleReports.filter((report) => report.occupied || report.liberated).map((report) => ({
    coord: report.coord, server: report.server, ownerGuild: report.defender_guild, ownerPlayer: report.defender_player,
    occupierGuild: report.occupied ? report.attacker_guild : "", occupierPlayer: report.occupied ? report.attacker_player : "",
    state: report.liberated ? "liberated" : "occupied", revoltState: report.liberated ? "successful" : "blocked",
    observedAt: report.battle_time, resolvedAt: report.liberated ? report.battle_time : null, sourceKind: "battle_report"
  }));
  const occupationRows = [...(Array.isArray(payload.occupations) ? payload.occupations : []), ...sourceOccupations, ...battleOccupations].map((row) => {
    const coord = normalizeAstro(row.coord);
    if (!coord || mapIdForCoord(coord) !== mapId) return null;
    const observed = new Date(row.observedAt || row.observed_at || stamp);
    const resolved = row.resolvedAt || row.resolved_at ? new Date(row.resolvedAt || row.resolved_at) : null;
    return {
      map_id: mapId, coord, server: String(row.server || "Borealis").slice(0, 80),
      owner_guild: String(row.ownerGuild || row.owner_guild || "").slice(0, 80) || null,
      owner_player: String(row.ownerPlayer || row.owner_player || "").slice(0, 160) || null,
      occupier_guild: String(row.occupierGuild || row.occupier_guild || "").slice(0, 80) || null,
      occupier_player: String(row.occupierPlayer || row.occupier_player || "").slice(0, 160) || null,
      occupier_player_id: String(row.occupierPlayerId || row.occupier_player_id || "").slice(0, 40) || null,
      occupying_fleet_id: String(row.occupyingFleetId || row.occupying_fleet_id || "").slice(0, 40) || null,
      occupying_fleet_name: String(row.occupyingFleetName || row.occupying_fleet_name || "").slice(0, 240) || null,
      occupying_fleet_size: finiteNumberOrNull(row.occupyingFleetSize || row.occupying_fleet_size),
      state: ["occupied", "occupier_destroyed", "unresolved", "liberated"].includes(row.state) ? row.state : "unresolved",
      revolt_state: ["blocked", "available", "successful", "unknown"].includes(row.revoltState || row.revolt_state) ? (row.revoltState || row.revolt_state) : "unknown",
      observed_at: Number.isFinite(observed.getTime()) ? observed.toISOString() : stamp,
      resolved_at: resolved && Number.isFinite(resolved.getTime()) ? resolved.toISOString() : null,
      source_kind: String(row.sourceKind || row.source_kind || "observation").slice(0, 40),
      imported_by: session.member.display_name || "VisionBot importer", imported_by_user_id: session.u, chat_id: session.c, updated_at: stamp
    };
  }).filter(Boolean);
  const uniqueOccupations = [...new Map(occupationRows.map((row) => [row.coord, row])).values()].slice(0, 1000);
  const sourceEvents = miniAppGameEventsFromText(sourceText, session.g);
  const gameEvents = [...(Array.isArray(payload.gameEvents) ? payload.gameEvents : []), ...sourceEvents].map((row) => {
    const coord = normalizeAstro(row.coord);
    if (coord && mapIdForCoord(coord) !== mapId) return null;
    const occurred = new Date(row.occurredAt || row.occurred_at || stamp);
    const occurredAt = Number.isFinite(occurred.getTime()) ? occurred.toISOString() : stamp;
    const eventId = String(row.eventId || row.event_id || "") || `event-${stableMiniAppImportId([row.type || row.event_type || "", coord || "", row.baseLabel || "", occurredAt, row.rawLine || ""])}`;
    return {
      map_id: mapId, event_id: eventId.slice(0, 100), server: String(row.server || "Borealis").slice(0, 80),
      event_type: String(row.type || row.event_type || "event").slice(0, 60), coord: coord || null,
      base_label: String(row.baseLabel || row.base_label || "").slice(0, 240) || null,
      actor_guild: String(row.actorGuild || row.actor_guild || "").slice(0, 80) || null,
      actor_player: String(row.actorPlayer || row.actor_player || "").slice(0, 160) || null,
      occurred_at: occurredAt, raw_line: String(row.rawLine || row.raw_line || "").slice(0, 10000),
      imported_by: session.member.display_name || "VisionBot importer", imported_by_user_id: session.u, chat_id: session.c, updated_at: stamp
    };
  }).filter(Boolean);
  const uniqueGameEvents = [...new Map(gameEvents.map((row) => [row.event_id, row])).values()].slice(0, 2000);
  const [systemCount, baseCount, astroCount, movementCount, incomingCount, battleReportCount, observationCount, occupationCount, gameEventCount] = await Promise.all([
    upsertRows("b24_systems", systems, "map_id,coord"),
    upsertRows("b24_bases", bases, "map_id,coord"),
    upsertRows("b24_astros", astros, "map_id,coord"),
    upsertRows("b24_fleet_movements", movementRows, "map_id,movement_id"),
    upsertRows("b24_incoming", incoming, "map_id,incoming_id"),
    upsertRows("b24_battle_reports", uniqueBattleReports, "map_id,report_id"),
    upsertRows("b24_fleet_observations", uniqueFleetObservations, "map_id,observation_id"),
    upsertRows("b24_occupations", uniqueOccupations, "map_id,coord"),
    upsertRows("b24_game_events", uniqueGameEvents, "map_id,event_id")
  ]);
  return {
    systems: systemCount, bases: baseCount, astros: astroCount, fleetMovements: movementCount,
    incoming: incomingCount, battleReports: battleReportCount, fleetObservations: observationCount,
    occupations: occupationCount, gameEvents: gameEventCount
  };
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return value === null || value === "" || !Number.isFinite(number) ? null : number;
}

async function ensureMiniAppRegionOperation(session, region) {
  const normalizedRegion = `${session.g}:${Number(String(region || "").split(":")[1])}`;
  if (!/^B\d{2}:(?:[1-9]|[1-9]\d)$/.test(normalizedRegion)) return null;
  const agendaName = `${session.g} Region Coverage`;
  const agendas = groupScoutAgendas(await fetchScoutAgendas(session.g, session.c));
  let agenda = agendas.find((item) => item.name === agendaName) || null;
  let operation = agenda?.operations.find((item) => item.target_coord === normalizedRegion) || null;
  if (operation) return operation;
  const context = miniAppContext(session);
  operation = operationRow(context, {
    type: "scout",
    targetCoord: normalizedRegion,
    arrivalAt: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
    note: scoutAgendaNote(agenda?.key || newScoutAgendaKey(), agendaName),
    chatId: session.c
  });
  operation.map_id = galaxyToMapId(session.g);
  if (!(await insertRow("b24_operations", operation))) return null;
  return operation;
}

async function updateMiniAppWatch(session, region, action) {
  const operation = await ensureMiniAppRegionOperation(session, region);
  if (!operation) throw new Error("Invalid watch region");
  const existing = (await fetchOperationMembers(operation))
    .find((member) => member.state !== "withdrawn" && String(member.role || "").toLowerCase() === "watch");
  if (action === "release") {
    if (!existing || String(existing.user_id) !== session.u) throw new Error("Only the assigned watcher can release this region");
    await upsertOperationMember(miniAppContext(session), operation, "withdrawn");
    return;
  }
  if (existing && String(existing.user_id) !== session.u) throw new Error(`${existing.display_name || "Another member"} is already watching this region`);
  await upsertOperationMember(miniAppContext(session), operation, "joined", "watch");
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    // Signed access tokens, not the browser origin, authorize these requests.
    // The exporter runs on Astro Empires while the Mini App runs on GitHub Pages.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request, maxBytes = 16 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
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
  if (command) return `${text[0]}${command} [arguments redacted]`;
  return `[non-command message: ${text.length} chars]`;
}

const webhookHandler = webhookUrl ? bot.webhookCallback(webhookPath) : null;

http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  const path = url.pathname;
  if (request.method === "OPTIONS" && path.startsWith("/api/miniapp/")) {
    return writeJson(response, 204, {});
  }
  if (path === "/api/miniapp/session" && request.method === "GET") {
    try {
      const session = await verifiedMiniAppSession(url.searchParams.get("access"), ["map"], url.searchParams.get("galaxy"));
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, {
        galaxy: session.g,
        galaxies: session.galaxies,
        chatId: session.c,
        userId: session.u,
        displayName: session.member.display_name || "Guild member",
        role: session.member.role || "member",
        expiresAt: Number(session.e)
      });
    } catch (error) {
      console.error("Mini app session lookup failed", error?.message || error);
      return writeJson(response, 500, { error: "Could not verify map access." });
    }
  }
  if (path === "/api/miniapp/export-token" && request.method === "POST") {
    try {
      const body = await readJson(request, 16 * 1024);
      const session = await verifiedMiniAppSession(body.access, ["map"], body.galaxy);
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, {
        galaxy: session.g,
        ...createExporterAccess(session)
      });
    } catch (error) {
      console.error("Mini app exporter token failed", error?.message || error);
      return writeJson(response, 400, { error: "Could not create an exporter credential." });
    }
  }
  if (path === "/api/miniapp/coverage" && request.method === "GET") {
    try {
      const session = await verifiedMiniAppSession(url.searchParams.get("access"), ["map"], url.searchParams.get("galaxy"));
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await miniAppMapState(session));
    } catch (error) {
      console.error("Mini app coverage lookup failed", error?.message || error);
      return writeJson(response, 500, { error: "Could not load region coverage." });
    }
  }
  if (path === "/api/miniapp/watch" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const session = await verifiedMiniAppSession(body.access, ["map"], body.galaxy);
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      await updateMiniAppWatch(session, body.region, body.action === "release" ? "release" : "take");
      return writeJson(response, 200, await miniAppMapState(session));
    } catch (error) {
      console.error("Mini app watch update failed", error?.message || error);
      return writeJson(response, 400, { error: error?.message || "Could not update this watch." });
    }
  }
  if (path === "/api/miniapp/claims" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const session = await verifiedMiniAppSession(body.access, ["map"], body.galaxy);
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await updateMiniAppClaim(session, body));
    } catch (error) {
      console.error("Mini app claim update failed", error?.message || error);
      return writeJson(response, 400, { error: error?.message || "Could not update the claim." });
    }
  }
  if (path === "/api/miniapp/attacks" && request.method === "GET") {
    try {
      const session = await verifiedMiniAppSession(url.searchParams.get("access"), ["map"], url.searchParams.get("galaxy"));
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await miniAppAttacks(session));
    } catch (error) {
      console.error("Mini app attack lookup failed", error?.message || error);
      return writeJson(response, 500, { error: "Could not load attack plans." });
    }
  }
  if (path === "/api/miniapp/attacks" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const session = await verifiedMiniAppSession(body.access, ["map"], body.galaxy);
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await updateMiniAppAttack(session, body));
    } catch (error) {
      console.error("Mini app attack update failed", error?.message || error);
      return writeJson(response, 400, { error: error?.message || "Could not update the attack plan." });
    }
  }
  if (path === "/api/miniapp/incoming" && request.method === "GET") {
    try {
      const session = await verifiedMiniAppSession(url.searchParams.get("access"), ["map"], url.searchParams.get("galaxy"));
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await miniAppIncoming(session));
    } catch (error) {
      console.error("Mini app incoming lookup failed", error?.message || error);
      return writeJson(response, 500, { error: "Could not load incoming reports." });
    }
  }
  if (path === "/api/miniapp/incoming" && request.method === "POST") {
    try {
      const body = await readJson(request, 64 * 1024);
      const session = await verifiedMiniAppSession(body.access, ["map"], body.galaxy);
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await updateMiniAppIncoming(session, body));
    } catch (error) {
      console.error("Mini app incoming update failed", error?.message || error);
      return writeJson(response, 400, { error: error?.message || "Could not update incoming reports." });
    }
  }
  if (path === "/api/miniapp/scouting" && request.method === "GET") {
    try {
      const session = await verifiedMiniAppSession(url.searchParams.get("access"), ["map"], url.searchParams.get("galaxy"));
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await miniAppScouting(session));
    } catch (error) {
      console.error("Mini app scouting lookup failed", error?.message || error);
      return writeJson(response, 500, { error: "Could not load scouting agendas." });
    }
  }
  if (path === "/api/miniapp/scouting" && request.method === "POST") {
    try {
      const body = await readJson(request, 256 * 1024);
      const session = await verifiedMiniAppSession(body.access, ["map"], body.galaxy);
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await updateMiniAppScouting(session, body));
    } catch (error) {
      console.error("Mini app scouting update failed", error?.message || error);
      return writeJson(response, 400, { error: error?.message || "Could not update scouting." });
    }
  }
  if (path === "/api/miniapp/battles" && request.method === "GET") {
    try {
      const session = await verifiedMiniAppSession(url.searchParams.get("access"), ["map"], url.searchParams.get("galaxy"));
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await miniAppBattles(session, url.searchParams.get("coord")));
    } catch (error) {
      console.error("Mini app battle history lookup failed", error?.message || error);
      const status = error?.status === 400 ? 400 : error?.status === 401 ? 401 : 500;
      return writeJson(response, status, { error: status === 500 ? "Could not load battle history." : error.message });
    }
  }
  if (path === "/api/miniapp/intel" && request.method === "GET") {
    try {
      const session = await verifiedMiniAppSession(url.searchParams.get("access"), ["map"], url.searchParams.get("galaxy"));
      if (!session) return writeJson(response, 401, { error: "Map access expired or is no longer approved." });
      return writeJson(response, 200, await miniAppIntel(session, url.searchParams.get("region")));
    } catch (error) {
      console.error("Mini app intel lookup failed", error?.message || error);
      return writeJson(response, 500, { error: "Could not load sector intel." });
    }
  }
  if (path === "/api/miniapp/import" && request.method === "POST") {
    try {
      const body = await readJson(request, 8 * 1024 * 1024);
      const session = await verifiedMiniAppSession(body.access, ["map", "export"], body.galaxy || body.intel?.galaxy);
      if (!session) return writeJson(response, 401, { error: "Exporter access is invalid, expired, or revoked. Open /map and recopy it." });
      return writeJson(response, 200, await miniAppImportIntel(session, body));
    } catch (error) {
      console.error("Mini app intel import failed", error?.message || error);
      return writeJson(response, 400, { error: error?.message || "Could not import intel." });
    }
  }
  if (webhookHandler && path === webhookPath) {
    if (telegramWebhookSecret && request.headers["x-telegram-bot-api-secret-token"] !== telegramWebhookSecret) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Forbidden\n");
      return;
    }
    console.log(`Telegram webhook request received: ${request.method}`);
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
    console.log(`Telegram webhook configured at ${webhookBaseUrl}`);
  } else {
    await bot.telegram.deleteWebhook();
    await bot.launch();
    console.log("Telegram polling started");
  }
  startNotificationWorker();
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
