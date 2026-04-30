Load the `sql-engineering` skill if not already loaded, then review the SQL in @{{file}} against its checklist.

Output: a numbered list of concrete issues, each with file:line and the proposed fix as a unified diff snippet. Skip "looks good" filler. If nothing needs changing, say so in one line.

Then run `sqlfluff lint --dialect {{dialect|bigquery}}` on the file and append its output verbatim.
