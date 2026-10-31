/**
 * public/app.js — BugBound Master Application Initializer
 * Coordinates router, topbar controls, shared store, and global modals.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const store = window.bugboundStore;

  // Initialize Router with the 10 page routes
  const router = new Router({
    '#/dashboard': window.DashboardPage,
    '#/graph': window.GraphPage,
    '#/simulate': window.SimulatePage,
    '#/chain': window.ChainPage,
    '#/blast': window.BlastPage,
    '#/history': window.HistoryPage,
    '#/analytics': window.AnalyticsPage,
    '#/events': window.EventsPage,
    '#/scanner': window.ScannerPage,
    '#/about': window.AboutPage
  }, 'main-content');

  window.bugboundRouter = router;

  // Setup Top Bar Controls & Reactive Updates
  setupTopBar(store);
  setupModals(store);

  // SSE Live Feed
  store.initSSE();

  // Initial Data Fetch
  await store.checkHealth();
  await store.loadProjects();

  // Mobile sidebar toggle
  const toggleMobileSidebar = document.getElementById('btn-mobile-sidebar-toggle');
  const sidebar = document.getElementById('app-sidebar');
  if (toggleMobileSidebar && sidebar) {
    toggleMobileSidebar.onclick = () => {
      sidebar.classList.toggle('mobile-open');
    };
  }
});

/**
 * Top bar project & version dropdowns, seed button, and simulation chip
 */
function setupTopBar(store) {
  const projectSelect = document.getElementById('topbar-project-select');
  const versionSelect = document.getElementById('topbar-version-select');
  const seedBtn = document.getElementById('btn-topbar-seed');
  const simChip = document.getElementById('topbar-sim-chip');
  const dbStatusPill = document.getElementById('topbar-db-status');
  const sseStatusPill = document.getElementById('topbar-sse-status');

  // React to store changes
  store.on('stateChanged', (state) => {
    // 1. Projects dropdown
    if (projectSelect) {
      projectSelect.innerHTML = '<option value="">Select Project...</option>';
      (state.projects || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p._id || p.name;
        opt.textContent = p.name;
        if (state.selectedProject && (p._id === state.selectedProject._id || p.name === state.selectedProject.name)) {
          opt.selected = true;
        }
        projectSelect.appendChild(opt);
      });
    }

    // 2. Versions dropdown
    if (versionSelect) {
      versionSelect.innerHTML = '<option value="">Select Version...</option>';
      (state.versions || []).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v._id;
        const compCount = v.componentsCount || (state.graphData?.components?.length) || '?';
        opt.textContent = `${v.version || v._id.slice(0, 8)} (${compCount} comps)`;
        if (state.selectedVersion && v._id === state.selectedVersion._id) {
          opt.selected = true;
        }
        versionSelect.appendChild(opt);
      });
    }

    // 3. Current Simulation Chip
    if (simChip) {
      if (state.currentSimulation) {
        const sim = state.currentSimulation;
        const target = (sim.change?.targetId || sim.target || 'target').split('.').pop();
        const score = sim.score ?? sim.blastRadius?.score ?? 0;
        const label = sim.label ?? sim.blastRadius?.label ?? 'LOW';
        simChip.style.display = 'inline-flex';
        simChip.innerHTML = `
          <span class="sim-chip-name text-mono">${target}</span>
          <span class="sim-chip-score font-bold">${score}</span>
          <span class="status-pill pill-${label.toLowerCase()}">${label}</span>
          ${state.lastCachedHit ? '<span class="badge-cached-xs">cached</span>' : ''}
        `;
      } else {
        simChip.style.display = 'none';
      }
    }

    // 4. DB Status
    if (dbStatusPill) {
      if (state.dbConnected) {
        dbStatusPill.innerHTML = '<span class="indicator-dot green"></span><span>Atlas</span>';
        dbStatusPill.title = 'MongoDB Atlas Connected';
      } else {
        dbStatusPill.innerHTML = '<span class="indicator-dot yellow"></span><span>Offline</span>';
        dbStatusPill.title = 'Database Connection Offline';
      }
    }

    // 5. SSE Status
    if (sseStatusPill) {
      if (state.sseConnected) {
        sseStatusPill.innerHTML = '<span class="indicator-dot green"></span><span>Live</span>';
        sseStatusPill.title = 'SSE Audit Stream Active';
      } else {
        sseStatusPill.innerHTML = '<span class="indicator-dot yellow"></span><span>Feed</span>';
        sseStatusPill.title = 'Audit Feed Inactive';
      }
    }
  });

  // Project selector change
  if (projectSelect) {
    projectSelect.onchange = async () => {
      const pid = projectSelect.value;
      const found = store.state.projects.find(p => p._id === pid || p.name === pid);
      if (found) {
        await store.selectProject(found);
      }
    };
  }

  // Version selector change
  if (versionSelect) {
    versionSelect.onchange = async () => {
      const vid = versionSelect.value;
      const found = store.state.versions.find(v => v._id === vid);
      if (found) {
        await store.selectVersion(found);
      }
    };
  }

  // Seed demo button
  if (seedBtn) {
    seedBtn.onclick = async () => {
      seedBtn.disabled = true;
      seedBtn.innerHTML = '<span>⏳</span> Loading...';
      try {
        await store.seedShopLite();
        window.showToast('ShopLite Demo project loaded successfully!', 'success');
      } catch (err) {
        window.showToast('Error seeding demo: ' + err.message, 'error');
      } finally {
        seedBtn.disabled = false;
        seedBtn.innerHTML = '<span>⚡</span> Load ShopLite';
      }
    };
  }

  // Simulation chip click navigates to Chain Reaction
  if (simChip) {
    simChip.onclick = () => {
      window.location.hash = '#/chain';
    };
  }
}

/**
 * Modals setup (New Project Modal)
 */
function setupModals(store) {
  const newProjBtn = document.getElementById('btn-topbar-new-project');
  const modal = document.getElementById('modal-new-project');
  const closeBtn = document.getElementById('btn-close-new-project');
  const cancelBtn = document.getElementById('btn-cancel-new-project');
  const submitBtn = document.getElementById('btn-submit-new-project');
  const nameInput = document.getElementById('input-new-project-name');

  if (newProjBtn && modal) {
    newProjBtn.onclick = () => {
      modal.classList.add('modal-open');
      if (nameInput) {
        nameInput.value = '';
        setTimeout(() => nameInput.focus(), 100);
      }
    };
  }

  const closeModal = () => {
    if (modal) modal.classList.remove('modal-open');
  };

  if (closeBtn) closeBtn.onclick = closeModal;
  if (cancelBtn) cancelBtn.onclick = closeModal;

  if (submitBtn && nameInput) {
    submitBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) {
        window.showToast('Project name cannot be empty', 'warning');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';
      try {
        await store.createProject(name);
        window.showToast(`Project "${name}" created!`, 'success');
        closeModal();
      } catch (err) {
        window.showToast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Project';
      }
    };
  }
}
