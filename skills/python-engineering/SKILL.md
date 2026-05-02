---
name: python-engineering
description: Expert Python engineering for 2026. Focus on uv, pytest, and Loguru. Optimized for Data Engineering (GCP/ETL), strict type hinting (3.13+), and high-performance patterns. Use for authoring, refactoring, and packaging.
---

# Python Engineering (Power User Edition)

## Execution Rules
- **Language:** Code comments and LOGS must be in **English** only.
- **Python Version:** 3.13+ (Default).
- **Environment:** Always assume a `uv` managed project.

## Project Layout (Modern Src-Layout)

```text
project/
├── .python-version       # managed by uv
├── pyproject.toml        # tools (ruff, mypy, pytest) + deps
├── uv.lock               # deterministic builds
├── src/<package>/        # code lives here
│   ├── __init__.py
│   └── main.py
└── tests/                # mirrored structure
```

## Dependency & Tooling (uv First)

- **Management:** Use uv for everything (uv init, uv add, uv run).
- **Lint/Format:** ruff (all-in-one). Use ruff check --fix and ruff format.
- **Type Checking:** mypy or pyright.
- **Migration:** If a project has requirements.txt, suggest uv pip compile to modernize.

## Type Hints (Python 3.13+)

- **New Syntax:** Use the type keyword for aliases:
  ```python
  type UserID = int | str
  type RowData = dict[str, Any]
  ```
- **Protocols:** Prefer typing.Protocol for structural subtyping (duck typing).
- **Validation:**
  - pydantic.BaseModel for I/O and API boundaries.
  - pydantic-settings for environment variable management.
  - @dataclass(slots=True, frozen=True) for internal data structures.

## Logging (Loguru)

- **Standard:** Use `from loguru import logger`. No `logging.getLogger(__name__)`.
- **English Only:** All log messages must be in English.
- **Cloud/GCP Integration:** To ensure logs are structured (JSON) for Cloud Logging, use a sink:
  ```python
  import sys
  from loguru import logger
  
  # Clear default and add structured sink for production
  logger.remove()
  logger.add(sys.stderr, format="{message}", serialize=True, level="INFO")
  ```
- **Context:** Use `logger.contextualize(user_id=123)` for adding metadata to a block of logs.
- **Error Capture:** Use `@logger.catch` on main entry points to log full stack traces with variable values.

## Testing (pytest)

- **Framework:** pytest only.
- **Mocking:** Use pytest-mock (the mocker fixture).
- **Async Tests:** Use pytest-asyncio.
- **Patterns:**
  - One logical assertion per test.
  - Use tmp_path for filesystem tests.
  - @pytest.mark.parametrize to reduce boilerplate.

## Data Engineering Patterns

- **Generators:** Always use Yield for large data streams to keep memory footprint low.
- **Chunking:** Use itertools.batched (3.12+) for batching records.
- **Resource Management:** Use contextlib.contextmanager or asynccontextmanager.
- **Cloud Storage:** Prefer streaming (blob.open("rb")) over download_as_bytes().
- **BigQuery:** Use bigframes (BigQuery DataFrames) for heavy analysis when possible.

## Refactoring Philosophy

1. **Readability > Brevity:** Code is read 10x more than it is written.
2. **Type Safety:** 100% type hint coverage on all new functions.
3. **Immutability:** Favor frozen=True for data objects to avoid side effects.

