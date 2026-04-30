Load the `sql-engineering` and `gcp-engineering` skills.

For the query in @{{file}} (or pasted below):

1. Run `bq query --use_legacy_sql=false --dry_run` and report bytes processed + estimated cost (assume on-demand pricing $6.25/TB EU unless overridden).
2. Identify the top 3 cost drivers (full scan? bad partition filter? exploding join?).
3. Propose a rewrite — diff form. Re-dry-run the rewrite and report the new bytes processed.
4. If the rewrite changes semantics in any subtle way (NULL handling, dedup behaviour, ordering), call it out explicitly.

If the project context is unclear (which project, which dataset's partitioning), ask before running anything that touches the cloud.
