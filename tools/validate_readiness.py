"""Readiness reuse through the unmodified Seatline broker: how many provider processes a run of writing requests launches.

The provider benchmark runs twice against a real companion and broker in an isolated Linux registry, with the fake Codex of
Seatline's own tests (signed in with a ChatGPT subscription) standing in for the provider:

* legacy: `status`, then `send` with `check_sign_in`. Seatline probes sign-in again inside every turn.
* cached: `readiness`, then `send_ready_with_policy` under it. One probe serves the whole run.

The fake records every launch, so the counts are real process launches. It is a fake provider, so this says nothing about a live
provider's latency, quota or sign-in behaviour; those need a live run, which CI cannot make.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

from tools.benchmark_provider import CASES, run_benchmark

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = 2


class Registry:
    """An isolated registry with one authorized Lineleaf, a broker, and the fake Codex signed in with a subscription."""

    def __init__(self, binary, fake_provider):
        self.binary, self.fake_provider = binary, fake_provider
        self.contract = json.loads((ROOT / "config/seatline-contract.json").read_text())
        self.origin = f"chrome-extension://{self.contract['development_extension_id']}/"

    def __enter__(self):
        # Seatline verifies every workspace ancestor: a private child of the real home, not shared /tmp.
        self.directory = tempfile.TemporaryDirectory(prefix="lineleaf-readiness-", dir=Path.home())
        root = Path(self.directory.name)
        self.data = root / "data"
        self.env = {**os.environ, "SEATLINE_DATA_DIR": str(self.data), "XDG_CONFIG_HOME": str(root / "config"),
                    "XDG_CACHE_HOME": str(root / "cache"), "XDG_DATA_HOME": str(root / "provider-data"),
                    "SEATLINE_BROKER_IDLE_SECS": "0"}
        self.providers = root / "providers"
        self.providers.mkdir(mode=0o700)
        run = lambda *args: subprocess.run([str(self.binary), *args], env=self.env, stdout=subprocess.PIPE,
                                           stderr=subprocess.DEVNULL, timeout=10, check=True)
        run("install")
        self.installed = Path((self.data / "companion-executable").read_text())
        run("authorize", "lineleaf", "codex", self.origin)
        shutil.copy2(self.fake_provider, self.providers / "codex")
        (self.providers / "codex").chmod(0o700)
        (self.providers / "codex-scenario").write_text("login=subscription\nexec=answers\n")
        broker_env = {key: self.env[key] for key in ("SEATLINE_DATA_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
                                                    "XDG_DATA_HOME", "SEATLINE_BROKER_IDLE_SECS")}
        broker_env.update(PATH=os.defpath, LANG="C.UTF-8", LINELEAF_PROVIDER_PATH=str(self.providers))
        self.server = subprocess.Popen([str(self.installed), "serve"], env=broker_env, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.PIPE)
        deadline = time.monotonic() + 5
        while not (self.data / "broker.sock").exists():
            if self.server.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError("isolated broker failed to start")
            time.sleep(0.02)
        return self

    def __exit__(self, *_exc):
        self.server.kill()
        self.server.wait()
        self.directory.cleanup()


def measure(binary, fake_provider, readiness):
    with Registry(binary, fake_provider) as registry:
        # The bridge the benchmark starts talks to this registry's broker.
        with patch.dict(os.environ, registry.env):
            report = run_benchmark([str(registry.installed), registry.origin], samples=SAMPLES, timeout=20,
                                   readiness=readiness, launch_log=str(registry.providers / "codex-invocations"))
    return report


def validate(binary, fake_provider):
    if sys.platform != "linux":
        return {"status": "blocked", "reason": "ISOLATED_REGISTRY_TEST_REQUIRES_LINUX"}
    contract = json.loads((ROOT / "config/seatline-contract.json").read_text())
    runs = {mode: measure(binary, fake_provider, mode) for mode in ("legacy", "cached")}
    turns = SAMPLES * len(CASES) + 1  # every case, and the cancellation probe
    expected = {"legacy": {"status": SAMPLES + turns, "generation": turns},  # one status per connection, one probe inside every turn
                "cached": {"status": 1, "generation": turns}}                 # one probe for the whole run, then cache hits
    checks = {}
    for mode, report in runs.items():
        launches = report.get("provider_launches") or {}
        checks[f"{mode}_completed"] = report["status"] == "completed" and report["readiness"] == mode
        checks[f"{mode}_launch_counts"] = {key: launches.get(key) for key in ("status", "generation")} == expected[mode]
    legacy, cached = (runs[mode].get("provider_launches") or {} for mode in ("legacy", "cached"))
    checks["cached_saves_status_probes_not_turns"] = (cached.get("generation") == legacy.get("generation")
                                                      and (cached.get("status") or 0) < (legacy.get("status") or 0))
    summary = {mode: {"launches": {key: (runs[mode].get("provider_launches") or {}).get(key) for key in ("status", "generation")},
                      "phases": {phase: {key: runs[mode]["summary"]["phases"][phase][key]
                                         for key in ("attempted", "completed", "completion_p50_ms", "first_delta_p50_ms", "provider_launches")}
                                 for phase in ("first_request", "subsequent_request")}}
               for mode in runs}
    return {"status": "passed" if all(checks.values()) else "failed", "kind": "native-fixture", "protocol": 1,
            "seatline_revision": os.environ.get("SEATLINE_REVISION") or contract["revision"], "platform": "linux", "samples_per_case": SAMPLES,
            "expected_launches": expected, "checks": checks, "runs": summary,
            "boundary": "Real launches of Seatline's fake Codex through an isolated broker; not a live provider, so no latency, quota or "
                        "sign-in result for Codex itself. Each run starts a new broker with an empty readiness cache."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--companion", required=True, type=Path)
    parser.add_argument("--fake-provider", required=True, type=Path)
    args = parser.parse_args()
    report = validate(args.companion.resolve(), args.fake_provider.resolve())
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
