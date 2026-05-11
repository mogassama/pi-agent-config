---
name: python-engineering
description: Load for Python authoring, refactoring, packaging, or testing. Covers uv project setup, strict type hints, Loguru logging, pytest patterns, and data engineering idioms (streaming, chunking, GCP clients). Auto-load when the task involves .py files, pyproject.toml, test writing, or Python package structure.
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

## Logging (Loguru — mandatory)

- `from loguru import logger` everywhere. Never `logging.getLogger(__name__)`.
- All log messages in English.
- Production / GCP sink (structured JSON for Cloud Logging):
  ```python
  import sys
  from loguru import logger

  logger.remove()
  logger.add(sys.stderr, format="{message}", serialize=True, level="INFO")
  ```
- Contextual metadata: `logger.contextualize(run_id=run_id, source=source)`.
- Entry point decoration: `@logger.catch` on `main()` to capture full stack traces with variable values.
- Never use `print()` in library or pipeline code. CLI one-shot scripts only.

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

## Anti-patterns — never do these

- `except Exception: pass` or bare `except:` — always catch narrow and re-raise with context.
- `import *` — ever.
- `requirements.txt` in new projects — use `uv` and `pyproject.toml`.
- Mutable default arguments: `def f(items=[])` — use `None` and initialize inside.
- `os.path.join` — use `Path(...) / "subdir"`.
- `logging.getLogger` — Loguru only.
- `print()` in library code — use `logger`.
- `download_as_bytes()` on large GCS objects — stream instead.
- Global config objects imported across modules — inject via function arguments.
