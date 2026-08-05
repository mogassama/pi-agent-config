---
name: spark-engineering
description: >-
  Load for PySpark authoring, debugging or tuning — lazy evaluation and the
  action boundary, shuffle and partitioning, join strategy and skew, the UDF
  hierarchy, caching discipline, Parquet I/O, notebook-specific pitfalls.
  Territory-scoped: SparkSession, DataFrame transformations, .parquet reads and
  writes, executor and shuffle configuration. Also load when a job on this
  engine is slow, skewed, or OOMing — the engine semantics are the answer, not
  the search method.

---

# Spark Engineering

Engine-level rules, valid on local/Jupyter, Dataproc, and Databricks alike.
Platform-specific submission and IAM belong in `gcp-engineering`, not here.

## Non-negotiables

- DataFrame API only. Never RDD unless the operation has no DataFrame equivalent.
- Never a Python UDF when a `pyspark.sql.functions` equivalent exists.
- Explicit schema on every read. `inferSchema` is a debugging convenience, not production code.
- Every `.cache()` has a matching `.unpersist()`.
- `.collect()` and `.toPandas()` require a preceding `.limit()` or an aggregation that
  provably bounds the result. No exceptions in exploratory code either.

## Mental model — what actually runs

Transformations are lazy and build a logical plan. Only **actions** trigger execution:
`show`, `count`, `collect`, `toPandas`, `write`, `foreach`, `take`.

Two transformation classes, and the distinction drives every performance decision:

| Class | Examples | Cost |
|---|---|---|
| Narrow | `select`, `filter`, `withColumn`, `union` | No data movement, pipelined in one stage |
| Wide | `groupBy`, `join`, `distinct`, `orderBy`, `repartition` | Full shuffle — disk write, network transfer, new stage |

A job's runtime is dominated by its wide transformations. Optimising a narrow chain is
almost always wasted effort. Count the shuffles first (`df.explain("formatted")`,
look for `Exchange` nodes), then optimise.

## Filter and project early

Catalyst pushes predicates and column pruning down automatically **on native
operations over Parquet**. It cannot push anything through a Python UDF — a UDF in the
plan acts as an optimisation barrier for everything downstream of it.

```python
# The UDF blocks pushdown: the full table is read, then filtered
df.withColumn("region", classify_udf("code")).filter(F.col("year") == 2026)

# Filter first, and prefer a native expression over the UDF entirely
(df.filter(F.col("year") == 2026)
   .withColumn("region", F.when(F.col("code").startswith("FR"), "EU").otherwise("OTHER")))
```

## Shuffle and partitioning

`spark.sql.shuffle.partitions` defaults to 200 — a value tuned for neither a laptop nor
a large cluster. It is the single most impactful knob.

- Local / small data (< 1 GB): set to 8–16. 200 partitions on a 4-core machine means
  200 tasks of near-zero work, each with real scheduling overhead.
- Cluster: target 2–4× total executor cores, aiming for partitions of ~128 MB.

With AQE enabled (default since Spark 3.2) this value is an upper bound —
`coalescePartitions` shrinks it at runtime. Set it high enough to give AQE room, not low
enough to constrain it.

```python
spark.conf.set("spark.sql.shuffle.partitions", 16)          # runtime-modifiable
spark.conf.set("spark.sql.adaptive.enabled", True)          # on by default 3.2+
spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", True)
spark.conf.set("spark.sql.adaptive.skewJoin.enabled", True)
```

### repartition vs coalesce

- `repartition(n)` — full shuffle, produces balanced partitions. Use before an expensive
  wide operation or to fix skew.
- `coalesce(n)` — no shuffle, merges partitions locally. Cheap, but **propagates its
  parallelism upstream**: `coalesce(1)` before a write collapses the entire preceding
  computation to a single task. Use `repartition(1)` if the upstream work must stay
  parallel.
- `repartition(col)` before a join or `groupBy` on that same column can eliminate a
  shuffle downstream — only worth it if reused more than once.

## Joins

| Strategy | When Spark picks it | Cost |
|---|---|---|
| Broadcast hash | One side < `spark.sql.autoBroadcastJoinThreshold` (10 MB default) | No shuffle — always the goal |
| Sort-merge | Both sides large | Two shuffles + sort |
| Shuffle hash | Rare, one side much smaller but above threshold | One shuffle |

Raise the threshold when a dimension table is 50–200 MB and the driver can hold it:

```python
spark.conf.set("spark.sql.autoBroadcastJoinThreshold", 100 * 1024 * 1024)
# or force it, bypassing the size estimate (which is wrong on unstatted sources):
fact.join(F.broadcast(dim), "dim_id", "left")
```

Broadcast is collected **through the driver**. Broadcasting something too large gives a
driver OOM, not a graceful fallback.

### Skew

Symptom: 199 tasks finish in seconds, one runs for minutes, memory spills. Confirm before
acting — a wide stage that is merely slow is not skew.

```python
df.groupBy("join_key").count().orderBy(F.desc("count")).show(20)
```

Fixes, in order of preference:

1. AQE `skewJoin` — splits oversized partitions automatically. Handles most cases.
2. Broadcast the small side — no shuffle means no skew.
3. Filter the hot keys into a separate join and union the results.
4. Salting — last resort, it complicates the code permanently:

```python
SALT = 16
left  = df.withColumn("_salt", (F.rand() * SALT).cast("int"))
right = dim.withColumn("_salt", F.explode(F.array([F.lit(i) for i in range(SALT)])))
left.join(right, ["join_key", "_salt"]).drop("_salt")
```

## UDF hierarchy — never skip a tier

1. **Native `pyspark.sql.functions`** — runs in the JVM, fully optimised by Catalyst.
2. **`pandas_udf`** — vectorised via Arrow, batch-at-a-time. Roughly an order of
   magnitude faster than a row-wise UDF.
3. **Python UDF** — row-by-row serialisation between JVM and a Python worker, opaque to
   Catalyst, blocks pushdown. Justify it in a comment or don't write it.

```python
@F.pandas_udf("double")
def normalise(s: pd.Series) -> pd.Series:
    return (s - s.mean()) / s.std()
```

Reach for `F.when`/`F.regexp_extract`/`F.transform`/`F.aggregate` before concluding no
native equivalent exists. Higher-order functions cover most array and struct logic.

The pushdown cost is concrete: a UDF in the projection prevents the filter from
reaching the scan. See the example under "Predicate pushdown" above.

## Caching

`.cache()` is `.persist(MEMORY_AND_DISK)` for DataFrames, and it is **lazy** — nothing
materialises until the next action.

Cache only when a DataFrame is consumed by **two or more** actions and its lineage is
expensive. A cached DataFrame read once is pure overhead: serialisation cost, memory
pressure, and evicted partitions get recomputed anyway.

```python
enriched = expensive_chain(df).cache()
enriched.count()          # materialise deliberately
metrics_a = enriched.groupBy("region").agg(...)
metrics_b = enriched.filter(...).join(...)
...
enriched.unpersist()      # mandatory
```

Prefer writing an intermediate Parquet dataset over caching when the lineage is long —
it also truncates the plan, which keeps `explain()` readable and recovery cheap.

## I/O

- Parquet by default. CSV/JSON for ingestion boundaries only.
- Always declare the schema:

```python
schema = T.StructType([
    T.StructField("event_id", T.StringType(), nullable=False),
    T.StructField("event_ts", T.TimestampType(), nullable=False),
    T.StructField("amount",   T.DecimalType(18, 2), nullable=True),
])
df = spark.read.schema(schema).parquet(path)
```

- `partitionBy` on a **low-cardinality** column only (date, country, not user_id).
  High cardinality gives thousands of tiny files and a metadata-bound read.
- Target 128 MB–1 GB per output file. Control it with `repartition` before the write, not
  `coalesce(1)`.
- `mode("overwrite")` with `partitionOverwriteMode=dynamic` to replace a single partition
  rather than the whole dataset:

```python
spark.conf.set("spark.sql.sources.partitionOverwriteMode", "dynamic")
df.write.mode("overwrite").partitionBy("event_date").parquet(path)
```

## Notebook / Jupyter discipline

The interactive loop introduces failure modes that don't exist in a submitted job.

- **`getOrCreate()` silently ignores new config.** If a session already exists in the JVM,
  the builder returns it and every `.config(...)` in the chain is discarded — no warning.
  Changing a session-level setting requires `spark.stop()` then a fresh build.
- **Driver memory cannot be set at runtime.** `spark.driver.memory` is read at JVM
  startup. In local mode the driver *is* the executor, so this is usually the memory that
  matters — set it via `PYSPARK_SUBMIT_ARGS` or `SPARK_DRIVER_MEMORY` before the kernel
  starts. `spark.conf.set` on it does nothing.
- **Every `.show()` recomputes the full lineage.** Ten exploratory cells on an uncached
  DataFrame means ten full recomputations. Cache once at the branch point, or write an
  intermediate dataset.
- **Cache leaks across cells.** Re-running a cell that caches without unpersisting the
  previous handle strands the old one in memory. `spark.catalog.clearCache()` when the
  storage tab looks wrong.
- **`.toPandas()` pulls everything to the driver.** With Arrow disabled it is also
  extremely slow: `spark.sql.execution.arrow.pyspark.enabled = True`.
- Spark UI on `localhost:4040` — Stages tab for task duration distribution (skew), Storage
  tab for what is actually cached, SQL tab for the physical plan with row counts.
- `spark.stop()` at the end of the notebook. A stale session holds ports and memory.

## Debugging sequence

1. `df.explain("formatted")` — count `Exchange` nodes (shuffles) and check join strategy.
2. Spark UI → Stages → sort tasks by duration. A max/median ratio above ~10 means skew.
3. Check spill columns. Spill to disk means the partition doesn't fit in memory: more
   partitions, not more memory.
4. Check input size per task. Many tiny tasks means over-partitioning; a few huge ones
   means under-partitioning or an unsplittable source (gzip CSV).
5. Only then tune memory.

## Anti-patterns — never do these

- `collect()` or `toPandas()` on an unbounded DataFrame — driver OOM, and it defeats the
  point of using Spark.
- `coalesce(1)` before a write on a non-trivial pipeline — serialises the whole job.
- `.cache()` on a DataFrame used once.
- `count()` sprinkled through a pipeline as a progress indicator — each one is a full job.
- Python UDF for string manipulation, date arithmetic, or conditional logic.
- `inferSchema=True` in production — extra full pass over the data and a schema that
  changes silently with the input.
- Chaining `withColumn` dozens of times in a loop — build one `select` with all
  expressions instead; the incremental plan growth is quadratic.
- Reading gzipped CSV and expecting parallelism — gzip is unsplittable, one task per file.
- Tuning executor memory before looking at the partition count.
- `spark.conf.set` on a startup-only config (`driver.memory`, `executor.instances`,
  `serializer`) and assuming it took effect.

## Review delta

*Everything above is authoring guidance, injected for both worker and reviewer.
This section is injected for the reviewer only. It replaces the former
`## Review checklist`.*

**Floor.** For a diff under ~10 lines, report only HIGH findings.

**Confidence depends on the plan.** A shuffle, skew or broadcast finding is
`certain` only if `explain()` or the Spark UI confirms it. From the code alone
it is `probable`. Partition counts and join strategies are chosen at runtime
from statistics the source text does not carry.

### Severity assignment

Definitions live in `code-review`. Python authoring is weighed in
`python-engineering`.

| Breach | Severity |
|:--|:--|
| Non-idempotent write — rerunning the job duplicates the dataset | **HIGH** |
| Unbounded `collect()` or `toPandas()` on a distributed DataFrame | **HIGH** |
| Read with no explicit schema on a production path | MEDIUM |
| Python UDF where a native function or `pandas_udf` exists | MEDIUM |
| Avoidable shuffle — `distinct`, `orderBy` or redundant `groupBy` | MEDIUM |
| `spark.sql.shuffle.partitions` left at the 200 default | MEDIUM |
| Large-side join not broadcast, with no documented reason | MEDIUM |
| `cache()` with a single downstream action, or never unpersisted | MEDIUM |
| `partitionBy` on a high-cardinality column — small-file explosion | MEDIUM |
| Output file sizes uncontrolled | LOW |

### Traps a diff does not show

- **`cache()` that never materialises.** Caching before a transformation and
  after the only action caches nothing and costs memory.
- **A broadcast hint on a side that grows.** Correct at review time, an OOM on
  the driver three months later. Weigh the hint against how the table grows,
  not its current size.
- **Skew that only appears in production data.** A join key uniform in the
  sample and 90 % one value in production. The code is identical.
- **A `partitionBy` whose cardinality is a property of the data.** The column
  name says nothing about how many directories it will create.
- **An idempotent write made non-idempotent by its output path.** A path built
  from `now()` rather than the logical date accumulates a new dataset on every
  rerun instead of replacing one.

### Verdict

`blocked` requires at least one HIGH at `certain` or `probable`. A HIGH at
`possible` downgrades to `needs_rework` and must be named in `top_priority`.
With no finding above LOW, `approved`.
