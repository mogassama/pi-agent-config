Load the `sql-engineering` skill if not already loaded, then review the SQL in @{{file}} against its checklist.

Output: a numbered list of concrete issues, each with `file:line` and the proposed fix as a unified diff snippet. Issues ordered by severity (HIGH → MEDIUM → LOW). Skip LOW issues that sqlfluff can auto-fix — note the count instead ("N low-severity style issues — run `sqlfluff fix` to resolve"). If nothing needs changing, say so in one line.

Then run:
```bash
sqlfluff lint --dialect {{dialect|bigquery}} {{file}}
```
Append the output verbatim.
