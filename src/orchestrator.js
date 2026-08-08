/**
 * Schema Whisperer — Orchestrator
 * =================================
 * Ties together the full read → reason → write-back loop:
 *
 *   1. CONNECT to MongoDB + DataHub
 *   2. PROFILE each collection deeply (profiler.js)
 *   3. REASON over the profile (reasoner.js — LLM + rules)
 *   4. WRITE BACK to DataHub (datahub.js — description, tags, docs)
 *
 * This is the agent's main workflow. The Express API (api/server.js)
 * exposes it over HTTP; this module can also run standalone (CLI).
 */

const { MongoClient } = require('mongodb');
const { profileDatabase } = require('./profiler/profiler');
const { DataHubClient } = require('./datahub/datahub');
const { Reasoner } = require('./llm/reasoner');

class Whisperer {
  constructor(config) {
    this.config = config; // { mongoUri, mongoDb, datahub: {gmsUrl, token}, llm: {apiKey, model} }
    this.mongoClient = null;
    this.datahub = null;
    this.reasoner = new Reasoner(config.llm || {});
  }

  async connect() {
    // MongoDB
    this.mongoClient = new MongoClient(this.config.mongoUri);
    await this.mongoClient.connect();
    this.db = this.mongoClient.db(this.config.mongoDb);
    console.log(`[whisperer] Connected to MongoDB: ${this.config.mongoDb}`);

    // DataHub (optional — agent can profile-only if DataHub not configured)
    if (this.config.datahub?.gmsUrl) {
      this.datahub = new DataHubClient(this.config.datahub);
      console.log(`[whisperer] Connected to DataHub: ${this.config.datahub.gmsUrl}`);
    } else {
      console.log('[whisperer] DataHub not configured — profile-only mode (no write-back)');
    }

    if (this.reasoner.available) {
      console.log(`[whisperer] LLM enabled: ${this.config.llm.model}`);
    } else {
      console.log('[whisperer] LLM not configured — using rule-based reasoning');
    }
  }

  /**
   * Run the full pipeline on every collection.
   * @param {object} opts - { writeToDataHub: bool, sampleSize: int|null }
   * @returns {object[]} - per-collection results
   */
  async runAll(opts = {}) {
    const { writeToDataHub = true, sampleSize = null } = opts;
    const results = [];

    console.log('\n=== Schema Whisperer — Full Run ===\n');
    const profiles = await profileDatabase(this.db, { sampleSize });

    for (const profile of profiles) {
      console.log(`\n--- Processing ${profile.collection} ---`);
      const result = await this.processCollection(profile, writeToDataHub);
      results.push(result);
    }

    console.log(`\n=== Complete: ${results.length} collections processed ===\n`);
    return results;
  }

  async processCollection(profile, writeToDataHub) {
    // 1. REASON — generate description, tags, report
    const description = await this.reasoner.generateDescription(profile);
    const tags = await this.reasoner.inferTags(profile);
    const report = this.reasoner.generateReport(profile, description);

    const result = {
      collection: profile.collection,
      profile,
      description,
      tags,
      report,
      writtenToDataHub: false,
    };

    // 2. WRITE BACK to DataHub if configured + enabled
    if (writeToDataHub && this.datahub) {
      try {
        // Try search first, then fall back to a directly-constructed URN.
        // Search can fail if the DataHub search index is unhealthy — the
        // URN is deterministic, so we can always write without searching.
        const urn = await this.resolveUrn(profile.collection);
        if (!urn) {
          console.log(`  [datahub] No matching dataset for "${profile.collection}" — skipping write-back`);
          result.dataHubNote = 'No matching dataset found in DataHub (run the MongoDB ingestion first)';
          return result;
        }

        console.log(`  [datahub] Writing back to ${urn}`);
        await this.datahub.updateDescription(urn, description);
        if (tags.length) await this.datahub.addTags(urn, tags);
        await this.datahub.saveDocument(urn, `Deep Profile — ${profile.collection}`, report);
        result.writtenToDataHub = true;
        console.log(`  [datahub] ✅ Updated description + ${tags.length} tags + report`);
      } catch (err) {
        console.error(`  [datahub] Write-back failed: ${err.message}`);
        result.dataHubError = err.message;
      }
    }

    return result;
  }

  /**
   * Resolve the DataHub URN for a collection. Tries search, then falls back
   * to a directly-constructed URN (the format is deterministic for the
   * MongoDB ingestion source).
   */
  async resolveUrn(collection) {
    // 1. Try search
    try {
      const datasets = await this.datahub.searchDatasets(collection);
      const match = datasets.find(
        (d) => d.name && d.name.toLowerCase().includes(collection.toLowerCase())
      );
      if (match) return match.urn;
    } catch (e) {
      console.log(`  [datahub] Search failed (${e.message.split('Root cause:')[0].trim()}) — trying direct URN`);
    }

    // 2. Fall back to direct URN construction.
    // DataHub MongoDB ingestion URN format:
    //   urn:li:dataset:(urn:li:dataPlatform:mongodb,<host>.<db>.<collection>,PROD)
    // The host here is DataHub's platform instance name, which we must
    // resolve from the Mongo URI WITHOUT credentials. Support the Atlas
    // format (cluster0.o681k9z.mongodb.net -> atlas-cluster0) and a raw
    // configured value (MONGO_DATAHUB_HOST) as an escape hatch.
    const uri = this.config.mongoUri;
    let host = this.config.mongoDatahubHost || null;
    if (!host && uri) {
      const clean = uri.replace(/^mongodb(\+srv)?:\/\/[^@]+@/, ''); // strip user:pass@
      const m = clean.match(/^([^.]+)/); // first label of the host
      if (m) host = `atlas-${m[1]}`;
    }
    host = host || 'localhost';
    return `urn:li:dataset:(urn:li:dataPlatform:mongodb,${host}.${this.config.mongoDb}.${collection},PROD)`;
  }

  /**
   * Profile a single collection (for the API + quick testing).
   */
  async profileOne(collectionName, { sampleSize = null } = {}) {
    const { profileCollection } = require('./profiler/profiler');
    const profile = await profileCollection(this.db, collectionName, { sampleSize });
    const description = await this.reasoner.generateDescription(profile);
    const tags = await this.reasoner.inferTags(profile);
    const report = this.reasoner.generateReport(profile, description);
    return { profile, description, tags, report };
  }

  async close() {
    if (this.mongoClient) await this.mongoClient.close();
  }
}

module.exports = { Whisperer };
