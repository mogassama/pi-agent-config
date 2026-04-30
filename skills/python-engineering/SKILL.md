---
name: python-engineering
description: Use for Python code authoring, refactoring, packaging, testing, and tooling — particularly in data engineering contexts. Covers project layout, type hints, pytest patterns, ruff/mypy configuration, dependency management (uv, pip, pyproject), logging hygiene, async patterns, and idiomatic patterns for ETL/streaming code (generators, dataclasses, pydantic). Trigger on .py file work, package setup, or test authoring. For reviewing existing code, use the `code-review` skill instead.
---

# Python Engineering

## When this skill is active

You are writing, reviewing, refactoring, or packaging Python code. Default version: 3.11+.

For pure code review (evaluating existing code rather than writing new code), defer to the `code-review` skill — it has the structured checklists.

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
- `from __future__ import annotations` at top of every file (deferred evaluation, cleaner syntax, lets you forward-reference without quoting).
- `list[str]` not `List[str]` (3.9+).
- For data shapes:
  - `pydantic.BaseModel` if validating I/O (API responses, Pub/Sub messages, BQ row dicts coming back).
  - `@dataclass(slots=True, frozen=True)` for internal value objects — faster than pydantic, no validation overhead.
  - `TypedDict` for legacy dict-shaped data you can't migrate.
  - `Protocol` for duck-typed interfaces (better than ABC for stuff that doesn't need inheritance).

## Logging

```python
import logging
logger = logging.getLogger(__name__)
```

- Never `print` in library code. CLI scripts can `print` for user-facing output (still log internally).
- For GCP-deployed code (Cloud Functions, Composer tasks, Dataflow workers): use the `google-cloud-logging` handler so logs land structured in Cloud Logging:
  ```python
  import google.cloud.logging
  google.cloud.logging.Client().setup_logging()
  ```
- Log keys, not interpolated strings: `logger.info("user processed", extra={"user_id": uid, "duration_ms": dt})` — easier to query in Cloud Logging.
- `logger.exception(...)` inside `except` blocks (it captures the traceback automatically).
- Levels: `DEBUG` for noisy local-only, `INFO` for milestones, `WARNING` for recoverable anomalies, `ERROR` for failures the operator should see, `CRITICAL` only for "wake someone up".

## Exceptions

- Catch the narrowest type that makes sense. `except Exception` only at top-level entry points (a Cloud Function handler, a CLI main).
- Re-raise with chaining: `raise ProcessingError("failed on row 12") from e`. Never lose the original.
- Custom exception types live in `<package>/exceptions.py` or alongside the module they belong to.
- Never silently swallow. If you really mean to ignore, log at DEBUG and add a comment explaining why.
- Don't use exceptions for control flow on hot paths — they're expensive (~5x slower than a return-based check on the throw path).

## Testing (pytest)

- One assertion-cluster per test. If you find yourself writing `assert a; assert b; assert c` for unrelated things, split the test.
- Fixtures > setup methods. Scope fixtures to the narrowest level (`function` default, `module`/`session` for expensive things like a BigQuery client).
- Parametrize over copy-paste: `@pytest.mark.parametrize("input,expected", [...])`.
- Use `pytest-mock`'s `mocker` fixture instead of bare `unittest.mock.patch` decorators — cleaner and auto-undone.
- For BigQuery / GCP code: mock at the **client boundary** (the `bigquery.Client` instance), not at `google.cloud.bigquery` module level. Module-level patching breaks when the import path changes.
- `tmp_path` fixture for any test that touches the filesystem.
- For Pub/Sub: use the emulator (`gcloud beta emulators pubsub start`) for integration tests, not mocks for the message bus itself.
- Mark slow tests: `@pytest.mark.slow` and configure `addopts = "-m 'not slow'"` in `pyproject.toml` so the default run stays fast. Run all with `pytest -m ""`.

## Async / concurrency

Most data eng code doesn't need async. Reach for it only when:

- **Many I/O-bound parallel calls** (e.g. fetching from N APIs concurrently). `asyncio.gather` + `aiohttp` is the pattern.
- **Streaming consumers with backpressure** (rare in batch pipelines).

Don't reach for async when:

- A single linear pipeline (just use sync, it's simpler to debug).
- CPU-bound work — use `multiprocessing` or external workers (Dataflow), not async.
- The library's sync API blocks anyway (most `google-cloud-*` SDKs do — async wrappers exist but are limited).

When using async:
- Don't mix `asyncio.run()` calls inside an already-running loop. Use `await` properly.
- `asyncio.TaskGroup` (3.11+) over manual `gather` for structured concurrency.
- Always `await` or `asyncio.create_task()` — bare coroutines never run and emit warnings.

## Tooling

- **Formatter + linter:** `ruff format` and `ruff check`. Configure in `pyproject.toml` under `[tool.ruff]`. Replace black, isort, flake8 — ruff does it all and faster.
- **Type checker:** `mypy` (strict in new projects, lenient when adopting on legacy). Config in `pyproject.toml` under `[tool.mypy]`. Alternative: `pyright` (faster, used by Pylance).
- **Dep manager:** `uv` for new projects (fast, lockfile by default, drop-in for pip + venv + pip-tools). Plain `pip` + `pip-tools` for older ones.
- **Pre-commit:** `pre-commit` with `ruff` + `mypy` hooks. Install with `pre-commit install` once per repo. CI must run the same hooks.

## Data-engineering idioms

- **Generators for unbounded or large streams.** Don't `list(...)` a file iterator unless you need random access.
- **`itertools.batched` (3.12+) or `more_itertools.chunked`** for batch processing; never hand-roll `i:i+n` slicing.
- **`pathlib.Path` over `os.path`** — always.
- **`contextlib.contextmanager`** for cleanup in custom resources (DB connections, temp files, Pub/Sub subscribers).
- **Pydantic for I/O boundaries**, plain dataclasses for internal computation (faster, no validation overhead).
- **For BigQuery row iteration:** the client returns a `RowIterator`, iterate it directly. Don't `list()` the result of a query that returns millions of rows.
- **For Pub/Sub:** use the streaming pull pattern with a callback, not synchronous pull in a loop. The client lib handles ack deadline extension.
- **For Cloud Storage:** stream blobs (`blob.open("rb")`) for large files instead of `download_as_bytes()`. The latter loads everything into RAM.

## Packaging (when shipping a library or Cloud Function)

- `pyproject.toml` with PEP 621 metadata. Don't use `setup.py` for new projects.
- Pin runtime deps in `pyproject.toml` with reasonable upper bounds (`>=1.2,<2`). Pin all transitive deps in a lockfile (`uv.lock` or `requirements.txt` from `pip-compile`).
- For Cloud Functions: `requirements.txt` is what gets uploaded — derive it from your lockfile, don't hand-edit.
- For Composer / Dataflow: deps must match the runtime environment exactly (Python version, system libs). Test in a matching container before deploying.

## TODO

- Mo's preferred pyproject template (capture once a project exists)
- Async patterns specific to Beam pipelines (Dataflow Python SDK)
- Migration patterns from `pip` + `requirements.txt` to `uv` (when Mo decides)
