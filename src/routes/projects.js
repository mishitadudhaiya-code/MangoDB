/**
 * src/routes/projects.js — Project and manifest routes
 * Implements: POST/GET /api/projects, POST manifest upload (idempotent),
 * GET versions, GET graph
 */
const { Router } = require('express');
const { getDb } = require('../db/index');
const { logEvent } = require('../db/events');
const { validateManifest } = require('../engine/validateManifest');
const { canonicalize, sha256 } = require('../engine/hash');

const router = Router();

// ==================== Projects ====================

/**
 * POST /api/projects — Create a new project
 * Body: { name: string }
 */
router.post('/api/projects', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Missing or invalid "name" field.', hint: 'Provide { "name": "MyProject" }' });
    }

    const db = getDb();
    const doc = { _id: name.trim(), name: name.trim(), createdAt: new Date() };

    try {
      await db.collection('projects').insertOne(doc);
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: `Project "${name.trim()}" already exists.` });
      }
      throw err;
    }

    res.status(201).json({ projectId: doc._id, name: doc.name, createdAt: doc.createdAt });
  } catch (err) { next(err); }
});

/**
 * GET /api/projects — List all projects
 */
router.get('/api/projects', async (req, res, next) => {
  try {
    const db = getDb();
    const projects = await db.collection('projects').find({}).sort({ createdAt: -1 }).toArray();
    res.json(projects);
  } catch (err) { next(err); }
});

// ==================== Manifest Upload ====================

/**
 * POST /api/projects/:id/manifest — Upload a manifest (idempotent)
 * Steps:
 * 1. Validate body exists and is an object
 * 2. Run validateManifest
 * 3. Hash the canonical manifest → versionId
 * 4. Insert graph_version (duplicate key → return "duplicate")
 * 5. Bulk insert components and edges
 */
router.post('/api/projects/:id/manifest', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const manifest = req.body;

    // Step 1: Check body (empty/non-object -> 400 {error, hint}; log MANIFEST_REJECTED)
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).length === 0) {
      await logEvent({ projectId, type: 'MANIFEST_REJECTED', status: 'rejected', details: { reason: 'Empty or non-object body' } });
      return res.status(400).json({ error: 'Request body must be a manifest JSON object.', hint: 'Send a manifest with project, version, components, and edges.' });
    }

    // Step 2: Validate manifest (invalid -> 422 {error, reasons:[...]}; log MANIFEST_REJECTED with reasons)
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      await logEvent({ projectId, type: 'MANIFEST_REJECTED', status: 'rejected', details: { reasons: validation.errors } });
      return res.status(422).json({ error: 'Invalid manifest.', reasons: validation.errors });
    }

    const db = getDb();

    // Ensure project exists (upsert so manifest can create or update project)
    await db.collection('projects').updateOne(
      { _id: projectId },
      { $setOnInsert: { _id: projectId, name: manifest.project || projectId, createdAt: new Date() } },
      { upsert: true }
    );

    // Step 3: Hash
    const canonical = canonicalize(manifest);
    const manifestHash = sha256(canonical);
    const hash8 = manifestHash.substring(0, 8);
    const versionId = `${projectId}:${hash8}`;

    // Step 4: Insert graph_version
    const versionDoc = {
      _id: versionId,
      projectId,
      version: manifest.version || '1.0.0',
      manifestHash,
      componentCount: manifest.components.length,
      edgeCount: manifest.edges.length,
      createdAt: new Date()
    };

    try {
      await db.collection('graph_versions').insertOne(versionDoc);
    } catch (err) {
      if (err.code === 11000) {
        // Duplicate manifest — idempotent
        await logEvent({ projectId, type: 'MANIFEST_DUPLICATE', status: 'duplicate', details: { versionId, manifestHash } });
        return res.status(200).json({ status: 'duplicate', versionId, message: 'This manifest has already been uploaded.' });
      }
      throw err;
    }

    // Step 5: Bulk insert components
    const componentDocs = manifest.components.map(c => ({
      _id: `${versionId}:${c.id}`,
      projectId,
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
      projectId,
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
      projectId,
      type: 'MANIFEST_UPLOADED',
      status: 'ok',
      details: { versionId, componentCount: componentDocs.length, edgeCount: edgeDocs.length },
      eventId: `${versionId}:uploaded`
    });

    res.status(201).json({
      versionId,
      componentCount: componentDocs.length,
      edgeCount: edgeDocs.length
    });
  } catch (err) { next(err); }
});

// ==================== Versions ====================

/**
 * GET /api/projects/:id/versions — List graph versions for a project
 */
router.get('/api/projects/:id/versions', async (req, res, next) => {
  try {
    const db = getDb();
    const versions = await db.collection('graph_versions')
      .find({ projectId: req.params.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(versions);
  } catch (err) { next(err); }
});

/**
 * GET /api/versions/:vid/graph — Get components and edges for a version
 */
router.get('/api/versions/:vid/graph', async (req, res, next) => {
  try {
    const db = getDb();
    const vid = req.params.vid;

    const [components, edges] = await Promise.all([
      db.collection('components')
        .find({ versionId: vid })
        .project({ _id: 0, projectId: 0, versionId: 0 })
        .toArray(),
      db.collection('dependency_edges')
        .find({ versionId: vid })
        .project({ _id: 0, projectId: 0, versionId: 0 })
        .toArray()
    ]);

    if (components.length === 0) {
      return res.status(404).json({ error: `Version "${vid}" not found or has no components.` });
    }

    res.json({ components, edges });
  } catch (err) { next(err); }
});

module.exports = router;
