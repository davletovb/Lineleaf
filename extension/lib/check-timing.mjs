// One check's phase durations. Only static labels, requested provider/model/effort/speed and
// numbers leave this object; drafts, answers, origins and provider errors do not.
export function checkTiming(mode, kind, clock = () => performance.now()) {
  const began = clock(), marks = {};
  let readiness = 0, attempts = 0, provider = null, model = null, effort = null, serviceTier = null, sendAt = null, validationAt = null;
  const span = (start, end) => start === null || start === undefined || end === undefined ? null : Math.round(Math.max(0, end - start));
  return {
    readiness(ms) { readiness += Math.max(0, ms); },
    sending(settings) {
      attempts++; provider = settings.provider; model = settings.model || null; effort = settings.effort || null; serviceTier = settings.speed || null; sendAt = clock();
      for (const key of Object.keys(marks)) delete marks[key];
    },
    event(type) {
      if (['launched', 'started', 'delta', 'completed', 'failed', 'stopped'].includes(type) && marks[type] === undefined) marks[type] = clock();
    },
    validating() { validationAt = clock(); },
    finish(outcome) {
      const ended = clock(), terminal = marks.completed ?? marks.failed ?? marks.stopped;
      return {version: 3, mode, kind, requested_provider: provider, requested_model: model, reasoning_effort: effort, requested_service_tier: serviceTier, outcome, attempts,
        readiness_ms: Math.round(readiness), launch_wait_ms: span(sendAt, marks.launched),
        provider_init_ms: span(marks.launched, marks.started), answer_ms: span(marks.started, marks.delta),
        finish_ms: span(marks.delta, terminal), validation_ms: span(validationAt, ended), total_ms: span(began, ended)};
    }
  };
}
