"""Exercise the unmodified installed companion in an isolated Linux registry."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from tools.seatline_wire import NativeConnection

ROOT = Path(__file__).resolve().parents[1]


def validate(binary):
    if sys.platform != "linux":
        return {"status": "blocked", "reason": "ISOLATED_REGISTRY_TEST_REQUIRES_LINUX"}
    contract = json.loads((ROOT / "config/seatline-contract.json").read_text())
    development = f"chrome-extension://{contract['development_extension_id']}/"
    other_origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
    checks = {}
    report = {"status": "failed", "kind": "native", "protocol": 1,
              "seatline_revision": contract["revision"], "platform": "linux",
              "development_extension_id": contract["development_extension_id"], "checks": checks,
              "store_extension_id": None, "chrome_permission_ui_tested": False}
    with tempfile.TemporaryDirectory(prefix="lineleaf-seatline-") as tmp:
        root = Path(tmp)
        data = root / "data"
        env = {**os.environ, "SEATLINE_DATA_DIR": str(data), "XDG_CONFIG_HOME": str(root / "config"),
               "SEATLINE_BROKER_IDLE_SECS": "1"}
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
        server = subprocess.Popen([str(installed), "serve"], env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not (data / "broker.sock").exists():
                if server.poll() is not None or time.monotonic() > deadline:
                    if server.poll() is not None and b"Operation not permitted (os error 1)" in server.stderr.read(4096):
                        report.update(status="blocked", reason="ENVIRONMENT_DENIES_LOCAL_IPC")
                        return report
                    raise RuntimeError("isolated broker failed to start")
                time.sleep(0.02)
            with NativeConnection([str(installed), development], env=env) as first, \
                    NativeConnection([str(installed), other_origin], env=env) as second:
                denied = first.collect(first.start("claude", "status"), timeout=5)[-1]
                checks["provider_grant_enforced"] = denied.get("reason") == "APP_NOT_AUTHORIZED"
                status = second.collect(second.start("codex", "status"), timeout=5)
                checks["other_consumer_still_connected"] = status[-1]["type"] == "completed"
                run("authorize", "lineleaf", "codex", development)
                try:
                    first.next_frame(3)
                    checks["reauthorization_closes_old_connection"] = False
                except EOFError:
                    checks["reauthorization_closes_old_connection"] = True
                with NativeConnection([str(installed), development], env=env) as fresh:
                    checks["reauthorized_origin_reconnects"] = True
                    run("revoke", "lineleaf")
                    try:
                        fresh.next_frame(3)
                        checks["revocation_closes_connection"] = False
                    except EOFError:
                        checks["revocation_closes_connection"] = True
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
    report["status"] = "passed" if all(checks.values()) else "failed"
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--companion", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = validate(args.companion.resolve())
    except (OSError, RuntimeError, TimeoutError, subprocess.SubprocessError) as exc:
        report = {"status": "failed", "reason": type(exc).__name__}
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
