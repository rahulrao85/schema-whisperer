# Schema Whisperer — DataHub Agent Hackathon

**Created:** 2026-07-30
**Deadline:** Aug 10, 2026 @ 2:00pm PDT (~11 days)
**Prize:** $6K grand / $3K × 4 challenge winners / $1K × 2 honourable / + Townhall talk, LinkedIn badge
**Devpost:** https://datahub.devpost.com/

---

## The Idea (one line)

An autonomous agent that does **deep MongoDB schema profiling** and writes rich, accurate metadata back to DataHub — solving DataHub's documented weakness (it only samples 1,000 docs per collection, so it misses rare fields, type conflicts, and nested structure).

## Why It Wins (maps to judging criteria)

| Criterion | How we score |
|---|---|
| **Use of DataHub** | Deep read (search/schema) + write-back (description/tags/terms/documents) |
| **Originality** | Solves a documented limitation — "goes beyond what DataHub provides" |
| **Real-World Usefulness** | Bad MongoDB metadata is a daily pain for data teams |
| **Technical Execution** | End-to-end working loop |
| **Bonus: OSS contribution** | Better MongoDB metadata quality = contribution to DataHub |

## The Core Loop (read → reason → write-back)

```
1. READ   DataHub MCP: search → get MongoDB datasets + their weak current schema
2. SCAN   MongoDB directly (what DataHub can't): full-collection profiling via
          aggregation pipeline ($facet, $group, $bucket):
            • field frequency (% of docs with each field)
            • type conflicts (field is string 92%, number 8%)
            • rare fields (missed by 1000-sample)
            • nested document & array schemas
3. REASON LLM: detect schema evolution (v1/v2/v3), infer business meaning
4. WRITE-BACK to DataHub:
            • update_description (accurate rich schema)
            • add_tags ("schema-evolving", "type-conflict:user_id")
            • add_terms (inferred business glossary)
            • save_document (full profile report)
```

## Why This Fits Rahul's Goals
- **Learn MongoDB:** aggregation pipeline ($facet/$group/$bucket), $jsonSchema validators, indexes, large-collection scanning, change streams. The real curriculum.
- **Reuse:** ~1 day scaffolding from Astra StockSense (Express API + setInterval pattern + OpenRouter LLM calls). Core profiling engine is net-new.
- **Build effort:** ~7–8 days of 11. Tight but doable.

## Demo Story
> "DataHub thought this collection had 12 fields. We found 47 — including 3 type conflicts and a nested schema DataHub flattened. Here's the enriched metadata we wrote back, autonomously."

---

## SETUP — What We Need

### 1. DataHub instance (LOCAL — zero cloud cost)
```bash
pip install acryl-datahub
datahub docker quickstart      # runs in a few minutes, includes sample data
```
- UI: http://localhost:9002
- GMS API: http://localhost:8080
- MCP endpoint: http://localhost:8080/mcp
- **Generate a Personal Access Token** in the UI (Admin → Access Tokens)

### 2. MongoDB (LOCAL via Docker — for our profiling target)
```bash
docker run -d --name whisper-mongo -p 27017:27017 mongo:7
```
- Seed with evolving-schema collections (we build the seeder)

### 3. Agent SDK (Python)
```bash
pip install datahub-agent-context     # requires Python 3.10+
pip install pymongo                    # MongoDB driver
```

### 4. LLM
- **OpenRouter API key** (we already use this for Astra StockSense / Hermes — reuse key)

### 5. Repo (Apache 2.0 — required by rules)
- Public GitHub repo with visible Apache 2.0 license in About section

---

## SUBMISSION CHECKLIST (per Devpost rules)
- [ ] Public repo, Apache 2.0 license visible in repo About
- [ ] Live demo URL (deploy somewhere)
- [ ] Text description (features, tech, data used)
- [ ] Demo video < 3 min, YouTube/Vimeo public
- [ ] `examples/` folder with sample outputs (profile reports)

## JUDGING REMINDER
- Must WRITE BACK to graph, not just read metadata
- Bonus for OSS contribution (we hit this via better MongoDB metadata)

---

## BACKUP IDEAS (if Schema Whisperer hits a wall)
- **Drift Radar** — same profiling engine, scheduled, diffs snapshots over time, alerts on schema drift (teaches change streams + time-series snapshots)
- **Quality Inspector** — profiles for null rates, duplicate keys, orphaned references across collections via $lookup (teaches cross-collection joins)

## RESEARCH SOURCES
- DataHub MongoDB ingestion: https://docs.datahub.com/docs/generated/ingestion/sources/mongodb
- schemaSamplingSize limitation (Issue #9287): https://github.com/datahub-project/datahub/issues/9287
- MongoDB source code: https://github.com/datahub-project/datahub/blob/master/metadata-ingestion/src/datahub/ingestion/source/mongodb.py
- Agent Context Kit: https://docs.datahub.com/docs/dev-guides/agent-context/agent-context
- Hackathon: https://datahub.devpost.com/
