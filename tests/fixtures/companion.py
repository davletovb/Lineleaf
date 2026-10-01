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
args = parser.parse_args()
sends = 0


def emit(value):
    with lock:
        write_frame(sys.stdout.buffer, value)


def reply(request, event):
    emit({"id": request["id"], "event": event})


def turn(request, stop):
    reply(request, {"type": "launched"})
    if stop.wait(0.18):
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
    elif method == "status":
        reply(request, {"type": "status", "provider": request["provider"], "status": {
            "availability": "available", "authentication": "authenticated", "sign_in": "subscription",
            "capabilities": {"tool_isolation": True}, "models": []}})
        reply(request, {"type": "completed"})
    elif method == "send":
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
        threading.Thread(target=turn, args=(request, stop), daemon=True).start()
