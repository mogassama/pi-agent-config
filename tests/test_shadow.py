#!/usr/bin/env python3
"""
The reading, on synthetic runs.

This is the fifth instrument on this branch, and the previous ones failed in the
way instruments fail: not by crashing but by printing a credible number. The
cases below are the failures that would have looked like success — a plan whose
dependency names a unit that does not exist and therefore widens the DAG, a
worker that wrote nothing and carried no annotation and therefore left both
sides of the coverage fraction, a journal short by one line reporting full
coverage of what remains. Each is cheaper here than in ninety minutes of run.

    python3 tests/test_shadow.py
    bin/test-guards                # runs this too
"""

import contextlib
import importlib.machinery
import importlib.util
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

# Loading a file from bin/ leaves a __pycache__ beside it otherwise, and a test
# run that dirties the working tree is a test run people stop trusting.
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
_loader = importlib.machinery.SourceFileLoader("subagent_shadow", str(ROOT / "bin" / "subagent-shadow"))
_spec = importlib.util.spec_from_loader("subagent_shadow", _loader)
sh = importlib.util.module_from_spec(_spec)
_loader.exec_module(sh)


def unit(uid, deps=(), scope=None):
    return {
        "id": uid,
        "goal": f"goal of {uid}",
        "depends_on": list(deps),
        "expected_write_scope": list(scope) if scope else [f"{uid.lower()}.py"],
    }


def plan(*units, version=1):
    return {"version": version, "work_units": list(units)}


def deleg(seq, role, work_unit=None, changed=(), artifact=None):
    return {
        "at": "t",
        "seq": seq,
        "batch": f"b{seq}",
        "role": role,
        "work_unit": work_unit,
        "for_risks": [],
        "produced": True,
        "read_only": role != "worker",
        "changed_files": list(changed),
        "artifact": artifact or f".pi-subagent-runs/9a6766-{seq:02d}-{role}.json",
        "failure": None,
    }


_KEEP = []


class Run:
    """A synthetic run on disk, and the text the reading prints for it."""

    def __init__(self, plan_doc=None, delegations=(), risks=(), artifacts=()):
        self.dir = tempfile.TemporaryDirectory()
        _KEEP.append(self.dir)
        self.runs = Path(self.dir.name)
        if plan_doc is not None:
            (self.runs / "9a6766-plan.json").write_text(json.dumps(plan_doc))
        if delegations:
            (self.runs / "9a6766-delegations.jsonl").write_text(
                "\n".join(json.dumps(d) for d in delegations) + "\n"
            )
        if risks:
            (self.runs / "9a6766-risks.jsonl").write_text(
                "\n".join(json.dumps(r) for r in risks) + "\n"
            )
        for name in artifacts:
            (self.runs / name).write_text("{}")

    def text(self):
        """Column padding is layout, not behaviour, so runs of spaces collapse."""
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            sh.report("9a6766", None, self.runs)
        return "\n".join(re.sub(r" {2,}", " ", ln).strip() for ln in buf.getvalue().splitlines())


# --------------------------------------------------------------- plan validity


class PlanValidity(unittest.TestCase):
    def test_a_well_formed_plan_is_usable(self):
        status, reason, units = sh.validate_plan(plan(unit("W01"), unit("W02", ["W01"])))
        self.assertEqual(status, "usable")
        self.assertEqual(reason, "")
        self.assertEqual([u["id"] for u in units], ["W01", "W02"])

    def test_absent_is_its_own_answer(self):
        self.assertEqual(sh.validate_plan(None)[0], "absent")

    def test_a_wrong_version_is_invalid(self):
        status, reason, _ = sh.validate_plan(plan(unit("W01"), version=999))
        self.assertEqual(status, "invalid")
        self.assertIn("version", reason)

    def test_a_duplicate_id_is_invalid(self):
        status, reason, _ = sh.validate_plan(plan(unit("W01"), unit("W01")))
        self.assertEqual(status, "invalid")
        self.assertIn("duplicate", reason)

    # The dangerous one. The first version dropped unknown dependencies before
    # levelling, so a mistyped id silently widened the DAG — which is the single
    # number this whole exercise exists to produce.
    def test_a_dependency_on_a_unit_that_does_not_exist_is_invalid(self):
        status, reason, _ = sh.validate_plan(plan(unit("W01"), unit("W02", ["NOPE"])))
        self.assertEqual(status, "invalid")
        self.assertIn("NOPE", reason)

    def test_a_cycle_is_invalid(self):
        status, reason, _ = sh.validate_plan(plan(unit("W01", ["W02"]), unit("W02", ["W01"])))
        self.assertEqual(status, "invalid")
        self.assertIn("cycle", reason)

    def test_a_self_dependency_is_invalid(self):
        self.assertEqual(sh.validate_plan(plan(unit("W01", ["W01"])))[0], "invalid")

    def test_a_missing_scope_is_invalid(self):
        doc = plan(unit("W01"))
        del doc["work_units"][0]["expected_write_scope"]
        self.assertEqual(sh.validate_plan(doc)[0], "invalid")

    def test_a_missing_depends_on_is_invalid(self):
        doc = plan(unit("W01"))
        del doc["work_units"][0]["depends_on"]
        self.assertEqual(sh.validate_plan(doc)[0], "invalid")

    # No partial acceptance: one bad unit invalidates the plan rather than being
    # quietly dropped from the set the metrics are computed over.
    def test_one_malformed_unit_invalidates_the_whole_plan(self):
        doc = plan(unit("W01"), {"id": "", "depends_on": [], "expected_write_scope": ["x.py"]})
        self.assertEqual(sh.validate_plan(doc)[0], "invalid")

    # Two kinds of validity, kept apart. Everything above decides a number, so a
    # fault refuses the plan. `goal` decides none, so it is reported instead —
    # it was briefly structural, and a field the orchestrator might phrase badly
    # would have deleted every measurement of a ninety-minute run.
    def test_a_missing_or_unusable_goal_does_not_invalidate_the_plan(self):
        for bad in (42, "", "   ", None):
            doc = plan(unit("W01"), unit("W02", ["W01"]))
            doc["work_units"][0]["goal"] = bad
            status, _, units = sh.validate_plan(doc)
            self.assertEqual(status, "usable", f"goal={bad!r}")
            self.assertEqual(sh.goal_gaps(units), ["W01"], f"goal={bad!r}")

    def test_an_absent_goal_key_is_reported_not_refused(self):
        doc = plan(unit("W01"))
        del doc["work_units"][0]["goal"]
        status, _, units = sh.validate_plan(doc)
        self.assertEqual(status, "usable")
        self.assertEqual(sh.goal_gaps(units), ["W01"])

    def test_a_complete_plan_has_no_gap(self):
        self.assertEqual(sh.goal_gaps(sh.validate_plan(plan(unit("W01")))[2]), [])

    # A structural fault still refuses, goal or no goal.
    def test_a_semantic_gap_does_not_rescue_a_structural_fault(self):
        doc = plan(unit("W01"), unit("W02", ["NOPE"]))
        del doc["work_units"][0]["goal"]
        self.assertEqual(sh.validate_plan(doc)[0], "invalid")

    def test_an_empty_plan_is_invalid(self):
        self.assertEqual(sh.validate_plan({"version": 1, "work_units": []})[0], "invalid")


# ------------------------------------------------------------------ dag shape


class DagShape(unittest.TestCase):
    def test_a_chain_has_width_one(self):
        units = sh.validate_plan(
            plan(unit("W1"), unit("W2", ["W1"]), unit("W3", ["W2"]))
        )[2]
        by_level = sh.layers(units)
        self.assertEqual(max(len(v) for v in by_level.values()), 1)
        self.assertEqual(len(by_level), 3)

    # The counter-example the stratified fan below could never catch: level size
    # and poset width agree on a perfectly layered graph and diverge as soon as
    # an independent unit sits at a different depth from the fan it is
    # independent of.
    def test_width_is_the_antichain_not_the_biggest_level(self):
        units = sh.validate_plan(
            plan(unit("W0"), unit("W1", ["W0"]), unit("W2", ["W0"]), unit("W3"))
        )[2]
        self.assertEqual(sh.dag_width(units), 3)
        self.assertEqual(max(len(v) for v in sh.layers(units).values()), 2)

    def test_a_chain_has_width_one_however_long_it_is(self):
        units = sh.validate_plan(
            plan(unit("W1"), unit("W2", ["W1"]), unit("W3", ["W2"]), unit("W4", ["W3"]))
        )[2]
        self.assertEqual(sh.dag_width(units), 1)

    def test_units_with_no_dependency_at_all_are_all_one_antichain(self):
        units = sh.validate_plan(plan(unit("W1"), unit("W2"), unit("W3")))[2]
        self.assertEqual(sh.dag_width(units), 3)

    def test_a_fan_out_has_the_width_of_its_fan(self):
        units = sh.validate_plan(
            plan(
                unit("W1"),
                unit("W2", ["W1"]),
                unit("W3", ["W1"]),
                unit("W4", ["W1"]),
                unit("W5", ["W2", "W3", "W4"]),
            )
        )[2]
        self.assertEqual(sh.dag_width(units), 3)
        by_level = sh.layers(units)
        self.assertEqual(max(len(v) for v in by_level.values()), 3)
        self.assertEqual(len(by_level.get(0, [])), 1)

    def test_dependency_closure_is_transitive(self):
        units = sh.validate_plan(plan(unit("W1"), unit("W2", ["W1"]), unit("W3", ["W2"])))[2]
        self.assertEqual(sh.reachable(units)["W3"], {"W1", "W2"})


# --------------------------------------------------------------- scope overlap


class ScopeOverlap(unittest.TestCase):
    # The case the first version got backwards.
    def test_a_glob_overlaps_a_file_beneath_it(self):
        self.assertTrue(sh.patterns_overlap("src/**", "src/foo.py"))
        self.assertTrue(sh.patterns_overlap("balance_agee/*.py", "balance_agee/io.py"))

    # A pattern opening on a wildcard has an empty literal prefix, and `if short`
    # read that as "no common ground" instead of "unconstrained". `src/foo.py`
    # satisfies both sides of every pair below.
    def test_two_globs_overlap_when_one_starts_on_a_wildcard(self):
        self.assertTrue(sh.patterns_overlap("*/foo.py", "src/*.py"))
        self.assertTrue(sh.patterns_overlap("?rc/foo.py", "src/*.py"))
        self.assertTrue(sh.patterns_overlap("**/foo.py", "src/**"))

    def test_a_leading_wildcard_answers_yes_even_when_it_costs_a_false_positive(self):
        # Deliberate: under-reporting would let two incompatible writers into
        # one file, over-reporting costs a look.
        self.assertTrue(sh.patterns_overlap("*/foo.py", "tests/bar.py"))

    def test_a_directory_overlaps_what_is_under_it(self):
        self.assertTrue(sh.patterns_overlap("balance_agee/", "balance_agee/io.py"))

    def test_unrelated_paths_do_not_overlap(self):
        self.assertFalse(sh.patterns_overlap("src/foo.py", "tests/bar.py"))
        self.assertFalse(sh.patterns_overlap("src/**", "tests/bar.py"))

    def test_a_wide_scope_is_flagged(self):
        self.assertTrue(sh.wide("src/**"))
        self.assertTrue(sh.wide("balance_agee"))
        self.assertFalse(sh.wide("balance_agee/io.py"))


# ---------------------------------------------------------------- risk ledger


class MalformedInput(unittest.TestCase):
    """
    A truncated append must not vanish into a count that looks the same.

    `<runId>-risks.jsonl` has no independent witness the way the delegation
    journal has the artefacts, so a skipped line would be invisible.
    """

    def test_a_truncated_line_is_counted_not_dropped(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.jsonl"
            p.write_text('{"event": "opened", "id": "R1", "by": "a", "chars": 5}\n{"event": "op\n')
            rows, bad = sh.read_jsonl(p)
            self.assertEqual(len(rows), 1)
            self.assertEqual(bad, 1)

    def test_a_malformed_ledger_line_is_announced(self):
        r = Run(
            plan_doc=plan(unit("W01")),
            delegations=[deleg(1, "worker", "W01", ["w01.py"])],
            artifacts=["9a6766-01-worker.json"],
        )
        (r.runs / "9a6766-risks.jsonl").write_text(
            '{"event": "opened", "id": "R1", "by": "a", "chars": 5}\n{"event": "op\n'
        )
        out = r.text()
        self.assertIn("RISK LEDGER: INCOMPLETE", out)
        self.assertIn("malformed JSONL lines: 1", out)

    def test_a_malformed_delegation_line_stops_the_execution_metrics(self):
        r = Run(plan_doc=plan(unit("W01")), artifacts=["9a6766-01-worker.json"])
        (r.runs / "9a6766-delegations.jsonl").write_text(
            json.dumps(deleg(1, "worker", "W01", ["w01.py"])) + "\n{\n"
        )
        out = r.text()
        self.assertIn("SHADOW EXECUTION METRICS: INCOMPLETE", out)
        self.assertIn("malformed line(s) in the delegation journal", out)


class ArtefactAccesses(unittest.TestCase):
    """
    Counting calls, not lines, and across every session shape.

    Run 15 reported zero reviewer artefact accesses against a session holding
    seven, because the filter keyed on a `tool_execution_start` event that does
    not exist in a pi session file. And 28 lines of that session mention a
    reviewer artefact — the orchestrator prints each path in its own prose —
    so a line count would have reported 28. Both numbers are credible and both
    are wrong, which is the failure mode this whole reading exists to avoid.
    """

    ART = ".pi-subagent-runs/4e9499-29-reviewer.json"

    def rows(self, *records):
        d = tempfile.TemporaryDirectory()
        _KEEP.append(d)
        p = Path(d.name) / "s.jsonl"
        p.write_text("\n".join(json.dumps(r) for r in records) + "\n")
        return p

    def test_a_content_block_tool_call_is_seen(self):
        r = {"type": "message", "message": {"content": [
            {"type": "toolCall", "name": "read", "input": {"path": self.ART}}]}}
        self.assertEqual(sh.artifact_accesses(self.rows(r)), {"read": 1})

    def test_an_anthropic_tool_use_block_is_seen(self):
        r = {"type": "message", "message": {"content": [
            {"type": "tool_use", "name": "read", "input": {"path": self.ART}}]}}
        self.assertEqual(sh.artifact_accesses(self.rows(r)), {"read": 1})

    # Three of run 15's seven accesses went through a python heredoc, which is
    # not a read call — counting `read` alone would have missed them.
    def test_a_heredoc_in_bash_is_seen_and_named_bash(self):
        r = {"type": "message", "message": {"content": [{"type": "toolCall", "name": "bash",
             "input": {"command": f"python - <<PY\nopen('{self.ART}')\nPY"}}]}}
        self.assertEqual(sh.artifact_accesses(self.rows(r)), {"bash": 1})

    def test_an_openai_style_function_call_is_seen(self):
        r = {"type": "message", "message": {"tool_calls": [{"type": "function", "function": {
            "name": "read", "arguments": json.dumps({"path": self.ART})}}]}}
        self.assertEqual(sh.artifact_accesses(self.rows(r)), {"read": 1})

    def test_a_result_echoing_the_path_is_not_an_access(self):
        r = {"type": "message", "message": {"content": [
            {"type": "toolResult", "toolCallId": "x", "output": f"wrote {self.ART}"}]}}
        self.assertEqual(sh.artifact_accesses(self.rows(r)), {})

    def test_prose_naming_the_path_is_not_an_access(self):
        r = {"type": "message", "message": {"content": [
            {"type": "text", "text": f"artefact : {self.ART}"}]}}
        self.assertEqual(sh.artifact_accesses(self.rows(r)), {})

    def test_a_call_on_something_else_is_not_counted(self):
        r = {"type": "message", "message": {"content": [
            {"type": "toolCall", "name": "read", "input": {"path": "src/balance_agee/io.py"}}]}}
        self.assertEqual(sh.artifact_accesses(self.rows(r)), {})


class Ledger(unittest.TestCase):
    def test_a_still_open_event_returns_the_risk_to_open(self):
        f = sh.fold_risks(
            [
                {"event": "opened", "id": "R1", "by": "a", "chars": 10},
                {"event": "routed", "id": "R1", "to": "call:1"},
                {"event": "still-open", "id": "R1", "by": "b"},
            ]
        )
        self.assertEqual(f["state"]["R1"], "open")
        self.assertEqual(f["still_open"], 1)

    def test_a_continuation_that_never_returned_stays_routed(self):
        f = sh.fold_risks(
            [
                {"event": "opened", "id": "R1", "by": "a", "chars": 10},
                {"event": "routed", "id": "R1", "to": "call:1"},
            ]
        )
        self.assertEqual(f["state"]["R1"], "routed")

    def test_risk_chars_are_totalled_and_maxed(self):
        f = sh.fold_risks(
            [
                {"event": "opened", "id": "R1", "by": "a", "chars": 340},
                {"event": "opened", "id": "R2", "by": "a", "chars": 60},
            ]
        )
        self.assertEqual(sum(f["chars"].values()), 400)
        self.assertEqual(max(f["chars"].values()), 340)


# ----------------------------------------------------------------- annotation


class Annotation(unittest.TestCase):
    # The defect: filtering to attempts that changed a file first, so a worker
    # that wrote nothing and carried no work_unit left both sides of the
    # fraction and the run reported 1/1.
    def test_a_worker_that_changed_nothing_still_counts_in_the_denominator(self):
        a = sh.annotation([deleg(1, "worker", "W01", ["a.py"]), deleg(2, "worker")])
        self.assertEqual(len(a["attempts"]), 2)
        self.assertEqual(len(a["annotated"]), 1)
        self.assertFalse(a["complete"])

    def test_scope_metrics_use_only_the_workers_that_wrote(self):
        a = sh.annotation([deleg(1, "worker", "W01", ["a.py"]), deleg(2, "worker", "W02")])
        self.assertTrue(a["complete"])
        self.assertEqual(len(a["writing"]), 1)

    def test_reviewers_and_scouts_are_not_in_the_denominator(self):
        a = sh.annotation([deleg(1, "scout"), deleg(2, "reviewer"), deleg(3, "worker", "W01", ["a.py"])])
        self.assertEqual(len(a["attempts"]), 1)
        self.assertTrue(a["complete"])


# -------------------------------------------------------------- reconciliation


class Reconciliation(unittest.TestCase):
    def test_an_artefact_with_no_journal_line_is_reported(self):
        r = Run(
            plan_doc=plan(unit("W01")),
            delegations=[deleg(1, "worker", "W01", ["w01.py"])],
            artifacts=["9a6766-01-worker.json", "9a6766-02-worker.json"],
        )
        self.assertEqual(sh.reconcile("9a6766", [deleg(1, "worker", "W01")], r.runs),
                         ["9a6766-02-worker.json"])

    def test_the_plan_and_the_jsonl_files_are_not_mistaken_for_artefacts(self):
        r = Run(plan_doc=plan(unit("W01")), delegations=[deleg(1, "worker", "W01", ["w01.py"])],
                artifacts=["9a6766-01-worker.json"])
        self.assertEqual(sh.reconcile("9a6766", [deleg(1, "worker", "W01")], r.runs), [])


# -------------------------------------------------------------- the whole read


class WholeRead(unittest.TestCase):
    def full_run(self, **over):
        base = dict(
            plan_doc=plan(
                unit("W01", scope=["balance_agee/fingerprints.py"]),
                unit("W02", scope=["balance_agee/io.py"]),
                unit("W03", ["W01"], scope=["balance_agee/run.py"]),
            ),
            delegations=[
                deleg(1, "worker", "W01", ["balance_agee/fingerprints.py"]),
                deleg(2, "reviewer", "W01"),
                deleg(3, "worker", "W02", ["balance_agee/io.py"]),
            ],
            artifacts=["9a6766-01-worker.json", "9a6766-02-reviewer.json", "9a6766-03-worker.json"],
        )
        base.update(over)
        return Run(**base)

    def test_a_goal_gap_warns_without_removing_the_structural_numbers(self):
        doc = plan(
            unit("W01", scope=["balance_agee/fingerprints.py"]),
            unit("W02", scope=["balance_agee/io.py"]),
            unit("W03", ["W01"], scope=["balance_agee/run.py"]),
        )
        del doc["work_units"][1]["goal"]
        out = self.full_run(plan_doc=doc).text()
        self.assertIn("goal coverage 2/3", out)
        self.assertIn("PLAN SEMANTICS: INCOMPLETE", out)
        self.assertIn("W02: no stated goal", out)
        # The topology and the execution join still stand.
        self.assertIn("dag width", out)
        self.assertIn("scope coverage", out)
        self.assertNotIn("SHADOW EXECUTION METRICS: INCOMPLETE", out)

    def test_a_complete_plan_says_so_without_a_warning(self):
        out = self.full_run().text()
        self.assertIn("goal coverage 3/3", out)
        self.assertNotIn("PLAN SEMANTICS: INCOMPLETE", out)

    # The width is a structural ceiling, not a promise of wall-clock.
    def test_the_width_note_does_not_claim_a_speedup(self):
        out = self.full_run().text()
        self.assertIn("Structural potential, not", out)
        self.assertIn("expected speedup", out)

    def test_a_clean_run_reports_its_metrics(self):
        out = self.full_run().text()
        self.assertNotIn("INCOMPLETE", out)
        self.assertIn("carrying work_unit 2/2", out)
        self.assertIn("scope coverage", out)
        self.assertIn("2/2 = 1.00", out)

    def test_an_unannotated_worker_stops_every_execution_metric(self):
        out = self.full_run(
            delegations=[
                deleg(1, "worker", "W01", ["balance_agee/fingerprints.py"]),
                deleg(2, "reviewer", "W01"),
                deleg(3, "worker"),
            ]
        ).text()
        self.assertIn("SHADOW EXECUTION METRICS: INCOMPLETE", out)
        self.assertNotIn("scope coverage", out)

    def test_an_invalid_plan_stops_every_execution_metric(self):
        out = self.full_run(plan_doc=plan(unit("W01"), version=2)).text()
        self.assertIn("PLAN", out)
        self.assertIn("invalid", out)
        self.assertIn("SHADOW EXECUTION METRICS: INCOMPLETE", out)
        self.assertNotIn("scope coverage", out)

    def test_a_short_journal_stops_every_execution_metric(self):
        out = self.full_run(
            artifacts=[
                "9a6766-01-worker.json",
                "9a6766-02-reviewer.json",
                "9a6766-03-worker.json",
                "9a6766-04-worker.json",
            ]
        ).text()
        self.assertIn("SHADOW EXECUTION METRICS: INCOMPLETE", out)
        self.assertIn("9a6766-04-worker.json", out)
        self.assertNotIn("scope coverage", out)

    def test_a_scope_breach_is_named(self):
        out = self.full_run(
            delegations=[
                deleg(1, "worker", "W01", ["balance_agee/fingerprints.py", "balance_agee/other.py"]),
                deleg(2, "reviewer", "W01"),
                deleg(3, "worker", "W02", ["balance_agee/io.py"]),
            ]
        ).text()
        self.assertIn("scope breaches", out)
        self.assertIn("W01: balance_agee/other.py", out)
        self.assertIn("2/3 = 0.67", out)

    # Unplanned work is a result of the shadow, not a fault of the instrument,
    # so it is named and its files are kept out of the coverage fraction rather
    # than folded in as mispredictions.
    def test_an_unplanned_work_unit_is_named_and_kept_out_of_coverage(self):
        out = self.full_run(
            delegations=[
                deleg(1, "worker", "W01", ["balance_agee/fingerprints.py"]),
                deleg(2, "reviewer", "W01"),
                deleg(3, "worker", "W09", ["docs/NOTES.md"]),
            ]
        ).text()
        self.assertIn("unplanned work units W09", out)
        self.assertIn("files under unplanned units 1", out)
        self.assertIn("1/1 = 1.00", out)

    # `if first_worker` was the bug: index 0 is falsy, so a run opening on a
    # worker counted every scout in the run as pre-worker.
    def test_a_run_that_opens_on_a_worker_has_no_pre_worker_scouts(self):
        out = self.full_run(
            delegations=[
                deleg(1, "worker", "W01", ["balance_agee/fingerprints.py"]),
                deleg(2, "scout"),
                deleg(3, "worker", "W02", ["balance_agee/io.py"]),
            ],
            artifacts=["9a6766-01-worker.json", "9a6766-02-scout.json", "9a6766-03-worker.json"],
        ).text()
        self.assertIn("scout questions 1", out)
        self.assertIn("pre-worker scout questions 0", out)

    def test_a_run_with_no_worker_at_all_counts_every_scout_as_pre_worker(self):
        out = self.full_run(
            delegations=[deleg(1, "scout"), deleg(2, "scout")],
            artifacts=["9a6766-01-scout.json", "9a6766-02-scout.json"],
        ).text()
        self.assertIn("pre-worker scout questions 2", out)

    def test_the_transport_figure_carries_no_target(self):
        out = self.full_run().text()
        self.assertIn("TRANSPORT", out)
        self.assertIn("not measured", out)
        self.assertNotIn("target 0 —", out)

    def test_the_routed_legend_does_not_claim_the_process_never_returned(self):
        out = self.full_run(
            risks=[
                {"event": "opened", "id": "R1", "by": "a", "chars": 40},
                {"event": "routed", "id": "R1", "to": "call:1"},
            ]
        ).text()
        self.assertIn("routed at end 1", out)
        self.assertIn("no usable review came", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
