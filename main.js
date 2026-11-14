import './style.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Network } from '@capacitor/network';
import { secure, prefs } from './secure.js';
import * as tg from './tg.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { connected: 'Connected', connecting: 'Connecting…', loggedout: 'Not connected', error: 'Connection problem', offline: 'Offline' };
let online = true, bot = prefs.get('rf_bot'), history = prefs.getJSON('rf_history', []), busy = false, loginCtx = {};

/* ---------- small helpers ---------- */
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3200); }
function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === id));
}
const open = id => { $(id).hidden = false; }, close = id => { $(id).hidden = true; };
const anyOverlay = () => ['consent', 'login'].find(id => !$(id).hidden);

function applyTheme() {
  const t = prefs.get('rf_theme', 'dark');
  const real = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = real;
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
}
function renderStatus() {
  const s = online ? tg.getStatus() : 'offline';
  $('statusChip').dataset.s = s; $('statusText').textContent = STATUS[s]; $('setStatus').textContent = STATUS[s] + (bot ? ` · @${bot}` : '');
  $('offline').hidden = online;
}
function renderRecent() {
  $('recent').innerHTML = history.map(h => `<button data-q="${esc(h)}">${esc(h)}</button>`).join('');
  $('recentEmpty').hidden = history.length > 0;
}
tg.setStatusListener(renderStatus);

/* ---------- search + results ---------- */
function threadEmpty() { $('thread').innerHTML = '<div class="empty"><b>No results yet</b>Search for a movie to see what your bot sends back.</div>'; }
function cardHTML(m, i) {
  const lines = m.text.split('\n').map(s => s.replace(/https?:\/\/\S+/g, '').replace(/[*_`]/g, '').trim()).filter(Boolean);
  const title = lines.shift() || (m.hasFile ? 'File from the bot' : 'Reply');
  const body = lines.join('\n');
  const links = m.links.map((l, k) => { let h = ''; try { h = new URL(l.url).hostname.replace(/^www\./, ''); } catch {} return `<button class="lk" data-url="${esc(l.url)}"><span>${esc(l.label || 'Open link ' + (k + 1))}</span><small>${esc(h)}</small></button>`; }).join('');
  const cbs = m.buttons.map((b, k) => `<button class="cb" data-mid="${m.id}" data-k="${k}">${esc(b.text)}</button>`).join('');
  return `<article class="card" data-id="${m.id}" style="--i:${i}">${m.hasPhoto ? '<img alt="" hidden>' : ''}<div class="in"><h4>${esc(title)}</h4>${body ? `<p>${esc(body)}</p>` : ''}${m.hasFile && !m.text ? '<p>This app cannot open files yet.</p>' : ''}${links ? `<div class="links">${links}</div>` : ''}${cbs ? `<div class="row">${cbs}</div>` : ''}</div></article>`;
}
const buttonStore = new Map();
function paint(box, msgs) {
  box.innerHTML = msgs.map(cardHTML).join('');
  msgs.forEach(m => { buttonStore.set(m.id, m.buttons); if (m.hasPhoto) tg.poster(m.id).then(u => { const img = box.querySelector(`[data-id="${m.id}"] img`); if (u && img) { img.src = u; img.hidden = false; } }); });
}

async function runSearch(text) {
  text = text.trim().replace(/\s+/g, ' ');
  if (!text || busy) return;
  if (!bot) { toast('Set your bot username in Settings.'); show('v-settings'); return; }
  if (!online) { toast('You are offline.'); return; }
  if (tg.getStatus() !== 'connected') { toast('Not connected to Telegram.'); if (tg.getStatus() === 'loggedout') open('login'); return; }
  busy = true;
  history = [text, ...history.filter(h => h.toLowerCase() !== text.toLowerCase())].slice(0, 12);
  prefs.set('rf_history', JSON.stringify(history)); renderRecent();
  $('homeQ').value = $('chatQ').value = ''; show('v-chat');
  const th = $('thread'); th.querySelector('.empty')?.remove();
  const q = document.createElement('div'); q.className = 'q'; q.textContent = text;
  const res = document.createElement('div'); res.className = 'stack'; res.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  th.append(q, res); th.parentElement.scrollTop = th.parentElement.scrollHeight;
  try {
    await tg.search(bot, text, msgs => { paint(res, msgs); });
    if (!res.querySelector('.card')) res.innerHTML = '<div class="empty"><b>No answer</b>The bot sent nothing back.</div>';
  } catch (e) {
    const had = res.querySelector('.card');
    if (!had) res.innerHTML = '';
    res.insertAdjacentHTML('beforeend', `<div class="block"><p class="err">${esc(tg.friendly(e))}</p><button class="btn" data-retry="${esc(text)}">Try again</button></div>`);
  }
  busy = false; th.parentElement.scrollTop = th.parentElement.scrollHeight;
}

/* ---------- login ---------- */
async function saveLogin(session) {
  await secure.set('tg_session', session); await secure.set('tg_api_id', loginCtx.apiId); await secure.set('tg_api_hash', loginCtx.apiHash);
  prefs.set('rf_bot', bot); close('login'); renderStatus(); toast('Connected to Telegram.'); $('botInput').value = bot;
}
function loginStep(step) { ['stepCreds', 'stepCode', 'stepPass'].forEach(s => $(s).hidden = s !== step); $('loginBtn').textContent = step === 'stepCreds' ? 'Send code' : 'Continue'; loginCtx.step = step; $('loginErr').textContent = ''; }
async function loginNext() {
  const err = m => { $('loginErr').textContent = m; }; $('loginBtn').disabled = true;
  try {
    if (loginCtx.step === 'stepCreds') {
      const apiId = $('apiId').value.trim(), apiHash = $('apiHash').value.trim(), phone = $('phone').value.replace(/[\s()-]/g, ''), b = $('loginBot').value.trim().replace(/^@/, '');
      if (!tg.validApiId(apiId)) return err('API ID must be numbers only.');
      if (!tg.validApiHash(apiHash)) return err('API hash must be 32 letters and numbers.');
      if (!tg.validPhone(phone)) return err('Phone must start with + and country code.');
      if (!tg.validBot(b)) return err('Bot username must end with "bot".');
      if (!online) return err('You are offline.');
      Object.assign(loginCtx, { apiId, apiHash, phone }); bot = b;
      const r = await tg.requestCode(apiId, apiHash, phone); loginCtx.hash = r.phoneCodeHash; loginStep('stepCode');
    } else if (loginCtx.step === 'stepCode') {
      const code = $('code').value.trim(); if (!/^\d{4,8}$/.test(code)) return err('Enter the code from Telegram.');
      const r = await tg.submitCode(loginCtx.phone, loginCtx.hash, code);
      if (r.needPassword) loginStep('stepPass'); else await saveLogin(r.session);
    } else {
      const pw = $('pass').value; if (!pw) return err('Enter your password.');
      await saveLogin((await tg.submitPassword(pw)).session);
    }
  } catch (e) { err(tg.friendly(e)); } finally { $('loginBtn').disabled = false; }
}

/* ---------- start-up ---------- */
async function connectSaved() {
  const [id, hash, sess] = await Promise.all([secure.get('tg_api_id'), secure.get('tg_api_hash'), secure.get('tg_session')]);
  if (!id || !hash || !sess) { loginStep('stepCreds'); open('login'); renderStatus(); return; }
  try { if (!(await tg.restore(id, hash, sess))) { loginStep('stepCreds'); open('login'); } }
  catch (e) { toast(tg.friendly(e)); }
}
async function logoutNow() {
  await tg.logout(); await Promise.all(['tg_session', 'tg_api_id', 'tg_api_hash'].map(k => secure.remove(k)));
  loginStep('stepCreds'); open('login'); renderStatus();
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.url) Browser.open({ url: t.dataset.url }).catch(() => toast('Cannot open this link.'));
  else if (t.dataset.q) runSearch(t.dataset.q);
  else if (t.dataset.retry) { t.closest('.block').remove(); runSearch(t.dataset.retry); }
  else if (t.dataset.mid) {
    const id = Number(t.dataset.mid), b = buttonStore.get(id)?.[Number(t.dataset.k)]; if (!b || busy) return;
    busy = true; t.disabled = true; const box = t.closest('.stack');
    try { await tg.pressButton(bot, id, b.data, msgs => paint(box, msgs)); } catch (er) { toast(tg.friendly(er)); }
    busy = false;
  }
});
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.v); };
$('statusChip').onclick = () => { if (tg.getStatus() === 'loggedout') open('login'); else if (['error'].includes(tg.getStatus())) connectSaved(); };
$('homeForm').onsubmit = e => { e.preventDefault(); runSearch($('homeQ').value); };
$('chatForm').onsubmit = e => { e.preventDefault(); runSearch($('chatQ').value); };
$('newSearch').onclick = () => { show('v-home'); $('homeQ').focus(); };
$('consentOk').onclick = () => { prefs.set('rf_ack', '1'); close('consent'); connectSaved(); };
$('loginBtn').onclick = loginNext;
$('helpLink').onclick = () => Browser.open({ url: 'https://my.telegram.org' });
$('reconnect').onclick = connectSaved;
$('logout').onclick = () => { if (confirm('Log out and delete the saved Telegram session?')) logoutNow(); };
$('clearHistory').onclick = () => { history = []; prefs.set('rf_history', '[]'); renderRecent(); threadEmpty(); toast('History cleared.'); };
$('themeSeg').onclick = e => { const b = e.target.closest('button'); if (b) { prefs.set('rf_theme', b.dataset.t); applyTheme(); } };
$('saveBot').onclick = async () => {
  const b = $('botInput').value.trim().replace(/^@/, ''), er = $('botErr'); er.textContent = '';
  if (!tg.validBot(b)) { er.textContent = 'Bot username must end with "bot".'; return; }
  if (tg.getStatus() !== 'connected') { er.textContent = 'Connect to Telegram first.'; return; }
  try { await tg.checkBot(b); bot = b; prefs.set('rf_bot', b); renderStatus(); toast('Bot saved.'); } catch (e) { er.textContent = tg.friendly(e); }
};
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);
CapApp.addListener('backButton', () => {
  const o = anyOverlay(); if (o === 'login' && loginCtx.step !== 'stepCreds') return loginStep('stepCreds');
  if ($('v-home').classList.contains('on')) CapApp.exitApp(); else show('v-home');
});
Network.addListener('networkStatusChange', s => { const was = online; online = s.connected; renderStatus(); if (online && !was && tg.getStatus() !== 'loggedout') connectSaved(); });

(async function init() {
  applyTheme(); renderRecent(); threadEmpty(); $('botInput').value = bot; loginStep('stepCreds');
  try { online = (await Network.getStatus()).connected; } catch { online = navigator.onLine; }
  renderStatus();
  if (Capacitor.isNativePlatform() === false) console.info('Running in a browser: secure storage falls back to web storage.');
  if (prefs.get('rf_ack') !== '1') open('consent'); else connectSaved();
})();
