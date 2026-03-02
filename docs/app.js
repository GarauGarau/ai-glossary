const state = {
  manifest: null,
  lang: "en",
  query: "",
  listAll: false,
  dataByLang: new Map(),
  termMap: null,
  mapHoverId: "",
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


function getCssRgb(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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


function quantile(sortedValues, q) {
  if (!sortedValues.length) {
    return 0;
  }
  const idx = Math.floor(clamp(q, 0, 1) * (sortedValues.length - 1));
  return sortedValues[idx];
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

    const hit = bestDist <= 10;
    state.mapHoverId = hit ? bestId : "";
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
  });

  mapCanvasEl.addEventListener("pointerleave", () => {
    state.mapHoverId = "";
    mapCanvasEl.style.cursor = "default";
    if (mapLabelEl) {
      mapLabelEl.textContent = "";
    }
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

  const ink = getCssRgb("--ink-rgb");
  const accent = getCssRgb("--accent-rgb");
  const accent2 = getCssRgb("--accent2-rgb");
  const baseA = document.body.classList.contains("dark") ? 0.24 : 0.18;
  const dotFill = rgba(ink, baseA);
  const selectedFill = rgba(accent, 0.92);
  const selectedRing = rgba(accent, 0.55);
  const selectedGlow = rgba(accent2, 0.24);

  const margin = 12;
  const innerW = Math.max(1, cssW - margin * 2);
  const innerH = Math.max(1, cssH - margin * 2);

  const ids = Object.keys(state.termMap.items);
  const rawXs = [];
  const rawYs = [];
  for (const id of ids) {
    const p = state.termMap.items[id];
    const x = Number(p.x ?? p[0]);
    const y = Number(p.y ?? p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      rawXs.push(x);
      rawYs.push(y);
    }
  }
  rawXs.sort((a, b) => a - b);
  rawYs.sort((a, b) => a - b);

  // Robust scaling: spread points by clipping extreme outliers.
  const xLo = quantile(rawXs, 0.07);
  const xHi = quantile(rawXs, 0.93);
  const yLo = quantile(rawYs, 0.07);
  const yHi = quantile(rawYs, 0.93);
  const xMin = rawXs[0] ?? 0;
  const xMax = rawXs[rawXs.length - 1] ?? 1;
  const yMin = rawYs[0] ?? 0;
  const yMax = rawYs[rawYs.length - 1] ?? 1;

  const x0 = (xHi - xLo) > 1e-9 ? xLo : xMin;
  const x1 = (xHi - xLo) > 1e-9 ? xHi : xMax;
  const y0 = (yHi - yLo) > 1e-9 ? yLo : yMin;
  const y1 = (yHi - yLo) > 1e-9 ? yHi : yMax;

  // Project normalized coordinates into canvas space, and keep them for hit-testing.
  for (const id of ids) {
    const p = state.termMap.items[id];
    const xRaw = Number(p.x ?? p[0]);
    const yRaw = Number(p.y ?? p[1]);
    const xClamped = clamp(xRaw, x0, x1);
    const yClamped = clamp(yRaw, y0, y1);
    const x = (x1 - x0) > 1e-9 ? (xClamped - x0) / (x1 - x0) : 0.5;
    const y = (y1 - y0) > 1e-9 ? (yClamped - y0) / (y1 - y0) : 0.5;
    p._px = margin + clamp(x, 0, 1) * innerW;
    // Flip Y so "up" feels natural.
    p._py = margin + (1 - clamp(y, 0, 1)) * innerH;
  }

  // Base dots.
  ctx.fillStyle = dotFill;
  const r = 2.1;
  for (const id of Object.keys(state.termMap.items)) {
    const p = state.termMap.items[id];
    ctx.beginPath();
    ctx.arc(p._px, p._py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Selected dot.
  if (selectedId && state.termMap.items[selectedId]) {
    const p = state.termMap.items[selectedId];

    ctx.save();
    ctx.shadowColor = selectedGlow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = selectedFill;
    ctx.beginPath();
    ctx.arc(p._px, p._py, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = selectedRing;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p._px, p._py, 9.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Label the 3 nearest terms (by precomputed neighbors if available).
  if (selectedId) {
    const precomputed = Array.isArray(state.termMap.neighbors?.[selectedId])
      ? state.termMap.neighbors[selectedId]
      : null;
    const neighbors = precomputed && precomputed.length
      ? precomputed
      : (() => {
          const sel = state.termMap.items[selectedId];
          if (!sel) {
            return [];
          }
          return Object.keys(state.termMap.items)
            .filter((id) => id !== selectedId)
            .map((id) => {
              const it = state.termMap.items[id];
              const d = Math.hypot((it._px - sel._px), (it._py - sel._py));
              return { id, d };
            })
            .sort((a, b) => a.d - b.d)
            .slice(0, 3)
            .map((row) => row.id);
        })();
    if (neighbors.length) {
      ctx.font = "12px " + getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
      ctx.textBaseline = "middle";

      const bg = rgba(ink, document.body.classList.contains("dark") ? 0.10 : 0.06);
      const border = rgba(ink, document.body.classList.contains("dark") ? 0.22 : 0.14);
      const text = rgba(ink, document.body.classList.contains("dark") ? 0.86 : 0.88);
      const offsets = [
        [10, -12],
        [10, 12],
        [-10, -12],
      ];

      for (let i = 0; i < Math.min(3, neighbors.length); i += 1) {
        const id = neighbors[i];
        const item = state.termMap.items[id];
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
        const padY = 6;
        const boxW = Math.ceil(metrics.width) + padX * 2;
        const boxH = 22;

        let x = mx + dx;
        let y = my + dy;
        if (dx < 0) {
          x -= boxW;
        }
        x = clamp(x, 6, cssW - boxW - 6);
        y = clamp(y - boxH / 2, 6, cssH - boxH - 6);

        // Leader line
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(clamp(x + (dx < 0 ? boxW : 0), 0, cssW), clamp(y + boxH / 2, 0, cssH));
        ctx.stroke();

        // Label pill
        ctx.fillStyle = bg;
        ctx.strokeStyle = border;
        roundedRect(ctx, x, y, boxW, boxH, 11);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = text;
        ctx.fillText(label, x + padX, y + boxH / 2);
      }
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

  renderTermMap(getSelectedTermId(terms));

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
