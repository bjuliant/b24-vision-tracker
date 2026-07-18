const MONTHS = new Map([
  ["jan", 0], ["feb", 1], ["mar", 2], ["apr", 3], ["may", 4], ["jun", 5],
  ["jul", 6], ["aug", 7], ["sep", 8], ["oct", 9], ["nov", 10], ["dec", 11]
]);
const ACTIVE_OCCUPATION_STATES = new Set(["occupied", "occupier_destroyed"]);
const GMT_PLUS_ONE_MS = 60 * 60 * 1000;
const LIBERATION_EVENT_TYPES = new Set(["liberation", "liberated", "revolt_success"]);

export const BATTLE_HISTORY_COMMAND_ALIASES = Object.freeze({
  history: Object.freeze(["hist", "history"]),
  occupied: Object.freeze(["occ", "occupied"])
});
export const BATTLE_HISTORY_COMMANDS = Object.freeze(Object.keys(BATTLE_HISTORY_COMMAND_ALIASES));

function text(value) {
  return String(value ?? "").trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function effectiveTimeMs(value) {
  const raw = text(value);
  if (!raw) return NaN;
  const ae = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (ae) {
    const month = MONTHS.get(ae[2].slice(0, 3).toLowerCase());
    if (month !== undefined) return Date.UTC(Number(ae[3]), month, Number(ae[1]), Number(ae[4]), Number(ae[5]), Number(ae[6] || 0)) - GMT_PLUS_ONE_MS;
  }
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+\-]\d{2}:?\d{2})?$/);
  if (!ymd) return NaN;
  if (ymd[7]) {
    const parsed = Date.parse(raw.replace(" ", "T"));
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), Number(ymd[4]), Number(ymd[5]), Number(ymd[6] || 0)) - GMT_PLUS_ONE_MS;
}

function effective(row, primaryFields, fallbackFields = ["created_at", "updated_at"]) {
  // History order uses the domain time first. If it is missing/unparseable,
  // use imported creation/update time; if both are absent, epoch 0 sorts last.
  for (const field of primaryFields) {
    const ms = effectiveTimeMs(row?.[field]);
    if (Number.isFinite(ms)) return { ms, label: text(row[field]), fallback: false };
  }
  for (const field of fallbackFields) {
    const ms = effectiveTimeMs(row?.[field]);
    if (Number.isFinite(ms)) return { ms, label: text(row[field]), fallback: true };
  }
  return { ms: 0, label: "Time unknown", fallback: true };
}

function party(guild, player, fallback = "Unknown") {
  return [text(guild), text(player)].filter(Boolean).join(" ") || fallback;
}

function unitQuantity(row) {
  return finite(row?.end) ?? finite(row?.quantity) ?? 0;
}

export function compactSurvivors(units, limit = 4) {
  const live = (Array.isArray(units) ? units : [])
    .map((row) => ({ unit: text(row?.unit), quantity: unitQuantity(row) }))
    .filter((row) => row.unit && row.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.unit.localeCompare(b.unit));
  const shown = live.slice(0, limit).map((row) => `${row.quantity.toLocaleString("en-US")} ${row.unit}`);
  if (live.length > limit) shown.push(`+${live.length - limit} more`);
  return shown.join(", ");
}

function sameScope(row, scope, coord = "") {
  return (!scope.mapId || String(row?.map_id || "") === String(scope.mapId))
    && String(row?.chat_id || "") === String(scope.chatId)
    && (!coord || text(row?.coord).toUpperCase() === coord.toUpperCase());
}

function battleItem(row, observations) {
  const when = effective(row, ["battle_time"]);
  const reportId = text(row.report_id);
  const attackerId = `battle-${reportId}-attacker`;
  const defenderId = `battle-${reportId}-defender`;
  const attackerObservation = observations.find((observation) => text(observation.observation_id) === attackerId);
  const defenderObservation = observations.find((observation) => text(observation.observation_id) === defenderId);
  return {
    id: text(row.report_id),
    kind: "battle",
    effectiveAt: when.label,
    effectiveMs: when.ms,
    usedFallbackTime: when.fallback,
    coord: text(row.coord),
    outcome: text(row.outcome || "inconclusive").replace(/_/g, " "),
    attacker: party(row.attacker_guild, row.attacker_player, "Unknown attacker"),
    defender: party(row.defender_guild, row.defender_player, "Unknown defender"),
    losses: {
      total: finite(row.destroyed_total),
      attacker: finite(row.attacker_destroyed_cost),
      defender: finite(row.defender_destroyed_cost)
    },
    loot: { attacker: finite(row.attacker_loot), defender: finite(row.defender_loot) },
    debris: finite(row.debris),
    pillage: finite(row.pillage_credits),
    startDefenses: finite(row.start_defenses),
    finalDefenses: finite(row.end_defenses),
    attackerSurvivors: compactSurvivors(attackerObservation?.units || row.attacker_units),
    defenderSurvivors: compactSurvivors(defenderObservation?.units || row.defender_units),
    occupiedEvidence: Boolean(row.occupied),
    liberatedEvidence: Boolean(row.liberated)
  };
}

function eventItem(row) {
  const when = effective(row, ["occurred_at"]);
  return {
    id: text(row.event_id), kind: "event", effectiveAt: when.label, effectiveMs: when.ms,
    usedFallbackTime: when.fallback, coord: text(row.coord), eventType: text(row.event_type).replace(/_/g, " "),
    label: text(row.base_label), actor: party(row.actor_guild, row.actor_player, "")
  };
}

function observationItem(row) {
  const when = effective(row, ["observed_at"]);
  return {
    id: text(row.observation_id), kind: "observation", effectiveAt: when.label, effectiveMs: when.ms,
    usedFallbackTime: when.fallback, coord: text(row.coord), side: text(row.side),
    party: party(row.guild, row.player, text(row.fleet_name) || "Unknown force"),
    fleet: text(row.fleet_name), destroyed: Boolean(row.destroyed), survivors: compactSurvivors(row.units), size: finite(row.size)
  };
}

function liberationEvidence(battles, events) {
  const candidates = [
    ...battles.filter((row) => Boolean(row.liberated) || text(row.outcome).toLowerCase() === "liberated").map((row) => {
      const when = effective(row, ["battle_time"]);
      return { kind: "battle liberation", effectiveAt: when.label, effectiveMs: when.ms, usedFallbackTime: when.fallback, id: text(row.report_id) };
    }),
    ...events.filter((row) => LIBERATION_EVENT_TYPES.has(text(row.event_type).toLowerCase())).map((row) => {
      const when = effective(row, ["occurred_at"]);
      return { kind: text(row.event_type).replace(/_/g, " "), effectiveAt: when.label, effectiveMs: when.ms, usedFallbackTime: when.fallback, id: text(row.event_id) };
    })
  ];
  return candidates.sort((a, b) => b.effectiveMs - a.effectiveMs || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))[0] || null;
}

function occupationView(row, newerLiberation = null) {
  if (!row) return null;
  const state = text(row.state || "unresolved").toLowerCase();
  const active = ACTIVE_OCCUPATION_STATES.has(state);
  const stateWhen = effective(row, ["observed_at"]);
  const inconsistent = Boolean(active && newerLiberation && newerLiberation.effectiveMs > stateWhen.ms);
  return {
    coord: text(row.coord), state, active,
    owner: party(row.owner_guild, row.owner_player, "Owner unknown"),
    occupier: active ? party(row.occupier_guild, row.occupier_player, "Occupier unknown") : "None active",
    occupyingFleet: text(row.occupying_fleet_name), occupyingFleetSize: finite(row.occupying_fleet_size),
    revoltState: text(row.revolt_state || "unknown"), observedAt: text(row.observed_at), resolvedAt: text(row.resolved_at),
    inconsistent, staleCurrentState: inconsistent,
    contradiction: inconsistent ? newerLiberation : null
  };
}

function occupationEvidenceItem(row) {
  if (!row || text(row.state).toLowerCase() === "unresolved") return null;
  const active = ACTIVE_OCCUPATION_STATES.has(text(row.state).toLowerCase());
  const when = effective(row, active ? ["observed_at"] : ["resolved_at", "observed_at"]);
  return {
    id: `occupation-${text(row.coord)}-${text(row.state)}`, kind: "occupation_state",
    effectiveAt: when.label, effectiveMs: when.ms, usedFallbackTime: when.fallback, coord: text(row.coord),
    state: text(row.state), owner: party(row.owner_guild, row.owner_player, "Owner unknown"),
    occupier: active ? party(row.occupier_guild, row.occupier_player, "Occupier unknown") : "None active",
    currentStateEvidence: true
  };
}

export function buildCoordinateHistory({ scope, coord, battles = [], occupations = [], observations = [], events = [], limit = 30 }) {
  const wanted = text(coord).toUpperCase();
  const scopedBattles = battles.filter((row) => sameScope(row, scope, wanted));
  const scopedOccupations = occupations.filter((row) => sameScope(row, scope, wanted));
  const scopedObservations = observations.filter((row) => sameScope(row, scope, wanted));
  const scopedEvents = events.filter((row) => sameScope(row, scope, wanted));
  const currentRow = scopedOccupations.sort((a, b) => effective(b, ["observed_at"]).ms - effective(a, ["observed_at"]).ms)[0] || null;
  const linkedObservationIds = new Set();
  const battleItems = scopedBattles.map((row) => {
    const reportId = text(row.report_id);
    linkedObservationIds.add(`battle-${reportId}-attacker`);
    linkedObservationIds.add(`battle-${reportId}-defender`);
    return battleItem(row, scopedObservations);
  });
  const newestLiberation = liberationEvidence(scopedBattles, scopedEvents);
  const occupation = occupationView(currentRow, newestLiberation);
  const stateItem = occupationEvidenceItem(currentRow);
  if (stateItem && occupation?.inconsistent) {
    stateItem.inconsistent = true;
    stateItem.contradiction = occupation.contradiction;
  }
  const orderedTimeline = [
    ...battleItems,
    ...scopedEvents.map(eventItem),
    ...scopedObservations.filter((row) => !linkedObservationIds.has(text(row.observation_id))).map(observationItem),
    ...(stateItem ? [stateItem] : [])
  ].sort((a, b) => b.effectiveMs - a.effectiveMs || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const timeline = orderedTimeline.slice(0, limit);
  return { coord: wanted, occupation, timeline, totalTimeline: orderedTimeline.length, timelineOmitted: orderedTimeline.length - timeline.length };
}

export function buildActiveOccupations({ scope, occupations = [], battles = [], events = [], query = "", limit = 30 }) {
  const needle = text(query).toUpperCase();
  const scopedBattles = battles.filter((row) => sameScope(row, scope));
  const scopedEvents = events.filter((row) => sameScope(row, scope));
  const matched = occupations
    .filter((row) => sameScope(row, scope) && ACTIVE_OCCUPATION_STATES.has(text(row.state).toLowerCase()))
    .map((row) => {
      const coord = text(row.coord).toUpperCase();
      const contradiction = liberationEvidence(
        scopedBattles.filter((battle) => text(battle.coord).toUpperCase() === coord),
        scopedEvents.filter((event) => text(event.coord).toUpperCase() === coord)
      );
      return { ...occupationView(row, contradiction), effectiveMs: effective(row, ["observed_at"]).ms };
    })
    .filter((row) => !needle || [row.coord, row.owner, row.occupier].some((value) => text(value).toUpperCase().includes(needle)))
    .sort((a, b) => b.effectiveMs - a.effectiveMs || a.coord.localeCompare(b.coord));
  const result = matched.slice(0, limit).map(({ effectiveMs, ...row }) => row);
  Object.defineProperties(result, {
    totalCount: { value: matched.length, enumerable: false },
    omittedCount: { value: matched.length - result.length, enumerable: false }
  });
  return result;
}

function requireScope(request) {
  if (!request?.authorized || !text(request.chatId)) throw new Error("Battle intelligence access is not authorized.");
  return { mapId: text(request.mapId), chatId: text(request.chatId) };
}

function tableOptions(scope) {
  return scope.mapId
    ? { mapId: scope.mapId, pageSize: 250 }
    : { includeMap: false, pageSize: 250 };
}

export function createBattleHistoryReader(fetchTableRows) {
  return {
    async coordinateHistory(request) {
      const scope = requireScope(request);
      const coord = text(request.coord).toUpperCase();
      const filters = { coord: `eq.${coord}`, chat_id: `eq.${scope.chatId}` };
      const options = tableOptions(scope);
      const [battles, occupations, observations, events] = await Promise.all([
        fetchTableRows("b24_battle_reports", filters, options),
        fetchTableRows("b24_occupations", filters, options),
        fetchTableRows("b24_fleet_observations", filters, options),
        fetchTableRows("b24_game_events", filters, options)
      ]);
      return buildCoordinateHistory({ scope, coord, battles, occupations, observations, events, limit: request.limit || 30 });
    },
    async activeOccupations(request) {
      const scope = requireScope(request);
      const filters = { chat_id: `eq.${scope.chatId}` };
      const options = tableOptions(scope);
      const [occupations, battles, events] = await Promise.all([
        fetchTableRows("b24_occupations", filters, options),
        fetchTableRows("b24_battle_reports", filters, options),
        fetchTableRows("b24_game_events", filters, options)
      ]);
      return buildActiveOccupations({ scope, occupations, battles, events, query: request.query, limit: request.limit || 30 });
    }
  };
}

export function resolveBattleHistoryRoute(input) {
  const match = text(input).match(/^([!$])([a-z0-9_-]+)(?=\s|$)/i);
  if (!match) return null;
  const alias = match[2].toLowerCase();
  const command = BATTLE_HISTORY_COMMANDS.find((name) => BATTLE_HISTORY_COMMAND_ALIASES[name].includes(alias));
  if (!command) return null;
  return {
    command,
    mode: match[1],
    protected: true,
    sensitive: true,
    requiresActiveChatScope: true
  };
}

export class BattleHistoryRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validateMiniAppHistoryRequest({ session, coord, expectedMapId, coordinateMapId }) {
  if (!session) throw new BattleHistoryRequestError(401, "Map access expired or is no longer approved.");
  if (!text(coord) || !text(expectedMapId) || text(coordinateMapId) !== text(expectedMapId)) {
    throw new BattleHistoryRequestError(400, "Choose a valid astro coordinate in this galaxy.");
  }
  return text(coord).toUpperCase();
}

function defaultEscapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function historyNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function boundedTelegramHtml(header, blocks, { maxChars = 4096, omittedLabel = "records", preOmitted = 0, escapeHtml = defaultEscapeHtml } = {}) {
  const safeHeader = text(header);
  const included = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const candidateBlocks = [...included, blocks[index]];
    const omitted = preOmitted + blocks.length - candidateBlocks.length;
    const footer = omitted ? `\n\n<i>${omitted} ${escapeHtml(omittedLabel)} omitted.</i>` : "";
    const candidate = [safeHeader, ...candidateBlocks].filter(Boolean).join("\n\n") + footer;
    if (candidate.length > maxChars) break;
    included.push(blocks[index]);
  }
  const omitted = preOmitted + blocks.length - included.length;
  const footer = omitted ? `\n\n<i>${omitted} ${escapeHtml(omittedLabel)} omitted.</i>` : "";
  const result = [safeHeader, ...included].filter(Boolean).join("\n\n") + footer;
  if (result.length <= maxChars) return result;
  const fallback = `${blocks.length + preOmitted} ${omittedLabel} omitted because the heading exceeded Telegram's message limit.`;
  return fallback.length <= maxChars ? fallback : "Battle intelligence output omitted.".slice(0, maxChars);
}

export function formatHistoryTelegram(history, { maxChars = 4096, escapeHtml = defaultEscapeHtml } = {}) {
  const heading = [`<b>Battle History: ${escapeHtml(history.coord)}</b>`];
  if (history.occupation?.inconsistent) {
    const contradiction = history.occupation.contradiction;
    heading.push(
      "",
      "<b>Occupation state inconsistent</b>",
      `Stored current-state row: ${escapeHtml(history.occupation.state)} by ${escapeHtml(history.occupation.occupier)}`,
      `Owner: ${escapeHtml(history.occupation.owner)}`,
      `Newer ${escapeHtml(contradiction?.kind || "liberation evidence")}: ${escapeHtml(contradiction?.effectiveAt || "time unknown")}`,
      "Treat current occupation as unconfirmed until the state row is refreshed."
    );
  } else if (history.occupation?.active) {
    heading.push("", "<b>Current occupation</b>", `Owner: ${escapeHtml(history.occupation.owner)}`, `Occupier: ${escapeHtml(history.occupation.occupier)}`);
    const force = [history.occupation.occupyingFleet, history.occupation.occupyingFleetSize != null ? historyNumber(history.occupation.occupyingFleetSize) : ""].filter(Boolean).join(" / ");
    if (force) heading.push(`Occupying force: ${escapeHtml(force)}`);
  } else if (history.occupation) {
    heading.push("", `<b>Current occupation</b>: none active (${escapeHtml(history.occupation.state)})`, `Recorded owner: ${escapeHtml(history.occupation.owner)}`);
  } else {
    heading.push("", "<b>Current occupation</b>: no current-state record");
  }
  if (!history.timeline.length) {
    return boundedTelegramHtml([...heading, "", "No battle, liberation/revolt, or battle-fleet evidence is stored for this coordinate."].join("\n"), [], { maxChars, omittedLabel: "timeline records", preOmitted: Number(history.timelineOmitted || 0), escapeHtml });
  }
  heading.push("", "<b>Timeline</b>");
  const blocks = history.timeline.map((item) => {
    const time = item.usedFallbackTime ? `${item.effectiveAt} (import-time fallback)` : item.effectiveAt;
    const lines = [];
    if (item.kind === "battle") {
      lines.push(`<b>${escapeHtml(time)}</b> - ${escapeHtml(item.outcome)}`, `${escapeHtml(item.attacker)} vs ${escapeHtml(item.defender)}`);
      const losses = [item.losses.total != null ? `total ${historyNumber(item.losses.total)}` : "", item.losses.attacker != null ? `attacker ${historyNumber(item.losses.attacker)}` : "", item.losses.defender != null ? `defender ${historyNumber(item.losses.defender)}` : ""].filter(Boolean).join(" / ");
      if (losses) lines.push(`Losses: ${escapeHtml(losses)}`);
      const loot = [item.loot.attacker != null ? `attacker ${historyNumber(item.loot.attacker)}` : "", item.loot.defender != null ? `defender ${historyNumber(item.loot.defender)}` : ""].filter(Boolean).join(" / ");
      if (loot) lines.push(`Loot: ${escapeHtml(loot)}`);
      const material = [item.debris != null ? `debris ${historyNumber(item.debris)}` : "", item.pillage != null ? `pillage ${historyNumber(item.pillage)}` : ""].filter(Boolean).join(" / ");
      if (material) lines.push(escapeHtml(material));
      if (item.finalDefenses != null) lines.push(`Final defenses: ${escapeHtml(item.finalDefenses)}%`);
      if (item.attackerSurvivors) lines.push(`Attacker survivors: ${escapeHtml(item.attackerSurvivors)}`);
      if (item.defenderSurvivors) lines.push(`Defender survivors: ${escapeHtml(item.defenderSurvivors)}`);
    } else if (item.kind === "event") {
      lines.push(`<b>${escapeHtml(time)}</b> - ${escapeHtml(item.eventType || "event")}`, escapeHtml([item.label, item.actor].filter(Boolean).join(" / ")));
    } else if (item.kind === "occupation_state") {
      lines.push(`<b>${escapeHtml(time)}</b> - occupation state: ${escapeHtml(item.state)}${item.inconsistent ? " (stale/inconsistent)" : ""}`, `Owner: ${escapeHtml(item.owner)} / Occupier: ${escapeHtml(item.occupier)}`);
      if (item.inconsistent) lines.push(`Newer ${escapeHtml(item.contradiction?.kind || "liberation evidence")}: ${escapeHtml(item.contradiction?.effectiveAt || "time unknown")}`);
    } else {
      const force = item.survivors || (item.size != null ? historyNumber(item.size) : "");
      lines.push(`<b>${escapeHtml(time)}</b> - battle fleet observation`, `${escapeHtml(item.party)}${force ? ` / ${escapeHtml(force)}` : ""}${item.destroyed ? " / destroyed" : ""}`);
    }
    return lines.filter(Boolean).join("\n");
  });
  return boundedTelegramHtml(heading.join("\n"), blocks, { maxChars, omittedLabel: "timeline records", preOmitted: Number(history.timelineOmitted || 0), escapeHtml });
}

export function formatOccupiedTelegram({ galaxy, query = "", rows = [] }, { maxChars = 4096, escapeHtml = defaultEscapeHtml } = {}) {
  if (!rows.length) {
    const suffix = query ? ` matching <code>${escapeHtml(query)}</code>` : "";
    return `No current active occupations${suffix} in ${escapeHtml(galaxy)}.`;
  }
  const heading = [`<b>${escapeHtml(galaxy)} Active Occupations</b> (${rows.length})`];
  if (query) heading.push(`Filter: <code>${escapeHtml(query)}</code>`);
  const blocks = rows.map((row) => {
    const force = [row.occupyingFleet, row.occupyingFleetSize != null ? historyNumber(row.occupyingFleetSize) : ""].filter(Boolean).join(" / ");
    const lines = [`<b>${escapeHtml(row.coord)}</b>`, `Owner: ${escapeHtml(row.owner)}`, `Occupier: ${escapeHtml(row.occupier)}`];
    if (row.inconsistent) {
      lines.push(
        "<b>Status: inconsistent/stale current-state</b>",
        `Newer ${escapeHtml(row.contradiction?.kind || "liberation evidence")}: ${escapeHtml(row.contradiction?.effectiveAt || "time unknown")}`,
        "Occupation is not confirmed current until the state row is refreshed."
      );
    } else if (force) {
      lines.push(`Occupying force: ${escapeHtml(force)}`);
    } else {
      lines.push(`Observed: ${escapeHtml(row.observedAt || "time unknown")}`);
    }
    return lines.join("\n");
  });
  return boundedTelegramHtml(heading.join("\n"), blocks, { maxChars, omittedLabel: "occupation records", preOmitted: Number(rows.omittedCount || 0), escapeHtml });
}
