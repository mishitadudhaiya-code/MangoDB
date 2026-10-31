/**
 * public/js/router.js — Hash-based Multi-Page Client Router
 * Routes: #/dashboard, #/graph, #/simulate, #/chain, #/blast,
 *         #/history, #/analytics, #/events, #/scanner, #/about
 */

class Router {
  constructor(routes, containerId = 'main-content') {
    this.routes = routes;
    this.container = document.getElementById(containerId);
    this.activeRoute = null;
    this.activeController = null;

    window.addEventListener('hashchange', () => this.handleRouting());
    window.addEventListener('DOMContentLoaded', () => this.handleRouting());
  }

  handleRouting() {
    let hash = window.location.hash || '#/dashboard';
    // Strip trailing slashes or queries
    const cleanHash = hash.split('?')[0].replace(/\/$/, '');

    let matchedRoute = this.routes[cleanHash];
    if (!matchedRoute) {
      window.location.hash = '#/dashboard';
      return;
    }

    if (this.activeController && typeof this.activeController.unmount === 'function') {
      try {
        this.activeController.unmount();
      } catch (err) {
        console.error('Error during controller unmount:', err);
      }
    }

    this.activeRoute = cleanHash;
    this.updateActiveNav(cleanHash);

    // Mount new controller
    this.activeController = matchedRoute;
    if (this.container && typeof matchedRoute.mount === 'function') {
      try {
        matchedRoute.mount(this.container, window.bugboundStore);
      } catch (err) {
        console.error(`Error mounting route ${cleanHash}:`, err);
        this.container.innerHTML = `
          <div class="empty-state-card">
            <h3>Failed to load page</h3>
            <p>${err.message}</p>
            <button class="btn btn-glowing-green" onclick="location.hash='#/dashboard'">Return to Dashboard</button>
          </div>
        `;
      }
    }
  }

  updateActiveNav(activeHash) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      const link = item.getAttribute('href');
      if (link === activeHash) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  static renderEmptyState({ title, description, actionText, actionHash, actionCallback }) {
    const btnId = 'empty-state-action-' + Math.random().toString(36).substr(2, 9);
    setTimeout(() => {
      const btn = document.getElementById(btnId);
      if (btn && actionCallback) {
        btn.onclick = actionCallback;
      }
    }, 0);

    return `
      <div class="empty-state-card">
        <div class="empty-state-icon">⚡</div>
        <h3 class="empty-state-title">${title}</h3>
        <p class="empty-state-desc">${description}</p>
        ${actionText ? `
          <button id="${btnId}" class="btn btn-glowing-green" ${actionHash ? `onclick="location.hash='${actionHash}'"` : ''}>
            ${actionText}
          </button>
        ` : ''}
      </div>
    `;
  }
}

// Global UI toast helper
window.showToast = function(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.innerHTML = `
    <span class="toast-dot"></span>
    <span class="toast-msg">${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 250);
  }, duration);
};
