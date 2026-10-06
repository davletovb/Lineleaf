"""Concurrent app/session/cancellation probes through the unmodified Seatline broker."""
import argparse
import json
from pathlib import Path
import shutil
import time

from tools.validate_authorization import protocol_turn
from tools.seatline_wire import ProtocolError, TERMINAL, EVENTS

CHECKS = ('concurrent_same_id_routing', 'no_cross_app_output', 'writing_turns_emit_no_persistent_session',
          'foreign_continuation_refused', 'foreign_forget_refused', 'owner_session_survives_foreign_attempts',
          'own_cancel_stops_target', 'same_id_other_app_not_cancelled', 'app_queue_rejects_overflow',
          'running_turn_cap_observed', 'queued_and_active_cancel_drain', 'other_consumer_progress_after_pressure',
          'lineleaf_recovers_without_replay')


def events_until_started(connection, target, timeout=5):
    deadline = time.monotonic() + timeout
    for _ in range(128):
        event = connection.event(target, deadline - time.monotonic())
        if event['type'] == 'started':
            return
        if event['type'] in TERMINAL:
            raise ProtocolError('turn did not start')
    raise ProtocolError('event limit')


def answer(events):
    return ''.join(x.get('text', '') for x in events if x['type'] == 'delta')


def shared_probes(first, second, providers, other_providers, fake_provider, checks):
    for directory in (providers, other_providers):
        shutil.copy2(fake_provider, directory / 'codex')
        (directory / 'codex').chmod(0o700)
        (directory / 'codex-scenario').write_text('login=signed-in\nexec=answers\n')
    left, right = 'lineleaf-synthetic-only-42', 'other-consumer-synthetic-only-73'
    common = 'identical-client-request-id'
    for client, marker in ((first, left), (second, right)):
        client.send({'id': common, 'provider': 'codex', 'method': 'send', 'params': protocol_turn(marker)})
    a, b = first.collect(common, timeout=8), second.collect(common, timeout=8)
    checks['concurrent_same_id_routing'] = a[-1]['type'] == b[-1]['type'] == 'completed'
    checks['no_cross_app_output'] = left in answer(a) and right not in answer(a) and right in answer(b) and left not in answer(b)
    checks['writing_turns_emit_no_persistent_session'] = not any(e['type'] in ('session', 'session_lost') for e in a + b)

    persistent = {**protocol_turn(right), 'session': 'persistent'}
    owned = second.collect(second.start('codex', 'send', persistent), timeout=8)
    token = next((e.get('handle') for e in owned if e['type'] == 'session'), None)
    if not isinstance(token, str):
        raise ProtocolError('missing owner session')
    foreign = first.collect(first.start('codex', 'send', {**persistent, 'continuation': token}), timeout=5)
    checks['foreign_continuation_refused'] = foreign[-1]['type'] == 'failed' and foreign[-1].get('reason') == 'UNKNOWN_SESSION'
    forgotten = first.collect(first.start('codex', 'forget', {'sessions': [token]}), timeout=5)
    checks['foreign_forget_refused'] = forgotten[-1]['type'] == 'failed' and forgotten[-1].get('reason') == 'INVALID_REQUEST'
    resumed = second.collect(second.start('codex', 'send', {**persistent, 'continuation': token}), timeout=8)
    checks['owner_session_survives_foreign_attempts'] = resumed[-1]['type'] == 'completed' and right in answer(resumed) and left not in answer(resumed)

    for directory in (providers, other_providers):
        (directory / 'codex-scenario').write_text('login=signed-in\nexec=goes-quiet\n')
    target = 'identical-cancel-target'
    for client, marker in ((first, left), (second, right)):
        client.send({'id': target, 'provider': 'codex', 'method': 'send', 'params': protocol_turn(marker)})
    events_until_started(first, target); events_until_started(second, target)
    first.cancel(target)
    checks['own_cancel_stops_target'] = first.collect(target, timeout=8)[-1]['type'] == 'stopped'
    other_terminal = False
    deadline = time.monotonic() + .2
    for _ in range(128):
        try:
            event = second.event(target, deadline - time.monotonic())
            other_terminal |= event['type'] in TERMINAL
        except TimeoutError:
            break
    second.cancel(target)
    checks['same_id_other_app_not_cancelled'] = not other_terminal and second.collect(target, timeout=8)[-1]['type'] == 'stopped'

    # Exactly twelve explicit synthetic attempts: two running + eight queued + two refused.
    # Never a traffic generator, quota exhaustion experiment or live-provider probe.
    targets = [f'bounded-queue-{n:02}' for n in range(12)]
    states = {target: [] for target in targets}
    def next_event(deadline):
        frame = first.next_frame(deadline - time.monotonic())
        target, event = frame.get('id'), frame.get('event')
        if target not in states or not isinstance(event, dict) or event.get('type') not in EVENTS:
            raise ProtocolError('unexpected queue event')
        states[target].append(event)
        if sum(len(v) for v in states.values()) > 1024:
            raise ProtocolError('queue event bound')
    for target in targets[:2]:
        first.send({'id': target, 'provider': 'codex', 'method': 'send', 'params': protocol_turn(left)})
        deadline = time.monotonic() + 5
        while not any(e['type'] == 'started' for e in states[target]):
            next_event(deadline)
    for target in targets[2:]:
        first.send({'id': target, 'provider': 'codex', 'method': 'send', 'params': protocol_turn(left)})
    deadline = time.monotonic() + 5
    while sum(any(e.get('reason') == 'QUEUE_FULL' for e in es) for es in states.values()) < 2:
        next_event(deadline)
    checks['app_queue_rejects_overflow'] = True
    checks['running_turn_cap_observed'] = sum(any(e['type'] == 'started' for e in es) for es in states.values()) == 2
    (other_providers / 'codex-scenario').write_text('login=signed-in\nexec=answers\n')
    other_request = second.start('codex', 'send', protocol_turn(right))
    for target in targets:
        first.cancel(target)
    deadline = time.monotonic() + 10
    while not all(any(e['type'] in TERMINAL for e in es) for es in states.values()):
        next_event(deadline)
    checks['queued_and_active_cancel_drain'] = all(es[-1]['type'] in ('stopped', 'failed') for es in states.values())
    other = second.collect(other_request, timeout=8)
    checks['other_consumer_progress_after_pressure'] = other[-1]['type'] == 'completed' and right in answer(other) and left not in answer(other)
    (providers / 'codex-scenario').write_text('login=signed-in\nexec=answers\n')
    fresh = first.collect(first.start('codex', 'send', protocol_turn(left)), timeout=8)
    checks['lineleaf_recovers_without_replay'] = fresh[-1]['type'] == 'completed' and left in answer(fresh) and right not in answer(fresh)


def main():
    from tools.validate_authorization import validate
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--companion', required=True, type=Path)
    parser.add_argument('--fake-provider', required=True, type=Path)
    args = parser.parse_args()
    report = validate(args.companion.resolve(), args.fake_provider.resolve(), coexistence=True)
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
