/**
 * Schema Whisperer — Express API Server
 * ======================================
 * Exposes the agent over HTTP for the demo UI + Devpost submission.
 *
 * Endpoints:
 *   GET  /api/health          — status check
 *   GET  /api/collections     — list MongoDB collections
 *   POST /api/profile/:name   — profile one collection (deep scan)
 *   POST /api/analyze         — profile ALL + write-back to DataHub
 *   GET  /api/report/:name    — get the last report for a collection
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Whisperer } = require('../orchestrator');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3400;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve the demo UI
app.use(express.static(path.join(__dirname, '../../public')));

let whisperer = null;

async function getWhisperer() {
  if (!whisperer) {
    whisperer = new Whisperer({
      mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017',
      mongoDb: process.env.MONGO_DB || 'whisper_demo',
      datahub: {
        gmsUrl: process.env.DATAHUB_GMS_URL || 'http://localhost:8080',
        token: process.env.DATAHUB_TOKEN || null,
      },
      llm: {
        apiKey: process.env.OPENROUTER_API_KEY || null,
        model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash',
      },
    });
    await whisperer.connect();
  }
  return whisperer;
}

// --- health check ---
app.get('/api/health', async (req, res) => {
  try {
    const w = await getWhisperer();
    res.json({
      status: 'ok',
      mongo: 'connected',
      datahub: w.datahub ? 'connected' : 'not-configured',
      llm: w.reasoner.available ? 'enabled' : 'rule-based',
      model: w.config.llm.model,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// --- list collections ---
app.get('/api/collections', async (req, res) => {
  try {
    const w = await getWhisperer();
    const cols = await w.db.listCollections().toArray();
    const out = [];
    for (const c of cols) {
      if (c.name.startsWith('system.')) continue;
      const count = await w.db.collection(c.name).estimatedDocumentCount();
      out.push({ name: c.name, count });
    }
    res.json({ collections: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- profile a single collection ---
app.post('/api/profile/:name', async (req, res) => {
  try {
    const w = await getWhisperer();
    const { sampleSize } = req.body || {};
    const result = await w.profileOne(req.params.name, { sampleSize: sampleSize || null });
    res.json(result);
  } catch (err) {
    console.error('Profile error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- full analyze: profile all + write back to DataHub ---
app.post('/api/analyze', async (req, res) => {
  try {
    const w = await getWhisperer();
    const { writeToDataHub = false } = req.body || {};
    const results = await w.runAll({ writeToDataHub });
    res.json({ results });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  await getWhisperer();
  app.listen(PORT, () => {
    console.log(`\n🔧 Schema Whisperer API running at http://localhost:${PORT}`);
    console.log(`   Demo UI:  http://localhost:${PORT}`);
    console.log(`   Try:      POST http://localhost:${PORT}/api/profile/users\n`);
  });
}

// allow direct run: node src/api/server.js
if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { app, start };
