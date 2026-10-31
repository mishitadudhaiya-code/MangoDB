/**
 * public/js/pages/graph.js — Graph Explorer Page Controller
 * Styled after Image 2 left:
 * - Dark dot-grid canvas
 * - Glowing warm orange circular nodes sized by criticality and dependents
 * - Curved green semi-transparent edges with arrowheads converging on hub
 * - Dynamic dashed edges
 * - Hover highlight of node + neighbors with rest dimmed
 * - Floating toolbar (zoom, fit, reset, layouts: Force, Concentric, Layered)
 * - "Color by" selector (Type / Criticality / Status)
 * - Search filter & Collapsible Component Explorer tree
 * - Right node details drawer
 * - "Show impact" toggle with animated ripple wave from target outward
 */

window.GraphPage = {
  container: null,
  store: null,
  unsubscribe: null,
  cy: null,
  activeLayout: 'cose',
  colorBy: 'type',
  showImpact: false,
  rippleTimer: null,
  selectedNode: null,

  mount(container, store) {
    this.container = container;
    this.store = store;
    this.colorBy = store.state.colorBy || 'type';

    this.render();
    this.unsubscribe = store.on('stateChanged', () => {
      this.updateGraphData();
    });
  },

  unmount() {
    if (this.rippleTimer) {
      clearInterval(this.rippleTimer);
      this.rippleTimer = null;
    }
    if (this.cy) {
      try { this.cy.destroy(); } catch (_e) {}
      this.cy = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.container = null;
  },

  render() {
    if (!this.container) return;
    const { graphData, currentSimulation } = this.store.state;

    const compCount = graphData?.components?.length || 0;
    const edgeCount = graphData?.edges?.length || 0;
    const affectedCount = currentSimulation?.affected?.length || 0;

    this.container.innerHTML = `
      <div class="graph-explorer-layout">
        <!-- Collapsible Left Explorer Tree Sidebar -->
        <aside class="graph-sidebar-left" id="graph-sidebar-left">
          <div class="explorer-header">
            <span class="panel-card-title-sm">Component Explorer</span>
            <button id="btn-toggle-graph-tree" class="btn btn-ghost btn-xs">◀</button>
          </div>

          <div class="explorer-search-box">
            <input type="text" id="graph-tree-search" class="form-input text-sm" placeholder="Filter components...">
          </div>

          <div class="explorer-color-row">
            <span class="text-xs text-muted">Color Nodes By:</span>
            <select id="graph-color-by" class="select-compact text-xs">
              <option value="type" ${this.colorBy === 'type' ? 'selected' : ''}>Type (Warm Hues)</option>
              <option value="criticality" ${this.colorBy === 'criticality' ? 'selected' : ''}>Criticality (1-5)</option>
              <option value="status" ${this.colorBy === 'status' ? 'selected' : ''}>Simulation Status</option>
            </select>
          </div>

          <div id="graph-tree-container" class="explorer-tree-scroll">
            <!-- Dynamically populated tree -->
          </div>

          <!-- Color Legend -->
          <div class="graph-legend-box">
            <span class="legend-title">Legend</span>
            <div id="graph-legend-items" class="legend-items-grid"></div>
          </div>
        </aside>

        <!-- Center Graph Viewport -->
        <div class="graph-center-viewport">
          <!-- Floating Toolbar -->
          <div class="graph-floating-toolbar">
            <div class="layout-toggle-group">
              <button class="btn-layout-pill ${this.activeLayout === 'cose' ? 'active' : ''}" data-layout="cose">Force</button>
              <button class="btn-layout-pill ${this.activeLayout === 'breadthfirst' ? 'active' : ''}" data-layout="breadthfirst">Layered</button>
              <button class="btn-layout-pill ${this.activeLayout === 'concentric' ? 'active' : ''}" data-layout="concentric">Concentric</button>
            </div>

            <div class="toolbar-divider"></div>

            <button id="btn-graph-zoom-in" class="toolbar-btn" title="Zoom In">+</button>
            <button id="btn-graph-zoom-out" class="toolbar-btn" title="Zoom Out">−</button>
            <button id="btn-graph-fit" class="toolbar-btn" title="Fit Graph">⛶ Fit</button>
            <button id="btn-graph-rerun" class="toolbar-btn" title="Run Layout">↺</button>

            <div class="toolbar-divider"></div>

            <!-- Impact Ripple Toggle -->
            <label class="impact-toggle-label" title="Toggle simulation status colors and ripple chain reaction">
              <input type="checkbox" id="toggle-show-impact" ${this.showImpact ? 'checked' : ''} ${!currentSimulation ? 'disabled' : ''}>
              <span class="toggle-slider"></span>
              <span class="toggle-text">Show Impact</span>
            </label>
          </div>

          <!-- Cytoscape Canvas with dark dot grid -->
          <div id="cy-main" class="cytoscape-main-canvas"></div>

          <!-- Bottom Left Info Chips -->
          <div class="graph-bottom-chips">
            <span class="graph-chip">${compCount} components</span>
            <span class="graph-chip">${edgeCount} edges</span>
            <span class="graph-chip chip-affected" id="graph-chip-affected">${affectedCount} affected</span>
          </div>

          <!-- Animation Banner HUD (when ripple is playing) -->
          <div id="ripple-banner" class="ripple-hud-banner" style="display: none;">
            <span class="indicator-dot green"></span>
            <span id="ripple-text">Chain Reaction Wave: Propagating...</span>
          </div>
        </div>

        <!-- Right Node Details Drawer -->
        <aside class="graph-sidebar-right" id="graph-sidebar-right">
          <div class="drawer-header">
            <span class="panel-card-title-sm">Node Details</span>
            <button id="btn-close-node-drawer" class="close-x-btn">×</button>
          </div>
          <div id="graph-node-details" class="drawer-body">
            <div class="drawer-empty-hint">
              Hover or click any node in the graph to inspect incoming/outgoing dependencies and impact status.
            </div>
          </div>
        </aside>
      </div>
    `;

    this.bindEvents();
    this.renderLegend();
    this.renderExplorerTree();

    if (graphData && graphData.components && graphData.components.length > 0) {
      setTimeout(() => this.initCytoscape(graphData), 50);
    } else {
      const cyEl = document.getElementById('cy-main');
      if (cyEl) {
        cyEl.innerHTML = `
          <div class="graph-empty-overlay">
            <div class="empty-state-card" style="max-width: 380px;">
              <div class="empty-state-icon">🌐</div>
              <h3>No Dependency Graph Loaded</h3>
              <p>Load the ShopLite demo or upload a manifest to explore the architecture graph.</p>
              <button class="btn btn-glowing-green" onclick="location.hash='#/dashboard'">Go to Dashboard</button>
            </div>
          </div>
        `;
      }
    }
  },

  bindEvents() {
    // Tree collapse toggle
    const toggleTreeBtn = document.getElementById('btn-toggle-graph-tree');
    const leftSidebar = document.getElementById('graph-sidebar-left');
    if (toggleTreeBtn && leftSidebar) {
      toggleTreeBtn.onclick = () => {
        leftSidebar.classList.toggle('collapsed');
        toggleTreeBtn.textContent = leftSidebar.classList.contains('collapsed') ? '▶' : '◀';
        if (this.cy) setTimeout(() => this.cy.resize(), 200);
      };
    }

    // Color by select
    const colorSelect = document.getElementById('graph-color-by');
    if (colorSelect) {
      colorSelect.onchange = () => {
        this.colorBy = colorSelect.value;
        this.store.setState({ colorBy: this.colorBy });
        this.renderLegend();
        this.applyNodeColors();
      };
    }

    // Tree search
    const treeSearch = document.getElementById('graph-tree-search');
    if (treeSearch) {
      treeSearch.oninput = () => this.renderExplorerTree(treeSearch.value.trim().toLowerCase());
    }

    // Layout pills
    const layoutPills = this.container.querySelectorAll('.btn-layout-pill');
    layoutPills.forEach(pill => {
      pill.onclick = () => {
        layoutPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeLayout = pill.getAttribute('data-layout');
        this.runLayout(this.activeLayout);
      };
    });

    // Toolbar buttons
    const zoomIn = document.getElementById('btn-graph-zoom-in');
    if (zoomIn) zoomIn.onclick = () => { if (this.cy) this.cy.zoom(this.cy.zoom() * 1.25); };

    const zoomOut = document.getElementById('btn-graph-zoom-out');
    if (zoomOut) zoomOut.onclick = () => { if (this.cy) this.cy.zoom(this.cy.zoom() * 0.8); };

    const fitBtn = document.getElementById('btn-graph-fit');
    if (fitBtn) fitBtn.onclick = () => { if (this.cy) this.cy.fit(null, 50); };

    const rerunBtn = document.getElementById('btn-graph-rerun');
    if (rerunBtn) rerunBtn.onclick = () => this.runLayout(this.activeLayout);

    // Impact toggle
    const impactToggle = document.getElementById('toggle-show-impact');
    if (impactToggle) {
      impactToggle.onchange = () => {
        this.showImpact = impactToggle.checked;
        if (this.showImpact) {
          this.triggerRippleAnimation();
        } else {
          this.applyNodeColors();
        }
      };
    }

    // Close details drawer
    const closeDrawerBtn = document.getElementById('btn-close-node-drawer');
    const rightSidebar = document.getElementById('graph-sidebar-right');
    if (closeDrawerBtn && rightSidebar) {
      closeDrawerBtn.onclick = () => {
        rightSidebar.classList.remove('open');
      };
    }
  },

  renderLegend() {
    const el = document.getElementById('graph-legend-items');
    if (!el) return;

    if (this.colorBy === 'status' || this.showImpact) {
      el.innerHTML = `
        <div class="legend-badge"><span class="legend-swatch" style="background: #4da3ff;"></span> Target</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #ff4d4d;"></span> Broken</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #ff9f43;"></span> At Risk</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #ffd84d; border: 1px dashed #fff;"></span> Uncertain</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #2ecc71;"></span> Safe</div>
      `;
    } else if (this.colorBy === 'criticality') {
      el.innerHTML = `
        <div class="legend-badge"><span class="legend-swatch" style="background: #ff4d4d;"></span> 5 (Critical)</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #ff9f43;"></span> 4 (High)</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #ffd84d;"></span> 3 (Medium)</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #06b6d4;"></span> 2 (Low-Mid)</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #19e6a1;"></span> 1 (Low)</div>
      `;
    } else {
      // Default: Type palette (Warm hues per spec)
      el.innerHTML = `
        <div class="legend-badge"><span class="legend-swatch" style="background: #f59e0b;"></span> Field</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #a855f7;"></span> API</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #06b6d4;"></span> Function</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #38bdf8;"></span> Page</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #ec4899;"></span> Service</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #94a3b8;"></span> Config</div>
        <div class="legend-badge"><span class="legend-swatch" style="background: #f43f5e;"></span> Package</div>
      `;
    }
  },

  renderExplorerTree(filter = '') {
    const container = document.getElementById('graph-tree-container');
    if (!container) return;

    const { graphData } = this.store.state;
    if (!graphData || !graphData.components || graphData.components.length === 0) {
      container.innerHTML = '<div class="text-muted text-xs" style="padding: 1rem; text-align: center;">No components loaded</div>';
      return;
    }

    // Group by type
    const groups = {};
    graphData.components.forEach(c => {
      const t = c.type || 'other';
      if (!groups[t]) groups[t] = [];
      if (!filter || c.name.toLowerCase().includes(filter) || c.id.toLowerCase().includes(filter)) {
        groups[t].push(c);
      }
    });

    const types = Object.keys(groups).sort();
    let html = '';

    types.forEach(t => {
      const items = groups[t];
      if (items.length === 0) return;

      html += `
        <div class="tree-type-group">
          <div class="tree-group-header">
            <span class="tree-folder-icon">▾</span>
            <span class="tree-type-label text-mono">${t} (${items.length})</span>
          </div>
          <div class="tree-group-items">
            ${items.map(item => `
              <div class="tree-item-row" data-id="${item.id}">
                <span class="tree-item-dot" style="background: ${this.getTypeColor(item.type).border};"></span>
                <span class="tree-item-name text-mono">${item.name}</span>
                <span class="tree-item-crit">${item.criticality || 1}★</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html || '<div class="text-muted text-xs" style="padding: 1rem; text-align: center;">No matching components</div>';

    // Click item in tree
    const rows = container.querySelectorAll('.tree-item-row');
    rows.forEach(row => {
      row.onclick = () => {
        const id = row.getAttribute('data-id');
        this.focusNode(id);
      };
    });
  },

  getTypeColor(type) {
    const palette = {
      field: { bg: '#b45309', border: '#f59e0b' },
      api: { bg: '#6b21a8', border: '#a855f7' },
      function: { bg: '#0e7490', border: '#06b6d4' },
      page: { bg: '#0369a1', border: '#38bdf8' },
      service: { bg: '#be185d', border: '#ec4899' },
      config: { bg: '#334155', border: '#94a3b8' },
      package: { bg: '#9f1239', border: '#f43f5e' }
    };
    return palette[type] || { bg: '#374151', border: '#9ca3af' };
  },

  initCytoscape(graphData) {
    const cyEl = document.getElementById('cy-main');
    if (!cyEl || !window.cytoscape) return;

    if (this.cy) {
      try { this.cy.destroy(); } catch (_e) {}
    }

    // Build elements
    const elements = [];
    const inboundCounts = {};
    (graphData.edges || []).forEach(e => {
      inboundCounts[e.to] = (inboundCounts[e.to] || 0) + 1;
    });

    (graphData.components || []).forEach(c => {
      const inCount = inboundCounts[c.id] || 0;
      const size = Math.max(26, Math.min(64, 22 + (c.criticality || 1) * 5 + inCount * 3));
      elements.push({
        data: {
          id: c.id,
          name: c.name || c.id,
          type: c.type || 'field',
          criticality: c.criticality || 1,
          inboundCount: inCount,
          size: size
        }
      });
    });

    (graphData.edges || []).forEach((e, idx) => {
      elements.push({
        data: {
          id: `e-${idx}-${e.from}->${e.to}`,
          source: e.from,
          target: e.to,
          kind: e.kind || 'calls',
          dynamic: !!e.dynamic
        }
      });
    });

    try {
      this.cy = window.cytoscape({
        container: cyEl,
        elements: elements,
        boxSelectionEnabled: false,
        style: [
          // Base Node Style: Glowing warm circular nodes
          {
            selector: 'node',
            style: {
              'width': 'data(size)',
              'height': 'data(size)',
              'label': 'data(name)',
              'color': '#cbd5e1',
              'font-size': '10px',
              'font-family': 'JetBrains Mono, monospace',
              'text-valign': 'bottom',
              'text-margin-y': 5,
              'background-color': '#d97706',
              'border-width': 2,
              'border-color': '#f59e0b',
              'transition-property': 'background-color, border-color, opacity, width, height',
              'transition-duration': '0.2s'
            }
          },
          // Base Edge Style: Thin curved green semi-transparent
          {
            selector: 'edge',
            style: {
              'width': 1.5,
              'line-color': 'rgba(25, 230, 161, 0.4)',
              'target-arrow-color': 'rgba(25, 230, 161, 0.7)',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 0.8,
              'transition-property': 'line-color, opacity, width',
              'transition-duration': '0.2s'
            }
          },
          // Dynamic edges: dashed
          {
            selector: 'edge[?dynamic]',
            style: {
              'line-style': 'dashed',
              'line-dash-pattern': [4, 4],
              'line-color': 'rgba(255, 216, 77, 0.5)',
              'target-arrow-color': 'rgba(255, 216, 77, 0.8)'
            }
          },
          // Dimmed class
          {
            selector: '.dimmed',
            style: {
              'opacity': 0.12
            }
          },
          // Highlighted class
          {
            selector: '.highlighted',
            style: {
              'opacity': 1,
              'border-width': 3,
              'border-color': '#ffffff'
            }
          },
          {
            selector: 'edge.highlighted',
            style: {
              'opacity': 1,
              'width': 3,
              'line-color': '#19e6a1',
              'target-arrow-color': '#19e6a1'
            }
          },
          // Simulation Status Classes
          {
            selector: '.status-target',
            style: {
              'background-color': '#1d4ed8',
              'border-color': '#4da3ff',
              'border-width': 4
            }
          },
          {
            selector: '.status-broken',
            style: {
              'background-color': '#991b1b',
              'border-color': '#ff4d4d',
              'border-width': 3
            }
          },
          {
            selector: '.status-at-risk',
            style: {
              'background-color': '#9a3412',
              'border-color': '#ff9f43',
              'border-width': 3
            }
          },
          {
            selector: '.status-uncertain',
            style: {
              'background-color': '#854d0e',
              'border-color': '#ffd84d',
              'border-style': 'dashed',
              'border-width': 3
            }
          },
          {
            selector: '.status-safe',
            style: {
              'background-color': '#14532d',
              'border-color': '#2ecc71',
              'opacity': 0.4
            }
          }
        ],
        layout: {
          name: this.activeLayout,
          animate: true,
          animationDuration: 400,
          fit: true,
          padding: 40
        }
      });

      this.setupCytoscapeEvents();
      this.applyNodeColors();
    } catch (err) {
      console.error('Cytoscape init error:', err);
    }
  },

  setupCytoscapeEvents() {
    if (!this.cy) return;

    // Hover: highlight node + neighbors and dim rest
    this.cy.on('mouseover', 'node', (e) => {
      const node = e.target;
      const neighborhood = node.neighborhood().add(node);
      this.cy.elements().addClass('dimmed');
      neighborhood.removeClass('dimmed').addClass('highlighted');
    });

    this.cy.on('mouseout', 'node', () => {
      this.cy.elements().removeClass('dimmed').removeClass('highlighted');
    });

    // Node Click: open details drawer
    this.cy.on('tap', 'node', (e) => {
      const node = e.target;
      this.selectedNode = node;
      this.openNodeDrawer(node.id());
    });

    // Canvas click: close drawer if clicked background
    this.cy.on('tap', (e) => {
      if (e.target === this.cy) {
        const rightSidebar = document.getElementById('graph-sidebar-right');
        if (rightSidebar) rightSidebar.classList.remove('open');
      }
    });
  },

  runLayout(layoutName) {
    if (!this.cy) return;
    try {
      this.cy.layout({
        name: layoutName,
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 50
      }).run();
    } catch (err) {
      console.warn('Layout run error:', err);
    }
  },

  applyNodeColors() {
    if (!this.cy) return;

    this.cy.batch(() => {
      // Clear status classes first
      this.cy.nodes().removeClass('status-target status-broken status-at-risk status-uncertain status-safe');

      this.cy.nodes().forEach(node => {
        const type = node.data('type');
        const criticality = node.data('criticality');

        if (this.colorBy === 'criticality') {
          const critPalette = {
            1: { bg: '#064e3b', border: '#19e6a1' },
            2: { bg: '#155e75', border: '#06b6d4' },
            3: { bg: '#854d0e', border: '#ffd84d' },
            4: { bg: '#9a3412', border: '#ff9f43' },
            5: { bg: '#991b1b', border: '#ff4d4d' }
          };
          const c = critPalette[criticality] || critPalette[1];
          node.style({ 'background-color': c.bg, 'border-color': c.border });
        } else if (this.colorBy === 'status') {
          const sim = this.store.state.currentSimulation;
          const targetId = sim?.change?.targetId || sim?.target;
          if (node.id() === targetId) {
            node.addClass('status-target');
          } else {
            const affectedItem = sim?.affected?.find(a => (a.componentId || a.id) === node.id());
            if (affectedItem) {
              node.addClass(`status-${affectedItem.status.toLowerCase()}`);
            } else {
              node.addClass('status-safe');
            }
          }
        } else {
          // Default: type colors with warm glowing borders
          const c = this.getTypeColor(type);
          node.style({ 'background-color': c.bg, 'border-color': c.border });
        }
      });
    });
  },

  triggerRippleAnimation() {
    if (!this.cy) return;
    const sim = this.store.state.currentSimulation;
    if (!sim) {
      window.showToast('Run a simulation first to see impact ripple', 'warning');
      return;
    }

    const targetId = sim.change?.targetId || sim.target;
    const targetNode = this.cy.getElementById(targetId);
    if (!targetNode || targetNode.empty()) return;

    const banner = document.getElementById('ripple-banner');
    const bannerText = document.getElementById('ripple-text');
    if (banner) banner.style.display = 'flex';

    // Group affected by depth
    const affected = sim.affected || [];
    const depthGroups = {};
    affected.forEach(a => {
      const d = a.depth || 1;
      if (!depthGroups[d]) depthGroups[d] = [];
      depthGroups[d].push(a);
    });

    const depths = Object.keys(depthGroups).map(Number).sort((a, b) => a - b);
    const maxDepth = depths.length > 0 ? Math.max(...depths) : 1;

    // Reset everything to dimmed
    this.cy.batch(() => {
      this.cy.elements().removeClass('status-target status-broken status-at-risk status-uncertain status-safe highlighted');
      this.cy.elements().addClass('dimmed');
    });

    // Step 0: Target flashes
    if (bannerText) bannerText.textContent = `Ripple Wave: Target [${targetId}] modified`;
    targetNode.removeClass('dimmed').addClass('status-target highlighted');
    targetNode.animate({
      style: { 'width': targetNode.data('size') * 1.5, 'height': targetNode.data('size') * 1.5 },
      duration: 300
    });

    let currentStep = 0;
    if (this.rippleTimer) clearInterval(this.rippleTimer);

    this.rippleTimer = setInterval(() => {
      currentStep++;
      if (currentStep > maxDepth) {
        clearInterval(this.rippleTimer);
        this.rippleTimer = null;
        if (bannerText) bannerText.textContent = `Ripple Complete: ${affected.length} components impacted across ${maxDepth} levels`;
        setTimeout(() => {
          if (banner) banner.style.display = 'none';
        }, 2500);
        return;
      }

      if (bannerText) bannerText.textContent = `Ripple Wave: Propagating Depth ${currentStep}...`;

      const depthItems = depthGroups[currentStep] || [];
      this.cy.batch(() => {
        depthItems.forEach(item => {
          const node = this.cy.getElementById(item.componentId || item.id);
          if (node && !node.empty()) {
            node.removeClass('dimmed');
            node.addClass(`status-${item.status.toLowerCase()}`);
            node.addClass('highlighted');

            // Light up edges connected from previous depth / target
            node.connectedEdges().forEach(e => {
              e.removeClass('dimmed').addClass('highlighted');
            });
          }
        });
      });
    }, 600);
  },

  focusNode(nodeId) {
    if (!this.cy) return;
    const node = this.cy.getElementById(nodeId);
    if (!node || node.empty()) return;

    this.cy.center(node);
    this.cy.zoom(1.8);

    const neighborhood = node.neighborhood().add(node);
    this.cy.elements().addClass('dimmed');
    neighborhood.removeClass('dimmed').addClass('highlighted');

    setTimeout(() => {
      this.cy.elements().removeClass('dimmed').removeClass('highlighted');
    }, 1500);

    this.openNodeDrawer(nodeId);
  },

  openNodeDrawer(nodeId) {
    const drawer = document.getElementById('graph-sidebar-right');
    const detailsBox = document.getElementById('graph-node-details');
    if (!drawer || !detailsBox) return;

    drawer.classList.add('open');

    const { graphData, currentSimulation } = this.store.state;
    const comp = graphData?.components?.find(c => c.id === nodeId);
    if (!comp) return;

    // Incoming & Outgoing edges
    const incoming = (graphData?.edges || []).filter(e => e.to === nodeId);
    const outgoing = (graphData?.edges || []).filter(e => e.from === nodeId);

    // Simulation impact info
    const affectedItem = currentSimulation?.affected?.find(a => (a.componentId || a.id) === nodeId);
    const isTarget = (currentSimulation?.change?.targetId || currentSimulation?.target) === nodeId;

    detailsBox.innerHTML = `
      <div class="drawer-content-box">
        <div class="drawer-field">
          <span class="drawer-label">Component Name</span>
          <span class="text-mono font-bold" style="font-size: 0.95rem;">${comp.name}</span>
          <span class="text-muted text-xs text-mono">${comp.id}</span>
        </div>

        <div class="drawer-field">
          <span class="drawer-label">Classification</span>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <span class="code-chip">${comp.type}</span>
            <span class="text-xs">Criticality: <strong>${comp.criticality || 1}/5</strong></span>
          </div>
        </div>

        ${isTarget ? `
          <div class="drawer-field alert-box-info">
            <strong>🎯 Origin Target:</strong> This component is the primary target of the active simulation.
          </div>
        ` : affectedItem ? `
          <div class="drawer-field" style="border-top: 1px solid var(--border-subtle); padding-top: 0.5rem;">
            <span class="drawer-label">Simulation Impact</span>
            <div style="display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.3rem;">
              <span class="status-pill pill-${affectedItem.status.toLowerCase()}">${affectedItem.status}</span>
              <span class="text-xs text-muted">Depth ${affectedItem.depth || 1}</span>
            </div>
            <div class="drawer-reason-box">${affectedItem.reason}</div>
            <div class="drawer-rec-box">${affectedItem.recommendation}</div>
          </div>
        ` : ''}

        <div class="drawer-field">
          <span class="drawer-label">Inbound Dependents (${incoming.length})</span>
          <div class="drawer-conn-list">
            ${incoming.length === 0 ? '<div class="text-muted text-xs">No inbound dependents (Root/Leaf)</div>' : incoming.map(e => `
              <div class="conn-item text-mono text-xs">
                <span>←</span> <span>${e.from}</span> <span class="text-muted">(${e.kind})</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="drawer-field">
          <span class="drawer-label">Outbound Dependencies (${outgoing.length})</span>
          <div class="drawer-conn-list">
            ${outgoing.length === 0 ? '<div class="text-muted text-xs">No outbound dependencies</div>' : outgoing.map(e => `
              <div class="conn-item text-mono text-xs">
                <span>→</span> <span>${e.to}</span> <span class="text-muted">${e.dynamic ? '[dynamic]' : `(${e.kind})`}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  updateGraphData() {
    const { graphData } = this.store.state;
    if (graphData && (!this.cy || this.cy.elements().length === 0)) {
      this.initCytoscape(graphData);
      this.renderExplorerTree();
    }
  }
};
