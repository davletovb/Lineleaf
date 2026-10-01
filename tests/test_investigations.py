import io
import json
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import patch

from tools.authorize_lineleaf import origin
from tools.benchmark_provider import (CASES, percentile, run_benchmark, safe_failure,
                                      validates_corrections, writing_turn)
from tools.seatline_wire import MAX_FRAME, NativeConnection, ProtocolError, read_frame, write_frame

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


if __name__ == "__main__":
    unittest.main()
