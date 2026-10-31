/**
 * public/js/pages/analytics.js — Analytics Page Controller
 * Displays Chart.js charts and MongoDB aggregation analytics tables:
 * - Blast Radius trends across simulations (colored by severity)
 * - Fragile components rankings
 * - Dependency Hotspots table
 */

window.AnalyticsPage = {
  container: null,
  store: null,
  unsubscribe: null,
  blastChart: null,
  fragileChart: null,

  mount(container, store) {
    this.container = container;
    this.store = store;

    this.render();
    this.unsubscribe = store.on('stateChanged', () => this.render());
  },

  unmount() {
    this.destroyCharts();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.container = null;
  },

  destroyCharts() {
    if (this.blastChart) {
      try { this.blastChart.destroy(); } catch (_e) {}
      this.blastChart = null;
    }
    if (this.fragileChart) {
      try { this.fragileChart.destroy(); } catch (_e) {}
      this.fragileChart = null;
    }
  },

  render() {
    if (!this.container) return;
    const { analytics, simulationHistory } = this.store.state;

    const fragileList = analytics?.fragileComponents || [];
    const hotspotsList = analytics?.hotspots || [];
    const hasHistory = simulationHistory && simulationHistory.length > 0;

    this.container.innerHTML = `
      <div class="page-container analytics-page">
        <!-- Header -->
        <div class="page-header-row">
          <div>
            <h2>Architectural Analytics & Vulnerability Rankings</h2>
            <p class="text-secondary">Aggregated risk metrics, blast radius history, and architectural hotspots calculated via MongoDB pipelines.</p>
          </div>
        </div>

        <!-- Row 1: Charts -->
        <div class="analytics-charts-grid">
          <!-- Blast Radius Trends Chart -->
          <div class="panel-card">
            <div class="panel-card-header">
              <span class="panel-card-title">Blast Radius per Simulation</span>
              <span class="text-muted text-xs">${(simulationHistory || []).length} runs recorded</span>
            </div>
            <div class="chart-wrapper">
              <canvas id="chart-blast-trends"></canvas>
            </div>
          </div>

          <!-- Fragile Components Impact Frequency Chart -->
          <div class="panel-card">
            <div class="panel-card-header">
              <span class="panel-card-title">Top Fragile Components (Failure Frequency)</span>
              <span class="badge-tag">Aggregated</span>
            </div>
            <div class="chart-wrapper">
              <canvas id="chart-fragile-components"></canvas>
            </div>
          </div>
        </div>

        <!-- Row 2: Tables -->
        <div class="analytics-tables-grid">
          <!-- Fragile Components Table -->
          <div class="panel-card">
            <div class="panel-card-header">
              <span class="panel-card-title">🛡️ Fragile Components Ranking</span>
              <span class="text-muted text-xs">Components most frequently broken or at risk</span>
            </div>
            ${fragileList.length === 0 ? `
              <div class="empty-list-notice">No failure history recorded yet. Run simulations to generate fragility rankings.</div>
            ` : `
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Component ID</th>
                      <th>Type</th>
                      <th>Total Hits</th>
                      <th>Worst Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${fragileList.map(item => `
                      <tr>
                        <td class="text-mono font-bold">${item._id || item.componentId}</td>
                        <td><span class="code-chip">${item.type || 'component'}</span></td>
                        <td class="text-mono font-bold">${item.hits || item.count || 1}</td>
                        <td><span class="status-badge badge-${(item.worstStatus || 'at_risk').toLowerCase()}">${item.worstStatus || 'AT_RISK'}</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <!-- Hotspots Table -->
          <div class="panel-card">
            <div class="panel-card-header">
              <span class="panel-card-title">🔥 Structural Dependency Hotspots</span>
              <span class="text-muted text-xs">Components with the most dependents (high blast potential)</span>
            </div>
            ${hotspotsList.length === 0 ? `
              <div class="empty-list-notice">No hotspot data available.</div>
            ` : `
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Type</th>
                      <th>Inbound Dependents</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${hotspotsList.map(h => `
                      <tr>
                        <td class="text-mono font-bold">${h.componentId || h._id}</td>
                        <td><span class="code-chip">${h.type || 'field'}</span></td>
                        <td class="text-mono font-bold" style="color: var(--accent-green);">${h.dependentsCount || h.dependents || 0}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    setTimeout(() => this.initCharts(), 50);
  },

  initCharts() {
    if (!window.Chart) return;
    this.destroyCharts();

    const { simulationHistory, analytics } = this.store.state;

    // 1. Blast Radius per Simulation Chart
    const blastCanvas = document.getElementById('chart-blast-trends');
    if (blastCanvas && simulationHistory && simulationHistory.length > 0) {
      const reversedSims = [...simulationHistory].reverse();
      const labels = reversedSims.map((s, i) => `#${i + 1} ${(s.change?.type || s.changeType || 'SIM').slice(0, 10)}`);
      const dataPoints = reversedSims.map(s => s.score ?? 0);
      const bgColors = reversedSims.map(s => {
        const score = s.score ?? 0;
        if (score >= 70) return '#ff4d4d';
        if (score >= 40) return '#ff9f43';
        if (score >= 20) return '#ffd84d';
        return '#19e6a1';
      });

      this.blastChart = new window.Chart(blastCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Blast Radius Score',
            data: dataPoints,
            backgroundColor: bgColors,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              grid: { color: '#1c2636' },
              ticks: { color: '#94a3b8' }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono' } }
            }
          }
        }
      });
    }

    // 2. Fragile Components Bar Chart
    const fragileCanvas = document.getElementById('chart-fragile-components');
    const fragileData = analytics?.fragileComponents || [];
    if (fragileCanvas && fragileData.length > 0) {
      const topFragile = fragileData.slice(0, 6);
      const labels = topFragile.map(f => (f._id || f.componentId).split('.').pop());
      const counts = topFragile.map(f => f.hits || f.count || 1);

      this.fragileChart = new window.Chart(fragileCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Times Impacted',
            data: counts,
            backgroundColor: '#06b6d4',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1, color: '#94a3b8' },
              grid: { color: '#1c2636' }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono' } }
            }
          }
        }
      });
    }
  }
};
