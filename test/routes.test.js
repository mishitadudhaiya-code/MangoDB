/**
 * test/routes.test.js — Tests for project, manifest, simulation and compare routes
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Read ShopLite sample and invalid sample
const shoplite = JSON.parse(fs.readFileSync(path.join(__dirname, '../samples/shoplite.json'), 'utf8'));
const shopliteV2 = JSON.parse(fs.readFileSync(path.join(__dirname, '../samples/shoplite-v2.json'), 'utf8'));
const invalidManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../samples/invalid.json'), 'utf8'));

// In-memory mock database
function createMockDb() {
  const store = {
    projects: new Map(),
    graph_versions: new Map(),
    components: new Map(),
    dependency_edges: new Map(),
    simulations: new Map(),
    impact_reports: new Map(),
    events: new Map()
  };

  const createCollection = (name) => {
    const col = store[name];
    return {
      async insertOne(doc) {
        if (col.has(doc._id)) {
          const err = new Error(`E11000 duplicate key error collection: ${name}`);
          err.code = 11000;
          throw err;
        }
        col.set(doc._id, JSON.parse(JSON.stringify(doc)));
        return { insertedId: doc._id };
      },
      async insertMany(docs) {
        for (const doc of docs) {
          col.set(doc._id, JSON.parse(JSON.stringify(doc)));
        }
        return { insertedCount: docs.length };
      },
      async findOne(query) {
        for (const doc of col.values()) {
          let match = true;
          for (const [k, v] of Object.entries(query)) {
            if (doc[k] !== v) match = false;
          }
          if (match) return JSON.parse(JSON.stringify(doc));
        }
        return null;
      },
      find(query = {}) {
        let results = [];
        for (const doc of col.values()) {
          let match = true;
          for (const [k, v] of Object.entries(query)) {
            if (doc[k] !== v) match = false;
          }
          if (match) results.push(JSON.parse(JSON.stringify(doc)));
        }
        return {
          sort(sortObj) {
            const key = Object.keys(sortObj)[0];
            const dir = sortObj[key];
            results.sort((a, b) => (dir === -1 ? (b[key] > a[key] ? 1 : -1) : (a[key] > b[key] ? 1 : -1)));
            return this;
          },
          project(projObj) {
            results = results.map(doc => {
              const copy = { ...doc };
              for (const [k, v] of Object.entries(projObj)) {
                if (v === 0) delete copy[k];
              }
              return copy;
            });
            return this;
          },
          limit(n) {
            results = results.slice(0, n);
            return this;
          },
          async toArray() {
            return results;
          }
        };
      },
      async updateOne(filter, update, options = {}) {
        let existing = null;
        for (const doc of col.values()) {
          if (filter._id && doc._id === filter._id) {
            existing = doc;
            break;
          }
        }
        if (!existing && options.upsert && update.$setOnInsert) {
          const newDoc = { ...update.$setOnInsert };
          col.set(newDoc._id, newDoc);
          return { upsertedId: newDoc._id };
        }
        return { matchedCount: existing ? 1 : 0 };
      },
      aggregate(pipeline) {
        return {
          async toArray() {
            // Simplified execution of compare pipeline for unit testing
            const matchStage = pipeline.find(s => s.$match);
            if (matchStage && matchStage.$match && matchStage.$match._id && matchStage.$match._id.$in) {
              const ids = matchStage.$match._id.$in;
              const repA = store.impact_reports.get(ids[0]);
              const repB = store.impact_reports.get(ids[1]);
              if (!repA || !repB) return [];

              const simA = store.simulations.get(ids[0]);
              const simB = store.simulations.get(ids[1]);

              const setA = new Set((repA.affected || []).map(a => a.componentId));
              const setB = new Set((repB.affected || []).map(b => b.componentId));

              const onlyInAIds = [...setA].filter(x => !setB.has(x));
              const onlyInBIds = [...setB].filter(x => !setA.has(x));
              const inBothIds = [...setA].filter(x => setB.has(x));

              return [{
                docA: { ...repA, sim: simA },
                docB: { ...repB, sim: simB },
                onlyInAIds,
                onlyInBIds,
                inBothIds
              }];
            }
            return [];
          }
        };
      }
    };
  };

  return {
    collection(name) {
      return createCollection(name);
    },
    command: async () => ({ ok: 1 })
  };
}

describe('Step 3 & 4: API Routes Integration', () => {
  let mockDb;
  let projectsRouter;
  let simulationsRouter;

  // Helper to simulate express request / response
  async function callRoute(router, method, url, body = null, query = {}) {
    return new Promise((resolve) => {
      const parsedUrl = new URL(`http://localhost${url}`);
      for (const [k, v] of Object.entries(query)) {
        parsedUrl.searchParams.set(k, v);
      }
      const pathname = parsedUrl.pathname;
      const queryObj = Object.fromEntries(parsedUrl.searchParams.entries());

      const req = {
        method,
        url: parsedUrl.pathname + parsedUrl.search,
        path: pathname,
        body,
        query: queryObj,
        params: {}
      };

      const res = {
        statusCode: 200,
        headers: {},
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          resolve({ status: this.statusCode, body: data });
        }
      };

      // Match route in express router stack
      let matched = false;
      for (const layer of router.stack) {
        if (layer.route && layer.route.methods[method.toLowerCase()]) {
          const match = layer.match(pathname);
          if (match) {
            matched = true;
            req.params = layer.params || {};
            layer.handle_request(req, res, (err) => {
              if (err) resolve({ status: err.status || 500, body: { error: err.message, reasons: err.errors } });
            });
            break;
          }
        }
      }

      if (!matched) {
        resolve({ status: 404, body: { error: `Cannot ${method} ${pathname}` } });
      }
    });
  }

  before(() => {
    mockDb = createMockDb();
    const dbModule = require('../src/db/index');
    dbModule.getDb = () => mockDb;

    projectsRouter = require('../src/routes/projects');
    simulationsRouter = require('../src/routes/simulations');
  });

  describe('Projects & Manifests (Step 3)', () => {
    it('POST /api/projects should create a new project', async () => {
      const res = await callRoute(projectsRouter, 'POST', '/api/projects', { name: 'ShopLite Demo' });
      assert.equal(res.status, 201);
      assert.equal(res.body.name, 'ShopLite Demo');
      assert.equal(res.body.projectId, 'ShopLite Demo');
    });

    it('POST /api/projects should reject missing name with 400', async () => {
      const res = await callRoute(projectsRouter, 'POST', '/api/projects', {});
      assert.equal(res.status, 400);
      assert.ok(res.body.error);
    });

    it('POST /api/projects should reject duplicate name with 409', async () => {
      const res = await callRoute(projectsRouter, 'POST', '/api/projects', { name: 'ShopLite Demo' });
      assert.equal(res.status, 409);
    });

    it('GET /api/projects should list all projects', async () => {
      const res = await callRoute(projectsRouter, 'GET', '/api/projects');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].name, 'ShopLite Demo');
    });

    it('POST /api/projects/:id/manifest with empty body returns 400', async () => {
      const res = await callRoute(projectsRouter, 'POST', '/api/projects/ShopLite Demo/manifest', {});
      assert.equal(res.status, 400);
    });

    it('POST /api/projects/:id/manifest with invalid manifest returns 422 with reasons', async () => {
      const res = await callRoute(projectsRouter, 'POST', '/api/projects/ShopLite Demo/manifest', invalidManifest);
      assert.equal(res.status, 422);
      assert.ok(Array.isArray(res.body.reasons));
      assert.ok(res.body.reasons.length > 0);
    });

    let uploadedVersionId;
    it('POST /api/projects/:id/manifest with ShopLite returns 201', async () => {
      const res = await callRoute(projectsRouter, 'POST', '/api/projects/ShopLite Demo/manifest', shoplite);
      assert.equal(res.status, 201);
      assert.ok(res.body.versionId);
      assert.equal(res.body.componentCount, shoplite.components.length);
      assert.equal(res.body.edgeCount, shoplite.edges.length);
      uploadedVersionId = res.body.versionId;
    });

    it('POST /api/projects/:id/manifest duplicate returns 200 with status duplicate', async () => {
      const res = await callRoute(projectsRouter, 'POST', '/api/projects/ShopLite Demo/manifest', shoplite);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'duplicate');
      assert.equal(res.body.versionId, uploadedVersionId);
    });

    it('GET /api/projects/:id/versions returns the uploaded version', async () => {
      const res = await callRoute(projectsRouter, 'GET', '/api/projects/ShopLite Demo/versions');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0]._id, uploadedVersionId);
    });

    it('GET /api/versions/:vid/graph returns components and edges', async () => {
      const res = await callRoute(projectsRouter, 'GET', `/api/versions/${uploadedVersionId}/graph`);
      assert.equal(res.status, 200);
      assert.equal(res.body.components.length, shoplite.components.length);
      assert.equal(res.body.edges.length, shoplite.edges.length);
    });
  });

  describe('Simulations & Compare (Step 4)', () => {
    let versionId;
    let simIdRename;
    let simIdDelete;

    before(async () => {
      // Get the existing versionId
      const res = await callRoute(projectsRouter, 'GET', '/api/projects/ShopLite Demo/versions');
      versionId = res.body[0]._id;
    });

    it('POST /api/versions/:vid/simulate validates change input', async () => {
      const res = await callRoute(simulationsRouter, 'POST', `/api/versions/${versionId}/simulate`, {});
      assert.equal(res.status, 400);
    });

    it('POST /api/versions/:vid/simulate runs rename simulation and returns 201', async () => {
      const change = {
        type: 'RENAME_FIELD',
        targetId: 'db.users.user_name',
        params: { from: 'user_name', to: 'username' }
      };
      const res = await callRoute(simulationsRouter, 'POST', `/api/versions/${versionId}/simulate`, change);
      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'computed');
      assert.ok(res.body.simulationId);
      assert.ok(res.body.score >= 0 && res.body.score <= 100);
      assert.ok(res.body.affected.length > 0);
      simIdRename = res.body.simulationId;
    });

    it('POST /api/versions/:vid/simulate returns 200 cached for identical change', async () => {
      const change = {
        type: 'RENAME_FIELD',
        targetId: 'db.users.user_name',
        params: { from: 'user_name', to: 'username' }
      };
      const res = await callRoute(simulationsRouter, 'POST', `/api/versions/${versionId}/simulate`, change);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'cached');
      assert.equal(res.body.simulationId, simIdRename);
    });

    it('POST /api/versions/:vid/simulate runs delete field simulation and returns 201', async () => {
      const change = {
        type: 'DELETE_FIELD',
        targetId: 'db.users.email',
        params: {}
      };
      const res = await callRoute(simulationsRouter, 'POST', `/api/versions/${versionId}/simulate`, change);
      assert.equal(res.status, 201);
      assert.ok(res.body.simulationId);
      simIdDelete = res.body.simulationId;
    });

    it('GET /api/projects/:id/simulations lists simulations newest first', async () => {
      const res = await callRoute(simulationsRouter, 'GET', '/api/projects/ShopLite Demo/simulations');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 2);
    });

    it('GET /api/simulations/:sid returns full report with summary', async () => {
      const res = await callRoute(simulationsRouter, 'GET', `/api/simulations/${simIdRename}`);
      assert.equal(res.status, 200);
      assert.equal(res.body._id, simIdRename);
      assert.ok(Array.isArray(res.body.affected));
      assert.ok(Array.isArray(res.body.chains));
    });

    it('GET /api/compare requires both a and b query params', async () => {
      const res = await callRoute(simulationsRouter, 'GET', '/api/compare?a=123');
      assert.equal(res.status, 400);
    });

    it('GET /api/compare compares two simulations side-by-side', async () => {
      const res = await callRoute(simulationsRouter, 'GET', `/api/compare?a=${simIdRename}&b=${simIdDelete}`);
      assert.equal(res.status, 200);
      assert.ok(res.body.simulationA);
      assert.ok(res.body.simulationB);
      assert.ok(Array.isArray(res.body.onlyInA));
      assert.ok(Array.isArray(res.body.onlyInB));
      assert.ok(Array.isArray(res.body.inBoth));
      assert.ok(typeof res.body.scoreDifference === 'number');
    });
  });
});
