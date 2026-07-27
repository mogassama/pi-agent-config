---
name: dataeng-architecture
description: Load for system-level data engineering decisions on any platform — sizing, service selection, pipeline shape, layered modeling, idempotency, observability, and cost posture. Platform-agnostic decision layer. Auto-load on architecture questions, tool comparisons, pipeline design, or "which approach for this?" decisions. For GCP-specific service selection and patterns, also load gcp-dataeng-architecture.
---

# Data Engineering Architecture — decision layer

Platform-agnostic. Nothing here names a cloud, a warehouse or a vendor. Load the
platform skill alongside this one once the platform is known.

## Philosophy

- **Push down to the engine.** If the warehouse or query engine can do it in SQL, do it
  there. Reach for a distributed processing framework only when the logic requires
  procedural code, multi-source joins in-flight, or streaming windowing.
- **Lean pipeline.** Fewer moving parts = fewer failure modes. Managed services before
  custom code, custom code before a new platform component.
- **Two options, one verdict.** Never propose a single solution silently. Always present
  Option A (simple/cheap) and Option B (robust/scalable) with explicit trade-offs, then
  recommend one with justification.

## Decision framework — V.L.R.

Before proposing any tool or architecture:

1. **Volume/Velocity** — MBs or TBs? Batch or stream? Growth rate?
2. **Latency** — Real-time (<1 min)? Near-real-time (1-15 min)? T+1 batch?
3. **Replayability** — Can we replay from raw? Can tasks restart safely mid-pipeline?

These three answers determine the right tool. Document them before recommending anything.

## Platform confidence — state it

The platform is an input, not a preference. Once it is fixed, recommend inside it and do
not propose a migration.

- **Solid ground** (the operator's practice area, or a platform whose current service
  catalogue and pricing model you can verify): recommend normally.
- **Thin ground** (a platform known in outline only): say so in one line before the
  recommendation, keep the advice at the level of patterns rather than named services and
  SKU-level pricing, and verify anything specific — docs, CLI `--help`, the provider's
  own reference — before asserting it.

A service selection table invented from memory is the architecture-level version of an
invented API. Same rule applies: verify or abstain.

## Sizing before selection

Match the tool to the measured volume, not to the largest volume imaginable.

| Volume per run | Reasonable default |
|:---|:---|
| < 1 GB | Single-process code, or SQL in the warehouse. No cluster. |
| 1 GB – 100 GB | Warehouse SQL, or a single well-sized container/VM. |
| > 100 GB, or a shuffle-heavy join | Distributed processing framework. |
| Unbounded stream | Streaming runtime with windowing and watermarks. |

Escalating a tier costs operational complexity permanently. Do it on evidence, not on
anticipated growth.

## Data modeling — layered architecture

| Layer | Characteristics | Implementation rule |
|---|---|---|
| **RAW** | Append-only, no transformation, source fidelity | Partitioned by ingestion or event date. Never edited in place. |
| **STAGING** | Deduped, type-cast, renamed, cleaned | Idempotent — full-partition replace or upsert by key. One source per model. |
| **MART** | Business logic, denormalized, aggregated | Pre-materialize what dashboards hit repeatedly. |

- Column-level and row-level security enforced in the warehouse — never delegated to the
  BI tool.
- Schema declared and validated at the ingestion edge — never hardcoded mid-pipeline,
  never auto-detected outside exploration.

## Idempotency — non-negotiable

Every pipeline task must be safe to run twice without manual cleanup.

- **Partition overwrite:** replace the target partition wholesale. Rerunning replaces,
  not appends.
- **Upserts:** merge on a stable business key. Always carry a `source_timestamp` so
  late-arriving data resolves deterministically.
- **Late data:** define a lookback window (e.g. reprocess the last 3 days) rather than
  relying on event-time exactness.
- **Orchestrated tasks:** every task restartable from its own checkpoint. No task depends
  on the side-effects of a previous failed run.

Name the mechanism explicitly in the design — "idempotent" without a mechanism is a wish.

## Recovery posture

Decide these three before the first production run, not after the first incident:

- **Recovery point** — how much data can be lost. Drives snapshot or backup cadence.
- **Recovery path** — replay from RAW, restore a snapshot, or rebuild from source. One of
  them must be tested at least once.
- **Retention cost** — every recovery window has a storage bill. Size the window against
  it rather than defaulting to the maximum.

## Observability

Every production pipeline needs:

- **Structured logs** with `run_id`, `source`, `rows_processed`, `duration_ms` at minimum.
- **Row count assertion** post-load (see `data-quality` skill).
- **Backlog alert** on any queue or subscription: age of the oldest unprocessed item.
- **Failure alert** on non-zero exit of any scheduled job.
- **Spend visibility** on the query or compute layer — a named place to answer "what ran
  expensive yesterday".

## Cost posture

- Establish a baseline early; alert on a multiple of it, not on an absolute number.
- A single operation that processes a volume disproportionate to the result it produces
  is a design problem, not a quota problem.
- Co-locate storage and compute. Cross-region transfer accumulates silently.
- Label every resource with owner, environment and cost centre from day one — retrofitting
  labels onto a live estate is far more expensive than adding them.

## Anti-patterns

- **Scaling tier chosen from anticipated growth** rather than measured volume.
- **Hardcoded schema mid-pipeline** — validate at the edge instead.
- **A single task doing too much** — split at natural checkpoints for restartability.
- **No dead-letter path** on any at-least-once delivery mechanism — silent loss in
  production.
- **Storage and compute in different regions** for no stated reason.
- **Stored procedures or in-database scripting for complex logic** — hard to test,
  version and debug. Use application code with unit tests.
- **A new platform component introduced without the problem it solves** stated first.

## Delivery format (mandatory)

Every architecture recommendation must follow this structure:

1. **Constraints:** latency target, volume, budget envelope, team size, platform.
2. **Option A (simple/cheap):** fewest components, push work into the engine, minimal ops.
3. **Option B (robust/scalable):** more components, more code, higher ops cost.
4. **Verdict:** one choice with an explicit "why" — not "it depends".
