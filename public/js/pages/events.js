/**
 * public/js/pages/events.js — Live Audit Feed Page Controller
 * Displays full-width SSE event stream with status dots (ok / duplicate / rejected),
 * status filter, pause/resume controls, and reconnection indicator.
 */

window.EventsPage = {
  container: null,
  store: null,
  unsubscribe: null,
  statusFilter: 'ALL',
  isPaused: false,

  mount(container, store) {
    this.container = container;
    this.store = store;
    this.isPaused = store.isPausedEvents;

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
    const { events, sseConnected } = this.store.state;

    let filtered = events || [];
    if (this.statusFilter !== 'ALL') {
      filtered = filtered.filter(e => (e.status || 'ok').toUpperCase() === this.statusFilter);
    }

    this.container.innerHTML = `
      <div class="page-container events-page">
        <!-- Header & Controls -->
        <div class="page-header-row">
          <div>
            <h2>Live Audit Stream & Event Monitor</h2>
            <p class="text-secondary">Real-time audit log of manifest uploads, graph versions, simulation runs, and validation rejections.</p>
          </div>

          <div class="events-controls-row">
            <!-- Connection indicator -->
            <div class="sse-status-badge ${sseConnected ? 'connected' : 'disconnected'}">
              <span class="indicator-dot ${sseConnected ? 'green' : 'yellow'}"></span>
              <span>${sseConnected ? 'Stream Connected' : 'Reconnecting...'}</span>
            </div>

            <!-- Pause / Resume Button -->
            <button id="btn-toggle-pause-events" class="btn ${this.isPaused ? 'btn-glowing-green' : 'btn-ghost'} btn-sm">
              ${this.isPaused ? '▶ Resume Stream' : '⏸ Pause Stream'}
            </button>
          </div>
        </div>

        <!-- Filter Bar -->
        <div class="panel-card" style="padding: 0.6rem 1rem;">
          <div class="filter-pills-row">
            <span class="text-xs text-muted">Filter by Status:</span>
            <button class="filter-pill ${this.statusFilter === 'ALL' ? 'active' : ''}" data-status="ALL">All (${(events || []).length})</button>
            <button class="filter-pill ${this.statusFilter === 'OK' ? 'active' : ''}" data-status="OK">OK</button>
            <button class="filter-pill ${this.statusFilter === 'DUPLICATE' ? 'active' : ''}" data-status="DUPLICATE">Duplicates</button>
            <button class="filter-pill ${this.statusFilter === 'REJECTED' ? 'active' : ''}" data-status="REJECTED">Rejected</button>
          </div>
        </div>

        <!-- Events List -->
        <div class="panel-card">
          <div class="panel-card-header">
            <span class="panel-card-title">Live Audit Stream</span>
            <span class="text-muted text-xs">${filtered.length} events matching filter</span>
          </div>

          ${filtered.length === 0 ? `
            <div class="empty-list-notice">
              ${(events || []).length === 0 ? 'Awaiting audit events from server...' : 'No events match the selected filter.'}
            </div>
          ` : `
            <div class="full-events-feed">
              ${filtered.map(ev => {
                const status = (ev.status || 'ok').toLowerCase();
                const dotColor = status === 'rejected' ? 'red' : status === 'duplicate' ? 'yellow' : 'green';
                const timeStr = new Date(ev.timestamp || Date.now()).toLocaleTimeString();

                return `
                  <div class="event-feed-row status-${status}">
                    <div class="event-row-left">
                      <span class="indicator-dot ${dotColor}"></span>
                      <span class="event-type-chip text-mono">${ev.type}</span>
                      <span class="status-pill pill-${status}">${ev.status || 'ok'}</span>
                    </div>

                    <div class="event-row-middle">
                      <span class="event-project text-mono">${ev.project || ev.projectId || ''}</span>
                      <span class="event-details-text">${this.formatEventDetails(ev)}</span>
                    </div>

                    <div class="event-row-right">
                      <span class="event-time text-mono">${timeStr}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    this.bindEvents();
  },

  formatEventDetails(ev) {
    if (ev.details) {
      if (typeof ev.details === 'string') return ev.details;
      const d = ev.details;
      if (d.simulationId) return `Sim: ${d.simulationId.slice(0, 8)}... (Score: ${d.score}, Affected: ${d.affectedCount || 0})`;
      if (d.versionId) return `Version: ${d.versionId.slice(0, 8)}... (${d.componentsCount || 0} comps)`;
      return JSON.stringify(d);
    }
    return ev.summary || '';
  },

  bindEvents() {
    // Filter pills
    const pills = this.container.querySelectorAll('.filter-pill');
    pills.forEach(pill => {
      pill.onclick = () => {
        this.statusFilter = pill.getAttribute('data-status');
        this.render();
      };
    });

    // Pause / Resume
    const pauseBtn = document.getElementById('btn-toggle-pause-events');
    if (pauseBtn) {
      pauseBtn.onclick = () => {
        this.isPaused = this.store.togglePauseEvents();
        window.showToast(this.isPaused ? 'Live feed paused' : 'Live feed resumed', 'info');
        this.render();
      };
    }
  }
};
