/**
 * public/js/store.js — BugBound Central Application Store & API Service
 * Manages shared state, reactive subscriptions, sessionStorage caching,
 * and client-server REST/SSE communications.
 */

class EventEmitter {
  constructor() {
    this.events = {};
  }
  on(event, listener) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
    return () => this.off(event, listener);
  }
  off(event, listener) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(l => l !== listener);
  }
  emit(event, data) {
    if (this.events[event]) {
      this.events[event].forEach(listener => {
        try { listener(data); } catch (e) { console.error('Listener error:', e); }
      });
    }
  }
}

class BugBoundStore extends EventEmitter {
  constructor() {
    super();

    // Session cache retrieval with try/catch
    let cached = {};
    try {
      const raw = sessionStorage.getItem('bugbound_state');
      if (raw) cached = JSON.parse(raw);
    } catch (_e) {
      console.warn('sessionStorage not available or parse failed');
    }

    this.state = {
      projects: [],
      selectedProject: cached.selectedProject || null,
      versions: [],
      selectedVersion: cached.selectedVersion || null,
      graphData: null,
      currentSimulation: cached.currentSimulation || null,
      simulationHistory: [],
      analytics: null,
      events: [],
      colorBy: cached.colorBy || 'type',
      activeLayout: 'cose',
      dbConnected: false,
      sseConnected: false,
      lastCachedHit: false
    };

    this.eventSource = null;
    this.isPausedEvents = false;
  }

  saveSession() {
    try {
      sessionStorage.setItem('bugbound_state', JSON.stringify({
        selectedProject: this.state.selectedProject,
        selectedVersion: this.state.selectedVersion,
        currentSimulation: this.state.currentSimulation,
        colorBy: this.state.colorBy
      }));
    } catch (_e) {}
  }

  setState(partial) {
    Object.assign(this.state, partial);
    this.saveSession();
    this.emit('stateChanged', this.state);
  }

  // ==================== API HELPERS ====================

  async checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      const dbConnected = data.db === 'up';
      this.setState({ dbConnected });
      return dbConnected;
    } catch (err) {
      this.setState({ dbConnected: false });
      return false;
    }
  }

  async loadProjects() {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const projects = await res.json();
      let selectedProject = this.state.selectedProject;
      
      // Auto-select first project if none selected or selected does not exist
      if (projects.length > 0) {
        const found = projects.find(p => p._id === selectedProject?._id || p.name === selectedProject?.name);
        selectedProject = found || projects[0];
      } else {
        selectedProject = null;
      }

      this.setState({ projects, selectedProject });

      if (selectedProject) {
        await this.loadVersions(selectedProject._id || selectedProject.name);
        await this.loadSimulations(selectedProject._id || selectedProject.name);
        await this.loadAnalytics(selectedProject._id || selectedProject.name);
        await this.loadEvents(selectedProject._id || selectedProject.name);
      }
      return projects;
    } catch (err) {
      console.error('loadProjects error:', err);
      return [];
    }
  }

  async createProject(name) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create project');
    await this.loadProjects();
    const created = this.state.projects.find(p => p.name === name);
    if (created) await this.selectProject(created);
    return data;
  }

  async selectProject(project) {
    if (!project) return;
    this.setState({
      selectedProject: project,
      selectedVersion: null,
      graphData: null,
      currentSimulation: null,
      simulationHistory: [],
      analytics: null
    });
    const id = project._id || project.name;
    await this.loadVersions(id);
    await this.loadSimulations(id);
    await this.loadAnalytics(id);
    await this.loadEvents(id);
  }

  async loadVersions(projectId) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/versions`);
      if (!res.ok) throw new Error('Failed to load versions');
      const versions = await res.json();
      let selectedVersion = this.state.selectedVersion;

      if (versions.length > 0) {
        const found = versions.find(v => v._id === selectedVersion?._id);
        selectedVersion = found || versions[0];
      } else {
        selectedVersion = null;
      }

      this.setState({ versions, selectedVersion });

      if (selectedVersion) {
        await this.loadGraph(selectedVersion._id);
      } else {
        this.setState({ graphData: null });
      }
      return versions;
    } catch (err) {
      console.error('loadVersions error:', err);
      return [];
    }
  }

  async selectVersion(version) {
    if (!version) return;
    this.setState({ selectedVersion: version });
    await this.loadGraph(version._id);
  }

  async loadGraph(versionId) {
    try {
      const res = await fetch(`/api/versions/${encodeURIComponent(versionId)}/graph`);
      if (!res.ok) throw new Error('Failed to load graph');
      const graphData = await res.json();
      if (graphData && Array.isArray(graphData.components)) {
        graphData.components.forEach(c => {
          if (!c.id) c.id = c.componentId;
          if (!c.componentId) c.componentId = c.id;
        });
      }
      this.setState({ graphData });
      return graphData;
    } catch (err) {
      console.error('loadGraph error:', err);
      this.setState({ graphData: null });
      return null;
    }
  }

  async loadSimulations(projectId) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/simulations`);
      if (!res.ok) return [];
      const simulationHistory = await res.json();
      let currentSimulation = this.state.currentSimulation;
      if (!currentSimulation && simulationHistory.length > 0) {
        currentSimulation = simulationHistory[0];
      }
      this.setState({ simulationHistory, currentSimulation });
      return simulationHistory;
    } catch (err) {
      console.error('loadSimulations error:', err);
      return [];
    }
  }

  async loadAnalytics(projectId) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/analytics`);
      if (!res.ok) return null;
      const analytics = await res.json();
      this.setState({ analytics });
      return analytics;
    } catch (err) {
      console.error('loadAnalytics error:', err);
      return null;
    }
  }

  async loadEvents(projectId) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/events`);
      if (!res.ok) return [];
      const events = await res.json();
      this.setState({ events });
      return events;
    } catch (err) {
      console.error('loadEvents error:', err);
      return [];
    }
  }

  async seedShopLite() {
    const res = await fetch('/api/demo/seed', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to seed ShopLite');
    await this.loadProjects();
    const demoProject = this.state.projects.find(p => p.name === 'ShopLite Demo') || this.state.projects[0];
    if (demoProject) {
      await this.selectProject(demoProject);
    }
    return data;
  }

  async uploadManifest(projectId, manifestJson) {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof manifestJson === 'string' ? manifestJson : JSON.stringify(manifestJson)
    });
    const data = await res.json();
    return { status: res.status, ok: res.ok, data };
  }

  async runSimulation(versionId, changeType, target, params = {}) {
    const res = await fetch(`/api/versions/${encodeURIComponent(versionId)}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: changeType,
        targetId: target,
        changeType,
        target,
        params
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Simulation failed');
      err.reasons = data.reasons || [];
      err.status = res.status;
      throw err;
    }

    const isCached = res.status === 200 || data.status === 'cached';
    this.setState({
      currentSimulation: data,
      lastCachedHit: isCached
    });

    if (this.state.selectedProject) {
      const pid = this.state.selectedProject._id || this.state.selectedProject.name;
      await this.loadSimulations(pid);
      await this.loadAnalytics(pid);
    }
    return { data, isCached };
  }

  async compareSimulations(simIdA, simIdB) {
    const res = await fetch(`/api/compare?a=${encodeURIComponent(simIdA)}&b=${encodeURIComponent(simIdB)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Compare failed');
    return data;
  }

  async scanSourceCode(files) {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');
    return data;
  }

  // SSE Management
  initSSE() {
    if (this.eventSource) {
      this.eventSource.close();
    }
    try {
      this.eventSource = new EventSource('/api/stream');
      this.eventSource.onopen = () => {
        this.setState({ sseConnected: true });
        this.emit('sseStatus', { status: 'connected' });
      };
      this.eventSource.onmessage = (e) => {
        if (this.isPausedEvents) return;
        try {
          const ev = JSON.parse(e.data);
          const currentEvents = [ev, ...(this.state.events || [])].slice(0, 100);
          this.setState({ events: currentEvents });
          this.emit('newEvent', ev);
        } catch (_err) {}
      };
      this.eventSource.onerror = () => {
        this.setState({ sseConnected: false });
        this.emit('sseStatus', { status: 'disconnected' });
      };
    } catch (err) {
      console.warn('SSE initialization failed:', err);
    }
  }

  togglePauseEvents() {
    this.isPausedEvents = !this.isPausedEvents;
    return this.isPausedEvents;
  }
}

// Global Store Instance
window.bugboundStore = new BugBoundStore();
