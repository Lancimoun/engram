const LIFECYCLES = ["active", "dormant", "contradiction", "revised", "restored"];
const COLORS = {
  active: "#5ed7bd",
  dormant: "#7a8493",
  contradiction: "#ef6b7f",
  revised: "#d9a856",
  restored: "#85a8e6",
};

const MODEL_MASKS = [
  [/claude\s+haiku/gi, "Compact model"],
  [/claude\s+sonnet/gi, "Frontier model"],
  [/claude\s+opus/gi, "Deep-reasoning model"],
];

const elements = {
  apiStatus: document.querySelector("#apiStatus"),
  apiStatusText: document.querySelector("#apiStatusText"),
  ingestForm: document.querySelector("#ingestForm"),
  queryForm: document.querySelector("#queryForm"),
  decayForm: document.querySelector("#decayForm"),
  runDemo: document.querySelector("#runDemo"),
  resetDemo: document.querySelector("#resetDemo"),
  memoryText: document.querySelector("#memoryText"),
  sourceText: document.querySelector("#sourceText"),
  queryText: document.querySelector("#queryText"),
  decayDays: document.querySelector("#decayDays"),
  revisionLine: document.querySelector("#revisionLine"),
  beliefCount: document.querySelector("#beliefCount"),
  activeDormantLine: document.querySelector("#activeDormantLine"),
  revisionCount: document.querySelector("#revisionCount"),
  contradictionCount: document.querySelector("#contradictionCount"),
  eventCount: document.querySelector("#eventCount"),
  latestEventLine: document.querySelector("#latestEventLine"),
  provenanceScore: document.querySelector("#provenanceScore"),
  eventRhythm: document.querySelector("#eventRhythm"),
  eventRhythmLabel: document.querySelector("#eventRhythmLabel"),
  beliefTableMeta: document.querySelector("#beliefTableMeta"),
  beliefFilters: document.querySelector("#beliefFilters"),
  beliefTable: document.querySelector("#beliefTable"),
  latestRevision: document.querySelector("#latestRevision"),
  healthVerdict: document.querySelector("#healthVerdict"),
  integrityScore: document.querySelector("#integrityScore"),
  driftScore: document.querySelector("#driftScore"),
  coverageScore: document.querySelector("#coverageScore"),
  integrityBar: document.querySelector("#integrityBar"),
  driftBar: document.querySelector("#driftBar"),
  coverageBar: document.querySelector("#coverageBar"),
  streamHealth: document.querySelector("#streamHealth"),
  eventList: document.querySelector("#eventList"),
  queryResult: document.querySelector("#queryResult"),
  selectedMemory: document.querySelector("#selectedMemory"),
  memoryPressure: document.querySelector("#memoryPressure"),
  canvas: document.querySelector("#memoryGraph"),
};

let state = emptyState();
let nodes = [];
let selectedId = null;
let online = false;
let activeFilter = "all";
let observatory = null;

function emptyState() {
  return {
    beliefs: [],
    revisions: [],
    events: [],
    metrics: {
      beliefs: 0,
      active: 0,
      dormant: 0,
      revisions: 0,
      contradictions: 0,
      provenance_completeness: 0,
      events: 0,
    },
  };
}

function normalizeState(payload) {
  const beliefs = Array.isArray(payload?.beliefs) ? payload.beliefs : [];
  const revisions = Array.isArray(payload?.revisions) ? payload.revisions : [];
  const events = Array.isArray(payload?.events) ? payload.events : [];

  const normalizedBeliefs = beliefs.map((belief, index) => {
    const label = String(belief.label ?? belief.subject ?? belief.text ?? belief.claim ?? `Belief ${index + 1}`);
    const value = String(belief.value ?? belief.content ?? belief.text ?? belief.claim ?? "Unknown value");
    return {
      id: String(belief.id ?? belief.belief_id ?? `belief-${index}`),
      subject: String(belief.subject ?? label),
      label: sanitizeDisplay(label),
      value: sanitizeDisplay(value),
      source: sanitizeDisplay(String(belief.source_ref ?? belief.source ?? "unknown")),
      status: deriveBeliefLife(belief, revisions),
      confidence: clampConfidence(belief.score ?? belief.confidence),
      reinforcement_count: Number(belief.reinforcement_count ?? 0),
      contested: Number(belief.contested ?? 0) === 1,
      created_at: belief.created_at ?? null,
      updated_at: belief.last_seen_at ?? belief.updated_at ?? belief.created_at ?? null,
    };
  });

  const normalizedRevisions = revisions.map((revision, index) => ({
    id: String(revision.id ?? `revision-${index}`),
    belief_id: String(revision.belief_id ?? ""),
    type: normalizeEventType(revision.event_type ?? revision.type ?? revision.trigger ?? "revision"),
    trigger: sanitizeDisplay(String(revision.trigger ?? revision.event_type ?? "revision")),
    from_value: sanitizeDisplay(String(revision.from_value ?? "")),
    to_value: sanitizeDisplay(String(revision.to_value ?? "")),
    evidence_ref: sanitizeDisplay(String(revision.evidence_ref ?? "none")),
    reason: sanitizeDisplay(String(revision.reason ?? "Revision recorded.")),
    timestamp: revision.timestamp ?? revision.created_at ?? null,
  }));

  const normalizedEvents = events.map((event, index) => ({
    id: String(event.id ?? `event-${index}`),
    type: normalizeEventType(event.event_type ?? event.type ?? event.kind ?? "event"),
    subject: sanitizeDisplay(String(event.subject ?? "ledger")),
    message: sanitizeDisplay(
      String(event.message ?? event.summary ?? event.detail ?? event.text ?? event.event_type ?? event.type ?? "ledger event"),
    ),
    created_at: event.timestamp ?? event.created_at ?? event.time ?? null,
  }));

  const active = normalizedBeliefs.filter((belief) => belief.status === "active" || belief.status === "revised" || belief.status === "restored").length;
  const dormant = normalizedBeliefs.filter((belief) => belief.status === "dormant").length;
  const contradictions = normalizedRevisions.filter((revision) => normalizeLife(revision.trigger) === "contradiction").length;
  const sourced = normalizedBeliefs.filter((belief) => belief.source && belief.source !== "unknown").length;

  return {
    beliefs: normalizedBeliefs,
    revisions: normalizedRevisions,
    events: normalizedEvents,
    metrics: {
      beliefs: Number(payload?.metrics?.beliefs ?? normalizedBeliefs.length),
      active: Number(payload?.metrics?.active ?? active),
      dormant: Number(payload?.metrics?.dormant ?? dormant),
      revisions: Number(payload?.metrics?.revisions ?? normalizedRevisions.length),
      contradictions: Number(payload?.metrics?.contradictions ?? contradictions),
      provenance_completeness: Number(
        payload?.metrics?.provenance_completeness ?? (normalizedBeliefs.length ? sourced / normalizedBeliefs.length : 0),
      ),
      events: Number(payload?.metrics?.events ?? normalizedEvents.length),
    },
  };
}

function deriveBeliefLife(belief, revisions) {
  const explicit = normalizeLife(belief.status ?? belief.lifecycle ?? belief.state);
  if (explicit === "dormant") {
    return "dormant";
  }

  const latestRevision = revisions
    .filter((revision) => String(revision.belief_id) === String(belief.id))
    .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")))[0];
  const triggerLife = normalizeLife(latestRevision?.trigger ?? latestRevision?.event_type);
  if (triggerLife === "restored") {
    return "restored";
  }
  if (triggerLife === "dormant") {
    return "dormant";
  }
  if (triggerLife === "contradiction" || Number(belief.contested) === 1) {
    return "revised";
  }
  return explicit;
}

function normalizeEventType(value) {
  return String(value ?? "event").toLowerCase().replace(/_/g, "-");
}

function normalizeLife(value) {
  const normalized = normalizeEventType(value);
  if (["ingest", "reinforce", "active"].includes(normalized)) {
    return "active";
  }
  if (["revise", "revision", "revised", "updated"].includes(normalized)) {
    return "revised";
  }
  if (["conflict", "contradict", "contradicted", "contradiction"].includes(normalized)) {
    return "contradiction";
  }
  if (["restore", "restored"].includes(normalized)) {
    return "restored";
  }
  if (["decay-dormant", "dormant", "decayed", "decay"].includes(normalized)) {
    return "dormant";
  }
  return LIFECYCLES.includes(normalized) ? normalized : "active";
}

function clampConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, confidence));
}

function sanitizeDisplay(value) {
  let safe = String(value ?? "");
  MODEL_MASKS.forEach(([pattern, replacement]) => {
    safe = safe.replace(pattern, replacement);
  });
  return safe;
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function refreshState() {
  try {
    const payload = await requestJson("/api/state");
    state = normalizeState(payload);
    setApiStatus(true, "connected");
  } catch (error) {
    // Backend unreachable: fall back to the baked read-only snapshot so the
    // observatory still shows a populated scene instead of an empty stage.
    await loadSnapshotFallback();
  }
  positionNodes();
  renderState();
}

async function loadSnapshotFallback() {
  try {
    const payload = await requestJson("/static/state.snapshot.json");
    state = normalizeState(payload);
    setApiStatus(false, "offline / read-only snapshot");
  } catch (snapshotError) {
    setApiStatus(false, "offline");
  }
}

function setApiStatus(isOnline, text) {
  online = isOnline;
  elements.apiStatus.className = `status-dot ${isOnline ? "active" : "dormant"}`;
  elements.apiStatusText.textContent = text;
}

async function mutate(url, body) {
  setBusy(true);
  try {
    const payload = await requestJson(url, { method: "POST", body: JSON.stringify(body ?? {}) });
    const nextState = payload?.state ?? (payload?.beliefs ? payload : null);
    if (nextState) {
      state = normalizeState(nextState);
      positionNodes();
      renderState();
    } else {
      await refreshState();
    }
    setApiStatus(true, "connected");
    return payload;
  } catch (error) {
    setApiStatus(false, "offline");
    throw error;
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

function renderState() {
  const beliefCount = state.metrics.beliefs ?? state.beliefs.length;
  const revisionCount = state.metrics.revisions ?? state.revisions.length;
  const eventCount = state.metrics.events ?? state.events.length;
  const activeCount = state.metrics.active ?? state.beliefs.filter((belief) => belief.status !== "dormant").length;
  const dormantCount = state.metrics.dormant ?? state.beliefs.filter((belief) => belief.status === "dormant").length;
  const contradictionCount = state.metrics.contradictions ?? 0;
  const provenance = Math.round((state.metrics.provenance_completeness ?? 0) * 100);
  const latestEvent = state.events.at(-1);

  elements.beliefCount.textContent = beliefCount;
  elements.activeDormantLine.textContent = `${activeCount} active / ${dormantCount} dormant`;
  elements.revisionCount.textContent = revisionCount;
  elements.contradictionCount.textContent = `${contradictionCount} contradictions`;
  elements.eventCount.textContent = eventCount;
  elements.latestEventLine.textContent = latestEvent ? `${latestEvent.type} / ${formatTime(latestEvent.created_at)}` : "no events";
  elements.provenanceScore.textContent = `${provenance}%`;
  elements.revisionLine.textContent = `${online ? "live" : "preview"} / ${beliefCount} beliefs / ${revisionCount} revisions`;
  elements.streamHealth.textContent = eventCount ? "streaming" : "quiet";
  elements.memoryPressure.textContent = memoryPressureLabel(beliefCount, revisionCount, dormantCount, contradictionCount);

  renderHealth();
  renderEventRhythm();
  renderEvents();
  renderBeliefTable();
  renderLatestRevision();
  renderInspector();
}

function memoryPressureLabel(beliefs, revisions, dormant, contradictions) {
  if (!beliefs) {
    return "awaiting telemetry";
  }
  if (contradictions > 0) {
    return `${contradictions} conflict signals`;
  }
  if (dormant > 0) {
    return `${dormant} dormant traces`;
  }
  if (revisions > 0) {
    return `${revisions} clean revisions`;
  }
  return "stable memory state";
}

function renderHealth() {
  const beliefCount = Math.max(1, state.metrics.beliefs ?? state.beliefs.length);
  const activeCount = state.metrics.active ?? state.beliefs.filter((belief) => belief.status !== "dormant").length;
  const dormantCount = state.metrics.dormant ?? state.beliefs.filter((belief) => belief.status === "dormant").length;
  const contradictionCount = state.metrics.contradictions ?? 0;
  const coverage = Math.round((state.metrics.provenance_completeness ?? 0) * 100);
  const drift = Math.min(100, Math.round((contradictionCount / beliefCount) * 52 + (dormantCount / beliefCount) * 38));
  const freshness = Math.round((activeCount / beliefCount) * 100);
  const integrity = Math.max(0, Math.min(100, Math.round(coverage * 0.52 + freshness * 0.28 + (100 - drift) * 0.2)));

  elements.integrityScore.textContent = `${integrity}%`;
  elements.driftScore.textContent = `${drift}%`;
  elements.coverageScore.textContent = `${coverage}%`;
  elements.integrityBar.style.width = `${integrity}%`;
  elements.driftBar.style.width = `${drift}%`;
  elements.coverageBar.style.width = `${coverage}%`;
  elements.healthVerdict.textContent = integrity >= 84 ? "healthy" : integrity >= 62 ? "watch" : "unstable";
}

function renderEventRhythm() {
  const recentEvents = state.events.slice(-24);
  elements.eventRhythmLabel.textContent = recentEvents.length ? `${recentEvents.length} recent signals` : "quiet";
  if (!recentEvents.length) {
    elements.eventRhythm.replaceChildren(
      ...Array.from({ length: 24 }, () => {
        const bar = document.createElement("span");
        bar.className = "event-bar";
        bar.style.setProperty("--bar-height", "0.36rem");
        bar.style.setProperty("--bar-opacity", "0.18");
        return bar;
      }),
    );
    return;
  }

  elements.eventRhythm.replaceChildren(
    ...recentEvents.map((event, index) => {
      const bar = document.createElement("span");
      const life = normalizeLife(event.type);
      const height = 0.48 + ((index % 5) + 1) * 0.24 + (life === "contradiction" ? 0.5 : 0);
      bar.className = "event-bar";
      bar.title = `${event.type}: ${event.message}`;
      bar.style.setProperty("--bar-color", COLORS[life] ?? COLORS.active);
      bar.style.setProperty("--bar-height", `${height.toFixed(2)}rem`);
      bar.style.setProperty("--bar-opacity", life === "dormant" ? "0.46" : "0.82");
      return bar;
    }),
  );
}

function renderEvents() {
  if (!state.events.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No ledger events.";
    elements.eventList.replaceChildren(empty);
    return;
  }

  elements.eventList.replaceChildren(
    ...state.events.slice(-18).reverse().map((event) => {
      const item = document.createElement("li");
      item.dataset.life = normalizeLife(event.type);

      const dot = document.createElement("span");
      dot.className = `row-life ${normalizeLife(event.type)}`;

      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = event.type.replace(/-/g, " ");
      const message = document.createElement("span");
      message.textContent = event.message;
      const time = document.createElement("time");
      time.dateTime = event.created_at ?? "";
      time.textContent = formatTime(event.created_at);

      content.append(title, message, time);
      item.append(dot, content);
      return item;
    }),
  );
}

function renderBeliefTable() {
  const filteredBeliefs = state.beliefs.filter(beliefMatchesFilter);
  elements.beliefTableMeta.textContent = `${filteredBeliefs.length}/${state.beliefs.length} records`;

  if (!state.beliefs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No beliefs indexed.";
    elements.beliefTable.replaceChildren(empty);
    return;
  }

  if (!filteredBeliefs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No beliefs match this filter.";
    elements.beliefTable.replaceChildren(empty);
    return;
  }

  elements.beliefTable.replaceChildren(
    ...filteredBeliefs.map((belief) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `belief-row${belief.id === selectedId ? " is-selected" : ""}`;
      row.dataset.life = belief.status;
      row.addEventListener("click", () => {
        selectedId = belief.id;
        observatory?.syncState(state, activeFilter, selectedId);
        renderBeliefTable();
        renderInspector();
      });

      const dot = document.createElement("span");
      dot.className = `row-life ${belief.status}`;

      const main = document.createElement("span");
      main.className = "belief-row-main";
      main.innerHTML = `<strong>${escapeHtml(belief.label)}</strong><span>${escapeHtml(belief.subject)}</span>`;

      const value = document.createElement("span");
      value.className = "belief-row-value";
      value.innerHTML = `<strong>${escapeHtml(belief.value)}</strong><span>${escapeHtml(belief.source)}</span>`;

      const score = document.createElement("span");
      score.className = "belief-row-score";
      score.textContent = `${Math.round(belief.confidence * 100)}%`;

      row.append(dot, main, value, score);
      return row;
    }),
  );
}

function beliefMatchesFilter(belief) {
  if (activeFilter === "all") {
    return true;
  }
  if (activeFilter === "active") {
    return belief.status === "active" || belief.status === "restored";
  }
  return belief.status === activeFilter;
}

function renderLatestRevision() {
  const revision = state.revisions.at(-1);
  if (!revision) {
    elements.latestRevision.textContent = "No revisions recorded.";
    return;
  }

  const belief = state.beliefs.find((item) => item.id === revision.belief_id);
  elements.latestRevision.dataset.life = normalizeLife(revision.trigger);
  elements.latestRevision.innerHTML = `
    <strong>${escapeHtml(belief?.label ?? "Belief")}</strong><br />
    ${escapeHtml(revision.from_value || "none")} -> ${escapeHtml(revision.to_value || "none")}<br />
    <span class="muted">${escapeHtml(revision.trigger)} / ${escapeHtml(revision.evidence_ref)} / ${formatTime(revision.timestamp)}</span>
  `;
}

function renderInspector() {
  const selected = state.beliefs.find((belief) => belief.id === selectedId);
  if (!selected) {
    elements.selectedMemory.removeAttribute("data-life");
    elements.selectedMemory.innerHTML = '<span class="muted">No belief selected</span>';
    return;
  }

  elements.selectedMemory.dataset.life = selected.status;
  elements.selectedMemory.innerHTML = `
    <strong>${escapeHtml(selected.label)}: ${escapeHtml(selected.value)}</strong>
    <span class="muted">${escapeHtml(selected.status)} / ${escapeHtml(selected.source)} / confidence ${Math.round(selected.confidence * 100)}%</span>
    <dl>
      <div><dt>subject</dt><dd>${escapeHtml(selected.subject)}</dd></div>
      <div><dt>reinforced</dt><dd>${escapeHtml(selected.reinforcement_count)}</dd></div>
      <div><dt>contested</dt><dd>${selected.contested ? "yes" : "no"}</dd></div>
      <div><dt>updated</dt><dd>${formatTime(selected.updated_at)}</dd></div>
    </dl>
  `;
}

function formatQueryResult(payload) {
  if (payload?.queries && typeof payload.queries === "object") {
    return Object.entries(payload.queries)
      .map(([name, result]) => `${titleCase(name)}: ${sanitizeDisplay(result?.answer ?? JSON.stringify(result, null, 2))}`)
      .join("\n");
  }
  if (payload?.answer) {
    return sanitizeDisplay(payload.answer);
  }
  return sanitizeDisplay(JSON.stringify(payload, null, 2));
}

function titleCase(value) {
  return String(value)
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value) {
  if (!value) {
    return "no timestamp";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return sanitizeDisplay(String(value));
  }
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function positionNodes() {
  if (!observatory) {
    nodes = [];
    return;
  }
  observatory.syncState(state, activeFilter, selectedId);
}

function resizeCanvas() {
  observatory?.resize();
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

class MemoryObservatory {
  constructor(canvas) {
    if (!window.THREE) {
      throw new Error("Three.js unavailable");
    }
    this.THREE = window.THREE;
    this.canvas = canvas;
    this.sceneMode = document.querySelector("#sceneMode");
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    this.scene = new this.THREE.Scene();
    this.scene.fog = new this.THREE.FogExp2(0x070a0f, 0.028);
    this.camera = new this.THREE.PerspectiveCamera(46, 1, 0.1, 1000);
    this.camera.position.set(0, 2.4, 9.2);
    this.renderer = new this.THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));

    this.clock = new this.THREE.Clock();
    this.raycaster = new this.THREE.Raycaster();
    this.pointer = new this.THREE.Vector2();
    this.root = new this.THREE.Group();
    this.scene.add(this.root);
    this.surfaceLayer = new this.THREE.Group();
    this.nodeLayer = new this.THREE.Group();
    this.linkLayer = new this.THREE.Group();
    this.pulseLayer = new this.THREE.Group();
    this.root.add(this.surfaceLayer, this.linkLayer, this.nodeLayer, this.pulseLayer);

    this.nodesById = new Map();
    this.links = new Map();
    this.pulses = [];
    this.lastEventIds = new Set();
    this.selectable = [];
    this.dragging = false;
    this.dragStart = { x: 0, y: 0, rx: 0, ry: 0 };
    this.targetRotation = { x: -0.2, y: 0.08 };
    this.rotation = { x: -0.2, y: 0.08 };
    this.frame = 0;

    this.materials = this.buildMaterials();
    this.geometries = this.buildGeometries();
    this.buildLights();
    this.buildCore();
    this.buildReferenceGrid();
    this.bindPointer();
    this.resize();
    this.animate();
  }

  buildMaterials() {
    const materials = {};
    Object.entries(COLORS).forEach(([life, color]) => {
      const isDormant = life === "dormant";
      const isConflict = life === "contradiction";
      materials[life] = new this.THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: isDormant ? 0.25 : isConflict ? 0.95 : 0.62,
        roughness: 0.36,
        metalness: 0.1,
        transparent: true,
        opacity: isDormant ? 0.55 : 1,
      });
    });
    materials.core = new this.THREE.MeshStandardMaterial({
      color: "#cfeee6",
      emissive: "#5ed7bd",
      emissiveIntensity: 0.45,
      roughness: 0.42,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
    });
    materials.halo = new this.THREE.MeshBasicMaterial({
      color: "#5ed7bd",
      transparent: true,
      opacity: 0.14,
      side: this.THREE.DoubleSide,
    });
    materials.surface = new this.THREE.MeshBasicMaterial({
      color: "#19222d",
      transparent: true,
      opacity: 0.32,
      side: this.THREE.DoubleSide,
      depthWrite: false,
    });
    materials.lane = new this.THREE.LineBasicMaterial({
      color: "#9aa8bd",
      transparent: true,
      opacity: 0.18,
    });
    return materials;
  }

  buildGeometries() {
    return {
      node: new this.THREE.IcosahedronGeometry(0.3, 1),
      core: new this.THREE.IcosahedronGeometry(1.0, 2),
      halo: new this.THREE.RingGeometry(0.42, 0.54, 56),
      substrate: new this.THREE.PlaneGeometry(9.7, 6.1),
      pulse: new this.THREE.SphereGeometry(0.09, 12, 12),
    };
  }

  buildLights() {
    this.scene.add(new this.THREE.AmbientLight(0xaab6c7, 0.72));
    const key = new this.THREE.DirectionalLight(0xe8f0fb, 0.82);
    key.position.set(-4, 7, 6);
    const rim = new this.THREE.PointLight(0x85a8e6, 0.72, 28);
    rim.position.set(5, 3, 7);
    const heat = new this.THREE.PointLight(0x5ed7bd, 0.54, 24);
    heat.position.set(-2, 2, -6);
    this.scene.add(key, rim, heat);
  }

  buildCore() {
    // The "mind core" — a glowing central node the beliefs orbit and link to.
    this.core = new this.THREE.Mesh(this.geometries.core, this.materials.core);
    this.root.add(this.core);

    const wire = new this.THREE.LineSegments(
      new this.THREE.EdgesGeometry(this.geometries.core),
      new this.THREE.LineBasicMaterial({ color: "#9df3e2", transparent: true, opacity: 0.34 }),
    );
    this.core.add(wire);
    this.coreEdges = wire;

    const glow = new this.THREE.Mesh(
      new this.THREE.SphereGeometry(1.72, 32, 32),
      new this.THREE.MeshBasicMaterial({
        color: "#5ed7bd",
        transparent: true,
        opacity: 0.07,
        side: this.THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.root.add(glow);
    this.coreGlow = glow;
  }

  buildReferenceGrid() {
    // Starfield backdrop — the stage should read as a memory cortex, never an
    // empty void, even with only a few beliefs on screen.
    const count = 560;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const r = 15 + Math.random() * 34;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 8;
    }
    const geo = new this.THREE.BufferGeometry();
    geo.setAttribute("position", new this.THREE.BufferAttribute(positions, 3));
    this.stars = new this.THREE.Points(
      geo,
      new this.THREE.PointsMaterial({
        color: "#9fb4d6",
        size: 0.07,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.stars);

    // Two faint orbit rings to ground the constellation without a diagram grid.
    [3.3, 4.6].forEach((radius, index) => {
      const ring = new this.THREE.Mesh(
        new this.THREE.RingGeometry(radius, radius + 0.012, 128),
        new this.THREE.MeshBasicMaterial({
          color: "#3a4a63",
          transparent: true,
          opacity: 0.16 - index * 0.05,
          side: this.THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2.15;
      this.surfaceLayer.add(ring);
    });
  }

  bindPointer() {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.canvas.setPointerCapture?.(event.pointerId);
      this.dragStart = {
        x: event.clientX,
        y: event.clientY,
        rx: this.targetRotation.x,
        ry: this.targetRotation.y,
      };
      this.canvas.classList.add("is-dragging");
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) {
        this.updateHover(event);
        return;
      }
      const dx = (event.clientX - this.dragStart.x) / Math.max(280, this.canvas.clientWidth);
      const dy = (event.clientY - this.dragStart.y) / Math.max(240, this.canvas.clientHeight);
      this.targetRotation.y = this.dragStart.ry + dx * Math.PI * 1.4;
      this.targetRotation.x = clamp(this.dragStart.rx + dy * Math.PI * 0.72, -0.78, 0.48);
    });
    this.canvas.addEventListener("pointerup", (event) => {
      this.dragging = false;
      this.canvas.releasePointerCapture?.(event.pointerId);
      this.canvas.classList.remove("is-dragging");
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.dragging = false;
      this.canvas.classList.remove("is-dragging");
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.camera.position.z = clamp(this.camera.position.z + event.deltaY * 0.008, 5.4, 17);
      },
      { passive: false },
    );
    document.addEventListener("visibilitychange", () => {
      this.hidden = document.hidden;
    });
  }

  syncState(nextState, filter, selected) {
    this.filter = filter;
    this.selectedId = selected;
    const incoming = new Set(nextState.beliefs.map((belief) => belief.id));
    Array.from(this.nodesById.keys()).forEach((id) => {
      if (!incoming.has(id)) {
        this.removeNode(id);
      }
    });

    nextState.beliefs.forEach((belief, index) => {
      const node = this.nodesById.get(belief.id) ?? this.createNode(belief);
      node.userData.belief = belief;
      node.userData.index = index;
      node.userData.target = this.positionForBelief(belief, index, nextState.beliefs.length);
      node.userData.baseScale = 1.05 + belief.confidence * 0.8;
      node.userData.visibleByFilter = beliefMatchesFilter(belief);
      this.paintNode(node, belief);
      this.nodesById.set(belief.id, node);
    });

    this.rebuildLinks(nextState.beliefs);
    this.ingestEventPulses(nextState.events);
    this.applyVisibility();
    if (this.sceneMode) {
      const active = nextState.metrics?.active ?? nextState.beliefs.length;
      this.sceneMode.textContent = `${active} active traces / ${nextState.beliefs.length} total`;
    }
  }

  createNode(belief) {
    const group = new this.THREE.Group();
    const body = new this.THREE.Mesh(this.geometries.node, this.materials[belief.status].clone());
    const halo = new this.THREE.Mesh(this.geometries.halo, this.materials.halo.clone());
    halo.rotation.x = Math.PI / 2;
    body.userData.beliefId = belief.id;
    group.userData.beliefId = belief.id;
    group.add(body, halo);
    group.userData.body = body;
    group.userData.halo = halo;
    group.position.copy(this.positionForBelief(belief, this.nodesById.size, Math.max(1, state.beliefs.length)));
    this.nodeLayer.add(group);
    this.selectable.push(body);
    return group;
  }

  removeNode(id) {
    const node = this.nodesById.get(id);
    if (!node) {
      return;
    }
    this.nodeLayer.remove(node);
    this.selectable = this.selectable.filter((mesh) => mesh.userData.beliefId !== id);
    this.nodesById.delete(id);
    const link = this.links.get(id);
    if (link) {
      this.linkLayer.remove(link);
      link.geometry.dispose();
      link.material.dispose();
      this.links.delete(id);
    }
  }

  paintNode(node, belief) {
    const color = COLORS[belief.status] ?? COLORS.active;
    const body = node.userData.body;
    const halo = node.userData.halo;
    body.material.color.set(color);
    body.material.emissive.set(color);
    body.material.emissiveIntensity = belief.status === "dormant" ? 0.06 : belief.status === "contradiction" ? 0.34 : 0.16;
    body.material.opacity = belief.status === "dormant" ? 0.42 : 0.9;
    halo.material.color.set(color);
    halo.material.opacity = belief.status === "contradiction" ? 0.3 : belief.status === "dormant" ? 0.08 : 0.15;
  }

  positionForBelief(belief, index, total) {
    // Distribute beliefs on a spherical shell around the core (Fibonacci
    // sphere), so even a few nodes form a legible constellation. Confidence
    // pulls a belief inward; dormant beliefs drift to the outer shell.
    const hash = hashString(belief.id || `${belief.label}-${index}`);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const denom = Math.max(1, total - 1);
    const y = total > 1 ? 1 - (index / denom) * 2 : 0;
    const radiusAtY = Math.sqrt(Math.max(0.0001, 1 - y * y));
    const theta = golden * index + hash * 0.0004;
    const shell =
      3.15 + (1 - belief.confidence) * 1.35 + (belief.status === "dormant" ? 1.15 : 0);
    return new this.THREE.Vector3(
      Math.cos(theta) * radiusAtY * shell,
      y * 2.35 + (belief.status === "contradiction" ? 0.32 : 0) + seededNoise(hash + 41, 0.22) - 0.11,
      Math.sin(theta) * radiusAtY * shell,
    );
  }

  rebuildLinks(beliefs) {
    const ids = new Set(beliefs.map((belief) => belief.id));
    Array.from(this.links.keys()).forEach((id) => {
      if (!ids.has(id)) {
        const line = this.links.get(id);
        this.linkLayer.remove(line);
        line.geometry.dispose();
        line.material.dispose();
        this.links.delete(id);
      }
    });

    beliefs.forEach((belief) => {
      if (this.links.has(belief.id)) {
        return;
      }
      const color = COLORS[belief.status] ?? COLORS.active;
      const geometry = new this.THREE.BufferGeometry().setFromPoints([
        new this.THREE.Vector3(0, 0, 0),
        new this.THREE.Vector3(0, 0, 0),
      ]);
      const material = new this.THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: belief.status === "dormant" ? 0.08 : 0.22,
      });
      const line = new this.THREE.Line(geometry, material);
      line.userData.beliefId = belief.id;
      this.links.set(belief.id, line);
      this.linkLayer.add(line);
    });
  }

  ingestEventPulses(events) {
    const recent = events.slice(-10);
    recent.forEach((event, index) => {
      if (this.lastEventIds.has(event.id)) {
        return;
      }
      this.lastEventIds.add(event.id);
      const belief = state.beliefs.find((item) => event.message?.toLowerCase().includes(item.label.toLowerCase())) ?? state.beliefs[index % Math.max(1, state.beliefs.length)];
      const node = belief ? this.nodesById.get(belief.id) : null;
      if (!node) {
        return;
      }
      const life = normalizeLife(event.type);
      const material = new this.THREE.MeshBasicMaterial({
        color: COLORS[life] ?? COLORS.active,
        transparent: true,
        opacity: 0.68,
      });
      const pulse = new this.THREE.Mesh(this.geometries.pulse, material);
      pulse.userData = {
        from: new this.THREE.Vector3(0, 0, 0),
        to: node.position.clone(),
        progress: 0,
        speed: 0.012 + seededNoise(index + this.frame, 0.012),
      };
      this.pulseLayer.add(pulse);
      this.pulses.push(pulse);
    });
    if (this.lastEventIds.size > 80) {
      this.lastEventIds = new Set(Array.from(this.lastEventIds).slice(-40));
    }
  }

  applyVisibility() {
    this.nodesById.forEach((node) => {
      const belief = node.userData.belief;
      const active = beliefMatchesFilter(belief);
      const selected = belief.id === this.selectedId;
      const body = node.userData.body;
      const halo = node.userData.halo;
      body.material.opacity = active ? (belief.status === "dormant" ? 0.42 : 0.9) : 0.12;
      halo.material.opacity = selected ? 0.46 : active ? 0.14 : 0.025;
      node.userData.visibleByFilter = active;
    });
  }

  updateHover(event) {
    const hit = this.pick(event, false);
    this.canvas.classList.toggle("has-hit", Boolean(hit));
  }

  pick(event, commit = true) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.selectable, false);
    const mesh = hits.find((item) => {
      const node = this.nodesById.get(item.object.userData.beliefId);
      return node?.userData.visibleByFilter;
    })?.object;
    const id = mesh?.userData.beliefId ?? null;
    if (commit && id) {
      this.selectedId = id;
      this.applyVisibility();
    }
    return id;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    this.frame += 1;
    if (this.hidden) {
      return;
    }
    const elapsed = this.clock.getElapsedTime();
    const motion = this.reducedMotion ? 0.18 : 1;
    this.rotation.x += (this.targetRotation.x - this.rotation.x) * 0.07;
    this.rotation.y += (this.targetRotation.y - this.rotation.y) * 0.07;
    if (!this.dragging && !this.reducedMotion) {
      this.targetRotation.y += 0.00024;
    }
    this.root.rotation.x = this.rotation.x;
    this.root.rotation.y = this.rotation.y;
    this.core.rotation.y += 0.0016 * motion + 0.0005;
    this.core.rotation.x = Math.sin(elapsed * 0.3) * 0.08 * motion;
    this.core.scale.setScalar(1 + Math.sin(elapsed * 1.1) * 0.03 * motion);
    if (this.coreGlow) {
      this.coreGlow.scale.setScalar(1 + Math.sin(elapsed * 0.9) * 0.05 * motion);
    }
    if (this.stars) {
      this.stars.rotation.y += 0.0002;
    }

    this.nodesById.forEach((node) => {
      const belief = node.userData.belief;
      const target = node.userData.target;
      const selected = belief.id === this.selectedId;
      node.position.lerp(target, 0.08);
      node.rotation.y = Math.sin(elapsed * 0.7 + node.userData.index) * 0.06 * motion;
      node.rotation.x = 0;
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(elapsed * 1.25 + node.userData.index) * 0.018;
      const base = node.userData.baseScale * (selected ? 1.42 : 1);
      const filteredScale = node.userData.visibleByFilter ? 1 : 0.72;
      node.scale.setScalar(base * pulse * filteredScale);
      node.userData.halo.rotation.z += 0.003 * motion;
    });

    this.links.forEach((line, id) => {
      const node = this.nodesById.get(id);
      if (!node) {
        return;
      }
      const points = [
        new this.THREE.Vector3(0, 0, 0),
        node.position.clone().multiplyScalar(0.54).add(new this.THREE.Vector3(0, Math.sin(elapsed * 0.6 + node.userData.index) * 0.12, 0)),
        node.position.clone(),
      ];
      line.geometry.setFromPoints(points);
      const belief = node.userData.belief;
      line.material.color.set(COLORS[belief.status] ?? COLORS.active);
      line.material.opacity = node.userData.visibleByFilter ? (belief.status === "dormant" ? 0.08 : 0.22) : 0.025;
    });

    this.animatePulses();
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    window.__ENGRAM_3D_DEBUG__ = {
      frame: this.frame,
      nodes: this.nodesById.size,
      pulses: this.pulses.length,
      rotationY: Number(this.root.rotation.y.toFixed(4)),
      webgl: Boolean(this.renderer.getContext()),
    };
  };

  animatePulses() {
    this.pulses = this.pulses.filter((pulse) => {
      pulse.userData.progress += this.reducedMotion ? 0.018 : pulse.userData.speed;
      const progress = Math.min(1, pulse.userData.progress);
      pulse.position.lerpVectors(pulse.userData.from, pulse.userData.to, progress);
      pulse.position.y += Math.sin(progress * Math.PI) * 0.18;
      pulse.scale.setScalar(0.9 + Math.sin(progress * Math.PI) * 1.25);
      pulse.material.opacity = Math.max(0, 0.68 - progress * 0.68);
      if (progress >= 1) {
        this.pulseLayer.remove(pulse);
        pulse.material.dispose();
        return false;
      }
      return true;
    });
  }
}

function initializeObservatory() {
  try {
    observatory = new MemoryObservatory(elements.canvas);
  } catch (error) {
    observatory = null;
    elements.memoryPressure.textContent = "3D engine unavailable";
    elements.canvas.classList.add("scene-unavailable");
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < String(value).length; i += 1) {
    hash ^= String(value).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function seededNoise(seed, range = 1) {
  const x = Math.sin(Number(seed) * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * range;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

elements.ingestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.memoryText.value.trim();
  const source = elements.sourceText.value.trim() || "operator";
  try {
    await mutate("/api/ingest", { text, source });
    elements.memoryText.value = "";
  } catch (error) {
    elements.queryResult.textContent = "No backend response.";
  }
});

elements.queryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.queryText.value.trim();
  try {
    const payload = await mutate("/api/query", { text });
    elements.queryResult.textContent = formatQueryResult(payload);
  } catch (error) {
    elements.queryResult.textContent = "No backend response.";
  }
});

elements.decayForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await mutate("/api/decay", { days: Number(elements.decayDays.value) || 30 });
    elements.queryResult.textContent = `Decay applied: ${payload?.days ?? elements.decayDays.value} days`;
  } catch (error) {
    elements.queryResult.textContent = "No backend response.";
  }
});

elements.runDemo.addEventListener("click", async () => {
  try {
    const payload = await mutate("/api/demo/run", {});
    elements.queryResult.textContent = payload?.queries ? formatQueryResult(payload) : "Demo run complete.";
  } catch (error) {
    elements.queryResult.textContent = "No backend response.";
  }
});

elements.resetDemo.addEventListener("click", async () => {
  try {
    await mutate("/api/demo/reset", {});
    selectedId = null;
    positionNodes();
    renderState();
    elements.queryResult.textContent = "No query result.";
  } catch (error) {
    elements.queryResult.textContent = "No backend response.";
  }
});

elements.canvas.addEventListener("click", (event) => {
  selectedId = observatory?.pick(event, true) ?? null;
  observatory?.syncState(state, activeFilter, selectedId);
  renderBeliefTable();
  renderInspector();
});

elements.beliefFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) {
    return;
  }
  activeFilter = button.dataset.filter;
  elements.beliefFilters.querySelectorAll("button").forEach((item) => {
    item.classList.toggle("is-active", item === button);
  });
  if (selectedId && !state.beliefs.some((belief) => belief.id === selectedId && beliefMatchesFilter(belief))) {
    selectedId = null;
  }
  positionNodes();
  renderBeliefTable();
  renderInspector();
});

window.addEventListener("resize", resizeCanvas);

initializeObservatory();
resizeCanvas();
refreshState();

// Keep the observatory live: re-pull ledger state on an interval so the map
// reflects external writes (agents, other tabs) without a manual refresh.
// Pause while the tab is hidden to avoid needless work.
setInterval(() => {
  if (!document.hidden) {
    refreshState();
  }
}, 4000);
