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
  const sectorPanelTitle = document.querySelector("#sectorPanelTitle");
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
  const template = document.querySelector("#cellTemplate");
  const toolButtons = Array.from(document.querySelectorAll(".tool-button"));
  const importText = document.querySelector("#importText");
  const importButton = document.querySelector("#importButton");
  const bookmarkletButton = document.querySelector("#bookmarkletButton");
  const importResult = document.querySelector("#importResult");

  const urlParams = new URLSearchParams(location.search);
  const defaultGalaxy = normalizeGalaxy(config.GALAXY || galaxyFromMapId(config.MAP_ID) || "B24");
  const initialLocation = normalizeExternalLocation(urlParams.get("loc"));
  let galaxy = normalizeGalaxy(urlParams.get("gal")) || galaxyFromLocation(initialLocation) || defaultGalaxy;
  let mapId = galaxyToMapId(galaxy);
  let storageKey = `vision-intel-${mapId}`;
  const hasSupabase = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase);
  const user = getTelegramUser();
  const telegramChatId = getTelegramChatId();
  let selected = `${galaxy}:1`;
  let highlightedSector = "";
  let client = null;
  let realtimeChannel = null;
  let intel = loadLocalState();

  init();

  async function init() {
    if (shouldBlockDirectAccess()) {
      renderAccessRequired();
      return;
    }

    tg?.ready();
    tg?.expand();

    if (hasSupabase && !urlParams.get("gal") && !initialLocation) {
      client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      const preferredGalaxy = await loadPreferredGalaxy();
      setGalaxy(preferredGalaxy || galaxy);
    } else {
      setGalaxy(galaxy);
    }

    populateArrivalOptions();
    renderGrid();
    bindControls();
    selectSector(selected);
    renderAttackBoard();
    renderIncomingBoard();
    renderBulkTargets();
    setInterval(tickClaims, 1000);

    if (hasSupabase) {
      connectSupabase();
    } else {
      setSync("Local");
    }
  }

  function setGalaxy(nextGalaxy) {
    galaxy = normalizeGalaxy(nextGalaxy) || defaultGalaxy;
    mapId = galaxyToMapId(galaxy);
    storageKey = `vision-intel-${mapId}`;
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
    return !tg?.initData;
  }

  function renderAccessRequired() {
    document.body.classList.add("access-locked");
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    shell.innerHTML = [
      `<section class="access-lock">`,
      `<h1>VisionBot Access Required</h1>`,
      `<p>Open this map from Lysander in Telegram.</p>`,
      `<p>Use <code>/map</code> in your approved guild group or DM.</p>`,
      `</section>`
    ].join("");
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
      button.addEventListener("click", () => {
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
      mergeImportedIntel(parsed);
      saveLocalState();
      paintAll();
      selectSector(selected);
      importResult.textContent = `Imported ${parsed.systems.length} systems, ${parsed.bases.length} bases, ${parsed.astros.length} astros, ${parsed.incoming.length} incoming`;
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

  async function copyBookmarklet() {
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      importResult.textContent = "Supabase config needed first";
      return;
    }

    const code = `javascript:(async()=>{const GALAXY=${JSON.stringify(galaxy)},MAP_ID=${JSON.stringify(mapId)},SUPA=${JSON.stringify(config.SUPABASE_URL)},KEY=${JSON.stringify(config.SUPABASE_ANON_KEY)},CHAT_ID=${JSON.stringify(telegramChatId)},USER=${JSON.stringify(user?.username || user?.first_name || "VisionBot exporter")},USER_ID=${JSON.stringify(user?.id ? String(user.id) : "")};const now=new Date().toISOString();const hdr={'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'};const post=async(t,r,c)=>{if(!r.length)return 0;const u=SUPA+'/rest/v1/'+t+'?on_conflict='+encodeURIComponent(c);const x=await fetch(u,{method:'POST',headers:hdr,body:JSON.stringify(r)});if(!x.ok)throw new Error(t+': '+await x.text());return r.length};const re3=new RegExp(GALAXY+':\\\\d{2}:\\\\d{2}(?!:)','g'),re4=new RegExp(GALAXY+':\\\\d{2}:\\\\d{2}:\\\\d{2}','g');const reg=v=>{const m=String(v||'').match(new RegExp('^'+GALAXY+':(\\\\d{1,2})'));return m?GALAXY+':'+Number(m[1]):''};const sys=v=>String(v||'').split(':').slice(0,3).join(':');const clean=(v,c)=>String(v||'').replace(/^44-;-\\s*/,'').replace(c,'').replace(/\\s+/g,' ').trim();const dur=s=>{const p=String(s||'').split(':').map(Number);return p.length===2?((p[0]*60+p[1])*60000):p.length===3?(((p[0]*60+p[1])*60+p[2])*1000):0};const hash=s=>{let h=2166136261;for(let i=0;i<String(s).length;i++){h^=String(s).charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};const html=document.documentElement.innerHTML;const systems=[...new Set(html.match(re3)||[])].map(c=>({map_id:MAP_ID,coord:c,region_id:reg(c),system_id:c.split(':')[2],updated_at:now}));const bases=[];if(typeof mapToolBox_data!=='undefined'){for(const v of Object.values(mapToolBox_data||{})){const s=String(v||''),c=(s.match(re4)||[])[0];if(!c)continue;const g=(s.match(/\\[[A-Za-z0-9 _-]{1,12}\\]/)||[])[0]||'',txt=s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();bases.push({map_id:MAP_ID,coord:c,region_id:reg(c),system_id:sys(c),guild:g,label:clean(txt,c),updated_at:now})}}const seen={};const uniqueBases=bases.filter(b=>!seen[b.coord]&&(seen[b.coord]=1));const body=document.body.innerText||'',astros=[];for(const line of body.split(/\\r?\\n/)){const c=(line.match(re4)||[])[0];if(!c)continue;const rest=line.replace(c,'').trim(),m=rest.match(/^([A-Za-z]+)\\s+([A-Za-z]+)\\s+((?:\\d+\\s+){5}\\d+)(?:\\s+(Yes))?/);if(!m)continue;astros.push({map_id:MAP_ID,coord:c,region_id:reg(c),system_id:sys(c),astro_no:c.split(':')[3],terrain:m[1],astro_type:m[2],attributes:m[3].trim().split(/\\s+/).map(Number),has_base:m[4]==='Yes',updated_at:now})}const incoming=[];document.querySelectorAll('tr').forEach(tr=>{const cells=[...tr.querySelectorAll('td,th')].map(td=>td.innerText.trim());if(cells.length<4||!/\\d{1,4}:\\d{2}(?::\\d{2})?/.test(cells[2]||''))return;const destCell=tr.querySelectorAll('td,th')[1],sizeCell=tr.querySelectorAll('td,th')[3];const link=(destCell&&destCell.querySelector('a[href*=\"loc=\"]'))||null;const fleet=(sizeCell&&sizeCell.querySelector('a[href*=\"fleet=\"]'))||null;const href=link?link.href:'',coord=((href.match(/loc=([^&]+)/)||[])[1]||cells[1].match(re4)?.[0]||'').toUpperCase();if(!coord||!coord.startsWith(GALAXY+':'))return;const ms=dur(cells[2]);if(!ms)return;const fleetId=(fleet?.href.match(/fleet=(\\d+)/)||[])[1]||'';const player=cells[0],size=(cells[3].match(/[\\d,]+/)||[])[0]||'',arrival=new Date(Date.now()+ms).toISOString();incoming.push({map_id:MAP_ID,incoming_id:fleetId?'scan-fleet-'+fleetId:'scan-'+hash([coord,player,size].join('|')),defended_coord:coord,defended_region_id:reg(coord),defended_system_id:sys(coord),attacker_coord:null,region_id:null,system_id:null,eta_minutes:Math.max(1,Math.ceil(ms/60000)),arrival_at:arrival,reported_by:USER,reported_by_user_id:USER_ID||null,chat_id:CHAT_ID||null,hostile_fleet:tr.innerText.replace(/\\s+/g,' ').trim(),note:[player?'player '+player:'',size?'size '+size:''].filter(Boolean).join(' | '),status:'active',updated_at:now})});try{const a=await post('b24_systems',systems,'map_id,coord'),b=await post('b24_bases',uniqueBases,'map_id,coord'),c=await post('b24_astros',astros,'map_id,coord'),d=await post('b24_incoming',incoming,'map_id,incoming_id');alert('VisionBot import complete for '+GALAXY+': '+a+' systems, '+b+' bases, '+c+' astros, '+d+' incoming')}catch(e){console.error(e);alert('VisionBot import failed: '+e.message)}})()`;

    try {
      await navigator.clipboard.writeText(code);
      importResult.textContent = "Bookmarklet copied";
    } catch {
      importText.value = code;
      importResult.textContent = "Bookmarklet placed in box";
    }
  }

  function parseIntel(text) {
    const result = { systems: [], bases: [], astros: [], incoming: [] };

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

      result.incoming.push(...parseIncomingMovementText(text));
      return result;
    } catch {
      return parseTextIntel(text);
    }
  }

  function parseTextIntel(text) {
    const result = { systems: [], bases: [], astros: [], incoming: [] };
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

    result.incoming.push(...parseIncomingMovementText(text));
    return result;
  }

  function parseIncomingMovementText(text) {
    const rows = [];
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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
      rows.push({
        defendedCoord: coord,
        attackerCoord: "",
        etaMinutes: Math.max(1, Math.ceil(duration / 60000)),
        arrivalAt: new Date(Date.now() + duration).toISOString(),
        player,
        fleetId: fleetMatch?.[1] || "",
        size: sizeMatch?.[1] || "",
        note: [player ? `player ${player}` : "", sizeMatch?.[1] ? `size ${sizeMatch[1]}` : ""].filter(Boolean).join(" | "),
        rawLine: line
      });
    });
    return rows;
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
        reported_by_user_id: tg?.initDataUnsafe?.user?.id ? String(tg.initDataUnsafe.user.id) : null,
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
    cell.className = "cell unknown";
    cell.classList.toggle("selected", id === selected);
    cell.classList.toggle("has-friendly", sector.friendly);
    cell.classList.toggle("has-enemy", sector.enemy);
    cell.classList.toggle("has-scout", sector.scout);
    cell.classList.toggle("has-reserved", sector.reserved);
    cell.classList.toggle("highlighted-target", id === highlightedSector);

    setFlag(cell, "F", sector.friendly, "on-f");
    setFlag(cell, "E", sector.enemy, "on-e");
    setFlag(cell, "S", sector.scout, "on-s");
    setFlag(cell, "R", sector.reserved, "on-r");

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
    const flags = Object.keys(FLAG_LABELS)
      .filter((flag) => sector[flag])
      .map((flag) => FLAG_LABELS[flag]);

    selectedSector.textContent = id;
    headerGalaxy.textContent = galaxy;
    headerSector.textContent = id;
    onlineCount.textContent = "1";
    selectedStatus.textContent = flags.length ? flags.join(" ") : "None";
    selectedSystems.textContent = `${getSystemCount(id)} known`;
    selectedBases.textContent = `${getBaseCount(id)} known`;
    selectedOperations.textContent = `${getOperationCount(id)} active`;
    renderSectorPanel(id);
  }

  function renderSectorPanel(id) {
    const systems = getSystemsForRegion(id);
    const bases = getBasesForRegion(id);

    sectorPanelTitle.textContent = id;
    sectorCounts.textContent = `${systems.length} systems / ${bases.length} bases`;
    claimsPanelTitle.textContent = id;
    renderClaimsPanel(id);
    renderOperationsPanel(id);

    if (bases.length) {
      baseList.innerHTML = bases.map((base) => {
        const guild = escapeHtml(base.guild || "");
        const label = escapeHtml(base.label || "Unknown owner");
        const coord = escapeHtml(base.coord);
        return `<div class="base-row"><div><strong>${coord}</strong><span>${label}</span></div><div class="base-guild">${guild}</div></div>`;
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
      finalizeStatus.textContent = "Paste targets before finalizing.";
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
    finalizeStatus.textContent = `Finalized ${toClaim.length} target${toClaim.length === 1 ? "" : "s"} into live claims.`;
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
    return [...(intel.systems[region] || [])].sort();
  }

  function getBasesForRegion(region) {
    return Object.values(intel.bases)
      .filter((base) => base.region === region)
      .sort((a, b) => a.coord.localeCompare(b.coord));
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
      attackWindowSummary.textContent = "Step 1 required before Claim or Finalize";
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
    const tgUser = tg?.initDataUnsafe?.user;
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
