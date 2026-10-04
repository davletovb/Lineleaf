"""Exercise the unmodified installed companion in an isolated Linux registry."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from tools.benchmark_provider import safe_failure, writing_turn
from tools.seatline_wire import NativeConnection, ProtocolError, TERMINAL

ROOT = Path(__file__).resolve().parents[1]


ERRORS = (OSError, RuntimeError, TimeoutError, subprocess.SubprocessError, ProtocolError, EOFError, ValueError)


def connection_closed(connection, timeout=3):
    try:
        connection.next_frame(timeout)
    except EOFError:
        return True
    except TimeoutError:
        return False
    return False


def probe_turns(connection, directory, fake_provider, checks, diagnostics):
    # The discovery override is an empty directory: no user provider executable/account can run.
    turn = writing_turn("Synthetic schema probe.")
    missing = connection.collect(connection.start("codex", "send", turn), timeout=5)[-1]
    record_terminal(diagnostics, "missing_executable", missing)
    checks["send_schema_missing_executable"] = missing["type"] == "failed" and missing.get("reason") == "EXECUTABLE_NOT_FOUND"
    if fake_provider is None:
        return
    shutil.copy2(fake_provider, directory / "codex")
    (directory / "codex").chmod(0o700)
    scenario = directory / "codex-scenario"
    scenario.write_text("login=signed-in\nexec=answers\n")
    events = connection.collect(connection.start("codex", "send", turn), timeout=5)
    record_terminal(diagnostics, "upstream_fixture", events[-1])
    checks["send_schema_upstream_fixture"] = events[-1]["type"] == "completed" and any(
        event["type"] == "delta" and "Synthetic schema probe." in event.get("text", "") for event in events)
    scenario.write_text("login=signed-in\nexec=fails-429\n")
    limited = connection.collect(connection.start("codex", "send", turn), timeout=5)[-1]
    record_terminal(diagnostics, "rate_limit", limited)
    checks["rate_limit_reason_mapping"] = limited["type"] == "failed" and safe_failure(limited) == "PROVIDER_RATE_LIMITED"
    scenario.write_text("login=signed-in\nexec=goes-quiet\n")
    target = connection.start("codex", "send", turn)
    deadline = time.monotonic() + 5
    checks["top_level_cancel_stops_target"] = False
    for _ in range(1024):
        event = connection.event(target, deadline - time.monotonic())
        if event["type"] == "started":
            connection.cancel(target)
            terminal = connection.collect(target, timeout=5)[-1]
            record_terminal(diagnostics, "cancel", terminal)
            checks["top_level_cancel_stops_target"] = terminal["type"] == "stopped"
            break
        if event["type"] in TERMINAL:
            record_terminal(diagnostics, "cancel", event)
            break
    else:
        raise ProtocolError("native probe event limit exceeded")


def record_terminal(diagnostics, name, event):
    # Keep only protocol enums; never copy provider text, paths, account details, or raw reasons.
    diagnostics[name] = {"terminal": event["type"] if event["type"] in TERMINAL else "unknown"}
    if event["type"] == "failed":
        diagnostics[name]["reason"] = safe_failure(event)


def validate(binary, fake_provider=None, *, coexistence=False):
    if sys.platform != "linux":
        return {"status": "blocked", "reason": "ISOLATED_REGISTRY_TEST_REQUIRES_LINUX"}
    contract = json.loads((ROOT / "config/seatline-contract.json").read_text())
    checks = {}
    report = {"status": "failed", "kind": "native", "protocol": 1,
              "seatline_revision": os.environ.get("SEATLINE_REVISION") or contract["revision"], "platform": "linux",
              "development_extension_id": contract["development_extension_id"], "checks": checks,
              "store_extension_id": None, "chrome_permission_ui_tested": False,
              "provider_diagnostics": {},
              "provider_probe": "upstream-fixture" if fake_provider else "missing-executable-only"}
    if coexistence:
        report.update(kind="native-coexistence-fixture", coexistence_checks={}, release_eligible=False,
                      boundary="Isolated Linux broker/upstream fake provider; live browser/provider coexistence remains unverified.")
    try:
        if coexistence:
            exercise(binary, fake_provider, contract, report, coexistence=True)
        else:
            exercise(binary, fake_provider, contract, report)
    except ERRORS as exc:
        report["reason"] = type(exc).__name__
        return report  # Keep every completed per-check result; never print private native output.
    if report["status"] != "blocked":
        extra = report.get("coexistence_checks", {})
        complete = True
        if coexistence:
            from tools.validate_coexistence import CHECKS
            complete = set(extra) == set(CHECKS) and all(value is True for value in extra.values())
        report["status"] = "passed" if checks and all(checks.values()) and complete else "failed"
    return report


def exercise(binary, fake_provider, contract, report, *, coexistence=False):
    checks = report["checks"]
    development = f"chrome-extension://{contract['development_extension_id']}/"
    other_origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
    # Seatline verifies every workspace ancestor: a private child of shared /tmp is insufficient.
    # Use the actual private home without changing HOME or inheriting provider credentials.
    with tempfile.TemporaryDirectory(prefix="lineleaf-seatline-", dir=Path.home()) as tmp:
        root = Path(tmp)
        data = root / "data"
        env = {**os.environ, "SEATLINE_DATA_DIR": str(data), "XDG_CONFIG_HOME": str(root / "config"),
               "XDG_CACHE_HOME": str(root / "cache"), "XDG_DATA_HOME": str(root / "provider-data"),
               "SEATLINE_BROKER_IDLE_SECS": "0"}
        providers = root / "providers"
        providers.mkdir(mode=0o700)
        empty = root / "empty"
        empty.mkdir(mode=0o700)
        # install/register requires the existing HOME, but XDG_CONFIG_HOME confines Linux registration.
        # The broker receives no HOME, provider credentials, or user Codex configuration.
        broker_env = {key: env[key] for key in ("SEATLINE_DATA_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
                                               "XDG_DATA_HOME", "SEATLINE_BROKER_IDLE_SECS")}
        broker_env.update(PATH=os.defpath, LANG="C.UTF-8", LINELEAF_PROVIDER_PATH=str(providers),
                          LINELEAF_OTHER_PROVIDER_PATH=str(empty))
        def run(*args, check=True):
            return subprocess.run([str(binary), *args], env=env, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, timeout=10, check=check)
        run("install")
        installed = Path((data / "companion-executable").read_text())
        run("authorize", "lineleaf", "codex", development)
        run("authorize", "lineleaf_other", "codex", other_origin)
        manifest = json.loads(run("manifest").stdout)
        checks["one_installation_two_consumers"] = (
            manifest["path"] == str(installed) and manifest["name"] == contract["native_host"]
            and set(manifest["allowed_origins"]) == {development, other_origin}
            and len(list((data / "versions").iterdir())) == 1)
        checks["registered_manifest"] = json.loads(
            (root / "config/google-chrome/NativeMessagingHosts/com.seatline.host.json").read_text()
        ) == manifest
        malformed = run("authorize", "invalid", "codex", "chrome-extension://bad/", check=False)
        checks["invalid_id_refused"] = malformed.returncode != 0 and not (data / "apps/invalid.json").exists()
        unknown = run("chrome-extension://pppppppppppppppppppppppppppppppp/", check=False)
        checks["unknown_origin_refused"] = unknown.returncode != 0
        server = subprocess.Popen([str(installed), "serve"], env=broker_env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not (data / "broker.sock").exists():
                if server.poll() is not None or time.monotonic() > deadline:
                    if server.poll() is not None and b"Operation not permitted (os error 1)" in server.stderr.read(4096):
                        report.update(status="blocked", reason="ENVIRONMENT_DENIES_LOCAL_IPC")
                        return
                    raise RuntimeError("isolated broker failed to start")
                time.sleep(0.02)
            with NativeConnection([str(installed), development], env=broker_env) as first, \
                    NativeConnection([str(installed), other_origin], env=broker_env) as second:
                denied = first.collect(first.start("claude", "status"), timeout=5)[-1]
                checks["provider_grant_enforced"] = denied.get("reason") == "APP_NOT_AUTHORIZED"
                status = second.collect(second.start("codex", "status"), timeout=5)
                checks["other_consumer_still_connected"] = status[-1]["type"] == "completed"
                probe_turns(first, providers, fake_provider, checks, report["provider_diagnostics"])
                if coexistence:
                    if fake_provider is None:
                        raise ValueError("fake provider required for bounded coexistence probes")
                    from tools.validate_coexistence import shared_probes
                    shared_probes(first, second, providers, empty, fake_provider, report["coexistence_checks"])
                run("authorize", "lineleaf", "codex", development)
                checks["reauthorization_closes_old_connection"] = connection_closed(first)
                checks["reauthorized_origin_reconnects"] = False
                with NativeConnection([str(installed), development], env=broker_env) as fresh:
                    events = fresh.collect(fresh.start("codex", "status"), timeout=5)
                    checks["reauthorized_origin_reconnects"] = events[-1]["type"] == "completed"
                    run("revoke", "lineleaf")
                    checks["revocation_closes_connection"] = connection_closed(fresh)
                run("authorize", "lineleaf_duplicate", "codex", other_origin)
                duplicate = run(other_origin, check=False)
                checks["ambiguous_origin_refused"] = duplicate.returncode != 0
                # Revoking Lineleaf did not revoke or rotate the other consumer's credentials.
                status = second.collect(second.start("codex", "status"), timeout=5)
                checks["revocation_is_app_scoped"] = status[-1]["type"] == "completed"
        finally:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=3)
            server.stderr.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--companion", required=True, type=Path)
    parser.add_argument("--fake-provider", type=Path, help="Pinned upstream seatline-fake-provider test binary, never a real provider")
    args = parser.parse_args()
    try:
        report = validate(args.companion.resolve(), args.fake_provider.resolve() if args.fake_provider else None)
    except ERRORS as exc:
        report = {"status": "failed", "reason": type(exc).__name__}
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
