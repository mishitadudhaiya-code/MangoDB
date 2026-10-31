/**
 * src/routes/scan.js — Heuristic source code scanner endpoint
 * Implements: POST /api/scan
 */
const { Router } = require('express');
const { scanSourceFiles } = require('../engine/scanner');

const router = Router();

/**
 * POST /api/scan
 * Body: { files: [{ path: string, content: string }] }
 */
router.post('/api/scan', (req, res, next) => {
  try {
    const { files } = req.body || {};

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid "files" array.',
        hint: 'Provide { "files": [{ "path": "src/App.js", "content": "..." }] }'
      });
    }

    const result = scanSourceFiles(files);

    res.json({
      project: result.manifest.project,
      componentCount: result.manifest.components.length,
      edgeCount: result.manifest.edges.length,
      valid: result.valid,
      errors: result.errors,
      manifest: result.manifest
    });
  } catch (err) { next(err); }
});

module.exports = router;
