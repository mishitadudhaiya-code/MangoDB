/**
 * public/app.js — BugBound Frontend Application Controller
 * Handles graph rendering (Cytoscape.js), what-if simulation animations,
 * history comparison, MongoDB analytics (Chart.js), and live SSE stream.
 */

// Application State
const state = {
  currentProject: null,
  currentVersion: null,
  graphData: null,
  lastSimulation: null,
  selectedHistory: new Set(),
  cy: null,
  chart: null,
  eventSource: null
};

// Component Type to Cytoscape Shape Mapping
const TYPE_SHAPES = {
  field: 'round-rectangle',
  table: 'rectangle',
  api: 'diamond',
  function: 'ellipse',
  page: 'hexagon',
  service: 'barrel',
  config: 'rectangle',
  package: 'octagon'
};

// Target Type compatibility for Change Types
const COMPATIBLE_TYPES = {
  RENAME_FIELD: ['field', 'api'],
  DELETE_FIELD: ['field'],
  CHANGE_FIELD_TYPE: ['field'],
  DELETE_ENDPOINT: ['api'],
  CHANGE_FUNCTION_SIGNATURE: ['function'],
  CHANGE_CONFIG: ['config'],
  UPGRADE_DEPENDENCY_MAJOR: ['package']
};

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', async () => {
  initCytoscape();
  setupEventListeners();
  setupDynamicParams();
  initSSE();
  await checkHealth();
  await loadProjects();
});

/**
 * Health check ping to server & MongoDB Atlas
 */
async function checkHealth() {
  const pill = document.getElementById('db-status-pill');
  const text = document.getElementById('db-status-text');
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.db === 'up') {
      pill.innerHTML = '<span class="dot dot-green"></span><span>Atlas Connected</span>';
    } else {
      pill.innerHTML = '<span class="dot dot-yellow"></span><span>DB Offline</span>';
    }
  } catch (err) {
    pill.innerHTML = '<span class="dot dot-red"></span><span>Server Down</span>';
  }
}

/**
 * Initialize Server-Sent Events (SSE) live feed
 */
function initSSE() {
  const list = document.getElementById('events-stream-list');
  const streamText = document.getElementById('stream-status-text');

  try {
    state.eventSource = new EventSource('/api/stream');

    state.eventSource.onopen = () => {
      streamText.textContent = 'Live SSE Connected';
      const indicator = document.querySelector('#stream-status-pill .dot');
      if (indicator) indicator.className = 'dot dot-green';
    };

    state.eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        addEventToFeed(event, true);
      } catch (_err) {
        // SSE comments / heartbeats
      }
    };

    state.eventSource.onerror = () => {
      streamText.textContent = 'Reconnecting...';
      const indicator = document.querySelector('#stream-status-pill .dot');
      if (indicator) indicator.className = 'dot dot-yellow';
    };
  } catch (err) {
    console.warn('SSE not supported or connection error:', err);
  }
}

/**
 * Prepend an event item to the Live Feed
 */
function addEventToFeed(ev, isLive = false) {
  const list = document.getElementById('events-stream-list');
  if (list.children.length === 1 && list.children[0].textContent.includes('Connecting')) {
    list.innerHTML = '';
  }

  const item = document.createElement('div');
  item.className = `event-item status-${ev.status || 'ok'}`;

  const timeStr = new Date(ev.at || Date.now()).toLocaleTimeString();
  const detailsStr = ev.details ? JSON.stringify(ev.details) : '';

  item.innerHTML = `
    <div class="event-header">
      <span>${ev.projectId || 'system'}</span>
      <span>${timeStr} ${isLive ? '• live' : ''}</span>
    </div>
    <div class="event-type">${ev.type}</div>
    ${detailsStr ? `<div style="color:var(--text-secondary);font-size:0.68rem;word-break:break-all;">${detailsStr.substring(0, 100)}</div>` : ''}
  `;

  list.insertBefore(item, list.firstChild);

  // Keep max 30 items in the DOM
  while (list.children.length > 30) {
    list.removeChild(list.lastChild);
  }
}

// ==================== Cytoscape Graph Setup ====================

function initCytoscape() {
  state.cy = cytoscape({
    container: document.getElementById('cy'),
    boxSelectionEnabled: false,
    autounselectify: false,
    style: [
      // Core node styles
      {
        selector: 'node',
        style: {
          'label': 'data(name)',
          'shape': 'data(shape)',
          'background-color': '#1e293b',
          'border-width': 2,
          'border-color': '#475569',
          'color': '#f8fafc',
          'font-family': 'Inter, sans-serif',
          'font-size': '11px',
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 'label',
          'height': '36px',
          'padding': '12px',
          'text-wrap': 'wrap',
          'text-max-width': '120px',
          'transition-property': 'background-color, border-color, opacity, border-width',
          'transition-duration': '0.3s'
        }
      },
      // Edge styles (from depends on to: consumer -> provider)
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': '#475569',
          'target-arrow-color': '#475569',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 1.1,
          'transition-property': 'line-color, target-arrow-color, width',
          'transition-duration': '0.3s'
        }
      },
      // Dynamic edges (dashed)
      {
        selector: 'edge[?dynamic]',
        style: {
          'line-style': 'dashed',
          'line-dash-pattern': [6, 3],
          'line-color': '#eab308',
          'target-arrow-color': '#eab308'
        }
      },
      // Target changed node (Blue glow)
      {
        selector: 'node.status-target',
        style: {
          'background-color': '#1d4ed8',
          'border-color': '#38bdf8',
          'border-width': 4,
          'color': '#ffffff'
        }
      },
      // BROKEN status (Red)
      {
        selector: 'node.status-BROKEN',
        style: {
          'background-color': '#991b1b',
          'border-color': '#ef4444',
          'border-width': 3,
          'color': '#ffffff'
        }
      },
      // AT_RISK status (Orange)
      {
        selector: 'node.status-AT_RISK',
        style: {
          'background-color': '#9a3412',
          'border-color': '#f97316',
          'border-width': 3,
          'color': '#ffffff'
        }
      },
      // UNCERTAIN status (Yellow dashed border)
      {
        selector: 'node.status-UNCERTAIN',
        style: {
          'background-color': '#854d0e',
          'border-color': '#facc15',
          'border-width': 3,
          'border-style': 'dashed',
          'color': '#ffffff'
        }
      },
      // SAFE status (Dimmed Green)
      {
        selector: 'node.status-SAFE',
        style: {
          'background-color': '#064e3b',
          'border-color': '#10b981',
          'opacity': 0.45
        }
      },
      // Highlighted path edges
      {
        selector: 'edge.highlighted-path',
        style: {
          'line-color': '#ef4444',
          'target-arrow-color': '#ef4444',
          'width': 4
        }
      }
    ]
  });

  // Node Click: Open details flyout
  state.cy.on('tap', 'node', (evt) => {
    const node = evt.target;
    showNodeFlyout(node.data());
  });

  // Background Click: Close flyout
  state.cy.on('tap', (evt) => {
    if (evt.target === state.cy) {
      document.getElementById('node-flyout').style.display = 'none';
    }
  });
}

/**
 * Show node details in the floating flyout card
 */
function showNodeFlyout(nodeData) {
  const flyout = document.getElementById('node-flyout');
  document.getElementById('flyout-title').textContent = nodeData.name || nodeData.id;
  document.getElementById('flyout-type').textContent = `Type: ${nodeData.type || 'unknown'} • ID: ${nodeData.id}`;
  document.getElementById('flyout-criticality').textContent = `Criticality: ${'★'.repeat(nodeData.criticality || 3)}${'☆'.repeat(5 - (nodeData.criticality || 3))}`;

  const statusBlock = document.getElementById('flyout-status-block');
  if (nodeData.simulationStatus) {
    statusBlock.style.display = 'block';
    const stEl = document.getElementById('flyout-status');
    stEl.textContent = `Status: ${nodeData.simulationStatus} (Depth ${nodeData.simulationDepth || 1})`;
    stEl.style.color = nodeData.simulationStatus === 'BROKEN' ? '#ef4444' :
                       nodeData.simulationStatus === 'AT_RISK' ? '#f97316' :
                       nodeData.simulationStatus === 'UNCERTAIN' ? '#eab308' : '#10b981';

    document.getElementById('flyout-reason').textContent = nodeData.simulationReason || 'Affected by dependency chain';
    document.getElementById('flyout-recommendation').textContent = `Action: ${nodeData.simulationRecommendation || 'Review component'}`;
  } else {
    statusBlock.style.display = 'none';
  }

  flyout.style.display = 'block';
}

// ==================== Data Loading ====================

/**
 * Load project list from /api/projects
 */
async function loadProjects(selectId = null) {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    const sel = document.getElementById('project-select');

    sel.innerHTML = '<option value="">Select a project...</option>';
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p._id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }

    if (selectId) {
      sel.value = selectId;
      await onProjectChange(selectId);
    } else if (projects.length > 0) {
      sel.value = projects[0]._id;
      await onProjectChange(projects[0]._id);
    }
  } catch (err) {
    showToast('Failed to load projects: ' + err.message, 'error');
  }
}

/**
 * On Project Selected
 */
async function onProjectChange(projectId) {
  state.currentProject = projectId;
  if (!projectId) return;

  await loadVersions(projectId);
  await loadHistory(projectId);
  await loadEvents(projectId);
  await loadAnalytics(projectId);
}

/**
 * Load versions for the current project
 */
async function loadVersions(projectId, selectVid = null) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/versions`);
    const versions = await res.json();
    const sel = document.getElementById('version-select');

    sel.innerHTML = '';
    if (versions.length === 0) {
      sel.innerHTML = '<option value="">No versions uploaded yet</option>';
      state.cy.elements().remove();
      return;
    }

    for (const v of versions) {
      const opt = document.createElement('option');
      opt.value = v._id;
      const dateStr = new Date(v.createdAt).toLocaleDateString();
      opt.textContent = `v${v.version} (${v.componentCount} components, ${v.edgeCount} edges) — ${dateStr}`;
      sel.appendChild(opt);
    }

    const vidToLoad = selectVid || versions[0]._id;
    sel.value = vidToLoad;
    await onVersionChange(vidToLoad);
  } catch (err) {
    showToast('Failed to load versions: ' + err.message, 'error');
  }
}

/**
 * On Version Selected: Fetch Graph and Render
 */
async function onVersionChange(versionId) {
  state.currentVersion = versionId;
  if (!versionId) return;

  try {
    const res = await fetch(`/api/versions/${encodeURIComponent(versionId)}/graph`);
    if (!res.ok) throw new Error('Failed to fetch graph data');
    const data = await res.json();

    state.graphData = data;
    renderGraph(data);
    updateTargetOptions(data.components);
  } catch (err) {
    showToast('Graph loading error: ' + err.message, 'error');
  }
}

/**
 * Render Cytoscape Graph with elements and layout
 */
function renderGraph(data) {
  if (!state.cy) return;

  const elements = [];

  // Add Nodes
  for (const c of data.components) {
    const compId = c.componentId || c.id;
    elements.push({
      group: 'nodes',
      data: {
        id: compId,
        name: c.name || compId,
        type: c.type || 'service',
        criticality: c.criticality || 3,
        shape: TYPE_SHAPES[c.type] || 'round-rectangle'
      }
    });
  }

  // Add Edges (from consumer to provider)
  for (const e of data.edges) {
    elements.push({
      group: 'edges',
      data: {
        id: `${e.from}>${e.kind}>${e.to}`,
        source: e.from,
        target: e.to,
        kind: e.kind,
        dynamic: !!e.dynamic
      }
    });
  }

  state.cy.elements().remove();
  state.cy.add(elements);

  applyLayout();
}

/**
 * Apply layout (CoSE or Breadthfirst)
 */
function applyLayout() {
  const layoutName = document.getElementById('layout-select').value || 'cose';

  const layout = state.cy.layout({
    name: layoutName,
    animate: true,
    animationDuration: 600,
    fit: true,
    padding: 40,
    nodeDimensionsIncludeLabels: true
  });

  layout.run();
}

/**
 * Filter and update target options dropdown based on compatible component types
 */
function updateTargetOptions(components) {
  const changeType = document.getElementById('change-type-select').value;
  const compatible = COMPATIBLE_TYPES[changeType] || [];
  const sel = document.getElementById('target-component-select');

  sel.innerHTML = '';
  const filtered = components.filter(c => compatible.length === 0 || compatible.includes(c.type));

  if (filtered.length === 0) {
    sel.innerHTML = '<option value="">No compatible components in graph</option>';
    return;
  }

  for (const c of filtered) {
    const compId = c.componentId || c.id;
    const opt = document.createElement('option');
    opt.value = compId;
    opt.textContent = `${c.name || compId} (${c.type}) — crit: ${c.criticality || 3}`;
    sel.appendChild(opt);
  }
}

// ==================== Dynamic Form Fields ====================

function setupDynamicParams() {
  const changeTypeSel = document.getElementById('change-type-select');
  changeTypeSel.addEventListener('change', () => {
    renderParamFields(changeTypeSel.value);
    if (state.graphData && state.graphData.components) {
      updateTargetOptions(state.graphData.components);
    }
  });

  renderParamFields(changeTypeSel.value);
}

function renderParamFields(type) {
  const container = document.getElementById('params-container');
  container.innerHTML = '';

  if (type === 'RENAME_FIELD') {
    container.innerHTML = `
      <div class="form-group">
        <label>Current Name ('from')</label>
        <input type="text" id="param-from" placeholder="user_name">
      </div>
      <div class="form-group">
        <label>New Name ('to')</label>
        <input type="text" id="param-to" placeholder="username">
      </div>
    `;
  } else if (type === 'CHANGE_FIELD_TYPE') {
    container.innerHTML = `
      <div class="form-group">
        <label>Current Type ('from')</label>
        <input type="text" id="param-from" placeholder="string">
      </div>
      <div class="form-group">
        <label>New Type ('to')</label>
        <input type="text" id="param-to" placeholder="int">
      </div>
    `;
  } else if (type === 'CHANGE_CONFIG') {
    container.innerHTML = `
      <div class="form-group">
        <label>Config Key</label>
        <input type="text" id="param-key" placeholder="PAYMENT_TIMEOUT">
      </div>
      <div class="form-group">
        <label>Old Value ('from')</label>
        <input type="text" id="param-from" placeholder="30">
      </div>
      <div class="form-group">
        <label>New Value ('to')</label>
        <input type="text" id="param-to" placeholder="5">
      </div>
    `;
  } else if (type === 'UPGRADE_DEPENDENCY_MAJOR') {
    container.innerHTML = `
      <div class="form-group">
        <label>Current Version ('from')</label>
        <input type="text" id="param-from" placeholder="1.x">
      </div>
      <div class="form-group">
        <label>Target Version ('to')</label>
        <input type="text" id="param-to" placeholder="2.x">
      </div>
    `;
  } else if (type === 'CHANGE_FUNCTION_SIGNATURE') {
    container.innerHTML = `
      <div class="form-group">
        <label>Description of Change</label>
        <input type="text" id="param-desc" placeholder="added required argument">
      </div>
    `;
  }
}

// ==================== Simulation Runner & Animation ====================

/**
 * Execute What-If simulation against current version
 */
async function runSimulation() {
  if (!state.currentVersion) {
    showToast('Please select a graph version first.', 'error');
    return;
  }

  const type = document.getElementById('change-type-select').value;
  const targetId = document.getElementById('target-component-select').value;

  if (!targetId) {
    showToast('Please select a target component.', 'error');
    return;
  }

  // Build params
  const params = {};
  const fromEl = document.getElementById('param-from');
  const toEl = document.getElementById('param-to');
  const keyEl = document.getElementById('param-key');
  const descEl = document.getElementById('param-desc');

  if (fromEl) params.from = fromEl.value.trim();
  if (toEl) params.to = toEl.value.trim();
  if (keyEl) params.key = keyEl.value.trim();
  if (descEl) params.description = descEl.value.trim();

  const btn = document.getElementById('btn-simulate');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Simulating Impact...';

  try {
    const res = await fetch(`/api/versions/${encodeURIComponent(state.currentVersion)}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, targetId, params })
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data.reasons ? data.reasons.join(', ') : (data.error || 'Simulation failed');
      throw new Error(msg);
    }

    state.lastSimulation = data;

    // Display report
    renderReport(data);

    // Switch to Report tab
    switchTab('tab-report');

    // Animate Chain Reaction in Cytoscape!
    animateChainReaction(targetId, data.affected, data.chains);

    // Refresh history & analytics
    if (state.currentProject) {
      loadHistory(state.currentProject);
      loadAnalytics(state.currentProject);
    }

    showToast(data.status === 'cached' ? '⚡ Cached result returned (idempotent)' : 'Simulation completed successfully!', 'success');
  } catch (err) {
    showToast('Simulation error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🚀</span> Run Impact Simulation';
  }
}

/**
 * Animate the chain reaction level-by-level (depth 1, then depth 2, etc.)
 */
function animateChainReaction(targetId, affected, chains) {
  if (!state.cy) return;

  // Reset node classes
  state.cy.nodes().removeClass('status-target status-BROKEN status-AT_RISK status-UNCERTAIN status-SAFE');
  state.cy.edges().removeClass('highlighted-path');

  // Mark all unreached nodes as SAFE (dimmed green)
  state.cy.nodes().addClass('status-SAFE');

  // Highlight target node
  const targetNode = state.cy.getElementById(targetId);
  if (targetNode) {
    targetNode.removeClass('status-SAFE').addClass('status-target');
  }

  // Group affected by depth
  const byDepth = new Map();
  for (const a of affected) {
    const d = a.depth || 1;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(a);
  }

  // Animation banner
  const banner = document.getElementById('animation-banner');
  const stageText = document.getElementById('anim-stage-text');
  banner.style.display = 'flex';

  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  let step = 0;

  function revealNextDepth() {
    if (step >= depths.length) {
      stageText.textContent = `Completed: ${affected.length} components affected.`;
      setTimeout(() => { banner.style.display = 'none'; }, 2000);
      document.getElementById('btn-replay-anim').style.display = 'inline-flex';
      return;
    }

    const d = depths[step];
    const items = byDepth.get(d);
    stageText.textContent = `Propagating Depth ${d}: ${items.length} component(s) impacted...`;

    for (const a of items) {
      const node = state.cy.getElementById(a.componentId);
      if (node && node.length > 0) {
        node.removeClass('status-SAFE');
        node.addClass(`status-${a.status}`);

        // Attach simulation details to node data for click flyout
        node.data({
          simulationStatus: a.status,
          simulationDepth: a.depth,
          simulationReason: a.reason,
          simulationRecommendation: a.recommendation
        });
      }

      // Highlight path edges leading to this component
      if (a.path && a.path.length >= 2) {
        for (let i = 0; i < a.path.length - 1; i++) {
          const from = a.path[i];
          const to = a.path[i + 1];
          state.cy.edges(`[source = "${to}"][target = "${from}"]`).addClass('highlighted-path');
        }
      }
    }

    step++;
    setTimeout(revealNextDepth, 600);
  }

  revealNextDepth();
}

/**
 * Render Report Tab
 */
function renderReport(sim) {
  const scoreEl = document.getElementById('gauge-score');
  const labelEl = document.getElementById('gauge-label');
  const cachedBadge = document.getElementById('cached-badge');

  scoreEl.textContent = sim.score;
  scoreEl.className = 'gauge-score-display ' +
    (sim.score >= 75 ? 'score-critical' :
     sim.score >= 50 ? 'score-high' :
     sim.score >= 25 ? 'score-medium' : 'score-low');

  labelEl.textContent = `${sim.label} IMPACT`;
  labelEl.className = 'gauge-label ' +
    (sim.score >= 75 ? 'badge-critical' :
     sim.score >= 50 ? 'badge-high' :
     sim.score >= 25 ? 'badge-medium' : 'badge-low');

  cachedBadge.style.display = sim.status === 'cached' ? 'inline-block' : 'none';

  // Counts
  document.getElementById('count-broken').textContent = sim.counts?.broken ?? 0;
  document.getElementById('count-at-risk').textContent = sim.counts?.atRisk ?? 0;
  document.getElementById('count-uncertain').textContent = sim.counts?.uncertain ?? 0;
  document.getElementById('count-safe').textContent = sim.counts?.safe ?? 0;

  // Affected list
  const listEl = document.getElementById('affected-list');
  const uncertainSection = document.getElementById('uncertain-section');
  const uncertainListEl = document.getElementById('uncertain-list');

  listEl.innerHTML = '';
  uncertainListEl.innerHTML = '';

  const uncertainItems = (sim.affected || []).filter(a => a.status === 'UNCERTAIN');
  if (uncertainItems.length > 0) {
    uncertainSection.style.display = 'block';
    for (const u of uncertainItems) {
      uncertainListEl.appendChild(createAffectedCard(u));
    }
  } else {
    uncertainSection.style.display = 'none';
  }

  document.getElementById('affected-count-badge').textContent = `${(sim.affected || []).length} found`;

  for (const a of (sim.affected || [])) {
    listEl.appendChild(createAffectedCard(a));
  }
}

function createAffectedCard(item) {
  const card = document.createElement('div');
  card.className = `affected-item ${item.status}`;
  card.innerHTML = `
    <div class="affected-header">
      <span class="affected-name">${item.name || item.componentId}</span>
      <span class="affected-status-badge badge-${item.status === 'BROKEN' ? 'critical' : item.status === 'AT_RISK' ? 'high' : 'medium'}">${item.status} (d:${item.depth})</span>
    </div>
    <div class="affected-reason">${item.reason || 'Impacted via dependency propagation'}</div>
    <div class="affected-rec">💡 <strong>Action:</strong> ${item.recommendation || 'Verify behavior'}</div>
    ${item.path ? `<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);margin-top:0.3rem;">Path: ${item.path.join(' → ')}</div>` : ''}
  `;

  card.addEventListener('click', () => {
    if (state.cy) {
      const node = state.cy.getElementById(item.componentId);
      if (node && node.length > 0) {
        state.cy.animate({ center: { eles: node }, zoom: 1.5 }, { duration: 400 });
        showNodeFlyout({ ...node.data(), simulationStatus: item.status, simulationDepth: item.depth, simulationReason: item.reason, simulationRecommendation: item.recommendation });
      }
    }
  });

  return card;
}

// ==================== History & Comparison ====================

/**
 * Load simulation history for project
 */
async function loadHistory(projectId) {
  const list = document.getElementById('history-list');
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/simulations`);
    const history = await res.json();

    list.innerHTML = '';
    state.selectedHistory.clear();
    updateCompareButton();

    if (history.length === 0) {
      list.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:1rem;">No simulations yet.</div>';
      return;
    }

    for (const h of history) {
      const item = document.createElement('div');
      item.className = 'history-item';

      const changeSummary = `${h.change?.type}: ${h.change?.targetId}`;
      const dateStr = new Date(h.createdAt).toLocaleTimeString();

      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input type="checkbox" class="history-checkbox" data-id="${h._id}">
          <div>
            <div style="font-size:0.78rem;font-weight:600;">${changeSummary}</div>
            <div style="font-size:0.68rem;color:var(--text-muted);">${dateStr}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.9rem;font-weight:700;font-family:var(--font-mono);" class="${h.score >= 50 ? 'score-high' : 'score-low'}">${h.score}</div>
          <div style="font-size:0.65rem;color:var(--text-muted);">${h.label}</div>
        </div>
      `;

      const cb = item.querySelector('.history-checkbox');
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          if (state.selectedHistory.size >= 2) {
            e.target.checked = false;
            showToast('You can select at most 2 simulations to compare.', 'info');
            return;
          }
          state.selectedHistory.add(h._id);
        } else {
          state.selectedHistory.delete(h._id);
        }
        updateCompareButton();
      });

      list.appendChild(item);
    }
  } catch (err) {
    list.innerHTML = `<div style="color:var(--status-broken);font-size:0.75rem;">Error loading history: ${err.message}</div>`;
  }
}

function updateCompareButton() {
  const btn = document.getElementById('btn-compare');
  btn.disabled = state.selectedHistory.size !== 2;
  btn.textContent = `Compare (${state.selectedHistory.size}/2 Selected)`;
}

/**
 * Execute Compare via /api/compare?a=...&b=...
 */
async function openCompareModal() {
  if (state.selectedHistory.size !== 2) return;
  const [a, b] = Array.from(state.selectedHistory);

  const modal = document.getElementById('modal-compare');
  const body = document.getElementById('compare-modal-body');
  modal.style.display = 'flex';
  body.innerHTML = '<div style="text-align:center;padding:2rem;">Running MongoDB Aggregation comparison...</div>';

  try {
    const res = await fetch(`/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    const comp = await res.json();
    if (!res.ok) throw new Error(comp.error || 'Failed to compare');

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
        <div class="panel-section">
          <div style="font-size:0.75rem;color:var(--text-muted);">Simulation A</div>
          <div style="font-size:0.85rem;font-weight:700;">${comp.simulationA.change?.type} (${comp.simulationA.change?.targetId})</div>
          <div style="font-size:1.5rem;font-weight:800;margin-top:0.3rem;" class="${comp.simulationA.score >= 50 ? 'score-high' : 'score-low'}">
            Score: ${comp.simulationA.score} (${comp.simulationA.label})
          </div>
        </div>
        <div class="panel-section">
          <div style="font-size:0.75rem;color:var(--text-muted);">Simulation B</div>
          <div style="font-size:0.85rem;font-weight:700;">${comp.simulationB.change?.type} (${comp.simulationB.change?.targetId})</div>
          <div style="font-size:1.5rem;font-weight:800;margin-top:0.3rem;" class="${comp.simulationB.score >= 50 ? 'score-high' : 'score-low'}">
            Score: ${comp.simulationB.score} (${comp.simulationB.label})
          </div>
        </div>
      </div>

      <div style="text-align:center;margin-bottom:1rem;padding:0.5rem;background:rgba(56,189,248,0.1);border-radius:6px;">
        <strong>Score Difference:</strong> ${comp.scoreDifference > 0 ? `+${comp.scoreDifference} (A higher)` : `${comp.scoreDifference} (B higher)`}
      </div>

      <!-- Set differences -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;">
        <div class="panel-section">
          <div class="section-title">Only in A (${comp.counts.onlyInA})</div>
          <div style="max-height:150px;overflow-y:auto;font-size:0.75rem;">
            ${comp.onlyInA.length ? comp.onlyInA.map(x => `<div style="padding:0.2rem 0;color:var(--status-broken);">${x.name || x.componentId} (${x.status})</div>`).join('') : '<div style="color:var(--text-muted);">None</div>'}
          </div>
        </div>
        <div class="panel-section">
          <div class="section-title">In Both (${comp.counts.inBoth})</div>
          <div style="max-height:150px;overflow-y:auto;font-size:0.75rem;">
            ${comp.inBoth.length ? comp.inBoth.map(x => `<div style="padding:0.2rem 0;">${x.name || x.componentId} <span style="font-size:0.65rem;color:var(--text-muted);">(A:${x.statusA} / B:${x.statusB})</span></div>`).join('') : '<div style="color:var(--text-muted);">None</div>'}
          </div>
        </div>
        <div class="panel-section">
          <div class="section-title">Only in B (${comp.counts.onlyInB})</div>
          <div style="max-height:150px;overflow-y:auto;font-size:0.75rem;">
            ${comp.onlyInB.length ? comp.onlyInB.map(x => `<div style="padding:0.2rem 0;color:var(--status-broken);">${x.name || x.componentId} (${x.status})</div>`).join('') : '<div style="color:var(--text-muted);">None</div>'}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div style="color:var(--status-broken);text-align:center;">${err.message}</div>`;
  }
}

// ==================== MongoDB Analytics ====================

/**
 * Load Analytics from /api/projects/:id/analytics
 */
async function loadAnalytics(projectId) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/analytics`);
    const data = await res.json();

    // 1. Chart.js Blast Radius Rankings
    renderBlastChart(data.blastRankings || []);

    // 2. Fragile Components Table
    const fragileTbody = document.querySelector('#fragile-table tbody');
    fragileTbody.innerHTML = '';
    if (!data.fragileComponents || data.fragileComponents.length === 0) {
      fragileTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">No simulation data</td></tr>';
    } else {
      for (const fc of data.fragileComponents) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${fc.name || fc.componentId}</strong> (${fc.type})</td>
          <td>${fc.impactCount} times</td>
          <td><span class="badge-${fc.worstStatus === 'BROKEN' ? 'critical' : 'high'}" style="font-size:0.65rem;padding:0.15rem 0.4rem;border-radius:4px;">${fc.worstStatus}</span></td>
        `;
        fragileTbody.appendChild(tr);
      }
    }

    // 3. Hotspots Table
    const hotTbody = document.querySelector('#hotspots-table tbody');
    hotTbody.innerHTML = '';
    if (!data.hotspots || data.hotspots.length === 0) {
      hotTbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-muted);">No edge data</td></tr>';
    } else {
      for (const h of data.hotspots) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${h.name || h.componentId}</strong></td>
          <td>${h.dependentsCount} consumers</td>
        `;
        hotTbody.appendChild(tr);
      }
    }
  } catch (err) {
    console.warn('Analytics loading error:', err);
  }
}

function renderBlastChart(rankings) {
  const ctx = document.getElementById('blast-chart');
  if (!ctx) return;

  const labels = rankings.map(r => `${r.change?.type?.replace('_FIELD', '') || 'Sim'} (${r.change?.targetId?.split('.').pop() || ''})`);
  const scores = rankings.map(r => r.score);
  const colors = rankings.map(r => r.score >= 75 ? '#ef4444' : r.score >= 50 ? '#f97316' : r.score >= 25 ? '#eab308' : '#10b981');

  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['No Data'],
      datasets: [{
        label: 'Blast Radius Score',
        data: scores.length ? scores : [0],
        backgroundColor: colors.length ? colors : ['#475569'],
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(148, 163, 184, 0.1)' },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 9 }, maxRotation: 45 }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

/**
 * Load events for project
 */
async function loadEvents(projectId) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/events`);
    const events = await res.json();
    const list = document.getElementById('events-stream-list');
    list.innerHTML = '';
    for (const ev of events) {
      addEventToFeed(ev, false);
    }
  } catch (err) {
    console.warn('Failed to load past events:', err);
  }
}

// ==================== UI Event Listeners ====================

function setupEventListeners() {
  // Project & Version selects
  document.getElementById('project-select').addEventListener('change', (e) => {
    onProjectChange(e.target.value);
  });

  document.getElementById('version-select').addEventListener('change', (e) => {
    onVersionChange(e.target.value);
  });

  // Fit graph button
  document.getElementById('btn-fit-graph').addEventListener('click', () => {
    if (state.cy) state.cy.fit(undefined, 40);
  });

  // Layout change
  document.getElementById('layout-select').addEventListener('change', () => {
    applyLayout();
  });

  // Replay animation button
  document.getElementById('btn-replay-anim').addEventListener('click', () => {
    if (state.lastSimulation) {
      animateChainReaction(
        state.lastSimulation.change?.targetId,
        state.lastSimulation.affected || [],
        state.lastSimulation.chains || []
      );
    }
  });

  // Close flyout
  document.getElementById('btn-close-flyout').addEventListener('click', () => {
    document.getElementById('node-flyout').style.display = 'none';
  });

  // Simulate Button
  document.getElementById('btn-simulate').addEventListener('click', runSimulation);

  // Download Report Button
  document.getElementById('btn-download-report').addEventListener('click', () => {
    if (!state.lastSimulation) {
      showToast('No simulation report to download.', 'info');
      return;
    }
    const blob = new Blob([JSON.stringify(state.lastSimulation, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bugbound-report-${state.lastSimulation.simulationId || 'sim'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Compare Button
  document.getElementById('btn-compare').addEventListener('click', openCompareModal);
  document.getElementById('btn-close-compare-modal').addEventListener('click', () => {
    document.getElementById('modal-compare').style.display = 'none';
  });

  // New Project Modal
  document.getElementById('btn-new-project').addEventListener('click', () => {
    document.getElementById('modal-new-project').style.display = 'flex';
  });
  document.getElementById('btn-close-project-modal').addEventListener('click', () => {
    document.getElementById('modal-new-project').style.display = 'none';
  });
  document.getElementById('btn-cancel-project').addEventListener('click', () => {
    document.getElementById('modal-new-project').style.display = 'none';
  });
  document.getElementById('btn-create-project-submit').addEventListener('click', async () => {
    const input = document.getElementById('new-project-name');
    const name = input.value.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');

      document.getElementById('modal-new-project').style.display = 'none';
      input.value = '';
      showToast(`Project "${name}" created!`, 'success');
      await loadProjects(name);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Presets
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => applyPreset(chip.dataset.preset));
  });

  // One-Click Demo Buttons
  document.getElementById('btn-seed-demo').addEventListener('click', handleSeedDemo);
  document.getElementById('btn-upload-v2').addEventListener('click', handleUploadV2);
  document.getElementById('btn-upload-invalid').addEventListener('click', handleUploadInvalid);

  // File Dropzone & Upload
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('manifest-file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) uploadManifestFile(e.target.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--accent-cyan)';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border-color)';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border-color)';
    if (e.dataTransfer.files.length) {
      uploadManifestFile(e.dataTransfer.files[0]);
    }
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === tabId));
}

// Preset Handlers
function applyPreset(preset) {
  const typeSel = document.getElementById('change-type-select');
  const targetSel = document.getElementById('target-component-select');

  if (preset === 'rename-username') {
    typeSel.value = 'RENAME_FIELD';
    renderParamFields('RENAME_FIELD');
    if (state.graphData) updateTargetOptions(state.graphData.components);
    targetSel.value = 'db.users.user_name';
    const from = document.getElementById('param-from');
    const to = document.getElementById('param-to');
    if (from) from.value = 'user_name';
    if (to) to.value = 'username';
  } else if (preset === 'delete-email') {
    typeSel.value = 'DELETE_FIELD';
    renderParamFields('DELETE_FIELD');
    if (state.graphData) updateTargetOptions(state.graphData.components);
    targetSel.value = 'db.users.email';
  } else if (preset === 'change-timeout') {
    typeSel.value = 'CHANGE_CONFIG';
    renderParamFields('CHANGE_CONFIG');
    if (state.graphData) updateTargetOptions(state.graphData.components);
    targetSel.value = 'config.PAYMENT_TIMEOUT';
    const key = document.getElementById('param-key');
    const from = document.getElementById('param-from');
    const to = document.getElementById('param-to');
    if (key) key.value = 'PAYMENT_TIMEOUT';
    if (from) from.value = '30';
    if (to) to.value = '5';
  } else if (preset === 'upgrade-payments') {
    typeSel.value = 'UPGRADE_DEPENDENCY_MAJOR';
    renderParamFields('UPGRADE_DEPENDENCY_MAJOR');
    if (state.graphData) updateTargetOptions(state.graphData.components);
    targetSel.value = 'pkg.payments_sdk';
    const from = document.getElementById('param-from');
    const to = document.getElementById('param-to');
    if (from) from.value = '1.x';
    if (to) to.value = '2.x';
  }
}

// ==================== Demo & Manifest Upload Handlers ====================

async function handleSeedDemo() {
  const btn = document.getElementById('btn-seed-demo');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Loading ShopLite...';

  try {
    const res = await fetch('/api/demo/seed', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to seed demo');

    showToast(`Loaded ShopLite Demo (Version: ${data.versionId})`, 'success');
    await loadProjects('ShopLite Demo');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>⚡</span> Load ShopLite Demo';
  }
}

async function handleUploadV2() {
  const projectId = state.currentProject || 'ShopLite Demo';
  try {
    const sampleRes = await fetch('/api/demo/samples/shoplite-v2');
    const manifest = await sampleRes.json();

    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest)
    });
    const data = await res.json();

    if (res.status === 200 && data.status === 'duplicate') {
      showToast(`Duplicate: version ${data.versionId} already exists (Idempotent)`, 'info');
    } else if (res.status === 201) {
      showToast(`Uploaded ShopLite v2: new version ${data.versionId} created!`, 'success');
      await loadVersions(projectId, data.versionId);
    } else {
      showToast(data.error || 'Upload error', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleUploadInvalid() {
  const projectId = state.currentProject || 'ShopLite Demo';
  try {
    const sampleRes = await fetch('/api/demo/samples/invalid');
    const manifest = await sampleRes.json();

    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest)
    });
    const data = await res.json();

    if (res.status === 422) {
      showToast(`Expected 422 Validation Error:\n${data.reasons.join('\n')}`, 'error');
    } else {
      showToast(`Response: ${res.status}`, 'info');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function uploadManifestFile(file) {
  const projectId = state.currentProject;
  if (!projectId) {
    showToast('Please select or create a project first.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const manifest = JSON.parse(e.target.result);
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/manifest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest)
      });
      const data = await res.json();

      if (res.status === 200 && data.status === 'duplicate') {
        showToast('Duplicate manifest: no new version created (Idempotent)', 'info');
      } else if (res.status === 201) {
        showToast(`Manifest uploaded successfully! Version: ${data.versionId}`, 'success');
        await loadVersions(projectId, data.versionId);
      } else if (res.status === 422) {
        showToast(`Validation rejected (422):\n${(data.reasons || []).join('\n')}`, 'error');
      } else {
        showToast(data.error || 'Upload failed', 'error');
      }
    } catch (parseErr) {
      showToast('Invalid JSON file: ' + parseErr.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ==================== Toast Notifications ====================

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${msg.replace(/\n/g, '<br>')}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
