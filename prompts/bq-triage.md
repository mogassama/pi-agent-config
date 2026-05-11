Load the `sql-engineering` and `gcp-engineering` skills.

For the query in @{{file}} (or pasted below):

1. **Dry-run.** Run `bq query --use_legacy_sql=false --dry_run "$(cat {{file}})"` and report:
   - Bytes processed
   - Estimated cost at on-demand pricing ($6.25/TB EU) — state this assumption explicitly
   - If the project uses reserved slots (flat-rate), note that byte cost is not the right signal and flag for operator confirmation before proceeding

2. **Cost drivers.** Identify the top 3 drivers of the scan cost:
   - Full table scan (missing partition filter or filter wrapped in a function)
   - Partition filter present but bypassed (`WHERE DATE(ts)` instead of direct column filter)
   - Exploding JOIN (missing ON clause selectivity, cross join, fanout)
   - SELECT * or unused columns pulled into memory
   - Subquery dedup instead of QUALIFY

3. **Rewrite.** Propose a rewrite that addresses the identified drivers.
   - Format: show only the changed clauses with 2 lines of context above and below each change
   - Re-dry-run the rewrite and report new bytes processed and new estimated cost
   - Report reduction: `X GB → Y GB (Z% reduction)`

4. **Semantic delta.** If the rewrite changes behaviour in any subtle way, call it out explicitly before anything else:
   - NULL handling differences
   - Dedup behaviour changes (QUALIFY vs subquery may differ on ties)
   - Row ordering guarantees lost or added
   - Partition pruning that changes result set on late-arriving data

If the project, dataset, or partitioning scheme is unclear, ask one focused question before running anything that touches the cloud.
