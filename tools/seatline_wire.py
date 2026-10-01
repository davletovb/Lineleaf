"""Bounded IPC-v1 client for investigations, not a second native companion."""

from __future__ import annotations

import json
import queue
import struct
import subprocess
import threading
import time
import uuid
from typing import BinaryIO

MAX_FRAME = 1024 * 1024
TERMINAL = {"completed", "stopped", "failed"}
EVENTS = {"launched", "started", "activity", "delta", "session", "session_lost",
          "usage", "source", "status", *TERMINAL}


class ProtocolError(Exception):
    """Safe diagnostic that never contains provider output or credentials."""


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError("duplicate JSON key")
        result[key] = value
    return result


def read_frame(stream: BinaryIO) -> dict:
    def exact(size):
        parts = bytearray()
        while len(parts) < size:
            part = stream.read(size - len(parts))
            if not part:
                raise EOFError("companion disconnected")
            parts.extend(part)
        return bytes(parts)

    size = struct.unpack("<I", exact(4))[0]
    if not 0 < size <= MAX_FRAME:
        raise ProtocolError("invalid frame length")
    try:
        value = json.loads(exact(size).decode("utf-8"), object_pairs_hook=_unique_object,
                           parse_constant=lambda _: (_ for _ in ()).throw(ProtocolError("invalid JSON number")))
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise ProtocolError("invalid frame JSON") from exc
    if not isinstance(value, dict):
        raise ProtocolError("frame must be an object")
    return value


def write_frame(stream: BinaryIO, value: dict) -> None:
    data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if not 0 < len(data) <= MAX_FRAME:
        raise ProtocolError("outgoing frame too large")
    stream.write(struct.pack("<I", len(data)) + data)
    stream.flush()


class NativeConnection:
    def __init__(self, command: list[str], *, env=None, timeout=5):
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, env=env)
        self.frames = queue.Queue(maxsize=64)
        self.closed = threading.Event()
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        try:
            ready = self.next_frame(timeout)
            if ready != {"type": "ready", "version": 1}:
                raise ProtocolError("companion did not negotiate protocol 1")
        except BaseException:
            self.close()
            raise

    def _read(self):
        try:
            while not self.closed.is_set():
                frame = read_frame(self.process.stdout)
                self.frames.put(frame, timeout=1)
        except (EOFError, ProtocolError, OSError, queue.Full) as exc:
            try:
                self.frames.put(exc, timeout=1)
            except queue.Full:
                self.process.terminate()

    def next_frame(self, timeout):
        if timeout <= 0:
            raise TimeoutError("request deadline exceeded")
        try:
            value = self.frames.get(timeout=timeout)
        except queue.Empty as exc:
            raise TimeoutError("request deadline exceeded") from exc
        if isinstance(value, BaseException):
            raise value
        return value

    def send(self, value):
        if self.closed.is_set():
            raise ProtocolError("connection closed")
        write_frame(self.process.stdin, value)

    def start(self, provider, method, params=None):
        request_id = uuid.uuid4().hex
        self.send({"id": request_id, "provider": provider, "method": method, "params": params})
        return request_id

    def event(self, request_id, timeout):
        value = self.next_frame(timeout)
        event = value.get("event")
        if value.get("id") != request_id or not isinstance(event, dict) or event.get("type") not in EVENTS:
            raise ProtocolError("unexpected companion event")
        return event

    def collect(self, request_id, timeout=30):
        deadline = time.monotonic() + timeout
        result = []
        received_bytes = 0
        while True:
            event = self.event(request_id, deadline - time.monotonic())
            received_bytes += len(json.dumps(event).encode())
            if received_bytes > MAX_FRAME * 4:
                raise ProtocolError("event stream exceeds investigation limit")
            result.append(event)
            if len(result) > 4096:
                raise ProtocolError("too many events")
            if event["type"] in TERMINAL:
                return result

    def cancel(self, target):
        # The merged hub reads value["target"], not params["target"]. No cancel acknowledgement.
        self.send({"id": uuid.uuid4().hex, "method": "cancel", "target": target})

    def close(self):
        if self.closed.is_set():
            return
        self.closed.set()
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        for stream in (self.process.stdin, self.process.stdout):
            stream.close()
        self.reader.join(timeout=1)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
