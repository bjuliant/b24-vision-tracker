export function selectGalaxyPreference({
  isPrivate = false,
  roomGalaxy = "",
  userGalaxy = "",
  sharedGalaxy = "",
  defaultGalaxy = "B24"
} = {}) {
  const candidates = isPrivate
    ? [userGalaxy, sharedGalaxy, defaultGalaxy]
    : [roomGalaxy, userGalaxy, sharedGalaxy, defaultGalaxy];

  return candidates.find(Boolean) || defaultGalaxy;
}
