function normalizeGalaxy(value) {
  const match = String(value || "").toUpperCase().match(/\bB(\d{1,2})\b/);
  return match ? `B${String(Number(match[1])).padStart(2, "0")}` : "";
}

export function normalizeFleetTag(value) {
  return String(value || "")
    .replace(/^@/, "")
    .replace(/[\[\]]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFleetSearch(value) {
  let query = String(value || "").trim();
  const galaxy = normalizeGalaxy(query);
  if (galaxy) query = query.replace(new RegExp(`\\b${galaxy}\\b`, "i"), " ");
  const pageMatch = query.match(/(?:^|\s)(?:page\s*|p)(\d+)(?=\s|$)/i);
  const page = pageMatch ? Math.max(1, Number(pageMatch[1])) : 1;
  if (pageMatch) query = query.replace(pageMatch[0], " ");

  const takeFilter = (name) => {
    const match = query.match(new RegExp(`(?:^|\\s)${name}\\s+(\\[[^\\]]+\\]|@?[A-Za-z0-9_.-]+)(?=\\s|$)`, "i"));
    if (!match) return "";
    query = query.replace(match[0], " ");
    return normalizeFleetTag(match[1]);
  };

  const from = takeFilter("from");
  const to = takeFilter("to");
  const excludeMatch = query.match(/(?:^|\s)no\s+(\[[^\]]+\]|@?[A-Za-z0-9_.-]+)(?=\s|$)/i);
  const excludeFrom = excludeMatch ? normalizeFleetTag(excludeMatch[1]) : "";
  if (excludeMatch) query = query.replace(excludeMatch[0], " ");
  const remaining = query.replace(/\s+/g, " ").trim();
  return {
    galaxy,
    page,
    from: from || (remaining ? normalizeFleetTag(remaining) : ""),
    to,
    excludeFrom
  };
}

export function fleetMatchesSearch(row, destinationBase, filters) {
  const owner = normalizeFleetTag(`${row?.guild || ""} ${row?.player || ""}`);
  const destination = normalizeFleetTag(`${destinationBase?.guild || ""} ${destinationBase?.label || ""}`);
  if (filters.from && !owner.includes(filters.from)) return false;
  if (filters.to && !destination.includes(filters.to)) return false;
  if (filters.excludeFrom && owner.includes(filters.excludeFrom)) return false;
  return true;
}
