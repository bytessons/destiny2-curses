// Delad lobby via Firestore.
//
// Fristående ES-modul. Pratar med resten av appen bara genom window.CurseApp
// och två DOM-events ("curse:localchange", "curse:localdraw"). Finns ingen ifylld
// firebase-config.js gör den här filen ingenting — appen kör vidare lokalt.
//
// Rollmodell (se CLAUDE.md): den som skapar lobbyn är VÄRD och styr typ, tier
// och dragningen. Alla — värd som gäster — går med under ett spelarnamn och blir
// då en spelare i fireteamet (`players` i lobbydokumentet). Gästernas setup-UI
// är låst; de speglar värdens val och ser dragningen live. Värden ser rostern
// fyllas på när folk går med.

import { firebaseConfig, recaptchaV3SiteKey } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.13.2";
const CLIENT_ID_KEY = "destinyLobbyClientId:v1";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // inga lättförväxlade tecken
const CODE_LENGTH = 6;
const SETUP_DEBOUNCE_MS = 400;
const CREATE_RETRIES = 5;

if (!firebaseConfig || !firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.info("[lobby] Ingen ifylld firebase-config.js — lobbyläge är avstängt, appen kör lokalt.");
} else {
  boot().catch((err) => {
    console.error("[lobby] Kunde inte starta lobbyläget:", err);
  });
}

async function boot() {
  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const {
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
    serverTimestamp, arrayUnion, arrayRemove,
  } = await import(`${SDK}/firebase-firestore.js`);

  const app = initializeApp(firebaseConfig);

  if (recaptchaV3SiteKey) {
    try {
      const { initializeAppCheck, ReCaptchaV3Provider } = await import(`${SDK}/firebase-app-check.js`);
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaV3SiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn("[lobby] App Check kunde inte initieras, fortsätter utan:", err);
    }
  }

  const db = getFirestore(app);
  const clientId = getClientId();

  // ---------- DOM ----------
  const el = {
    panel: document.getElementById("lobby-panel"),
    idle: document.getElementById("lobby-idle"),
    active: document.getElementById("lobby-active"),
    createBtn: document.getElementById("lobby-create-btn"),
    joinForm: document.getElementById("lobby-join-form"),
    nameInput: document.getElementById("lobby-name-input"),
    codeInput: document.getElementById("lobby-code-input"),
    codeValue: document.getElementById("lobby-code-value"),
    copyBtn: document.getElementById("lobby-copy-btn"),
    role: document.getElementById("lobby-role"),
    roster: document.getElementById("lobby-roster"),
    leaveBtn: document.getElementById("lobby-leave-btn"),
    status: document.getElementById("lobby-status"),
  };
  // Avslöja lobbypanelen först nu när vi vet att Firebase är konfigurerat.
  if (el.panel) el.panel.hidden = false;
  if (el.idle) el.idle.hidden = false;

  // ---------- State ----------
  let code = null;
  let isHost = false;
  let myName = null; // spelarnamnet vi gick med som
  let unsub = null;
  let roster = []; // senast kända players[] från lobbydokumentet
  let lastSeenDrawnAt = 0;
  let ignoreNextDrawnAt = 0; // dragningen vi själva just publicerade
  let setupTimer = null;

  function lobbyRef(c) {
    return doc(db, "lobbies", c);
  }

  function setStatus(msg, isError) {
    if (!el.status) return;
    el.status.textContent = msg || "";
    el.status.classList.toggle("is-error", Boolean(isError));
  }

  function renderPanel() {
    const inLobby = Boolean(code);
    if (el.idle) el.idle.hidden = inLobby;
    if (el.active) el.active.hidden = !inLobby;
    if (inLobby && el.codeValue) el.codeValue.textContent = code;
    if (el.role) {
      el.role.textContent = isHost
        ? "Du är värd — du styr typ, tier och dragningen."
        : "Du är gäst — värden styr setup. Du ser dragningen live.";
    }
    if (el.roster) {
      el.roster.textContent = roster.length
        ? "I lobbyn: " + roster.join(", ")
        : "Väntar på att spelare går med…";
    }
  }

  function readName() {
    return (el.nameInput ? el.nameInput.value : "").trim().slice(0, 24);
  }

  // ---------- Skapa / gå med / lämna ----------
  async function createLobby() {
    const name = readName();
    if (!name) {
      setStatus("Skriv ditt spelarnamn först.", true);
      return;
    }
    setStatus("Skapar lobby…");
    const state = window.CurseApp.getState();

    for (let attempt = 0; attempt < CREATE_RETRIES; attempt++) {
      const candidate = randomCode();
      const snap = await getDoc(lobbyRef(candidate));
      if (snap.exists()) continue;

      await setDoc(lobbyRef(candidate), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        hostId: clientId,
        type: state.type,
        tier: state.tier,
        players: [name],
        draw: null,
      });

      enterLobby(candidate, true, name);
      setStatus("Lobby skapad. Dela koden " + candidate + " med laget.");
      return;
    }
    setStatus("Kunde inte hitta en ledig lobbykod, försök igen.", true);
  }

  async function joinLobby(rawCode) {
    const name = readName();
    if (!name) {
      setStatus("Skriv ditt spelarnamn först.", true);
      return;
    }
    const candidate = String(rawCode || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(candidate)) {
      setStatus("En lobbykod är 6 tecken (A–Z, 0–9).", true);
      return;
    }
    setStatus("Ansluter…");
    const snap = await getDoc(lobbyRef(candidate));
    if (!snap.exists()) {
      setStatus("Ingen lobby med koden " + candidate + ".", true);
      return;
    }

    const host = snap.data().hostId === clientId;
    enterLobby(candidate, host, name);
    applyDoc(snap.data());

    // Lägg till dig själv i rostern (om du inte redan står där).
    try {
      await updateDoc(lobbyRef(candidate), {
        players: arrayUnion(name),
        updatedAt: serverTimestamp(),
      });
      setStatus("Ansluten till " + candidate + " som " + name + ".");
    } catch (err) {
      console.error("[lobby] Kunde inte lägga till spelaren:", err);
      setStatus("Anslöt men kunde inte lägga till namnet i rostern.", true);
    }
  }

  function enterLobby(newCode, host, name) {
    code = newCode;
    isHost = host;
    myName = name;
    lastSeenDrawnAt = 0; // så att en redan gjord dragning visas när man kommer in
    ignoreNextDrawnAt = 0;
    subscribe();
    window.CurseApp.setLobbyRole(host ? "host" : "guest");
    window.CurseApp.setSelfName(name);
    renderPanel();
  }

  function teardownLocal(message) {
    if (unsub) { unsub(); unsub = null; }
    if (setupTimer) { clearTimeout(setupTimer); setupTimer = null; }
    code = null;
    isHost = false;
    myName = null;
    roster = [];
    window.CurseApp.setLobbyRole(null);
    window.CurseApp.setSelfName(null);
    renderPanel();
    if (message) setStatus(message, true);
  }

  async function leaveLobby() {
    const wasHost = isHost;
    const name = myName;
    const ref = code ? lobbyRef(code) : null;
    teardownLocal();
    setStatus("Du lämnade lobbyn.");

    if (!ref) return;
    try {
      if (wasHost) {
        // Värden stänger lobbyn när hen går.
        await deleteDoc(ref);
      } else if (name) {
        await updateDoc(ref, { players: arrayRemove(name), updatedAt: serverTimestamp() });
      }
    } catch (err) {
      console.warn("[lobby] Städning vid utgång misslyckades (ofarligt):", err);
    }
  }

  // ---------- Firestore -> app ----------
  function subscribe() {
    if (unsub) unsub();
    unsub = onSnapshot(lobbyRef(code), (snap) => {
      if (!snap.exists()) {
        teardownLocal("Lobbyn stängdes.");
        return;
      }
      applyDoc(snap.data());
    }, (err) => {
      console.error("[lobby] onSnapshot-fel:", err);
      setStatus("Tappade kontakten med lobbyn.", true);
    });
  }

  function applyDoc(data) {
    roster = Array.isArray(data.players) ? data.players.slice() : [];

    // Alla speglar rostern (för att se vilka som är med). Gäster speglar även
    // typ/tier. Värden äger typ/tier och rör dem inte här.
    if (isHost) {
      window.CurseApp.applyRemoteState({ players: roster });
    } else {
      window.CurseApp.applyRemoteState({ players: roster, type: data.type, tier: data.tier });
    }
    renderPanel();

    const draw = data.draw;
    if (draw && typeof draw.drawnAt === "number" && draw.drawnAt > lastSeenDrawnAt) {
      lastSeenDrawnAt = draw.drawnAt;
      if (draw.drawnAt !== ignoreNextDrawnAt) {
        window.CurseApp.showRemoteDraw(draw.assignments || []);
      }
    }
  }

  // ---------- App -> Firestore (bara värden) ----------
  // Värden synkar bara typ och tier. Rostern (`players`) sköts av spelarna
  // själva via arrayUnion/arrayRemove när de går med/lämnar.
  document.addEventListener("curse:localchange", (e) => {
    if (!code || !isHost) return;
    if (setupTimer) clearTimeout(setupTimer);
    const state = e.detail;
    setupTimer = setTimeout(() => {
      setupTimer = null;
      updateDoc(lobbyRef(code), {
        type: state.type,
        tier: state.tier,
        updatedAt: serverTimestamp(),
      }).catch((err) => {
        console.error("[lobby] Kunde inte skriva setup:", err);
        setStatus("Kunde inte synka setup till lobbyn.", true);
      });
    }, SETUP_DEBOUNCE_MS);
  });

  document.addEventListener("curse:localdraw", (e) => {
    if (!code || !isHost) return;
    const drawnAt = Date.now();
    ignoreNextDrawnAt = drawnAt;
    updateDoc(lobbyRef(code), {
      draw: { drawnAt, assignments: e.detail.assignment },
      updatedAt: serverTimestamp(),
    }).catch((err) => {
      console.error("[lobby] Kunde inte skriva dragning:", err);
      setStatus("Kunde inte dela dragningen med lobbyn.", true);
    });
  });

  // ---------- UI-koppling ----------
  if (el.createBtn) {
    el.createBtn.addEventListener("click", () => {
      el.createBtn.disabled = true;
      createLobby().finally(() => { el.createBtn.disabled = false; });
    });
  }
  if (el.joinForm) {
    el.joinForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      joinLobby(el.codeInput.value);
    });
  }
  if (el.codeInput) {
    el.codeInput.addEventListener("input", () => {
      el.codeInput.value = el.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
    });
  }
  if (el.copyBtn) {
    el.copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        setStatus("Kopierade " + code + " till urklipp.");
      } catch {
        setStatus("Kunde inte kopiera automatiskt — koden är " + code + ".");
      }
    });
  }
  if (el.leaveBtn) {
    el.leaveBtn.addEventListener("click", leaveLobby);
  }

  await window.CurseApp.ready;
  renderPanel();
}

// ---------- Hjälpare ----------
function getClientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = "c-" + cryptoRandom(20);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return "c-" + cryptoRandom(20);
  }
}

function randomCode() {
  let out = "";
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function cryptoRandom(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}
