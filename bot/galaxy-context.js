export function selectGalaxyPreference({
  isPrivate = false,
  roomGalaxy = "",
  userGalaxy = "",
  sharedGalaxy = "",
  defaultGalaxy = "B24"
} = {}) {
  // A person's selected galaxy is their working context everywhere. A room
  // default remains useful for members who have not chosen one yet.
  const candidates = [userGalaxy, sharedGalaxy, roomGalaxy, defaultGalaxy];

  return candidates.find(Boolean) || defaultGalaxy;
}

export function personalGalaxySettings(userId, galaxy, updatedAt = new Date().toISOString()) {
  const normalized = String(galaxy || "").trim().toUpperCase();
  if (!userId || !/^B\d{2}$/.test(normalized)) return null;
  return {
    user_id: String(userId),
    galaxy: normalized,
    map_id: `${normalized.toLowerCase()}-main`,
    updated_at: updatedAt
  };
}

export function explicitGalaxyScope(value) {
  const match = String(value || "").toUpperCase().match(/\bB\d{2}\b/);
  return match ? match[0] : "";
}

export function readOnlyGalaxyQueryOptions(galaxy, options = {}) {
  const normalized = explicitGalaxyScope(galaxy);
  return normalized
    ? { ...options, mapId: `${normalized.toLowerCase()}-main` }
    : { ...options, includeMap: false };
}

export function coverageFriendlyTags(stanceEntries = [], primaryGuildTag = "") {
  return new Set([
    primaryGuildTag,
    ...stanceEntries.filter(([, stance]) => stance === "friend").map(([tag]) => tag)
  ].map((tag) => String(tag || "").trim()).filter(Boolean));
}

export function regionNeedsWatch({ scoutable = false, app = false, friendly = false, watchAssigned = false } = {}) {
  return Boolean(scoutable && !app && !watchAssigned);
}

export function uncoveredRegionPage(regions = [], page = 1, pageSize = 20) {
  const safeSize = Math.max(1, Number(pageSize) || 20);
  const pages = Math.max(1, Math.ceil(regions.length / safeSize));
  const safePage = Math.max(1, Math.min(pages, Number(page) || 1));
  const from = (safePage - 1) * safeSize;
  return {
    page: safePage,
    pages,
    total: regions.length,
    from,
    to: Math.min(regions.length, from + safeSize),
    rows: regions.slice(from, from + safeSize)
  };
}

export function uncoveredWatchableRegions(galaxy, covered = new Set(), watchableRegions = null) {
  const normalizedGalaxy = String(galaxy || "").trim().toUpperCase();
  if (!/^B\d{2}$/.test(normalizedGalaxy)) return [];
  const candidates = watchableRegions instanceof Set
    ? [...watchableRegions]
    : Array.from({ length: 99 }, (_, index) => `${normalizedGalaxy}:${index + 1}`);
  return [...new Set(candidates
    .map((region) => {
      const match = String(region || "").toUpperCase().match(/^B\d{2}:(\d{1,2})$/);
      return match && String(region).toUpperCase().startsWith(`${normalizedGalaxy}:`)
        ? `${normalizedGalaxy}:${Number(match[1])}`
        : "";
    })
    .filter((region) => region && Number(region.split(":")[1]) >= 1 && Number(region.split(":")[1]) <= 99 && !covered.has(region)))]
    .sort((left, right) => Number(left.split(":")[1]) - Number(right.split(":")[1]));
}

export function identityOwnerSearchTerms(query, links = []) {
  const normalize = (value) => String(value || "")
    .replace(/^@/, "")
    .replace(/[\[\]]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const needle = normalize(query);
  if (!needle) return [];
  return [...new Set([
    needle,
    ...links
      .filter((link) => normalize(link.telegram_username).includes(needle))
      .map((link) => normalize(link.game_username_key || link.game_username))
      .filter(Boolean)
  ])];
}

export function exactGuildTagQuery(value) {
  const match = String(value || "").trim().match(/^\[([^\]]{1,24})\]$/);
  return match ? match[1].trim().toUpperCase() : "";
}

export function importedBaseMatchesQuery(row, query, ownerTerms = []) {
  const exactTag = exactGuildTagQuery(query);
  const normalize = (value) => String(value || "")
    .replace(/[\[\]]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (exactTag) return normalize(row?.guild) === exactTag.toLowerCase();
  return ownerTerms.some((term) => normalize(`${row?.guild || ""} ${row?.label || ""}`).includes(term));
}

export function withoutCoveredRegionTargets(agenda, covered = new Set()) {
  const operations = Array.isArray(agenda?.operations) ? agenda.operations : [];
  const isRegionAgenda = operations.length > 0 && operations.every((operation) => /^B\d{2}:\d{1,2}$/.test(String(operation.target_coord || "")));
  if (!isRegionAgenda) return agenda;
  return {
    ...agenda,
    operations: operations.filter((operation) => !covered.has(String(operation.target_coord || "")))
  };
}
