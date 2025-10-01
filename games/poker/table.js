/* =====================================================================
   Poker Table UI (F2P + Onchain-safe)
   - Seats arranged around an oval table
   - Board stays invisible until cards are dealt
   - Sit / Leave / Ready wired to realtime
   - Wallet chip + Disconnect
   - DevBot button only on F2P and sends toggle to server
   ===================================================================== */

(() => {
  "use strict";

  /* ------------------------------ DOM refs ------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const root = document.documentElement;
  const mode = root.getAttribute("data-table-mode") === "onchain" ? "onchain" : "f2p";
  const canvas = $(".table-canvas");
  const seatsEls = $$(".seat"); // 8 static divs in table.html
  const centerBanner = $("#poker-center");

  // Wallet chip (top-right)
  const wiAddr = $("#wi-address");
  const wiDisconnect = $("#wi-disconnect");
  const wiDevbot = $("#wi-devbot");

  // Runtime state
  let socket = null;
  let tableId = null;
  let myAddrLower = null;
  let lastTablePublic = null;    // from server table:update
  let lastPokerState = null;     // from server poker:state
  let mySeatIndex = -1;

  // Live card nodes: { seatIndex: [img,img], board: [img,img,img,img,img], burns: [img,img,img] }
  const seatCards = {};
  const boardCards = [];
  const burnCards = [];

  // Assets
  const CARD_BACK = "/assets/images/chog_cards/dak-and-chog-cardback.png";

  /* ----------------------------- URL helpers ---------------------------- */
  function getQP(name) {
    try {
      return new URL(location.href).searchParams.get(name);
    } catch {
      return null;
    }
  }
  function shortAddr(a) {
    if (!a) return "—";
    return a.length > 10 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
  }

  /* ------------------------- Wallet / identity -------------------------- */
  // We accept the address from any of:
  // 1) tavern.js event
  // 2) sessionStorage/localStorage hints
  // 3) window.ethereum (best-effort)
  function setWallet(addr) {
    myAddrLower = (addr || "").toLowerCase() || null;
    wiAddr.textContent = myAddrLower ? shortAddr(myAddrLower) : "—";
    wiDisconnect.style.display = myAddrLower ? "" : "none";
  }

  window.addEventListener("tavern:wallet", (ev) => {
    try {
      const addr = (ev && ev.detail && ev.detail.address) || null;
      if (addr) setWallet(addr);
    } catch {}
  });

  // Fallbacks (safe)
  (function primeWalletFromStorage() {
    try {
      const guesses = [
        sessionStorage.getItem("walletAddress"),
        localStorage.getItem("walletAddress"),
        localStorage.getItem("aa:owner"),
        localStorage.getItem("wallet:addr"),
      ].filter(Boolean);
      if (guesses.length) setWallet(guesses[0]);
    } catch {}
  })();

  // Worst-case: poke ethereum
  (async function maybeQueryEthereum() {
    try {
      if (!myAddrLower && window.ethereum) {
        const accts = await window.ethereum.request({ method: "eth_accounts" });
        if (accts && accts[0]) setWallet(accts[0]);
      }
    } catch {}
  })();

  wiDisconnect?.addEventListener("click", () => {
    try { sessionStorage.removeItem("walletSigned"); } catch {}
    try { window.dispatchEvent(new CustomEvent("wallet:disconnect")); } catch {}
    location.replace("/landing.html");
  });

  // DevBot button visibility strictly by mode + runtime category
  if (mode === "onchain") {
    if (wiDevbot) wiDevbot.style.display = "none";
  }

  /* ------------------------ Seat UI (controls) -------------------------- */
  function ensureSeatUI(seatEl, index) {
    if (seatEl.__wired) return;
    seatEl.__wired = true;

    seatEl.style.position = "absolute"; // ensure absolute regardless of CSS cascade
    seatEl.style.transform = "translate(-50%, -50%)";

    seatEl.innerHTML = `
      <div class="seat-frame">
        <div class="seat-name" data-role="name">Empty</div>
        <div class="seat-stack" data-role="stack"></div>
        <div class="seat-actions">
          <button data-act="sit" class="seat-btn">Sit</button>
          <button data-act="leave" class="seat-btn" style="display:none">Leave</button>
          <button data-act="ready" class="seat-btn" style="display:none">Ready</button>
        </div>
      </div>
    `;

    seatEl.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const act = t.getAttribute("data-act");
      if (!act) return;

      if (!socket || !lastTablePublic) return;

      switch (act) {
        case "sit":
          socket.emit("seat", { index });
          break;
        case "leave":
          socket.emit("seat", { index: -1 });
          break;
        case "ready": {
          // If I'm not seated here, ignore.
          if (mySeatIndex !== index) return;
          // Toggle based on current ready flag in tablePublic
          const s = (lastTablePublic.seats || [])[index];
          const next = !(s && s.ready);
          socket.emit("ready", { ready: next });
          break;
        }
      }
    });
  }

  seatsEls.forEach(ensureSeatUI);

  /* ------------------------- Layout / positions -------------------------- */
  function recomputeSeatPositions() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    // Ellipse tuned so seats hug the edge nicely.
    const rx = rect.width * 0.44;  // horizontal radius
    const ry = rect.height * 0.35; // vertical radius

    for (let i = 0; i < seatsEls.length; i++) {
      const el = seatsEls[i];
      // 8 seats evenly spaced, top one is index 0
      const theta = ((-90 + i * (360 / 8)) * Math.PI) / 180;
      const x = cx + rx * Math.cos(theta);
      const y = cy + ry * Math.sin(theta);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.zIndex = String(100 + Math.round(y)); // mild depth ordering
    }

    reanchorLiveCards();
  }

  window.addEventListener("resize", recomputeSeatPositions);

  /* ----------------------- Live cards (DOM helpers) ---------------------- */
  function cardImg(src) {
    const img = new Image();
    img.src = src;
    img.alt = "card";
    img.className = "card-img";
    img.style.position = "absolute";
    img.style.width = "72px";
    img.style.height = "auto";
    img.style.pointerEvents = "none";
    img.style.transform = "translate(-50%, -50%)";
    img.style.willChange = "transform, opacity";
    img.style.transition = "transform 240ms ease, opacity 200ms ease";
    return img;
  }

  function seatAnchor(index) {
    return seatsEls[index];
  }

  function boardAnchor() {
    // Single invisible container to hold community cards when present
    let b = $(".board-cards", canvas);
    if (!b) {
      b = document.createElement("div");
      b.className = "board-cards";
      b.style.position = "absolute";
      b.style.left = "50%";
      b.style.top = "50%";
      b.style.transform = "translate(-50%, -50%)";
      b.style.pointerEvents = "none";
      canvas.appendChild(b);
    }
    return b;
  }

  function burnAnchor() {
    let b = $(".burn-cards", canvas);
    if (!b) {
      b = document.createElement("div");
      b.className = "burn-cards";
      b.style.position = "absolute";
      b.style.left = "50%";
      b.style.top = "50%";
      b.style.transform = "translate(-50%, -50%)";
      b.style.pointerEvents = "none";
      canvas.appendChild(b);
    }
    return b;
  }

  function reanchorLiveCards() {
    // Seat holes: keep them near their seats
    for (const k of Object.keys(seatCards)) {
      const idx = Number(k);
      const anchor = seatAnchor(idx);
      if (!anchor) continue;
      const rect = anchor.getBoundingClientRect();
      const baseX = rect.left + rect.width / 2 - canvas.getBoundingClientRect().left;
      const baseY = rect.top + rect.height / 2 - canvas.getBoundingClientRect().top;

      const arr = seatCards[k] || [];
      // Show two cards fanned a bit
      arr.forEach((img, j) => {
        const dx = (j === 0 ? -18 : 18);
        img.style.left = `${baseX + dx}px`;
        img.style.top = `${baseY - 20}px`;
      });
    }

    // Board cards: center them; nothing shown if none exist (no slots)
    if (boardCards.length) {
      const container = boardAnchor();
      const cRect = canvas.getBoundingClientRect();
      const cx = cRect.width / 2;
      const cy = cRect.height / 2;
      const baseX = cx - 150; // left-most start
      const gap = 75;
      boardCards.forEach((img, i) => {
        img.style.left = `${baseX + i * gap}px`;
        img.style.top = `${cy - 20}px`;
        container.appendChild(img);
      });
    }
    if (burnCards.length) {
      const container = burnAnchor();
      const cRect = canvas.getBoundingClientRect();
      const cx = cRect.width / 2;
      const cy = cRect.height / 2;
      // Show a small facedown pile near dealer button spot
      burnCards.forEach((img, i) => {
        img.style.left = `${cx - 260 + i * 4}px`;
        img.style.top = `${cy - 80 - i * 2}px`;
        container.appendChild(img);
      });
    }
  }

  function clearBoard() {
    boardCards.splice(0, boardCards.length);
    const b = $(".board-cards", canvas);
    if (b) b.innerHTML = "";
    reanchorLiveCards();
  }
  function clearBurns() {
    burnCards.splice(0, burnCards.length);
    const b = $(".burn-cards", canvas);
    if (b) b.innerHTML = "";
    reanchorLiveCards();
  }
  function clearSeatHoles(idx) {
    const arr = seatCards[idx];
    if (!arr) return;
    arr.forEach((img) => img.remove());
    delete seatCards[idx];
  }
  function clearAllHoles() {
    Object.keys(seatCards).forEach(clearSeatHoles);
  }

  /* --------------------------- Animations (lite) -------------------------- */
  function animateDealToSeat(idx, faceUpUrlOrNull) {
    const anchor = seatAnchor(idx);
    if (!anchor) return;

    const img = cardImg(faceUpUrlOrNull || CARD_BACK);
    canvas.appendChild(img);

    // initial (center) → target
    const cRect = canvas.getBoundingClientRect();
    img.style.left = `${cRect.width / 2}px`;
    img.style.top = `${cRect.height / 2}px`;
    img.style.opacity = "0";

    // stash
    if (!seatCards[idx]) seatCards[idx] = [];
    seatCards[idx].push(img);

    requestAnimationFrame(() => {
      img.style.opacity = "1";
      reanchorLiveCards();
    });
  }

  function animateBurn() {
    const img = cardImg(CARD_BACK);
    img.style.opacity = "0";
    canvas.appendChild(img);
    burnCards.push(img);
    requestAnimationFrame(() => {
      img.style.opacity = "1";
      reanchorLiveCards();
    });
  }

  function animateBoardAdd(faceUpUrl) {
    const img = cardImg(faceUpUrl);
    img.style.opacity = "0";
    canvas.appendChild(img);
    boardCards.push(img);
    requestAnimationFrame(() => {
      img.style.opacity = "1";
      reanchorLiveCards();
    });
  }

  /* --------------------------- Rendering/UI --------------------------- */
  function refreshControlsFromTablePublic() {
    if (!lastTablePublic) return;

    // Show/Hide DevBot button (F2P tables only)
    const isF2P = !!lastTablePublic.simulated;
    if (wiDevbot) wiDevbot.style.display = isF2P && mode !== "onchain" ? "" : "none";

    mySeatIndex = -1;

    for (let i = 0; i < seatsEls.length; i++) {
      const el = seatsEls[i];
      const nameEl = $("[data-role='name']", el);
      const stackEl = $("[data-role='stack']", el);
      const sitBtn = $("[data-act='sit']", el);
      const leaveBtn = $("[data-act='leave']", el);
      const readyBtn = $("[data-act='ready']", el);

      const s = (lastTablePublic.seats || [])[i];

      if (!s) {
        nameEl.textContent = "Empty";
        stackEl.textContent = "";
        sitBtn.style.display = "";
        leaveBtn.style.display = "none";
        readyBtn.style.display = "none";
        // Clear any left-over cards for an empty chair
        clearSeatHoles(i);
      } else {
        const addr = s.addr || "";
        nameEl.textContent = shortAddr(addr);
        stackEl.textContent = s.chips ? `Chips: ${s.chips}` : "";
        sitBtn.style.display = "none";

        const isMine = myAddrLower && addr.toLowerCase() === myAddrLower;
        if (isMine) {
          mySeatIndex = i;
          leaveBtn.style.display = "";
          readyBtn.style.display = "";
          readyBtn.textContent = s.ready ? "Unready" : "Ready";
        } else {
          leaveBtn.style.display = "none";
          readyBtn.style.display = "none";
        }
      }
    }
  }

  function handlePokerState(m) {
    lastPokerState = m || null;

    // Ensure seats matched to latest table view
    refreshControlsFromTablePublic();

    // Drive center banner text (whose turn / stage)
    if (m && m.stage) {
      centerBanner.style.display = "";
      const stage = m.stage.toUpperCase();
      let extra = "";
      if (typeof m.pot === "number") extra = ` — Pot: ${m.pot}`;
      centerBanner.textContent = `Stage: ${stage}${extra}`;
    } else {
      centerBanner.style.display = "none";
      centerBanner.textContent = "";
    }

    // Animate dealing across stage transitions (best effort, idempotent enough)
    // We only add new visuals; server messages at showdown or next hand will clear.
    if (!m) return;

    if (m.stage === "preflop") {
      // Fresh hand: clear everything
      clearAllHoles();
      clearBoard();
      clearBurns();

      // Deal 2 to each occupied chair; my seat gets face-up if we get a private event later.
      const occupied = (lastTablePublic?.seats || [])
        .map((s, i) => ({ s, i }))
        .filter((x) => !!x.s);

      // Two rounds around the table
      for (let r = 0; r < 2; r++) {
        occupied.forEach(({ i }) => animateDealToSeat(i, null));
      }
    }

    // Community cards (we only show exactly what exists)
    if (Array.isArray(m.community)) {
      // If server increased board size, append; if shrank (new hand), caller clears
      const have = boardCards.length;
      const want = m.community.length;
      for (let i = have; i < want; i++) {
        const url = cardUrlFromName(m.community[i]);
        animateBoardAdd(url);
      }
    }
  }

  function handleShowdownOrHandEnd(m) {
    // Clear holes for folded players handled server-side (we’re defensive)
    clearAllHoles();
    // Keep board visible momentarily until next preflop comes (server will drive)
  }

  function cardUrlFromName(name) {
    // Server should send names like "chog-queen-of-hearts.png" OR rank/suit we convert
    if (!name) return CARD_BACK;
    if (name.endsWith(".png")) return `/assets/images/chog_cards/${name}`;
    // Fallback: convert like "QH" → "chog-queen-of-hearts.png"
    const mapRank = { A: "ace", K: "king", Q: "queen", J: "jack", T: "ten", "9": "nine", "8": "eight", "7": "seven", "6": "six", "5": "five", "4": "four", "3": "three", "2": "two" };
    const mapSuit = { h: "hearts", d: "diamonds", c: "clubs", s: "spades" };
    const r = String(name).charAt(0).toUpperCase();
    const s = String(name).charAt(1).toLowerCase();
    const rr = mapRank[r] || "ace";
    const ss = mapSuit[s] || "spades";
    return `/assets/images/chog_cards/chog-${rr}-of-${ss}.png`;
  }

  // Private holecards event (best guess names – we listen to a few)
  function onPrivateHole(ev) {
    try {
      const payload = ev && ev.detail ? ev.detail : ev;
      const arr = (payload && payload.cards) || (payload && payload.hole) || [];
      if (mySeatIndex < 0 || !arr.length) return;

      // Replace my two facedown with faceup versions
      clearSeatHoles(mySeatIndex);
      const urls = arr.map(cardUrlFromName);
      urls.forEach((u) => animateDealToSeat(mySeatIndex, u));
    } catch {}
  }

  // In case server emits through socket with names:
  // 'poker:hole', 'poker:private', 'poker:cards'
  function wirePrivateSocketNames() {
    ["poker:hole", "poker:private", "poker:cards"].forEach((ev) => {
      socket.on(ev, (m) => onPrivateHole(m));
    });
  }

  /* ------------------------------- Socket.IO ------------------------------ */
  function connectSocket() {
    if (socket) {
      try { socket.disconnect(); } catch {}
      socket = null;
    }

    // Prefer Cloudflare-friendly client path (Nginx maps /poker.io/ → backend /socket.io/)
    const ioOpts = { path: "/poker.io/" };

    // eslint-disable-next-line no-undef
    socket = io(location.origin, ioOpts);

    socket.on("connect", () => {
      // Identify with address so server can route private hole cards
      socket.emit("identify", { addr: myAddrLower || "" });

      // Determine table from ?table=... or fallback
      tableId = getQP("table") || (mode === "f2p" ? "poker-sim-1" : "poker-nl-1");
      socket.emit("join_table", { table: tableId });
    });

    socket.on("disconnect", () => {
      centerBanner.style.display = "";
      centerBanner.textContent = "Disconnected — reconnecting…";
    });

    socket.on("rt:state", (m) => {
      // paused, rake, etc — not used in UI here
    });

    socket.on("system", (msg) => {
      // Could toast/log if desired
      console.log("[system]", msg);
    });

    socket.on("table:update", (pub) => {
      lastTablePublic = pub || null;
      refreshControlsFromTablePublic();
      // Only show DevBot button when OFFCHAIN_NL
      if (wiDevbot) {
        const onF2P = !!(pub && pub.simulated);
        wiDevbot.style.display = onF2P && mode !== "onchain" ? "" : "none";
      }
    });

    socket.on("table:started", (pub) => {
      lastTablePublic = pub || lastTablePublic;
      refreshControlsFromTablePublic();
    });

    socket.on("poker:state", handlePokerState);

    socket.on("poker:hand", (m) => {
      // winners / exposures / final board, etc
      handleShowdownOrHandEnd(m);
    });

    // Try a few private names
    wirePrivateSocketNames();
  }

  /* ---------------------------- DevBot toggling --------------------------- */
  if (wiDevbot) {
    wiDevbot.addEventListener("click", () => {
      if (!socket || !lastTablePublic) return;
      // We send a well-scoped toggle. Server snippet below.
      const desired = !(lastTablePublic.devBotEnabled === true);
      socket.emit("devbot:set", { enabled: desired });
      // Optimistic UI
      lastTablePublic.devBotEnabled = desired;
      wiDevbot.textContent = desired ? "Disable DevBot" : "Enable DevBot";
    });
  }

  /* ------------------------------- Kickoff -------------------------------- */
  function init() {
    recomputeSeatPositions();
    connectSocket();

    // initial banner hidden
    centerBanner.style.display = "none";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  /* ------------------------- Minimal CSS hardeners ------------------------ */
  // In case stylesheet racing causes stacked seats, enforce a few basics:
  const harden = document.createElement("style");
  harden.textContent = `
    .table-canvas { position: relative; }
    .table-canvas .seat { position:absolute; }
    .table-canvas .seat .seat-frame {
      min-width: 120px; min-height: 64px;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px; padding: 6px 8px;
      backdrop-filter: blur(2px);
    }
    .table-canvas .seat .seat-btn {
      background: rgba(0,0,0,0.5);
      color: #fff; border: 1px solid rgba(255,255,255,0.2);
      padding: 4px 8px; border-radius: 999px; font-weight: 700;
      cursor: pointer;
    }
    .table-canvas .card-img { filter: drop-shadow(0 6px 12px rgba(0,0,0,0.55)); }
  `;
  document.head.appendChild(harden);
})();
