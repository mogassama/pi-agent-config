Review the code in @{{file}} (or the files passed below).

Load the `code-review` skill and follow its full process: identify scope, load supporting authoring skills, run available tooling, walk the checklists, output the structured table.

If reviewing multiple files, do them one at a time. Don't batch into a single mega-table — each file gets its own header and verdict.

If a tooling command isn't available locally (e.g. `sqlfluff` not installed, `bq` not configured), note it explicitly in the tooling output and continue with the manual review. Don't skip the file.

Don't commit any fixes from this review — output only. If I want a fix, I'll ask afterward, possibly with `/skill:python-engineering` or another authoring skill loaded.
