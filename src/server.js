require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const { connect } = require('./db/index');
const { setup } = require('./db/setup');

const app = express();

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// Serve static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// JSON error-handling middleware
app.use((err, req, res, _next) => {
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
