"""Preview or explicitly apply a Lineleaf grant to an existing Seatline installation."""

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess


def origin(extension_id):
    if not re.fullmatch(r"[a-p]{32}", extension_id):
        raise ValueError("extension ID must contain exactly 32 letters a-p")
    return f"chrome-extension://{extension_id}/"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--companion", required=True)
    parser.add_argument("--extension-id", action="append", required=True,
                        help="Repeat for every development/store ID that should retain authorization")
    parser.add_argument("--provider", action="append", choices=["codex", "claude", "gemini", "grok"])
    parser.add_argument("--apply", action="store_true", help="Replace the existing Lineleaf grant")
    args = parser.parse_args()
    try:
        origins = list(dict.fromkeys(origin(value) for value in args.extension_id))
    except ValueError as exc:
        parser.error(str(exc))
    providers = list(dict.fromkeys(args.provider or ["codex"]))
    binary = shutil.which(args.companion) or str(Path(args.companion).resolve())
    command = [binary, "authorize", "lineleaf", ",".join(providers), *origins]
    report = {"app": "lineleaf", "command": command, "applied": False,
              "grant_semantics": "Replaces the entire Lineleaf grant; repeat every retained origin and provider."}
    if args.apply:
        try:
            result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            report["applied"] = result.returncode == 0
        except (OSError, subprocess.SubprocessError) as exc:
            report["reason"] = type(exc).__name__
        print(json.dumps(report, indent=2))
        return 0 if report["applied"] else 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
