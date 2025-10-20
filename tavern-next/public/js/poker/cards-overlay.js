(function () {
  if (typeof window === "undefined") return;

  const IMG_BASE = "/assets/images/chog_cards/";
  const TABLE_SELECTOR = ".table-canvas";
  const SEAT_SELECTOR = ".seat[data-seat-id], .seat-node[data-seat-id]";

  // DOM helpers -------------------------------------------------------------
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const state = {
    canvas: null,
    layer: null,
    deckLayer: null,
    burnLayer: null,
    boardLayer: null,
    boardSlots: [],
    geometry: null,
    myAddrLower: null,
    mySeat: -1,
    currentActors: [],
    dealt: false,
    lastBoardLen: 0,
  };

  function ensureCanvas() {
    if (state.canvas && document.body.contains(state.canvas)) return state.canvas;
    state.canvas = q(TABLE_SELECTOR);
    if (state.canvas && !state.canvas.classList.contains("table-canvas-ready")) {
      state.canvas.classList.add("table-canvas-ready");
    }
    return state.canvas;
  }

  function ensureLayers() {
    const canvas = ensureCanvas();
    if (!canvas) return false;
    if (!state.layer) {
      state.layer = document.createElement("div");
      state.layer.className = "pkr-layer";

      state.deckLayer = document.createElement("div");
      state.deckLayer.className = "pkr-deck";

      state.burnLayer = document.createElement("div");
      state.burnLayer.className = "pkr-burn";

      state.boardLayer = document.createElement("div");
      state.boardLayer.className = "pkr-board";

      canvas.append(state.layer, state.deckLayer, state.burnLayer, state.boardLayer);
      state.boardSlots = Array.from({ length: 5 }, () => {
        const slot = document.createElement("div");
        slot.className = "pkr-board-slot";
        state.boardLayer.appendChild(slot);
        return slot;
      });
    }
    return true;
  }

  function codeToUrl(code) {
    if (!code || code.length < 2) return `${IMG_BASE}dak-and-chog-cardback.png`;
    const rank = code[0].toUpperCase();
    const suit = code[1].toLowerCase();
    const rankName =
      {
        A: "ace",
        K: "king",
        Q: "queen",
        J: "jack",
        T: "ten",
        9: "nine",
        8: "eight",
        7: "seven",
        6: "six",
        5: "five",
        4: "four",
        3: "three",
        2: "two",
      }[rank] || "ace";
    const suitName =
      {
        s: "spades",
        h: "hearts",
        d: "diamonds",
        c: "clubs",
      }[suit] || "spades";
    return `${IMG_BASE}chog-${rankName}-of-${suitName}.png`;
  }

  function makeCard(code, faceDown) {
    const el = document.createElement("div");
    el.className = `pkr-card${faceDown ? " face-down" : ""}`;
    el.dataset.code = code || "";
    if (!faceDown) {
      el.style.backgroundImage = `url("${codeToUrl(code)}")`;
    }
    return el;
  }

  function setFaceUp(el, code) {
    el.classList.remove("face-down");
    el.dataset.code = code;
    el.style.backgroundImage = `url("${codeToUrl(code)}")`;
  }

  function computeGeometry() {
    const canvas = ensureCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height * 0.46;

    const deck = { x: cx, y: cy };
    const spacing = Math.min(rect.width, 820) / 7.2;
    const startX = cx - spacing * 2;
    const boardY = rect.height * 0.3;
    const board = Array.from({ length: 5 }, (_, idx) => ({
      x: startX + spacing * idx,
      y: boardY,
    }));
    const burn = { x: cx - Math.min(36, rect.width * 0.03), y: cy - Math.min(24, rect.height * 0.04) };

    const seats = {};
    qa(SEAT_SELECTOR, canvas).forEach((el) => {
      const seatId = Number(el.getAttribute("data-seat-id"));
      if (!Number.isFinite(seatId)) return;
      const bounds = el.getBoundingClientRect();
      seats[seatId] = {
        el,
        x: bounds.left - rect.left + bounds.width / 2,
        y: bounds.top - rect.top + bounds.height / 2,
      };
    });

    state.geometry = { deck, burn, board, seats, rect };
    positionBoardSlots();
  }

  function positionBoardSlots() {
    if (!state.geometry) computeGeometry();
    if (!state.geometry) return;
    state.boardSlots.forEach((slot, idx) => {
      const point = state.geometry.board[idx];
      if (!point) return;
      slot.style.left = `${point.x}px`;
      slot.style.top = `${point.y}px`;
    });
  }

  function seatCenter(seatId) {
    if (!state.geometry) computeGeometry();
    if (state.geometry?.seats?.[seatId]) {
      return state.geometry.seats[seatId];
    }
    return state.geometry
      ? { x: state.geometry.deck.x, y: state.geometry.deck.y }
      : { x: 0, y: 0 };
  }

  function toDeck(el) {
    if (!state.geometry) computeGeometry();
    if (!state.geometry) return;
    el.style.left = `${state.geometry.deck.x}px`;
    el.style.top = `${state.geometry.deck.y}px`;
  }

  function flyTo(el, x, y, ms) {
    el.style.transitionDuration = `${ms | 0}ms`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function markTurnSeat(seatId) {
    qa(SEAT_SELECTOR).forEach((node) => {
      const nodeSeatId = Number(node.getAttribute("data-seat-id"));
      if (Number.isFinite(nodeSeatId) && nodeSeatId === seatId) {
        node.classList.add("pkr-turn");
      } else {
        node.classList.remove("pkr-turn");
      }
    });
  }

  function clearTurn() {
    qa(SEAT_SELECTOR).forEach((node) => node.classList.remove("pkr-turn"));
  }

  const seatCards = new Map(); // seatId -> card elements

  function clearSeatCards() {
    for (const cards of seatCards.values()) {
      cards.forEach((card) => card.remove());
    }
    seatCards.clear();
  }

  function clearBoardCards() {
    qa(".pkr-card.board").forEach((card) => card.remove());
  }

  async function animateDeal(pokerState) {
    if (state.dealt) return;
    state.dealt = true;
    clearSeatCards();
    clearBoardCards();
    positionBoardSlots();
    state.lastBoardLen = 0;

    const order = (pokerState.actors || [])
      .map((actor) => actor?.seatId)
      .filter((seatId) => Number.isInteger(seatId));

    for (let round = 0; round < 2; round += 1) {
      for (const seatId of order) {
        const cards = seatCards.get(seatId) || [];
        const card = makeCard("", true);
        card.style.opacity = "0";
        state.layer.appendChild(card);
        toDeck(card);
        await sleep(10);
        card.style.opacity = "1";
        const center = seatCenter(seatId);
        flyTo(card, center.x, center.y, 360);
        if (!seatCards.has(seatId)) seatCards.set(seatId, []);
        seatCards.get(seatId).push(card);
        await sleep(300);
      }
    }
  }

  async function animateBurn() {
    const card = makeCard("", true);
    card.style.opacity = "0";
    state.layer.appendChild(card);
    toDeck(card);
    await sleep(10);
    card.style.opacity = "1";
    flyTo(card, state.geometry.burn.x, state.geometry.burn.y, 220);
    await sleep(240);
    card.style.opacity = "0";
    await sleep(120);
    card.remove();
  }

  async function animateFlop(codes) {
    if (!codes || codes.length < 3) return;
    for (let idx = 0; idx < 3; idx += 1) {
      const card = makeCard(codes[idx], true);
      card.classList.add("board");
      card.style.opacity = "0";
      state.layer.appendChild(card);
      toDeck(card);
      await sleep(10);
      card.style.opacity = "1";
      const point = state.geometry.board[idx];
      flyTo(card, point.x, point.y, 320);
      await sleep(340);
      card.style.transform += " scaleX(0.01)";
      await sleep(90);
      setFaceUp(card, codes[idx]);
      card.style.transform = card.style.transform.replace(" scaleX(0.01)", "");
      await sleep(60);
    }
    state.lastBoardLen = 3;
  }

  async function animateTurnOrRiver(code, idx) {
    const card = makeCard(code, true);
    card.classList.add("board");
    card.style.opacity = "0";
    state.layer.appendChild(card);
    toDeck(card);
    await sleep(10);
    card.style.opacity = "1";
    const point = state.geometry.board[idx];
    flyTo(card, point.x, point.y, 320);
    await sleep(340);
    card.style.transform += " scaleX(0.01)";
    await sleep(90);
    setFaceUp(card, code);
    card.style.transform = card.style.transform.replace(" scaleX(0.01)", "");
    await sleep(60);
    state.lastBoardLen = idx + 1;
  }

  function showMyHole(cards) {
    if (state.mySeat < 0) return;
    const arr = seatCards.get(state.mySeat) || [];
    for (let i = 0; i < Math.min(2, arr.length); i += 1) {
      setFaceUp(arr[i], cards[i]);
      arr[i].classList.remove("dim");
    }
  }

  async function applyPokerState(pokerState) {
    if (!pokerState) return;
    state.currentActors = pokerState.actors || [];

    const turnSeat =
      typeof pokerState.turnSeatId === "number"
        ? pokerState.turnSeatId
        : (() => {
            const idx = Number(pokerState.turnIndex || 0);
            if (!state.currentActors[idx]) return -1;
            return Number(state.currentActors[idx].seatId);
          })();
    if (Number.isInteger(turnSeat) && turnSeat >= 0) {
      markTurnSeat(turnSeat);
    } else {
      clearTurn();
    }

    if (pokerState.stage === "preflop" && !state.dealt) {
      await animateDeal(pokerState);
    }

    const community = pokerState.community || [];
    if (pokerState.stage === "flop" && state.lastBoardLen < 3 && community.length >= 3) {
      await animateBurn();
      await animateFlop(community.slice(0, 3));
    } else if (pokerState.stage === "turn" && community.length >= 4 && state.lastBoardLen < 4) {
      await animateBurn();
      await animateTurnOrRiver(community[3], 3);
    } else if (pokerState.stage === "river" && community.length >= 5 && state.lastBoardLen < 5) {
      await animateBurn();
      await animateTurnOrRiver(community[4], 4);
    }
  }

  function applyPrivate(payload) {
    if (!payload) return;
    const cards = Array.isArray(payload.cards) ? payload.cards : payload;
    if (!Array.isArray(cards)) return;
    state.mySeat = Number(payload.seatId ?? state.mySeat ?? -1);
    showMyHole(cards);
  }

  function applyHandSummary(summary) {
    clearTurn();
    if (!summary) {
      state.dealt = false;
      state.lastBoardLen = 0;
      clearSeatCards();
      clearBoardCards();
      positionBoardSlots();
      return;
    }
    if (Array.isArray(summary.exposures)) {
      for (const exposure of summary.exposures) {
        const seatId = Number(exposure?.seatId);
        if (!Number.isFinite(seatId) || seatId < 0) continue;
        const cards = Array.isArray(exposure.cards) ? exposure.cards : [];
        const arr = seatCards.get(seatId) || [];
        for (let i = 0; i < Math.min(2, cards.length, arr.length); i += 1) {
          setFaceUp(arr[i], cards[i]);
        }
      }
    }
    setTimeout(() => {
      state.dealt = false;
      state.lastBoardLen = 0;
      clearSeatCards();
      clearBoardCards();
      positionBoardSlots();
    }, 2600);
  }

  function setContext(ctx) {
    if (!ctx) return;
    if (ctx.address && typeof ctx.address === "string") {
      state.myAddrLower = ctx.address.toLowerCase();
    }
    if (typeof ctx.seatId === "number") {
      state.mySeat = ctx.seatId;
    }
  }

  function refreshSeats() {
    if (!ensureLayers()) return;
    computeGeometry();
  }

  function init() {
    if (!ensureLayers()) return;
    refreshSeats();
    window.addEventListener(
      "resize",
      () => {
        refreshSeats();
      },
      { passive: true }
    );
  }

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      init();
    },
    { once: true }
  );

  init();

  const api = {
    ready: () => !!ensureCanvas(),
    refreshSeats,
    setContext,
    applyState: (st) => {
      if (!ensureLayers()) return;
      Promise.resolve()
        .then(() => applyPokerState(st))
        .catch((err) => console.warn("[PokerOverlay] state application failed", err));
    },
    applyPrivate: (payload) => {
      if (!ensureLayers()) return;
      try {
        applyPrivate(payload);
      } catch (err) {
        console.warn("[PokerOverlay] private cards failed", err);
      }
    },
    applyHand: (summary) => {
      if (!ensureLayers()) return;
      try {
        applyHandSummary(summary);
      } catch (err) {
        console.warn("[PokerOverlay] hand summary failed", err);
      }
    },
  };

  window.__PokerOverlay = api;
})();

