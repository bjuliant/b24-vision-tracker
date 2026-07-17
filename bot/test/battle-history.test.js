import test from "node:test";
import assert from "node:assert/strict";
import {
  BATTLE_HISTORY_COMMAND_ALIASES,
  buildActiveOccupations,
  buildCoordinateHistory,
  createBattleHistoryReader,
  effectiveTimeMs,
  formatHistoryTelegram,
  formatOccupiedTelegram,
  resolveBattleHistoryRoute,
  validateMiniAppHistoryRequest
} from "../battle-history.js";

const scope = { mapId: "b24", chatId: "chat-a" };
const coord = "B24:14:64:30";

function row(extra = {}) {
  return { map_id: scope.mapId, chat_id: scope.chatId, coord, ...extra };
}

test("reader rejects missing authorization or verified chat scope", async () => {
  let calls = 0;
  const reader = createBattleHistoryReader(async () => { calls += 1; return []; });
  await assert.rejects(() => reader.coordinateHistory({ authorized: false, mapId: "b24", chatId: "chat-a", coord }), /not authorized/i);
  await assert.rejects(() => reader.activeOccupations({ authorized: true, mapId: "b24", chatId: "" }), /not authorized/i);
  assert.equal(calls, 0);
});

test("reader sends map and chat filters on every sensitive table query", async () => {
  const calls = [];
  const reader = createBattleHistoryReader(async (table, filters, options) => { calls.push({ table, filters, options }); return []; });
  await reader.coordinateHistory({ authorized: true, mapId: "b24", chatId: "chat-a", coord });
  assert.equal(calls.length, 4);
  calls.forEach((call) => {
    assert.equal(call.options.mapId, "b24");
    assert.equal(call.filters.chat_id, "eq.chat-a");
    assert.equal(call.filters.coord, `eq.${coord}`);
  });
});

test("same map and coordinate in two chats never leaks across chat scope", async () => {
  const rows = [
    row({ report_id: "mine", battle_time: "15 Jul 2026, 10:00:00", attacker_player: "Guild A" }),
    { ...row({ report_id: "other", battle_time: "15 Jul 2026, 11:00:00", attacker_player: "Guild B" }), chat_id: "chat-b" }
  ];
  const reader = createBattleHistoryReader(async (table) => table === "b24_battle_reports" ? rows : []);
  const history = await reader.coordinateHistory({ authorized: true, mapId: "b24", chatId: "chat-a", coord });
  assert.deepEqual(history.timeline.filter((item) => item.kind === "battle").map((item) => item.id), ["mine"]);
});

test("history orders by effective battle time instead of creation time", () => {
  const history = buildCoordinateHistory({
    scope, coord,
    battles: [
      row({ report_id: "newer-created", battle_time: "14 Jul 2026, 09:00:00", created_at: "2026-07-16T00:00:00Z" }),
      row({ report_id: "older-created-newer-battle", battle_time: "15 Jul 2026, 09:00:00", created_at: "2026-07-15T10:00:00Z" })
    ]
  });
  assert.deepEqual(history.timeline.map((item) => item.id), ["older-created-newer-battle", "newer-created"]);
});

test("timezone-free AE timestamps are fixed GMT+1 and order correctly with ISO timestamps", () => {
  assert.equal(effectiveTimeMs("15 Jul 2026, 10:00:00"), Date.parse("2026-07-15T09:00:00Z"));
  assert.equal(effectiveTimeMs("2026-07-15 10:00:00"), Date.parse("2026-07-15T09:00:00Z"));
  const history = buildCoordinateHistory({
    scope, coord,
    battles: [
      row({ report_id: "ae", battle_time: "15 Jul 2026, 10:00:00" }),
      row({ report_id: "iso", battle_time: "2026-07-15T09:30:00Z" })
    ]
  });
  assert.deepEqual(history.timeline.map((item) => item.id), ["iso", "ae"]);
});

test("invalid source time uses deterministic created_at fallback and marks it", () => {
  const history = buildCoordinateHistory({
    scope, coord,
    battles: [row({ report_id: "fallback", battle_time: "not a date", created_at: "2026-07-15T12:00:00Z" })]
  });
  assert.equal(history.timeline[0].effectiveAt, "2026-07-15T12:00:00Z");
  assert.equal(history.timeline[0].usedFallbackTime, true);
});

test("coordinate timeline includes scoped revolt events and unmatched fleet observations", () => {
  const history = buildCoordinateHistory({
    scope, coord,
    events: [row({ event_id: "revolt", event_type: "revolt_success", occurred_at: "2026-07-15T10:00:00Z" })],
    observations: [row({ observation_id: "fleet-snapshot", source_kind: "battle_report", observed_at: "2026-07-15T09:00:00Z", player: "Scout", units: [{ unit: "Fighter", quantity: 5 }] })]
  });
  assert.deepEqual(history.timeline.map((item) => item.kind), ["event", "observation"]);
  assert.equal(history.timeline[1].survivors, "5 Fighter");
});

test("battle observations link by exact generated ID without prefix collisions or suppression", () => {
  const history = buildCoordinateHistory({
    scope, coord,
    battles: [
      row({ report_id: "abc", battle_time: "15 Jul 2026, 10:00:00" }),
      row({ report_id: "abc-long", battle_time: "15 Jul 2026, 09:00:00" })
    ],
    observations: [
      row({ observation_id: "battle-abc-attacker", side: "attacker", observed_at: "2026-07-15T09:00:00Z", units: [{ unit: "Corvette", quantity: 1 }] }),
      row({ observation_id: "battle-abc-long-attacker", side: "attacker", observed_at: "2026-07-15T08:00:00Z", units: [{ unit: "Bomber", quantity: 9 }] }),
      row({ observation_id: "battle-abc-longer-attacker", side: "attacker", observed_at: "2026-07-15T07:00:00Z", units: [{ unit: "Fighter", quantity: 99 }] })
    ]
  });
  const abc = history.timeline.find((item) => item.id === "abc");
  const abcLong = history.timeline.find((item) => item.id === "abc-long");
  assert.equal(abc.attackerSurvivors, "1 Corvette");
  assert.equal(abcLong.attackerSurvivors, "9 Bomber");
  assert.ok(history.timeline.some((item) => item.id === "battle-abc-longer-attacker" && item.kind === "observation"));
});

test("conquest followed by liberation remains in history but is not active occupation", () => {
  const battles = [
    row({ report_id: "conquest", battle_time: "14 Jul 2026, 09:00:00", occupied: true, outcome: "occupied" }),
    row({ report_id: "liberation", battle_time: "15 Jul 2026, 09:00:00", liberated: true, outcome: "liberated" })
  ];
  const occupations = [row({ state: "liberated", owner_player: "Defender", observed_at: "2026-07-14T09:00:00Z", resolved_at: "2026-07-15T09:00:00Z" })];
  const history = buildCoordinateHistory({ scope, coord, battles, occupations });
  assert.equal(history.occupation.active, false);
  assert.deepEqual(history.timeline.filter((item) => item.kind === "battle").map((item) => item.outcome), ["liberated", "occupied"]);
  assert.deepEqual(buildActiveOccupations({ scope, occupations }), []);
});

test("newer liberation evidence marks an older active current-state row inconsistent", () => {
  const occupations = [row({ state: "occupied", owner_player: "Owner", occupier_player: "Occupier", observed_at: "15 Jul 2026, 10:00:00" })];
  const events = [row({ event_id: "revolt", event_type: "revolt_success", occurred_at: "2026-07-15T09:30:00Z" })];
  const history = buildCoordinateHistory({ scope, coord, occupations, events });
  assert.equal(history.occupation.active, true);
  assert.equal(history.occupation.inconsistent, true);
  assert.equal(history.occupation.contradiction.kind, "revolt success");
  const listed = buildActiveOccupations({ scope, occupations, events });
  assert.equal(listed[0].inconsistent, true);
  assert.match(formatHistoryTelegram(history), /Occupation state inconsistent/);
  assert.doesNotMatch(formatHistoryTelegram(history), /<b>Current occupation<\/b>/);
});

test("occupier_destroyed remains active until explicit newer liberation evidence", () => {
  const occupations = [row({ state: "occupier_destroyed", occupier_player: "Occupier", observed_at: "2026-07-15T09:00:00Z" })];
  assert.equal(buildActiveOccupations({ scope, occupations })[0].active, true);
  const battles = [row({ report_id: "later-liberation", battle_time: "2026-07-15T10:00:00Z", liberated: true, outcome: "liberated" })];
  const listed = buildActiveOccupations({ scope, occupations, battles });
  assert.equal(listed[0].active, true);
  assert.equal(listed[0].inconsistent, true);
});

test("active occupation filters match region, owner, occupier, and exclude other chats", () => {
  const occupations = [
    row({ state: "occupied", owner_guild: "[ROTC]", owner_player: "Owner", occupier_guild: "[APP]", occupier_player: "Koen", observed_at: "2026-07-15T09:00:00Z" }),
    row({ coord: "B24:14:02:02", state: "occupier_destroyed", owner_player: "Second Owner", occupier_player: "Koen", observed_at: "2026-07-15T10:00:00Z" }),
    { ...row({ state: "occupied", occupier_player: "Leak", observed_at: "2026-07-16T09:00:00Z" }), chat_id: "chat-b" },
    row({ coord: "B24:15:01:01", state: "liberated", occupier_player: "Koen", observed_at: "2026-07-16T09:00:00Z" })
  ];
  assert.equal(buildActiveOccupations({ scope, occupations, query: "B24:14" }).length, 2);
  assert.equal(buildActiveOccupations({ scope, occupations, query: "ROTC" }).length, 1);
  assert.equal(buildActiveOccupations({ scope, occupations, query: "Koen" }).length, 2);
  assert.equal(buildActiveOccupations({ scope, occupations, query: "Leak" }).length, 0);
});

test("empty history is explicit and battle rendering data preserves owner/occupier and combat facts", () => {
  assert.deepEqual(buildCoordinateHistory({ scope, coord }), { coord, occupation: null, timeline: [], totalTimeline: 0, timelineOmitted: 0 });
  const history = buildCoordinateHistory({
    scope, coord,
    battles: [row({
      report_id: "detail", battle_time: "15 Jul 2026, 09:00:00", outcome: "attacker_win",
      attacker_guild: "[APP]", attacker_player: "Attacker", defender_guild: "[ROTC]", defender_player: "Owner",
      destroyed_total: 1200, attacker_destroyed_cost: 200, defender_destroyed_cost: 1000,
      attacker_loot: 50, defender_loot: -50, debris: 600, pillage_credits: 224, end_defenses: 27.65,
      attacker_units: [{ unit: "Corvette", end: 10 }]
    })],
    occupations: [row({ state: "occupied", owner_guild: "[ROTC]", owner_player: "Owner", occupier_guild: "[APP]", occupier_player: "Attacker", observed_at: "2026-07-15T09:00:00Z" })]
  });
  const battle = history.timeline.find((item) => item.kind === "battle");
  assert.equal(history.occupation.owner, "[ROTC] Owner");
  assert.equal(history.occupation.occupier, "[APP] Attacker");
  assert.equal(battle.losses.total, 1200);
  assert.equal(battle.loot.attacker, 50);
  assert.equal(battle.debris, 600);
  assert.equal(battle.pillage, 224);
  assert.equal(battle.finalDefenses, 27.65);
  assert.equal(battle.attackerSurvivors, "10 Corvette");
});

test("unknown effective times sort deterministically by kind and ID", () => {
  const history = buildCoordinateHistory({
    scope, coord,
    battles: [row({ report_id: "z", battle_time: "unknown" }), row({ report_id: "a", battle_time: "unknown" })],
    events: [row({ event_id: "e", event_type: "revolt_success", occurred_at: "unknown" })]
  });
  assert.deepEqual(history.timeline.map((item) => item.id), ["a", "z", "e"]);
  assert.ok(history.timeline.every((item) => item.effectiveAt === "Time unknown"));
});

function assertBalancedTelegramHtml(message) {
  for (const tag of ["b", "i", "code"]) {
    assert.equal((message.match(new RegExp(`<${tag}>`, "g")) || []).length, (message.match(new RegExp(`</${tag}>`, "g")) || []).length, `${tag} tags must balance`);
  }
}

test("Telegram history and occupied output stay within 4096 characters and report omissions", () => {
  const battles = Array.from({ length: 80 }, (_, index) => row({
    report_id: `report-${String(index).padStart(3, "0")}`,
    battle_time: `2026-07-15T${String(index % 24).padStart(2, "0")}:00:00Z`,
    attacker_player: `Attacker ${index} ${"A".repeat(80)}`,
    defender_player: `Defender ${index} ${"D".repeat(80)}`,
    destroyed_total: 123456, attacker_units: [{ unit: `Corvette ${"C".repeat(60)}`, end: 10 }]
  }));
  const history = buildCoordinateHistory({ scope, coord, battles, limit: 80 });
  const historyMessage = formatHistoryTelegram(history);
  assert.ok(historyMessage.length <= 4096);
  assert.match(historyMessage, /timeline records omitted/);
  assertBalancedTelegramHtml(historyMessage);
  const preLimitedHistory = buildCoordinateHistory({ scope, coord, battles, limit: 2 });
  assert.match(formatHistoryTelegram(preLimitedHistory), /78 timeline records omitted/);

  const occupations = Array.from({ length: 80 }, (_, index) => row({
    coord: `B24:${String(index % 20).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:${String(index % 90).padStart(2, "0")}`,
    state: "occupied", owner_player: `Owner ${"O".repeat(80)}`, occupier_player: `Occupier ${"P".repeat(80)}`, observed_at: "2026-07-15T09:00:00Z"
  }));
  const rows = buildActiveOccupations({ scope, occupations, limit: 80 });
  const occupiedMessage = formatOccupiedTelegram({ galaxy: "B24", rows });
  assert.ok(occupiedMessage.length <= 4096);
  assert.match(occupiedMessage, /occupation records omitted/);
  assertBalancedTelegramHtml(occupiedMessage);
  const preLimitedRows = buildActiveOccupations({ scope, occupations, limit: 2 });
  assert.match(formatOccupiedTelegram({ galaxy: "B24", rows: preLimitedRows }), /78 occupation records omitted/);
});

test("history command aliases route as protected, sensitive, active-scope commands", () => {
  for (const [command, aliases] of Object.entries(BATTLE_HISTORY_COMMAND_ALIASES)) {
    for (const alias of aliases) {
      for (const mode of ["!", "$"]) {
        assert.deepEqual(resolveBattleHistoryRoute(`${mode}${alias} ${coord}`), {
          command, mode, protected: true, sensitive: true, requiresActiveChatScope: true
        });
      }
    }
  }
  assert.equal(resolveBattleHistoryRoute("!intel B24:14:64:30"), null);
});

test("signed Mini App history validation preserves 401 and returns 400 for invalid/cross-galaxy coordinates", () => {
  assert.throws(() => validateMiniAppHistoryRequest({ session: null, coord, expectedMapId: "b24", coordinateMapId: "b24" }), (error) => error.status === 401);
  const session = { c: "chat-a", g: "B24" };
  assert.throws(() => validateMiniAppHistoryRequest({ session, coord: "", expectedMapId: "b24", coordinateMapId: "" }), (error) => error.status === 400);
  assert.throws(() => validateMiniAppHistoryRequest({ session, coord: "B25:14:64:30", expectedMapId: "b24", coordinateMapId: "b25" }), (error) => error.status === 400);
  assert.equal(validateMiniAppHistoryRequest({ session, coord, expectedMapId: "b24", coordinateMapId: "b24" }), coord);
});
