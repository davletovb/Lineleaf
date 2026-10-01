import {LineleafError} from './policy.mjs';
export async function command(type, payload = null) {
  let response;
  try { response = await chrome.runtime.sendMessage({type, payload}); } catch { throw new LineleafError('UNAVAILABLE'); }
  if (!response?.ok) throw new LineleafError(response?.code ?? 'UNAVAILABLE'); return response.value;
}
