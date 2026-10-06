import {PROVIDER_LABELS} from './policy.mjs';
export const MESSAGES = {
  NATIVE_UNAVAILABLE: 'Seatline is unavailable. Install the shared companion and authorize the Lineleaf extension ID.',
  COMPANION_UPDATE_REQUIRED: 'The Seatline that is running does not support the required check settings, so the check was refused and nothing was sent to the provider. Run “seatline-companion install” from the updated Seatline, quit the Seatline that is still running (it stays up while any app uses it), then try again.',
  PROTOCOL_ERROR: 'Seatline returned an unsupported response. Check the companion version.',
  EXECUTABLE_NOT_FOUND: 'The selected provider was not found by Seatline. Install its supported CLI.',
  LOGIN_REQUIRED: 'Sign in to the selected provider, then try again.', AUTH_REJECTED: 'Provider sign-in was rejected. Sign in again.',
  SUBSCRIPTION_REQUIRED: 'This prototype requires a verified subscription sign-in. API-key and unknown configurations are not enabled.',
  CLOUD_SIGN_IN_REQUIRED: 'Gemini through Antigravity requires the cloud-route opt-in in Settings before text can be sent.',
  TOOL_ISOLATION_UNAVAILABLE: 'This provider configuration cannot guarantee a request with no tools.',
  APP_NOT_AUTHORIZED: 'Authorize Lineleaf for the selected provider using the existing Seatline companion.',
  PROVIDER_RATE_LIMITED: 'The provider reached a limit. Wait a minute before trying again.',
  QUEUE_FULL: 'Seatline is busy. Wait briefly before trying again.', PROVIDER_TIMEOUT: 'The provider did not answer in time, so the request was cancelled and nothing was changed. Try again, choose a faster model in Settings, or use Check Seatline in Settings if it keeps happening.',
  PROVIDER_UNAVAILABLE: 'The provider is unavailable. Check the selected provider and Seatline.', PROVIDER_FAILED: 'The provider could not finish this request.',
  READINESS_CHANGED: 'Your Provider sign-in or settings changed while Lineleaf was checking. Try again.',
  READINESS_EXPIRED: 'Your Provider sign-in changed while Lineleaf was checking. Try again.',
  READINESS_UNVERIFIED: 'Seatline could not confirm that the provider is ready, so nothing was sent. Use Check Seatline in Settings, then try again.',
  READINESS_TIMEOUT: 'The provider did not confirm in time that it is ready, so nothing was sent. Try again.',
  MODEL_NOT_SUPPORTED: 'This model is not supported. Check the model setting.',
  REASONING_EFFORT_UNSUPPORTED: 'This reasoning effort is not supported. Check the effort setting.',
  SERVICE_TIER_UNSUPPORTED: 'This speed setting is not supported. Check your Codex version and model, or choose Standard in Settings.',
  INVALID_OUTPUT: 'The response could not be safely matched to your selection. No changes were made.',
  INVALID_REQUEST: 'Select between 1 and 2,000 characters in an eligible field.',
  SITE_DISABLED: 'Enable this site in Lineleaf before checking text.', PAUSED: 'Lineleaf is paused. Resume it in settings.',
  BUSY: 'Another Lineleaf request is running. Cancel it or wait for it to finish.',
  AUTO_WAIT: 'Automatic checking is waiting for the shared request interval.',
  AUTOMATIC_DISABLED: 'Automatic checking is off. Enable it in settings after reviewing the provider disclosure.',
  AUTO_PAUSED: 'Automatic checking is paused for a few minutes because The provider did not answer in time. Choose Check now to try again.',
  CLARITY_DISABLED: 'Clearer-wording suggestions are off. Enable them in settings after reviewing the provider disclosure.',
  SETTINGS_CHANGED: 'Preferences changed elsewhere. Reload settings before saving your changes.',
  OFFLINE: 'You are offline. Check your connection, then retry when ready.',
  CANCELLED: 'Cancelled. No changes were made.', STALE: 'The selection changed. Select text and check again.',
  STALE_DOCUMENT: 'The page or frame changed. Select the current text and check again.',
  UNAVAILABLE: 'Lineleaf could not complete this action. Reopen the extension and try again.',
  RESTRICTED_PAGE: 'Lineleaf is available on ordinary HTTP and HTTPS pages and eligible same-origin frames. This page or frame is unavailable.',
};
export const messageFor = code => MESSAGES[code] ?? MESSAGES.UNAVAILABLE;
// What Check Seatline shows. "Ready" describes the provider; a companion that cannot receive writing is said so, because it would otherwise
// look healthy while every check is refused.
export function connectionSummary(state) {
  const line = `${PROVIDER_LABELS[state.provider] ?? 'Codex'}: ${state.availability}, ${state.authentication}, ${state.sign_in}. No-tools requests: ${state.tool_isolation ? 'supported' : 'unavailable'}.`;
  if (state.sign_in_allowed === false) return `${line} ${messageFor(state.provider === 'gemini' && state.sign_in === 'cloud' ? 'CLOUD_SIGN_IN_REQUIRED' : 'SUBSCRIPTION_REQUIRED')}`;
  return state.update_required === true ? `${line} ${MESSAGES.COMPANION_UPDATE_REQUIRED}` : line;
}
