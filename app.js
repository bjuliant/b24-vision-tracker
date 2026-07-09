(function () {
  const SECTORS = Array.from({ length: 100 }, (_, index) => {
    return index === 0 ? "00" : `B24:${index}`;
  });
  const PLAYABLE_SECTORS = SECTORS.slice(1);
  const STATUSES = {
    unknown: "Unknown",
    scout: "Scout Vision",
    base: "Base",
    enemy: "Enemy Base",
    reserved: "Reserved"
  };

  const config = window.B24_CONFIG || {};
  const tg = window.Telegram?.WebApp;
  const grid = document.querySelector("#grid");
  const syncStatus = document.querySelector("#syncStatus");
  const selectedSector = document.querySelector("#selectedSector");
  const selectedStatus = document.querySelector("#selectedStatus");
  const selectedUser = document.querySelector("#selectedUser");
  const selectedTime = document.querySelector("#selectedTime");
  const template = document.querySelector("#cellTemplate");
  const toolButtons = Array.from(document.querySelectorAll(".tool-button"));

  const storageKey = `b24-map-${config.MAP_ID || "main"}`;
  const hasSupabase = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase);
  const user = getTelegramUser();
  let selected = "B24:1";
  let activeStatus = "unknown";
  let client = null;
  let realtimeChannel = null;
  let sectors = loadLocalState();

  init();

  function init() {
    tg?.ready();
    tg?.expand();

    renderGrid();
    bindToolbar();
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
        cell.addEventListener("click", () => updateSector(id, activeStatus));
      }

      fragment.appendChild(cell);
    });

    grid.appendChild(fragment);
    paintAll();
  }

  function bindToolbar() {
    toolButtons.forEach((button) => {
      button.addEventListener("click", () => {
        activeStatus = button.dataset.status;
        toolButtons.forEach((item) => item.classList.toggle("active", item === button));
        updateSector(selected, activeStatus);
      });
    });
  }

  async function connectSupabase() {
    setSync("Syncing");
    client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

    const { data, error } = await client
      .from("b24_sectors")
      .select("*")
      .eq("map_id", config.MAP_ID || "main");

    if (error) {
      console.error(error);
      setSync("Local");
      return;
    }

    data.forEach((row) => {
      sectors[row.sector_id] = {
        status: row.status,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at
      };
    });
    saveLocalState();
    paintAll();
    selectSector(selected);
    setSync("Live", true);

    realtimeChannel = client
      .channel(`b24-map-${config.MAP_ID || "main"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "b24_sectors", filter: `map_id=eq.${config.MAP_ID || "main"}` },
        (payload) => {
          const row = payload.new;
          sectors[row.sector_id] = {
            status: row.status,
            updatedBy: row.updated_by,
            updatedAt: row.updated_at
          };
          saveLocalState();
          paintSector(row.sector_id);
          if (row.sector_id === selected) selectSector(selected);
        }
      )
      .subscribe();
  }

  async function updateSector(id, status) {
    const stamp = new Date().toISOString();
    sectors[id] = {
      status,
      updatedBy: user,
      updatedAt: stamp
    };

    saveLocalState();
    paintSector(id);
    selectSector(id);
    tg?.HapticFeedback?.impactOccurred("light");

    if (!client) return;

    const { error } = await client.from("b24_sectors").upsert({
      map_id: config.MAP_ID || "main",
      sector_id: id,
      status,
      updated_by: user,
      updated_at: stamp
    });

    if (error) {
      console.error(error);
      setSync("Local");
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

    const status = sectors[id]?.status || "unknown";
    cell.className = `cell ${status}`;
    cell.classList.toggle("selected", id === selected);
  }

  function selectSector(id) {
    if (id === "00") return;
    selected = id;
    grid.querySelectorAll(".cell").forEach((cell) => {
      cell.classList.toggle("selected", cell.dataset.sector === id);
    });

    const sector = sectors[id] || { status: "unknown" };
    selectedSector.textContent = id;
    selectedStatus.textContent = STATUSES[sector.status || "unknown"];
    selectedUser.textContent = sector.updatedBy || "Nobody yet";
    selectedTime.textContent = sector.updatedAt ? formatTime(sector.updatedAt) : "Never";
  }

  function loadLocalState() {
    try {
      return { ...getBlankMap(), ...JSON.parse(localStorage.getItem(storageKey) || "{}") };
    } catch {
      return getBlankMap();
    }
  }

  function saveLocalState() {
    localStorage.setItem(storageKey, JSON.stringify(sectors));
  }

  function getBlankMap() {
    const blank = {};
    PLAYABLE_SECTORS.forEach((id) => {
      blank[id] = { status: "unknown" };
    });
    return blank;
  }

  function getTelegramUser() {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) return "Local user";
    return tgUser.username ? `@${tgUser.username}` : [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function setSync(label, live = false) {
    syncStatus.textContent = label;
    syncStatus.classList.toggle("live", live);
  }

  window.addEventListener("beforeunload", () => {
    if (realtimeChannel && client) client.removeChannel(realtimeChannel);
  });
})();
