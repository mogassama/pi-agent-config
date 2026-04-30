Add Google-style docstrings to every function and method in the file(s) at @{{file}}.

**Strict rules:**

1. **Language: English.** Even if the surrounding code uses French identifiers, docstrings stay English (compatibility with pydantic, sphinx, IDE tooling).

2. **Format: Google-style.** Sections in this order, only when applicable:
   - Short summary (one line, imperative mood: "Compute X" not "Computes X")
   - Blank line
   - Longer description if needed
   - `Args:` — one entry per parameter, with type
   - `Returns:` — type and meaning. Mandatory unless function returns `None`.
   - `Raises:` — exception types and when. Only document exceptions you intentionally raise or let propagate.
   - `Example:` — only for non-obvious public APIs, not for internal helpers.

3. **Types in docstrings must match the type hints.** If the signature says `-> dict[str, int]`, the `Returns:` says `dict[str, int]`, not `dict` or `a dictionary`. If type hints are missing on the signature, ADD them — don't document untyped code.

4. **Don't document the obvious.** A function `def get_user_id(user: User) -> int` doesn't need 4 lines of "Returns the user ID". One-liner summary is enough. The docstring earns its space.

5. **Private functions (`_leading_underscore`):** docstring only if the function is non-trivial. Trivial private helpers can skip it.

6. **Don't change behavior.** No refactoring, no renaming, no formatting changes. Docstrings only. If you spot something that should change, list it at the end as a separate suggestion — don't act on it.

7. **For pydantic models:** add a class-level docstring describing the model's purpose. Field-level descriptions go in `Field(..., description="...")` rather than in the class docstring.

**Example of expected output:**

```python
def fetch_active_users(
    project_id: str,
    since: datetime,
    limit: int = 100,
) -> list[User]:
    """Fetch users with activity after the given timestamp.

    Args:
        project_id: GCP project ID where the BigQuery dataset lives.
        since: Lower bound (inclusive) for last_activity_at.
        limit: Maximum number of users to return. Defaults to 100.

    Returns:
        list[User]: Users ordered by last_activity_at descending.
            Empty list if none match.

    Raises:
        BigQueryError: If the underlying query fails or times out.
    """
```

**Process:**

1. Read the file(s) entirely.
2. List the functions/methods you'll touch (just names, one per line) before starting.
3. Apply the docstrings via `edit` calls, one function at a time for clarity in the diff.
4. At the end, output a one-line summary: "Documented N functions in M files. K functions skipped (trivial private)."
