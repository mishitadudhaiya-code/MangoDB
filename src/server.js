require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const { connect } = require('./db/index');
const { setup } = require('./db/setup');
const projectsRouter = require('./routes/projects');
const simulationsRouter = require('./routes/simulations');
const analyticsRouter = require('./routes/analytics');
const demoRouter = require('./routes/demo');
const { initChangeStream } = require('./services/stream');
const { createRateLimiter } = require('./middleware/rateLimit');

const app = express();

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// Rate limit upload and simulation endpoints (60 req/min per IP)
const heavyLimiter = createRateLimiter({ windowMs: 60000, max: 60 });
app.use('/api/projects/:id/manifest', heavyLimiter);
app.use('/api/versions/:vid/simulate', heavyLimiter);

// Serve static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
app.use(projectsRouter);
app.use(simulationsRouter);
app.use(analyticsRouter);
app.use(demoRouter);

// Health check — also pings MongoDB
app.get('/api/health', async (req, res) => {
  try {
    const { getDb } = require('./db/index');
    const db = getDb();
    await db.command({ ping: 1 });
    res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  } catch (err) {
    res.json({ status: 'ok', db: 'down', time: new Date().toISOString() });
  }
});

// JSON error-handling middleware (including 413 Payload Too Large)
app.use((err, req, res, _next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: 'Payload too large. Maximum request body is 5MB.',
      hint: 'Ensure your manifest JSON is under 5MB.'
    });
  }
  console.error('Unhandled error:', err.message);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    hint: 'If this persists, check the server logs.'
  });
});

// Start server: connect to MongoDB, run setup, then listen
async function start() {
  const PORT = process.env.PORT || 3000;

  try {
    await connect();
    await setup();
    await initChangeStream();
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    console.error('Set MONGODB_URI in your .env file. The server will start without DB.');
  }

  app.listen(PORT, () => {
    console.log(`BugBound server listening on port ${PORT}`);
  });
}

start();

module.exports = app;
