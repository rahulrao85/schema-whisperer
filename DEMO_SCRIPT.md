================================================================================
                Schema Whisperer — Demo Recording Guide (VERIFIED)
================================================================================

STORY (verified true — use exactly this):
  "These MongoDB collections are in DataHub, but they're bare —
   no description, no tags, no governance. Schema Whisperer scans
   them deeply and writes back rich descriptions and PII/quality
   tags automatically."

NOTE: Do NOT claim field-count differences (e.g. "7 vs 12 fields").
      That story does NOT hold for this data. The demo is
      metadata ENRICHMENT only (empty description/tags -> filled).

PREREQUISITES (verified already running):
  - Terminal 1: node src/api/server.js        (port 3400, running)
  - DataHub UI: http://localhost:9002          (login datahub/datahub)
  - GMS API:    http://localhost:8080          (running)
  - DataHub is in CLEAN "before" state (verified: empty desc, no tags)

CRITICAL ORDER:
  1. Record SCENE 1 FIRST while DataHub is clean.
  2. THEN run one-shot.js.
  3. Do NOT run one-shot.js before Scene 1 — it would fill the
     metadata. If it happens, restore with: node scripts/reset-demo.js

================================================================================
SCENE 1 — Show the Problem (0:00 - 0:40)
================================================================================

OPEN BROWSER: http://localhost:9002  (login datahub / datahub)

1. Go to the "users" dataset (search "users" or Browse)
2. SHOW: Description is empty / "No description"
3. SHOW: No tags
4. SHOW: The dataset exists but is ungoverned / undocumented

SAY:
  "This is the users collection in DataHub.
   It's been ingested, but there's no description and no tags.
   Nobody knows what's in it or whether it contains personal data.
   This is a real problem for data teams."

================================================================================
SCENE 2 — Run the Agent (0:40 - 1:40)
================================================================================

OPEN TERMINAL (in F:\AGENTIC WORLD\datahub-schema-whisperer)

COMMAND:
  node scripts/one-shot.js

WATCH OUTPUT:
  - Profiles all 3 collections (events, orders, users)
  - users: 6 tags (pii-email, pii-phone, pii-name, type-conflict,
           schema-evolving, multi-schema)
  - "Write-back: ✅ SUCCESS" for all 3

SAY:
  "Now let's run Schema Whisperer.
   It scans every document, reasons about what it finds with an LLM,
   and writes the result back to DataHub — a description plus
   governance tags that flag PII and quality issues."

================================================================================
SCENE 3 — Show the Result (1:40 - 2:40)
================================================================================

REFRESH the users dataset page in DataHub

SHOW:
  - Rich LLM-generated description now present
  - Tags now visible: pii-email, pii-phone, pii-name, type-conflict
  - (Optional) switch to orders/events and show their tags too

SAY:
  "Refresh, and here's the result.
   The dataset now has a rich description and governance tags:
   pii-email, pii-phone — so a data consumer immediately knows
   this collection holds personal data.
   The read-reason-writeback loop works end to end."

================================================================================
SCENE 4 — Close (2:40 - 3:00)
================================================================================

SAY:
  "Schema Whisperer — an AI agent that closes the metadata gap
   for MongoDB collections in DataHub.
   Repo: github.com/rahulrao85/schema-whisperer
   Thanks!"

================================================================================
