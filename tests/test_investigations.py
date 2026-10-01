import io
from contextlib import redirect_stdout
from collections import Counter
import json
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import Mock, patch

from tools.authorize_lineleaf import origin
from tools.benchmark_provider import (CASES, percentile, phase_summary, run_benchmark, safe_failure,
                                      validates_corrections, writing_turn)
from tools.seatline_wire import MAX_FRAME, NativeConnection, ProtocolError, read_frame, write_frame
from tools import benchmark_provider, validate_authorization

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = [sys.executable, str(ROOT / "tests/fixtures/companion.py")]


def encoded(value):
    stream = io.BytesIO()
    write_frame(stream, value)
    return stream.getvalue()


class Fragmented(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 1))


class FramingTests(unittest.TestCase):
    def test_fragmented_unicode_roundtrip(self):
        value = {"text": "Zoë 👩🏽‍💻", "id": "a"}
        self.assertEqual(read_frame(Fragmented(encoded(value))), value)

    def test_truncated_header_and_body(self):
        for data in (b"", b"\x01\x00", struct.pack("<I", 10) + b"{}"):
            with self.subTest(data=data), self.assertRaises(EOFError):
                read_frame(io.BytesIO(data))

    def test_oversized_and_empty_frames_refused_before_body(self):
        for size in (0, MAX_FRAME + 1):
            with self.assertRaises(ProtocolError):
                read_frame(io.BytesIO(struct.pack("<I", size)))

    def test_invalid_json_utf8_duplicates_and_non_objects(self):
        for body in (b"\xff", b"[]", b'{"a":1,"a":2}', b'{"x":NaN}', b"no"):
            with self.subTest(body=body), self.assertRaises(ProtocolError):
                read_frame(io.BytesIO(struct.pack("<I", len(body)) + body))

    def test_outgoing_bound(self):
        with self.assertRaises(ProtocolError):
            write_frame(io.BytesIO(), {"text": "x" * MAX_FRAME})


class PolicyTests(unittest.TestCase):
    def test_native_origin_and_stable_development_identity(self):
        import base64
        import hashlib
        contract = json.loads((ROOT / "config/seatline-contract.json").read_text())
        manifest = json.loads((ROOT / "prototypes/native-client/manifest.json").read_text())
        digest = hashlib.sha256(base64.b64decode(manifest["key"], validate=True)).hexdigest()[:32]
        extension_id = "".join(chr(ord("a") + int(char, 16)) for char in digest)
        self.assertEqual(extension_id, contract["development_extension_id"])
        self.assertEqual(origin(extension_id), f"chrome-extension://{extension_id}/")
        for invalid in ("abc", "q" * 32, "A" * 32, "*", "a" * 32 + "/"):
            with self.assertRaises(ValueError):
                origin(invalid)

    def test_writing_policy_is_ephemeral_and_tool_free(self):
        turn = writing_turn("He go.")
        self.assertEqual(turn["tools"], "none")
        self.assertEqual(turn["session"], "ephemeral")
        self.assertIsNone(turn["continuation"])
        self.assertTrue(turn["check_sign_in"])
        self.assertEqual(json.loads(turn["messages"][0]["text"]), {"text": "He go."})
        for text in ("x" * 2001, "x\0y", 12):
            with self.assertRaises(ValueError):
                writing_turn(text)
        with self.assertRaises(ValueError):
            writing_turn("safe", "bad\nmodel")

    def test_percentiles_and_safe_diagnostics(self):
        self.assertIsNone(percentile([], .95))
        self.assertEqual(percentile([20, 10, 30], .95), 30)
        self.assertEqual(safe_failure({"reason": "Private draft and secret"}), "PROVIDER_FAILED")
        self.assertEqual(safe_failure({"reason": ["PROVIDER_RATE_LIMITED"]}), "PROVIDER_FAILED")
        self.assertEqual(safe_failure({"reason": "PROVIDER_RATE_LIMITED"}), "PROVIDER_RATE_LIMITED")

    def test_duplicate_json_and_ambiguous_source_are_refused(self):
        item = {"before": "go", "after": "goes", "left": "", "right": "",
                "category": "grammar", "explanation": "Agreement"}
        valid = json.dumps({"corrections": [item]})
        self.assertTrue(validates_corrections(valid, "He go."))
        self.assertFalse(validates_corrections(valid, "go go"))
        self.assertFalse(validates_corrections('{"corrections":[],"corrections":[]}', "go"))
        item["left"] = "He "
        self.assertTrue(validates_corrections(json.dumps({"corrections": [item]}), "He go, they go"))

    def test_overlap_unknown_category_and_invented_text_refused(self):
        base = {"before": "go", "after": "goes", "left": "", "right": "",
                "category": "grammar", "explanation": "Agreement"}
        for items in ([base, base], [{**base, "category": "style"}], [{**base, "before": "invented"}]):
            self.assertFalse(validates_corrections(json.dumps({"corrections": items}), "He go."))
        self.assertTrue(validates_corrections('{"corrections":[]}', "Already correct."))

    def test_status_gates_prevent_writing_requests(self):
        class StatusConnection:
            state = {}
            sends = []
            def __init__(self, *_args, **_kwargs): pass
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def start(self, provider, method, params=None):
                self.sends.append(method)
                return "status"
            def collect(self, *_args, **_kwargs):
                return [{"type": "status", "status": self.state}, {"type": "completed"}]
        ready = {"availability": "available", "authentication": "authenticated", "sign_in": "subscription",
                 "capabilities": {"tool_isolation": True}}
        cases = [("SUBSCRIPTION_SIGN_IN_REQUIRED", {**ready, "sign_in": "api_key"}),
                 ("SUBSCRIPTION_SIGN_IN_REQUIRED", {**ready, "sign_in": "unknown"}),
                 ("PROVIDER_NOT_READY", {**ready, "authentication": "unauthenticated"}),
                 ("TOOL_ISOLATION_UNAVAILABLE", {**ready, "capabilities": {"tool_isolation": "unknown"}})]
        for reason, state in cases:
            StatusConnection.state, StatusConnection.sends = state, []
            with patch("tools.benchmark_provider.NativeConnection", StatusConnection):
                result = run_benchmark(["unused"])
            self.assertEqual(result["reason"], reason)
            self.assertEqual(StatusConnection.sends, ["status"])
            self.assertEqual(result["measurements"], [])


class ConnectionTests(unittest.TestCase):
    def test_disconnect_and_bad_negotiation_close_the_child(self):
        for body in (b"", encoded({"type": "ready", "version": 99}), b"\x01"):
            command = [sys.executable, "-c", f"import sys; sys.stdout.buffer.write({body!r}); sys.stdout.buffer.flush()"]
            with self.subTest(body=body), self.assertRaises((ProtocolError, EOFError)):
                NativeConnection(command, timeout=2)

    def test_cancel_targets_original_request_and_connection_reusable(self):
        with NativeConnection(FIXTURE) as connection:
            target = connection.start("codex", "send", writing_turn("He go."))
            connection.cancel(target)
            self.assertEqual(connection.collect(target, timeout=2)[-1]["type"], "stopped")
            events = connection.collect(connection.start("codex", "status"), timeout=2)
            self.assertEqual(events[-1]["type"], "completed")
        self.assertIsNotNone(connection.process.poll())

    def test_wrong_request_id_refused(self):
        with NativeConnection(FIXTURE) as connection:
            connection.start("codex", "status")
            with self.assertRaises(ProtocolError):
                connection.event("wrong", 2)

    def test_deadline_and_closed_connection_refusal(self):
        with NativeConnection(FIXTURE) as connection:
            with self.assertRaises(TimeoutError):
                connection.next_frame(0.01)
            connection.close()
            with self.assertRaises(ProtocolError):
                connection.start("codex", "status")

    def test_fixture_benchmark_labels_and_no_draft_content_in_report(self):
        report = run_benchmark(FIXTURE, fixture=True, timeout=3)
        self.assertEqual(report["kind"], "fixture")
        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["summary"]["attempted"], len(CASES))
        self.assertEqual(report["summary"]["structured_valid_rate"], 1)
        self.assertTrue(report["cancellation"]["stopped"])
        serialized = json.dumps(report)
        for _, draft in CASES:
            self.assertNotIn(draft, serialized)
        self.assertNotIn("corrections", serialized)


class BenchmarkRegressionTests(unittest.TestCase):
    def test_repeated_fresh_connections_have_separate_phase_distributions(self):
        report = run_benchmark(FIXTURE, fixture=True, samples=3, timeout=3)
        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["connections_opened"], 3)
        rows = report["measurements"]
        self.assertEqual(Counter(row["case"] for row in rows), {case: 3 for case, _ in CASES})
        firsts = [row for row in rows if row["phase"] == "first_request"]
        self.assertEqual([row["connection"] for row in firsts], [1, 2, 3])
        self.assertEqual([row["case"] for row in firsts], [case for case, _ in CASES[:3]])
        phases = report["summary"]["phases"]
        self.assertEqual(phases["first_request"]["attempted"], 3)
        self.assertEqual(phases["subsequent_request"]["attempted"], 15)
        self.assertNotIn("completion_p50_ms", report["summary"])
        for phase, summary in phases.items():
            selected = [row for row in rows if row["phase"] == phase]
            self.assertEqual(summary["completion_p95_ms"], percentile([r["completion_ms"] for r in selected], .95))
            self.assertEqual(summary["first_delta_p50_ms"], percentile([r["first_delta_ms"] for r in selected], .50))

    def test_phase_statistics_exclude_interrupted_turns(self):
        rows = [{"terminal": "completed", "completion_ms": value, "first_delta_ms": value / 2,
                 "structured_valid": True} for value in [10, 20, 30]]
        rows.append({"terminal": "interrupted", "completion_ms": 9999, "first_delta_ms": 9999,
                     "structured_valid": False})
        summary = phase_summary(rows)
        self.assertEqual(summary["attempted"], 4)
        self.assertEqual(summary["completed"], 3)
        self.assertEqual(summary["completion_p50_ms"], 20)
        self.assertEqual(summary["completion_p95_ms"], 30)
        self.assertEqual(summary["first_delta_p50_ms"], 10)
        self.assertEqual(summary["first_delta_p95_ms"], 15)

    def test_cli_disconnect_keeps_earlier_measurements_and_reports_no_traceback(self):
        peers = []
        def dying_peer(command, **kwargs):
            peer = NativeConnection(command + ["--fail-on", "2"], **kwargs)
            peers.append(peer)
            return peer
        output = io.StringIO()
        with patch.object(benchmark_provider, "NativeConnection", dying_peer), \
                patch.object(sys, "argv", ["benchmark", "--fixture", "--samples", "3"]), redirect_stdout(output):
            code = benchmark_provider.main()
        report = json.loads(output.getvalue())
        self.assertEqual(code, 2)
        self.assertEqual(report["status"], "incomplete")
        self.assertEqual(report["reason"], "EOFError")
        self.assertEqual(report["measurements"][0]["terminal"], "completed")
        self.assertEqual(report["measurements"][1]["terminal"], "interrupted")
        self.assertEqual(report["summary"]["attempted"], 2)
        self.assertEqual(report["summary"]["expected"], 18)
        self.assertEqual(report["connections_opened"], 1)
        self.assertTrue(peers[0].process.stdin.closed)
        self.assertTrue(peers[0].process.stdout.closed)
        self.assertFalse(peers[0].reader.is_alive())

    def test_malformed_stream_keeps_prior_results_and_stops(self):
        report = run_benchmark(FIXTURE + ["--fail-on", "2", "--failure", "malformed"], fixture=True, timeout=3)
        self.assertEqual(report["status"], "incomplete")
        self.assertEqual(report["reason"], "ProtocolError")
        self.assertEqual(report["summary"]["attempted"], 2)
        self.assertTrue(report["measurements"][0]["structured_valid"])

    def test_rate_limit_is_recorded_without_more_calls(self):
        report = run_benchmark(FIXTURE + ["--fail-on", "2", "--failure", "rate_limit"], fixture=True, samples=3)
        self.assertEqual(report["status"], "incomplete")
        self.assertTrue(report["limits"]["rate_limit_observed"])
        self.assertEqual(report["summary"]["attempted"], 2)
        self.assertEqual(report["cancellation"]["status"], "skipped_after_failure")

    def test_timeout_and_failed_drain_preserve_previous_measurement(self):
        class TimedOutPeer:
            def __init__(self, *_args, **_kwargs): self.sends = 0; self.delta_sent = False
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def start(self, provider, method, params=None):
                if method == "send": self.sends += 1
                return method
            def collect(self, request, **_kwargs):
                if request == "status":
                    return [{"type": "status", "status": {"availability": "available", "authentication": "authenticated",
                        "sign_in": "subscription", "capabilities": {"tool_isolation": True}}}, {"type": "completed"}]
                raise TimeoutError("private diagnostic")
            def event(self, *_args):
                if self.sends == 2: raise TimeoutError("private diagnostic")
                if not self.delta_sent:
                    self.delta_sent = True
                    return {"type": "delta", "text": '{"corrections":[]}'}
                return {"type": "completed"}
            def cancel(self, _target): pass
        with patch.object(benchmark_provider, "NativeConnection", TimedOutPeer):
            report = run_benchmark(["unused"])
        self.assertEqual(report["status"], "incomplete")
        self.assertEqual(report["reason"], "PROVIDER_TIMEOUT")
        self.assertEqual(report["measurements"][0]["terminal"], "completed")
        self.assertEqual(report["measurements"][1]["cleanup_reason"], "TimeoutError")
        self.assertNotIn("private diagnostic", json.dumps(report))

    def test_failed_cancellation_probe_keeps_all_completed_measurements(self):
        def cancellation_failure(command, **kwargs):
            peer = NativeConnection(command, **kwargs)
            collect = peer.collect
            cancelled = False
            def cancel(_target):
                nonlocal cancelled
                cancelled = True
            def guarded_collect(request, **kwargs):
                if cancelled: raise TimeoutError("private diagnostic")
                return collect(request, **kwargs)
            peer.cancel, peer.collect = cancel, guarded_collect
            return peer
        with patch.object(benchmark_provider, "NativeConnection", cancellation_failure):
            report = run_benchmark(FIXTURE, fixture=True, timeout=3)
        self.assertEqual(report["status"], "incomplete")
        self.assertEqual(report["summary"]["attempted"], 6)
        self.assertTrue(all(row["terminal"] == "completed" for row in report["measurements"]))
        self.assertEqual(report["cancellation"], {"status": "incomplete", "reason": "TimeoutError"})


class AuthorizationRegressionTests(unittest.TestCase):
    def test_native_probe_diagnostics_keep_only_protocol_enums(self):
        diagnostics = {}
        validate_authorization.record_terminal(diagnostics, "fixture", {
            "type": "failed", "reason": "private provider output", "text": "private draft"})
        validate_authorization.record_terminal(diagnostics, "cancel", {"type": "stopped", "text": "private draft"})
        self.assertEqual(diagnostics, {"fixture": {"terminal": "failed", "reason": "PROVIDER_FAILED"},
                                       "cancel": {"terminal": "stopped"}})

    def test_disconnect_check_records_timeout_as_failure(self):
        peer = Mock()
        peer.next_frame.side_effect = TimeoutError
        self.assertFalse(validate_authorization.connection_closed(peer))
        peer.next_frame.side_effect = EOFError
        self.assertTrue(validate_authorization.connection_closed(peer))

    def test_wire_failures_produce_json_with_completed_checks(self):
        for error in (EOFError, ProtocolError):
            def fail(_binary, _fixture, _contract, report):
                report["checks"]["registered_manifest"] = True
                raise error("private diagnostic")
            output = io.StringIO()
            with patch.object(validate_authorization, "exercise", fail), \
                    patch.object(validate_authorization.sys, "platform", "linux"), \
                    patch.object(sys, "argv", ["validate", "--companion", "/unused"]), redirect_stdout(output):
                code = validate_authorization.main()
            report = json.loads(output.getvalue())
            self.assertEqual(code, 1)
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["reason"], error.__name__)
            self.assertEqual(report["checks"], {"registered_manifest": True})
            self.assertNotIn("private diagnostic", output.getvalue())


if __name__ == "__main__":
    unittest.main()
