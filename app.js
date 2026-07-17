(function () {
  let SECTORS = [];
  let PLAYABLE_SECTORS = [];
  const FLAG_LABELS = {
    friendly: "F",
    enemy: "E",
    scout: "S",
    reserved: "R"
  };

  const config = window.B24_CONFIG || {};
  const tg = window.Telegram?.WebApp;
  const grid = document.querySelector("#grid");
  const syncStatus = document.querySelector("#syncStatus");
  const selectedSector = document.querySelector("#selectedSector");
  const selectedStatus = document.querySelector("#selectedStatus");
  const selectedSystems = document.querySelector("#selectedSystems");
  const selectedBases = document.querySelector("#selectedBases");
  const selectedOperations = document.querySelector("#selectedOperations");
  const watchActionRow = document.querySelector("#watchActionRow");
  const sectorPanelTitle = document.querySelector("#sectorPanelTitle");
  const sectorPanel = document.querySelector("#sectorPanel");
  const sectorCounts = document.querySelector("#sectorCounts");
  const claimsPanelTitle = document.querySelector("#claimsPanelTitle");
  const claimCounts = document.querySelector("#claimCounts");
  const operationsPanelTitle = document.querySelector("#operationsPanelTitle");
  const operationCounts = document.querySelector("#operationCounts");
  const operationList = document.querySelector("#operationList");
  const claimTarget = document.querySelector("#claimTarget");
  const claimArrival = document.querySelector("#claimArrival");
  const claimNote = document.querySelector("#claimNote");
  const claimButton = document.querySelector("#claimButton");
  const claimList = document.querySelector("#claimList");
  const attackCounts = document.querySelector("#attackCounts");
  const attackBoard = document.querySelector("#attackBoard");
  const incomingCounts = document.querySelector("#incomingCounts");
  const incomingBoard = document.querySelector("#incomingBoard");
  const confirmFleetText = document.querySelector("#confirmFleetText");
  const confirmFleetButton = document.querySelector("#confirmFleetButton");
  const confirmFleetResult = document.querySelector("#confirmFleetResult");
  const headerGalaxy = document.querySelector("#headerGalaxy");
  const headerSector = document.querySelector("#headerSector");
  const onlineCount = document.querySelector("#onlineCount");
  const bulkTargetText = document.querySelector("#bulkTargetText");
  const bulkClearButton = document.querySelector("#bulkClearButton");
  const bulkLineCount = document.querySelector("#bulkLineCount");
  const parsedTargets = document.querySelector("#parsedTargets");
  const parsedTotal = document.querySelector("#parsedTotal");
  const parsedStale = document.querySelector("#parsedStale");
  const parsedUnclaimed = document.querySelector("#parsedUnclaimed");
  const attackWindowStart = document.querySelector("#attackWindowStart");
  const attackWindowSummary = document.querySelector("#attackWindowSummary");
  const finalizeAttackButton = document.querySelector("#finalizeAttackButton");
  const finalizeStatus = document.querySelector("#finalizeStatus");
  const baseList = document.querySelector("#baseList");
  const systemList = document.querySelector("#systemList");
  const astroList = document.querySelector("#astroList");
  const template = document.querySelector("#cellTemplate");
  const toolButtons = Array.from(document.querySelectorAll(".tool-button"));
  const importText = document.querySelector("#importText");
  const importButton = document.querySelector("#importButton");
  const bookmarkletButton = document.querySelector("#bookmarkletButton");
  const importResult = document.querySelector("#importResult");
  const sharedAttacksPanel = document.querySelector("#sharedAttacksPanel");
  const sharedAttackCounts = document.querySelector("#sharedAttackCounts");
  const sharedAttackStatus = document.querySelector("#sharedAttackStatus");
  const sharedAttackList = document.querySelector("#sharedAttackList");
  const refreshSharedAttacks = document.querySelector("#refreshSharedAttacks");
  const sharedAttackCreate = document.querySelector("#sharedAttackCreate");
  const sharedAttackName = document.querySelector("#sharedAttackName");
  const sharedAttackArrival = document.querySelector("#sharedAttackArrival");
  const sharedAttackWaves = document.querySelector("#sharedAttackWaves");
  const sharedAttackTargets = document.querySelector("#sharedAttackTargets");
  const sharedIncomingPanel = document.querySelector("#sharedIncomingPanel");
  const sharedIncomingCounts = document.querySelector("#sharedIncomingCounts");
  const sharedIncomingStatus = document.querySelector("#sharedIncomingStatus");
  const sharedIncomingList = document.querySelector("#sharedIncomingList");
  const refreshSharedIncoming = document.querySelector("#refreshSharedIncoming");
  const sharedIncomingReport = document.querySelector("#sharedIncomingReport");
  const battleHistoryPanel = document.querySelector("#battleHistoryPanel");
  const battleHistoryCounts = document.querySelector("#battleHistoryCounts");
  const battleHistoryCoord = document.querySelector("#battleHistoryCoord");
  const battleHistoryStatus = document.querySelector("#battleHistoryStatus");
  const battleHistoryList = document.querySelector("#battleHistoryList");
  const occupationSummary = document.querySelector("#occupationSummary");
  const refreshBattleHistory = document.querySelector("#refreshBattleHistory");
  const sharedIncomingAttacker = document.querySelector("#sharedIncomingAttacker");
  const sharedIncomingDefended = document.querySelector("#sharedIncomingDefended");
  const sharedIncomingEta = document.querySelector("#sharedIncomingEta");
  const sharedIncomingSize = document.querySelector("#sharedIncomingSize");
  const sharedIncomingNote = document.querySelector("#sharedIncomingNote");
  const sharedIncomingPaste = document.querySelector("#sharedIncomingPaste");
  const sharedScoutingPanel = document.querySelector("#sharedScoutingPanel");
  const sharedScoutingCounts = document.querySelector("#sharedScoutingCounts");
  const sharedScoutingStatus = document.querySelector("#sharedScoutingStatus");
  const sharedScoutingList = document.querySelector("#sharedScoutingList");
  const refreshSharedScouting = document.querySelector("#refreshSharedScouting");
  const sharedScoutCreate = document.querySelector("#sharedScoutCreate");
  const sharedScoutCreateForm = document.querySelector("#sharedScoutCreateForm");
  const sharedScoutName = document.querySelector("#sharedScoutName");
  const sharedScoutKind = document.querySelector("#sharedScoutKind");
  const sharedScoutTargets = document.querySelector("#sharedScoutTargets");
  const sharedMyWatches = document.querySelector("#sharedMyWatches");

  const urlParams = new URLSearchParams(location.search);
  const miniAppAccess = urlParams.get("access") || "";
  const botApiUrl = String(config.BOT_API_URL || "https://b24-vision-bot.onrender.com").replace(/\/$/, "");
  const defaultGalaxy = normalizeGalaxy(config.GALAXY || galaxyFromMapId(config.MAP_ID) || "B24");
  const initialLocation = normalizeExternalLocation(urlParams.get("loc"));
  let galaxy = normalizeGalaxy(urlParams.get("gal")) || galaxyFromLocation(initialLocation) || defaultGalaxy;
  let mapId = galaxyToMapId(galaxy);
  let storageKey = storageKeyFor(mapId, "");
  const hasSupabase = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase);
  const telegramUser = getTelegramUser();
  const user = formatTelegramUser(telegramUser);
  let telegramChatId = getTelegramChatId();
  let selected = `${galaxy}:1`;
  let highlightedSector = "";
  let client = null;
  let realtimeChannel = null;
  let intel = loadLocalState();
  let miniAppSession = null;
  let coverageByRegion = new Map();
  let sharedAttackData = { attacks: [], role: "member", canManage: false, userId: "" };
  let sharedIncomingData = { incoming: [], role: "member", canManage: false, userId: "" };
  let sharedScoutingData = { agendas: [], myWatches: [], role: "member", canManage: false, userId: "" };
  let sharedBattleHistoryData = { coord: "", occupation: null, timeline: [] };
  let selectedHistoryCoord = "";
  let sharedIntelByRegion = new Map();
  let intelLoadSequence = 0;
  let sharedRefreshBusy = false;

  init();

  async function init() {
    if (shouldBlockDirectAccess()) {
      renderAccessRequired();
      return;
    }

    tg?.ready();
    tg?.expand();

    if (miniAppAccess) {
      miniAppSession = await loadMiniAppSession();
      if (!miniAppSession) {
        renderAccessRequired("This map link has expired or your Lysander access was removed.");
        return;
      }
      galaxy = normalizeGalaxy(miniAppSession.galaxy) || galaxy;
      telegramChatId = miniAppSession.chatId || telegramChatId;
    }

    if (hasSupabase && !miniAppSession && !urlParams.get("gal") && !initialLocation) {
      client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      const [preferredGalaxy, preferredChatId] = await Promise.all([
        loadPreferredGalaxy(),
        loadPreferredChatId()
      ]);
      if (!telegramChatId && preferredChatId) telegramChatId = preferredChatId;
      setGalaxy(preferredGalaxy || galaxy);
    } else {
      setGalaxy(galaxy);
    }

    populateArrivalOptions();
    if (miniAppSession) {
      try {
        document.body.classList.add("signed-session");
        sharedAttacksPanel.hidden = false;
        sharedIncomingPanel.hidden = false;
        sharedScoutingPanel.hidden = false;
        battleHistoryPanel.hidden = false;
        await Promise.all([loadCoverage(), loadSharedAttacks(), loadSharedIncoming(), loadSharedScouting()]);
      } catch {
        renderAccessRequired("Lysander could not load the live coverage map. Please try /map again.");
        return;
      }
    }
    renderGrid();
    bindControls();
    selectSector(selected);
    renderAttackBoard();
    renderIncomingBoard();
    renderBulkTargets();
    setInterval(tickClaims, 1000);
    if (miniAppSession) setInterval(refreshSharedViews, 20000);

    // Signed sessions use the bot API as their trust boundary. Do not silently
    // re-enable the legacy browser-to-Supabase path if public keys are present.
    if (hasSupabase && !miniAppSession) {
      connectSupabase();
    } else {
      setSync(miniAppSession ? "Live" : "Local", Boolean(miniAppSession));
    }
  }

  function setGalaxy(nextGalaxy) {
    galaxy = normalizeGalaxy(nextGalaxy) || defaultGalaxy;
    mapId = galaxyToMapId(galaxy);
    storageKey = storageKeyFor(mapId, telegramChatId);
    selected = `${galaxy}:1`;
    SECTORS = Array.from({ length: 100 }, (_, index) => {
      return index === 0 ? "00" : `${galaxy}:${index}`;
    });
    PLAYABLE_SECTORS = SECTORS.slice(1);
    intel = loadLocalState();
    if (headerGalaxy) headerGalaxy.textContent = galaxy;
    document.title = `${galaxy} Vision Tracker`;
    grid.setAttribute("aria-label", `${galaxy} sector map`);
    claimTarget.placeholder = `${galaxy}:44:76:10`;
    highlightedSector = locationToRegion(initialLocation, galaxy);
    if (highlightedSector) selected = highlightedSector;
  }

  function shouldBlockDirectAccess() {
    if (location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1") return false;
    if (!/github\.io$/i.test(location.hostname)) return false;
    return !miniAppAccess;
  }

  function renderAccessRequired(reason = "Open this map from Lysander in Telegram.") {
    document.body.classList.add("access-locked");
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    shell.innerHTML = [
      `<section class="access-lock">`,
      `<h1>VisionBot Access Required</h1>`,
      `<p>${escapeHtml(reason)}</p>`,
      `<p>Use <code>/map</code> in your approved guild group or DM.</p>`,
      `</section>`
    ].join("");
  }

  async function loadMiniAppSession() {
    try {
      return await miniAppApi("/api/miniapp/session");
    } catch {
      return null;
    }
  }

  async function miniAppApi(path, options = {}) {
    const method = options.method || "GET";
    const request = { method, headers: { "Content-Type": "application/json" } };
    let url = `${botApiUrl}${path}`;
    if (method === "GET") {
      const separator = url.includes("?") ? "&" : "?";
      url += `${separator}access=${encodeURIComponent(miniAppAccess)}`;
    } else {
      request.body = JSON.stringify({ access: miniAppAccess, ...(options.body || {}) });
    }
    let response;
    try {
      response = await fetch(url, request);
    } catch {
      throw new Error("Lysander is unreachable. Try again in a moment.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Lysander could not complete that request.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadCoverage() {
    if (!miniAppAccess) return;
    const payload = await miniAppApi("/api/miniapp/coverage");
    coverageByRegion = new Map((payload.sectors || []).map((sector) => [sector.region, sector]));
  }

  async function loadSharedAttacks() {
    if (!miniAppAccess) return;
    sharedAttackStatus.textContent = "Loading attack plans...";
    sharedAttackData = await miniAppApi("/api/miniapp/attacks");
    renderSharedAttacks();
  }

  async function loadSharedIncoming() {
    if (!miniAppAccess) return;
    sharedIncomingStatus.textContent = "Loading incoming reports...";
    sharedIncomingData = await miniAppApi("/api/miniapp/incoming");
    renderSharedIncoming();
  }

  async function loadSharedScouting() {
    if (!miniAppAccess) return;
    sharedScoutingStatus.textContent = "Loading scouting agendas...";
    sharedScoutingData = await miniAppApi("/api/miniapp/scouting");
    renderSharedScouting();
  }

  async function loadBattleHistory(coord = selectedHistoryCoord, focus = false) {
    if (!miniAppAccess || !coord) return;
    selectedHistoryCoord = coord;
    battleHistoryPanel.hidden = false;
    battleHistoryPanel.open = true;
    battleHistoryCoord.textContent = coord;
    battleHistoryCounts.textContent = "Loading...";
    occupationSummary.textContent = "Loading current occupation state...";
    battleHistoryStatus.textContent = "Loading coordinate timeline...";
    battleHistoryList.innerHTML = "";
    try {
      sharedBattleHistoryData = await miniAppApi(`/api/miniapp/battles?coord=${encodeURIComponent(coord)}`);
      renderBattleHistory();
      if (focus) battleHistoryPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      battleHistoryCounts.textContent = "Unavailable";
      occupationSummary.textContent = error.status === 401 ? "Session expired. Open a fresh /map link from Lysander." : "Current occupation state could not be loaded.";
      battleHistoryStatus.textContent = error.status === 401 ? "Your signed session has expired." : (error.message || "Could not load battle history.");
      throw error;
    }
  }

  async function loadSharedIntel(region, force = false) {
    if (!miniAppAccess || !region) return;
    if (!force && sharedIntelByRegion.has(region)) return applySharedIntel(sharedIntelByRegion.get(region));
    const sequence = ++intelLoadSequence;
    const payload = await miniAppApi(`/api/miniapp/intel?region=${encodeURIComponent(region)}`);
    sharedIntelByRegion.set(payload.region, payload);
    applySharedIntel(payload);
    if (sequence === intelLoadSequence && selected === payload.region) renderSectorPanel(selected);
  }

  async function refreshSharedViews() {
    if (!miniAppSession || sharedRefreshBusy || document.hidden) return;
    sharedRefreshBusy = true;
    try {
      await Promise.all([loadCoverage(), loadSharedAttacks(), loadSharedIncoming(), loadSharedScouting(), selectedHistoryCoord ? loadBattleHistory(selectedHistoryCoord) : Promise.resolve(), loadSharedIntel(selected, true)]);
      paintAll();
      selectSector(selected);
      setSync("Live", true);
    } catch (error) {
      setSync(error.message || "Refresh failed");
    } finally {
      sharedRefreshBusy = false;
    }
  }

  async function updateWatch(region, action) {
    try {
      const payload = await miniAppApi("/api/miniapp/watch", { method: "POST", body: { region, action } });
      coverageByRegion = new Map((payload.sectors || []).map((sector) => [sector.region, sector]));
      paintAll();
      selectSector(region);
      setSync("Live", true);
    } catch (error) {
      setSync(error.message || "Watch update failed");
      window.alert(error.message || "Could not update this watch.");
    }
  }

  async function updateSharedAttack(body, successMessage) {
    sharedAttackStatus.textContent = "Saving...";
    try {
      sharedAttackData = await miniAppApi("/api/miniapp/attacks", { method: "POST", body });
      renderSharedAttacks();
      sharedAttackStatus.textContent = successMessage || "Attack plans updated.";
      setSync("Live", true);
      return true;
    } catch (error) {
      sharedAttackStatus.textContent = error.message || "Attack update failed.";
      window.alert(error.message || "Could not update the attack plan.");
      return false;
    }
  }

  async function updateSharedIncoming(body, successMessage) {
    sharedIncomingStatus.textContent = "Saving...";
    try {
      sharedIncomingData = await miniAppApi("/api/miniapp/incoming", { method: "POST", body });
      renderSharedIncoming();
      sharedIncomingStatus.textContent = successMessage || "Incoming reports updated.";
      setSync("Live", true);
      return true;
    } catch (error) {
      sharedIncomingStatus.textContent = error.message || "Incoming update failed.";
      window.alert(error.message || "Could not update incoming reports.");
      return false;
    }
  }

  async function updateSharedScouting(body, successMessage) {
    sharedScoutingStatus.textContent = "Saving...";
    try {
      sharedScoutingData = await miniAppApi("/api/miniapp/scouting", { method: "POST", body });
      renderSharedScouting();
      await loadCoverage();
      paintAll();
      sharedScoutingStatus.textContent = successMessage || "Scouting updated.";
      setSync("Live", true);
      return true;
    } catch (error) {
      sharedScoutingStatus.textContent = error.message || "Scouting update failed.";
      window.alert(error.message || "Could not update scouting.");
      return false;
    }
  }

  async function reportSharedIncoming(event) {
    event.preventDefault();
    const ok = await updateSharedIncoming({
      action: "report",
      attackerCoord: sharedIncomingAttacker.value,
      defendedCoord: sharedIncomingDefended.value,
      eta: sharedIncomingEta.value,
      size: sharedIncomingSize.value,
      note: sharedIncomingNote.value,
      reportText: sharedIncomingPaste.value
    }, "Incoming report saved.");
    if (ok) {
      sharedIncomingAttacker.value = "";
      sharedIncomingDefended.value = "";
      sharedIncomingEta.value = "";
      sharedIncomingSize.value = "";
      sharedIncomingNote.value = "";
      sharedIncomingPaste.value = "";
    }
  }

  async function handleSharedIncomingAction(event) {
    const button = event.target.closest("[data-incoming-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.incomingAction;
    const incomingId = button.dataset.incomingId;
    if (action === "clear" && !window.confirm("Clear this as a false incoming report for everyone?")) return;
    const messages = {
      cover: "Defense coverage assigned to you.",
      release: "Defense coverage released.",
      clear: "False incoming report cleared."
    };
    await updateSharedIncoming({ action, incomingId }, messages[action]);
  }

  async function createSharedScoutAgenda(event) {
    event.preventDefault();
    const ok = await updateSharedScouting({
      action: "create",
      name: sharedScoutName.value,
      kind: sharedScoutKind.value,
      targets: sharedScoutTargets.value
    }, "Scouting agenda created.");
    if (ok) {
      sharedScoutName.value = "";
      sharedScoutTargets.value = "";
    }
  }

  async function handleSharedScoutingAction(event) {
    const button = event.target.closest("[data-scout-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.scoutAction;
    const operationId = button.dataset.operationId;
    const agendaKey = button.dataset.agendaKey;
    if (action === "cancel" && !window.confirm("Cancel this scouting agenda for everyone?")) return;
    const body = { action, operationId, agendaKey };
    if (action === "create-attack") body.hours = Number(button.dataset.hours || 4);
    const messages = {
      take: "Watch responsibility assigned to you.",
      release: "Watch responsibility released.",
      cancel: "Scouting agenda cancelled.",
      "create-attack": "Attack created from this scouting agenda."
    };
    const ok = await updateSharedScouting(body, messages[action]);
    if (ok && action === "create-attack") await loadSharedAttacks();
  }

  function renderSharedScouting() {
    if (!sharedScoutingPanel) return;
    const agendas = sharedScoutingData.agendas || [];
    const watches = sharedScoutingData.myWatches || [];
    const targetCount = agendas.reduce((sum, agenda) => sum + Number(agenda.targetCount || 0), 0);
    const assignedCount = agendas.reduce((sum, agenda) => sum + Number(agenda.assignedCount || 0), 0);
    sharedScoutingPanel.hidden = false;
    sharedScoutCreate.hidden = !sharedScoutingData.canManage;
    sharedScoutingCounts.textContent = `${agendas.length} agenda${agendas.length === 1 ? "" : "s"} | ${assignedCount}/${targetCount} watched`;
    sharedMyWatches.innerHTML = watches.length
      ? `<strong>Your watches:</strong> ${watches.map((watch) => escapeHtml(watch.coord)).join(", ")}`
      : "You have no active watch responsibilities.";
    if (!agendas.length) {
      sharedScoutingStatus.textContent = sharedScoutingData.canManage
        ? "No active scouting agendas. Create one here or from a Telegram base search."
        : "No active scouting agendas.";
      sharedScoutingList.innerHTML = "";
      return;
    }
    sharedScoutingStatus.textContent = `Showing ${agendas.length} live scouting agenda${agendas.length === 1 ? "" : "s"}.`;
    sharedScoutingList.innerHTML = agendas.map(renderSharedScoutCard).join("");
  }

  function renderBattleHistory() {
    if (!battleHistoryPanel) return;
    const timeline = sharedBattleHistoryData.timeline || [];
    const occupation = sharedBattleHistoryData.occupation;
    battleHistoryPanel.hidden = false;
    battleHistoryCoord.textContent = sharedBattleHistoryData.coord || selectedHistoryCoord;
    battleHistoryCounts.textContent = `${timeline.length} event${timeline.length === 1 ? "" : "s"}`;
    if (occupation?.inconsistent) {
      const contradiction = occupation.contradiction;
      occupationSummary.innerHTML = `<div class="occupation-row is-inconsistent"><strong>Occupation state inconsistent</strong><span>Stored current-state row: <b>${escapeHtml(occupation.state)}</b> by <b>${escapeHtml(occupation.occupier)}</b></span><span>Owner: <b>${escapeHtml(occupation.owner)}</b></span><span>Newer ${escapeHtml(contradiction?.kind || "liberation evidence")}: <b>${escapeHtml(contradiction?.effectiveAt || "time unknown")}</b></span><span>Treat occupation as unconfirmed until the state row is refreshed.</span></div>`;
    } else if (occupation?.active) {
      const force = [occupation.occupyingFleet, occupation.occupyingFleetSize != null ? Number(occupation.occupyingFleetSize).toLocaleString() : ""].filter(Boolean).join(" / ");
      occupationSummary.innerHTML = `<div class="occupation-row"><strong>Currently occupied</strong><span>Owner: <b>${escapeHtml(occupation.owner)}</b></span><span>Occupier: <b>${escapeHtml(occupation.occupier)}</b></span>${force ? `<span>Occupying force: <b>${escapeHtml(force)}</b></span>` : ""}</div>`;
    } else if (occupation) {
      occupationSummary.innerHTML = `<div class="occupation-row is-ended"><strong>No active occupation</strong><span>Current state: <b>${escapeHtml(occupation.state)}</b></span><span>Recorded owner: <b>${escapeHtml(occupation.owner)}</b></span></div>`;
    } else {
      occupationSummary.textContent = "No current occupation-state record for this coordinate.";
    }
    if (!timeline.length) {
      battleHistoryStatus.textContent = "No completed battle, revolt/liberation, or battle-fleet evidence is stored for this coordinate.";
      battleHistoryList.innerHTML = "";
      return;
    }
    battleHistoryStatus.textContent = "Newest effective battle/event time first.";
    battleHistoryList.innerHTML = timeline.map(renderBattleHistoryItem).join("");
  }

  function renderBattleHistoryItem(item) {
    const time = item.usedFallbackTime ? `${item.effectiveAt} (import-time fallback)` : item.effectiveAt;
    if (item.kind === "battle") {
      const losses = [item.losses?.total != null ? `${Number(item.losses.total).toLocaleString()} total losses` : "", item.losses?.attacker != null ? `attacker ${Number(item.losses.attacker).toLocaleString()}` : "", item.losses?.defender != null ? `defender ${Number(item.losses.defender).toLocaleString()}` : ""].filter(Boolean).join(" / ");
      const loot = [item.loot?.attacker != null ? `attacker loot ${Number(item.loot.attacker).toLocaleString()}` : "", item.loot?.defender != null ? `defender loot ${Number(item.loot.defender).toLocaleString()}` : "", item.debris != null ? `${Number(item.debris).toLocaleString()} debris` : "", item.pillage != null ? `${Number(item.pillage).toLocaleString()} pillage` : ""].filter(Boolean).join(" / ");
      const forces = [item.attackerSurvivors ? `Attacker survivors: ${item.attackerSurvivors}` : "", item.defenderSurvivors ? `Defender survivors: ${item.defenderSurvivors}` : ""].filter(Boolean);
      return `<article class="battle-history-card"><header><div><span class="shared-kicker">${escapeHtml(item.outcome)}</span><strong>${escapeHtml(item.attacker)} vs ${escapeHtml(item.defender)}</strong></div><time>${escapeHtml(time)}</time></header>${losses ? `<p>${escapeHtml(losses)}</p>` : ""}${loot ? `<small>${escapeHtml(loot)}</small>` : ""}${item.finalDefenses != null ? `<small>Final defenses: ${escapeHtml(item.finalDefenses)}%</small>` : ""}${forces.map((force) => `<small>${escapeHtml(force)}</small>`).join("")}</article>`;
    }
    if (item.kind === "event") return `<article class="battle-history-card"><header><div><span class="shared-kicker">EVENT</span><strong>${escapeHtml(item.eventType || "event")}</strong></div><time>${escapeHtml(time)}</time></header><p>${escapeHtml([item.label, item.actor].filter(Boolean).join(" / ") || "Recorded game event")}</p></article>`;
    if (item.kind === "occupation_state") return `<article class="battle-history-card"><header><div><span class="shared-kicker">CURRENT-STATE EVIDENCE${item.inconsistent ? " / STALE" : ""}</span><strong>Occupation ${escapeHtml(item.state)}${item.inconsistent ? " (inconsistent)" : ""}</strong></div><time>${escapeHtml(time)}</time></header><p>Owner: ${escapeHtml(item.owner)}</p><small>Occupier: ${escapeHtml(item.occupier)}</small>${item.inconsistent ? `<small>Newer ${escapeHtml(item.contradiction?.kind || "liberation evidence")}: ${escapeHtml(item.contradiction?.effectiveAt || "time unknown")}</small>` : ""}</article>`;
    const force = item.survivors || (item.size != null ? Number(item.size).toLocaleString() : "Unknown force");
    return `<article class="battle-history-card"><header><div><span class="shared-kicker">BATTLE OBSERVATION</span><strong>${escapeHtml(item.party)}</strong></div><time>${escapeHtml(time)}</time></header><p>${escapeHtml(force)}${item.destroyed ? " / destroyed" : ""}</p></article>`;
  }

  function renderSharedScoutCard(agenda) {
    const targets = (agenda.targets || []).map((target) => {
      const state = target.assigned ? `Watched by ${target.assignedTo || "guild member"}` : "Needs watcher";
      let action = "";
      if (target.mine) {
        action = `<button class="ghost-button" type="button" data-scout-action="release" data-operation-id="${escapeHtml(target.operationId)}">Release</button>`;
      } else if (!target.assigned) {
        action = `<button class="command-button" type="button" data-scout-action="take" data-operation-id="${escapeHtml(target.operationId)}">Take Watch</button>`;
      }
      return `<div class="shared-scout-target${target.mine ? " mine" : ""}"><div><strong>${escapeHtml(target.coord)}</strong><span>${escapeHtml(state)}</span></div>${action}</div>`;
    }).join("");
    const officerActions = sharedScoutingData.canManage ? [
      agenda.kind === "base" ? `<button class="ghost-button" type="button" data-scout-action="create-attack" data-agenda-key="${escapeHtml(agenda.key)}" data-hours="4">Attack in 4h</button>` : "",
      `<button class="danger-button" type="button" data-scout-action="cancel" data-agenda-key="${escapeHtml(agenda.key)}">Cancel Agenda</button>`
    ].join("") : "";
    return [
      `<article class="shared-scout-card">`,
      `<header><div><span class="shared-kicker">${escapeHtml(agenda.kind === "region" ? "REGION COVERAGE" : "BASE WATCH")}</span><h3>${escapeHtml(agenda.name)}</h3></div><span>${agenda.assignedCount}/${agenda.targetCount} assigned</span></header>`,
      `<div class="shared-scout-targets">${targets || `<p class="shared-empty">No active targets.</p>`}</div>`,
      `<footer><span>${agenda.openCount} still need coverage</span><div class="incoming-actions">${officerActions}</div></footer>`,
      `</article>`
    ].join("");
  }

  function applySharedIntel(payload) {
    if (!payload?.region) return;
    const region = payload.region;
    intel.systems[region] = [];
    Object.keys(intel.bases || {}).forEach((coord) => {
      if (intel.bases[coord]?.region === region) delete intel.bases[coord];
    });
    Object.keys(intel.astros || {}).forEach((coord) => {
      if (intel.astros[coord]?.region === region) delete intel.astros[coord];
    });
    (payload.systems || []).forEach((row) => mergeSystemRow({ region_id: region, system_id: row.systemId, coord: row.coord, updated_at: row.updatedAt }));
    (payload.bases || []).forEach((row) => mergeBaseRow({ region_id: region, system_id: row.systemId, coord: row.coord, guild: row.guild, label: row.label, updated_at: row.updatedAt }));
    (payload.astros || []).forEach((row) => mergeAstroRow({ region_id: region, system_id: row.systemId, coord: row.coord, terrain: row.terrain, astro_type: row.type, attributes: row.attributes, has_base: row.hasBase, updated_at: row.updatedAt }));
    if (selected === region) {
      paintSector(region);
      selectedSystems.textContent = `${getSystemCount(region)} known`;
      selectedBases.textContent = `${getBaseCount(region)} known`;
    }
  }

  async function createSharedAttack(event) {
    event.preventDefault();
    const arrival = new Date(sharedAttackArrival.value);
    if (!Number.isFinite(arrival.getTime())) {
      sharedAttackStatus.textContent = "Choose a valid landing date and time.";
      return;
    }
    const ok = await updateSharedAttack({
      action: "create",
      name: sharedAttackName.value,
      arrivalAt: arrival.toISOString(),
      waves: Number(sharedAttackWaves.value),
      targets: sharedAttackTargets.value
    }, "Attack plan created.");
    if (ok) {
      sharedAttackName.value = "";
      sharedAttackTargets.value = "";
    }
  }

  async function handleSharedAttackAction(event) {
    const button = event.target.closest("[data-shared-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.sharedAction;
    const operationId = button.dataset.operationId;
    const coord = button.dataset.coord;
    const wave = Number(button.dataset.wave || 0);
    if (action === "stand-down" && !window.confirm("Stand down this attack plan for everyone?")) return;
    if (action === "add-targets") {
      const card = button.closest(".shared-attack-card");
      const targets = card?.querySelector("[data-shared-target-input]")?.value || "";
      if (!targets.trim()) return;
      await updateSharedAttack({ action, operationId, targets }, "Targets added.");
      return;
    }
    const messages = {
      claim: `Claimed ${coord} wave ${wave}.`,
      release: `Released ${coord} wave ${wave}.`,
      sent: `Marked ${coord} wave ${wave} sent.`,
      "stand-down": "Attack plan stood down."
    };
    await updateSharedAttack({ action, operationId, coord, wave }, messages[action]);
  }

  function renderSharedAttacks() {
    if (!sharedAttacksPanel) return;
    const attacks = sharedAttackData.attacks || [];
    sharedAttacksPanel.hidden = false;
    sharedAttackCreate.hidden = !sharedAttackData.canManage;
    sharedAttackCounts.textContent = `${attacks.length} active`;
    if (!sharedAttackArrival.value) {
      const defaultArrival = new Date(Date.now() + 4 * 60 * 60 * 1000);
      defaultArrival.setMinutes(Math.ceil(defaultArrival.getMinutes() / 15) * 15, 0, 0);
      sharedAttackArrival.value = localDateTimeInput(defaultArrival);
      sharedAttackArrival.min = localDateTimeInput(new Date(Date.now() + 60 * 1000));
    }
    if (!attacks.length) {
      sharedAttackStatus.textContent = sharedAttackData.canManage
        ? "No active attack plans. Create one here or with Lysander in Telegram."
        : "No active attack plans.";
      sharedAttackList.innerHTML = "";
      return;
    }
    sharedAttackStatus.textContent = `Showing ${attacks.length} live plan${attacks.length === 1 ? "" : "s"}.`;
    sharedAttackList.innerHTML = attacks.map(renderSharedAttackCard).join("");
  }

  function renderSharedIncoming() {
    if (!sharedIncomingPanel) return;
    const rows = sharedIncomingData.incoming || [];
    const open = rows.filter((row) => !row.coveredByUserId).length;
    const covered = rows.length - open;
    sharedIncomingPanel.hidden = false;
    sharedIncomingCounts.textContent = `${rows.length} active | ${open} open | ${covered} covered`;
    if (!rows.length) {
      sharedIncomingStatus.textContent = "No hostile arrivals are currently active.";
      sharedIncomingList.innerHTML = `<p class="shared-empty">New Telegram reports will appear here automatically.</p>`;
      return;
    }
    sharedIncomingStatus.textContent = `Showing ${rows.length} hostile arrival${rows.length === 1 ? "" : "s"}, soonest first.`;
    sharedIncomingList.innerHTML = rows.map(renderSharedIncomingCard).join("");
  }

  function renderSharedIncomingCard(row) {
    const defended = row.defendedCoord || row.defendedLabel || "Defended base unknown";
    const attacker = row.attackerCoord || row.attackerGuild || "Origin unknown";
    const attackerDetails = [row.attackerGuild, row.attackerPlayer].filter(Boolean).join(" ");
    const coverage = row.coveredByUserId
      ? `<span class="incoming-state covered">Covered by ${escapeHtml(row.coveredBy || "guild member")}</span>`
      : `<span class="incoming-state open">Needs coverage</span>`;
    let actions = "";
    if (!row.coveredByUserId) {
      actions += `<button class="command-button" type="button" data-incoming-action="cover" data-incoming-id="${escapeHtml(row.id)}">Cover</button>`;
    } else if (row.mine) {
      actions += `<button class="ghost-button" type="button" data-incoming-action="release" data-incoming-id="${escapeHtml(row.id)}">Release</button>`;
    }
    if (sharedIncomingData.canManage) {
      actions += `<button class="danger-button" type="button" data-incoming-action="clear" data-incoming-id="${escapeHtml(row.id)}">Clear False Report</button>`;
    }
    return [
      `<article class="shared-incoming-card${row.coveredByUserId ? " is-covered" : ""}">`,
      `<header><div><span class="shared-kicker">${escapeHtml(row.operationShortId || "INCOMING")}</span><h3>${escapeHtml(defended)}</h3></div>`,
      `<div class="shared-attack-time"><strong>${escapeHtml(formatCountdown(row.arrivalAt, "Landing now"))}</strong><span>${escapeHtml(formatLocalDateTime(row.arrivalAt))}</span></div></header>`,
      `<div class="incoming-route"><span>From</span><strong>${escapeHtml(attacker)}</strong>${attackerDetails ? `<em>${escapeHtml(attackerDetails)}</em>` : ""}</div>`,
      `<div class="incoming-facts"><span>Size <strong>${escapeHtml(row.size || "Unknown")}</strong></span><span>Reported by <strong>${escapeHtml(row.reporter)}</strong></span>${row.note ? `<span>Note <strong>${escapeHtml(row.note)}</strong></span>` : ""}</div>`,
      `<footer>${coverage}<div class="incoming-actions">${actions}</div></footer>`,
      `</article>`
    ].join("");
  }

  function renderSharedAttackCard(attack) {
    const totals = `${attack.targetCount} targets | ${attack.claimedWaves}/${attack.totalWaves} claimed | ${attack.sentWaves} sent`;
    const targets = attack.targets.length
      ? attack.targets.map((target, index) => renderSharedAttackTarget(attack, target, index)).join("")
      : `<p class="shared-empty">No targets have been added yet.</p>`;
    const officerTools = attack.canManage ? [
      `<div class="shared-attack-manage">`,
      `<textarea data-shared-target-input spellcheck="false" placeholder="Paste target coordinates to add"></textarea>`,
      `<button class="ghost-button" type="button" data-shared-action="add-targets" data-operation-id="${escapeHtml(attack.id)}">Add Targets</button>`,
      `<button class="danger-button" type="button" data-shared-action="stand-down" data-operation-id="${escapeHtml(attack.id)}">Stand Down</button>`,
      `</div>`
    ].join("") : "";
    return [
      `<article class="shared-attack-card">`,
      `<header><div><span class="shared-kicker">${escapeHtml(attack.shortId)}</span><h3>${escapeHtml(attack.name)}</h3></div>`,
      `<div class="shared-attack-time"><strong>${escapeHtml(formatLocalDateTime(attack.arrivalAt))}</strong><span>${escapeHtml(formatCountdown(attack.arrivalAt, "Landing now"))}</span></div></header>`,
      `<p class="shared-attack-meta">Commander: ${escapeHtml(attack.commander)} | ${escapeHtml(totals)}</p>`,
      `<div class="shared-targets">${targets}</div>`,
      officerTools,
      `</article>`
    ].join("");
  }

  function renderSharedAttackTarget(attack, target, index) {
    const waves = target.waves.map((wave) => {
      const base = `data-operation-id="${escapeHtml(attack.id)}" data-coord="${escapeHtml(target.coord)}" data-wave="${wave.index}"`;
      if (wave.state === "open") {
        return `<button class="shared-wave open" type="button" data-shared-action="claim" ${base}>W${wave.index}<span>${escapeHtml(wave.label)}</span></button>`;
      }
      if (wave.mine && wave.state === "claimed") {
        return `<div class="shared-wave-owned"><button class="shared-wave mine" type="button" data-shared-action="sent" ${base}>W${wave.index} Mine<span>Mark sent</span></button><button class="shared-release" type="button" data-shared-action="release" ${base}>Release</button></div>`;
      }
      const label = wave.mine ? "Sent by you" : wave.claimedBy || wave.state;
      return `<button class="shared-wave ${wave.state}" type="button" disabled>W${wave.index}<span>${escapeHtml(label)}</span></button>`;
    }).join("");
    return [
      `<details class="shared-target"${index === 0 ? " open" : ""}>`,
      `<summary><strong>${String(index + 1).padStart(2, "0")} ${escapeHtml(target.coord)}</strong><span>${target.claimedWaves}/${target.totalWaves} claimed</span></summary>`,
      `<div class="shared-waves">${waves}</div>`,
      `</details>`
    ].join("");
  }

  function localDateTimeInput(value) {
    const date = new Date(value);
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderGrid() {
    const fragment = document.createDocumentFragment();

    SECTORS.forEach((id) => {
      const cell = template.content.firstElementChild.cloneNode(true);
      cell.dataset.sector = id;
      cell.querySelector(".coord").textContent = id;

      if (id === "00") {
        cell.className = "cell empty";
        cell.disabled = true;
        cell.setAttribute("aria-label", "Empty sector");
      } else {
        cell.addEventListener("click", () => selectSector(id));
      }

      fragment.appendChild(cell);
    });

    grid.appendChild(fragment);
    paintAll();
  }

  function bindControls() {
    toolButtons.forEach((button) => {
      if (miniAppSession) {
        button.disabled = true;
        button.title = "Map status is managed by Lysander intel and watch assignments.";
      }
      button.addEventListener("click", () => {
        if (miniAppSession) return;
        applyFlag(button.dataset.flag);
      });
    });

    importButton.addEventListener("click", importIntel);
    bookmarkletButton.addEventListener("click", copyBookmarklet);
    claimButton.addEventListener("click", createClaim);
    attackWindowStart.addEventListener("change", () => {
      populateArrivalOptions();
      renderWindowSummary();
      renderBulkTargets();
    });
    finalizeAttackButton.addEventListener("click", finalizeParsedAttack);
    bulkTargetText.addEventListener("input", renderBulkTargets);
    bulkClearButton.addEventListener("click", () => {
      bulkTargetText.value = "";
      renderBulkTargets();
    });
    parsedTargets.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-claim-target]");
      if (!button) return;
      const row = button.closest(".target-row");
      const arrivalLabel = row?.querySelector("[data-wave-time]")?.value || "";
      await createClaimForTarget(button.dataset.claimTarget, button.dataset.claimNote || "", arrivalLabel);
      renderBulkTargets();
    });
    claimList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-unclaim]");
      if (button) unclaim(button.dataset.unclaim);
    });
    attackBoard.addEventListener("click", (event) => {
      const confirmButton = event.target.closest("[data-confirm-claim]");
      if (confirmButton) confirmClaim(confirmButton.dataset.confirmClaim, true);

      const unconfirmButton = event.target.closest("[data-unconfirm-claim]");
      if (unconfirmButton) confirmClaim(unconfirmButton.dataset.unconfirmClaim, false);

      const unclaimButton = event.target.closest("[data-unclaim]");
      if (unclaimButton) unclaim(unclaimButton.dataset.unclaim);
    });
    confirmFleetButton.addEventListener("click", confirmFleetPaste);
    sectorPanel.addEventListener("click", (event) => {
      const historyButton = event.target.closest("[data-history-coord]");
      if (historyButton) {
        loadBattleHistory(historyButton.dataset.historyCoord, true).catch(() => {});
        return;
      }
      const button = event.target.closest("[data-watch-action]");
      if (button) updateWatch(button.dataset.watchRegion, button.dataset.watchAction);
    });
    refreshSharedAttacks?.addEventListener("click", refreshSharedViews);
    sharedAttackCreate?.addEventListener("submit", createSharedAttack);
    sharedAttackList?.addEventListener("click", handleSharedAttackAction);
    refreshSharedIncoming?.addEventListener("click", refreshSharedViews);
    sharedIncomingReport?.addEventListener("submit", reportSharedIncoming);
    sharedIncomingList?.addEventListener("click", handleSharedIncomingAction);
    refreshSharedScouting?.addEventListener("click", refreshSharedViews);
    sharedScoutCreateForm?.addEventListener("submit", createSharedScoutAgenda);
    sharedScoutingList?.addEventListener("click", handleSharedScoutingAction);
    refreshBattleHistory?.addEventListener("click", async () => {
      if (!selectedHistoryCoord) {
        battleHistoryStatus.textContent = "Select View history from a known base or astro first.";
        return;
      }
      try { await loadBattleHistory(); setSync("Live", true); } catch {}
    });
  }

  async function connectSupabase() {
    setSync("Syncing");
    client ||= window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

    try {
      await Promise.all([
        loadRemoteSectors(),
        loadRemoteSystems(),
        loadRemoteBases(),
        loadRemoteAstros(),
        loadRemoteClaims(),
        loadRemoteOperations(),
        loadRemoteIncoming()
      ]);
      paintAll();
      selectSector(selected);
      renderAttackBoard();
      renderIncomingBoard();
      renderBulkTargets();
      setSync("Live", true);

      realtimeChannel = client
        .channel(`b24-intel-${mapId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "b24_sectors", filter: `map_id=eq.${mapId}` },
          (payload) => {
            mergeSectorRow(payload.new);
            saveLocalState();
            paintSector(payload.new.sector_id);
            if (payload.new.sector_id === selected) selectSector(selected);
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "b24_systems", filter: `map_id=eq.${mapId}` },
          (payload) => {
            mergeSystemRow(payload.new);
            saveLocalState();
            paintSector(payload.new.region_id);
            if (payload.new.region_id === selected) selectSector(selected);
            renderAttackBoard();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "b24_bases", filter: `map_id=eq.${mapId}` },
          (payload) => {
            mergeBaseRow(payload.new);
            saveLocalState();
            paintSector(payload.new.region_id);
            if (payload.new.region_id === selected) selectSector(selected);
            renderAttackBoard();
            renderBulkTargets();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "b24_astros", filter: `map_id=eq.${mapId}` },
          (payload) => {
            mergeAstroRow(payload.new);
            saveLocalState();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "b24_claims", filter: `map_id=eq.${mapId}` },
          (payload) => {
            if (!rowBelongsToCurrentChat(payload.new)) return;
            mergeClaimRow(payload.new);
            saveLocalState();
            paintSector(payload.new.region_id);
            if (payload.new.region_id === selected) selectSector(selected);
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "b24_operations", filter: `map_id=eq.${mapId}` },
          (payload) => {
            if (!rowBelongsToCurrentChat(payload.new)) return;
            mergeOperationRow(payload.new);
            saveLocalState();
            const region = operationRegion(payload.new);
            paintSector(region);
            if (region === selected) selectSector(selected);
            renderAttackBoard();
            renderBulkTargets();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "b24_incoming", filter: `map_id=eq.${mapId}` },
          (payload) => {
            if (!rowBelongsToCurrentChat(payload.new)) return;
            mergeIncomingRow(payload.new);
            saveLocalState();
            renderIncomingBoard();
          }
        )
        .subscribe();
    } catch (error) {
      console.error(error);
      setSync("Local");
    }
  }

  async function loadRemoteSectors() {
    const { data, error } = await client.from("b24_sectors").select("*").eq("map_id", mapId);
    if (error) throw error;
    data.forEach(mergeSectorRow);
    saveLocalState();
  }

  async function loadRemoteSystems() {
    const { data, error } = await client.from("b24_systems").select("*").eq("map_id", mapId);
    if (error) return;
    data.forEach(mergeSystemRow);
    sortSystemLists();
    saveLocalState();
  }

  async function loadRemoteBases() {
    const { data, error } = await client.from("b24_bases").select("*").eq("map_id", mapId);
    if (error) return;
    data.forEach(mergeBaseRow);
    saveLocalState();
  }

  async function loadRemoteAstros() {
    const { data, error } = await client.from("b24_astros").select("*").eq("map_id", mapId);
    if (error) return;
    data.forEach(mergeAstroRow);
    saveLocalState();
  }

  async function loadRemoteClaims() {
    if (!telegramChatId) {
      intel.claims = {};
      saveLocalState();
      return;
    }
    const { data, error } = await client.from("b24_claims").select("*").eq("map_id", mapId).eq("chat_id", telegramChatId);
    if (error) return;
    data.forEach(mergeClaimRow);
    saveLocalState();
  }

  async function loadRemoteOperations() {
    if (!telegramChatId) {
      intel.operations = {};
      saveLocalState();
      return;
    }
    const { data, error } = await client.from("b24_operations").select("*").eq("map_id", mapId).eq("chat_id", telegramChatId);
    if (error) return;
    data.forEach(mergeOperationRow);
    saveLocalState();
  }

  async function loadRemoteIncoming() {
    if (!telegramChatId) {
      intel.incoming = {};
      saveLocalState();
      return;
    }
    const { data, error } = await client.from("b24_incoming").select("*").eq("map_id", mapId).eq("chat_id", telegramChatId);
    if (error) return;
    data.forEach(mergeIncomingRow);
    saveLocalState();
  }

  async function loadPreferredGalaxy() {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser?.id || !client) return "";
    const { data, error } = await client
      .from("b24_user_settings")
      .select("galaxy")
      .eq("user_id", String(tgUser.id))
      .limit(1);
    if (error) return "";
    return normalizeGalaxy(data?.[0]?.galaxy || "");
  }

  async function loadPreferredChatId() {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser?.id || !client) return "";
    const { data, error } = await client
      .from("b24_user_settings")
      .select("active_chat_id")
      .eq("user_id", String(tgUser.id))
      .limit(1);
    if (error) return "";
    return data?.[0]?.active_chat_id ? String(data[0].active_chat_id) : "";
  }

  function mergeSectorRow(row) {
    if (!row?.sector_id || row.sector_id === "00") return;
    const legacy = flagsFromLegacyStatus(row.status);
    intel.sectors[row.sector_id] = {
      friendly: Boolean(row.has_friendly),
      enemy: Boolean(row.has_enemy),
      scout: Boolean(row.has_scout),
      reserved: Boolean(row.has_reserved),
      ...legacy,
      updatedBy: row.updated_by || "",
      updatedAt: row.updated_at || ""
    };
  }

  function mergeOperationRow(row) {
    if (!row?.operation_id) return;
    intel.operations ||= {};
    intel.operations[row.operation_id] = {
      id: row.operation_id,
      shortId: row.short_id || "",
      type: row.type || "",
      target: row.target_coord || "",
      defended: row.defended_coord || "",
      hostile: row.hostile_origin || "",
      arrivalAt: row.arrival_at || "",
      commander: row.commander_label || "",
      status: row.status || "active",
      note: row.note || "",
      region: operationRegion(row)
    };
  }

  function mergeIncomingRow(row) {
    if (!row?.incoming_id) return;
    intel.incoming ||= {};
    intel.incoming[row.incoming_id] = {
      id: row.incoming_id,
      defended: row.defended_coord || "",
      attacker: row.attacker_coord || "",
      arrivalAt: row.arrival_at || "",
      etaMinutes: Number(row.eta_minutes || 0),
      reporter: row.reported_by || "",
      status: row.status || "active",
      note: row.note || "",
      region: incomingRegion(row)
    };
  }

  function mergeSystemRow(row) {
    if (!row?.region_id || !row?.system_id) return;
    const region = normalizeRegionId(row.region_id);
    intel.systems[region] ||= [];
    if (!intel.systems[region].includes(row.system_id)) intel.systems[region].push(row.system_id);
    sortSystemLists();
  }

  function mergeBaseRow(row) {
    if (!row?.coord) return;
    const region = normalizeRegionId(row.region_id);
    intel.bases[row.coord] = {
      coord: row.coord,
      region,
      system: row.system_id,
      guild: row.guild || "",
      label: row.label || "",
      updatedAt: row.updated_at
    };
  }

  function mergeAstroRow(row) {
    if (!row?.coord) return;
    const region = normalizeRegionId(row.region_id);
    intel.astros[row.coord] = {
      coord: row.coord,
      region,
      system: row.system_id,
      terrain: row.terrain,
      type: row.astro_type,
      attributes: row.attributes || [],
      hasBase: Boolean(row.has_base),
      updatedAt: row.updated_at
    };
  }

  function mergeClaimRow(row) {
    if (!row?.claim_id || !row?.target_coord) return;
    const target = normalizeAstro(row.target_coord);
    if (!target) return;

    intel.claims[row.claim_id] = {
      id: row.claim_id,
      target,
      region: normalizeRegionId(row.region_id),
      system: row.system_id || astroToSystem(target),
      claimedBy: row.claimed_by || "",
      arrivalAt: row.arrival_at || "",
      arrivalLabel: row.arrival_label || "",
      confirmedSent: Boolean(row.confirmed_sent),
      confirmedAt: row.confirmed_at || "",
      confirmedBy: row.confirmed_by || "",
      fleetLabel: row.fleet_label || "",
      note: row.note || "",
      status: row.status || "active",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || ""
    };
  }

  async function applyFlag(flag) {
    if (selected === "00") return;

    const stamp = new Date().toISOString();
    const sector = getSector(selected);

    if (flag === "unknown") {
      sector.friendly = false;
      sector.enemy = false;
      sector.scout = false;
      sector.reserved = false;
    } else {
      sector[flag] = !sector[flag];
    }

    sector.updatedBy = user;
    sector.updatedAt = stamp;
    intel.sectors[selected] = sector;

    saveLocalState();
    paintSector(selected);
    selectSector(selected);
    tg?.HapticFeedback?.impactOccurred("light");

    if (!client) return;

    const { error } = await client.from("b24_sectors").upsert({
      map_id: mapId,
      sector_id: selected,
      status: "unknown",
      has_friendly: sector.friendly,
      has_enemy: sector.enemy,
      has_scout: sector.scout,
      has_reserved: sector.reserved,
      updated_by: user,
      updated_at: stamp
    });

    if (error) {
      console.error(error);
      setSync("Local");
    }
  }

  async function importIntel() {
    const text = importText.value.trim();
    if (!text) {
      importResult.textContent = "Paste intel first";
      return;
    }

    try {
      const parsed = parseIntel(text);
      if (miniAppSession) {
        importResult.textContent = "Uploading through Lysander...";
        const saved = await miniAppApi("/api/miniapp/import", { method: "POST", body: { intel: parsed } });
        const previewText = parsed.battlePreviews?.length ? `, ${parsed.battlePreviews.length} unfinished battle preview skipped` : "";
        importResult.textContent = `Saved ${saved.systems} systems, ${saved.bases} bases, ${saved.astros} astros, ${saved.fleetMovements || 0} movements, ${saved.incoming} hostile incoming, ${saved.battleReports || 0} battle reports, ${saved.occupations || 0} occupations${previewText}`;
        importText.value = "";
        sharedIntelByRegion.clear();
        await Promise.all([loadCoverage(), loadSharedIntel(selected, true), loadSharedIncoming()]);
        paintAll();
        renderSectorPanel(selected);
        return;
      }
      mergeImportedIntel(parsed);
      saveLocalState();
      paintAll();
      selectSector(selected);
      const previewText = parsed.battlePreviews?.length ? `, ${parsed.battlePreviews.length} unfinished battle preview skipped` : "";
      importResult.textContent = `Imported ${parsed.systems.length} systems, ${parsed.bases.length} bases, ${parsed.astros.length} astros, ${parsed.fleetMovements.length} movements, ${parsed.incoming.length} hostile incoming, ${parsed.battleReports.length} battle reports, ${parsed.occupations.length} occupations${previewText}`;
      importText.value = "";

      if (client) await syncImportedIntel(parsed);
    } catch (error) {
      console.error(error);
      importResult.textContent = "Could not parse that paste";
    }
  }

  async function createClaim() {
    const target = normalizeAstro(claimTarget.value.trim());
    if (!target) {
      claimList.textContent = `Use a full target like ${galaxy}:44:76:10.`;
      return;
    }

    await createClaimForTarget(target, claimNote.value.trim(), claimArrival.value);
    claimTarget.value = "";
    claimNote.value = "";
  }

  async function createClaimForTarget(target, note = "", arrivalOverride = "") {
    target = normalizeAstro(target);
    if (!target) return;
    if (!attackWindowStart.value) {
      claimList.textContent = "Step 1: pick the 4 hour landing window above before claiming targets.";
      finalizeStatus.textContent = "Step 1 required: pick a landing window above.";
      return;
    }
    if (client && !telegramChatId) {
      claimList.textContent = "Open the Mini App from the approved Telegram group before creating live claims.";
      finalizeStatus.textContent = "Live claim blocked: no Telegram group scope found.";
      return;
    }

    const region = astroToRegion(target);
    if (region !== selected) selectSector(region);

    const now = new Date();
    const arrivalLabel = arrivalOverride || claimArrival.value || nearestQuarterHour(now);
    const arrivalAt = nextTimeOfDay(arrivalLabel).toISOString();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const stamp = now.toISOString();
    const claim = {
      id,
      target,
      region,
      system: astroToSystem(target),
      claimedBy: user,
      arrivalAt,
      arrivalLabel,
      confirmedSent: false,
      confirmedAt: "",
      confirmedBy: "",
      fleetLabel: "",
      note: String(note || "").trim(),
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    };

    intel.claims ||= {};
    intel.claims[id] = claim;
    saveLocalState();
    paintSector(region);
    selectSector(region);
    renderAttackBoard();
    renderBulkTargets();
    tg?.HapticFeedback?.impactOccurred("light");

    if (!client) return;

    const { error } = await client.from("b24_claims").upsert({
      map_id: mapId,
      claim_id: id,
      target_coord: target,
      region_id: region,
      system_id: claim.system,
      claimed_by: user,
      arrival_at: arrivalAt,
      arrival_label: arrivalLabel,
      confirmed_sent: false,
      confirmed_at: null,
      confirmed_by: "",
      fleet_label: "",
      note: claim.note,
      status: "active",
      chat_id: telegramChatId || null,
      created_at: stamp,
      updated_at: stamp
    });

    if (error) {
      console.error(error);
      setSync("Local");
    }
  }

  async function unclaim(claimId) {
    const claim = intel.claims?.[claimId];
    if (!claim) return;

    const stamp = new Date().toISOString();
    claim.status = "cancelled";
    claim.updatedAt = stamp;
    intel.claims[claimId] = claim;
    saveLocalState();
    paintSector(claim.region);
    if (claim.region === selected) renderClaimsPanel(selected);
    renderAttackBoard();
    renderBulkTargets();

    if (!client) return;

    const { error } = await client
      .from("b24_claims")
      .update({ status: "cancelled", updated_at: stamp })
      .eq("map_id", mapId)
      .eq("claim_id", claimId);

    if (error) {
      console.error(error);
      setSync("Local");
    }
  }

  async function confirmClaim(claimId, confirmed, source = {}) {
    const claim = intel.claims?.[claimId];
    if (!claim) return;

    const stamp = new Date().toISOString();
    claim.confirmedSent = Boolean(confirmed);
    claim.confirmedAt = confirmed ? stamp : "";
    claim.confirmedBy = confirmed ? user : "";
    claim.fleetLabel = confirmed ? source.fleetLabel || claim.fleetLabel || "" : "";
    claim.updatedAt = stamp;
    intel.claims[claimId] = claim;
    saveLocalState();
    if (claim.region === selected) renderClaimsPanel(selected);
    renderAttackBoard();

    if (!client) return;

    const { error } = await client
      .from("b24_claims")
      .update({
        confirmed_sent: Boolean(confirmed),
        confirmed_at: confirmed ? stamp : null,
        confirmed_by: confirmed ? user : "",
        fleet_label: claim.fleetLabel,
        updated_at: stamp
      })
      .eq("map_id", mapId)
      .eq("claim_id", claimId);

    if (error) {
      console.error(error);
      setSync("Local");
    }
  }

  function confirmFleetPaste() {
    const text = confirmFleetText.value.trim();
    if (!text) {
      confirmFleetResult.textContent = "Paste a fleet row first.";
      return;
    }

    const coords = [...new Set(text.match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "g")) || [])];
    const activeClaims = getAllActiveClaims();
    const matches = activeClaims.filter((claim) => coords.includes(claim.target));

    if (!matches.length) {
      confirmFleetResult.textContent = "No active claim matched that fleet row.";
      return;
    }

    if (matches.length > 1) {
      confirmFleetResult.textContent = `Matched ${matches.length} claims. Use the row button for the right one.`;
      return;
    }

    const fleetLabel = (text.match(/\[?(Fleet\s+\d+)\]?/i) || [])[1] || "";
    confirmClaim(matches[0].id, true, { fleetLabel });
    confirmFleetText.value = "";
    confirmFleetResult.textContent = `Confirmed ${matches[0].target}.`;
  }

  function signedExporterBookmarklet() {
    const endpoint = `${botApiUrl}/api/miniapp/import`;
    return `javascript:(async()=>{const G=${JSON.stringify(galaxy)},A=${JSON.stringify(miniAppAccess)},API=${JSON.stringify(endpoint)};const re3=new RegExp(G+':\\\\d{2}:\\\\d{2}(?!:)','g'),re4=new RegExp(G+':\\\\d{2}:\\\\d{2}:\\\\d{2}','g'),html=document.documentElement.innerHTML,txt=document.body.innerText||'';const systems=[...new Set(html.match(re3)||[])].map(coord=>({coord}));const bases=[];if(typeof mapToolBox_data!=='undefined'){for(const value of Object.values(mapToolBox_data||{})){const raw=String(value||''),coord=(raw.match(re4)||[])[0];if(!coord)continue;const guild=(raw.match(/\\[[A-Za-z0-9 _-]{1,12}\\]/)||[])[0]||'',label=raw.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').replace(coord,' ').trim();bases.push({coord,guild,label})}}const astros=[];for(const line of txt.split(/\\r?\\n/)){const coord=(line.match(re4)||[])[0];if(!coord)continue;const m=line.replace(coord,'').trim().match(/^([A-Za-z]+)\\s+([A-Za-z]+)\\s+((?:\\d+\\s+){5}\\d+)(?:\\s+(Yes))?/);if(m)astros.push({coord,terrain:m[1],type:m[2],attributes:m[3].trim().split(/\\s+/).map(Number),hasBase:m[4]==='Yes'})}const duration=value=>{const p=String(value||'').split(':').map(Number);return p.length===2?((p[0]*60+p[1])*60000):p.length===3?(((p[0]*60+p[1])*60+p[2])*1000):0};const incoming=[];document.querySelectorAll('tr').forEach(tr=>{const cells=[...tr.querySelectorAll('td,th')].map(td=>td.innerText.trim());if(cells.length<4||!/\\d{1,4}:\\d{2}(?::\\d{2})?/.test(cells[2]||''))return;const dest=tr.querySelectorAll('td,th')[1],sizeCell=tr.querySelectorAll('td,th')[3],link=dest&&dest.querySelector('a[href*="loc="]'),fleet=sizeCell&&sizeCell.querySelector('a[href*="fleet="]'),coord=((((link&&link.href)||'').match(/loc=([^&]+)/)||[])[1]||(cells[1].match(re4)||[])[0]||'').toUpperCase(),ms=duration(cells[2]);if(!coord||!coord.startsWith(G+':')||!ms)return;incoming.push({defendedCoord:coord,arrivalAt:new Date(Date.now()+ms).toISOString(),fleetId:(((fleet&&fleet.href)||'').match(/fleet=(\\d+)/)||[])[1]||'',player:cells[0],size:(cells[3].match(/[\\d,]+/)||[])[0]||'',rawLine:tr.innerText.replace(/\\s+/g,' ').trim()})});const unique=rows=>[...new Map(rows.map(row=>[row.coord,row])).values()];try{const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access:A,intel:{systems:unique(systems),bases:unique(bases),astros:unique(astros),incoming}})}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Import failed');alert('VisionBot import complete for '+G+': '+result.systems+' systems, '+result.bases+' bases, '+result.astros+' astros, '+result.incoming+' incoming')}catch(error){console.error(error);alert('VisionBot import failed: '+error.message)}})()`;
  }

  function signedExporterBookmarkletV2() {
    const endpoint = `${botApiUrl}/api/miniapp/import`;
    return `javascript:(async()=>{const G=${JSON.stringify(galaxy)},A=${JSON.stringify(miniAppAccess)},API=${JSON.stringify(endpoint)},txt=document.body.innerText||'',html=document.documentElement.innerHTML,re3=new RegExp(G+':\\\\d{2}:\\\\d{2}(?!:)','g'),re4=new RegExp(G+':\\\\d{2}:\\\\d{2}:\\\\d{2}','g');const systems=[...new Set(html.match(re3)||[])].map(coord=>({coord})),bases=[];if(typeof mapToolBox_data!=='undefined'){for(const value of Object.values(mapToolBox_data||{})){const raw=String(value||''),coord=(raw.match(re4)||[])[0];if(!coord)continue;const guild=(raw.match(/\\[[A-Za-z0-9 _-]{1,12}\\]/)||[])[0]||'',label=raw.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').replace(coord,' ').trim();bases.push({coord,guild,label})}}const astros=[];for(const line of txt.split(/\\r?\\n/)){const coord=(line.match(re4)||[])[0];if(!coord)continue;const m=line.replace(coord,'').trim().match(/^([A-Za-z]+)\\s+([A-Za-z]+)\\s+((?:\\d+\\s+){5}\\d+)(?:\\s+(Yes))?/);if(m)astros.push({coord,terrain:m[1],type:m[2],attributes:m[3].trim().split(/\\s+/).map(Number),hasBase:m[4]==='Yes'})}const unique=rows=>[...new Map(rows.map(row=>[row.coord,row])).values()];try{const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access:A,intel:{systems:unique(systems),bases:unique(bases),astros:unique(astros),sourceText:txt,sourceUrl:location.href}})}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Import failed');alert('VisionBot import complete for '+G+': '+result.systems+' systems, '+result.bases+' bases, '+result.astros+' astros, '+(result.fleetMovements||0)+' movements, '+result.incoming+' hostile incoming, '+(result.battleReports||0)+' battles')}catch(error){console.error(error);alert('VisionBot import failed: '+error.message)}})()`;
  }

  function signedExporterBookmarkletV3() {
    const endpoint = `${botApiUrl}/api/miniapp/import`;
    return `javascript:(async()=>{const G=${JSON.stringify(galaxy)},A=${JSON.stringify(miniAppAccess)},API=${JSON.stringify(endpoint)},txt=document.body.innerText||'',html=document.documentElement.innerHTML,re3=new RegExp(G+':\\\\d{2}:\\\\d{2}(?!:)','g'),re4=new RegExp(G+':\\\\d{2}:\\\\d{2}:\\\\d{2}','g');const systems=[...new Set(html.match(re3)||[])].map(coord=>({coord})),bases=[];if(typeof mapToolBox_data!=='undefined'){for(const value of Object.values(mapToolBox_data||{})){const raw=String(value||''),coord=(raw.match(re4)||[])[0];if(!coord)continue;const guild=(raw.match(/\\[[A-Za-z0-9 _-]{1,12}\\]/)||[])[0]||'',label=raw.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').replace(coord,' ').trim();bases.push({coord,guild,label})}}if(typeof mapPlayer!=='undefined'&&Array.isArray(mapPlayer)){for(const value of mapPlayer){const parts=String(value||'').split('•');if(parts[0]!=='0'||!/^base\\d+$/i.test(parts[1]||''))continue;const coord=String(parts[3]||'').toUpperCase();if(!coord.startsWith(G+':')||coord.split(':').length!==4)continue;bases.push({coord,guild:'',label:String(parts[2]||'').trim(),sourceKind:'personal_base'})}}const astros=[];for(const line of txt.split(/\\r?\\n/)){const coord=(line.match(re4)||[])[0];if(!coord)continue;const m=line.replace(coord,'').trim().match(/^([A-Za-z]+)\\s+([A-Za-z]+)\\s+((?:\\d+\\s+){5}\\d+)(?:\\s+(Yes))?/);if(m)astros.push({coord,terrain:m[1],type:m[2],attributes:m[3].trim().split(/\\s+/).map(Number),hasBase:m[4]==='Yes'})}const pageCoord=(txt.match(re4)||[])[0]||'',fleetMovements=[];document.querySelectorAll('tr').forEach(tr=>{const cells=[...tr.querySelectorAll('td,th')],v=cells.map(td=>td.innerText.trim());if(v.length<4||!/\\d{1,4}:\\d{2}(?::\\d{2})?/.test(v[2]||''))return;const loc=cells[1]?.querySelector('a[href*="loc="]'),baseFleetTable=!loc&&/base\\.aspx/i.test(location.pathname)&&/Fleet\\s+Player\\s+Arrival\\s+Size/i.test(tr.closest('table')?.innerText||'');if(!loc&&!baseFleetTable)return;const playerCell=loc?cells[0]:cells[1],fleetLink=cells[0]?.querySelector('a[href*="fleet="]')||cells[3]?.querySelector('a[href*="fleet="]'),profile=playerCell?.querySelector('a[href*="player="]'),coord=decodeURIComponent((((loc?.href||'').match(/loc=([^&]+)/)||[])[1]||(v[1].match(re4)||[])[0]||(baseFleetTable?pageCoord:'')||'')).toUpperCase();if(!coord||!coord.startsWith(G+':'))return;fleetMovements.push({defendedCoord:coord,eta:v[2],size:(v[3].match(/[\\d,]+/)||[])[0]||'',player:playerCell?.innerText.trim()||'',playerId:((profile?.href||'').match(/player=(\\d+)/)||[])[1]||'',fleetId:((fleetLink?.href||'').match(/fleet=(\\d+)/)||[])[1]||'',fleetName:loc?'':v[0],rawLine:tr.innerText.replace(/\\s+/g,' ').trim(),sourceKind:loc?'scanner':'base_fleet'})});const unique=rows=>[...new Map(rows.map(row=>[row.coord,row])).values()];try{const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access:A,intel:{systems:unique(systems),bases:unique(bases),astros:unique(astros),fleetMovements,sourceText:txt,sourceUrl:location.href}})}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Import failed');alert('VisionBot import complete for '+G+': '+result.systems+' systems, '+result.bases+' bases, '+result.astros+' astros, '+(result.fleetMovements||0)+' movements, '+result.incoming+' hostile incoming, '+(result.battleReports||0)+' battles, '+(result.occupations||0)+' occupations')}catch(error){console.error(error);alert('VisionBot import failed: '+error.message)}})()`;
  }

  function signedExporterBookmarkletV4(exportAccess = miniAppAccess) {
    const options = {
      galaxy,
      access: exportAccess,
      api: `${botApiUrl}/api/miniapp/import`
    };

    async function visionBotExporter({ galaxy: activeGalaxy, access, api }) {
      const normalizeGalaxy = (value) => {
        const match = String(value || "").toUpperCase().match(/B?\s*(\d{1,2})/);
        return match ? `B${String(Number(match[1])).padStart(2, "0")}` : "";
      };
      const isAstroReport = /\/report\.aspx$/i.test(location.pathname)
        && new URLSearchParams(location.search).get("view") === "astros";
      const galaxySelect = document.querySelector('select[name="galaxy"]');
      const selectedGalaxyOption = galaxySelect?.selectedOptions?.[0];
      const exportGalaxy = isAstroReport
        ? normalizeGalaxy(selectedGalaxyOption?.textContent || selectedGalaxyOption?.value)
        : activeGalaxy;
      if (!exportGalaxy) throw new Error("Could not determine the selected galaxy.");
      const text = document.body.innerText || "";
      const html = document.documentElement.innerHTML;
      const systemPattern = new RegExp(`${exportGalaxy}:\\d{2}:\\d{2}(?!:)`, "g");
      const astroPattern = new RegExp(`${exportGalaxy}:\\d{2}:\\d{2}:\\d{2}`, "g");
      let systems = [...new Set(html.match(systemPattern) || [])].map((coord) => ({ coord }));
      const bases = [];

      const addPersonalBase = (coordValue, labelValue) => {
        const coord = String(coordValue || "").toUpperCase();
        if (!coord.startsWith(`${exportGalaxy}:`) || coord.split(":").length !== 4) return;
        bases.push({
          coord,
          guild: "",
          label: String(labelValue || "").trim(),
          sourceKind: "personal_base"
        });
      };

      if (typeof globalThis.mapToolBox_data !== "undefined") {
        for (const value of Object.values(globalThis.mapToolBox_data || {})) {
          const raw = String(value || "");
          const coord = (raw.match(astroPattern) || [])[0];
          if (!coord) continue;
          const guild = (raw.match(/\[[A-Za-z0-9 _-]{1,12}\]/) || [])[0] || "";
          let label = raw
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(coord, " ")
            .replace(/^\s*\d{1,2}-;-\s*/, " ");
          if (guild) label = label.split(guild).join(" ");
          label = label.replace(/\s+/g, " ").trim();
          bases.push({ coord, guild, label, sourceKind: "map_intel" });
        }
      }

      if (Array.isArray(globalThis.mapPlayer)) {
        for (const value of globalThis.mapPlayer) {
          const parts = String(value || "").split("•");
          if (parts[0] !== "0" || !/^base\d+$/i.test(parts[1] || "")) continue;
          addPersonalBase(parts[3], parts[2]);
        }
      }

      const personalCoords = Array.isArray(globalThis.mapPlayerLocFull)
        ? String(globalThis.mapPlayerLocFull[0] || "").split(";").filter(Boolean)
        : [];
      const personalLabels = Array.isArray(globalThis.mapPlayerLocLabel)
        ? String(globalThis.mapPlayerLocLabel[0] || "").split(";")
        : [];
      personalCoords.forEach((coord, index) => addPersonalBase(coord, personalLabels[index]));

      let astros = [];
      for (const line of text.split(/\r?\n/)) {
        const coord = (line.match(astroPattern) || [])[0];
        if (!coord) continue;
        const match = line
          .replace(coord, "")
          .trim()
          .match(/^([A-Za-z]+)\s+([A-Za-z]+)\s+((?:\d+\s+){5}\d+)(?:\s+(Yes))?/);
        if (!match) continue;
        astros.push({
          coord,
          terrain: match[1],
          type: match[2],
          attributes: match[3].trim().split(/\s+/).map(Number),
          hasBase: match[4] === "Yes"
        });
      }

      let reportRequestCount = 0;
      const progress = document.createElement("div");
      const setProgress = (message) => {
        progress.textContent = message;
        Object.assign(progress.style, {
          position: "fixed", top: "12px", right: "12px", zIndex: "2147483647",
          maxWidth: "340px", padding: "12px 16px", border: "1px solid #39a9e8",
          borderRadius: "6px", background: "#071722", color: "#fff",
          font: "600 14px/1.4 Arial, sans-serif", boxShadow: "0 8px 28px #000a"
        });
        if (!progress.isConnected) document.body.appendChild(progress);
      };
      const parseAstroReportDocument = (doc) => {
        const rows = [];
        doc.querySelectorAll("tr").forEach((row) => {
          const compact = String(row.innerText || row.textContent || "").replace(/\s+/g, " ").trim();
          const match = compact.match(/^(B\d{1,2}:\d{2}:\d{2}:\d{2})\s+([A-Za-z]+)\s+([A-Za-z]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(Yes))?$/i);
          if (!match) return;
          rows.push({
            coord: match[1].toUpperCase(),
            terrain: match[2],
            type: match[3],
            attributes: match.slice(4, 10).map(Number),
            hasBase: Boolean(match[10])
          });
        });
        return rows;
      };
      const reportIsCapped = (doc) => /Only the first 250 astros are displayed/i.test(doc.body?.innerText || "");
      const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      let reportRequestGapMs = 1800;
      let lastReportRequestAt = 0;
      const paceReportRequest = async () => {
        const remaining = reportRequestGapMs - (Date.now() - lastReportRequestAt);
        if (remaining > 0) await sleep(remaining);
        lastReportRequestAt = Date.now();
      };
      const retryAfterMilliseconds = (response, attempt) => {
        const header = response.headers.get("Retry-After");
        const seconds = Number(header);
        const headerDelay = Number.isFinite(seconds)
          ? seconds * 1000
          : Math.max(0, Date.parse(header || "") - Date.now());
        return Math.min(120000, Math.max(headerDelay || 0, 30000 + ((attempt - 1) * 15000)));
      };
      const fetchAstroReport = async ({ terrain = "", astroType = "", solarPos = "0" }) => {
        for (let attempt = 1; attempt <= 6; attempt += 1) {
          await paceReportRequest();
          reportRequestCount += 1;
          setProgress(`Collecting ${exportGalaxy} astro report... request ${reportRequestCount}`);
          const response = await fetch("/report.aspx?view=astros", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              form_status: "submitted",
              galaxy: String(selectedGalaxyOption?.value || exportGalaxy.replace(/^B/, "")),
              terrain,
              astro_type: astroType,
              solar_pos: solarPos
            })
          });
          if (response.status === 429 && attempt < 6) {
            reportRequestGapMs = Math.max(reportRequestGapMs, 3500);
            const waitMs = retryAfterMilliseconds(response, attempt);
            setProgress(`Astro Empires rate limit reached. Retrying in ${Math.ceil(waitMs / 1000)} seconds...`);
            await sleep(waitMs);
            continue;
          }
          if (!response.ok) throw new Error(`Astro report request failed (${response.status}).`);
          const doc = new DOMParser().parseFromString(await response.text(), "text/html");
          return { rows: parseAstroReportDocument(doc), capped: reportIsCapped(doc) };
        }
        throw new Error("Astro report remained rate limited after several retries. Please wait a few minutes and try again.");
      };
      const collectFullAstroReport = async () => {
        const terrainValues = [...document.querySelectorAll('select[name="terrain"] option')]
          .filter((option) => option.value && !/^any$/i.test(option.textContent.trim()))
          .map((option) => option.value);
        if (!terrainValues.length) throw new Error("Could not find the astro report terrain filters.");
        const collected = [];
        for (const terrain of terrainValues) {
          const broad = await fetchAstroReport({ terrain });
          if (!broad.capped) {
            collected.push(...broad.rows);
            continue;
          }
          for (let solar = 1; solar <= 5; solar += 1) {
            const solarResult = await fetchAstroReport({ terrain, solarPos: String(solar) });
            if (!solarResult.capped) {
              collected.push(...solarResult.rows);
              continue;
            }
            for (const astroType of ["planet", "moon"]) {
              const splitResult = await fetchAstroReport({ terrain, astroType, solarPos: String(solar) });
              if (splitResult.capped) {
                throw new Error(`${terrain} ${astroType} solar position ${solar} still exceeds the report limit.`);
              }
              collected.push(...splitResult.rows);
            }
          }
        }
        return [...new Map(collected.map((row) => [row.coord, row])).values()];
      };

      if (isAstroReport) {
        try {
          astros = await collectFullAstroReport();
          systems = [...new Set(astros.map((row) => row.coord.split(":").slice(0, 3).join(":")))]
            .map((coord) => ({ coord }));
          setProgress(`Collected ${astros.length.toLocaleString()} ${exportGalaxy} astros. Uploading...`);
        } catch (error) {
          progress.remove();
          console.error(error);
          alert(`VisionBot full report export failed: ${error.message}`);
          return;
        }
      }

      const pageCoord = (text.match(astroPattern) || [])[0] || "";
      const fleetMovements = [];
      document.querySelectorAll("tr").forEach((row) => {
        const cells = [...row.querySelectorAll("td,th")];
        const values = cells.map((cell) => cell.innerText.trim());
        if (values.length < 4 || !/\d{1,4}:\d{2}(?::\d{2})?/.test(values[2] || "")) return;
        const locationLink = cells[1]?.querySelector('a[href*="loc="]');
        const baseFleetTable = !locationLink
          && /base\.aspx/i.test(location.pathname)
          && /Fleet\s+Player\s+Arrival\s+Size/i.test(row.closest("table")?.innerText || "");
        if (!locationLink && !baseFleetTable) return;
        const playerCell = locationLink ? cells[0] : cells[1];
        const fleetLink = cells[0]?.querySelector('a[href*="fleet="]')
          || cells[3]?.querySelector('a[href*="fleet="]');
        const profileLink = playerCell?.querySelector('a[href*="player="]');
        const coord = decodeURIComponent(
          ((locationLink?.href || "").match(/loc=([^&]+)/) || [])[1]
          || (values[1].match(astroPattern) || [])[0]
          || (baseFleetTable ? pageCoord : "")
          || ""
        ).toUpperCase();
        if (!coord || !coord.startsWith(`${exportGalaxy}:`)) return;
        fleetMovements.push({
          defendedCoord: coord,
          eta: values[2],
          size: (values[3].match(/[\d,]+/) || [])[0] || "",
          player: playerCell?.innerText.trim() || "",
          playerId: ((profileLink?.href || "").match(/player=(\d+)/) || [])[1] || "",
          fleetId: ((fleetLink?.href || "").match(/fleet=(\d+)/) || [])[1] || "",
          fleetName: locationLink ? "" : values[0],
          rawLine: row.innerText.replace(/\s+/g, " ").trim(),
          sourceKind: locationLink ? "scanner" : "base_fleet"
        });
      });

      const uniqueByCoord = (rows) => [...new Map(rows.map((row) => [row.coord, row])).values()];
      try {
        const astroRows = uniqueByCoord(astros);
        const chunks = astroRows.length
          ? Array.from({ length: Math.ceil(astroRows.length / 400) }, (_, index) => astroRows.slice(index * 400, (index + 1) * 400))
          : [[]];
        const result = {
          systems: 0, bases: 0, astros: 0, fleetMovements: 0, incoming: 0,
          battleReports: 0, fleetObservations: 0, occupations: 0, gameEvents: 0
        };
        for (let index = 0; index < chunks.length; index += 1) {
          setProgress(`Uploading ${exportGalaxy} intel... batch ${index + 1} of ${chunks.length}`);
          const first = index === 0;
          const response = await fetch(api, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access,
              galaxy: exportGalaxy,
              intel: {
                galaxy: exportGalaxy,
                systems: first ? uniqueByCoord(systems) : [],
                bases: first ? uniqueByCoord(bases) : [],
                astros: chunks[index],
                fleetMovements: first ? fleetMovements : [],
                sourceText: first ? text : "",
                sourceUrl: first ? location.href : ""
              }
            })
          });
          const batchResult = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(batchResult.error || `Import batch ${index + 1} failed`);
          Object.keys(result).forEach((key) => { result[key] += Number(batchResult[key] || 0); });
        }
        alert(
          `VisionBot import complete for ${exportGalaxy}: ${result.systems} systems, `
          + `${result.bases} bases, ${result.astros} astros, ${result.fleetMovements || 0} movements, `
          + `${result.incoming} hostile incoming, ${result.battleReports || 0} battles, `
          + `${result.occupations || 0} occupations${isAstroReport ? ` (${reportRequestCount} report requests)` : ""}`
        );
      } catch (error) {
        console.error(error);
        alert(`VisionBot import failed: ${error.message}`);
      } finally {
        progress.remove();
      }
    }

    return `javascript:(${visionBotExporter.toString()})(${JSON.stringify(options)})`;
  }

  async function copyBookmarklet() {
    if (miniAppSession) {
      try {
        const token = await miniAppApi("/api/miniapp/export-token", { method: "POST" });
        const code = signedExporterBookmarkletV4(token.access);
        try {
          await navigator.clipboard.writeText(code);
          importResult.textContent = `Secure ${token.galaxy || galaxy} exporter copied. Valid through ${new Date(token.expiresAt).toLocaleDateString()}.`;
        } catch {
          importText.value = code;
          importResult.textContent = `Secure ${token.galaxy || galaxy} exporter placed in the box. Valid through ${new Date(token.expiresAt).toLocaleDateString()}.`;
        }
      } catch (error) {
        importResult.textContent = error.message;
      }
      return;
    }
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      importResult.textContent = "Supabase config needed first";
      return;
    }

    const code = `javascript:(async()=>{const GALAXY=${JSON.stringify(galaxy)},MAP_ID=${JSON.stringify(mapId)},SUPA=${JSON.stringify(config.SUPABASE_URL)},KEY=${JSON.stringify(config.SUPABASE_ANON_KEY)},CHAT_ID=${JSON.stringify(telegramChatId)},USER=${JSON.stringify(user || "VisionBot exporter")},USER_ID=${JSON.stringify(telegramUser?.id ? String(telegramUser.id) : "")};const now=new Date().toISOString();const hdr={'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'};const post=async(t,r,c)=>{if(!r.length)return 0;const u=SUPA+'/rest/v1/'+t+'?on_conflict='+encodeURIComponent(c);const x=await fetch(u,{method:'POST',headers:hdr,body:JSON.stringify(r)});if(!x.ok)throw new Error(t+': '+await x.text());return r.length};const re3=new RegExp(GALAXY+':\\\\d{2}:\\\\d{2}(?!:)','g'),re4=new RegExp(GALAXY+':\\\\d{2}:\\\\d{2}:\\\\d{2}','g');const reg=v=>{const m=String(v||'').match(new RegExp('^'+GALAXY+':(\\\\d{1,2})'));return m?GALAXY+':'+Number(m[1]):''};const sys=v=>String(v||'').split(':').slice(0,3).join(':');const clean=(v,c)=>String(v||'').replace(/^44-;-\\s*/,'').replace(c,'').replace(/\\s+/g,' ').trim();const dur=s=>{const p=String(s||'').split(':').map(Number);return p.length===2?((p[0]*60+p[1])*60000):p.length===3?(((p[0]*60+p[1])*60+p[2])*1000):0};const hash=s=>{let h=2166136261;for(let i=0;i<String(s).length;i++){h^=String(s).charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};const html=document.documentElement.innerHTML;const systems=[...new Set(html.match(re3)||[])].map(c=>({map_id:MAP_ID,coord:c,region_id:reg(c),system_id:c.split(':')[2],updated_at:now}));const bases=[];if(typeof mapToolBox_data!=='undefined'){for(const v of Object.values(mapToolBox_data||{})){const s=String(v||''),c=(s.match(re4)||[])[0];if(!c)continue;const g=(s.match(/\\[[A-Za-z0-9 _-]{1,12}\\]/)||[])[0]||'',txt=s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();bases.push({map_id:MAP_ID,coord:c,region_id:reg(c),system_id:sys(c),guild:g,label:clean(txt,c),updated_at:now})}}const seen={};const uniqueBases=bases.filter(b=>!seen[b.coord]&&(seen[b.coord]=1));const body=document.body.innerText||'',astros=[];for(const line of body.split(/\\r?\\n/)){const c=(line.match(re4)||[])[0];if(!c)continue;const rest=line.replace(c,'').trim(),m=rest.match(/^([A-Za-z]+)\\s+([A-Za-z]+)\\s+((?:\\d+\\s+){5}\\d+)(?:\\s+(Yes))?/);if(!m)continue;astros.push({map_id:MAP_ID,coord:c,region_id:reg(c),system_id:sys(c),astro_no:c.split(':')[3],terrain:m[1],astro_type:m[2],attributes:m[3].trim().split(/\\s+/).map(Number),has_base:m[4]==='Yes',updated_at:now})}const incoming=[];document.querySelectorAll('tr').forEach(tr=>{const cells=[...tr.querySelectorAll('td,th')].map(td=>td.innerText.trim());if(cells.length<4||!/\\d{1,4}:\\d{2}(?::\\d{2})?/.test(cells[2]||''))return;const destCell=tr.querySelectorAll('td,th')[1],sizeCell=tr.querySelectorAll('td,th')[3];const link=(destCell&&destCell.querySelector('a[href*=\"loc=\"]'))||null;const fleet=(sizeCell&&sizeCell.querySelector('a[href*=\"fleet=\"]'))||null;const href=link?link.href:'',coord=((href.match(/loc=([^&]+)/)||[])[1]||cells[1].match(re4)?.[0]||'').toUpperCase();if(!coord||!coord.startsWith(GALAXY+':'))return;const ms=dur(cells[2]);if(!ms)return;const fleetId=(fleet?.href.match(/fleet=(\\d+)/)||[])[1]||'';const player=cells[0],size=(cells[3].match(/[\\d,]+/)||[])[0]||'',arrival=new Date(Date.now()+ms).toISOString();incoming.push({map_id:MAP_ID,incoming_id:fleetId?'scan-fleet-'+fleetId:'scan-'+hash([coord,player,size].join('|')),defended_coord:coord,defended_region_id:reg(coord),defended_system_id:sys(coord),attacker_coord:null,region_id:null,system_id:null,eta_minutes:Math.max(1,Math.ceil(ms/60000)),arrival_at:arrival,reported_by:USER,reported_by_user_id:USER_ID||null,chat_id:CHAT_ID||null,hostile_fleet:tr.innerText.replace(/\\s+/g,' ').trim(),note:[player?'player '+player:'',size?'size '+size:''].filter(Boolean).join(' | '),status:'active',updated_at:now})});try{const a=await post('b24_systems',systems,'map_id,coord'),b=await post('b24_bases',uniqueBases,'map_id,coord'),c=await post('b24_astros',astros,'map_id,coord'),d=await post('b24_incoming',incoming,'map_id,incoming_id');alert('VisionBot import complete for '+GALAXY+': '+a+' systems, '+b+' bases, '+c+' astros, '+d+' incoming')}catch(e){console.error(e);alert('VisionBot import failed: '+e.message)}})()`;

    try {
      await navigator.clipboard.writeText(code);
      importResult.textContent = "Bookmarklet copied";
    } catch {
      importText.value = code;
      importResult.textContent = "Bookmarklet placed in box";
    }
  }

  function emptyIntelParseResult() {
    return {
      systems: [], bases: [], astros: [], incoming: [], battleReports: [], battlePreviews: [],
      fleetMovements: [], fleetObservations: [], occupations: [], gameEvents: []
    };
  }

  function parseIntel(text) {
    const result = emptyIntelParseResult();

    try {
      const json = JSON.parse(text);
      if (Array.isArray(json.systems) || json.regions) {
        const systems = Array.isArray(json.systems)
          ? json.systems
          : Object.entries(json.regions || {}).flatMap(([region, systems]) => {
              return systems.map((system) => `${region}:${system}`);
            });
        result.systems.push(...systems.map(normalizeSystem).filter(Boolean));
      }

      const rows = Array.isArray(json.rows) ? json.rows : [];
      rows.forEach((row) => {
        const coord = normalizeAstro(row.coord);
        if (!coord) return;
        result.bases.push({
          coord,
          region: astroToRegion(coord),
          system: astroToSystem(coord),
          guild: row.guild || "",
          label: cleanOwnerLabel(row.text || row.label || "", coord)
        });
      });

      mergeOperationalIntel(result, text);
      mergeBattleReportParse(result, text);
      return result;
    } catch {
      return parseTextIntel(text);
    }
  }

  function parseTextIntel(text) {
    const result = emptyIntelParseResult();
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    lines.forEach((line) => {
      const pattern = new RegExp(`^(${galaxy}:\\d{2}:\\d{2}:\\d{2})\\s+([A-Za-z]+)\\s+([A-Za-z]+)\\s+((?:\\d+\\s+){5}\\d+)(?:\\s+(Yes))?`);
      const match = line.match(pattern);
      if (!match) return;

      const coord = normalizeAstro(match[1]);
      const attributes = match[4].trim().split(/\s+/).map(Number);
      result.astros.push({
        coord,
        region: astroToRegion(coord),
        system: astroToSystem(coord),
        terrain: match[2],
        type: match[3],
        attributes,
        hasBase: match[5] === "Yes"
      });
    });

    mergeOperationalIntel(result, text);
    mergeBattleReportParse(result, text);
    return result;
  }

  function mergeBattleReportParse(result, text) {
    splitBattleReportText(text).forEach((segment) => {
      const report = parseBattleReportText(segment);
      if (!report) return;
      if (!report.complete) {
        result.battlePreviews.push(report);
        return;
      }
      result.battleReports.push(report);
      if (report.coord && report.defender?.player) {
        result.bases.push({
          coord: report.coord,
          region: astroToRegion(report.coord),
          system: astroToSystem(report.coord),
          guild: report.defender.guild || "",
          label: report.defender.player
        });
      }
      result.fleetObservations.push(...battleFleetObservations(report));
      const occupation = battleOccupation(report);
      if (occupation) result.occupations.push(occupation);
    });
  }

  function splitBattleReportText(text) {
    const raw = String(text || "");
    const matches = [...raw.matchAll(/Battle Report\s*\r?\nLocation\b/gi)];
    if (!matches.length) return /^Battle Report\b/im.test(raw) ? [raw] : [];
    return matches.map((match, index) => raw.slice(match.index, matches[index + 1]?.index ?? raw.length));
  }

  function parseBattleReportText(text) {
    const raw = String(text || "").trim();
    if (!/^Battle Report\b/im.test(raw) || !/\bAttack Force\b/i.test(raw) || !/\bDefensive Force\b/i.test(raw)) return null;

    const normalized = raw
      .replace(/\*\*/g, "")
      .replace(/\]\(https?:\/\/[^)]+\)/gi, "]")
      .replace(/\\([\[\]])/g, "$1");
    const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const attackHeaders = lineIndexes(lines, "Attack Force");
    const defenseHeaders = lineIndexes(lines, "Defensive Force");
    if (!attackHeaders.length || !defenseHeaders.length) return null;

    const coord = normalizeAstro((normalized.match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "i")) || [])[0]);
    if (!coord) return null;
    const firstAttack = attackHeaders[0];
    const firstDefense = defenseHeaders.find((index) => index > firstAttack) ?? lines.length;
    const secondAttack = attackHeaders.find((index) => index > firstDefense) ?? lines.length;
    const secondDefense = defenseHeaders.find((index) => index > secondAttack) ?? lines.length;
    const attacker = parseBattleParty(lines, firstAttack + 1, firstDefense);
    const defender = parseBattleParty(lines, firstDefense + 1, secondAttack);
    const attackerUnits = parseBattleUnits(lines, secondAttack + 1, secondDefense);
    const defenderUnits = parseBattleUnits(lines, secondDefense + 1, lines.length);
    const profileIds = [...raw.matchAll(/profile\.aspx\?player=(\d+)/gi)].map((match) => match[1]);
    attacker.playerId = profileIds[0] || "";
    defender.playerId = profileIds[1] || "";

    const battleTime = labeledValue(lines, "Time");
    const server = labeledValue(lines, "Server");
    const locationLine = lines.find((line) => /^Location\b/i.test(line)) || "";
    const locationLabel = locationLine
      .replace(/^Location\s*/i, "")
      .replace(new RegExp(`\\(?${escapeRegExp(coord)}\\)?`, "i"), "")
      .replace(/^\[|\]$/g, "")
      .trim();
    const totals = parseBattleTotals(normalized);
    const occupied = /attacker conquered the base/i.test(normalized);
    const liberated = /defender liberated the base|base was liberated/i.test(normalized);
    const complete = Boolean(battleTime && /Total cost of units destroyed|New debris in space|conquered the base/i.test(normalized));

    return {
      complete,
      server,
      galaxy,
      coord,
      locationLabel,
      battleTime,
      attacker,
      defender,
      attackerUnits,
      defenderUnits,
      totals,
      occupied,
      liberated,
      outcome: battleOutcome(attackerUnits, defenderUnits, occupied, liberated),
      resultText: battleResultText(lines),
      rawReport: raw
    };
  }

  function lineIndexes(lines, value) {
    return lines.map((line, index) => line.toLowerCase() === value.toLowerCase() ? index : -1).filter((index) => index >= 0);
  }

  function labeledValue(lines, label, start = 0, end = lines.length) {
    const pattern = new RegExp(`^${escapeRegExp(label)}(?:\\s+|$)`, "i");
    const line = lines.slice(start, end).find((item) => pattern.test(item));
    return line ? line.replace(pattern, "").trim() : "";
  }

  function parseBattleParty(lines, start, end) {
    const playerText = labeledValue(lines, "Player", start, end);
    const playerMatch = playerText.match(/^(.*?)\s+lvl\s+([\d.]+)$/i);
    let identity = (playerMatch?.[1] || playerText).trim();
    if (identity.startsWith("[[") && identity.endsWith("]")) identity = identity.slice(1, -1).trim();
    const guildMatch = identity.match(/^\[([^\]]+)\]\s*/);
    const fleetText = labeledValue(lines, "Fleet Name", start, end);
    return {
      guild: guildMatch ? `[${guildMatch[1]}]` : "",
      player: identity.replace(/^\[[^\]]+\]\s*/, "").trim(),
      playerId: "",
      level: Number(playerMatch?.[2]) || null,
      fleet: fleetText.replace(/\s*\(Destroyed\)\s*/i, "").trim(),
      destroyed: /\(Destroyed\)/i.test(fleetText),
      commandCenters: Number(labeledValue(lines, "Command Centers", start, end)) || 0,
      startDefenses: numberOrNull(labeledValue(lines, "Start Defenses", start, end).replace("%", "")),
      endDefenses: numberOrNull(labeledValue(lines, "End Defenses", start, end).replace("%", ""))
    };
  }

  function parseBattleUnits(lines, start, end) {
    const rows = [];
    lines.slice(start, end).forEach((line) => {
      if (/^Unit\b/i.test(line) || /^(?:Total cost|Loot|Experience|New debris|Attacker |Defender )/i.test(line)) return;
      const match = line.match(/^(.+?)\s+([\d,.?]+)\s+([\d,.?]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/);
      if (!match) return;
      rows.push({
        unit: match[1].trim(),
        start: numberOrNull(match[2]),
        end: numberOrNull(match[3]),
        attack: numberOrNull(match[4]),
        armour: numberOrNull(match[5]),
        shield: numberOrNull(match[6])
      });
    });
    return rows;
  }

  function parseBattleTotals(text) {
    const destroyed = text.match(/Total cost of units destroyed:\s*([\d,]+)\s*\(\s*Attacker:\s*([\d,]+)\s*;\s*Defender:\s*([\d,]+)/i);
    const loot = text.match(/Loot:\s*\(\s*Attacker:\s*([+\-\d,]+)\s*;\s*Defender:\s*([+\-\d,]+)/i);
    const experience = text.match(/Experience:\s*\(\s*Attacker:\s*([+\-\d,]+)\s*;\s*Defender:\s*([+\-\d,]+)/i);
    const debris = text.match(/New debris in space:\s*([\d,]+)/i);
    const pillage = text.match(/got\s+([\d,]+)\s+credits for pillaging/i);
    return {
      destroyed: numberOrNull(destroyed?.[1]),
      attackerDestroyed: numberOrNull(destroyed?.[2]),
      defenderDestroyed: numberOrNull(destroyed?.[3]),
      attackerLoot: numberOrNull(loot?.[1]),
      defenderLoot: numberOrNull(loot?.[2]),
      attackerExperience: numberOrNull(experience?.[1]),
      defenderExperience: numberOrNull(experience?.[2]),
      debris: numberOrNull(debris?.[1]),
      pillage: numberOrNull(pillage?.[1])
    };
  }

  function battleOutcome(attackerUnits, defenderUnits, occupied, liberated) {
    if (liberated) return "liberated";
    if (occupied) return "occupied";
    const attackerEnd = attackerUnits.reduce((sum, row) => sum + (row.end || 0), 0);
    const defenderEnd = defenderUnits.reduce((sum, row) => sum + (row.end || 0), 0);
    if (!attackerEnd && !defenderEnd) return "mutual_destruction";
    if (attackerEnd && !defenderEnd) return "attacker_win";
    if (!attackerEnd && defenderEnd) return "defender_win";
    return "inconclusive";
  }

  function battleResultText(lines) {
    return lines.filter((line) => /^(?:Attacker |Defender |Total cost|Loot:|Experience:|New debris)/i.test(line)).join("\n").slice(0, 2000);
  }

  function numberOrNull(value) {
    if (value == null || String(value).trim() === "?" || String(value).trim() === "") return null;
    const number = Number(String(value).replace(/,/g, "").replace(/^\+/, ""));
    return Number.isFinite(number) ? number : null;
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function mergeOperationalIntel(result, text) {
    const movements = parseFleetMovementText(text);
    result.fleetMovements.push(...movements);
    result.incoming.push(...movements.filter((row) => row.classification === "hostile"));
    result.fleetObservations.push(...parseFleetObservationText(text));
    result.occupations.push(...parseOccupationText(text));
    result.gameEvents.push(...parseGameEventsText(text));
  }

  function parseFleetMovementText(text) {
    const rows = [];
    const raw = String(text || "");
    const observedAt = parseAePageTimestamp(raw) || new Date();
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    lines.forEach((line) => {
      if (!line.includes(galaxy)) return;
      const coord = normalizeAstro((line.match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`)) || [])[0]);
      if (!coord) return;
      const etaMatch = line.match(/\b(\d{1,4}:\d{2}(?::\d{2})?)\b/);
      if (!etaMatch) return;
      const duration = parseDurationToMs(etaMatch[1]);
      if (!duration) return;
      const sizeMatch = line.match(/\[(\d[\d,]*)\]\([^)]*fleet=/i) || line.match(/(?:\]|\)|\s)(\d[\d,]*)\s*$/);
      const fleetMatch = line.match(/\bfleet=(\d+)/i);
      const player = cleanMovementPlayer(line, coord, etaMatch[1], sizeMatch?.[1] || "");
      const guild = extractGuildTag(player || line);
      const classification = normalizeGuildTag(guild) === normalizeGuildTag("[APP]") ? "friendly" : "unknown";
      rows.push({
        defendedCoord: coord,
        attackerCoord: "",
        etaMinutes: Math.max(1, Math.ceil(duration / 60000)),
        arrivalAt: new Date(observedAt.getTime() + duration).toISOString(),
        observedAt: observedAt.toISOString(),
        etaSeconds: Math.round(duration / 1000),
        arrivalPrecision: "exact",
        player: player.replace(/^\[[^\]]+\]\s*/, "").trim(),
        playerId: (line.match(/profile\.aspx\?player=(\d+)/i) || [])[1] || "",
        guild,
        classification,
        fleetId: fleetMatch?.[1] || "",
        fleetName: cleanMovementFleetName(line),
        size: sizeMatch?.[1] || "",
        note: [player ? `player ${player}` : "", sizeMatch?.[1] ? `size ${sizeMatch[1]}` : ""].filter(Boolean).join(" | "),
        rawLine: line,
        sourceKind: /Fleet movements detected in your base regions/i.test(raw) ? "scanner" : "base_page"
      });
    });
    return [...new Map(rows.map((row) => [[row.fleetId, row.defendedCoord, row.arrivalAt].join("|"), row])).values()];
  }

  function parseIncomingMovementText(text) {
    return parseFleetMovementText(text).filter((row) => row.classification === "hostile");
  }

  function parseAePageTimestamp(text) {
    const match = String(text || "").match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4}),\s+(\d{2}):(\d{2}):(\d{2})\b/i);
    if (!match) return null;
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase());
    const date = new Date(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function extractGuildTag(value) {
    const match = String(value || "").replace(/\\([\[\]])/g, "$1").match(/\[([^\]]{1,24})\]/);
    return match ? `[${match[1]}]` : "";
  }

  function normalizeGuildTag(value) {
    return String(value || "").replace(/[\[\]]/g, "").trim().toUpperCase();
  }

  function cleanMovementFleetName(line) {
    const match = String(line || "").match(/^\[([^\]]+)\]\([^)]*fleet\.aspx\?fleet=/i);
    return match?.[1] || "";
  }

  function battleFleetObservations(report) {
    return [
      { side: "attacker", party: report.attacker, units: report.attackerUnits },
      { side: "defender", party: report.defender, units: report.defenderUnits }
    ].filter((item) => item.party?.player || item.party?.fleet).map((item) => ({
      server: report.server,
      coord: report.coord,
      observedAt: report.battleTime || new Date().toISOString(),
      sourceKind: "battle_report",
      side: item.side,
      player: item.party.player || "",
      playerId: item.party.playerId || "",
      guild: item.party.guild || "",
      fleetName: item.party.fleet || "",
      destroyed: Boolean(item.party.destroyed),
      units: item.units || [],
      size: "",
      rawLine: report.resultText || ""
    }));
  }

  function battleOccupation(report) {
    if (!report.occupied && !report.liberated) return null;
    return {
      server: report.server,
      coord: report.coord,
      ownerGuild: report.defender?.guild || "",
      ownerPlayer: report.defender?.player || "",
      occupierGuild: report.occupied ? report.attacker?.guild || "" : "",
      occupierPlayer: report.occupied ? report.attacker?.player || "" : "",
      occupyingFleetName: report.occupied ? report.attacker?.fleet || "" : "",
      state: report.liberated ? "liberated" : "occupied",
      revoltState: report.liberated ? "successful" : "unknown",
      observedAt: report.battleTime || new Date().toISOString(),
      sourceKind: "battle_report"
    };
  }

  function parseFleetObservationText(text) {
    const raw = String(text || "");
    if (!/Fleet Size:\s*[\d,]+/i.test(raw) || !/\bUnits\b/i.test(raw)) return [];
    const coord = normalizeAstro((raw.match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "i")) || [])[0]);
    const fleetId = (raw.match(/fleet\.aspx\?fleet=(\d+)/i) || [])[1] || "";
    const fleetName = (raw.match(/\bFleet\s+\d+\s*-\s*([^\r\n]+)/i) || [])[0]?.split(" - ")[0] || "";
    const size = (raw.match(/Fleet Size:\s*([\d,]+)/i) || [])[1] || "";
    const detection = (raw.match(/Detection time:\s*(\d+)s/i) || [])[1] || "";
    const unitBlock = raw.split(/\bUnits\b/i)[1]?.split(/Fleet Size:/i)[0] || "";
    const units = unitBlock.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = line.replace(/\*\*/g, "").match(/^(.+?)\s+([\d,]+)$/);
      return match ? { unit: match[1].trim(), quantity: numberOrNull(match[2]) } : null;
    }).filter(Boolean);
    return [{
      server: labeledPageServer(raw), coord: coord || "", fleetId, fleetName, size,
      detectionSeconds: numberOrNull(detection), units, observedAt: (parseAePageTimestamp(raw) || new Date()).toISOString(),
      sourceKind: "fleet_overview", rawLine: raw.slice(0, 4000)
    }];
  }

  function parseOccupationText(text) {
    const raw = String(text || "");
    const coord = normalizeAstro((raw.match(new RegExp(`${galaxy}:\\d{2}:\\d{2}:\\d{2}`, "i")) || [])[0]);
    const rows = [];
    if (coord && /Revolt\s*\(you must destroy occupier's fleet first\)/i.test(raw)) {
      const fleetId = (raw.match(/fleet\.aspx\?fleet=(\d+)/i) || [])[1] || "";
      const playerId = (raw.match(/profile\.aspx\?player=(\d+)/i) || [])[1] || "";
      const fleetLine = raw.split(/\r?\n/).find((line) => /fleet\.aspx\?fleet=/i.test(line)) || "";
      const playerLine = raw.split(/\r?\n/).find((line) => /profile\.aspx\?player=/i.test(line)) || "";
      rows.push({
        server: labeledPageServer(raw), coord, ownerGuild: "", ownerPlayer: "",
        occupierGuild: extractGuildTag(playerLine), occupierPlayer: cleanLinkLabel(playerLine),
        occupierPlayerId: playerId, occupyingFleetId: fleetId, occupyingFleetName: cleanLinkLabel(fleetLine),
        occupyingFleetSize: numberOrNull((raw.match(/\bSize\s+(\d[\d,]*)/i) || [])[1]),
        state: "occupied", revoltState: "blocked", observedAt: (parseAePageTimestamp(raw) || new Date()).toISOString(), sourceKind: "occupation_page"
      });
    }
    if (coord && /\bRevolt Successful\b/i.test(raw)) {
      rows.push({ server: labeledPageServer(raw), coord, state: "liberated", revoltState: "successful", observedAt: (parseAePageTimestamp(raw) || new Date()).toISOString(), sourceKind: "revolt_page" });
    }
    return rows;
  }

  function parseGameEventsText(text) {
    const raw = String(text || "");
    const events = [];
    const observedAt = (parseAePageTimestamp(raw) || new Date()).toISOString();
    for (const match of raw.matchAll(/Revolt Report[\s\S]*?Revolts at\s+([^\r\n]+?)\s+caused this base occupation to end\./gi)) {
      events.push({ type: "revolt_success", baseLabel: match[1].trim(), observedAt, rawLine: match[0].slice(0, 2000) });
    }
    for (const match of raw.matchAll(/Trade Route Attacked[\s\S]*?(?=Trade Route Attacked|Revolt Report|Battle Report\s*\r?\nLocation|$)/gi)) {
      const block = match[0];
      events.push({ type: "trade_route_attacked", observedAt, actorGuild: extractGuildTag(block), rawLine: block.slice(0, 2000) });
    }
    return events;
  }

  function cleanLinkLabel(value) {
    return String(value || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\\([\[\]])/g, "$1").replace(/\s+/g, " ").trim();
  }

  function labeledPageServer(text) {
    return (String(text || "").match(/Server\s+([A-Za-z][A-Za-z0-9 _-]+)/i) || [])[1]?.trim() || "Borealis";
  }

  function cleanMovementPlayer(line, coord, eta, size) {
    let text = String(line || "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(coord, " ")
      .replace(eta, " ")
      .replace(size, " ")
      .replace(/\s+/g, " ")
      .trim();
    const parts = text.split(/\t| {2,}/).map((part) => part.trim()).filter(Boolean);
    text = parts[0] || text;
    return text.replace(/^Player\b/i, "").trim();
  }

  function parseDurationToMs(value) {
    const parts = String(value || "").split(":").map(Number);
    if (!parts.length || parts.length > 3 || !parts.every(Number.isFinite)) return 0;
    if (parts.length === 2) return ((parts[0] * 60) + parts[1]) * 60000;
    if (parts.length === 3) return (((parts[0] * 60) + parts[1]) * 60 + parts[2]) * 1000;
    return parts[0] * 60000;
  }

  function mergeImportedIntel(parsed) {
    parsed.systems.forEach((system) => {
      const region = systemToRegion(system);
      const systemNo = system.split(":")[2];
      intel.systems[region] ||= [];
      if (!intel.systems[region].includes(systemNo)) intel.systems[region].push(systemNo);
    });

    parsed.bases.forEach((base) => {
      intel.bases[base.coord] = { ...base, updatedAt: new Date().toISOString() };
    });

    parsed.astros.forEach((astro) => {
      intel.astros[astro.coord] = { ...astro, updatedAt: new Date().toISOString() };
    });

    sortSystemLists();
  }

  async function syncImportedIntel(parsed) {
    const stamp = new Date().toISOString();

    if (parsed.systems.length) {
      const rows = parsed.systems.map((system) => ({
        map_id: mapId,
        region_id: systemToRegion(system),
        system_id: system.split(":")[2],
        coord: system,
        updated_at: stamp
      }));
      await client.from("b24_systems").upsert(rows);
    }

    if (parsed.bases.length) {
      const uniqueBases = Object.values(Object.fromEntries(parsed.bases.map((base) => [base.coord, base])));
      const rows = uniqueBases.map((base) => ({
        map_id: mapId,
        coord: base.coord,
        region_id: base.region,
        system_id: base.system,
        guild: base.guild,
        label: base.label,
        updated_at: stamp
      }));
      await client.from("b24_bases").upsert(rows);
    }

    if (parsed.astros.length) {
      const rows = parsed.astros.map((astro) => ({
        map_id: mapId,
        coord: astro.coord,
        region_id: astro.region,
        system_id: astro.system,
        astro_no: astro.coord.split(":")[3],
        terrain: astro.terrain,
        astro_type: astro.type,
        attributes: astro.attributes,
        has_base: astro.hasBase,
        updated_at: stamp
      }));
      await client.from("b24_astros").upsert(rows);
    }

    if (parsed.incoming.length) {
      const rows = parsed.incoming.map((row) => ({
        map_id: mapId,
        incoming_id: movementIncomingId(row),
        defended_coord: row.defendedCoord,
        defended_region_id: astroToRegion(row.defendedCoord),
        defended_system_id: astroToSystem(row.defendedCoord),
        attacker_coord: row.attackerCoord || null,
        region_id: row.attackerCoord ? astroToRegion(row.attackerCoord) : null,
        system_id: row.attackerCoord ? astroToSystem(row.attackerCoord) : null,
        eta_minutes: row.etaMinutes,
        arrival_at: row.arrivalAt,
        reported_by: user || "VisionBot exporter",
        reported_by_user_id: telegramUser?.id ? String(telegramUser.id) : null,
        chat_id: telegramChatId || null,
        hostile_fleet: row.rawLine || "",
        note: row.note || "",
        status: "active",
        updated_at: stamp
      }));
      await client.from("b24_incoming").upsert(rows);
    }
  }

  function movementIncomingId(row) {
    if (row.fleetId) return `scan-fleet-${row.fleetId}`;
    return `scan-${hashText([row.defendedCoord, row.attackerCoord, row.player, row.size].join("|"))}`;
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let i = 0; i < String(value).length; i += 1) {
      hash ^= String(value).charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function paintAll() {
    PLAYABLE_SECTORS.forEach(paintSector);
  }

  function paintSector(id) {
    const cell = grid.querySelector(`[data-sector="${id}"]`);
    if (!cell) return;
    if (id === "00") {
      cell.className = "cell empty";
      return;
    }

    const sector = getSector(id);
    const coverage = coverageByRegion.get(id);
    const appBase = Boolean(coverage?.app);
    const friendlyBase = Boolean(coverage?.friendly);
    const enemyBase = Boolean(coverage?.enemy);
    const watchNeeded = Boolean(coverage?.watchNeeded);
    const watchAssigned = Boolean(coverage?.watchAssigned);
    cell.className = "cell unknown";
    cell.classList.toggle("selected", id === selected);
    cell.classList.toggle("has-friendly", sector.friendly);
    cell.classList.toggle("has-enemy", sector.enemy);
    cell.classList.toggle("has-scout", !coverage && sector.scout);
    cell.classList.toggle("has-reserved", sector.reserved);
    cell.classList.toggle("highlighted-target", id === highlightedSector);
    cell.classList.toggle("has-app", appBase);
    cell.classList.toggle("has-friendly", friendlyBase || (!coverage && sector.friendly));
    cell.classList.toggle("has-enemy", enemyBase || (!coverage && sector.enemy));
    cell.classList.toggle("has-scout-needed", watchNeeded);
    cell.classList.toggle("has-scout-assigned", watchAssigned);

    setFlag(cell, "A", appBase, "on-a");
    setFlag(cell, "F", friendlyBase || (!coverage && sector.friendly), "on-f");
    setFlag(cell, "E", enemyBase || (!coverage && sector.enemy), "on-e");
    setFlag(cell, "S", watchAssigned ? "assigned" : watchNeeded ? "needed" : (!coverage && sector.scout), watchAssigned ? "on-s-assigned" : watchNeeded ? "on-s-needed" : "on-s");

    const systems = getSystemCount(id);
    const bases = getBaseCount(id);
    const claims = getClaimCount(id);
    const operations = getOperationCount(id);
    const count = cell.querySelector(".intel-count");
    count.textContent = systems || bases || claims || operations ? `${systems}s ${bases}b ${claims}c ${operations}o` : "";
  }

  function setFlag(cell, letter, enabled, className) {
    const node = cell.querySelector(`[data-letter="${letter}"]`);
    if (!node) return;
    node.className = enabled ? className : "";
  }

  function selectSector(id) {
    if (id === "00") return;
    selected = id;
    PLAYABLE_SECTORS.forEach(paintSector);

    const sector = getSector(id);
    const coverage = coverageByRegion.get(id);
    const flags = coverage
      ? [coverage.app && "A", coverage.friendly && "F", coverage.enemy && "E", coverage.watchAssigned ? "S" : coverage.watchNeeded ? "S needed" : ""].filter(Boolean)
      : Object.keys(FLAG_LABELS).filter((flag) => sector[flag]).map((flag) => FLAG_LABELS[flag]);

    selectedSector.textContent = id;
    headerGalaxy.textContent = galaxy;
    headerSector.textContent = id;
    onlineCount.textContent = "1";
    selectedStatus.textContent = flags.length ? flags.join(" ") : "None";
    selectedSystems.textContent = `${getSystemCount(id)} known`;
    selectedBases.textContent = `${getBaseCount(id)} known`;
    selectedOperations.textContent = `${getOperationCount(id)} active`;
    renderSectorPanel(id);
    if (miniAppSession) {
      loadSharedIntel(id).catch((error) => {
        if (selected === id) {
          astroList.textContent = error.message || "Could not load sector intel.";
          setSync("Intel unavailable");
        }
      });
    }
  }

  function renderSectorPanel(id) {
    const systems = getSystemsForRegion(id);
    const bases = getBasesForRegion(id);
    const astros = getAstrosForRegion(id);

    sectorPanelTitle.textContent = id;
    sectorCounts.textContent = `${systems.length} systems / ${bases.length} bases`;
    claimsPanelTitle.textContent = id;
    renderClaimsPanel(id);
    renderOperationsPanel(id);

    if (bases.length) {
      baseList.innerHTML = bases.map((base) => {
        const stance = stanceForBase(base, id);
        const stanceLabel = stance === "friend" ? "Friendly" : stance === "enemy" ? "Enemy" : "";
        const age = formatIntelAge(base.updatedAt);
        const label = escapeHtml([base.label || "Unknown owner", age].filter(Boolean).join(" - "));
        const coord = escapeHtml(base.coord);
        return `<div class="base-row"><div><strong>${coord}</strong><span>${label}</span></div><div class="coordinate-row-actions"><span class="base-guild">${escapeHtml(stanceLabel ? `${stanceLabel} ${base.guild || ""}` : base.guild || "")}</span><button class="history-link" type="button" data-history-coord="${coord}">View history</button></div></div>`;
      }).join("");
    } else {
      baseList.textContent = "No bases imported for this sector.";
    }

    if (systems.length) {
      systemList.innerHTML = systems.map((systemNo) => {
        return `<span class="system-chip">${escapeHtml(id)}:${escapeHtml(systemNo)}</span>`;
      }).join("");
    } else {
      systemList.textContent = "No systems imported for this sector.";
    }

    if (astros.length) {
      astroList.innerHTML = astros.map((astro) => {
        const description = [astro.terrain, astro.type].filter(Boolean).join(" ") || "Unknown astro";
        const attributes = Array.isArray(astro.attributes) && astro.attributes.length ? astro.attributes.join("/") : "";
        const age = formatIntelAge(astro.updatedAt);
        return `<div class="astro-row"><strong>${escapeHtml(astro.coord)}</strong><span>${escapeHtml(description)}</span><em>${escapeHtml(attributes)}${astro.hasBase ? " base" : ""}${age ? ` | ${escapeHtml(age)}` : ""}</em><button class="history-link" type="button" data-history-coord="${escapeHtml(astro.coord)}">View history</button></div>`;
      }).join("");
    } else {
      astroList.textContent = miniAppSession && !sharedIntelByRegion.has(id)
        ? "Loading astro intel..."
        : "No astros imported for this sector.";
    }

    const coverage = coverageByRegion.get(id);
    if (!coverage) {
      watchActionRow.hidden = true;
      watchActionRow.innerHTML = "";
      return;
    }
    watchActionRow.hidden = false;
    if (coverage.app) {
      watchActionRow.innerHTML = `<span><strong>${escapeHtml(id)}</strong> is covered by an APP base.</span>`;
    } else if (coverage.watchAssigned) {
      const own = String(coverage.watchOwnerId || "") === String(miniAppSession?.userId || "");
      watchActionRow.innerHTML = `<span><strong>${escapeHtml(id)}</strong> watched by ${escapeHtml(coverage.watchOwner || "Guild member")}</span>${own ? `<button class="ghost-button" type="button" data-watch-action="release" data-watch-region="${escapeHtml(id)}">Release Watch</button>` : ""}`;
    } else {
      watchActionRow.innerHTML = `<span><strong>${escapeHtml(id)}</strong> needs scout coverage.</span><button class="command-button" type="button" data-watch-action="take" data-watch-region="${escapeHtml(id)}">Claim Watch</button>`;
    }
  }

  function renderClaimsPanel(id) {
    const activeClaims = getClaimsForRegion(id);
    claimCounts.textContent = `${activeClaims.length} active`;

    if (!activeClaims.length) {
      claimList.textContent = "No active claims for this sector.";
      return;
    }

    claimList.innerHTML = activeClaims.map((claim) => {
      const arrival = claim.arrivalAt ? formatCountdown(claim.arrivalAt, "arrived") : "No arrival";
      const localTime = claim.arrivalAt ? formatLocalDateTime(claim.arrivalAt) : "";
      const claimerTime = claim.arrivalLabel ? `${escapeHtml(claim.arrivalLabel)} claimer time` : "";
      const note = claim.note ? ` - ${escapeHtml(claim.note)}` : "";
      const by = claim.claimedBy ? ` by ${escapeHtml(claim.claimedBy)}` : "";
      return `<div class="claim-row"><div><strong>${escapeHtml(claim.target)}</strong><span class="claim-meta">Claimed${by}${note}</span><button class="unclaim-button" type="button" data-unclaim="${escapeHtml(claim.id)}">Unclaim</button></div><div class="claim-time">Lands ${escapeHtml(arrival)}<br><span>${escapeHtml(localTime)}${claimerTime ? " / " + claimerTime : ""}</span></div></div>`;
    }).join("");
  }

  function renderOperationsPanel(id) {
    const activeOperations = getOperationsForRegion(id);
    operationsPanelTitle.textContent = id;
    operationCounts.textContent = `${activeOperations.length} active`;

    if (!activeOperations.length) {
      operationList.textContent = "No active operations for this sector.";
      return;
    }

    operationList.innerHTML = activeOperations.map((operation) => {
      const countdown = operation.arrivalAt ? formatCountdown(operation.arrivalAt, "arrived") : "No arrival";
      const target = operation.type === "defense"
        ? `${escapeHtml(operation.defended || "?")} <= ${escapeHtml(operation.hostile || "?")}`
        : escapeHtml(operation.target || "?");
      const note = operation.note ? ` - ${escapeHtml(operation.note)}` : "";
      return `<div class="operation-row"><div><strong>${escapeHtml(operation.shortId || operation.id)} ${escapeHtml(operation.type)}</strong><span>${target}${note}</span></div><div class="operation-time">${escapeHtml(countdown)}</div></div>`;
    }).join("");
  }

  function renderAttackBoard() {
    const activeClaims = getAllActiveClaims();
    const confirmed = activeClaims.filter((claim) => claim.confirmedSent).length;
    attackCounts.textContent = `${activeClaims.length} planned / ${confirmed} confirmed`;

    if (!activeClaims.length) {
      attackBoard.textContent = "No active attacks planned.";
      return;
    }

    attackBoard.innerHTML = activeClaims.map((claim) => {
      const localTime = claim.arrivalAt ? formatLocalDateTime(claim.arrivalAt) : "No arrival";
      const countdown = claim.arrivalAt ? formatCountdown(claim.arrivalAt, "arrived") : "";
      const attacker = claim.claimedBy || "Unknown";
      const note = claim.note ? ` - ${escapeHtml(claim.note)}` : "";
      const statusClass = claim.confirmedSent ? "confirmed" : "";
      const status = claim.confirmedSent ? "Confirmed" : "Planned";
      const action = claim.confirmedSent
        ? `<button class="unclaim-button" type="button" data-unconfirm-claim="${escapeHtml(claim.id)}">Unconfirm</button>`
        : `<button class="unclaim-button" type="button" data-confirm-claim="${escapeHtml(claim.id)}">Confirm Sent</button>`;
      const fleet = claim.fleetLabel ? `<span class="attack-meta">${escapeHtml(claim.fleetLabel)}</span>` : "";
      const claimerTime = claim.arrivalLabel ? ` / ${escapeHtml(claim.arrivalLabel)} claimer time` : "";

      return `<div class="attack-row"><div><strong>${escapeHtml(attacker)}</strong><span class="attack-meta">${escapeHtml(claim.target)}${note}</span>${fleet}</div><div><strong>${escapeHtml(localTime)}</strong><span class="attack-meta">Lands ${escapeHtml(countdown)}${claimerTime}</span></div><div class="attack-actions"><span class="attack-status ${statusClass}">${status}</span>${action}<button class="unclaim-button" type="button" data-unclaim="${escapeHtml(claim.id)}">Unclaim</button></div></div>`;
    }).join("");
  }

  function renderIncomingBoard() {
    if (!incomingBoard || !incomingCounts) return;

    if (!telegramChatId) {
      incomingCounts.textContent = "group needed";
      incomingBoard.textContent = "Open this map from Lysander's /map button in an approved group to show that group's incoming reports.";
      return;
    }

    const activeIncoming = getAllActiveIncoming();
    incomingCounts.textContent = `${activeIncoming.length} active`;

    if (!activeIncoming.length) {
      incomingBoard.textContent = "No active incoming reports.";
      return;
    }

    const visible = activeIncoming.slice(0, 20);
    const lines = visible.map((row) => escapeHtml(formatIncomingMiniLine(row))).join("\n");
    const more = activeIncoming.length > visible.length
      ? `<div class="incoming-more">1-${visible.length} of ${activeIncoming.length} incoming</div>`
      : "";
    incomingBoard.innerHTML = `<pre>${lines}</pre>${more}`;
  }

  function formatIncomingMiniLine(row) {
    const eta = formatCompactCountdown(row.arrivalAt);
    const defended = row.defended || "?";
    const attacker = row.attacker || incomingNoteValue(row.note, "origin") || "?";
    const tag = incomingTag(row.note);
    const size = incomingNoteValue(row.note, "size");
    const tagText = tag ? ` ${tag}` : "";
    const sizeText = size ? ` ${size}` : "";
    return `${eta} ${defended} <= ${attacker}${tagText}${sizeText}`;
  }

  function incomingNoteValue(note, key) {
    const pattern = new RegExp(`(?:^|\\|)\\s*${key}\\s+([^|]+)`, "i");
    const match = String(note || "").match(pattern);
    return match ? match[1].trim() : "";
  }

  function incomingTag(note) {
    return incomingNoteValue(note, "from") || (incomingNoteValue(note, "player").match(/(\[[^\]]+\])/) || [])[1] || "";
  }

  function renderBulkTargets() {
    if (!bulkTargetText || !parsedTargets) return;

    const rows = parseBulkTargets(bulkTargetText.value);
    const activeTargets = new Set(getAllActiveClaims().map((claim) => claim.target));
    const stale = rows.filter((row) => row.status === "STALE").length;
    const unclaimed = rows.filter((row) => !activeTargets.has(row.coord)).length;

    bulkLineCount.textContent = `${rows.length} line${rows.length === 1 ? "" : "s"} detected`;
    parsedTotal.textContent = `Total: ${rows.length}`;
    parsedStale.textContent = `Stale: ${stale}`;
    parsedUnclaimed.textContent = `Unclaimed: ${unclaimed}`;

    if (!rows.length) {
      parsedTargets.textContent = "Paste target intel above to build a claim list.";
      return;
    }

    const waveOptions = landingWindowOptions().map((value) => `<option value="${value}">${value}</option>`).join("");
    const hasWindow = Boolean(attackWindowStart.value);
    parsedTargets.innerHTML = [
      `<div class="target-row target-head"><span>Coordinate</span><span>Guild Tags</span><span>Player Name</span><span>Intel Age</span><span>Wave Time</span><span>Status</span><span>Action</span></div>`,
      ...rows.map((row) => {
        const claimed = activeTargets.has(row.coord);
        const note = [row.guildTags, row.player].filter(Boolean).join(" ");
        const status = claimed ? "CLAIMED" : row.status;
        const statusClass = claimed ? "claimed" : row.status.toLowerCase();
        const wave = hasWindow
          ? `<select data-wave-time aria-label="Landing time for ${escapeHtml(row.coord)}">${waveOptions}</select>`
          : `<select data-wave-time disabled aria-label="Landing time for ${escapeHtml(row.coord)}"><option>Step 1 first</option></select>`;
        const action = claimed
          ? `<button class="row-claim-button" type="button" disabled>Claimed</button>`
          : `<button class="row-claim-button" type="button" ${hasWindow ? "" : "disabled"} data-claim-target="${escapeHtml(row.coord)}" data-claim-note="${escapeHtml(note)}">Claim</button>`;

        return `<div class="target-row"><span><strong>${escapeHtml(row.coord)}</strong></span><span>${escapeHtml(row.guildTags || "-")}</span><span>${escapeHtml(row.player || "Unknown")}</span><span>${escapeHtml(row.age || "Unknown")}</span><span>${wave}</span><span><mark class="${escapeHtml(statusClass)}">${escapeHtml(status)}</mark></span><span>${action}</span></div>`;
      })
    ].join("");
  }

  async function finalizeParsedAttack() {
    const rows = parseBulkTargets(bulkTargetText.value);
    if (!rows.length) {
      finalizeStatus.textContent = "Paste targets before claiming unclaimed rows.";
      return;
    }
    if (!attackWindowStart.value) {
      finalizeStatus.textContent = "Step 1 required: pick a 4 hour landing window above.";
      return;
    }

    const activeTargets = new Set(getAllActiveClaims().map((claim) => claim.target));
    const rowNodes = Array.from(parsedTargets.querySelectorAll(".target-row:not(.target-head)"));
    const toClaim = rows.filter((row) => !activeTargets.has(row.coord));
    for (const row of toClaim) {
      const node = rowNodes.find((candidate) => candidate.textContent.includes(row.coord));
      const arrivalLabel = node?.querySelector("[data-wave-time]")?.value || attackWindowStart.value;
      const note = [row.guildTags, row.player].filter(Boolean).join(" ");
      await createClaimForTarget(row.coord, note, arrivalLabel);
    }
    finalizeStatus.textContent = `Claimed ${toClaim.length} unclaimed target${toClaim.length === 1 ? "" : "s"} under your name.`;
    renderBulkTargets();
  }

  function parseBulkTargets(text) {
    const rows = [];
    const seen = new Set();
    const coordPattern = new RegExp(`\\b${galaxy}:\\d{2}:\\d{2}:\\d{2}\\b`, "i");

    String(text || "").split(/\r?\n/).forEach((line) => {
      const match = line.match(coordPattern);
      if (!match) return;

      const coord = normalizeAstro(match[0]);
      if (!coord || seen.has(coord)) return;
      seen.add(coord);

      const afterCoord = line.slice(match.index + match[0].length).replace(/^\s*-\s*/, "").trim();
      const parts = afterCoord.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
      const guildTags = ((parts[0] || afterCoord).match(/\[[^\]]+\]/g) || []).join(" ");
      const player = (parts[0] || "")
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const age = parts.find((part) => /\bold\b/i.test(part)) || "";
      const status = /\bstale\b/i.test(line) ? "STALE" : "FRESH";

      rows.push({ coord, guildTags, player, age, status });
    });

    return rows.sort((a, b) => a.coord.localeCompare(b.coord));
  }

  function getSector(id) {
    return {
      friendly: false,
      enemy: false,
      scout: false,
      reserved: false,
      updatedBy: "",
      updatedAt: "",
      ...(intel.sectors[id] || {})
    };
  }

  function getSystemCount(region) {
    return getSystemsForRegion(region).length;
  }

  function getBaseCount(region) {
    return getBasesForRegion(region).length;
  }

  function getClaimCount(region) {
    return getClaimsForRegion(region).length;
  }

  function getOperationCount(region) {
    return getOperationsForRegion(region).length;
  }

  function getSystemsForRegion(region) {
    const coverage = coverageByRegion.get(region);
    if (coverage) return [...new Set(coverage.systems || [])].sort();
    return [...(intel.systems[region] || [])].sort();
  }

  function getBasesForRegion(region) {
    const coverage = coverageByRegion.get(region);
    if (coverage) {
      return [...(coverage.bases || [])]
        .map((base) => ({ ...base, region }))
        .sort((a, b) => String(a.coord).localeCompare(String(b.coord)));
    }
    return Object.values(intel.bases)
      .filter((base) => base.region === region)
      .sort((a, b) => a.coord.localeCompare(b.coord));
  }

  function getAstrosForRegion(region) {
    return Object.values(intel.astros || {})
      .filter((astro) => astro.region === region)
      .sort((a, b) => String(a.coord).localeCompare(String(b.coord)));
  }

  function stanceForBase(base, region) {
    const stances = sharedIntelByRegion.get(region)?.stances || [];
    const coord = stances.find((row) => row.type === "coord" && row.value === base.coord);
    if (coord) return coord.stance;
    const tag = String(base.guild || "").match(/\[[^\]]+\]/)?.[0]?.toUpperCase();
    return tag ? stances.find((row) => row.type === "tag" && String(row.value).toUpperCase() === tag)?.stance || "" : "";
  }

  function formatIntelAge(value) {
    const time = new Date(value || "").getTime();
    if (!Number.isFinite(time)) return "";
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 60) return `${minutes}m old`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h old`;
    return `${Math.floor(hours / 24)}d old`;
  }

  function getClaimsForRegion(region) {
    return getAllActiveClaims()
      .filter((claim) => claim.region === region && isClaimActive(claim))
      .sort((a, b) => a.target.localeCompare(b.target) || String(a.arrivalAt).localeCompare(String(b.arrivalAt)));
  }

  function getAllActiveClaims() {
    return Object.values(intel.claims || {})
      .filter(isClaimActive)
      .sort((a, b) => String(a.arrivalAt).localeCompare(String(b.arrivalAt)) || a.target.localeCompare(b.target));
  }

  function getAllActiveIncoming() {
    return Object.values(intel.incoming || {})
      .filter(isIncomingActive)
      .sort((a, b) => String(a.arrivalAt).localeCompare(String(b.arrivalAt)) || String(a.defended).localeCompare(String(b.defended)));
  }

  function getOperationsForRegion(region) {
    return Object.values(intel.operations || {})
      .filter((operation) => operation.region === region && isOperationActive(operation))
      .sort((a, b) => String(a.arrivalAt).localeCompare(String(b.arrivalAt)) || a.shortId.localeCompare(b.shortId));
  }

  function isClaimActive(claim) {
    if (!claim || claim.status !== "active") return false;
    if (!claim.arrivalAt) return true;
    return new Date(claim.arrivalAt).getTime() > Date.now();
  }

  function isOperationActive(operation) {
    if (!operation || operation.status !== "active") return false;
    if (!operation.arrivalAt) return true;
    return new Date(operation.arrivalAt).getTime() > Date.now();
  }

  function isIncomingActive(row) {
    if (!row || row.status !== "active") return false;
    if (!row.arrivalAt) return true;
    return new Date(row.arrivalAt).getTime() > Date.now();
  }

  function loadLocalState() {
    const blank = { sectors: {}, systems: {}, bases: {}, astros: {}, claims: {}, operations: {}, incoming: {} };
    try {
      return { ...blank, ...JSON.parse(localStorage.getItem(storageKey) || "{}") };
    } catch {
      return blank;
    }
  }

  function saveLocalState() {
    localStorage.setItem(storageKey, JSON.stringify(intel));
  }

  function storageKeyFor(nextMapId, scopeId) {
    const scope = scopeId ? String(scopeId) : "no-scope";
    return `vision-intel-${nextMapId}-${scope}`;
  }

  function sortSystemLists() {
    Object.keys(intel.systems).forEach((region) => {
      intel.systems[region] = [...new Set(intel.systems[region])].sort();
    });
  }

  function normalizeSystem(value) {
    const pattern = new RegExp(`^${galaxy}:(\\d{2}):(\\d{2})$`);
    const match = String(value || "").toUpperCase().match(pattern);
    return match ? `${galaxy}:${match[1]}:${match[2]}` : "";
  }

  function normalizeAstro(value) {
    const pattern = new RegExp(`^${galaxy}:(\\d{2}):(\\d{2}):(\\d{2})$`);
    const match = String(value || "").toUpperCase().match(pattern);
    return match ? `${galaxy}:${match[1]}:${match[2]}:${match[3]}` : "";
  }

  function systemToRegion(system) {
    return normalizeRegionId(system.split(":").slice(0, 2).join(":"));
  }

  function astroToRegion(astro) {
    return normalizeRegionId(astro.split(":").slice(0, 2).join(":"));
  }

  function operationRegion(row) {
    const value = row?.target_coord || row?.defended_coord || row?.hostile_origin || row?.target || row?.defended || row?.hostile || "";
    const astro = normalizeAstro(value);
    if (astro) return astroToRegion(astro);
    const system = normalizeSystem(value);
    return system ? systemToRegion(system) : "";
  }

  function incomingRegion(row) {
    const value = row?.defended_coord || row?.attacker_coord || row?.defended || row?.attacker || "";
    const astro = normalizeAstro(value);
    if (astro) return astroToRegion(astro);
    const system = normalizeSystem(value);
    return system ? systemToRegion(system) : "";
  }

  function rowBelongsToCurrentChat(row) {
    if (!telegramChatId) return false;
    return String(row?.chat_id || "") === String(telegramChatId);
  }

  function astroToSystem(astro) {
    return astro.split(":").slice(0, 3).join(":");
  }

  function populateArrivalOptions() {
    const defaultValue = nearestQuarterHour(new Date());
    const allOptions = [];

    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 15) {
        const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        allOptions.push(`<option value="${value}">${value}</option>`);
      }
    }

    if (attackWindowStart && !attackWindowStart.options.length) {
      attackWindowStart.innerHTML = `<option value="">Pick 4 hour window</option>${allOptions.join("")}`;
      attackWindowStart.value = "";
    }
    if (claimArrival) {
      const options = landingWindowOptions();
      claimArrival.disabled = !options.length;
      claimArrival.innerHTML = options.length
        ? options.map((value) => `<option value="${value}">${value}</option>`).join("")
        : `<option value="">Step 1: pick window above</option>`;
      claimArrival.value = options.includes(defaultValue) ? defaultValue : options[0] || "";
    }
    renderWindowSummary();
  }

  function landingWindowOptions() {
    const start = attackWindowStart?.value || "";
    if (!start) return [];
    const base = nextTimeOfDay(start);
    const options = [];
    for (let offset = 0; offset < 240; offset += 15) {
      const time = new Date(base.getTime() + offset * 60 * 1000);
      options.push(`${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`);
    }
    return options;
  }

  function renderWindowSummary() {
    if (!attackWindowSummary) return;
    const options = landingWindowOptions();
    if (!options.length) {
      attackWindowSummary.textContent = "Step 1 required before claiming targets";
      return;
    }
    const start = options[0];
    const endDate = new Date(nextTimeOfDay(start).getTime() + 4 * 60 * 60 * 1000);
    const end = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
    attackWindowSummary.textContent = `${start} to ${end} local/server display`;
  }

  function nearestQuarterHour(date) {
    const rounded = new Date(date.getTime());
    rounded.setSeconds(0, 0);
    rounded.setMinutes(Math.ceil(rounded.getMinutes() / 15) * 15);
    if (rounded.getMinutes() === 60) {
      rounded.setHours(rounded.getHours() + 1, 0, 0, 0);
    }
    return `${String(rounded.getHours()).padStart(2, "0")}:${String(rounded.getMinutes()).padStart(2, "0")}`;
  }

  function nextTimeOfDay(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    const next = new Date();
    if (!match) return next;
    next.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next;
  }

  function formatCountdown(value, doneLabel) {
    const diff = new Date(value).getTime() - Date.now();
    if (!Number.isFinite(diff)) return "";
    if (diff <= 0) return doneLabel;

    const total = Math.floor(diff / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  function formatCompactCountdown(value) {
    const diff = new Date(value).getTime() - Date.now();
    if (!Number.isFinite(diff)) return "--h--m";
    if (diff <= 0) return "00h00m";

    const totalMinutes = Math.floor(diff / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}h${String(minutes).padStart(2, "0")}m`;
  }

  function formatLocalDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function tickClaims() {
    renderClaimsPanel(selected);
    renderAttackBoard();
    renderIncomingBoard();
    paintSector(selected);
  }

  function cleanOwnerLabel(value, coord) {
    return String(value || "")
      .replace(/^44-;-\s*/, "")
      .replace(coord, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeGalaxy(value) {
    const match = String(value || "").toUpperCase().match(/^B\d{2}$/);
    return match ? match[0] : "";
  }

  function normalizeExternalLocation(value) {
    const match = String(value || "").toUpperCase().match(/^(B\d{2})(?::(\d{1,2}))?(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
    if (!match) return "";
    const parts = [match[1], match[2], match[3], match[4]].filter(Boolean);
    return [parts[0], ...parts.slice(1).map((part) => String(Number(part)).padStart(2, "0"))].join(":");
  }

  function galaxyFromLocation(value) {
    return normalizeGalaxy(String(value || "").split(":")[0]);
  }

  function locationToRegion(value, activeGalaxy) {
    const parts = String(value || "").split(":");
    if (parts.length < 2 || normalizeGalaxy(parts[0]) !== activeGalaxy) return "";
    return normalizeRegionId(`${parts[0]}:${Number(parts[1])}`);
  }

  function galaxyToMapId(value) {
    return `${normalizeGalaxy(value).toLowerCase()}-main`;
  }

  function galaxyFromMapId(value) {
    const match = String(value || "").toUpperCase().match(/^(B\d{2})/);
    return match ? match[1] : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeRegionId(value) {
    const pattern = new RegExp(`^${galaxy}:(\\d{1,2})$`);
    const match = String(value || "").toUpperCase().match(pattern);
    if (!match) return String(value || "");
    return `${galaxy}:${Number(match[1])}`;
  }

  function flagsFromLegacyStatus(status) {
    switch (status) {
      case "scout":
        return { scout: true };
      case "base":
        return { friendly: true };
      case "enemy":
        return { enemy: true };
      case "reserved":
        return { reserved: true };
      default:
        return {};
    }
  }

  function getTelegramUser() {
    return tg?.initDataUnsafe?.user || null;
  }

  function formatTelegramUser(tgUser) {
    if (!tgUser) return "Local user";
    return tgUser.username ? `@${tgUser.username}` : [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
  }

  function getTelegramChatId() {
    const chat = tg?.initDataUnsafe?.chat;
    return chat?.id ? String(chat.id) : String(urlParams.get("chat_id") || "");
  }

  function setSync(label, live = false) {
    syncStatus.textContent = label;
    syncStatus.classList.toggle("live", live);
  }

  window.addEventListener("beforeunload", () => {
    if (realtimeChannel && client) client.removeChannel(realtimeChannel);
  });
})();
