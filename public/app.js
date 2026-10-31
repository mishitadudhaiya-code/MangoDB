/**
 * public/app.js — BugBound Frontend Controller
 * Implements: Cytoscape visualizer, animated chain reaction with ripple pulse,
 * component explorer, "color by" switching, what-if simulations, history comparison,
 * Chart.js analytics, live SSE feed, and code scanner.
 */

// Application State
const state = {
  currentProject: null,
  currentVersion: null,
  graphData: null,
  lastSimulation: null,
  selectedHistory: new Set(),
  selectedNodeId: null,
  colorBy: 'type',
  activeLayout: 'cose',
  cy: null,
  chart: null,
  eventSource: null
};

// Node Type Palettes (Warm / Tech Hues)
const TYPE_COLORS = {
  field: { bg: '#b45309', border: '#f59e0b' },      // Amber
  table: { bg: '#78350f', border: '#d97706' },      // Warm brown/orange
  api: { bg: '#6b21a8', border: '#a855f7' },        // Purple
  function: { bg: '#0e7490', border: '#06b6d4' },   // Cyan
  page: { bg: '#0369a1', border: '#38bdf8' },       // Sky blue
  service: { bg: '#be185d', border: '#ec4899' },    // Pink
  config: { bg: '#334155', border: '#94a3b8' },     // Slate
  package: { bg: '#9f1239', border: '#f43f5e' }     // Rose
};

// Criticality 1-5 Heatmap Colors
const CRITICALITY_COLORS = {
  1: { bg: '#064e3b', border: '#10b981' }, // Low (Green)
  2: { bg: '#155e75', border: '#06b6d4' }, // Low-Mid (Cyan)
  3: { bg: '#854d0e', border: '#eab308' }, // Mid (Yellow)
  4: { bg: '#9a3412', border: '#f97316' }, // High (Orange)
  5: { bg: '#991b1b', border: '#ef4444' }  // Critical (Red)
};

// Cytoscape node shapes by component type
const SHAPE_BY_TYPE = {
  field:    'round-rectangle',
  table:    'barrel',
  api:      'diamond',
  function: 'hexagon',
  page:     'rectangle',
  service:  'round-octagon',
  config:   'round-tag',
  package:  'round-pentagon'
};

// Compatible component types per change type
const COMPATIBLE_TYPES = {
  RENAME_FIELD: ['field', 'api'],
  DELETE_FIELD: ['field'],
  CHANGE_FIELD_TYPE: ['field'],
  DELETE_ENDPOINT: ['api'],
  CHANGE_FUNCTION_SIGNATURE: ['function'],
  CHANGE_CONFIG: ['config'],
  UPGRADE_DEPENDENCY_MAJOR: ['package']
};

// ==================== 1. Initialization ====================

document.addEventListener('DOMContentLoaded', async () => {
  initCytoscape();
  setupEventListeners();
  setupDynamicParams();
  setupAccordions();
  initSSE();
  await checkHealth();
  await loadProjects();
});

/**
 * Health check ping to server & MongoDB Atlas
 */
async function checkHealth() {
  const pill = document.getElementById('db-status-pill');
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.db === 'up') {
      pill.innerHTML = '<span class="indicator-dot green"></span><span>Atlas</span>';
      pill.title = 'MongoDB Atlas Connected';
    } else {
      pill.innerHTML = '<span class="indicator-dot yellow"></span><span>Offline</span>';
      pill.title = 'Database Not Connected';
    }
  } catch (err) {
    pill.innerHTML = '<span class="indicator-dot red"></span><span>Error</span>';
  }
}

/**
 * Initialize Server-Sent Events (SSE) live feed
 */
function initSSE() {
  const streamPill = document.getElementById('stream-status-pill');

  try {
    state.eventSource = new EventSource('/api/stream');

    state.eventSource.onopen = () => {
      streamPill.innerHTML = '<span class="indicator-dot green"></span><span>Live</span>';
    };

    state.eventSource.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        addEventToFeed(ev, true);
        showToast(`Event: ${ev.type} (${ev.status || 'ok'})`, ev.status === 'rejected' ? 'error' : 'info');
      } catch (_err) {}
    };

    state.eventSource.onerror = () => {
      streamPill.innerHTML = '<span class="indicator-dot yellow"></span><span>Feed</span>';
    };
  } catch (err) {
    console.warn('SSE not initialized:', err);
  }
}

/**
 * Add item to live feed list
 */
function addEventToFeed(ev, isLive = false) {
  const feedEl = document.getElementById('compact-event-feed');
  if (feedEl.children.length === 1 && feedEl.children[0].textContent.includes('Awaiting')) {
    feedEl.innerHTML = '';
  }

  const row = document.createElement('div');
  row.className = `feed-row ${ev.status || 'ok'}`;
  const time = new Date(ev.at || Date.now()).toLocaleTimeString();
  const det = ev.details ? JSON.stringify(ev.details) : '';

  row.innerHTML = `
    <div style="display:flex;justify-content:space-between;color:var(--text-muted);">
      <span>${ev.projectId || 'system'}</span>
      <span>${time} ${isLive ? '• live' : ''}</span>
    </div>
    <div style="font-weight:600;color:var(--text-primary);">${ev.type}</div>
    ${det ? `<div style="color:var(--text-secondary);font-size:0.62rem;word-break:break-all;">${det.substring(0, 80)}</div>` : ''}
  `;

  feedEl.insertBefore(row, feedEl.firstChild);
  while (feedEl.children.length > 25) {
    feedEl.removeChild(feedEl.lastChild);
  }
}

// ==================== 2. Cytoscape Graph Engine ====================

function initCytoscape() {
  state.cy = cytoscape({
    container: document.getElementById('cy'),
    boxSelectionEnabled: false,
    autounselectify: false,
    style: [
      // Base Node Style: Modern Circles with soft glow
      {
        selector: 'node',
        style: {
          'shape': 'ellipse',
          'width': 38,
          'height': 38,
          'label': 'data(name)',
          'font-family': 'Inter, sans-serif',
          'font-size': '10px',
          'font-weight': 500,
          'text-valign': 'bottom',
          'text-margin-y': 5,
          'color': '#cbd5e1',
          'background-color': '#111827',
          'border-width': 2.5,
          'border-color': '#f59e0b',
          'text-max-width': '110px',
          'text-wrap': 'ellipsis',
          'transition-property': 'background-color, border-color, width, height, opacity, border-width',
          'transition-duration': '0.2s'
        }
      },
      // Per-type Shapes (colours set by base node + status rules; only shape here)
      ...Object.entries(SHAPE_BY_TYPE).map(([type, shape]) => ({
        selector: `node[type = "${type}"]`,
        style: { shape }
      })),
      // Wider size for diamond / hexagon so label fits
      {
        selector: 'node[type = "api"]',
        style: { width: 44, height: 44 }
      },
      {
        selector: 'node[type = "function"]',
        style: { width: 44, height: 44 }
      },
      // Selected Node
      {
        selector: 'node:selected',
        style: {
          'border-width': 4,
          'border-color': '#19e6a1',
          'color': '#ffffff'
        }
      },
      // Target Node in Simulation (Electric Blue Glow)
      {
        selector: 'node.status-target',
        style: {
          'background-color': '#1d4ed8',
          'border-color': '#3b82f6',
          'border-width': 4.5,
          'width': 46,
          'height': 46,
          'color': '#ffffff'
        }
      },
      // BROKEN Status (Coral Red)
      {
        selector: 'node.status-BROKEN',
        style: {
          'background-color': '#7f1d1d',
          'border-color': '#ef4444',
          'border-width': 3.5,
          'color': '#ffffff'
        }
      },
      // AT_RISK Status (Orange)
      {
        selector: 'node.status-AT_RISK',
        style: {
          'background-color': '#7c2d12',
          'border-color': '#f97316',
          'border-width': 3,
          'color': '#ffffff'
        }
      },
      // UNCERTAIN Status (Yellow Dashed Border)
      {
        selector: 'node.status-UNCERTAIN',
        style: {
          'background-color': '#713f12',
          'border-color': '#eab308',
          'border-width': 3,
          'border-style': 'dashed',
          'color': '#ffffff'
        }
      },
      // SAFE Status (Dimmed Gray-Green)
      {
        selector: 'node.status-SAFE',
        style: {
          'background-color': '#064e3b',
          'border-color': '#10b981',
          'opacity': 0.35
        }
      },
      // Edges: Thin, semi-transparent with arrows
      {
        selector: 'edge',
        style: {
          'width': 1.5,
          'line-color': 'rgba(148, 163, 184, 0.28)',
          'target-arrow-color': 'rgba(148, 163, 184, 0.4)',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.9,
          'transition-property': 'line-color, target-arrow-color, width',
          'transition-duration': '0.2s'
        }
      },
      // Dynamic Edges (Dashed)
      {
        selector: 'edge[?dynamic]',
        style: {
          'line-style': 'dashed',
          'line-dash-pattern': [5, 3],
          'line-color': '#eab308',
          'target-arrow-color': '#eab308',
          'width': 2
        }
      },
      // Highlighted Propagation Path
      {
        selector: 'edge.highlighted-path',
        style: {
          'line-color': '#ef4444',
          'target-arrow-color': '#ef4444',
          'width': 3.5
        }
      }
    ]
  });

  // Tap on node: select & show details
  state.cy.on('tap', 'node', (evt) => {
    const node = evt.target;
    selectNode(node);
  });

  // Tap on canvas background: deselect
  state.cy.on('tap', (evt) => {
    if (evt.target === state.cy) {
      document.getElementById('node-flyout').style.display = 'none';
      state.selectedNodeId = null;
    }
  });
}

/**
 * Handle selecting a node (focus, flyout, connections)
 */
function selectNode(node) {
  const d = node.data();
  state.selectedNodeId = d.id;

  // Center node smoothly
  state.cy.animate({
    center: { eles: node },
    zoom: Math.max(state.cy.zoom(), 1.4)
  }, { duration: 250 });

  showNodeFlyout(d);
  populateAccordionDetails(d);
}

/**
 * Show node details in floating HUD flyout
 */
function showNodeFlyout(nodeData) {
  const flyout = document.getElementById('node-flyout');
  document.getElementById('flyout-title').textContent = nodeData.name || nodeData.id;
  document.getElementById('flyout-type').textContent = `[${nodeData.type || 'component'}] ${nodeData.id}`;
  document.getElementById('flyout-criticality').textContent = `Criticality: ${'★'.repeat(nodeData.criticality || 3)}${'☆'.repeat(5 - (nodeData.criticality || 3))}`;

  const statusBlock = document.getElementById('flyout-status-block');
  if (nodeData.simulationStatus) {
    statusBlock.style.display = 'block';
    const stEl = document.getElementById('flyout-status');
    stEl.textContent = `STATUS: ${nodeData.simulationStatus} (Depth ${nodeData.simulationDepth || 1})`;
    stEl.style.color = nodeData.simulationStatus === 'BROKEN' ? '#ef4444' :
                       nodeData.simulationStatus === 'AT_RISK' ? '#f97316' :
                       nodeData.simulationStatus === 'UNCERTAIN' ? '#eab308' : '#10b981';

    const reasonFormatted = formatReason({ status: nodeData.simulationStatus, reason: nodeData.simulationReason });
    document.getElementById('flyout-reason').textContent = reasonFormatted || 'Affected downstream.';
    document.getElementById('flyout-recommendation').textContent = `Action: ${nodeData.simulationRecommendation || 'Review component contract.'}`;
  } else {
    statusBlock.style.display = 'none';
  }

  flyout.style.display = 'block';
}

/**
 * Populate accordion details (Reason, Chains, Connections)
 */
function populateAccordionDetails(nodeData) {
  // 1. Reason & Recommendation
  document.getElementById('reasons-node-name').textContent = nodeData.name || nodeData.id;
  if (nodeData.simulationStatus) {
    const reasonFormatted = formatReason({ status: nodeData.simulationStatus, reason: nodeData.simulationReason });
    document.getElementById('reasons-node-text').textContent = `${nodeData.simulationStatus}: ${reasonFormatted || ''}`;
    document.getElementById('reasons-node-rec').textContent = `💡 Recommendation: ${nodeData.simulationRecommendation || 'Verify usage.'}`;
  } else {
    document.getElementById('reasons-node-text').textContent = 'This component is safe or not currently affected by the simulation.';
    document.getElementById('reasons-node-rec').textContent = '';
  }

  // 2. Connections
  const node = state.cy.getElementById(nodeData.id);
  if (node && node.length > 0) {
    const inEdges = node.incomers('edge');
    const outEdges = node.outgoers('edge');

    const inList = inEdges.map(e => `• Consumer: ${e.source().data('name') || e.source().id()} (${e.data('kind')}${e.data('dynamic') ? ' [dynamic]' : ''})`).join('<br>');
    const outList = outEdges.map(e => `• Depends on: ${e.target().data('name') || e.target().id()} (${e.data('kind')})`).join('<br>');

    document.getElementById('connections-list-box').innerHTML = `
      <div style="font-weight:600;margin-bottom:0.2rem;color:var(--text-primary);">Consumers (${inEdges.length}):</div>
      ${inList || '<div style="color:var(--text-muted);">None</div>'}
      <div style="font-weight:600;margin:0.4rem 0 0.2rem 0;color:var(--text-primary);">Providers (${outEdges.length}):</div>
      ${outList || '<div style="color:var(--text-muted);">None</div>'}
    `;
  }
}

// ==================== 3. Data Loading & Graph Rendering ====================

/**
 * Load project list
 */
async function loadProjects(selectId = null) {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    const sel = document.getElementById('project-select');

    sel.innerHTML = '<option value="">Select project...</option>';
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
  await loadAnalytics(projectId);
  await loadEvents(projectId);
}

/**
 * Load graph versions for current project
 */
async function loadVersions(projectId, selectVid = null) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/versions`);
    const versions = await res.json();
    const sel = document.getElementById('version-select');

    sel.innerHTML = '';
    if (versions.length === 0) {
      sel.innerHTML = '<option value="">No versions</option>';
      state.cy.elements().remove();
      updateStatCards(0, 0, 0, 0);
      return;
    }

    for (const v of versions) {
      const opt = document.createElement('option');
      opt.value = v._id;
      opt.textContent = `v${v.version} (${v.componentCount}c / ${v.edgeCount}e)`;
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
 * On Version Selected: Fetch components and edges
 */
async function onVersionChange(versionId) {
  state.currentVersion = versionId;
  if (!versionId) return;

  try {
    const res = await fetch(`/api/versions/${encodeURIComponent(versionId)}/graph`);
    if (!res.ok) throw new Error('Failed to fetch graph');
    const data = await res.json();

    state.graphData = data;
    renderGraph(data);
    updateTargetOptions(data.components);
    populateExplorerTree(data.components);
    updateStatCards(data.components.length, data.edges.length, state.lastSimulation ? 1 : 0, 0);
  } catch (err) {
    showToast('Graph loading error: ' + err.message, 'error');
  }
}

/**
 * Render Cytoscape elements
 */
function renderGraph(data) {
  if (!state.cy) return;

  const elements = [];

  // Add Nodes
  for (const c of data.components) {
    const compId = c.componentId || c.id;
    const typeInfo = TYPE_COLORS[c.type] || { bg: '#1e293b', border: '#f59e0b' };

    elements.push({
      group: 'nodes',
      data: {
        id: compId,
        name: c.name || compId,
        type: c.type || 'service',
        criticality: c.criticality || 3,
        baseColor: typeInfo.border,
        baseBg: typeInfo.bg
      }
    });
  }

  // Add Edges
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

  applyColorBy(state.colorBy);
  applyLayout(state.activeLayout);

  // Update bottom chips
  document.getElementById('chip-components-count').textContent = `${data.components.length} components`;
  document.getElementById('chip-edges-count').textContent = `${data.edges.length} edges`;
  document.getElementById('chip-affected-count').textContent = '0 affected';
}

/**
 * Apply layout (cose, breadthfirst, or concentric)
 */
function applyLayout(layoutName = 'cose') {
  if (!state.cy) return;
  state.activeLayout = layoutName;

  let options = {
    name: layoutName,
    animate: true,
    animationDuration: 500,
    fit: true,
    padding: 40
  };

  if (layoutName === 'breadthfirst') {
    options.directed = true;
    options.spacingFactor = 1.3;
  } else if (layoutName === 'cose') {
    options.nodeRepulsion = 450000;
    options.idealEdgeLength = 90;
  }

  const layout = state.cy.layout(options);
  layout.run();
}

/**
 * Apply "Color by" selector: Type / Status / Criticality
 */
function applyColorBy(mode) {
  state.colorBy = mode;
  if (!state.cy) return;

  state.cy.batch(() => {
    state.cy.nodes().forEach(node => {
      const d = node.data();

      if (mode === 'criticality') {
        const crit = d.criticality || 3;
        const color = CRITICALITY_COLORS[crit] || CRITICALITY_COLORS[3];
        node.style({
          'border-color': color.border,
          'background-color': color.bg
        });
      } else if (mode === 'status') {
        if (node.hasClass('status-target')) {
          node.style({ 'border-color': '#3b82f6', 'background-color': '#1d4ed8' });
        } else if (node.hasClass('status-BROKEN')) {
          node.style({ 'border-color': '#ef4444', 'background-color': '#7f1d1d' });
        } else if (node.hasClass('status-AT_RISK')) {
          node.style({ 'border-color': '#f97316', 'background-color': '#7c2d12' });
        } else if (node.hasClass('status-UNCERTAIN')) {
          node.style({ 'border-color': '#eab308', 'background-color': '#713f12' });
        } else {
          node.style({ 'border-color': '#10b981', 'background-color': '#064e3b' });
        }
      } else {
        // Default: Type
        const typeInfo = TYPE_COLORS[d.type] || { bg: '#111827', border: '#f59e0b' };
        node.style({
          'border-color': typeInfo.border,
          'background-color': typeInfo.bg
        });
      }
    });
  });
}

/**
 * Populate Component Explorer Tree grouped by type
 */
function populateExplorerTree(components) {
  const treeEl = document.getElementById('explorer-tree');
  treeEl.innerHTML = '';

  const groups = {};
  for (const c of components) {
    const t = c.type || 'other';
    if (!groups[t]) groups[t] = [];
    groups[t].push(c);
  }

  for (const [type, comps] of Object.entries(groups)) {
    const groupDiv = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'tree-group-header';
    header.innerHTML = `<span><strong>${type.toUpperCase()}</strong> (${comps.length})</span><span>▾</span>`;

    const itemsBox = document.createElement('div');
    itemsBox.className = 'tree-group-items';

    for (const c of comps) {
      const compId = c.componentId || c.id;
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.id = compId;
      item.dataset.name = (c.name || compId).toLowerCase();
      item.innerHTML = `<span>${c.name || compId}</span><span style="color:var(--text-muted);font-size:0.6rem;">★${c.criticality || 3}</span>`;

      item.addEventListener('click', () => {
        document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        const node = state.cy.getElementById(compId);
        if (node && node.length > 0) {
          selectNode(node);
        }
      });

      itemsBox.appendChild(item);
    }

    header.addEventListener('click', () => {
      itemsBox.style.display = itemsBox.style.display === 'none' ? 'flex' : 'none';
      header.querySelector('span:last-child').textContent = itemsBox.style.display === 'none' ? '▸' : '▾';
    });

    groupDiv.appendChild(header);
    groupDiv.appendChild(itemsBox);
    treeEl.appendChild(groupDiv);
  }
}

/**
 * Filter Component Explorer
 */
function filterExplorerTree(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.tree-item').forEach(item => {
    const matches = !q || item.dataset.name.includes(q) || item.dataset.id.toLowerCase().includes(q);
    item.style.display = matches ? 'flex' : 'none';
  });
}

/**
 * Update 2x2 stat cards
 */
function updateStatCards(components, edges, simulations, uncertain) {
  document.getElementById('stat-components').textContent = components;
  document.getElementById('stat-edges').textContent = edges;
  document.getElementById('stat-simulations').textContent = simulations;
  document.getElementById('stat-uncertain').textContent = uncertain;
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
    sel.innerHTML = '<option value="">No compatible components</option>';
    return;
  }

  for (const c of filtered) {
    const compId = c.componentId || c.id;
    const opt = document.createElement('option');
    opt.value = compId;
    opt.textContent = `${c.name || compId} (${c.type}) — crit:${c.criticality || 3}`;
    sel.appendChild(opt);
  }
}

// ==================== 4. Dynamic Parameter Forms ====================

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
      <div class="form-field">
        <label class="form-label">Current Field Name ('from')</label>
        <input type="text" id="param-from" class="form-input" placeholder="user_name">
      </div>
      <div class="form-field">
        <label class="form-label">New Field Name ('to')</label>
        <input type="text" id="param-to" class="form-input" placeholder="username">
      </div>
    `;
  } else if (type === 'CHANGE_FIELD_TYPE') {
    container.innerHTML = `
      <div class="form-field">
        <label class="form-label">Current Type ('from')</label>
        <input type="text" id="param-from" class="form-input" placeholder="string">
      </div>
      <div class="form-field">
        <label class="form-label">New Type ('to')</label>
        <input type="text" id="param-to" class="form-input" placeholder="int">
      </div>
    `;
  } else if (type === 'CHANGE_CONFIG') {
    container.innerHTML = `
      <div class="form-field">
        <label class="form-label">Config Key</label>
        <input type="text" id="param-key" class="form-input" placeholder="PAYMENT_TIMEOUT">
      </div>
      <div class="form-field">
        <label class="form-label">Old Value ('from')</label>
        <input type="text" id="param-from" class="form-input" placeholder="30">
      </div>
      <div class="form-field">
        <label class="form-label">New Value ('to')</label>
        <input type="text" id="param-to" class="form-input" placeholder="5">
      </div>
    `;
  } else if (type === 'UPGRADE_DEPENDENCY_MAJOR') {
    container.innerHTML = `
      <div class="form-field">
        <label class="form-label">Current Version ('from')</label>
        <input type="text" id="param-from" class="form-input" placeholder="1.x">
      </div>
      <div class="form-field">
        <label class="form-label">Target Version ('to')</label>
        <input type="text" id="param-to" class="form-input" placeholder="2.x">
      </div>
    `;
  } else if (type === 'CHANGE_FUNCTION_SIGNATURE') {
    container.innerHTML = `
      <div class="form-field">
        <label class="form-label">Description of Change</label>
        <input type="text" id="param-desc" class="form-input" placeholder="added required argument">
      </div>
    `;
  }
}

// ==================== 5. Simulation Runner & Animated Chain Reaction ====================

/**
 * Execute What-If simulation
 */
async function runSimulation() {
  if (!state.currentVersion) {
    showToast('Please load a graph version first.', 'error');
    return;
  }

  const type = document.getElementById('change-type-select').value;
  const targetId = document.getElementById('target-component-select').value;

  if (!targetId) {
    showToast('Please select a target component.', 'error');
    return;
  }

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
  btn.innerHTML = '<span>⏳</span> Simulating...';

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

    // Render Impact Report & Score Ring
    renderReport(data);

    // Switch to Impact Tab
    switchTab('tab-impact');

    // Run Animated Chain Reaction with Ripple Pulse!
    animateChainReaction(targetId, data.affected || [], data.chains || []);

    // Refresh history, stats & analytics
    if (state.currentProject) {
      loadHistory(state.currentProject);
      loadAnalytics(state.currentProject);
    }

    showToast(data.status === 'cached' ? '⚡ Cached result (idempotent)' : 'Simulation completed!', 'success');
  } catch (err) {
    showToast('Simulation error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🚀</span> Simulate Change Impact';
  }
}

/**
 * Animate chain reaction level-by-level with a ripple pulse from the target
 */
function animateChainReaction(targetId, affected, chains) {
  if (!state.cy) return;

  // Clear previous statuses
  state.cy.nodes().removeClass('status-target status-BROKEN status-AT_RISK status-UNCERTAIN status-SAFE');
  state.cy.edges().removeClass('highlighted-path');

  // Mark unreached nodes as SAFE
  state.cy.nodes().addClass('status-SAFE');

  // Highlight target node with pulse effect
  const targetNode = state.cy.getElementById(targetId);
  if (targetNode) {
    targetNode.removeClass('status-SAFE').addClass('status-target');

    // Ripple pulse animation on target
    targetNode.animate({
      style: { 'width': 54, 'height': 54 }
    }, {
      duration: 200,
      complete: () => {
        targetNode.animate({
          style: { 'width': 44, 'height': 44 }
        }, { duration: 250 });
      }
    });
  }

  // Group affected nodes by depth
  const byDepth = new Map();
  for (const a of affected) {
    const d = a.depth || 1;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(a);
  }

  // Show HUD banner
  const banner = document.getElementById('animation-banner');
  const stageText = document.getElementById('anim-stage-text');
  banner.style.display = 'flex';

  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  let step = 0;

  function revealNextDepth() {
    if (step >= depths.length) {
      stageText.textContent = `Completed (${affected.length} affected)`;
      setTimeout(() => { banner.style.display = 'none'; }, 2200);
      document.getElementById('chip-affected-count').textContent = `${affected.length} affected`;
      return;
    }

    const d = depths[step];
    const items = byDepth.get(d);
    stageText.textContent = `Depth ${d}: ${items.length} component(s) impacted...`;

    for (const a of items) {
      const node = state.cy.getElementById(a.componentId);
      if (node && node.length > 0) {
        node.removeClass('status-SAFE');
        node.addClass(`status-${a.status}`);

        // Attach simulation info for flyouts
        node.data({
          simulationStatus: a.status,
          simulationDepth: a.depth,
          simulationReason: formatReason(a),
          simulationRecommendation: a.recommendation
        });

        // Subtle pulse on reveal
        node.animate({
          style: { 'width': 46, 'height': 46 }
        }, {
          duration: 150,
          complete: () => {
            node.animate({ style: { 'width': 38, 'height': 38 } }, { duration: 150 });
          }
        });
      }

      // Highlight path edges
      if (a.path && a.path.length >= 2) {
        for (let i = 0; i < a.path.length - 1; i++) {
          const from = a.path[i];
          const to = a.path[i + 1];
          state.cy.edges(`[source = "${to}"][target = "${from}"]`).addClass('highlighted-path');
        }
      }
    }

    step++;
    setTimeout(revealNextDepth, 550);
  }

  revealNextDepth();
}

/**
 * Render Impact Report, Score Ring, and Accordions
 */
function renderReport(sim) {
  const score = sim.score || 0;
  const label = sim.label || 'LOW';

  // 1. Update Score Ring in Left Sidebar
  const ringProgress = document.getElementById('score-ring-progress');
  const ringVal = document.getElementById('ring-score-val');
  const ringLbl = document.getElementById('ring-score-lbl');
  const cachedPillLeft = document.getElementById('cached-pill-left');

  const circumference = 282.74; // 2 * PI * 45
  const offset = circumference - (score / 100) * circumference;
  ringProgress.style.strokeDashoffset = offset;

  const scoreColor = score >= 75 ? '#ef4444' :
                     score >= 50 ? '#f97316' :
                     score >= 25 ? '#eab308' : '#10b981';

  ringProgress.style.stroke = scoreColor;
  ringVal.textContent = score;
  ringVal.style.color = scoreColor;
  ringLbl.textContent = `${label} IMPACT`;
  ringLbl.style.color = scoreColor;
  cachedPillLeft.style.display = sim.status === 'cached' ? 'inline' : 'none';

  // 2. Update Impact Tab Header & Progress Bar
  const changeHeader = document.getElementById('impact-change-header');
  const cachedBadge = document.getElementById('cached-badge');
  const scoreText = document.getElementById('impact-score-text');
  const badgeLabel = document.getElementById('impact-badge-label');
  const progressBarFill = document.getElementById('impact-progress-bar-fill');
  const depthLine = document.getElementById('propagate-depth-line');

  changeHeader.textContent = `${sim.change?.type || 'Change'} on ${sim.change?.targetId || 'target'}`;
  cachedBadge.style.display = sim.status === 'cached' ? 'inline-block' : 'none';

  scoreText.textContent = `${score} / 100`;
  scoreText.style.color = scoreColor;

  badgeLabel.textContent = `${label} IMPACT`;
  badgeLabel.className = `status-badge ${score >= 75 ? 'badge-broken' : score >= 50 ? 'badge-at_risk' : score >= 25 ? 'badge-uncertain' : 'badge-safe'}`;

  progressBarFill.style.width = `${score}%`;
  progressBarFill.style.background = scoreColor;

  const maxDepth = Math.max(1, ...(sim.affected || []).map(a => a.depth || 1));
  depthLine.textContent = `Changes propagate up to ${maxDepth} level${maxDepth > 1 ? 's' : ''} deep`;

  // 3. Update Stat Cards
  const uncertainCount = (sim.affected || []).filter(a => a.status === 'UNCERTAIN').length;
  updateStatCards(
    state.graphData?.components?.length || 0,
    state.graphData?.edges?.length || 0,
    document.querySelectorAll('.history-row').length + 1,
    uncertainCount
  );

  // 4. Affected Components List & Uncertain Section
  const affectedList = document.getElementById('affected-list');
  const uncertainList = document.getElementById('uncertain-list');
  const uncertainSection = document.getElementById('uncertain-section');

  affectedList.innerHTML = '';
  uncertainList.innerHTML = '';

  const uncertainItems = (sim.affected || []).filter(a => a.status === 'UNCERTAIN');
  if (uncertainItems.length > 0) {
    uncertainSection.style.display = 'block';
    for (const u of uncertainItems) {
      uncertainList.appendChild(createAffectedRow(u));
    }
  } else {
    uncertainSection.style.display = 'none';
  }

  document.getElementById('affected-count-tag').textContent = `${(sim.affected || []).length} items`;

  for (const a of (sim.affected || [])) {
    affectedList.appendChild(createAffectedRow(a));
  }

  // 5. Populate Dependency Chains
  const chainsBox = document.getElementById('chains-list-box');
  if (sim.chains && sim.chains.length > 0) {
    chainsBox.innerHTML = sim.chains.slice(0, 15).map(c => `<div style="padding:0.2rem 0;">• ${c.join(' → ')}</div>`).join('');
  } else {
    chainsBox.innerHTML = '<div style="color:var(--text-muted);">No propagation chains recorded.</div>';
  }

  // Auto-populate accordion with first broken node if available
  const firstBroken = (sim.affected || []).find(a => a.status === 'BROKEN') || (sim.affected || [])[0];
  if (firstBroken) {
    populateAccordionDetails(firstBroken);
  }
}

function formatReason(item) {
  let reason = (item.reason || 'Impacted via dependency propagation').trim();
  const isPotential = item.status === 'AT_RISK' || item.status === 'UNCERTAIN';
  const startsWithPotentially = /^potentially\b/i.test(reason);

  if (isPotential) {
    if (!startsWithPotentially) {
      reason = 'Potentially ' + reason.charAt(0).toLowerCase() + reason.slice(1);
    }
  } else {
    if (startsWithPotentially) {
      reason = reason.replace(/^potentially\s+/i, '');
      reason = reason.charAt(0).toUpperCase() + reason.slice(1);
    }
  }
  return reason;
}

function createAffectedRow(item) {
  const row = document.createElement('div');
  row.className = `affected-row-card ${item.status}`;
  const badgeClass = item.status === 'BROKEN' ? 'badge-broken' : item.status === 'AT_RISK' ? 'badge-at_risk' : 'badge-uncertain';
  const reasonText = formatReason(item);

  row.innerHTML = `
    <div class="affected-row-header">
      <span class="affected-row-name">${item.name || item.componentId}</span>
      <span class="status-badge ${badgeClass}">${item.status} (d:${item.depth})</span>
    </div>
    <div class="affected-row-sub">${reasonText}</div>
    <div style="font-size:0.65rem;color:var(--accent-green);margin-top:0.15rem;">💡 ${item.recommendation || 'Verify behavior'}</div>
  `;

  row.addEventListener('click', () => {
    const node = state.cy.getElementById(item.componentId);
    if (node && node.length > 0) {
      selectNode(node);
    }
  });

  return row;
}

// ==================== 6. History & Side-by-Side Compare ====================

/**
 * Load simulation history
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
      list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:0.75rem;">No simulations yet.</div>';
      return;
    }

    for (const h of history) {
      const row = document.createElement('div');
      row.className = 'history-row';
      const desc = `${h.change?.type}: ${h.change?.targetId?.split('.').pop() || h.change?.targetId}`;
      const time = new Date(h.createdAt).toLocaleTimeString();

      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.4rem;">
          <input type="checkbox" class="history-checkbox" data-id="${h._id}">
          <div>
            <div style="font-weight:600;font-size:0.75rem;">${desc}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);font-family:var(--font-mono);">${time}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;font-family:var(--font-mono);color:${h.score >= 50 ? '#f97316' : '#10b981'};">${h.score}</div>
          <div style="font-size:0.62rem;color:var(--text-muted);">${h.label}</div>
        </div>
      `;

      const cb = row.querySelector('.history-checkbox');
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          if (state.selectedHistory.size >= 2) {
            e.target.checked = false;
            showToast('You can compare at most 2 simulations.', 'info');
            return;
          }
          state.selectedHistory.add(h._id);
        } else {
          state.selectedHistory.delete(h._id);
        }
        updateCompareButton();
      });

      list.appendChild(row);
    }
  } catch (err) {
    list.innerHTML = `<div style="color:var(--status-broken);font-size:0.7rem;">Error: ${err.message}</div>`;
  }
}

function updateCompareButton() {
  const btn = document.getElementById('btn-compare');
  btn.disabled = state.selectedHistory.size !== 2;
  btn.textContent = `Compare (${state.selectedHistory.size}/2)`;
}

/**
 * Open Side-by-Side Comparison Modal
 */
async function openCompareModal() {
  if (state.selectedHistory.size !== 2) return;
  const [a, b] = Array.from(state.selectedHistory);

  const modal = document.getElementById('modal-compare');
  const body = document.getElementById('compare-modal-body');
  modal.style.display = 'flex';
  body.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary);">Executing MongoDB Aggregation comparison...</div>';

  try {
    const res = await fetch(`/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    const comp = await res.json();
    if (!res.ok) throw new Error(comp.error || 'Comparison failed');

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.85rem;margin-bottom:1rem;">
        <div class="panel-card">
          <div style="font-size:0.7rem;color:var(--text-muted);">Simulation A</div>
          <div style="font-size:0.8rem;font-weight:700;font-family:var(--font-mono);">${comp.simulationA.change?.type} (${comp.simulationA.change?.targetId})</div>
          <div style="font-size:1.3rem;font-weight:800;font-family:var(--font-mono);margin-top:0.25rem;color:${comp.simulationA.score >= 50 ? '#f97316' : '#10b981'};">
            Score: ${comp.simulationA.score} (${comp.simulationA.label})
          </div>
        </div>
        <div class="panel-card">
          <div style="font-size:0.7rem;color:var(--text-muted);">Simulation B</div>
          <div style="font-size:0.8rem;font-weight:700;font-family:var(--font-mono);">${comp.simulationB.change?.type} (${comp.simulationB.change?.targetId})</div>
          <div style="font-size:1.3rem;font-weight:800;font-family:var(--font-mono);margin-top:0.25rem;color:${comp.simulationB.score >= 50 ? '#f97316' : '#10b981'};">
            Score: ${comp.simulationB.score} (${comp.simulationB.label})
          </div>
        </div>
      </div>

      <div style="text-align:center;padding:0.4rem;background:rgba(25,230,161,0.1);border-radius:var(--radius-sm);margin-bottom:1rem;font-size:0.78rem;">
        <strong>Score Difference:</strong> ${comp.scoreDifference > 0 ? `+${comp.scoreDifference} (A higher)` : `${comp.scoreDifference} (B higher)`}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;">
        <div class="panel-card">
          <div class="panel-card-title">Only in A (${comp.counts.onlyInA})</div>
          <div style="max-height:130px;overflow-y:auto;font-size:0.7rem;font-family:var(--font-mono);">
            ${comp.onlyInA.length ? comp.onlyInA.map(x => `<div style="padding:0.15rem 0;color:#ef4444;">${x.name || x.componentId} (${x.status})</div>`).join('') : '<div style="color:var(--text-muted);">None</div>'}
          </div>
        </div>
        <div class="panel-card">
          <div class="panel-card-title">In Both (${comp.counts.inBoth})</div>
          <div style="max-height:130px;overflow-y:auto;font-size:0.7rem;font-family:var(--font-mono);">
            ${comp.inBoth.length ? comp.inBoth.map(x => `<div style="padding:0.15rem 0;">${x.name || x.componentId} <span style="font-size:0.62rem;color:var(--text-muted);">(A:${x.statusA}/B:${x.statusB})</span></div>`).join('') : '<div style="color:var(--text-muted);">None</div>'}
          </div>
        </div>
        <div class="panel-card">
          <div class="panel-card-title">Only in B (${comp.counts.onlyInB})</div>
          <div style="max-height:130px;overflow-y:auto;font-size:0.7rem;font-family:var(--font-mono);">
            ${comp.onlyInB.length ? comp.onlyInB.map(x => `<div style="padding:0.15rem 0;color:#ef4444;">${x.name || x.componentId} (${x.status})</div>`).join('') : '<div style="color:var(--text-muted);">None</div>'}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div style="color:var(--status-broken);text-align:center;">${err.message}</div>`;
  }
}

// ==================== 7. MongoDB Analytics (Chart.js) ====================

/**
 * Load Analytics from /api/projects/:id/analytics
 */
async function loadAnalytics(projectId) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/analytics`);
    const data = await res.json();

    // Chart.js Blast Radius Rankings
    renderBlastChart(data.blastRankings || []);

    // Fragile Components Table
    const fragileTbody = document.querySelector('#fragile-table tbody');
    fragileTbody.innerHTML = '';
    if (!data.fragileComponents || data.fragileComponents.length === 0) {
      fragileTbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;">No data</td></tr>';
    } else {
      for (const fc of data.fragileComponents) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${fc.name || fc.componentId}</strong></td>
          <td>${fc.impactCount}</td>
          <td><span class="status-badge ${fc.worstStatus === 'BROKEN' ? 'badge-broken' : 'badge-at_risk'}">${fc.worstStatus}</span></td>
        `;
        fragileTbody.appendChild(tr);
      }
    }

    // Hotspots Table
    const hotTbody = document.querySelector('#hotspots-table tbody');
    hotTbody.innerHTML = '';
    if (!data.hotspots || data.hotspots.length === 0) {
      hotTbody.innerHTML = '<tr><td colspan="2" style="color:var(--text-muted);text-align:center;">No data</td></tr>';
    } else {
      for (const h of data.hotspots) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${h.name || h.componentId}</strong></td>
          <td>${h.dependentsCount}</td>
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
  const colors = rankings.map(r => r.score >= 75 ? '#ef4444' : r.score >= 50 ? '#f97316' : r.score >= 25 ? '#eab308' : '#19e6a1');

  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['No Data'],
      datasets: [{
        label: 'Blast Score',
        data: scores.length ? scores : [0],
        backgroundColor: colors.length ? colors : ['#334155'],
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { size: 9 } }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 8.5 }, maxRotation: 40 }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

/**
 * Load past events
 */
async function loadEvents(projectId) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/events`);
    const events = await res.json();
    const feed = document.getElementById('compact-event-feed');
    feed.innerHTML = '';
    for (const ev of events) {
      addEventToFeed(ev, false);
    }
  } catch (err) {}
}

// ==================== 8. UI Event Listeners & Presets ====================

function setupEventListeners() {
  // Brand Home Click
  document.getElementById('brand-home-link').addEventListener('click', resetGraphView);
  document.getElementById('btn-reset-view').addEventListener('click', resetGraphView);

  // Project / Version Dropdowns
  document.getElementById('project-select').addEventListener('change', (e) => onProjectChange(e.target.value));
  document.getElementById('version-select').addEventListener('change', (e) => onVersionChange(e.target.value));

  // Color By
  document.getElementById('color-by-select').addEventListener('change', (e) => applyColorBy(e.target.value));

  // Toolbar View Pills (Layout Switcher)
  document.querySelectorAll('.layout-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyLayout(btn.dataset.layout);
    });
  });

  // Toolbar Actions
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    if (state.cy) state.cy.zoom(state.cy.zoom() * 1.25);
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    if (state.cy) state.cy.zoom(state.cy.zoom() * 0.8);
  });
  document.getElementById('btn-fit-graph').addEventListener('click', () => {
    if (state.cy) state.cy.fit(undefined, 35);
  });
  document.getElementById('btn-reset-layout').addEventListener('click', () => {
    applyLayout(state.activeLayout);
  });

  // Flyout Close
  document.getElementById('btn-close-flyout').addEventListener('click', () => {
    document.getElementById('node-flyout').style.display = 'none';
  });

  // Explorer Search & Clear
  const searchInput = document.getElementById('explorer-search');
  searchInput.addEventListener('input', (e) => filterExplorerTree(e.target.value));
  document.getElementById('btn-clear-filter').addEventListener('click', () => {
    searchInput.value = '';
    filterExplorerTree('');
  });

  // Simulate Button
  document.getElementById('btn-simulate').addEventListener('click', runSimulation);

  // Download Report Button
  document.getElementById('btn-download-report').addEventListener('click', downloadReportJSON);

  // Compare Button
  document.getElementById('btn-compare').addEventListener('click', openCompareModal);
  document.getElementById('btn-close-compare-modal').addEventListener('click', () => {
    document.getElementById('modal-compare').style.display = 'none';
  });

  // Tab switching
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Demo Presets
  document.querySelectorAll('.scenario-chip').forEach(chip => {
    chip.addEventListener('click', () => applyPreset(chip.dataset.preset));
  });

  // Demo Actions
  document.getElementById('btn-seed-demo').addEventListener('click', handleSeedDemo);
  document.getElementById('btn-upload-v2').addEventListener('click', handleUploadV2);
  document.getElementById('btn-upload-invalid').addEventListener('click', handleUploadInvalid);

  // File Upload
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('manifest-file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) uploadManifestFile(e.target.files[0]);
  });

  // Scanner Modal (Step 9)
  const scannerModal = document.getElementById('modal-scanner');
  document.getElementById('btn-open-scanner').addEventListener('click', () => {
    scannerModal.style.display = 'flex';
  });
  document.getElementById('btn-close-scanner-modal').addEventListener('click', () => {
    scannerModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-scanner').addEventListener('click', () => {
    scannerModal.style.display = 'none';
  });
  document.getElementById('btn-submit-scanner').addEventListener('click', handleScanSubmit);

  // New Project Modal
  const projectModal = document.getElementById('modal-new-project');
  document.getElementById('btn-new-project').addEventListener('click', () => {
    projectModal.style.display = 'flex';
  });
  document.getElementById('btn-close-project-modal').addEventListener('click', () => {
    projectModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-project').addEventListener('click', () => {
    projectModal.style.display = 'none';
  });
  document.getElementById('btn-create-project-submit').addEventListener('click', handleCreateProjectSubmit);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
}

function setupAccordions() {
  const setupAccordion = (headerId, contentId) => {
    const h = document.getElementById(headerId);
    const c = document.getElementById(contentId);
    h.addEventListener('click', () => {
      const open = c.style.display === 'block';
      c.style.display = open ? 'none' : 'block';
      h.querySelector('span:last-child').textContent = open ? '▾' : '▴';
    });
  };

  setupAccordion('acc-header-reasons', 'acc-content-reasons');
  setupAccordion('acc-header-chains', 'acc-content-chains');
  setupAccordion('acc-header-connections', 'acc-content-connections');
}

function resetGraphView() {
  if (state.cy) {
    state.cy.fit(undefined, 40);
    state.cy.nodes().removeClass('status-target status-BROKEN status-AT_RISK status-UNCERTAIN status-SAFE');
    state.cy.edges().removeClass('highlighted-path');
    applyColorBy(state.colorBy);
    document.getElementById('node-flyout').style.display = 'none';
  }
}

function downloadReportJSON() {
  if (!state.lastSimulation) {
    showToast('No active simulation report.', 'info');
    return;
  }
  const blob = new Blob([JSON.stringify(state.lastSimulation, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bugbound-report-${state.lastSimulation.simulationId || 'sim'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function pickTarget(targetSel, preferredId, fallbackName) {
  if (!targetSel) {
    showToast('Load the ShopLite demo first', 'error');
    return false;
  }
  const options = Array.from(targetSel.options || []);
  const hasPreferred = options.some(opt => opt.value === preferredId);
  if (hasPreferred) {
    targetSel.value = preferredId;
    return true;
  }
  const fallback = (fallbackName || '').toLowerCase();
  if (fallback) {
    const matched = options.find(opt => {
      const text = (opt.text || opt.textContent || '').toLowerCase();
      return text.includes(fallback) || text.includes(fallback.replace(/_/g, '-'));
    });
    if (matched && matched.value) {
      targetSel.value = matched.value;
      return true;
    }
  }
  showToast('Load the ShopLite demo first', 'error');
  return false;
}

function applyPreset(preset) {
  const typeSel = document.getElementById('change-type-select');
  const targetSel = document.getElementById('target-component-select');

  if (preset === 'rename-username') {
    typeSel.value = 'RENAME_FIELD';
    renderParamFields('RENAME_FIELD');
    if (state.graphData) updateTargetOptions(state.graphData.components);
    if (!pickTarget(targetSel, 'db.users.user_name', 'user_name')) return false;
    const from = document.getElementById('param-from');
    const to = document.getElementById('param-to');
    if (from) from.value = 'user_name';
    if (to) to.value = 'username';
    return true;
  } else if (preset === 'delete-email') {
    typeSel.value = 'DELETE_FIELD';
    renderParamFields('DELETE_FIELD');
    if (state.graphData) updateTargetOptions(state.graphData.components);
    if (!pickTarget(targetSel, 'db.users.email', 'email')) return false;
    return true;
  } else if (preset === 'change-timeout') {
    typeSel.value = 'CHANGE_CONFIG';
    renderParamFields('CHANGE_CONFIG');
    if (state.graphData) updateTargetOptions(state.graphData.components);
    if (!pickTarget(targetSel, 'cfg.payment_timeout', 'payment_timeout')) return false;
    const key = document.getElementById('param-key');
    const from = document.getElementById('param-from');
    const to = document.getElementById('param-to');
    if (key) key.value = 'PAYMENT_TIMEOUT';
    if (from) from.value = '30';
    if (to) to.value = '5';
    return true;
  } else if (preset === 'upgrade-payments') {
    typeSel.value = 'UPGRADE_DEPENDENCY_MAJOR';
    renderParamFields('UPGRADE_DEPENDENCY_MAJOR');
    if (state.graphData) updateTargetOptions(state.graphData.components);
    if (!pickTarget(targetSel, 'pkg.payments_sdk', 'payments')) return false;
    const from = document.getElementById('param-from');
    const to = document.getElementById('param-to');
    if (from) from.value = '1.x';
    if (to) to.value = '2.x';
    return true;
  }
  return false;
}

// ==================== 9. Handlers for Demo & File Uploads ====================

async function handleSeedDemo() {
  const btn = document.getElementById('btn-seed-demo');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Loading...';

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
    btn.innerHTML = '⚡ Load ShopLite';
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
      showToast(`Duplicate: version ${data.versionId} already uploaded (Idempotent)`, 'info');
    } else if (res.status === 201) {
      showToast(`Uploaded ShopLite v2: created version ${data.versionId}`, 'success');
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
      showToast(`422 Rejected:\n${(data.reasons || []).join('\n')}`, 'error');
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
    showToast('Please select a project first.', 'error');
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
        showToast(`Manifest uploaded! Version: ${data.versionId}`, 'success');
        await loadVersions(projectId, data.versionId);
      } else if (res.status === 422) {
        showToast(`422 Rejected:\n${(data.reasons || []).join('\n')}`, 'error');
      } else {
        showToast(data.error || 'Upload failed', 'error');
      }
    } catch (parseErr) {
      showToast('Invalid JSON file: ' + parseErr.message, 'error');
    }
  };
  reader.readAsText(file);
}

async function handleScanSubmit() {
  const path = document.getElementById('scanner-path').value.trim() || 'src/App.js';
  const content = document.getElementById('scanner-content').value;
  const btn = document.getElementById('btn-submit-scanner');
  btn.disabled = true;
  btn.textContent = 'Scanning...';

  try {
    const scanRes = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ path, content }] })
    });
    const scanData = await scanRes.json();
    if (!scanRes.ok) throw new Error(scanData.error || 'Scan failed');

    const targetProj = state.currentProject || 'Scanned Project';
    const uploadRes = await fetch(`/api/projects/${encodeURIComponent(targetProj)}/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scanData.manifest)
    });
    const uploadData = await uploadRes.json();

    document.getElementById('modal-scanner').style.display = 'none';
    showToast(`Scanned snippet: ${scanData.componentCount} components, ${scanData.edgeCount} edges`, 'success');
    await loadProjects(targetProj);
    if (uploadData.versionId) {
      await loadVersions(targetProj, uploadData.versionId);
    }
  } catch (err) {
    showToast('Scanner error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Scan & Load Manifest';
  }
}

async function handleCreateProjectSubmit() {
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
}

// ==================== 10. Toasts ====================

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast-msg ${type}`;

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${msg.replace(/\n/g, '<br>')}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}
