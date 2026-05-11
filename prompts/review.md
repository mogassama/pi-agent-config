Review the code in @{{file}} (or the files passed below).

Load the `code-review` skill and follow its full process: identify scope, load supporting authoring skills, run available tooling, walk the checklists, output the structured table.

**Multi-file reviews:** do them one at a time, each file gets its own header and verdict. Order: dependencies before dependents (e.g. staging model before the mart that consumes it, utility module before the DAG that imports it). If the dependency order is unclear, state the order you chose and why before starting.

**Tooling unavailability:** if a tooling command isn't available locally (`sqlfluff` not installed, `bq` not configured, `mypy` missing), note it explicitly in the tooling output section and continue with the manual review. Don't skip the file.

**No fixes:** output only. Don't apply changes from this review. If a fix is needed, it will be requested separately — possibly with `/skill:python-engineering` or another authoring skill loaded.
