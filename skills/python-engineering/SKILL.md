---
name: python-engineering
description: Load for Python authoring, refactoring, packaging, or testing. Covers uv project setup, strict type hints, logging, pytest patterns, and data engineering idioms (streaming, chunking, GCP clients). Auto-load when the task involves .py files, pyproject.toml, test writing, or Python package structure.
---

# Python Engineering

## Environment

- Python 3.12+ unless project `.python-version` pins otherwise.
- All projects managed with `uv`. Never suggest `pip install` directly.
- Formatter: `ruff format`. Linter: `ruff check --fix`. Type checker: `mypy` or `pyright` per project config.

## Project layout (src-layout, canonical)

```
project/
├── .python-version        # managed by uv
├── pyproject.toml         # single source of truth for tools + deps
├── uv.lock                # committed, deterministic builds
├── src/<package>/
│   ├── __init__.py
│   └── ...
└── tests/                 # mirrors src/<package>/ structure
```

## pyproject.toml — minimal scaffold

```toml
[project]
name = "<package>"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM"]

[tool.mypy]
strict = true
python_version = "3.12"

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

## Type hints

- Type hints on **all** public functions and methods — no exceptions.
- Use `type` keyword for aliases (3.12+):
  ```python
  type UserID = int | str
  type RowData = dict[str, Any]
  ```
- `typing.Protocol` for structural subtyping — prefer over ABC for duck-typed interfaces.
- `pydantic.BaseModel` for I/O boundaries and external data validation.
- `pydantic-settings` for environment variable management in all non-trivial projects.
- `@dataclass(slots=True, frozen=True)` for internal immutable data structures.

## Logging

**The Loguru / stdlib `logging` choice is a project decision**, taken by the
strategic-forge board and written into the bundle. Neither is a default here.

True in both cases:

- All log messages in English.
- Never `print()` in library or pipeline code. CLI one-shot scripts only.
- Structured JSON on stderr in production — Cloud Logging parses it into fields.
- Contextual metadata attached to the record (`run_id`, `source`, `table`),
  never interpolated into the message string.

**Loguru:**
```python
import sys
from loguru import logger

logger.remove()
logger.add(sys.stderr, format="{message}", serialize=True, level="INFO")

log = logger.bind(run_id=run_id, source=source)
log.info("batch_validated")
```
`logger.contextualize(...)` for a scoped block. `@logger.catch` on `main()`
captures full stack traces with variable values.

**Stdlib `logging`:**
```python
import logging

logger = logging.getLogger(__name__)  # module-level, never the root logger
logger.info("batch_validated", extra={"run_id": run_id, "source": source})
```
Configure once at the entry point, never in a library module. JSON output via
`python-json-logger` or a `logging.Formatter` subclass. `extra` keys land as
top-level fields — do not shadow reserved `LogRecord` attributes (`message`,
`asctime`, `name`, `levelname`, `module`, `args`).

**Airflow is not a choice.** DAG files use `logging.getLogger(__name__)`
whatever the project picked — Composer's UI only surfaces the stdlib handler.
See airflow-engineering.

### Trap — Loguru kwargs make the message a format string

`logger.info("msg", key=value)` does two things: it puts `key` into
`record["extra"]` (so it *does* appear under `serialize=True` — the metadata is
not lost), and it runs `msg.format(key=value)`. Any literal brace in the message
then raises at log time, uncaught:

```python
logger.info('payload {"a": 1} written', source=src)   # KeyError: '"a"'
```

`logger.bind(source=src).info("msg")` gives the same `extra` with no formatting
pass. Prefer it. Reserve `logger.info("rows: {n}", n=n)` for the case where the
message really is a template.

## Testing (pytest)

- `pytest` only. No unittest.
- Mocking: `pytest-mock` (`mocker` fixture). Never `unittest.mock` directly.
- Async: `pytest-asyncio` with `asyncio_mode = "auto"` in pyproject.toml.
- One logical assertion cluster per test function.
- `tmp_path` fixture for any filesystem interaction.
- `@pytest.mark.parametrize` to eliminate repetitive test bodies.
- Test file mirrors source path: `src/package/etl/loader.py` → `tests/etl/test_loader.py`.

## Data engineering patterns

- **Generators for large streams.** Never load a full dataset into memory when a generator suffices.
  ```python
  def iter_rows(path: Path) -> Iterator[RowData]:
      with path.open() as f:
          for line in f:
              yield json.loads(line)
  ```
- **Batching.** `itertools.batched(iterable, n)` (3.12+) for chunked processing. No manual slice loops.
- **Resource management.** `contextlib.contextmanager` or `asynccontextmanager` for any resource with open/close lifecycle.
- **GCS streaming.** `blob.open("rb")` over `download_as_bytes()` for large objects — avoids full in-memory load.
- **BigQuery writes.** Use `WRITE_TRUNCATE` on partition target or `MERGE` with explicit unique key. Never blind `WRITE_APPEND` without dedup strategy.
- **bigframes.** Use for exploratory analysis and heavy aggregations where BigQuery execution is preferable to local compute. Do not use in production pipeline code where explicit SQL or the BQ Storage API gives more control and predictability.

## Architecture rules

- **Pure/impure separation.** Transform functions are pure and testable without mocks. Side-effects (BQ writes, GCS uploads, API calls) are isolated in dedicated modules.
- **Configuration by injection.** `def run(project_id: str, dataset: str, ...)` — never `import config` or global state. Every entry point receives its config explicitly.
- **Idempotence.** Every storage operation must be safe to run twice. No silent partial writes.
- **Fail-Fast.** Raise an explicit exception at the first unexpected state. No silent returns, no bare `except`.
- **Modules ≤ ~200 lines.** Split beyond that. One clear responsibility per module.
- **`pathlib` over `os.path`** — without exception.

## Before writing it — the ladder

Walk these in order. Stop at the first rung that answers.

1. **Standard library.** `pathlib`, `itertools`, `functools`, `dataclasses`,
   `collections`, `contextlib`, `datetime`, `json`, `csv`, `sqlite3`. Most
   small utilities already exist there under a name you did not think of.
2. **A feature of a library already installed.** pandas, SQLAlchemy, pydantic,
   httpx and the GCP clients each cover far more than the corner you use. Check
   before writing a helper beside one.
3. **A new dependency, only if it earns its place.** A dependency is a version
   to pin, a CVE to watch and a transitive tree to carry. It has to beat the
   two rungs above by enough to justify that.
4. **One line, if one line does it.** A comprehension, a `functools.reduce`, a
   `dict.get` with a default.
5. **The minimum that works, and nothing beyond.** No hook for a case nobody
   asked for, no parameter with one caller, no layer of indirection whose only
   client is the next line down.

**What the ladder never trims.** Validation at a trust boundary — anything
crossing from outside the process. Anything whose failure loses data. Anything
that touches credentials or permissions. Error handling on a write path. These
are the payload, not the packaging.

**And it is about the code, not the task.** Whether the task itself should
exist is the orchestrator's question, not yours: a scoped instruction is
executed, and a doubt about its worth goes in `deviations`.

## Anti-patterns — never do these

- **Never build a shell command by interpolating external input.** `subprocess`
  is fine and used daily; `shell=True` with a value that came from a request,
  a filename, a config field or a DAG parameter is a command injection.
  Pass a list of arguments and leave `shell` at its default. `os.system()` has
  no safe form — it is always a shell.

- `except Exception: pass` or bare `except:` — always catch narrow and re-raise with context.
- `import *` — ever.
- `requirements.txt` in new projects — use `uv` and `pyproject.toml`.
- Mutable default arguments: `def f(items=[])` — use `None` and initialize inside.
- `os.path.join` — use `Path(...) / "subdir"`.
- `print()` in library code — use `logger`.
- `download_as_bytes()` on large GCS objects — stream instead.
- Global config objects imported across modules — inject via function arguments.

## Review delta

*Everything above is authoring guidance, injected for both worker and reviewer.
This section is injected for the reviewer only. It does not restate the rules
above — it says how to weigh a breach of them, and what a diff does not show.*

**Floor.** For a diff under ~10 lines, report only HIGH findings.

**Do not report what the tooling already reports.** `pi-lint-gate` runs `ruff`
after every `.py` edit and `mypy` at turn end. Import order, line length,
unused names, `UP`/`SIM` rewrites and type errors are already surfaced.

### Severity assignment

Definitions live in `code-review`. Confidence is orthogonal: a HIGH at
`possible` does not block.

| Breach | Severity |
|:--|:--|
| `shell=True` or `os.system()` with a value from outside the process | **HIGH** |
| Credential, secret or token with a literal default value | **HIGH** |
| Write to a warehouse table with no dedup or upsert strategy — `to_sql(if_exists="append")`, blind `WRITE_APPEND` | **HIGH** |
| Bare `except:` or `except Exception: pass` | **HIGH** |
| Missing type hints on a public function or method | MEDIUM |
| No explicit exception handling at the entry point | MEDIUM |
| Mutable default argument | MEDIUM |
| `import *` | MEDIUM |
| `print()` anywhere in library or pipeline code | MEDIUM |
| Global config object imported across modules | MEDIUM |
| Logging library inconsistent with the project bundle's choice | MEDIUM |
| Large dataset loaded into a list instead of streamed via a generator | MEDIUM |
| `download_as_bytes()` on a large GCS object | MEDIUM |
| Pure transform function that has acquired a side effect | MEDIUM |
| Several writes through one engine with no shared transaction block | MEDIUM |
| `os.path` where `pathlib` applies | LOW |

**Logging: enforce the library declared in the project bundle. Do not assume a
default. If the bundle is silent on logging, raise no finding.**

**Two of these are weighed elsewhere as well, and that is deliberate.** Secrets
are also weighed in `gcp-engineering`, non-idempotent warehouse writes also in
`bigquery-engineering` and `airflow-engineering`. One rule, one file — the
statements live there. But a severity must exist on **every surface where the
rule can be breached**, because a reviewer loads only the skill matching the
file under review. A `.py` file gets this skill and nothing else.

Genuinely not weighed here: `SELECT *` and query text (`sql-engineering`),
`MERGE` key design and partition filters (`bigquery-engineering`), IAM roles
and GCP service configuration (`gcp-engineering`).

### Traps a diff does not show

- **Loguru braces.** `logger.info("msg", key=value)` runs `msg.format(...)`. A
  literal `{` or `}` in the message raises at log time, uncaught, and never in
  the reviewed run. Read the message string, not just the call shape.
- **Shadowed `LogRecord` attributes.** Stdlib `extra` keys named `message`,
  `asctime`, `name`, `levelname`, `module` or `args` are silently mangled — no
  exception, no warning.
- **Test path drift.** `src/package/etl/loader.py` must be mirrored by
  `tests/etl/test_loader.py`. A test placed elsewhere may never be collected;
  a green run proves nothing about it.
- **Transaction scope.** Several writes through the same engine without a
  shared `begin()` block commit independently; a failure midway leaves a
  partial state no rollback undoes. Visible only by reading the whole function.

### Verdict

`blocked` requires at least one HIGH at `certain` or `probable`. A HIGH at
`possible` downgrades to `needs_rework` and must be named in `top_priority` as
an assumption requiring verification. With no finding above LOW, `approved`.
