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
