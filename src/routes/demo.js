/**
 * src/routes/demo.js — Demo seed and one-click sample routes
 * Implements:
 * - POST /api/demo/seed — Auto-creates 'ShopLite Demo' and uploads samples/shoplite.json (idempotent)
 * - GET  /api/demo/samples/:name — Serves sample manifests (shoplite, shoplite-v2, invalid)
 */
const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/index');
const { logEvent } = require('../db/events');
const { canonicalize, sha256 } = require('../engine/hash');

const router = Router();

const DEMO_PROJECT_NAME = 'ShopLite Demo';
const SAMPLES_DIR = path.join(__dirname, '../../samples');

/**
 * POST /api/demo/seed
 * Seed the ShopLite Demo project with the standard ShopLite manifest.
 * Safe to call repeatedly (idempotent).
 */
router.post('/api/demo/seed', async (req, res, next) => {
  try {
    const db = getDb();

    // 1. Ensure project exists
    await db.collection('projects').updateOne(
      { _id: DEMO_PROJECT_NAME },
      { $setOnInsert: { _id: DEMO_PROJECT_NAME, name: DEMO_PROJECT_NAME, createdAt: new Date() } },
      { upsert: true }
    );

    // 2. Load samples/shoplite.json
    const samplePath = path.join(SAMPLES_DIR, 'shoplite.json');
    if (!fs.existsSync(samplePath)) {
      return res.status(500).json({ error: 'samples/shoplite.json not found on server.' });
    }

    const manifest = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

    // 3. Hash the canonical manifest
    const canonical = canonicalize(manifest);
    const manifestHash = sha256(canonical);
    const hash8 = manifestHash.substring(0, 8);
    const versionId = `${DEMO_PROJECT_NAME}:${hash8}`;

    // 4. Insert graph_version
    const versionDoc = {
      _id: versionId,
      projectId: DEMO_PROJECT_NAME,
      version: manifest.version || '1.0.0',
      manifestHash,
      componentCount: manifest.components.length,
      edgeCount: manifest.edges.length,
      createdAt: new Date()
    };

    let isDuplicate = false;
    try {
      await db.collection('graph_versions').insertOne(versionDoc);
    } catch (err) {
      if (err.code === 11000) {
        isDuplicate = true;
      } else {
        throw err;
      }
    }

    if (isDuplicate) {
      await logEvent({
        projectId: DEMO_PROJECT_NAME,
        type: 'MANIFEST_DUPLICATE',
        status: 'duplicate',
        details: { versionId, manifestHash }
      });

      return res.status(200).json({
        projectId: DEMO_PROJECT_NAME,
        versionId,
        status: 'duplicate',
        message: 'ShopLite Demo is already seeded.'
      });
    }

    // 5. Bulk insert components
    const componentDocs = manifest.components.map(c => ({
      _id: `${versionId}:${c.id}`,
      projectId: DEMO_PROJECT_NAME,
      versionId,
      componentId: c.id,
      type: c.type,
      name: c.name,
      criticality: c.criticality !== undefined && c.criticality !== null ? parseInt(c.criticality) : 3,
      meta: c.meta || {}
    }));

    if (componentDocs.length > 0) {
      await db.collection('components').insertMany(componentDocs, { ordered: false });
    }

    // Bulk insert edges
    const edgeDocs = manifest.edges.map(e => ({
      _id: `${versionId}:${e.from}>${e.kind}>${e.to}`,
      projectId: DEMO_PROJECT_NAME,
      versionId,
      from: e.from,
      to: e.to,
      kind: e.kind,
      dynamic: !!e.dynamic,
      meta: e.meta || {}
    }));

    if (edgeDocs.length > 0) {
      await db.collection('dependency_edges').insertMany(edgeDocs, { ordered: false });
    }

    // Log event
    await logEvent({
      projectId: DEMO_PROJECT_NAME,
      type: 'MANIFEST_UPLOADED',
      status: 'ok',
      details: { versionId, componentCount: componentDocs.length, edgeCount: edgeDocs.length },
      eventId: `${versionId}:uploaded`
    });

    res.status(201).json({
      projectId: DEMO_PROJECT_NAME,
      versionId,
      componentCount: componentDocs.length,
      edgeCount: edgeDocs.length,
      status: 'created',
      message: 'ShopLite Demo successfully seeded.'
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/demo/samples/:name
 * Return raw JSON sample manifest (e.g. shoplite, shoplite-v2, invalid)
 */
router.get('/api/demo/samples/:name', (req, res) => {
  let name = req.params.name.toLowerCase();
  if (!name.endsWith('.json')) name += '.json';

  const allowed = ['shoplite.json', 'shoplite-v2.json', 'invalid.json'];
  if (!allowed.includes(name)) {
    return res.status(404).json({
      error: `Sample "${name}" not found.`,
      availableSamples: ['shoplite', 'shoplite-v2', 'invalid']
    });
  }

  const filePath = path.join(SAMPLES_DIR, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File ${name} not found on server.` });
  }

  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: `Failed to read sample "${name}": ${err.message}` });
  }
});

module.exports = router;
