/**
 * src/routes/simulations.js — Simulation and comparison routes
 * Implements:
 * - POST /api/versions/:vid/simulate — Run what-if analysis (cached if identical)
 * - GET  /api/projects/:id/simulations — Simulation history (newest first)
 * - GET  /api/simulations/:sid — Full simulation report joined with summary
 * - GET  /api/compare?a=<sid>&b=<sid> — Compare two simulations using aggregation
 */
const { Router } = require('express');
const { getDb } = require('../db/index');
const { logEvent } = require('../db/events');
const { buildGraph } = require('../engine/buildGraph');
const { simulate } = require('../engine/simulate');
const { canonicalize, sha1 } = require('../engine/hash');
const { compareSimulations } = require('../services/analytics');

const router = Router();

/**
 * POST /api/versions/:vid/simulate
 * Run a what-if simulation against a specific graph version.
 * Body: { type: string, targetId: string, params: object }
 * Idempotent: returns cached result if the exact change was simulated before.
 */
router.post('/api/versions/:vid/simulate', async (req, res, next) => {
  try {
    const vid = req.params.vid;
    const change = req.body;

    // Validate body is non-empty object
    if (!change || typeof change !== 'object' || Array.isArray(change) || Object.keys(change).length === 0) {
      return res.status(400).json({
        error: 'Change definition must be a non-empty JSON object.',
        hint: 'Provide { "type": "...", "targetId": "...", "params": { ... } }'
      });
    }

    if (!change.type || !change.targetId) {
      return res.status(400).json({
        error: 'Missing required fields: "type" and "targetId" are required.',
        hint: 'Provide { "type": "RENAME_FIELD", "targetId": "db.users.user_name", "params": { ... } }'
      });
    }

    const db = getDb();

    // 1. Load components and edges for this graph version
    const [components, edges, versionDoc] = await Promise.all([
      db.collection('components').find({ versionId: vid }).toArray(),
      db.collection('dependency_edges').find({ versionId: vid }).toArray(),
      db.collection('graph_versions').findOne({ _id: vid })
    ]);

    if (!components.length) {
      return res.status(404).json({ error: `Graph version "${vid}" not found or has no components.` });
    }

    const projectId = versionDoc ? versionDoc.projectId : components[0].projectId;

    // 2. Rebuild the graph in memory using the pure engine
    const graph = buildGraph({ components, edges });

    // 3. Compute deterministic simulation ID: "<versionId>:<sha1(canonical change)>"
    const canonicalChange = canonicalize({
      type: change.type,
      targetId: change.targetId,
      params: change.params || {}
    });
    const changeHash = sha1(canonicalChange);
    const simulationId = `${vid}:${changeHash}`;

    // 4. Check if simulation is already cached in MongoDB
    const cachedSimulation = await db.collection('simulations').findOne({ _id: simulationId });
    if (cachedSimulation) {
      const cachedReport = await db.collection('impact_reports').findOne({ _id: simulationId });

      await logEvent({
        projectId,
        type: 'SIMULATION_CACHED',
        status: 'duplicate',
        details: { simulationId, score: cachedSimulation.score, label: cachedSimulation.label }
      });

      return res.status(200).json({
        status: 'cached',
        simulationId,
        projectId: cachedSimulation.projectId,
        versionId: cachedSimulation.versionId,
        change: cachedSimulation.change,
        score: cachedSimulation.score,
        label: cachedSimulation.label,
        counts: cachedSimulation.counts,
        createdAt: cachedSimulation.createdAt,
        affected: cachedReport ? cachedReport.affected : [],
        chains: cachedReport ? cachedReport.chains : []
      });
    }

    // 5. Run the pure simulation engine
    let result;
    try {
      result = simulate(graph, {
        type: change.type,
        targetId: change.targetId,
        params: change.params || {}
      });
    } catch (simErr) {
      if (simErr.status === 422 || simErr.errors) {
        return res.status(422).json({
          error: 'Simulation failed validation.',
          reasons: simErr.errors || [simErr.message]
        });
      }
      throw simErr;
    }

    // 6. Persist summary into `simulations` collection
    const simDoc = {
      _id: simulationId,
      projectId,
      versionId: vid,
      change: result.change,
      createdAt: new Date(),
      score: result.score,
      label: result.label,
      counts: result.counts
    };
    await db.collection('simulations').insertOne(simDoc);

    // 7. Persist detailed findings into `impact_reports` collection
    const reportDoc = {
      _id: simulationId,
      projectId,
      versionId: vid,
      simulationId,
      affected: result.affected,
      chains: result.chains
    };
    await db.collection('impact_reports').insertOne(reportDoc);

    // 8. Log audit event with stable eventId
    await logEvent({
      projectId,
      type: 'SIMULATION_RUN',
      status: 'ok',
      details: {
        simulationId,
        score: result.score,
        label: result.label,
        affectedCount: result.affected.length
      },
      eventId: `${simulationId}:run`
    });

    // 9. Respond with full report
    res.status(201).json({
      status: 'computed',
      simulationId,
      projectId,
      versionId: vid,
      change: result.change,
      score: result.score,
      label: result.label,
      counts: result.counts,
      createdAt: simDoc.createdAt,
      affected: result.affected,
      chains: result.chains
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/projects/:id/simulations
 * Return simulation history for a project, newest first.
 */
router.get('/api/projects/:id/simulations', async (req, res, next) => {
  try {
    const db = getDb();
    const simulations = await db.collection('simulations')
      .find({ projectId: req.params.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(simulations);
  } catch (err) { next(err); }
});

/**
 * GET /api/simulations/:sid
 * Return the full simulation report joined with summary details.
 */
router.get('/api/simulations/:sid', async (req, res, next) => {
  try {
    const db = getDb();
    const sid = req.params.sid;

    const [simulation, report] = await Promise.all([
      db.collection('simulations').findOne({ _id: sid }),
      db.collection('impact_reports').findOne({ _id: sid })
    ]);

    if (!simulation) {
      return res.status(404).json({ error: `Simulation "${sid}" not found.` });
    }

    res.json({
      ...simulation,
      affected: report ? report.affected : [],
      chains: report ? report.chains : []
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/compare?a=<sid>&b=<sid>
 * Compare two simulations side-by-side using MongoDB aggregation.
 */
router.get('/api/compare', async (req, res, next) => {
  try {
    const { a, b } = req.query;

    if (!a || !b) {
      return res.status(400).json({
        error: 'Query parameters "a" and "b" are both required to compare simulations.',
        hint: 'Use /api/compare?a=<simulationId1>&b=<simulationId2>'
      });
    }

    const comparison = await compareSimulations(a, b);

    if (!comparison) {
      return res.status(404).json({
        error: `Could not compare simulations: one or both simulation IDs ("${a}", "${b}") were not found.`
      });
    }

    res.json(comparison);
  } catch (err) { next(err); }
});

module.exports = router;
