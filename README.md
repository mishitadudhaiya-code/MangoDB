# BugBound

> **One tiny code change. How much of your application does it break?**

BugBound builds a dependency graph of your project and simulates what a proposed change would break, showing the chain reaction, the blast radius and the components that need manual review — before you deploy.

## Status

🚧 Under active development — hackathon project for UNCHARTED 2026 (NEXUS × SVNIT Surat, Track 3: Developer Tools for Production Use Cases).

## Quick Start

```bash
npm install
cp .env.example .env
# Fill in MONGODB_URI with your MongoDB Atlas connection string
npm start
```

Open http://localhost:3000 and verify the health check.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string (replica set required for change streams) |
| `DB_NAME` | Database name (default: `bugbound`) |
| `PORT` | Server port (default: `3000`) |

## Tech Stack

- Node.js 20 + Express
- MongoDB Atlas (official driver, no Mongoose)
- Vanilla HTML/CSS/JS frontend
- Cytoscape.js for graph visualization
- Chart.js for analytics charts

## Limitations

- Static, rule-based analysis — results are potential impact estimates, not guarantees
- Input is a project manifest (JSON), not arbitrary repositories
- Dynamic access (`obj[variableKey]`) is reported as UNCERTAIN, not guessed
- No full-language parsing, whole-repo analysis, type inference, or runtime tracing
- No auth, multi-user support, or GitHub integration

## Libraries

See `package.json` for the full list.
