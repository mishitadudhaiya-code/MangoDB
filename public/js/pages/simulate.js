/**
 * public/js/pages/simulate.js — What-If Simulator Page Controller
 * Implements change type cards, target selector with type filtering, dynamic parameters,
 * presets, simulation run with cached badge, and sample manifest upload actions.
 */

window.SimulatePage = {
  container: null,
  store: null,
  unsubscribe: null,

  CHANGE_TYPES: [
    { type: 'RENAME_FIELD', icon: '✏️', name: 'Rename Field', desc: 'Rename a DB field or schema property', compatible: ['field', 'api'] },
    { type: 'DELETE_FIELD', icon: '🗑️', name: 'Delete Field', desc: 'Remove a field from collection documents', compatible: ['field'] },
    { type: 'CHANGE_FIELD_TYPE', icon: '🔄', name: 'Change Field Type', desc: 'Alter property type (e.g. string to number)', compatible: ['field'] },
    { type: 'DELETE_ENDPOINT', icon: '🚫', name: 'Delete Endpoint', desc: 'Remove an API route/endpoint', compatible: ['api'] },
    { type: 'CHANGE_FUNCTION_SIGNATURE', icon: '⚡', name: 'Change Signature', desc: 'Modify function arguments or returns', compatible: ['function'] },
    { type: 'CHANGE_CONFIG', icon: '⚙️', name: 'Change Config', desc: 'Update environment/config variable', compatible: ['config'] },
    { type: 'UPGRADE_DEPENDENCY_MAJOR', icon: '📦', name: 'Upgrade Major', desc: 'Bump package across breaking versions', compatible: ['package'] }
  ],

  selectedType: 'RENAME_FIELD',
  selectedTarget: '',
  paramValues: {},

  mount(container, store) {
    this.container = container;
    this.store = store;

    this.render();
    this.unsubscribe = store.on('stateChanged', () => {
      // Re-populate targets if graphData updated
      this.updateTargetDropdown();
    });
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
    const { selectedVersion, currentSimulation, lastCachedHit } = this.store.state;

    this.container.innerHTML = `
      <div class="page-container simulate-page">
        <!-- Header & Disclaimer Banner -->
        <div class="page-header-row">
          <div>
            <h2>What-If Simulator</h2>
            <p class="text-secondary">Propose a schema or code change and calculate the ripple effect before committing.</p>
          </div>
          <div class="disclaimer-banner">
            ⚠️ Estimates from a static dependency model, not guarantees.
          </div>
        </div>

        <!-- Quick Demo Presets -->
        <div class="panel-card scenario-bar-card">
          <span class="panel-card-title-sm">Quick Demo Scenarios:</span>
          <div class="preset-chips">
            <button class="btn-preset-chip" data-preset="rename-username">Rename db.users.user_name</button>
            <button class="btn-preset-chip" data-preset="delete-email">Delete db.users.email</button>
            <button class="btn-preset-chip" data-preset="change-timeout">Change PAYMENT_TIMEOUT</button>
            <button class="btn-preset-chip" data-preset="upgrade-payments">Upgrade payments-sdk</button>
          </div>
        </div>

        <div class="simulate-layout-grid">
          <!-- Main Form Column -->
          <div class="simulate-form-col">
            <!-- 1. Change Type Selection Cards -->
            <div class="panel-card">
              <label class="form-label-bold">1. Select Change Type</label>
              <div class="change-cards-grid">
                ${this.CHANGE_TYPES.map(ct => `
                  <div class="change-card ${this.selectedType === ct.type ? 'active' : ''}" data-type="${ct.type}">
                    <span class="change-card-icon">${ct.icon}</span>
                    <div class="change-card-info">
                      <span class="change-card-name">${ct.name}</span>
                      <span class="change-card-desc">${ct.desc}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- 2. Target Component -->
            <div class="panel-card">
              <label class="form-label-bold">2. Select Target Component</label>
              <div class="target-select-wrapper">
                <input type="text" id="target-search-filter" class="form-input" placeholder="Type to filter target components..." style="margin-bottom: 0.5rem;">
                <select id="target-component-select" class="form-select text-mono">
                  <option value="">-- Choose target component --</option>
                </select>
              </div>
              <small class="text-muted" id="target-hint-text">Filtered by compatible types</small>
            </div>

            <!-- 3. Dynamic Parameters -->
            <div class="panel-card">
              <label class="form-label-bold">3. Change Parameters</label>
              <div id="dynamic-params-container" class="dynamic-params-box">
                <!-- Dynamically populated -->
              </div>
            </div>

            <!-- Validation Errors Box -->
            <div id="validation-errors-box" class="alert-box-error" style="display: none;"></div>

            <!-- Submit Button -->
            <button id="btn-run-simulation" class="btn btn-glowing-green btn-block" ${!selectedVersion ? 'disabled' : ''}>
              <span>🚀</span> Calculate Blast Radius & Impact
            </button>
          </div>

          <!-- Result & Manifest Actions Column -->
          <div class="simulate-side-col">
            <!-- Current Simulation Summary -->
            <div class="panel-card result-summary-card">
              <div class="panel-card-header">
                <span class="panel-card-title">Latest Result</span>
                <span id="simulate-cached-pill" class="badge-cached" style="display: ${lastCachedHit ? 'inline-block' : 'none'};">⚡ Cached</span>
              </div>

              ${currentSimulation ? `
                <div class="result-details">
                  <div class="result-meta-row">
                    <span class="text-muted">Type:</span>
                    <span class="code-chip">${currentSimulation.changeType}</span>
                  </div>
                  <div class="result-meta-row">
                    <span class="text-muted">Target:</span>
                    <span class="text-mono font-bold">${currentSimulation.target}</span>
                  </div>
                  <div class="result-score-block">
                    <div class="result-score-val" style="color: ${this.getScoreColor(currentSimulation.score || currentSimulation.blastRadius?.score || 0)};">
                      ${currentSimulation.score ?? currentSimulation.blastRadius?.score ?? 0}
                    </div>
                    <div class="result-score-lbl">
                      <span class="status-badge badge-${(currentSimulation.label || currentSimulation.blastRadius?.label || 'LOW').toLowerCase()}">
                        ${currentSimulation.label ?? currentSimulation.blastRadius?.label ?? 'LOW'}
                      </span>
                    </div>
                  </div>

                  <div class="result-counts-grid">
                    <div class="count-pill broken">
                      <span class="count-num">${currentSimulation.brokenCount || currentSimulation.affected?.filter(a => a.status === 'BROKEN').length || 0}</span>
                      <span class="count-lbl">Broken</span>
                    </div>
                    <div class="count-pill at-risk">
                      <span class="count-num">${currentSimulation.atRiskCount || currentSimulation.affected?.filter(a => a.status === 'AT_RISK').length || 0}</span>
                      <span class="count-lbl">At Risk</span>
                    </div>
                    <div class="count-pill uncertain">
                      <span class="count-num">${currentSimulation.uncertainCount || currentSimulation.affected?.filter(a => a.status === 'UNCERTAIN').length || 0}</span>
                      <span class="count-lbl">Uncertain</span>
                    </div>
                  </div>

                  <div class="result-nav-actions">
                    <button class="btn btn-primary btn-block" onclick="location.hash='#/chain'">
                      Inspect Chain Reaction Flow →
                    </button>
                    <button class="btn btn-outline-cyan btn-block" onclick="location.hash='#/blast'">
                      View Hand-Drawn Blast Radius Sketch →
                    </button>
                  </div>
                </div>
              ` : `
                <div class="empty-list-notice">
                  No simulation executed yet.<br>Choose a change and click Calculate.
                </div>
              `}
            </div>

            <!-- Manifest Upload & Samples Card -->
            <div class="panel-card">
              <div class="panel-card-header">
                <span class="panel-card-title">Manifest Samples & Upload</span>
              </div>
              <div class="sample-actions-list">
                <button id="btn-upload-v2-manifest" class="btn btn-ghost btn-block">
                  📦 Upload ShopLite v2 (Version Diff)
                </button>
                <button id="btn-upload-invalid-manifest" class="btn btn-ghost btn-block">
                  💥 Try Invalid Manifest (Expect 422)
                </button>
              </div>

              <div class="dropzone-box" id="simulate-dropzone">
                <input type="file" id="manifest-upload-input" accept=".json" style="display: none;">
                <div class="dropzone-text">
                  <span class="dropzone-icon">📁</span>
                  <span>Click or drag custom <strong>manifest.json</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.updateTargetDropdown();
    this.renderParams();
  },

  getScoreColor(score) {
    if (score >= 70) return 'var(--status-broken)';
    if (score >= 40) return 'var(--status-at-risk)';
    if (score >= 20) return 'var(--status-uncertain)';
    return 'var(--accent-green)';
  },

  bindEvents() {
    // 1. Change type click
    const cards = this.container.querySelectorAll('.change-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.selectedType = card.getAttribute('data-type');
        this.updateTargetDropdown();
        this.renderParams();
      });
    });

    // Target search filter
    const searchInput = document.getElementById('target-search-filter');
    if (searchInput) {
      searchInput.oninput = () => this.updateTargetDropdown(searchInput.value.trim().toLowerCase());
    }

    // Target select
    const targetSelect = document.getElementById('target-component-select');
    if (targetSelect) {
      targetSelect.onchange = () => {
        this.selectedTarget = targetSelect.value;
      };
    }

    // Quick Presets
    const presetBtns = this.container.querySelectorAll('.btn-preset-chip');
    presetBtns.forEach(btn => {
      btn.onclick = () => {
        const preset = btn.getAttribute('data-preset');
        this.applyPreset(preset);
      };
    });

    // Run Simulation Button
    const runBtn = document.getElementById('btn-run-simulation');
    if (runBtn) {
      runBtn.onclick = () => this.executeSimulation();
    }

    // Sample Manifests: v2 & invalid
    const v2Btn = document.getElementById('btn-upload-v2-manifest');
    if (v2Btn) {
      v2Btn.onclick = async () => {
        await this.handleSampleUpload('shoplite-v2', 'ShopLite v2 manifest');
      };
    }

    const invalidBtn = document.getElementById('btn-upload-invalid-manifest');
    if (invalidBtn) {
      invalidBtn.onclick = async () => {
        await this.handleSampleUpload('invalid', 'Invalid manifest');
      };
    }

    // Dropzone upload
    const dropzone = document.getElementById('simulate-dropzone');
    const fileInput = document.getElementById('manifest-upload-input');
    if (dropzone && fileInput) {
      dropzone.onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        if (fileInput.files.length > 0) {
          const file = fileInput.files[0];
          const text = await file.text();
          try {
            const json = JSON.parse(text);
            await this.uploadCustomJson(json);
          } catch (e) {
            window.showToast('Invalid JSON file format: ' + e.message, 'error');
          }
        }
      };
    }
  },

  updateTargetDropdown(filter = '') {
    const targetSelect = document.getElementById('target-component-select');
    const hintText = document.getElementById('target-hint-text');
    if (!targetSelect) return;

    const { graphData } = this.store.state;
    const ctInfo = this.CHANGE_TYPES.find(c => c.type === this.selectedType);
    const compatible = ctInfo?.compatible || [];

    if (hintText) {
      hintText.textContent = `Showing components compatible with ${this.selectedType} (${compatible.join(', ')})`;
    }

    targetSelect.innerHTML = '<option value="">-- Choose target component --</option>';

    if (!graphData || !graphData.components) {
      targetSelect.innerHTML = '<option value="">No components loaded (Load ShopLite demo first)</option>';
      return;
    }

    const matching = graphData.components.filter(c => {
      if (compatible.length > 0 && !compatible.includes(c.type)) return false;
      if (filter && !c.id.toLowerCase().includes(filter) && !c.name.toLowerCase().includes(filter)) return false;
      return true;
    });

    matching.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} [${c.type}] (${c.id})`;
      if (c.id === this.selectedTarget) opt.selected = true;
      targetSelect.appendChild(opt);
    });

    if (matching.length > 0 && (!this.selectedTarget || !matching.some(m => m.id === this.selectedTarget))) {
      this.selectedTarget = matching[0].id;
      targetSelect.value = this.selectedTarget;
    }
  },

  renderParams() {
    const container = document.getElementById('dynamic-params-container');
    if (!container) return;

    let html = '';
    switch (this.selectedType) {
      case 'RENAME_FIELD':
        html = `
          <div class="form-field">
            <label class="form-label">New Field Name</label>
            <input type="text" id="param-newName" class="form-input text-mono" value="${this.paramValues.newName || 'username'}" placeholder="e.g. username">
          </div>
        `;
        break;
      case 'DELETE_FIELD':
      case 'DELETE_ENDPOINT':
        html = `
          <div class="param-notice">
            <span>ℹ️</span> This change removes the target completely. No additional parameters required.
          </div>
        `;
        break;
      case 'CHANGE_FIELD_TYPE':
        html = `
          <div class="form-field">
            <label class="form-label">New Data Type</label>
            <select id="param-newType" class="form-select">
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="object">object</option>
              <option value="array">array</option>
            </select>
          </div>
        `;
        break;
      case 'CHANGE_FUNCTION_SIGNATURE':
        html = `
          <div class="form-field">
            <label class="form-label">Removed Parameters (comma-separated)</label>
            <input type="text" id="param-removedParams" class="form-input text-mono" placeholder="e.g. format, uppercase">
          </div>
          <div class="form-field">
            <label class="form-label">Changed Return Type</label>
            <input type="text" id="param-changedReturn" class="form-input text-mono" placeholder="e.g. Promise<UserObject>">
          </div>
        `;
        break;
      case 'CHANGE_CONFIG':
        html = `
          <div class="form-field">
            <label class="form-label">Config Key</label>
            <input type="text" id="param-key" class="form-input text-mono" value="${this.paramValues.key || 'PAYMENT_TIMEOUT'}">
          </div>
          <div class="form-field">
            <label class="form-label">New Value</label>
            <input type="text" id="param-newVal" class="form-input text-mono" value="${this.paramValues.newVal || '5000'}">
          </div>
        `;
        break;
      case 'UPGRADE_DEPENDENCY_MAJOR':
        html = `
          <div class="form-field">
            <label class="form-label">Target Version</label>
            <input type="text" id="param-toVersion" class="form-input text-mono" value="${this.paramValues.toVersion || '2.0.0'}">
          </div>
        `;
        break;
    }

    container.innerHTML = html;
  },

  applyPreset(preset) {
    if (preset === 'rename-username') {
      this.selectedType = 'RENAME_FIELD';
      this.selectedTarget = 'db.users.user_name';
      this.paramValues = { newName: 'username' };
    } else if (preset === 'delete-email') {
      this.selectedType = 'DELETE_FIELD';
      this.selectedTarget = 'db.users.email';
      this.paramValues = {};
    } else if (preset === 'change-timeout') {
      this.selectedType = 'CHANGE_CONFIG';
      this.selectedTarget = 'config.PAYMENT_TIMEOUT';
      this.paramValues = { key: 'PAYMENT_TIMEOUT', newVal: 5000 };
    } else if (preset === 'upgrade-payments') {
      this.selectedType = 'UPGRADE_DEPENDENCY_MAJOR';
      this.selectedTarget = 'pkg.payments-sdk';
      this.paramValues = { toVersion: '2.0.0' };
    }

    const cards = this.container.querySelectorAll('.change-card');
    cards.forEach(c => {
      if (c.getAttribute('data-type') === this.selectedType) c.classList.add('active');
      else c.classList.remove('active');
    });

    this.updateTargetDropdown();
    this.renderParams();
    window.showToast(`Preset "${preset}" selected`, 'info');
  },

  collectParams() {
    const params = {};
    const newName = document.getElementById('param-newName');
    if (newName) params.newName = newName.value.trim();

    const newType = document.getElementById('param-newType');
    if (newType) params.newType = newType.value;

    const removedParams = document.getElementById('param-removedParams');
    if (removedParams && removedParams.value.trim()) {
      params.removedParams = removedParams.value.split(',').map(s => s.trim()).filter(Boolean);
    }

    const changedReturn = document.getElementById('param-changedReturn');
    if (changedReturn && changedReturn.value.trim()) {
      params.changedReturn = changedReturn.value.trim();
    }

    const key = document.getElementById('param-key');
    if (key) params.key = key.value.trim();

    const newVal = document.getElementById('param-newVal');
    if (newVal) params.newVal = newVal.value.trim();

    const toVersion = document.getElementById('param-toVersion');
    if (toVersion) params.toVersion = toVersion.value.trim();

    return params;
  },

  async executeSimulation() {
    const errBox = document.getElementById('validation-errors-box');
    const runBtn = document.getElementById('btn-run-simulation');
    if (errBox) errBox.style.display = 'none';

    const { selectedVersion } = this.store.state;
    if (!selectedVersion) {
      window.showToast('Please load or select a graph version first', 'warning');
      return;
    }

    if (!this.selectedTarget) {
      if (errBox) {
        errBox.style.display = 'block';
        errBox.innerHTML = '<strong>Missing Target:</strong> Please choose a target component to simulate.';
      }
      return;
    }

    const params = this.collectParams();

    if (runBtn) {
      runBtn.disabled = true;
      runBtn.innerHTML = '<span>⏳</span> Calculating Ripple Propagation...';
    }

    try {
      const { data, isCached } = await this.store.runSimulation(
        selectedVersion._id,
        this.selectedType,
        this.selectedTarget,
        params
      );

      window.showToast(
        isCached ? 'Simulation loaded from cache (Score: ' + data.score + ')' : 'Simulation computed (Score: ' + data.score + ')',
        isCached ? 'info' : 'success'
      );

      // Re-render simulator page to show results
      this.render();
    } catch (err) {
      if (errBox) {
        errBox.style.display = 'block';
        let errorMsg = `<strong>Simulation Failed (${err.status || 400}):</strong> ${err.message}`;
        if (err.reasons && err.reasons.length > 0) {
          errorMsg += `<ul>${err.reasons.map(r => `<li>${r}</li>`).join('')}</ul>`;
        }
        errBox.innerHTML = errorMsg;
      }
      window.showToast('Simulation error: ' + err.message, 'error');
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.innerHTML = '<span>🚀</span> Calculate Blast Radius & Impact';
      }
    }
  },

  async handleSampleUpload(sampleName, label) {
    const { selectedProject } = this.store.state;
    if (!selectedProject) {
      window.showToast('Please select a project first', 'warning');
      return;
    }
    const pid = selectedProject._id || selectedProject.name;

    try {
      const res = await fetch(`/api/demo/samples/${sampleName}`);
      if (!res.ok) throw new Error(`Could not load sample: ${sampleName}`);
      const manifest = await res.json();
      await this.uploadCustomJson(manifest);
    } catch (err) {
      window.showToast(err.message, 'error');
    }
  },

  async uploadCustomJson(manifest) {
    const { selectedProject } = this.store.state;
    if (!selectedProject) {
      window.showToast('Please select a project first', 'warning');
      return;
    }
    const pid = selectedProject._id || selectedProject.name;

    try {
      const result = await this.store.uploadManifest(pid, manifest);
      if (result.status === 201) {
        window.showToast('Manifest uploaded successfully (Version created)!', 'success');
        await this.store.loadVersions(pid);
        this.render();
      } else if (result.status === 200 && result.data.status === 'duplicate') {
        window.showToast(`Duplicate manifest: ${result.data.message}`, 'warning');
      } else if (result.status === 422) {
        const reasons = result.data.reasons || [result.data.error];
        window.showToast(`Manifest rejected (422): ${reasons.slice(0, 2).join('; ')}`, 'error');
        const errBox = document.getElementById('validation-errors-box');
        if (errBox) {
          errBox.style.display = 'block';
          errBox.innerHTML = `<strong>Schema Validation Error (422):</strong><ul>${reasons.map(r => `<li>${r}</li>`).join('')}</ul>`;
        }
      } else {
        window.showToast(`Upload failed (${result.status}): ${result.data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      window.showToast(`Upload error: ${err.message}`, 'error');
    }
  }
};
