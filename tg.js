// Telegram connection using MTProto (GramJS), logged in as YOUR user account.
// The Telegram Bot API cannot message another bot, so a user login is required.
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';

let client = null, creds = null, status = 'loggedout', onStatus = () => {};
const rawById = new Map();
export const setStatusListener = fn => { onStatus = fn; };
export const getStatus = () => status;
const setStatus = s => { status = s; onStatus(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const validBot = n => /^[A-Za-z][A-Za-z0-9_]{2,30}bot$/i.test(n);
export const validPhone = p => /^\+\d{7,15}$/.test(p);
export const validApiId = v => /^\d{3,12}$/.test(v);
export const validApiHash = v => /^[a-f0-9]{32}$/i.test(v);

export function friendly(e) {
  const m = String(e?.errorMessage || e?.message || e);
  if (/FLOOD/.test(m)) return `Too many tries. Wait ${e.seconds || 'a few'} seconds and try again.`;
  const map = {
    PHONE_NUMBER_INVALID: 'This phone number is not valid.',
    PHONE_CODE_INVALID: 'The code is wrong.',
    PHONE_CODE_EXPIRED: 'The code is old. Ask for a new one.',
    PASSWORD_HASH_INVALID: 'The password is wrong.',
    API_ID_INVALID: 'API ID or API hash is wrong.',
    USERNAME_NOT_OCCUPIED: 'No bot with this username.',
    NOT_A_BOT: 'This username is not a bot.',
    TIMEOUT: 'The bot did not answer in time. Try again.',
    OFFLINE: 'You are offline.'
  };
  for (const k in map) if (m.includes(k)) return map[k];
  if (/network|socket|connect|timed out/i.test(m)) return 'Cannot reach Telegram. Check your internet.';
  return 'Something went wrong: ' + m.slice(0, 120);
}

const make = (apiId, apiHash, session) => new TelegramClient(new StringSession(session || ''), Number(apiId), apiHash,
  { connectionRetries: 5, useWSS: true, deviceModel: 'Reelfinder Android', appVersion: '1.0.0' });

const withTimeout = (p, ms, code) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(code)), ms))]);

export async function restore(apiId, apiHash, session) {
  setStatus('connecting');
  try {
    creds = { apiId: Number(apiId), apiHash };
    client = make(apiId, apiHash, session);
    await withTimeout(client.connect(), 25000, 'TIMEOUT');
    const ok = await withTimeout(client.checkAuthorization(), 25000, 'TIMEOUT');
    setStatus(ok ? 'connected' : 'loggedout');
    return ok;
  } catch (e) { setStatus('error'); throw e; }
}

export async function requestCode(apiId, apiHash, phone) {
  creds = { apiId: Number(apiId), apiHash };
  client = make(apiId, apiHash, '');
  setStatus('connecting');
  try {
    await withTimeout(client.connect(), 25000, 'TIMEOUT');
    return await client.sendCode(creds, phone); // { phoneCodeHash, isCodeViaApp }
  } catch (e) { setStatus('loggedout'); throw e; }
}

export async function submitCode(phone, phoneCodeHash, code) {
  try {
    await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
  } catch (e) {
    if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') return { needPassword: true };
    throw e;
  }
  setStatus('connected');
  return { session: client.session.save() };
}

export async function submitPassword(password) {
  let last;
  try {
    await client.signInWithPassword(creds, { password: async () => password, onError: async e => { last = e; return true; } });
  } catch (e) { throw last || e; }
  setStatus('connected');
  return { session: client.session.save() };
}

export async function checkBot(username) {
  const e = await withTimeout(client.getEntity(username), 20000, 'TIMEOUT');
  if (!e.bot) throw new Error('NOT_A_BOT');
  return e;
}

const isHttp = u => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

function simplify(m) {
  rawById.set(m.id, m);
  const text = m.message || '', links = new Map();
  for (const en of m.entities || []) {
    if (en.url) links.set(en.url, en.url);
    else if (en.className === 'MessageEntityUrl') { const u = text.substr(en.offset, en.length); links.set(u, u); }
  }
  const buttons = [];
  for (const row of m.replyMarkup?.rows || []) for (const b of row.buttons || []) {
    if (b.url) links.set(b.url, b.text || b.url); else if (b.data) buttons.push({ text: b.text, data: b.data });
  }
  return { id: m.id, text, hasPhoto: !!m.photo, hasFile: !!m.media && !m.photo && m.media.className !== 'MessageMediaWebPage',
    links: [...links].filter(([u]) => isHttp(u)).map(([url, label]) => ({ url, label: label === url ? '' : label })), buttons };
}
const signature = m => [m.id, m.editDate || 0, (m.message || '').length, (m.replyMarkup?.rows || []).length].join('|');

// Send a search and keep reading the bot's answers until it is quiet.
export async function search(bot, text, onMessages, { firstTimeout = 45000, quiet = 9000, signal } = {}) {
  if (status !== 'connected') throw new Error('OFFLINE');
  const sent = await client.sendMessage(bot, { message: text });
  return collect(bot, sent.id, onMessages, { firstTimeout, quiet, signal });
}

async function collect(bot, minId, onMessages, { firstTimeout, quiet, signal }) {
  const seen = new Map(); const start = Date.now(); let last = Date.now();
  for (;;) {
    if (signal?.aborted) return;
    await sleep(1500);
    const list = (await client.getMessages(bot, { minId, limit: 30 })).filter(m => !m.out);
    let changed = false;
    for (const m of list) { const s = signature(m); if (seen.get(m.id) !== s) { seen.set(m.id, s); changed = true; } }
    if (changed) { last = Date.now(); onMessages(list.slice().reverse().map(simplify)); }
    if (!seen.size && Date.now() - start > firstTimeout) throw new Error('TIMEOUT');
    if (seen.size && Date.now() - last > quiet) return;
  }
}

export async function pressButton(bot, msgId, data, onMessages) {
  const peer = await client.getInputEntity(bot);
  try { await client.invoke(new Api.messages.GetBotCallbackAnswer({ peer, msgId, data })); } catch (e) { if (!/BOT_RESPONSE_TIMEOUT/.test(String(e?.errorMessage))) throw e; }
  return collect(bot, msgId - 1, onMessages, { firstTimeout: 20000, quiet: 6000 });
}

export async function poster(msgId) {
  const m = rawById.get(msgId); if (!m?.photo) return null;
  try { const buf = await client.downloadMedia(m, {}); return buf ? URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' })) : null; } catch { return null; }
}

export function sessionString() { return client?.session.save() || ''; }
export async function logout() {
  try { await client?.invoke(new Api.auth.LogOut()); } catch { /* ignore */ }
  try { await client?.disconnect(); } catch { /* ignore */ }
  client = null; setStatus('loggedout');
}
export async function disconnect() { try { await client?.disconnect(); } catch { /* ignore */ } }
