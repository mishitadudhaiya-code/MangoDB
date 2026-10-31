require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// Serve static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// JSON error-handling middleware
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    hint: 'If this persists, check the server logs.'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BugBound server listening on port ${PORT}`);
});

module.exports = app;
