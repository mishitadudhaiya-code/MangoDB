/**
 * public/js/pages/chain.js — Chain Reaction Page Controller
 * Reproduces the visual cascading flow from Image 1:
 * [Change Detected] -> Arrow -> [Target Component] -> Arrow -> [Depth Levels (2-col grid)]
 * -> [Final Impact Report Card] with side drawer for inspection and JSON report download.
 */

window.ChainPage = {
  container: null,
  store: null,
  unsubscribe: null,
  selectedComponent: null,

  mount(container, store) {
    this.container = container;
    this.store = store;

    this.render();
    this.unsubscribe = store.on('stateChanged', () => this.render());
  },

  unmount() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.container = null;
  },

  render() {
    if (!this.container) return;
    const { currentSimulation, graphData, lastCachedHit } = this.store.state;

    if (!currentSimulation) {
      this.container.innerHTML = `
        <div class="page-container">
          <div class="empty-state-card">
            <div class="empty-state-icon">⚡</div>
            <h3>No Simulation Available</h3>
            <p>Run a simulation on your dependency graph to visualize the cascade of breaking changes.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 1rem;">
              <button class="btn btn-glowing-green" onclick="location.hash='#/simulate'">Go to Simulator</button>
              <button class="btn btn-outline-cyan" onclick="location.hash='#/dashboard'">View Dashboard</button>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const sim = currentSimulation;
    const changeType = sim.change?.type || sim.changeType || 'UNKNOWN_CHANGE';
    const targetId = sim.change?.targetId || sim.target || 'unknown.target';
    const params = sim.change?.params || sim.params || {};
    const score = sim.score ?? sim.blastRadius?.score ?? 0;
    const label = sim.label ?? sim.blastRadius?.label ?? 'LOW';
    const affected = sim.affected || [];
    const counts = sim.counts || {
      broken: affected.filter(a => a.status === 'BROKEN').length,
      atRisk: affected.filter(a => a.status === 'AT_RISK').length,
      uncertain: affected.filter(a => a.status === 'UNCERTAIN').length,
      safe: 0
    };

    // Calculate SAFE nodes from graphData components not in affected and not target
    const allComponents = graphData?.components || [];
    const affectedIds = new Set(affected.map(a => a.componentId || a.id));
    affectedIds.add(targetId);

    const safeNodes = allComponents.filter(c => !affectedIds.has(c.id));
    const safeDisplayCount = 4;
    const safeSample = safeNodes.slice(0, safeDisplayCount);
    const extraSafeCount = Math.max(0, safeNodes.length - safeDisplayCount);

    // Group affected nodes by depth
    const depthGroups = {};
    affected.forEach(item => {
      const d = item.depth || 1;
      if (!depthGroups[d]) depthGroups[d] = [];
      depthGroups[d].push(item);
    });

    const depths = Object.keys(depthGroups).map(Number).sort((a, b) => a - b);
    const maxDepth = depths.length > 0 ? Math.max(...depths) : 1;

    // Change summary text
    let changeSummary = changeType;
    if (changeType === 'RENAME_FIELD') {
      changeSummary = `${params.from || targetId.split('.').pop()} → ${params.newName || params.to || 'username'}`;
    } else if (changeType === 'CHANGE_CONFIG') {
      changeSummary = `${params.key || 'CONFIG'} = ${params.newVal || params.to || 'updated'}`;
    } else if (changeType === 'UPGRADE_DEPENDENCY_MAJOR') {
      changeSummary = `upgrade to ${params.toVersion || '2.0.0'}`;
    } else if (changeType === 'DELETE_FIELD' || changeType === 'DELETE_ENDPOINT') {
      changeSummary = `deleted ${targetId.split('.').pop()}`;
    }

    this.container.innerHTML = `
      <div class="page-container chain-reaction-page">
        <!-- Top Title Row & Disclaimer -->
        <div class="page-header-row">
          <div class="header-titles">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <h2>Chain Reaction Flow</h2>
              ${lastCachedHit ? '<span class="badge-cached">⚡ Cached</span>' : ''}
            </div>
            <p class="text-secondary">Step-by-step propagation trace from the origin change to all affected leaves.</p>
          </div>
          <div class="disclaimer-banner">
            ⚠️ Estimates from a static dependency model, not guarantees.
          </div>
        </div>

        <div class="chain-layout-wrapper">
          <!-- Flow Column -->
          <div class="chain-flow-column">

            <!-- Card 1: Red-tinted CHANGE DETECTED Card -->
            <div class="chain-card change-detected-card">
              <div class="change-tag-pill">CHANGE DETECTED</div>
              <div class="change-title text-mono">${changeSummary}</div>
              <div class="change-meta">
                <span>Type: <strong>${changeType}</strong></span>
                <span>Timestamp: <strong>${new Date(sim.createdAt || Date.now()).toLocaleTimeString()}</strong></span>
              </div>
            </div>

            <!-- Down Arrow -->
            <div class="chain-flow-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
            </div>

            <!-- Card 2: Target Component Card -->
            <div class="chain-card target-component-card">
              <div class="target-badge-pill">TARGET COMPONENT</div>
              <div class="target-name text-mono">${targetId}</div>
              <div class="target-desc">
                ${this.getTargetDescription(changeType, params)}
              </div>
            </div>

            <!-- Down Arrow -->
            <div class="chain-flow-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
            </div>

            <!-- Depth Groups -->
            ${depths.map(depth => {
              const items = depthGroups[depth] || [];
              return `
                <div class="depth-level-section">
                  <div class="depth-level-label">
                    <span>Depth ${depth}</span>
                    <span class="depth-count-chip">${items.length} node${items.length !== 1 ? 's' : ''}</span>
                  </div>

                  <div class="chain-cards-grid">
                    ${items.map((item, idx) => `
                      <div class="chain-node-card status-${item.status.toLowerCase()}"
                        data-node-id="${item.componentId || item.id}"
                        style="animation-delay: ${(depth * 150 + idx * 75)}ms;">
                        <div class="node-card-top">
                          <span class="status-pill pill-${item.status.toLowerCase()}">${item.status}</span>
                          <span class="text-mono node-name-title">${item.componentId || item.id}</span>
                        </div>
                        <div class="node-reason-line">${item.reason || 'Impacted via dependency propagation.'}</div>
                        <div class="node-card-foot">
                          <span class="view-detail-hint">Click to inspect recommendation ↗</span>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>

                <!-- Down Arrow between depth levels -->
                <div class="chain-flow-arrow">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <polyline points="19 12 12 19 5 12"></polyline>
                  </svg>
                </div>
              `;
            }).join('')}

            <!-- Safe Components Section -->
            <div class="depth-level-section safe-section">
              <div class="depth-level-label">
                <span>Safe Components</span>
                <span class="depth-count-chip chip-safe">${safeNodes.length} unaffected</span>
              </div>

              <div class="chain-cards-grid">
                ${safeSample.map((safeNode, idx) => `
                  <div class="chain-node-card status-safe"
                    data-node-id="${safeNode.id}"
                    style="animation-delay: ${(maxDepth * 150 + idx * 60)}ms;">
                    <div class="node-card-top">
                      <span class="status-pill pill-safe">SAFE</span>
                      <span class="text-mono node-name-title">${safeNode.name || safeNode.id}</span>
                    </div>
                    <div class="node-reason-line">Doesn't use this field/change.</div>
                  </div>
                `).join('')}
              </div>

              ${extraSafeCount > 0 ? `
                <div class="extra-safe-notice">
                  +${extraSafeCount} more safe components in system topology.
                </div>
              ` : ''}
            </div>

            <!-- Down Arrow to Final Report -->
            <div class="chain-flow-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
            </div>

            <!-- Card 4: Final Impact Report Card -->
            <div class="chain-card final-impact-card">
              <div class="impact-report-header">
                <span class="impact-badge-tag">FINAL IMPACT REPORT</span>
                <button id="btn-download-chain-json" class="btn btn-outline-cyan btn-sm">
                  📥 Download Report JSON
                </button>
              </div>

              <div class="impact-summary-headline">
                <span class="text-broken-big">${counts.broken} broken</span>,
                <span class="text-at-risk">${counts.atRisk || 0} at risk</span>,
                <span class="text-uncertain">${counts.uncertain || 0} needs manual review</span>
              </div>

              <div class="impact-stats-row">
                <div class="impact-stat-item">
                  <span class="stat-big-num" style="color: ${this.getLabelColor(label)};">${score}</span>
                  <span class="stat-sub-label">Blast Score</span>
                </div>
                <div class="impact-stat-item">
                  <span class="status-badge badge-${label.toLowerCase()}">${label} IMPACT</span>
                  <span class="stat-sub-label">Severity Level</span>
                </div>
                <div class="impact-stat-item">
                  <span class="stat-big-num">${maxDepth}</span>
                  <span class="stat-sub-label">Levels Deep</span>
                </div>
              </div>
            </div>

          </div>

          <!-- Drawer / Inspection Sidebar -->
          <aside class="chain-detail-drawer" id="chain-detail-drawer">
            <div class="drawer-header">
              <h3>Component Inspection</h3>
              <button id="btn-close-chain-drawer" class="close-x-btn">×</button>
            </div>
            <div id="chain-drawer-body" class="drawer-body">
              <div class="drawer-empty-hint">
                Click any component card in the chain reaction flow to inspect its path, root cause, and recommendations.
              </div>
            </div>
          </aside>
        </div>
      </div>
    `;

    this.bindEvents();
  },

  getTargetDescription(changeType, params) {
    if (changeType === 'RENAME_FIELD') {
      return `Field will be renamed to "${params.newName || 'new_name'}". Direct references without mapping will fail.`;
    }
    if (changeType === 'DELETE_FIELD') {
      return 'Field will be removed from all documents. Dependent services and queries will resolve undefined.';
    }
    if (changeType === 'CHANGE_CONFIG') {
      return `Config value changed to "${params.newVal || 'new_val'}". Timeout or connection constraints updated.`;
    }
    if (changeType === 'UPGRADE_DEPENDENCY_MAJOR') {
      return `External package upgraded to "${params.toVersion || '2.0.0'}". Deprecated APIs will throw at runtime.`;
    }
    return 'Origin component of the proposed system modification.';
  },

  getLabelColor(label) {
    if (label === 'CRITICAL') return 'var(--status-broken)';
    if (label === 'HIGH') return 'var(--status-at-risk)';
    if (label === 'MEDIUM') return 'var(--status-uncertain)';
    return 'var(--accent-green)';
  },

  bindEvents() {
    // Download report button
    const dlBtn = document.getElementById('btn-download-chain-json');
    if (dlBtn) {
      dlBtn.onclick = () => {
        const sim = this.store.state.currentSimulation;
        if (!sim) return;
        const blob = new Blob([JSON.stringify(sim, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bugbound-report-${sim.simulationId || sim._id || 'sim'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.showToast('Impact report downloaded', 'success');
      };
    }

    // Node card click for drawer
    const nodeCards = this.container.querySelectorAll('.chain-node-card');
    nodeCards.forEach(card => {
      card.addEventListener('click', () => {
        const nodeId = card.getAttribute('data-node-id');
        this.openDrawer(nodeId);
      });
    });

    // Close drawer
    const closeBtn = document.getElementById('btn-close-chain-drawer');
    if (closeBtn) {
      closeBtn.onclick = () => {
        const drawer = document.getElementById('chain-detail-drawer');
        if (drawer) drawer.classList.remove('drawer-open');
      };
    }
  },

  openDrawer(nodeId) {
    const drawer = document.getElementById('chain-detail-drawer');
    const body = document.getElementById('chain-drawer-body');
    if (!drawer || !body) return;

    drawer.classList.add('drawer-open');

    const sim = this.store.state.currentSimulation;
    const affectedItem = sim?.affected?.find(a => (a.componentId || a.id) === nodeId);
    const comp = this.store.state.graphData?.components?.find(c => c.id === nodeId);

    const status = affectedItem?.status || 'SAFE';
    const reason = affectedItem?.reason || "This component does not directly or indirectly consume the target resource.";
    const recommendation = affectedItem?.recommendation || (status === 'SAFE' ? 'No code changes required.' : 'Audit usage and update imports/call-sites before deploy.');
    const path = affectedItem?.path || [sim?.target || sim?.change?.targetId, nodeId];

    body.innerHTML = `
      <div class="drawer-content-box">
        <div class="drawer-field">
          <span class="drawer-label">Component ID</span>
          <span class="text-mono font-bold">${nodeId}</span>
        </div>
        <div class="drawer-field">
          <span class="drawer-label">Status</span>
          <span class="status-pill pill-${status.toLowerCase()}">${status}</span>
        </div>
        ${comp ? `
          <div class="drawer-field">
            <span class="drawer-label">Type & Criticality</span>
            <span><strong class="code-chip">${comp.type}</strong> — Criticality ${comp.criticality || 1}/5</span>
          </div>
        ` : ''}

        <div class="drawer-field">
          <span class="drawer-label">Propagation Reason</span>
          <div class="drawer-reason-box">${reason}</div>
        </div>

        <div class="drawer-field">
          <span class="drawer-label">Dependency Chain Path</span>
          <div class="chain-path-trace">
            ${path.map((step, i) => `
              <div class="chain-step-row">
                <span class="step-num">${i + 1}</span>
                <span class="step-id text-mono">${step}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="drawer-field">
          <span class="drawer-label">Action Recommendation</span>
          <div class="drawer-rec-box">${recommendation}</div>
        </div>
      </div>
    `;
  }
};
