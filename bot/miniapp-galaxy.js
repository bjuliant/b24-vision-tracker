export function normalizeMiniAppGalaxy(value) {
  const match = String(value || "").trim().toUpperCase().match(/^B\d{2}$/);
  return match ? match[0] : "";
}

export function galaxyFromMiniAppMapId(value) {
  return normalizeMiniAppGalaxy(String(value || "").replace(/-main$/i, "").toUpperCase());
}

export function miniAppMapId(galaxy) {
  const normalized = normalizeMiniAppGalaxy(galaxy);
  return normalized ? `${normalized.toLowerCase()}-main` : "";
}

export function rowBelongsToMiniAppGalaxy(row, galaxy) {
  return Boolean(row && miniAppMapId(galaxy) && String(row.map_id || "") === miniAppMapId(galaxy));
}

export function naturalGalaxySort(values = []) {
  return [...new Set(values.map((value) => normalizeMiniAppGalaxy(value) || galaxyFromMiniAppMapId(value)).filter(Boolean))]
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)) || left.localeCompare(right));
}

export function selectMiniAppGalaxy({ requestedGalaxy = "", tokenGalaxy = "", availableGalaxies = [] } = {}) {
  const available = naturalGalaxySort(availableGalaxies);
  const rawRequested = String(requestedGalaxy || "").trim();
  const requested = normalizeMiniAppGalaxy(rawRequested);
  if (rawRequested && !requested) return "";
  const fallback = normalizeMiniAppGalaxy(tokenGalaxy);
  const selected = requested || fallback;
  if (!selected) return "";
  if (available.length && !available.includes(selected)) return "";
  return selected;
}

export function buildGalaxyMapUrl(baseUrl, { galaxy, version = "", access = "", loc = "" } = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("gal", normalizeMiniAppGalaxy(galaxy));
  if (version) url.searchParams.set("v", String(version));
  if (access) url.searchParams.set("access", String(access));
  if (loc) url.searchParams.set("loc", String(loc));
  return url.toString();
}
