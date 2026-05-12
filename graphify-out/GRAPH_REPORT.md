# Graph Report - agent  (2026-05-12)

## Corpus Check
- 3 files · ~22,307 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 9 nodes · 8 edges · 3 communities (2 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3af2ac47`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 1|Community 1]]

## God Nodes (most connected - your core abstractions)
1. `compilePatterns()` - 2 edges
2. `findMatch()` - 2 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (3 total, 1 thin omitted)

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `compilePatterns()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `findMatch()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._