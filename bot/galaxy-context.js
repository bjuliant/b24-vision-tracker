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
