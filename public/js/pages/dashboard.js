/**
 * public/js/pages/dashboard.js — Dashboard Page Controller
 * Displays: 2x2 stats, circular blast score ring, mini graph preview,
 * last 5 simulations, last 5 live audit events, and quick actions.
 */

window.DashboardPage = {
  container: null,
  store: null,
  unsubscribe: null,
  miniCy: null,

  mount(container, store) {
    this.container = container;
    this.store = store;

    this.render();
    this.unsubscribe = store.on('stateChanged', () => this.render());
  },

  unmount() {
    if (this.miniCy) {
      try { this.miniCy.destroy(); } catch (_e) {}
      this.miniCy = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.container = null;
  },

  render() {
    if (!this.container) return;
    const { selectedProject, graphData, currentSimulation, simulationHistory, events } = this.store.state;

    // Component counts
    const compCount = graphData?.components?.length || 0;
    const edgeCount = graphData?.edges?.length || 0;
    const simCount = simulationHistory?.length || 0;
    const uncertainCount = currentSimulation?.uncertainCount || currentSimulation?.affected?.filter(a => a.status === 'UNCERTAIN').length || 0;

    // Blast score
    const hasSim = !!currentSimulation;
    const score = hasSim ? (currentSimulation.blastRadius?.score ?? currentSimulation.score ?? 0) : 0;
    const label = hasSim ? (currentSimulation.blastRadius?.label ?? currentSimulation.label ?? 'LOW') : 'No Sim Yet';
    const circumference = 2 * Math.PI * 45;
    const dashOffset = hasSim ? circumference - (score / 100) * circumference : circumference;

    let labelColor = 'var(--text-muted)';
    if (hasSim) {
      if (score >= 70) labelColor = 'var(--status-broken)';
      else if (score >= 40) labelColor = 'var(--status-at-risk)';
      else if (score >= 20) labelColor = 'var(--status-uncertain)';
      else labelColor = 'var(--accent-green)';
    }

    const lastSims = (simulationHistory || []).slice(0, 5);
    const lastEvents = (events || []).slice(0, 5);

    this.container.innerHTML = `
      <div class="page-container dashboard-page">
        <!-- Top welcome & Quick Actions banner -->
        <div class="dashboard-header-card">
          <div class="dashboard-header-text">
            <h2>System Health & Blast Intelligence</h2>
            <p>Active Project: <span class="text-mono highlight-project">${selectedProject ? selectedProject.name : 'None Selected'}</span></p>
          </div>
          <div class="dashboard-quick-actions">
            <button id="btn-dash-load-demo" class="btn btn-glowing-green">
              ⚡ Load ShopLite Demo
            </button>
            <button id="btn-dash-run-example" class="btn btn-primary" ${!selectedProject ? 'disabled' : ''}>
              🚀 Run Example (rename user_name)
            </button>
            <button id="btn-dash-upload" class="btn btn-outline-cyan">
              📦 Upload Manifest
            </button>
          </div>
        </div>

        <!-- Row 1: Blast Score Ring + Stat Cards + Mini Graph Preview -->
        <div class="dashboard-grid-3">
          <!-- Blast Radius Ring -->
          <div class="panel-card dashboard-card">
            <div class="panel-card-header">
              <span class="panel-card-title">Blast Radius Score</span>
              ${this.store.state.lastCachedHit ? '<span class="badge-cached">⚡ Cached</span>' : ''}
            </div>
            <div class="score-ring-wrapper">
              <svg class="score-ring-svg" viewBox="0 0 100 100">
                <circle class="score-ring-bg" cx="50" cy="50" r="45"></circle>
                <circle class="score-ring-fill" cx="50" cy="50" r="45"
                  style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${dashOffset}; stroke: ${labelColor};">
                </circle>
              </svg>
              <div class="score-ring-inner">
                <span class="score-number" style="color: ${labelColor}">${hasSim ? score : '--'}</span>
                <span class="score-status-badge" style="color: ${labelColor}">${label}</span>
              </div>
            </div>
            <div class="dashboard-card-foot">
              ${hasSim ? `
                <span>Propagates ${currentSimulation.maxDepth || currentSimulation.blastRadius?.maxDepth || 1} levels deep</span>
                <a href="#/chain" class="link-action">Inspect Chain →</a>
              ` : '<span>Run a simulation to assess impact</span>'}
            </div>
          </div>

          <!-- 2x2 Stat Cards -->
          <div class="panel-card dashboard-card">
            <div class="panel-card-header">
              <span class="panel-card-title">Graph Architecture Stats</span>
              <a href="#/graph" class="link-action">Full Explorer →</a>
            </div>
            <div class="stat-grid-2x2">
              <div class="stat-cell">
                <span class="stat-cell-value">${compCount}</span>
                <span class="stat-cell-label">Components</span>
              </div>
              <div class="stat-cell">
                <span class="stat-cell-value">${edgeCount}</span>
                <span class="stat-cell-label">Edges</span>
              </div>
              <div class="stat-cell">
                <span class="stat-cell-value">${simCount}</span>
                <span class="stat-cell-label">Simulations</span>
              </div>
              <div class="stat-cell">
                <span class="stat-cell-value" style="color: var(--status-uncertain);">${uncertainCount}</span>
                <span class="stat-cell-label">Uncertain (Dynamic)</span>
              </div>
            </div>
            <div class="dashboard-card-foot">
              <span>Static Dependency Topology</span>
            </div>
          </div>

          <!-- Mini Graph Preview -->
          <div class="panel-card dashboard-card mini-graph-card">
            <div class="panel-card-header">
              <span class="panel-card-title">Topology Topology Preview</span>
              <span class="badge-tag">${compCount} nodes</span>
            </div>
            <div id="mini-graph-canvas" class="mini-graph-canvas">
              ${compCount === 0 ? `
                <div class="mini-graph-empty">No components loaded</div>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Row 2: Recent Simulations + Recent Live Events -->
        <div class="dashboard-grid-2">
          <!-- Recent Simulations -->
          <div class="panel-card">
            <div class="panel-card-header">
              <span class="panel-card-title">Recent What-If Simulations</span>
              <a href="#/history" class="link-action">View All (${simCount}) →</a>
            </div>
            ${lastSims.length === 0 ? `
              <div class="empty-list-notice">No simulations run yet on this project.</div>
            ` : `
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Change</th>
                      <th>Target</th>
                      <th>Score</th>
                      <th>Impact</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${lastSims.map(sim => `
                      <tr class="table-row-clickable" data-sim-id="${sim._id || sim.id}">
                        <td><span class="code-chip">${sim.changeType}</span></td>
                        <td class="text-mono">${sim.target}</td>
                        <td class="text-mono font-bold">${sim.score}</td>
                        <td><span class="status-badge badge-${(sim.label || 'LOW').toLowerCase()}">${sim.label}</span></td>
                        <td><a href="#/chain" class="link-action view-sim-btn" data-id="${sim._id || sim.id}">View</a></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <!-- Recent Events -->
          <div class="panel-card">
            <div class="panel-card-header">
              <span class="panel-card-title">Live Audit Stream</span>
              <a href="#/events" class="link-action">Live Monitor →</a>
            </div>
            ${lastEvents.length === 0 ? `
              <div class="empty-list-notice">Waiting for events from server...</div>
            ` : `
              <div class="compact-feed-list">
                ${lastEvents.map(ev => `
                  <div class="feed-item">
                    <span class="indicator-dot ${ev.status === 'rejected' ? 'red' : ev.status === 'duplicate' ? 'yellow' : 'green'}"></span>
                    <span class="feed-type text-mono">${ev.type}</span>
                    <span class="feed-summary">${ev.summary || ev.project || ''}</span>
                    <span class="feed-time">${new Date(ev.timestamp || Date.now()).toLocaleTimeString()}</span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    if (graphData && graphData.components && graphData.components.length > 0) {
      this.initMiniGraph(graphData);
    }
  },

  bindEvents() {
    // Load Demo button
    const loadDemoBtn = document.getElementById('btn-dash-load-demo');
    if (loadDemoBtn) {
      loadDemoBtn.onclick = async () => {
        loadDemoBtn.disabled = true;
        loadDemoBtn.textContent = 'Loading...';
        try {
          await this.store.seedShopLite();
          window.showToast('ShopLite Demo project loaded successfully!', 'success');
        } catch (err) {
          window.showToast(err.message, 'error');
        } finally {
          loadDemoBtn.disabled = false;
          loadDemoBtn.textContent = '⚡ Load ShopLite Demo';
        }
      };
    }

    // Run example simulation
    const runExBtn = document.getElementById('btn-dash-run-example');
    if (runExBtn) {
      runExBtn.onclick = async () => {
        const { selectedVersion } = this.store.state;
        if (!selectedVersion) {
          window.showToast('Please load ShopLite demo first', 'warning');
          return;
        }
        runExBtn.disabled = true;
        runExBtn.textContent = 'Simulating...';
        try {
          const { isCached } = await this.store.runSimulation(
            selectedVersion._id,
            'RENAME_FIELD',
            'db.users.user_name',
            { newName: 'username' }
          );
          window.showToast(isCached ? 'Simulation loaded from cache!' : 'Simulation completed!', 'success');
          window.location.hash = '#/chain';
        } catch (err) {
          window.showToast(err.message, 'error');
        } finally {
          runExBtn.disabled = false;
          runExBtn.textContent = '🚀 Run Example (rename user_name)';
        }
      };
    }

    // Upload button
    const uploadBtn = document.getElementById('btn-dash-upload');
    if (uploadBtn) {
      uploadBtn.onclick = () => {
        window.location.hash = '#/simulate';
      };
    }

    // Click on row to set currentSimulation
    const simRows = this.container.querySelectorAll('.view-sim-btn, .table-row-clickable');
    simRows.forEach(el => {
      el.addEventListener('click', (e) => {
        const simId = el.getAttribute('data-sim-id') || el.getAttribute('data-id');
        const found = this.store.state.simulationHistory.find(s => (s._id || s.id) === simId);
        if (found) {
          this.store.setState({ currentSimulation: found });
        }
      });
    });
  },

  initMiniGraph(graphData) {
    const miniEl = document.getElementById('mini-graph-canvas');
    if (!miniEl || !window.cytoscape) return;

    if (this.miniCy) {
      try { this.miniCy.destroy(); } catch (_e) {}
    }

    const elements = [];
    const comps = (graphData.components || []).slice(0, 30);
    const compIds = new Set(comps.map(c => c.id));

    comps.forEach(c => {
      elements.push({
        data: { id: c.id, label: c.name || c.id, type: c.type }
      });
    });

    (graphData.edges || []).forEach(e => {
      if (compIds.has(e.from) && compIds.has(e.to)) {
        elements.push({
          data: { id: `${e.from}->${e.to}`, source: e.from, target: e.to }
        });
      }
    });

    try {
      this.miniCy = window.cytoscape({
        container: miniEl,
        elements,
        userZoomingEnabled: false,
        userPanningEnabled: false,
        boxSelectionEnabled: false,
        style: [
          {
            selector: 'node',
            style: {
              'width': 10,
              'height': 10,
              'background-color': '#19e6a1',
              'border-width': 1,
              'border-color': '#ffffff',
              'label': ''
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 1,
              'line-color': '#1c3d3d',
              'curve-style': 'bezier',
              'target-arrow-shape': 'none'
            }
          }
        ],
        layout: {
          name: 'cose',
          animate: false,
          fit: true,
          padding: 8
        }
      });
    } catch (err) {
      console.warn('Mini Cytoscape render error:', err);
    }
  }
};
