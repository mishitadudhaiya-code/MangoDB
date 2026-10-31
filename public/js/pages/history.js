/**
 * public/js/pages/history.js — History & Compare Page Controller
 * Displays all past simulations with sorting, multi-selection (exactly 2),
 * and a side-by-side diff comparing "Only in A", "Both", and "Only in B".
 */

window.HistoryPage = {
  container: null,
  store: null,
  unsubscribe: null,
  selectedSimIds: new Set(),
  sortBy: 'date',
  sortAsc: false,
  comparisonData: null,

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
    const { simulationHistory, currentSimulation } = this.store.state;

    let items = [...(simulationHistory || [])];

    // Sorting
    items.sort((a, b) => {
      if (this.sortBy === 'score') {
        return this.sortAsc ? a.score - b.score : b.score - a.score;
      }
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return this.sortAsc ? timeA - timeB : timeB - timeA;
    });

    this.container.innerHTML = `
      <div class="page-container history-page">
        <!-- Header Row -->
        <div class="page-header-row">
          <div>
            <h2>Simulation History & Impact Comparison</h2>
            <p class="text-secondary">Audit previous what-if runs, inspect scores, and compare two runs side-by-side.</p>
          </div>
          <div class="history-actions-row">
            <button id="btn-compare-sims" class="btn btn-glowing-green" ${this.selectedSimIds.size !== 2 ? 'disabled' : ''}>
              ⚖️ Compare Selected (${this.selectedSimIds.size}/2)
            </button>
          </div>
        </div>

        <!-- Comparison Result Container (if active) -->
        <div id="comparison-result-area" class="comparison-result-box" style="display: ${this.comparisonData ? 'block' : 'none'};">
          ${this.comparisonData ? this.renderComparisonView() : ''}
        </div>

        <!-- Table Card -->
        <div class="panel-card">
          <div class="panel-card-header">
            <div class="sort-controls-row">
              <span class="panel-card-title">Past Simulations (${items.length})</span>
              <div class="sort-buttons">
                <button class="btn btn-ghost btn-sm ${this.sortBy === 'date' ? 'active-sort' : ''}" id="sort-date-btn">
                  Sort Date ${this.sortBy === 'date' ? (this.sortAsc ? '▲' : '▼') : ''}
                </button>
                <button class="btn btn-ghost btn-sm ${this.sortBy === 'score' ? 'active-sort' : ''}" id="sort-score-btn">
                  Sort Score ${this.sortBy === 'score' ? (this.sortAsc ? '▲' : '▼') : ''}
                </button>
              </div>
            </div>
            <span class="text-muted text-sm">Select 2 checkboxes to compare</span>
          </div>

          ${items.length === 0 ? `
            <div class="empty-list-notice">
              No simulations have been recorded for this project yet.<br>
              <a href="#/simulate" class="link-action" style="margin-top: 0.5rem; display: inline-block;">Go to Simulator →</a>
            </div>
          ` : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width: 40px;">Select</th>
                    <th>Change Type</th>
                    <th>Target Component</th>
                    <th>Score</th>
                    <th>Severity</th>
                    <th>Broken / At Risk / Uncertain</th>
                    <th>Executed At</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(sim => {
                    const sid = sim.simulationId || sim._id || sim.id;
                    const isChecked = this.selectedSimIds.has(sid);
                    const isCurrent = currentSimulation && (currentSimulation.simulationId || currentSimulation._id || currentSimulation.id) === sid;
                    const changeType = sim.change?.type || sim.changeType;
                    const target = sim.change?.targetId || sim.target;
                    const broken = sim.counts?.broken ?? (sim.affected?.filter(a => a.status === 'BROKEN').length || 0);
                    const atRisk = sim.counts?.atRisk ?? (sim.affected?.filter(a => a.status === 'AT_RISK').length || 0);
                    const uncertain = sim.counts?.uncertain ?? (sim.affected?.filter(a => a.status === 'UNCERTAIN').length || 0);

                    return `
                      <tr class="history-row ${isCurrent ? 'row-active-sim' : ''}" data-sim-id="${sid}">
                        <td>
                          <input type="checkbox" class="sim-checkbox" data-sim-id="${sid}" ${isChecked ? 'checked' : ''}>
                        </td>
                        <td>
                          <span class="code-chip">${changeType}</span>
                          ${sim.status === 'cached' ? '<span class="badge-cached-xs">cached</span>' : ''}
                        </td>
                        <td class="text-mono font-bold">${target}</td>
                        <td class="text-mono font-bold" style="color: ${this.getScoreColor(sim.score)}">${sim.score}</td>
                        <td><span class="status-badge badge-${(sim.label || 'LOW').toLowerCase()}">${sim.label}</span></td>
                        <td>
                          <span class="text-broken">${broken}B</span> /
                          <span class="text-at-risk">${atRisk}R</span> /
                          <span class="text-uncertain">${uncertain}U</span>
                        </td>
                        <td class="text-muted">${new Date(sim.createdAt || Date.now()).toLocaleString()}</td>
                        <td>
                          <button class="btn btn-ghost btn-xs btn-load-sim" data-sim-id="${sid}">
                            ${isCurrent ? '✓ Active' : 'Load'}
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;

    this.bindEvents();
  },

  getScoreColor(score) {
    if (score >= 70) return 'var(--status-broken)';
    if (score >= 40) return 'var(--status-at-risk)';
    if (score >= 20) return 'var(--status-uncertain)';
    return 'var(--accent-green)';
  },

  bindEvents() {
    // Checkbox toggling
    const checkboxes = this.container.querySelectorAll('.sim-checkbox');
    checkboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const sid = cb.getAttribute('data-sim-id');
        if (cb.checked) {
          if (this.selectedSimIds.size >= 2) {
            cb.checked = false;
            window.showToast('You can compare at most 2 simulations. Uncheck one first.', 'warning');
            return;
          }
          this.selectedSimIds.add(sid);
        } else {
          this.selectedSimIds.delete(sid);
        }
        this.render();
      });
    });

    // Sort buttons
    const dateBtn = document.getElementById('sort-date-btn');
    if (dateBtn) {
      dateBtn.onclick = () => {
        if (this.sortBy === 'date') this.sortAsc = !this.sortAsc;
        else { this.sortBy = 'date'; this.sortAsc = false; }
        this.render();
      };
    }

    const scoreBtn = document.getElementById('sort-score-btn');
    if (scoreBtn) {
      scoreBtn.onclick = () => {
        if (this.sortBy === 'score') this.sortAsc = !this.sortAsc;
        else { this.sortBy = 'score'; this.sortAsc = false; }
        this.render();
      };
    }

    // Load simulation row button
    const loadBtns = this.container.querySelectorAll('.btn-load-sim, .history-row');
    loadBtns.forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const sid = el.getAttribute('data-sim-id');
        const found = this.store.state.simulationHistory.find(s => (s.simulationId || s._id || s.id) === sid);
        if (found) {
          this.store.setState({ currentSimulation: found });
          window.showToast(`Simulation ${sid.slice(0, 8)} set as active`, 'info');
        }
      });
    });

    // Compare Button
    const compareBtn = document.getElementById('btn-compare-sims');
    if (compareBtn) {
      compareBtn.onclick = async () => {
        if (this.selectedSimIds.size !== 2) return;
        const [idA, idB] = Array.from(this.selectedSimIds);
        compareBtn.disabled = true;
        compareBtn.textContent = 'Comparing...';
        try {
          const comp = await this.store.compareSimulations(idA, idB);
          this.comparisonData = comp;
          this.render();
          window.showToast('Comparison computed successfully!', 'success');
        } catch (err) {
          window.showToast('Comparison failed: ' + err.message, 'error');
        } finally {
          compareBtn.disabled = false;
          compareBtn.textContent = `⚖️ Compare Selected (${this.selectedSimIds.size}/2)`;
        }
      };
    }

    // Close comparison view
    const closeCompBtn = document.getElementById('btn-close-comparison');
    if (closeCompBtn) {
      closeCompBtn.onclick = () => {
        this.comparisonData = null;
        this.render();
      };
    }
  },

  renderComparisonView() {
    const data = this.comparisonData;
    if (!data) return '';

    const simA = data.simulationA || data.simA || {};
    const simB = data.simulationB || data.simB || {};
    const scoreDiff = data.scoreDifference ?? data.scoreDiff ?? 0;
    const onlyInA = data.onlyInA || [];
    const onlyInB = data.onlyInB || [];
    const inBoth = data.inBoth || [];

    return `
      <div class="panel-card" style="border: 1px solid var(--accent-cyan); background: rgba(56, 189, 248, 0.03);">
        <div class="panel-card-header">
          <div>
            <h3 style="color: var(--accent-cyan); font-size: 1rem;">Side-by-Side Impact Comparison</h3>
            <span class="text-secondary text-sm">
              Score Difference: <strong class="text-mono" style="color: ${scoreDiff > 0 ? 'var(--status-broken)' : 'var(--accent-green)'}">
                ${scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff} pts
              </strong>
            </span>
          </div>
          <button id="btn-close-comparison" class="btn btn-ghost btn-sm">Close Diff ✕</button>
        </div>

        <div class="comparison-summary-row">
          <div class="comp-col-header">
            <span class="text-mono font-bold">${simA.change?.type || simA.changeType}</span>
            <span class="text-muted text-xs">Target: ${simA.change?.targetId || simA.target} (Score: ${simA.score})</span>
          </div>
          <div class="comp-col-header" style="text-align: center;">
            <span class="badge-tag">Shared / Overlap</span>
          </div>
          <div class="comp-col-header" style="text-align: right;">
            <span class="text-mono font-bold">${simB.change?.type || simB.changeType}</span>
            <span class="text-muted text-xs">Target: ${simB.change?.targetId || simB.target} (Score: ${simB.score})</span>
          </div>
        </div>

        <!-- 3 Columns: Only in A | Both | Only in B -->
        <div class="compare-3-col-grid">
          <!-- Only in A -->
          <div class="compare-col">
            <div class="compare-col-title">Only in Run A (${(onlyInA || []).length})</div>
            <div class="compare-items-box">
              ${(onlyInA || []).length === 0 ? '<div class="text-muted text-xs">None</div>' : (onlyInA || []).map(item => `
                <div class="compare-item-card">
                  <span class="status-pill pill-${(item.status || 'safe').toLowerCase()}">${item.status || 'BROKEN'}</span>
                  <span class="text-mono text-sm">${item.componentId || item.id || item}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- In Both -->
          <div class="compare-col">
            <div class="compare-col-title">Shared in Both (${(inBoth || []).length})</div>
            <div class="compare-items-box">
              ${(inBoth || []).length === 0 ? '<div class="text-muted text-xs">No overlapping components</div>' : (inBoth || []).map(item => `
                <div class="compare-item-card">
                  <span class="status-pill pill-${(item.statusA || item.status || 'safe').toLowerCase()}">${item.statusA || item.status || 'AT_RISK'}</span>
                  <span class="text-mono text-sm">${item.componentId || item.id || item}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Only in B -->
          <div class="compare-col">
            <div class="compare-col-title">Only in Run B (${(onlyInB || []).length})</div>
            <div class="compare-items-box">
              ${(onlyInB || []).length === 0 ? '<div class="text-muted text-xs">None</div>' : (onlyInB || []).map(item => `
                <div class="compare-item-card">
                  <span class="status-pill pill-${(item.status || 'safe').toLowerCase()}">${item.status || 'BROKEN'}</span>
                  <span class="text-mono text-sm">${item.componentId || item.id || item}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }
};
