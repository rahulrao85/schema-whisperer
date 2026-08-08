# Schema Whisperer

**Deep MongoDB schema profiling for DataHub.**

> DataHub samples only 1,000 documents per MongoDB collection to infer schema ([datahub#9287](https://github.com/datahub-project/datahub/issues/9287)). For schemaless collections that evolve over time, this misses rare fields, type conflicts, and nested structure. Schema Whisperer does what DataHub can't — deep profiling via the aggregation pipeline, then writes enriched metadata back to the catalog.

## What It Does

```
READ  DataHub → get MongoDB datasets + their weak current schema
SCAN  MongoDB directly → full-collection profiling (field frequency, type conflicts, rare fields, schema variants)
REASON LLM → generate rich descriptions, detect PII, infer business glossary terms
WRITE DataHub → enriched description, tags, glossary terms, diagnosis report
```

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/rahulrao85/schema-whisperer.git
cd schema-whisperer
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your MongoDB URI, DataHub GMS URL, and OpenRouter API key
```

### 3. Start Infrastructure

```bash
npm run docker:up
# Wait ~2 min for DataHub + MongoDB to be ready
# DataHub UI: http://localhost:9002
# DataHub GMS: http://localhost:8080
```

### 4. Seed Test Data

```bash
npm run seed
# Seeds 3 collections (23,000 docs total) with deliberate schema blind spots
```

### 5. Run

```bash
npm start
# API at http://localhost:3400
# Demo UI at http://localhost:3400
```

### 6. Try It

```bash
# CLI: profile one collection
node scripts/profile-cli.js users

# CLI: profile all + save reports
node scripts/profile-cli.js

# API: profile via HTTP
curl -X POST http://localhost:3400/api/profile/orders | jq

# API: full analyze + write-back to DataHub
curl -X POST http://localhost:3400/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"writeToDataHub": true}'

# Demo: one command — profile all collections + write back to DataHub
node scripts/one-shot.js

# Demo: reset DataHub to clean "before" state (empty description, no tags)
node scripts/reset-demo.js
```

## Demo Flow

```
1. node scripts/reset-demo.js    # clean "before" state in DataHub
2. node scripts/one-shot.js      # deep profile + write description & tags back
3. Refresh DataHub UI            # dataset now has description + PII/quality tags
```

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the full recording guide.

## Architecture

```
datahub-schema-whisperer/
├── src/
│   ├── profiler/profiler.js      # MongoDB aggregation pipeline profiling engine
│   ├── datahub/datahub.js        # DataHub GraphQL read/write integration
│   ├── llm/reasoner.js           # LLM reasoning + rule-based fallback
│   ├── orchestrator.js           # Main read → reason → write-back loop
│   └── api/server.js             # Express API + demo UI server
├── seeders/seed.js               # Test data with evolving schemas
├── docker/docker-compose.yml     # DataHub + MongoDB local stack
├── public/index.html             # Demo UI (single-page app)
├── scripts/profile-cli.js         # CLI profiling tool
└── examples/                      # Saved profile reports
```

## What The Test Data Contains

| Collection | Docs | Blind Spots |
|---|---|---|
| `users` | 5,000 | Rare field `legacyUuid` (0.5%), type conflict on `createdAt` (Date vs string), schema variants v1/v2/v3 |
| `orders` | 8,000 | Type conflict on `amount` (number vs "$49.99" string), status enum drift |
| `events` | 10,000 | Very rare `errorStack` (0.2%), nullable `device` field |

These are the exact patterns DataHub's 1000-doc sampling misses.

## Key MongoDB Skills Used

- **`$objectToArray`** — iterate document keys (field discovery)
- **`$group`** — aggregate field presence + type counts
- **`$facet`** — parallel multi-query in one pass
- **`$sample`** — controlled sampling
- **`$cond` + `$ifNull`** — presence detection
- **`$type`** — BSON type introspection

## Tech Stack

- Node.js (Express)
- MongoDB (aggregation pipeline)
- DataHub (GraphQL API / MCP)
- OpenRouter (LLM — DeepSeek V3 Flash)

## License

Apache 2.0 — see [LICENSE](LICENSE)
