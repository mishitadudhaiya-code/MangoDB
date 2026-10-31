/**
 * src/routes/analytics.js — Analytics and live SSE stream routes
 * Implements:
 * - GET /api/projects/:id/analytics — blast rankings, fragile components, hotspots
 * - GET /api/projects/:id/events — last 50 events for a project
 * - GET /api/stream — Server-Sent Events (SSE) live feed
 */
const { Router } = require('express');
const { getDb } = require('../db/index');
const { blastRankings, fragileComponents, hotspots } = require('../services/analytics');
const { handleStreamConnection } = require('../services/stream');

const router = Router();

/**
 * GET /api/projects/:id/analytics
 * Returns top blast-radius simulations, fragile components, and dependency hotspots.
 */
router.get('/api/projects/:id/analytics', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const db = getDb();

    // Find the latest graph version for this project to compute current hotspots
    const latestVersion = await db.collection('graph_versions')
      .findOne({ projectId }, { sort: { createdAt: -1 } });

    const [rankings, fragile, hot] = await Promise.all([
      blastRankings(projectId),
      fragileComponents(projectId),
      latestVersion ? hotspots(latestVersion._id) : Promise.resolve([])
    ]);

    res.json({
      projectId,
      latestVersionId: latestVersion ? latestVersion._id : null,
      blastRankings: rankings,
      fragileComponents: fragile,
      hotspots: hot
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/projects/:id/events
 * Returns the last 50 events for audit history and initial UI load.
 */
router.get('/api/projects/:id/events', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const db = getDb();

    const events = await db.collection('events')
      .find({ projectId })
      .sort({ at: -1 })
      .limit(50)
      .toArray();

    res.json(events);
  } catch (err) { next(err); }
});

/**
 * GET /api/stream
 * Server-Sent Events (SSE) stream for live event feed.
 */
router.get('/api/stream', (req, res) => {
  handleStreamConnection(req, res);
});

module.exports = router;
