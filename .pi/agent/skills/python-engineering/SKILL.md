---
name: python-engineering
description: Use for Python code authoring, refactoring, packaging, testing, and tooling — particularly in data engineering contexts. Covers project layout, type hints, pytest patterns, ruff/mypy configuration, dependency management (uv, pip, pyproject), logging hygiene, and idiomatic patterns for ETL/streaming code (generators, dataclasses, pydantic). Trigger on .py file work, package setup, or test authoring.
---

# Python Engineering

## When this skill is active

You are writing, reviewing, refactoring, or packaging Python code. Default version: 3.11+.

## Project layout (defaults)

```
project/
├── pyproject.toml        # single source of truth for deps + tooling config
├── src/<package>/        # src layout — avoids the "import from cwd" trap
│   └── __init__.py
├── tests/                # mirrors src/<package>/ structure
├── README.md
└── .python-version       # for pyenv/uv
```

Reasons for src layout: tests run against the installed package, not a shadowed local one. Catches packaging bugs early.

## Type hints

- Public functions: full annotations on params and return.
- Private helpers: annotate when the type isn't obvious from the name.
- `from __future__ import annotations` at top of every file (deferred evaluation, cleaner syntax).
- `list[str]` not `List[str]` (3.9+).
- For data shapes: `pydantic.BaseModel` if validating I/O, `@dataclass(slots=True, frozen=True)` for internal value objects, `TypedDict` for legacy dict-shaped data.

## Logging

```python
import logging
logger = logging.getLogger(__name__)
```

- Never `print` in library code.
- For GCP-deployed code (Cloud Functions, Composer tasks, Dataflow): use the `google-cloud-logging` handler so logs land structured in Cloud Logging.
- Log keys, not interpolated strings: `logger.info("user processed", extra={"user_id": uid, "duration_ms": dt})` — easier to query.
- `logger.exception(...)` inside `except` blocks (it captures the traceback).

## Exceptions

- Catch the narrowest type that makes sense. `except Exception` only at top-level entry points (a Cloud Function handler, a CLI main).
- Re-raise with chaining: `raise ProcessingError("failed on row 12") from e`.
- Custom exception types live in `<package>/exceptions.py` or alongside the module they belong to.
- Never silently swallow. If you really mean to ignore, log at DEBUG and add a comment.

## Testing (pytest)

- One assertion-cluster per test. If you find yourself writing `assert a; assert b; assert c` for unrelated things, split the test.
- Fixtures > setup methods. Scope fixtures to the narrowest level (`function` default, `module`/`session` for expensive things).
- Parametrize over copy-paste: `@pytest.mark.parametrize("input,expected", [...])`.
- Use `pytest-mock`'s `mocker` fixture instead of bare `unittest.mock.patch` decorators — cleaner and auto-undone.
- For BigQuery / GCP code: mock at the client boundary (the `bigquery.Client` instance), not at `google.cloud.bigquery` module level.
- `tmp_path` fixture for any test that touches the filesystem.

## Tooling

- **Formatter + linter:** `ruff format` and `ruff check`. Configure in `pyproject.toml` under `[tool.ruff]`.
- **Type checker:** `mypy` (strict in new projects, lenient when adopting on legacy). Config in `pyproject.toml` under `[tool.mypy]`.
- **Dep manager:** `uv` for new projects (fast, lockfile by default). Plain `pip` + `pip-tools` for older ones.
- **Pre-commit:** `pre-commit` with `ruff` + `mypy` hooks. Install with `pre-commit install` once per repo.

## Data-engineering idioms

- **Generators for unbounded or large streams.** Don't `list(...)` a file iterator unless you need random access.
- **`itertools.batched` (3.12+) or `more_itertools.chunked`** for batch processing; never hand-roll `i:i+n` slicing.
- **`pathlib.Path` over `os.path`** — always.
- **`contextlib.contextmanager`** for cleanup in custom resources (DB connections, temp files).
- **Pydantic for I/O boundaries** (API responses, Pub/Sub message schemas, BQ row dicts coming back). Internal computation can use plain dataclasses — they're faster.

## Review checklist

- [ ] No `print` in non-script code
- [ ] No bare `except:` or `except Exception` outside entry points
- [ ] Type hints on public surface
- [ ] Tests for the new code path (happy + at least one error path)
- [ ] No unused imports (ruff catches), no dead code
- [ ] Resource handles (`open`, DB conn) inside `with` or context manager

## TODO

- Mo's preferred pyproject template
- Patterns for Dataflow / Apache Beam pipelines (separate skill if it grows)
- async/await guidance once Mo's projects need it
