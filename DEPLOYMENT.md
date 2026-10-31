# BugBound — Production Deployment Guide & Checklist

## Pre-Deploy Checklist for Render / Cloud Hosting

- [x] **Zero Dev-Only Dependencies at Runtime**: All dependencies in `package.json` are production modules (`compression`, `cors`, `dotenv`, `express`, `mongodb`). Testing uses Node 20's built-in `node:test`.
- [x] **Environment Variables**:
  - `PORT`: Provided automatically by Render (defaults to `3000` locally).
  - `MONGODB_URI`: Atlas connection string (e.g. `mongodb+srv://<user>:<password>@cluster0.mongodb.net/?retryWrites=true&w=majority`).
  - `DB_NAME`: Database name (defaults to `bugbound`).
- [x] **MongoDB Atlas Network Access**:
  - In MongoDB Atlas -> **Network Access** -> Add IP Address: `0.0.0.0/0` (Allow Access from Anywhere) to permit Render's dynamic outbound IPs.
- [x] **Atlas Replica Set**:
  - Atlas free tier clusters (M0) are multi-node replica sets by default, which supports MongoDB **Change Streams**.
  - If a standalone MongoDB instance is used, BugBound automatically detects this and falls back to polling events every 3s so the live feed never crashes.
- [x] **No Secrets in Repo**:
  - `.env` is gitignored.
  - `.env.example` committed with blank placeholder values.
  - Logs NEVER print connection URIs, credentials, or secrets.
- [x] **Idempotent Database Startup**:
  - `setup()` runs safely on every server start, applying `$jsonSchema` validators and creating indexes with duplicate protection.
- [x] **Rate Limiting**:
  - In-memory rate limiting protects resource-intensive endpoints (`/api/projects/:id/manifest` and `/api/versions/:vid/simulate`) at 60 req/min per IP.
- [x] **Payload Limits**:
  - Express JSON body limit set to 5MB with friendly `413 Payload Too Large` JSON responses.
- [x] **Compression & Static Assets**:
  - HTTP gzip/brotli compression enabled.
  - Cytoscape.js and Chart.js loaded via reliable CDNs.

---

## Deploying to Render (Step-by-Step)

1. **Create Web Service**:
   - Connect your GitHub repository to [Render](https://render.com).
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: `Free`

2. **Configure Environment Variables**:
   In Render Dashboard -> Environment:
   ```
   NODE_ENV=production
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   DB_NAME=bugbound
   ```

3. **Verify Deployment**:
   - Access `https://<your-service>.onrender.com/api/health`
   - Expect `{ "status": "ok", "db": "up", "time": "..." }`
   - Open root URL `https://<your-service>.onrender.com` in your browser.
   - Click **Load ShopLite Demo** to verify the full flow end-to-end!
