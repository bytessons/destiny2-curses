(function () {
  "use strict";

  const STORAGE_KEY = "destinyCurseHistory:v1";
  const PLAYERS_STORAGE_KEY = "destinyKnownPlayers:v1";
  const CURRENT_PLAYERS_STORAGE_KEY = "destinyCurrentPlayers:v1";

  // When true, incoming lobby state is being applied to the UI — suppress the
  // change events we'd otherwise emit back to the lobby (which would echo).
  let applyingRemoteState = false;

  // Set to true by lobby.js when this device is a guest in a shared lobby.
  // Guests don't drive setup or the draw; the host does.
  let lockedByLobby = false;

  // The name this device joined a lobby as (null outside lobby mode).
  let selfPlayerName = null;

  function emitLocalChange() {
    if (applyingRemoteState) return;
    document.dispatchEvent(new CustomEvent("curse:localchange", {
      detail: { players: players.slice(), tier: selectedTier },
    }));
  }

  /** @type {Array<{id:string,name:string,description:string,imageURL:string,tier:number,type:string}>} */
  let ALL_CURSES = [];

  /** @type {string[]} */
  let players = [];

  /** @type {string[]} */
  let knownPlayers = [];

  let selectedTier = 1;

  /** @type {Array<{player:string,curse:object}>} */
  let currentDrawAssignment = [];
  let currentDrawIndex = 0;

  // ---------- DOM ----------
  const setupPanel = document.getElementById("setup-panel");
  const playerListEl = document.getElementById("player-list");
  const playerEmptyHint = document.getElementById("player-empty-hint");

  const openPlayerSidebarBtn = document.getElementById("open-player-sidebar-btn");
  const closePlayerSidebarBtn = document.getElementById("close-player-sidebar-btn");
  const playerSidebar = document.getElementById("player-sidebar");
  const playerSidebarBackdrop = document.getElementById("player-sidebar-backdrop");

  const addKnownPlayerForm = document.getElementById("add-known-player-form");
  const knownPlayerInput = document.getElementById("known-player-input");
  const knownPlayerListEl = document.getElementById("known-player-list");
  const knownPlayerEmptyHint = document.getElementById("known-player-empty-hint");

  const tierSegmented = document.getElementById("tier-segmented");

  const drawBtn = document.getElementById("draw-btn");
  const statusMsg = document.getElementById("status-msg");

  const drawModal = document.getElementById("draw-modal");
  const drawModalBackdrop = document.getElementById("draw-modal-backdrop");
  const drawModalCloseBtn = document.getElementById("draw-modal-close-btn");
  const drawModalNextBtn = document.getElementById("draw-modal-next-btn");
  const drawProgress = document.getElementById("draw-progress");
  const cardSpread = document.getElementById("card-spread");

  const historyList = document.getElementById("history-list");
  const historyEmptyHint = document.getElementById("history-empty-hint");
  const clearHistoryBtn = document.getElementById("clear-history-btn");

  const confirmOverlay = document.getElementById("confirm-overlay");
  const confirmMessageEl = document.getElementById("confirm-message");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmClear = document.getElementById("confirm-clear");

  const fireteamSection = document.getElementById("fireteam-section");
  const encounterSection = document.getElementById("encounter-section");

  // ---------- Storage ----------
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.error("Kunde inte läsa historik från localStorage:", err);
      return {};
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (err) {
      console.error("Kunde inte spara historik till localStorage:", err);
      setStatus("Kunde inte spara till localStorage (är den avstängd i webbläsaren?).", true);
    }
  }

  function loadKnownPlayers() {
    try {
      const raw = localStorage.getItem(PLAYERS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error("Kunde inte läsa sparade spelare från localStorage:", err);
      return [];
    }
  }

  function saveKnownPlayers() {
    try {
      localStorage.setItem(PLAYERS_STORAGE_KEY, JSON.stringify(knownPlayers));
    } catch (err) {
      console.error("Kunde inte spara spelare till localStorage:", err);
      setStatus("Kunde inte spara till localStorage (är den avstängd i webbläsaren?).", true);
    }
  }

  function loadCurrentPlayers() {
    try {
      const raw = localStorage.getItem(CURRENT_PLAYERS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error("Kunde inte läsa nuvarande fireteam från localStorage:", err);
      return [];
    }
  }

  function saveCurrentPlayers() {
    try {
      localStorage.setItem(CURRENT_PLAYERS_STORAGE_KEY, JSON.stringify(players));
    } catch (err) {
      console.error("Kunde inte spara nuvarande fireteam till localStorage:", err);
      setStatus("Kunde inte spara till localStorage (är den avstängd i webbläsaren?).", true);
    }
  }

  // ---------- Status ----------
  function setStatus(message, isError) {
    statusMsg.textContent = message || "";
    statusMsg.classList.toggle("is-error", Boolean(isError));
  }

  // ---------- Player list ----------
  function renderPlayers() {
    playerListEl.innerHTML = "";
    players.forEach((name) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = name;
      const btn = document.createElement("button");
      btn.className = "chip-remove";
      btn.type = "button";
      btn.setAttribute("aria-label", "Ta bort " + name);
      btn.textContent = "×";
      btn.addEventListener("click", () => {
        players = players.filter((p) => p !== name);
        saveCurrentPlayers();
        renderPlayers();
        emitLocalChange();
      });
      li.appendChild(span);
      li.appendChild(btn);
      playerListEl.appendChild(li);
    });
    playerEmptyHint.hidden = players.length > 0;
  }

  // Called when leaving/losing a lobby — the fireteam list up to that point
  // was the lobby's roster (mirrored via applyRemoteState), not this device's
  // own local fireteam, so it shouldn't linger after the lobby is gone.
  function clearFireteam() {
    players = [];
    saveCurrentPlayers();
    renderPlayers();
  }

  function addPlayerToFireteam(name) {
    if (players.some((p) => p.toLowerCase() === name.toLowerCase())) {
      setStatus("\"" + name + "\" finns redan i fireteamet.", true);
      return;
    }
    players.push(name);
    saveCurrentPlayers();
    setStatus("");
    renderPlayers();
    emitLocalChange();
  }

  // ---------- Known players (persisted separately from curse history) ----------
  function renderKnownPlayers() {
    knownPlayerListEl.innerHTML = "";
    knownPlayers.forEach((name) => {
      const li = document.createElement("li");

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "known-player-name";
      addBtn.textContent = name;
      addBtn.addEventListener("click", () => addPlayerToFireteam(name));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "chip-remove";
      removeBtn.setAttribute("aria-label", "Glöm " + name);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        knownPlayers = knownPlayers.filter((p) => p !== name);
        saveKnownPlayers();
        renderKnownPlayers();
      });

      li.appendChild(addBtn);
      li.appendChild(removeBtn);
      knownPlayerListEl.appendChild(li);
    });
    knownPlayerEmptyHint.hidden = knownPlayers.length > 0;
  }

  addKnownPlayerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = knownPlayerInput.value.trim();
    if (!name) return;

    if (!knownPlayers.some((p) => p.toLowerCase() === name.toLowerCase())) {
      knownPlayers.push(name);
      saveKnownPlayers();
      renderKnownPlayers();
    }

    addPlayerToFireteam(name);
    knownPlayerInput.value = "";
    knownPlayerInput.focus();
  });

  // ---------- Player sidebar ----------
  function openPlayerSidebar() {
    playerSidebar.hidden = false;
    knownPlayerInput.focus();
  }
  function closePlayerSidebar() {
    playerSidebar.hidden = true;
  }

  openPlayerSidebarBtn.addEventListener("click", openPlayerSidebar);
  closePlayerSidebarBtn.addEventListener("click", closePlayerSidebar);
  playerSidebarBackdrop.addEventListener("click", closePlayerSidebar);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !playerSidebar.hidden) closePlayerSidebar();
  });

  // ---------- Segmented controls ----------
  function wireSegmented(container, onSelect) {
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      container.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      onSelect(btn.dataset.value);
    });
  }

  wireSegmented(tierSegmented, (value) => { selectedTier = Number(value); emitLocalChange(); });

  // Reflects a segmented control's active button without firing its onSelect —
  // used when applying lobby state pushed by the host.
  function setSegmentedValue(container, value) {
    container.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.value === String(value));
    });
  }

  // ---------- Draw logic ----------
  function getEligiblePool() {
    return ALL_CURSES.filter((curse) => curse.tier === selectedTier);
  }

  // Runs the whole draw: validates, builds an assignment, and returns either
  // { assignment } or { error } — without touching storage or the UI, so the
  // lobby host can call it and then broadcast the result.
  function computeAssignment() {
    if (players.length === 0) {
      return { error: "Lägg till minst en spelare innan ni drar." };
    }

    const history = loadHistory();
    const pool = getEligiblePool();

    const playersOutOfCurses = players.filter((name) => {
      const held = new Set(history[name] || []);
      return !pool.some((c) => !held.has(c.id));
    });

    if (playersOutOfCurses.length > 0) {
      return {
        error:
          playersOutOfCurses.join(", ") +
          " har redan fått alla tier " + toRoman(selectedTier) +
          " förbannelser som finns. Rensa historik för " +
          (playersOutOfCurses.length === 1 ? "den spelaren" : "de spelarna") +
          " eller lägg till fler curses i curses.json.",
      };
    }

    const assignment = assignDistinctCurses(players, pool, history);

    if (!assignment) {
      return {
        error:
          "Kunde inte hitta en fördelning där ingen förbannelse delas ut till två spelare i " +
          "samma dragning för tier " + toRoman(selectedTier) + ". " +
          "Rensa historik eller lägg till fler curses i curses.json.",
      };
    }

    return { assignment };
  }

  // Persists an assignment to local history and opens the reveal modal. Used
  // both by the local draw and when a lobby guest receives the host's result.
  function finalizeDraw(assignment) {
    const history = loadHistory();
    assignment.forEach(({ player, curse }) => {
      if (!history[player]) history[player] = [];
      if (!history[player].includes(curse.id)) history[player].push(curse.id);
    });
    saveHistory(history);
    renderHistory();
    openDrawModal(assignment);
  }

  // Rebuilds an assignment from the compact { player, curseId } form stored in
  // the lobby doc. Unknown ids (curses.json out of sync between devices) are
  // dropped rather than crashing the reveal.
  function showRemoteDraw(rawAssignments) {
    const assignment = (rawAssignments || [])
      .map((a) => {
        const curse = ALL_CURSES.find((c) => c.id === a.curseId);
        return curse ? { player: a.player, curse } : null;
      })
      .filter(Boolean);

    if (assignment.length === 0) {
      setStatus("Fick en dragning från lobbyn men känner inte igen förbannelserna (curses.json ur synk?).", true);
      return;
    }
    finalizeDraw(assignment);
  }

  function drawForFireteam() {
    setStatus("");

    if (lockedByLobby) {
      setStatus("Bara värden i lobbyn kan dra.", true);
      return;
    }

    const result = computeAssignment();
    if (result.error) {
      setStatus(result.error, true);
      return;
    }

    finalizeDraw(result.assignment);

    // Let the lobby (if any, and if we're the host) broadcast the result.
    document.dispatchEvent(new CustomEvent("curse:localdraw", {
      detail: {
        assignment: result.assignment.map(({ player, curse }) => ({ player, curseId: curse.id })),
      },
    }));
  }

  // A curse being off-limits for one player (because they already have it)
  // shouldn't remove it from the pool for everyone else — only the per-player
  // history matters. The only cross-player rule is that the same curse can't be
  // handed to two players in the same draw. That logic lives in computeAssignment
  // and assignDistinctCurses.

  // Finds one curse per player, no curse repeated within the draw, and no
  // player getting a curse they've already held — a bipartite matching,
  // solved with backtracking (small enough pools that this is instant).
  function assignDistinctCurses(playerNames, pool, history) {
    const options = playerNames.map((name) => {
      const held = new Set(history[name] || []);
      return shuffle(pool.filter((c) => !held.has(c.id)));
    });

    // Most-constrained-first ordering makes backtracking fail fast instead
    // of exploring lots of dead branches.
    const order = playerNames.map((_, i) => i).sort((a, b) => options[a].length - options[b].length);

    const usedCurseIds = new Set();
    const assignment = new Array(playerNames.length);

    function backtrack(step) {
      if (step === order.length) return true;
      const playerIndex = order[step];
      for (const curse of options[playerIndex]) {
        if (usedCurseIds.has(curse.id)) continue;
        usedCurseIds.add(curse.id);
        assignment[playerIndex] = { player: playerNames[playerIndex], curse };
        if (backtrack(step + 1)) return true;
        usedCurseIds.delete(curse.id);
      }
      return false;
    }

    return backtrack(0) ? assignment : null;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function toRoman(n) {
    return { 1: "I", 2: "II", 3: "III", 4: "IV" }[n] || String(n);
  }

  // ---------- Rendering ----------
  // Loading every curse image into the browser cache up front means the
  // spin can swap `src` every ~90ms without ever showing a blank/broken
  // frame while a multi-MB PNG is still downloading.
  function preloadCurseImages() {
    ALL_CURSES.forEach((curse) => {
      const img = new Image();
      img.src = curse.imageURL;
    });
  }

  // The draw card is mounted once per player and then mutated in place
  // for every spin tick — recreating the DOM node every ~90ms was the
  // source of both the flicker and the occasional blank final frame.
  let drawCardEls = null;

  function mountDrawCard(player) {
    cardSpread.innerHTML = "";

    const card = document.createElement("article");
    card.className = "curse-card";

    const img = document.createElement("img");

    const playerEl = document.createElement("p");
    playerEl.className = "player-name";
    playerEl.textContent = player;

    const nameEl = document.createElement("p");
    nameEl.className = "curse-name";

    const descEl = document.createElement("p");
    descEl.className = "curse-desc";

    const tierEl = document.createElement("span");
    tierEl.className = "tier-badge";

    card.appendChild(img);
    card.appendChild(playerEl);
    card.appendChild(nameEl);
    card.appendChild(descEl);
    card.appendChild(tierEl);
    cardSpread.appendChild(card);

    return { card, img, nameEl, descEl, tierEl };
  }

  function updateDrawCard(els, curse, isSpinning) {
    els.img.src = curse.imageURL;
    els.img.alt = curse.name;
    els.nameEl.textContent = curse.name;
    els.descEl.textContent = curse.description;
    els.tierEl.textContent = "Tier " + toRoman(curse.tier);
    els.card.classList.toggle("is-spinning", isSpinning);
    els.card.classList.toggle("is-landed", !isSpinning);
  }

  // ---------- Draw modal (reveals one curse at a time) ----------
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let drawSpinToken = 0;

  function openDrawModal(assignment) {
    drawSpinToken += 1; // cancel any in-flight spin from a previous draw
    currentDrawAssignment = assignment;
    currentDrawIndex = 0;
    drawModal.hidden = false;
    renderCurrentDrawStep();
  }

  function closeDrawModal() {
    drawSpinToken += 1; // cancel any in-flight spin
    drawModal.hidden = true;
    currentDrawAssignment = [];
    currentDrawIndex = 0;
  }

  function renderCurrentDrawStep() {
    const total = currentDrawAssignment.length;
    const entry = currentDrawAssignment[currentDrawIndex];

    drawProgress.textContent = (currentDrawIndex + 1) + " / " + total;
    drawModalNextBtn.disabled = true;
    drawModalNextBtn.textContent = "Drar...";

    drawCardEls = mountDrawCard(entry.player);

    spinToReveal(entry, () => {
      drawModalNextBtn.disabled = false;
      drawModalNextBtn.textContent = currentDrawIndex < total - 1 ? "Nästa" : "Klar";
    });
  }

  // Cycles through random curses like a slot machine, decelerating into
  // the real result, so a draw feels like a pick rather than a reveal.
  function spinToReveal(entry, onSettled) {
    const token = ++drawSpinToken;
    const els = drawCardEls;

    if (prefersReducedMotion || ALL_CURSES.length < 2) {
      updateDrawCard(els, entry.curse, false);
      onSettled();
      return;
    }

    const totalTicks = 12;
    let tick = 0;
    let delay = 90;

    function step() {
      if (token !== drawSpinToken) return; // modal closed or advanced early

      if (tick >= totalTicks) {
        updateDrawCard(els, entry.curse, false);
        onSettled();
        return;
      }

      const decoy = ALL_CURSES[Math.floor(Math.random() * ALL_CURSES.length)];
      updateDrawCard(els, decoy, true);

      tick += 1;
      delay *= 1.14; // ease out
      setTimeout(step, delay);
    }

    step();
  }

  drawModalNextBtn.addEventListener("click", () => {
    if (currentDrawIndex < currentDrawAssignment.length - 1) {
      currentDrawIndex += 1;
      renderCurrentDrawStep();
    } else {
      closeDrawModal();
    }
  });
  drawModalCloseBtn.addEventListener("click", closeDrawModal);
  drawModalBackdrop.addEventListener("click", closeDrawModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawModal.hidden) closeDrawModal();
  });

  function renderHistory() {
    const history = loadHistory();
    const names = Object.keys(history).filter((n) => history[n] && history[n].length > 0);

    // Own name first (lobby mode), the rest keep insertion order.
    if (selfPlayerName) {
      names.sort((a, b) => {
        if (a === selfPlayerName) return -1;
        if (b === selfPlayerName) return 1;
        return 0;
      });
    }

    historyList.innerHTML = "";
    historyEmptyHint.hidden = names.length > 0;

    names.forEach((name) => {
      const isSelf = name === selfPlayerName;
      const entry = document.createElement("div");
      entry.className = isSelf ? "history-entry is-self" : "history-entry";

      const title = document.createElement("p");
      title.className = "player-name";
      title.textContent = isSelf ? name + " (du)" : name;
      entry.appendChild(title);

      const tags = document.createElement("div");
      tags.className = "history-tags";
      history[name].forEach((id) => {
        const curse = ALL_CURSES.find((c) => c.id === id);
        const tag = document.createElement("span");
        tag.className = "history-tag";
        tag.textContent = curse ? curse.name : id;
        tag.tabIndex = 0;
        if (curse && curse.description) {
          tag.dataset.tooltip = curse.description;
        }
        tags.appendChild(tag);
      });
      entry.appendChild(tags);

      historyList.appendChild(entry);
    });
  }

  // ---------- Clear history ----------
  // A single confirm overlay is reused for both "clear everything" and the
  // lobby's "clear history for these names" action — whichever one opened it
  // sets the message and the action to run on confirm.
  let pendingConfirmAction = null;

  function openConfirm(message, action) {
    confirmMessageEl.textContent = message;
    pendingConfirmAction = action;
    confirmOverlay.hidden = false;
  }

  function clearHistoryForNames(names) {
    const history = loadHistory();
    let changed = false;
    names.forEach((name) => {
      if (history[name]) {
        delete history[name];
        changed = true;
      }
    });
    if (changed) saveHistory(history);
    renderHistory();
  }

  // Exposed to the lobby: lets the host (or a guest) wipe local history for
  // everyone currently in the lobby roster, without touching history for
  // players from other lobbies/sessions on this same browser.
  function requestClearHistoryFor(names) {
    const relevant = (names || []).filter((name) => loadHistory()[name]);
    if (relevant.length === 0) {
      setStatus("Ingen sparad historik att rensa för spelarna i lobbyn.");
      return;
    }
    openConfirm(
      "Rensa sparad historik för " + relevant.join(", ") + "? Detta kan inte ångras.",
      () => {
        clearHistoryForNames(relevant);
        setStatus("Historik rensad för " + relevant.join(", ") + ".");
      }
    );
  }

  clearHistoryBtn.addEventListener("click", () => {
    openConfirm("Rensa all sparad historik? Detta kan inte ångras.", () => {
      localStorage.removeItem(STORAGE_KEY);
      setStatus("Historiken är rensad.");
      renderHistory();
    });
  });
  confirmCancel.addEventListener("click", () => {
    confirmOverlay.hidden = true;
    pendingConfirmAction = null;
  });
  confirmClear.addEventListener("click", () => {
    confirmOverlay.hidden = true;
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    if (action) action();
  });

  drawBtn.addEventListener("click", drawForFireteam);

  // ---------- Lobby bridge ----------
  // lobby.js (an ES module, loaded separately) talks to the app only through
  // window.CurseApp and the "curse:localchange" / "curse:localdraw" events.
  // If firebase-config.js has no values, lobby.js does nothing and the app
  // stays a purely local, localStorage-backed tool.

  const drawBtnDefaultText = drawBtn.textContent;

  function applyRemoteState(state) {
    applyingRemoteState = true;
    try {
      if (Array.isArray(state.players)) {
        players = state.players.slice();
        saveCurrentPlayers();
        renderPlayers();
      }
      if (state.tier >= 1 && state.tier <= 4) {
        selectedTier = Number(state.tier);
        setSegmentedValue(tierSegmented, state.tier);
      }
    } finally {
      applyingRemoteState = false;
    }
  }

  // Lobby roles:
  //   null    — not in a lobby, everything editable (local mode)
  //   "host"  — owns tier/draw; the roster is self-service (guests add
  //             themselves), so the fireteam section is hidden entirely —
  //             the lobby panel's roster list is the source of truth
  //   "guest" — watches only; fireteam AND tier are hidden, leaving just the
  //             (disabled) draw button as a status line
  function setLobbyRole(role) {
    const isGuest = role === "guest";
    const isHost = role === "host";
    const inLobby = isGuest || isHost;
    lockedByLobby = isGuest;

    setupPanel.classList.toggle("is-lobby-guest", isGuest);
    setupPanel.classList.toggle("is-lobby-host", isHost);

    if (fireteamSection) fireteamSection.hidden = inLobby;
    if (encounterSection) encounterSection.hidden = isGuest;

    openPlayerSidebarBtn.disabled = isGuest || isHost;
    drawBtn.disabled = isGuest;
    drawBtn.textContent = isGuest ? "Väntar på värdens dragning…" : drawBtnDefaultText;
  }

  // The player name this device joined the lobby as — sorted to the top of the
  // history list so everyone sees their own curses first.
  function setSelfName(name) {
    selfPlayerName = name || null;
    renderHistory();
  }

  let resolveReady;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

  window.CurseApp = {
    ready: readyPromise,
    getState: () => ({ players: players.slice(), tier: selectedTier }),
    applyRemoteState,
    setLobbyRole,
    setSelfName,
    showRemoteDraw,
    clearFireteam,
    requestClearHistoryFor,
  };

  // ---------- Boot ----------
  async function init() {
    try {
      const res = await fetch("curses.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      ALL_CURSES = await res.json();
      preloadCurseImages();
    } catch (err) {
      console.error("Kunde inte ladda curses.json:", err);
      setStatus(
        "Kunde inte ladda curses.json. Om du testar lokalt genom att öppna filen direkt " +
        "i webbläsaren behöver du en liten lokal server (t.ex. \"npx serve\" eller VS Code " +
        "Live Server) — det fungerar automatiskt när sidan hostas på GitHub Pages.",
        true
      );
    }
    knownPlayers = loadKnownPlayers();
    players = loadCurrentPlayers();
    renderPlayers();
    renderKnownPlayers();
    renderHistory();
    resolveReady(ALL_CURSES);
  }

  init();
})();
