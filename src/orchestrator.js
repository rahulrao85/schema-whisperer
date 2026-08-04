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
        // Find the matching dataset URN in DataHub
        const datasets = await this.datahub.searchDatasets(profile.collection);
        const match = datasets.find(
          (d) => d.name && d.name.toLowerCase().includes(profile.collection.toLowerCase())
        );

        if (!match) {
          console.log(`  [datahub] No matching dataset for "${profile.collection}" — skipping write-back`);
          result.dataHubNote = 'No matching dataset found in DataHub (run the MongoDB ingestion first)';
          return result;
        }

        console.log(`  [datahub] Writing back to ${match.urn}`);
        await this.datahub.updateDescription(match.urn, description);
        if (tags.length) await this.datahub.addTags(match.urn, tags);
        await this.datahub.saveDocument(match.urn, `Deep Profile — ${profile.collection}`, report);
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
