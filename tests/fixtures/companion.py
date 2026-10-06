"""Synthetic wire-v1 peer: only validates client behavior, never provider performance."""

import argparse
import json
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.seatline_wire import read_frame, write_frame

lock = threading.Lock()
active = {}
parser = argparse.ArgumentParser()
parser.add_argument("--fail-on", type=int)
parser.add_argument("--failure", choices=["disconnect", "malformed", "rate_limit"], default="disconnect")
parser.add_argument("--legacy", action="store_true", help="Act as a companion that predates Seatline's readiness API")
parser.add_argument("--hold-turn", type=int, help="Keep this generation running until target cancellation; no timing race")
parser.add_argument("--cloud", action="store_true", help="Synthetic cloud sign-in for Antigravity opt-in tests")
args = parser.parse_args()
sends = 0
STATUS = {"availability": "available", "authentication": "authenticated", "sign_in": "cloud" if args.cloud else "subscription",
          "capabilities": {"tool_isolation": True, "reasoning_effort": True, "service_tier": True}, "models": []}


def emit(value):
    with lock:
        write_frame(sys.stdout.buffer, value)


def reply(request, event):
    emit({"id": request["id"], "event": event})


def turn(request, stop, held):
    reply(request, {"type": "launched"})
    if stop.wait(None if held else 0.18):
        reply(request, {"type": "stopped"})
        return
    text = json.loads(request["params"]["messages"][0]["text"])["text"]
    corrections = []
    for before, after, category in [(" go ", " goes ", "grammar"), ("seperate", "separate", "spelling")]:
        if before in text:
            corrections.append({"before": before, "after": after, "left": "", "right": "",
                                "category": category, "explanation": "Synthetic test correction."})
    reply(request, {"type": "delta", "text": json.dumps({"corrections": corrections})})
    reply(request, {"type": "completed"})


emit({"type": "ready", "version": 1})
while True:
    try:
        request = read_frame(sys.stdin.buffer)
    except EOFError:
        break
    method = request.get("method")
    if method == "cancel":
        if request.get("target") in active:
            active[request["target"]].set()
    elif method in ("readiness", "prepare", "send_ready_with_policy") and args.legacy:
        reply(request, {"type": "failed", "reason": "INVALID_REQUEST"})  # An unknown method, as an older companion answers it.
    elif method in ("status", "readiness", "prepare"):
        reply(request, {"type": "status", "provider": request["provider"], "status": STATUS})
        reply(request, {"type": "completed"})
    elif method in ("send", "send_ready_with_policy"):
        if method == "send_ready_with_policy":  # A checked send reports the readiness it ran under before its turn.
            reply(request, {"type": "status", "provider": request["provider"], "status": STATUS})
            modes = request["params"].get("allowed_sign_in")
            if not isinstance(modes, list) or not 1 <= len(modes) <= 4 or any(mode not in ("subscription", "api_key", "cloud", "unknown") for mode in modes):
                reply(request, {"type": "failed", "reason": "INVALID_REQUEST"})
                continue
            if STATUS["sign_in"] not in modes:
                reply(request, {"type": "failed", "reason": "SIGN_IN_POLICY_DENIED"})
                continue
            request = {**request, "params": request["params"]["turn"]}
        sends += 1
        if sends == args.fail_on:
            if args.failure == "disconnect":
                break
            if args.failure == "malformed":
                reply(request, {"type": "delta", "text": 42})
            else:
                reply(request, {"type": "failed", "reason": "PROVIDER_RATE_LIMITED"})
            continue
        stop = threading.Event()
        active[request["id"]] = stop
        threading.Thread(target=turn, args=(request, stop, sends == args.hold_turn), daemon=True).start()
