(function () {
  const SECTORS = Array.from({ length: 100 }, (_, index) => {
    return index === 0 ? "00" : `B24:${index}`;
  });
  const PLAYABLE_SECTORS = SECTORS.slice(1);
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
  const sectorPanelTitle = document.querySelector("#sectorPanelTitle");
  const sectorCounts = document.querySelector("#sectorCounts");
  const baseList = document.querySelector("#baseList");
  const systemList = document.querySelector("#systemList");
  const template = document.querySelector("#cellTemplate");
  const toolButtons = Array.from(document.querySelectorAll(".tool-button"));
  const importText = document.querySelector("#importText");
  const importButton = document.querySelector("#importButton");
  const bookmarkletButton = document.querySelector("#bookmarkletButton");
  const importResult = document.querySelector("#importResult");

  const mapId = config.MAP_ID || "main";
  const storageKey = `b24-intel-${mapId}`;
  const hasSupabase = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase);
  const user = getTelegramUser();
  let selected = "B24:1";
  let client = null;
  let realtimeChannel = null;
  let intel = loadLocalState();

  init();

  function init() {
    tg?.ready();
    tg?.expand();

    renderGrid();
    bindControls();
    selectSector(selected);

    if (hasSupabase) {
      connectSupabase();
    } else {
      setSync("Local");
    }
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
  }

  async function connectSupabase() {
    setSync("Syncing");
    client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

    try {
      await Promise.all([
        loadRemoteSectors(),
        loadRemoteSystems(),
        loadRemoteBases(),
        loadRemoteAstros()
      ]);
      paintAll();
      selectSector(selected);
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
      importResult.textContent = `Imported ${parsed.systems.length} systems, ${parsed.bases.length} bases, ${parsed.astros.length} astros`;
      importText.value = "";

      if (client) await syncImportedIntel(parsed);
    } catch (error) {
      console.error(error);
      importResult.textContent = "Could not parse that paste";
    }
  }

  async function copyBookmarklet() {
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      importResult.textContent = "Supabase config needed first";
      return;
    }

    const code = `javascript:(async()=>{const MAP_ID=${JSON.stringify(mapId)},SUPA=${JSON.stringify(config.SUPABASE_URL)},KEY=${JSON.stringify(config.SUPABASE_ANON_KEY)};const now=new Date().toISOString();const hdr={'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'};const post=async(t,r,c)=>{if(!r.length)return 0;const u=SUPA+'/rest/v1/'+t+'?on_conflict='+encodeURIComponent(c);const x=await fetch(u,{method:'POST',headers:hdr,body:JSON.stringify(r)});if(!x.ok)throw new Error(t+': '+await x.text());return r.length};const reg=v=>{const m=String(v||'').match(/^B24:(\\d{1,2})/);return m?'B24:'+Number(m[1]):''};const sys=v=>String(v||'').split(':').slice(0,3).join(':');const clean=(v,c)=>String(v||'').replace(/^44-;-\\s*/,'').replace(c,'').replace(/\\s+/g,' ').trim();const html=document.documentElement.innerHTML;const systems=[...new Set(html.match(/B24:\\d{2}:\\d{2}(?!:)/g)||[])].map(c=>({map_id:MAP_ID,coord:c,region_id:reg(c),system_id:c.split(':')[2],updated_at:now}));const bases=[];if(typeof mapToolBox_data!=='undefined'){for(const v of Object.values(mapToolBox_data||{})){const s=String(v||'');const c=(s.match(/B24:\\d{2}:\\d{2}:\\d{2}/)||[])[0];if(!c)continue;const g=(s.match(/\\[[A-Za-z0-9 _-]{1,12}\\]/)||[])[0]||'';const txt=s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();bases.push({map_id:MAP_ID,coord:c,region_id:reg(c),system_id:sys(c),guild:g,label:clean(txt,c),updated_at:now})}}const seen={};const uniqueBases=bases.filter(b=>!seen[b.coord]&&(seen[b.coord]=1));const body=document.body.innerText||'';const astros=[];for(const line of body.split(/\\r?\\n/)){const m=line.trim().match(/^(B24:\\d{2}:\\d{2}:\\d{2})\\s+([A-Za-z]+)\\s+([A-Za-z]+)\\s+((?:\\d+\\s+){5}\\d+)(?:\\s+(Yes))?/);if(!m)continue;astros.push({map_id:MAP_ID,coord:m[1],region_id:reg(m[1]),system_id:sys(m[1]),astro_no:m[1].split(':')[3],terrain:m[2],astro_type:m[3],attributes:m[4].trim().split(/\\s+/).map(Number),has_base:m[5]==='Yes',updated_at:now})}try{const a=await post('b24_systems',systems,'map_id,coord');const b=await post('b24_bases',uniqueBases,'map_id,coord');const c=await post('b24_astros',astros,'map_id,coord');alert('VisionBot import complete: '+a+' systems, '+b+' bases, '+c+' astros')}catch(e){console.error(e);alert('VisionBot import failed: '+e.message)}})()`;

    try {
      await navigator.clipboard.writeText(code);
      importResult.textContent = "Bookmarklet copied";
    } catch {
      importText.value = code;
      importResult.textContent = "Bookmarklet placed in box";
    }
  }

  function parseIntel(text) {
    const result = { systems: [], bases: [], astros: [] };

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

      return result;
    } catch {
      return parseTextIntel(text);
    }
  }

  function parseTextIntel(text) {
    const result = { systems: [], bases: [], astros: [] };
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    lines.forEach((line) => {
      const match = line.match(/^(B24:\d{2}:\d{2}:\d{2})\s+([A-Za-z]+)\s+([A-Za-z]+)\s+((?:\d+\s+){5}\d+)(?:\s+(Yes))?/);
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

    return result;
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

    setFlag(cell, "F", sector.friendly, "on-f");
    setFlag(cell, "E", sector.enemy, "on-e");
    setFlag(cell, "S", sector.scout, "on-s");
    setFlag(cell, "R", sector.reserved, "on-r");

    const systems = getSystemCount(id);
    const bases = getBaseCount(id);
    const count = cell.querySelector(".intel-count");
    count.textContent = systems || bases ? `${systems}s ${bases}b` : "";
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
    selectedStatus.textContent = flags.length ? flags.join(" ") : "None";
    selectedSystems.textContent = `${getSystemCount(id)} known`;
    selectedBases.textContent = `${getBaseCount(id)} known`;
    renderSectorPanel(id);
  }

  function renderSectorPanel(id) {
    const systems = getSystemsForRegion(id);
    const bases = getBasesForRegion(id);

    sectorPanelTitle.textContent = id;
    sectorCounts.textContent = `${systems.length} systems · ${bases.length} bases`;

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

  function getSystemsForRegion(region) {
    return [...(intel.systems[region] || [])].sort();
  }

  function getBasesForRegion(region) {
    return Object.values(intel.bases)
      .filter((base) => base.region === region)
      .sort((a, b) => a.coord.localeCompare(b.coord));
  }

  function loadLocalState() {
    const blank = { sectors: {}, systems: {}, bases: {}, astros: {} };
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
    const match = String(value || "").match(/^B24:(\d{2}):(\d{2})$/);
    return match ? `B24:${match[1]}:${match[2]}` : "";
  }

  function normalizeAstro(value) {
    const match = String(value || "").match(/^B24:(\d{2}):(\d{2}):(\d{2})$/);
    return match ? `B24:${match[1]}:${match[2]}:${match[3]}` : "";
  }

  function systemToRegion(system) {
    return normalizeRegionId(system.split(":").slice(0, 2).join(":"));
  }

  function astroToRegion(astro) {
    return normalizeRegionId(astro.split(":").slice(0, 2).join(":"));
  }

  function astroToSystem(astro) {
    return astro.split(":").slice(0, 3).join(":");
  }

  function cleanOwnerLabel(value, coord) {
    return String(value || "")
      .replace(/^44-;-\s*/, "")
      .replace(coord, "")
      .replace(/\s+/g, " ")
      .trim();
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
    const match = String(value || "").match(/^B24:(\d{1,2})$/);
    if (!match) return String(value || "");
    return `B24:${Number(match[1])}`;
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

  function setSync(label, live = false) {
    syncStatus.textContent = label;
    syncStatus.classList.toggle("live", live);
  }

  window.addEventListener("beforeunload", () => {
    if (realtimeChannel && client) client.removeChannel(realtimeChannel);
  });
})();
