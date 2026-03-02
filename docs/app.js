const state = {
  manifest: null,
  lang: "en",
  query: "",
  listAll: false,
  dataByLang: new Map(),
  termMap: null,
  mapHoverId: "",
  mapHoverPos: null,
  mapSelectedId: "",
  mapReady: false,
};

const searchEl = document.getElementById("search");
const resultsEl = document.getElementById("results");
const langSwitchEl = document.getElementById("lang-switch");
const metaEl = document.getElementById("meta-status");
const themeToggleEl = document.getElementById("theme-toggle");
const randomTermEl = document.getElementById("random-term");
const listAllEl = document.getElementById("list-all");
const introEl = document.getElementById("intro");
const introEnEl = document.getElementById("intro-en");
const introItEl = document.getElementById("intro-it");
const mapPanelEl = document.querySelector(".map-panel");
const mapCanvasEl = document.getElementById("term-map");
const mapLabelEl = document.getElementById("map-label");
const cardTemplate = document.getElementById("card-template");


function getCssRgb(name, sourceEl = document.body) {
  const primary = sourceEl || document.body || document.documentElement;
  const fallback = document.documentElement;
  const raw = (getComputedStyle(primary).getPropertyValue(name).trim() ||
    getComputedStyle(fallback).getPropertyValue(name).trim());
  const parts = raw.split(/\s+/).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (parts.length !== 3) {
    return [0, 0, 0];
  }
  return parts;
}


function rgba(rgb, a) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}


function getTermById(lang, termId) {
  const dataset = state.dataByLang.get(lang);
  if (!dataset) {
    return null;
  }
  return dataset.terms.find((t) => t.id === termId) || null;
}


function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}


function scoreTerm(term, tokens) {
  const termName = normalize(term.term);
  const aliases = term.aliases.map(normalize);
  const definition = normalize(term.definition);
  const keyIntuition = normalize(term.key_intuition || "");

  let score = 0;
  for (const token of tokens) {
    if (termName === token) {
      score += 100;
      continue;
    }
    if (termName.includes(token)) {
      score += 60;
      continue;
    }
    if (aliases.some((a) => a.includes(token))) {
      score += 40;
      continue;
    }
    if (definition.includes(token)) {
      score += 10;
      continue;
    }
    if (keyIntuition && keyIntuition.includes(token)) {
      score += 6;
      continue;
    }
    return -1;
  }
  return score;
}


function formatTag(tag) {
  if (!tag) {
    return "";
  }
  return tag
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}


function difficultyRank(value) {
  if (value === "beginner") {
    return 0;
  }
  if (value === "intermediate") {
    return 1;
  }
  if (value === "advanced") {
    return 2;
  }
  return 99;
}


function getAllTermsSorted(dataset) {
  return dataset.terms
    .slice()
    .sort((a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty) || a.term.localeCompare(b.term));
}


function getActiveTerms() {
  const dataset = state.dataByLang.get(state.lang);
  if (!dataset) {
    return [];
  }
  if (state.listAll) {
    return getAllTermsSorted(dataset);
  }
  if (!state.query.trim()) {
    return [];
  }
  const tokens = normalize(state.query).split(/\s+/).filter(Boolean);
  return dataset.terms
    .map((term) => ({ term, score: scoreTerm(term, tokens) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score || a.term.term.localeCompare(b.term.term))
    .map((row) => row.term);
}


function renderListAllButton() {
  if (!listAllEl) {
    return;
  }
  if (state.lang === "it") {
    listAllEl.textContent = state.listAll ? "Cerca" : "Tutti";
    return;
  }
  listAllEl.textContent = state.listAll ? "Search" : "All terms";
}


function renderIntro() {
  if (!introEl) {
    return;
  }
  const query = (searchEl.value || state.query).trim();
  const showIntro = !state.listAll && !query;
  introEl.hidden = !showIntro;
  resultsEl.hidden = showIntro;

  if (introEnEl && introItEl) {
    introEnEl.hidden = state.lang !== "en";
    introItEl.hidden = state.lang !== "it";
  }

  introEl.querySelectorAll("[data-intro-lang]").forEach((node) => {
    node.hidden = node.dataset.introLang !== state.lang;
  });
}


function renderControlCopy() {
  document.querySelectorAll("[data-shortcuts]").forEach((node) => {
    node.hidden = node.dataset.shortcuts !== state.lang;
  });

  document.querySelectorAll("[data-map-lang]").forEach((node) => {
    node.hidden = node.dataset.mapLang !== state.lang;
  });

  if (state.lang === "it") {
    searchEl.placeholder = "Cerca termini, alias, definizioni...";
    randomTermEl.textContent = "Casuale";
    themeToggleEl.textContent = "Tema";
    return;
  }
  searchEl.placeholder = "Search terms, aliases, definitions...";
  randomTermEl.textContent = "Random";
  themeToggleEl.textContent = "Theme";
}


async function loadTermMap() {
  if (!mapPanelEl || !mapCanvasEl) {
    return;
  }
  try {
    const res = await fetch("term_map.json", { cache: "no-cache" });
    if (!res.ok) {
      throw new Error("term_map.json not found");
    }
    state.termMap = await res.json();
    state.mapReady = true;
  } catch (_) {
    state.termMap = null;
    state.mapReady = false;
  }
}


function getSelectedTermId(terms) {
  if (!state.query.trim()) {
    return "";
  }
  if (!terms.length) {
    return "";
  }
  return terms[0].id;
}


function getMapNeighbors(termId) {
  if (!termId || !state.termMap || !state.termMap.items) {
    return [];
  }
  const neighbors = state.termMap.neighbors?.[termId];
  if (!Array.isArray(neighbors)) {
    return [];
  }
  return neighbors.filter((id) => typeof id === "string" && id in state.termMap.items);
}


function setSearchToTermId(termId) {
  const term = getTermById(state.lang, termId);
  if (!term) {
    return;
  }
  state.listAll = false;
  searchEl.value = term.term;
  state.query = term.term;
  render();
  searchEl.focus();
}


function setupTermMap() {
  if (!mapPanelEl || !mapCanvasEl) {
    return;
  }

  const updateHoverFromEvent = (e) => {
    if (!state.termMap || !state.termMap.items) {
      state.mapHoverId = "";
      state.mapHoverPos = null;
      mapCanvasEl.style.cursor = "default";
      if (mapLabelEl) {
        mapLabelEl.textContent = "";
      }
      return;
    }

    const rect = mapCanvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const ids = Object.keys(state.termMap.items);
    let bestId = "";
    let bestDist = Infinity;
    for (const id of ids) {
      const p = state.termMap.items[id];
      const px = p._px;
      const py = p._py;
      if (typeof px !== "number" || typeof py !== "number") {
        continue;
      }
      const dx = mx - px;
      const dy = my - py;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }

    const hit = bestDist <= 12;
    state.mapHoverId = hit ? bestId : "";
    state.mapHoverPos = hit ? { x: mx, y: my } : null;
    mapCanvasEl.style.cursor = hit ? "pointer" : "default";
    if (mapLabelEl) {
      if (!hit) {
        mapLabelEl.textContent = "";
        return;
      }
      const t = getTermById(state.lang, bestId);
      mapLabelEl.textContent = t ? t.term : bestId;
    }
  };

  mapCanvasEl.addEventListener("pointermove", (e) => {
    updateHoverFromEvent(e);
    renderTermMap(state.mapSelectedId);
  });

  mapCanvasEl.addEventListener("pointerleave", () => {
    state.mapHoverId = "";
    state.mapHoverPos = null;
    mapCanvasEl.style.cursor = "default";
    if (mapLabelEl) {
      mapLabelEl.textContent = "";
    }
    renderTermMap(state.mapSelectedId);
  });

  mapCanvasEl.addEventListener("click", () => {
    if (!state.mapHoverId) {
      return;
    }
    setSearchToTermId(state.mapHoverId);
  });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      render();
    });
    ro.observe(mapCanvasEl);
  } else {
    window.addEventListener("resize", () => {
      render();
    });
  }
}


function renderTermMap(selectedId) {
  if (!mapPanelEl || !mapCanvasEl) {
    return;
  }
  state.mapSelectedId = selectedId || "";
  if (!state.termMap || !state.termMap.items) {
    mapPanelEl.hidden = true;
    return;
  }

  mapPanelEl.hidden = false;

  const ctx = mapCanvasEl.getContext("2d");
  if (!ctx) {
    return;
  }

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, Math.floor(mapCanvasEl.clientWidth));
  const cssH = Math.max(1, Math.floor(mapCanvasEl.clientHeight));
  const w = Math.floor(cssW * dpr);
  const h = Math.floor(cssH * dpr);
  if (mapCanvasEl.width !== w || mapCanvasEl.height !== h) {
    mapCanvasEl.width = w;
    mapCanvasEl.height = h;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const isDark = document.body.classList.contains("dark");
  const ink = getCssRgb("--ink-rgb", mapCanvasEl);
  const accent = getCssRgb("--accent-rgb", mapCanvasEl);
  const accent2 = getCssRgb("--accent2-rgb", mapCanvasEl);
  const edgeBase = rgba(ink, isDark ? 0.20 : 0.12);
  const edgeActive = rgba(accent2, isDark ? 0.62 : 0.44);
  const nodeMuted = rgba(ink, isDark ? 0.24 : 0.17);
  const nodeFill = rgba(ink, isDark ? 0.44 : 0.30);
  const neighborFill = rgba(accent2, isDark ? 0.78 : 0.62);
  const selectedFill = rgba(accent, 0.96);
  const selectedRing = rgba(accent, isDark ? 0.72 : 0.56);
  const selectedGlow = rgba(accent2, isDark ? 0.42 : 0.28);
  const hoverFill = rgba(accent2, isDark ? 0.94 : 0.86);
  const hoverRing = rgba(accent2, isDark ? 0.70 : 0.56);
  const hoverGlow = rgba(accent2, isDark ? 0.32 : 0.24);
  const labelBg = rgba(ink, isDark ? 0.20 : 0.08);
  const labelBorder = rgba(ink, isDark ? 0.36 : 0.18);
  const labelText = rgba(ink, isDark ? 0.94 : 0.90);

  const margin = 14;
  const innerW = Math.max(1, cssW - margin * 2);
  const innerH = Math.max(1, cssH - margin * 2);

  const items = state.termMap.items;
  const ids = Object.keys(items);
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let needsNormalization = false;
  for (const id of ids) {
    const p = items[id];
    const xRaw = Number(p.x ?? p[0]);
    const yRaw = Number(p.y ?? p[1]);
    if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) {
      continue;
    }
    xMin = Math.min(xMin, xRaw);
    xMax = Math.max(xMax, xRaw);
    yMin = Math.min(yMin, yRaw);
    yMax = Math.max(yMax, yRaw);
    if (xRaw < 0 || xRaw > 1 || yRaw < 0 || yRaw > 1) {
      needsNormalization = true;
    }
  }

  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) {
    mapPanelEl.hidden = true;
    return;
  }

  const spanX = Math.max(1e-9, xMax - xMin);
  const spanY = Math.max(1e-9, yMax - yMin);
  const validIds = [];
  for (const id of ids) {
    const p = state.termMap.items[id];
    const xRaw = Number(p.x ?? p[0]);
    const yRaw = Number(p.y ?? p[1]);
    if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) {
      delete p._px;
      delete p._py;
      continue;
    }
    const xNorm = needsNormalization ? (xRaw - xMin) / spanX : xRaw;
    const yNorm = needsNormalization ? (yRaw - yMin) / spanY : yRaw;
    const x = clamp(xNorm, 0, 1);
    const y = clamp(yNorm, 0, 1);
    p._px = margin + clamp(x, 0, 1) * innerW;
    p._py = margin + (1 - clamp(y, 0, 1)) * innerH;
    validIds.push(id);
  }

  const ambientA = ctx.createRadialGradient(cssW * 0.08, cssH * 0.10, 0, cssW * 0.08, cssH * 0.10, cssW * 0.88);
  ambientA.addColorStop(0, rgba(accent, isDark ? 0.16 : 0.10));
  ambientA.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = ambientA;
  ctx.fillRect(0, 0, cssW, cssH);

  const ambientB = ctx.createRadialGradient(cssW * 0.92, cssH * 0.90, 0, cssW * 0.92, cssH * 0.90, cssW * 0.84);
  ambientB.addColorStop(0, rgba(accent2, isDark ? 0.14 : 0.10));
  ambientB.addColorStop(1, rgba(accent2, 0));
  ctx.fillStyle = ambientB;
  ctx.fillRect(0, 0, cssW, cssH);

  const edgePairs = [];
  const edgeSeen = new Set();
  for (const id of validIds) {
    for (const neighborId of getMapNeighbors(id)) {
      const from = items[id];
      const to = items[neighborId];
      if (!from || !to || typeof to._px !== "number" || typeof to._py !== "number") {
        continue;
      }
      const key = id < neighborId ? `${id}|${neighborId}` : `${neighborId}|${id}`;
      if (edgeSeen.has(key)) {
        continue;
      }
      edgeSeen.add(key);
      edgePairs.push([id, neighborId]);
    }
  }

  if (edgePairs.length) {
    ctx.strokeStyle = edgeBase;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [a, b] of edgePairs) {
      const pa = items[a];
      const pb = items[b];
      if (!pa || !pb) {
        continue;
      }
      ctx.moveTo(pa._px, pa._py);
      ctx.lineTo(pb._px, pb._py);
    }
    ctx.stroke();
  }

  const activeId = state.mapHoverId || selectedId || "";
  const activeNeighbors = new Set(getMapNeighbors(activeId));

  if (activeId && items[activeId]) {
    const source = items[activeId];
    ctx.save();
    ctx.strokeStyle = edgeActive;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = rgba(accent2, isDark ? 0.32 : 0.24);
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (const neighborId of activeNeighbors) {
      const target = items[neighborId];
      if (!target || typeof target._px !== "number" || typeof target._py !== "number") {
        continue;
      }
      ctx.moveTo(source._px, source._py);
      ctx.lineTo(target._px, target._py);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = nodeMuted;
  const r = 2.3;
  for (const id of validIds) {
    const p = items[id];
    ctx.beginPath();
    ctx.arc(p._px, p._py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (activeNeighbors.size) {
    ctx.fillStyle = neighborFill;
    for (const neighborId of activeNeighbors) {
      const p = items[neighborId];
      if (!p || typeof p._px !== "number" || typeof p._py !== "number") {
        continue;
      }
      ctx.beginPath();
      ctx.arc(p._px, p._py, 2.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = nodeFill;
  for (const id of validIds) {
    const p = items[id];
    ctx.beginPath();
    ctx.arc(p._px, p._py, 1.55, 0, Math.PI * 2);
    ctx.fill();
  }

  if (selectedId && items[selectedId]) {
    const p = items[selectedId];
    const hoveredSame = state.mapHoverId === selectedId;
    const coreR = hoveredSame ? 4.9 : 4.4;
    const ringR = hoveredSame ? 11.0 : 9.8;

    ctx.save();
    ctx.shadowColor = selectedGlow;
    ctx.shadowBlur = hoveredSame ? 18 : 14;
    ctx.fillStyle = selectedFill;
    ctx.beginPath();
    ctx.arc(p._px, p._py, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = selectedRing;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(p._px, p._py, ringR, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (state.mapHoverId && items[state.mapHoverId] && state.mapHoverPos) {
    const p = items[state.mapHoverId];
    ctx.save();
    ctx.shadowColor = hoverGlow;
    ctx.shadowBlur = 16;
    ctx.fillStyle = hoverFill;
    ctx.beginPath();
    ctx.arc(p._px, p._py, 4.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = hoverRing;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p._px, p._py, 8.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  const monoFont = getComputedStyle(mapCanvasEl).getPropertyValue("--font-mono").trim() || "monospace";
  const fallbackNeighbors = (anchorId, count) => {
    const center = items[anchorId];
    if (!center) {
      return [];
    }
    return validIds
      .filter((id) => id !== anchorId)
      .map((id) => {
        const item = items[id];
        return {
          id,
          d: Math.hypot(item._px - center._px, item._py - center._py),
        };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, count)
      .map((row) => row.id);
  };

  const labelAnchorId = activeId;
  if (labelAnchorId && items[labelAnchorId]) {
    const neighborIds = getMapNeighbors(labelAnchorId).slice(0, 3);
    const labels = neighborIds.length ? neighborIds : fallbackNeighbors(labelAnchorId, 3);
    if (labels.length) {
      ctx.font = "12px " + monoFont;
      ctx.textBaseline = "middle";
      const offsets = [
        [10, -12],
        [10, 12],
        [-10, -12],
      ];

      for (let i = 0; i < Math.min(labels.length, 3); i += 1) {
        const id = labels[i];
        const item = items[id];
        if (!item) {
          continue;
        }
        const t = getTermById(state.lang, id);
        const label = t ? t.term : id;
        const dx = offsets[i][0];
        const dy = offsets[i][1];
        const mx = item._px;
        const my = item._py;
        const metrics = ctx.measureText(label);
        const padX = 8;
        const boxW = Math.ceil(metrics.width) + padX * 2;
        const boxH = 22;

        let x = mx + dx;
        let y = my + dy;
        if (dx < 0) {
          x -= boxW;
        }
        x = clamp(x, 6, cssW - boxW - 6);
        y = clamp(y - boxH / 2, 6, cssH - boxH - 6);

        ctx.strokeStyle = labelBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(clamp(x + (dx < 0 ? boxW : 0), 0, cssW), clamp(y + boxH / 2, 0, cssH));
        ctx.stroke();

        ctx.fillStyle = labelBg;
        ctx.strokeStyle = labelBorder;
        roundedRect(ctx, x, y, boxW, boxH, 11);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = labelText;
        ctx.fillText(label, x + padX, y + boxH / 2);
      }
    }
  }

  if (state.mapHoverId && state.mapHoverPos) {
    const term = getTermById(state.lang, state.mapHoverId);
    const tooltipText = term ? term.term : state.mapHoverId;
    if (tooltipText) {
      ctx.font = "12px " + monoFont;
      ctx.textBaseline = "middle";
      const padX = 10;
      const boxH = 24;
      const boxW = Math.ceil(ctx.measureText(tooltipText).width) + padX * 2;
      let x = state.mapHoverPos.x + 14;
      let y = state.mapHoverPos.y - boxH - 10;
      if (x + boxW > cssW - 6) {
        x = state.mapHoverPos.x - boxW - 14;
      }
      if (y < 6) {
        y = state.mapHoverPos.y + 12;
      }
      x = clamp(x, 6, cssW - boxW - 6);
      y = clamp(y, 6, cssH - boxH - 6);

      ctx.fillStyle = labelBg;
      ctx.strokeStyle = labelBorder;
      roundedRect(ctx, x, y, boxW, boxH, 11);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = labelText;
      ctx.fillText(tooltipText, x + padX, y + boxH / 2);
    }
  }

  if (mapLabelEl && !state.mapHoverId) {
    if (selectedId) {
      const selectedTerm = getTermById(state.lang, selectedId);
      mapLabelEl.textContent = selectedTerm ? selectedTerm.term : selectedId;
    } else {
      mapLabelEl.textContent = "";
    }
  }
}


async function loadManifest() {
  const res = await fetch("manifest.json", { cache: "no-cache" });
  if (!res.ok) {
    throw new Error("Could not load manifest.json. Run build.py first.");
  }
  state.manifest = await res.json();
}


async function loadLanguageData(lang) {
  if (state.dataByLang.has(lang)) {
    return state.dataByLang.get(lang);
  }
  const path = state.manifest.files[lang];
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Could not load ${path}`);
  }
  const payload = await res.json();
  state.dataByLang.set(lang, payload);
  return payload;
}


function updateMeta(text) {
  metaEl.textContent = text;
}


function buildReportUrl(term) {
  const base = state.manifest.issue_base_url;
  if (!base) {
    return "";
  }
  const title = encodeURIComponent(`[${state.lang}] Issue: ${term.term}`);
  const body = encodeURIComponent([
    `Term ID: ${term.id}`,
    `Language: ${state.lang}`,
    "",
    "Describe the issue:",
  ].join("\n"));
  return `${base}?title=${title}&body=${body}`;
}


function wireRelatedButtons(container) {
  container.querySelectorAll(".related button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.listAll = false;
      searchEl.value = btn.dataset.termId;
      state.query = btn.dataset.termId;
      render();
    });
  });
}


function renderCards(terms) {
  resultsEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (let idx = 0; idx < terms.length; idx += 1) {
    const term = terms[idx];
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.termId = term.id;
    node.dataset.difficulty = term.difficulty;
    node.style.setProperty("--stagger", String(idx));
    node.querySelector(".term").textContent = term.term;
    node.querySelector(".difficulty").textContent = term.difficulty;
    node.querySelector(".definition").textContent = term.definition;

    const tagsEl = node.querySelector(".tags");
    tagsEl.innerHTML = "";
    const rawTags = Array.isArray(term.tags) ? term.tags : [];
    const visibleTags = rawTags
      .filter((t) => typeof t === "string" && t.trim())
      .filter((t) => !t.startsWith("video-"));
    const seen = new Set();
    for (const tag of visibleTags) {
      if (seen.has(tag)) {
        continue;
      }
      seen.add(tag);
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = formatTag(tag);
      tagsEl.appendChild(span);
    }

    const intuitionDetailsEl = node.querySelector(".intuition-details");
    const intuitionEl = node.querySelector(".key-intuition");
    if (term.key_intuition && term.key_intuition.trim()) {
      intuitionEl.textContent = term.key_intuition;
    } else {
      intuitionDetailsEl.hidden = true;
    }

    node.querySelector(".use-cases").textContent = `Use cases: ${term.use_cases}`;
    const reportEl = node.querySelector(".report");
    const reportUrl = buildReportUrl(term);
    if (reportUrl) {
      reportEl.href = reportUrl;
    } else {
      reportEl.hidden = true;
    }

    const linksEl = node.querySelector(".links");
    for (const link of term.links) {
      const a = document.createElement("a");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.className = "link-tag";
      a.textContent = `${link.type}: ${link.title}`;
      linksEl.appendChild(a);
    }

    const relatedEl = node.querySelector(".related");
    if (term.related.length > 0) {
      for (const rel of term.related) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.termId = rel;
        b.textContent = rel;
        relatedEl.appendChild(b);
      }
    } else {
      relatedEl.textContent = "No related terms.";
    }

    fragment.appendChild(node);
  }

  resultsEl.appendChild(fragment);
  wireRelatedButtons(resultsEl);
}


function renderLanguageSwitch() {
  langSwitchEl.innerHTML = "";
  for (const lang of state.manifest.active_languages) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `lang-btn ${lang === state.lang ? "active" : ""}`;
    btn.textContent = lang.toUpperCase();
    btn.addEventListener("click", async () => {
      state.lang = lang;
      document.documentElement.lang = lang;
      await loadLanguageData(lang);
      renderLanguageSwitch();
      render();
    });
    langSwitchEl.appendChild(btn);
  }
}


function render() {
  renderControlCopy();
  renderListAllButton();
  renderIntro();
  const dataset = state.dataByLang.get(state.lang);
  const terms = getActiveTerms();
  renderCards(terms);

  state.mapSelectedId = getSelectedTermId(terms);
  renderTermMap(state.mapSelectedId);

  if (state.listAll) {
    const total = dataset ? dataset.terms.length : terms.length;
    updateMeta(state.lang === "it"
      ? `${total} termini (ordinati per difficoltà)`
      : `${total} terms (sorted by difficulty)`);
    return;
  }

  if (!state.query.trim()) {
    updateMeta(state.lang === "it"
      ? "Premi / per attivare la ricerca, oppure sfoglia tutti i termini."
      : "Press / to jump to search, or browse all terms.");
    return;
  }

  updateMeta(state.lang === "it"
    ? `${terms.length} risultati`
    : `${terms.length} result(s)`);
}


function setupTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const useDark = localStorage.getItem("theme") === "dark" ||
    (!localStorage.getItem("theme") && media.matches);
  document.body.classList.toggle("dark", useDark);
  themeToggleEl.addEventListener("click", () => {
    const next = !document.body.classList.contains("dark");
    document.body.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    render();
  });
}


async function init() {
  setupTheme();
  await loadManifest();
  await loadLanguageData(state.lang);
  await loadTermMap();
  document.documentElement.lang = state.lang;
  renderLanguageSwitch();
  setupTermMap();

  searchEl.addEventListener("input", () => {
    state.listAll = false;
    state.query = searchEl.value;
    render();
  });

  randomTermEl.addEventListener("click", () => {
    state.listAll = false;
    const dataset = state.dataByLang.get(state.lang);
    if (!dataset || dataset.terms.length === 0) {
      return;
    }
    const pick = dataset.terms[Math.floor(Math.random() * dataset.terms.length)];
    searchEl.value = pick.term;
    state.query = pick.term;
    render();
  });

  if (listAllEl) {
    listAllEl.addEventListener("click", () => {
      state.listAll = !state.listAll;
      if (state.listAll) {
        state.query = "";
        searchEl.value = "";
      }
      render();
    });
  }

  document.querySelectorAll("[data-intro-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.introAction;
      if (action === "all") {
        if (!state.listAll) {
          listAllEl.click();
        }
        return;
      }
      if (action === "random") {
        randomTermEl.click();
      }
    });
  });

  document.querySelectorAll("[data-quick-term]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.listAll = false;
      const value = btn.dataset.quickTerm;
      searchEl.value = value;
      state.query = value;
      render();
      searchEl.focus();
    });
  });

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    const isTyping = Boolean(
      target &&
      (target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select")
    );

    if (e.key === "/" && !isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      searchEl.focus();
    }
    if (e.key === "Escape") {
      if (state.listAll || state.query.trim()) {
        state.listAll = false;
        state.query = "";
        searchEl.value = "";
        render();
      }
    }
  });

  render();
}


init().catch((err) => {
  updateMeta(err.message);
});
