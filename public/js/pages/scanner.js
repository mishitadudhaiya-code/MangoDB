/**
 * public/js/pages/scanner.js — Heuristic Source Code Scanner Page Controller
 * Allows pasting JavaScript / Python code files, scans for API routes,
 * static property reads, dynamic accesses, and function calls,
 * inspects the generated manifest JSON, and uploads it to create a new graph version.
 */

window.ScannerPage = {
  container: null,
  store: null,
  unsubscribe: null,
  scannedResult: null,

  files: [
    {
      path: 'src/views/ProfilePage.js',
      content: `async function renderProfile(user) {
  const profile = await fetch('/api/users/profile');
  const data = await profile.json();
  const userName = data.user_name;
  const dyn = data[dynamicKey];
  return formatUser(userName);
}`
    }
  ],
  activeFileIndex: 0,

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
    const { selectedProject } = this.store.state;
    const activeFile = this.files[this.activeFileIndex] || this.files[0];

    this.container.innerHTML = `
      <div class="page-container scanner-page">
        <!-- Header -->
        <div class="page-header-row">
          <div>
            <h2>Heuristic Code Scanner (Pattern Extractor)</h2>
            <p class="text-secondary">Extract components and dependency edges directly from source code using AST/regex heuristics.</p>
          </div>
          <div class="disclaimer-banner">
            ℹ️ Heuristic scanner: extracts /api routes, property reads, dynamic access, and function calls.
          </div>
        </div>

        <div class="scanner-grid">
          <!-- Editor Column -->
          <div class="scanner-editor-col">
            <div class="panel-card">
              <!-- File Tabs -->
              <div class="scanner-file-tabs">
                ${this.files.map((f, i) => `
                  <button class="scanner-tab ${i === this.activeFileIndex ? 'active' : ''}" data-idx="${i}">
                    <span>📄</span> <span>${f.path.split('/').pop() || f.path}</span>
                  </button>
                `).join('')}
                <button id="btn-add-scan-file" class="btn btn-ghost btn-xs" title="Add another file">+ Add File</button>
              </div>

              <!-- Path input -->
              <div class="form-field" style="margin-top: 0.6rem;">
                <label class="form-label">Virtual File Path</label>
                <input type="text" id="scan-file-path" class="form-input text-mono" value="${activeFile.path}">
              </div>

              <!-- Code input -->
              <div class="form-field">
                <label class="form-label">Source Code</label>
                <textarea id="scan-file-content" class="form-textarea text-mono" rows="12">${activeFile.content}</textarea>
              </div>

              <div class="scanner-action-buttons">
                <button id="btn-execute-scan" class="btn btn-glowing-green">
                  🔍 Scan Code Patterns
                </button>
              </div>
            </div>
          </div>

          <!-- Preview & Result Column -->
          <div class="scanner-result-col">
            <div class="panel-card">
              <div class="panel-card-header">
                <span class="panel-card-title">Generated Manifest Preview</span>
                ${this.scannedResult ? `
                  <span class="badge-tag">${this.scannedResult.componentCount} comps, ${this.scannedResult.edgeCount} edges</span>
                ` : ''}
              </div>

              ${!this.scannedResult ? `
                <div class="empty-list-notice">
                  Paste or adjust code in the editor and click <strong>Scan Code Patterns</strong> to extract architecture.
                </div>
              ` : `
                <div class="scan-summary-badges">
                  <div class="stat-cell" style="padding: 0.4rem;">
                    <span class="stat-cell-value text-sm">${this.scannedResult.componentCount}</span>
                    <span class="stat-cell-label">Components</span>
                  </div>
                  <div class="stat-cell" style="padding: 0.4rem;">
                    <span class="stat-cell-value text-sm">${this.scannedResult.edgeCount}</span>
                    <span class="stat-cell-label">Edges</span>
                  </div>
                  <div class="stat-cell" style="padding: 0.4rem;">
                    <span class="stat-cell-value text-sm" style="color: ${this.scannedResult.valid ? 'var(--accent-green)' : 'var(--status-broken)'};">
                      ${this.scannedResult.valid ? 'VALID' : 'INVALID'}
                    </span>
                    <span class="stat-cell-label">Schema</span>
                  </div>
                </div>

                <div class="form-field" style="margin-top: 0.6rem;">
                  <label class="form-label">Manifest JSON</label>
                  <pre class="manifest-json-preview">${JSON.stringify(this.scannedResult.manifest, null, 2)}</pre>
                </div>

                <div class="scanner-upload-actions">
                  <button id="btn-upload-scanned-manifest" class="btn btn-primary btn-block" ${!selectedProject ? 'disabled' : ''}>
                    🚀 Upload as New Version to "${selectedProject ? selectedProject.name : 'Active Project'}"
                  </button>
                </div>
              `}
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  },

  bindEvents() {
    // Tab switching
    const tabs = this.container.querySelectorAll('.scanner-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        this.saveCurrentEditorState();
        this.activeFileIndex = parseInt(tab.getAttribute('data-idx'), 10);
        this.render();
      };
    });

    // Add file
    const addFileBtn = document.getElementById('btn-add-scan-file');
    if (addFileBtn) {
      addFileBtn.onclick = () => {
        this.saveCurrentEditorState();
        this.files.push({
          path: `src/services/service-${this.files.length + 1}.js`,
          content: `function processData(record) {\n  const id = record.user_name;\n}`
        });
        this.activeFileIndex = this.files.length - 1;
        this.render();
      };
    }

    // Scan button
    const scanBtn = document.getElementById('btn-execute-scan');
    if (scanBtn) {
      scanBtn.onclick = async () => {
        this.saveCurrentEditorState();
        scanBtn.disabled = true;
        scanBtn.textContent = 'Scanning...';
        try {
          const res = await this.store.scanSourceCode(this.files);
          this.scannedResult = res;
          window.showToast(`Extracted ${res.componentCount} components & ${res.edgeCount} edges!`, 'success');
          this.render();
        } catch (err) {
          window.showToast('Scan failed: ' + err.message, 'error');
        } finally {
          scanBtn.disabled = false;
          scanBtn.textContent = '🔍 Scan Code Patterns';
        }
      };
    }

    // Upload as manifest
    const uploadBtn = document.getElementById('btn-upload-scanned-manifest');
    if (uploadBtn && this.scannedResult) {
      uploadBtn.onclick = async () => {
        const { selectedProject } = this.store.state;
        if (!selectedProject) return;
        const pid = selectedProject._id || selectedProject.name;
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';
        try {
          const res = await this.store.uploadManifest(pid, this.scannedResult.manifest);
          if (res.status === 201) {
            window.showToast('Manifest uploaded successfully as new graph version!', 'success');
            await this.store.loadVersions(pid);
            window.location.hash = '#/graph';
          } else if (res.status === 200 && res.data.status === 'duplicate') {
            window.showToast('Duplicate manifest: ' + res.data.message, 'warning');
          } else {
            window.showToast('Upload failed: ' + (res.data.error || 'Unknown error'), 'error');
          }
        } catch (err) {
          window.showToast('Upload error: ' + err.message, 'error');
        } finally {
          uploadBtn.disabled = false;
          uploadBtn.textContent = '🚀 Upload as New Version';
        }
      };
    }
  },

  saveCurrentEditorState() {
    const pathInput = document.getElementById('scan-file-path');
    const contentInput = document.getElementById('scan-file-content');
    if (this.files[this.activeFileIndex]) {
      if (pathInput) this.files[this.activeFileIndex].path = pathInput.value.trim();
      if (contentInput) this.files[this.activeFileIndex].content = contentInput.value;
    }
  }
};
