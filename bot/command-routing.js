export function resolveCommandMatches(name, canonicalCommands, preferredAliases = {}) {
  const token = String(name || "").toLowerCase();
  if (!token) return [];

  const aliasesFor = (command) => preferredAliases[command] || [command];
  const exact = canonicalCommands.filter((command) => aliasesFor(command).includes(token));
  if (exact.length) return [...new Set(exact)];

  return [...new Set(canonicalCommands.filter((command) =>
    aliasesFor(command).some((alias) => alias.startsWith(token))
  ))];
}
