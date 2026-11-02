/* Garda CAD - Control room (calls, dispatch, alerts) */
const CALL_TYPES = ['Public order', 'Domestic', 'Assault', 'Burglary', 'Theft', 'Road traffic collision', 'Suspicious activity', 'Missing person', 'Drugs', 'Criminal damage', 'Welfare check', 'Other'];
const CALL_PRIORITIES = ['Emergency', 'Urgent', 'Routine'];
const prioCls = p => ({ Emergency: 'p1', Urgent: 'p2', Routine: 'p3' })[p] || 'p3';
const prioTag = p => `<span class="prio ${prioCls(p)}">${esc(p)}</span>`;
const callTime = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' }); };
const callStatus = s => `<span class="st ${s === 'Dispatched' ? 'ok' : s === 'Closed' ? '' : 'warn'}">${esc(s)}</span>`;

let ctlFilter = 'active';
let ctlSelected = null;
let ctlTimer = null;

// ---------- page ----------
function pageControl(arg) {
  if (arg && arg.open) ctlSelected = arg.open;
  content.innerHTML = `<div class="workspace ctl-wrap"><div id="ntBar">${notifyBarHtml()}</div><div class="ctl">
    <div class="ctl-left"><div class="panel"><div class="ph">Log a new call</div><div class="pb" id="callForm"></div></div></div>
    <div class="ctl-right"><div id="callDetail"></div><div class="panel"><div class="ph">Call board
      <select id="ctlFilter" class="qsel" style="margin-left:auto;padding:2px 6px">
        <option value="active">Active calls</option><option value="closed">Closed calls</option><option value="all">All calls</option></select></div>
      <div class="pb flush" id="callBoard"></div></div></div>
  </div></div>`;
  bindNotifyBar();
  $('#ctlFilter').value = ctlFilter;
  $('#ctlFilter').onchange = e => { ctlFilter = e.target.value; loadBoard(); };
  drawCallForm();
  loadBoard();
  clearInterval(ctlTimer);
  ctlTimer = setInterval(() => {
    if (!$('#callBoard')) return clearInterval(ctlTimer);
    loadBoard(true);
  }, 4000);
}

// ---------- new call form ----------
function drawCallForm(prefill) {
  const f = prefill || {};
  $('#callForm').innerHTML = `
    <div class="form" style="grid-template-columns:1fr">
      <div><label for="cfCaller">Caller</label>
        <div class="combo" style="flex:none"><input id="cfCaller" placeholder="Type a name to look them up" autocomplete="off" value="${esc(f.name || '')}"><div class="listbox hidden"></div></div>
        <div class="muted" style="font-size:12px;margin-top:2px" id="cfHint">Pick a person on record to fill in their details, or type the name of an unknown caller.</div></div>
      <div><label for="cfPhone">Contact number</label><input id="cfPhone" value="${esc(f.phone || '')}"></div>
      <div><label for="cfType">Incident type</label><select id="cfType">${opts(CALL_TYPES, f.type || 'Other')}</select></div>
      <div><label for="cfPrio">Priority</label><select id="cfPrio">${opts(CALL_PRIORITIES, f.priority || 'Urgent')}</select></div>
      <div><label for="cfAddr">Address of incident</label><input id="cfAddr" value="${esc(f.address || '')}"></div>
      <div><label for="cfDet">What happened</label><textarea id="cfDet" rows="5">${esc(f.details || '')}</textarea></div>
    </div>
    <div class="merr" id="cfErr"></div>
    <div class="bar"><button class="btn" id="cfSave">Log call</button><button class="btn plain" id="cfClear">Clear</button></div>`;
  let civ = f.civId || '';
  personCombo($('#cfCaller'), c => pickCaller(c));
  $('#cfCaller').addEventListener('input', () => { civ = ''; });
  async function pickCaller(c) {
    try {
      const full = await api('/civilians/' + c.id);
      civ = full.id;
      $('#cfCaller').value = full.fullName;
      $('#cfPhone').value = full.phone || '';
      if (!$('#cfAddr').value.trim()) $('#cfAddr').value = full.address || '';
      $('#cfHint').textContent = 'Details filled in from ' + full.fullName + '’s record. The incident address was set to their home address; change it if the incident is somewhere else.';
      $('#cfCaller').dataset.home = full.address || '';
      $('#cfType').focus();
    } catch (e) { toast(e.message, true); }
  }
  $('#cfClear').onclick = () => drawCallForm();
  $('#cfSave').onclick = async () => {
    $('#cfErr').textContent = '';
    try {
      const c = await api('/calls', { method: 'POST', body: {
        caller: { civId: civ, name: $('#cfCaller').value.trim(), phone: $('#cfPhone').value.trim(), address: $('#cfCaller').dataset.home || '' },
        type: $('#cfType').value, priority: $('#cfPrio').value, address: $('#cfAddr').value, details: $('#cfDet').value } });
      toast('Call ' + c.ref + ' logged');
      ctlSelected = c.id; ctlFilter = ctlFilter === 'closed' ? 'active' : ctlFilter;
      $('#ctlFilter').value = ctlFilter;
      drawCallForm(); loadBoard();
    } catch (e) { $('#cfErr').textContent = e.message; }
  };
}

// ---------- call board ----------
let boardCalls = [];
async function loadBoard(quiet) {
  let list;
  try { list = await api('/calls?status=' + ctlFilter); } catch (e) { if (!quiet) toast(e.message, true); return; }
  boardCalls = list;
  if (!$('#callBoard')) return;
  const sig = JSON.stringify(list.map(c => [c.id, c.status, c.units.map(u => u.username + u.ack)]));
  if (quiet && sig === loadBoard.sig) return;
  loadBoard.sig = sig;
  $('#callBoard').innerHTML = list.length ? `<table class="grid"><tr><th>Ref</th><th>Time</th><th>Priority</th><th>Type</th><th>Address</th><th>Units</th><th>Status</th></tr>
    ${list.map(c => `<tr class="click ${c.id === ctlSelected ? 'on' : ''}" data-call="${esc(c.id)}"><td style="white-space:nowrap">${esc(c.ref)}</td><td>${callTime(c.created)}</td><td>${prioTag(c.priority)}</td>
      <td>${esc(c.type)}</td><td>${esc(c.address)}</td><td>${c.units.length ? c.units.map(u => `<span class="unit ${u.ack ? 'ack' : ''}" title="${u.ack ? 'Acknowledged' : 'Not yet acknowledged'}">${esc(u.username)}</span>`).join('') : '<span class="muted">—</span>'}</td><td>${callStatus(c.status)}</td></tr>`).join('')}</table>`
    : `<div class="none">${ctlFilter === 'closed' ? 'No closed calls.' : 'No active calls. Log a call using the form on the left.'}</div>`;
  $('#callBoard').querySelectorAll('[data-call]').forEach(r => r.onclick = () => { ctlSelected = r.dataset.call; loadBoard.sig = ''; loadBoard(); });
  drawDetail();
}

// ---------- call detail + attach ----------
let officersCache = null;
async function getOfficers() { return officersCache || (officersCache = await api('/officers')); }

async function drawDetail() {
  const host = $('#callDetail'); if (!host) return;
  const call = boardCalls.find(c => c.id === ctlSelected);
  if (!call) { if (host.innerHTML) host.innerHTML = ''; return; }
  const open = call.status !== 'Closed';
  const officers = await getOfficers();
  if (!$('#callDetail') || ctlSelected !== call.id) return;
  const free = officers.filter(o => !call.units.some(u => u.username === o.username));
  const keep = host.querySelector('#atOff') ? host.querySelector('#atOff').value : '';
  host.innerHTML = `<div class="panel call-detail"><div class="ph">${esc(call.ref)} ${prioTag(call.priority)}<span class="r">${callStatus(call.status)}</span></div><div class="pb">
    <table class="kv">
      <tr><th>Incident</th><td><b>${esc(call.type)}</b></td></tr>
      <tr><th>Address</th><td>${esc(call.address)}</td></tr>
      <tr><th>What happened</th><td style="white-space:pre-wrap">${esc(call.details)}</td></tr>
      <tr><th>Caller</th><td>${call.caller.civId ? `<button class="linkbtn" id="openCaller">${esc(call.caller.name)}</button>` : esc(call.caller.name || 'Unknown')}${call.caller.phone ? ' · ' + esc(call.caller.phone) : ''}</td></tr>
      <tr><th>Logged</th><td>${fmtDT(call.created)} by ${esc(call.createdBy.rank)} ${esc(call.createdBy.name)}</td></tr>
    </table>
    <div style="font-weight:600;margin:12px 0 4px;color:var(--blue)">Units attached</div>
    ${call.units.length ? `<table class="grid"><tr><th>Officer</th><th>Attached</th><th>Acknowledged</th><th></th></tr>
      ${call.units.map(u => `<tr><td><b>${esc(u.rank)} ${esc(u.name)}</b> <span class="muted">${esc(u.username)}</span></td><td>${callTime(u.attachedAt)}</td>
        <td>${u.ack ? `<span class="st ok">Yes, ${callTime(u.ackAt)}</span>` : '<span class="st warn">Waiting</span>'}</td>
        <td style="text-align:right">${open ? `<button class="btn plain sm" data-detach="${esc(u.username)}">Remove</button>` : ''}</td></tr>`).join('')}</table>`
      : '<div class="none" style="padding:4px 0">Nobody attached yet.</div>'}
    ${open ? `<div class="bar"><select id="atOff" class="qsel" style="min-width:240px">${free.length ? free.map(o => `<option value="${esc(o.username)}">${esc(o.rank)} ${esc(o.name)} (${esc(o.username)})</option>`).join('') : '<option value="">Everyone is already attached</option>'}</select>
      <button class="btn" id="atGo" ${free.length ? '' : 'disabled'}>Attach Garda</button>
      <button class="btn plain" id="callClose" style="margin-left:auto">Close call</button></div>` : `<div class="doc-note" style="margin-top:12px"><b>Closed</b> ${fmtDT(call.closedAt)}${call.outcome ? ' — ' + esc(call.outcome) : ''}</div>`}
    <details class="call-log"><summary>Call log</summary>${call.log.map(l => `<div><span class="muted">${callTime(l.at)}</span> ${esc(l.text)}</div>`).join('')}</details>
  </div></div>`;
  if (keep && host.querySelector('#atOff')) host.querySelector('#atOff').value = keep;
  const on = (sel, fn) => { const el = host.querySelector(sel); if (el) el.onclick = fn; };
  on('#openCaller', () => go('dashboard', call.caller.civId));
  on('#atGo', async () => {
    try { await api('/calls/' + call.id + '/attach', { method: 'POST', body: { usernames: [$('#atOff').value] } }); toast('Officer attached'); loadBoard.sig = ''; loadBoard(); }
    catch (e) { toast(e.message, true); }
  });
  host.querySelectorAll('[data-detach]').forEach(b => b.onclick = async () => {
    try { await api('/calls/' + call.id + '/detach', { method: 'POST', body: { username: b.dataset.detach } }); loadBoard.sig = ''; loadBoard(); } catch (e) { toast(e.message, true); }
  });
  on('#callClose', () => modal('Close ' + call.ref, `<div class="form" style="grid-template-columns:1fr"><div><label for="clOut">Outcome (optional)</label><textarea id="clOut" rows="3" placeholder="e.g. No offence, advice given"></textarea></div></div>`,
    async m => { await api('/calls/' + call.id + '/close', { method: 'POST', body: { outcome: m.querySelector('#clOut').value } }); toast('Call closed'); loadBoard.sig = ''; loadBoard(); }, 'Close call'));
}

// =====================================================
//  Dispatch alerts: pop-up in the bottom right corner
// =====================================================
let alertTimer = null;
const shownAlerts = new Map(); // call id -> element

function ensureAlertStack() {
  let s = $('#alertStack');
  if (!s) { s = document.createElement('div'); s.id = 'alertStack'; s.setAttribute('aria-live', 'assertive'); document.body.appendChild(s); }
  return s;
}
function beep() {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    const ctx = beep.ctx || (beep.ctx = new A()); const t = ctx.currentTime;
    [[880, 0], [1175, 0.16]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.12, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.28);
      o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch (e) {}
}
function showAlert(c) {
  const el = document.createElement('div');
  el.className = 'alert-card ' + prioCls(c.priority);
  el.innerHTML = `<div class="ac-top"><div class="ac-head"><div class="ac-kind"><span class="ac-dot"></span>New call assigned</div><div class="ac-ref">${esc(c.ref)} &middot; ${callTime(c.created)}</div></div>
      <img class="ac-logo" src="logo.png?v=2" alt="Garda"></div>
    <div class="ac-title"><b>${esc(c.type)}</b>${prioTag(c.priority)}</div>
    <div class="ac-addr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span>${esc(c.address)}</span></div>
    <div class="ac-details">${esc(c.details)}</div>
    <div class="ac-actions"><button class="ac-btn main" data-ack>Acknowledge</button><button class="ac-btn" data-view>View call</button></div>`;
  ensureAlertStack().appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  el.querySelector('[data-ack]').onclick = async () => {
    try { await api('/calls/' + c.id + '/ack', { method: 'POST' }); } catch (e) { toast(e.message, true); return; }
    dismissAlert(c.id);
  };
  el.querySelector('[data-view]').onclick = () => { ctlSelected = c.id; go('control'); };
  shownAlerts.set(c.id, el);
  beep(); desktopNotify(c);
}
function dismissAlert(id) {
  const el = shownAlerts.get(id); if (!el) return;
  shownAlerts.delete(id);
  el.classList.remove('in'); el.classList.add('out');
  setTimeout(() => el.remove(), 350);
}
async function pollAlerts() {
  if (!token) return;
  let list;
  try { list = await api('/alerts'); } catch (e) { return; }
  const ids = new Set(list.map(c => c.id));
  list.forEach(c => { if (!shownAlerts.has(c.id)) showAlert(c); });
  [...shownAlerts.keys()].forEach(id => { if (!ids.has(id)) dismissAlert(id); });
  updateTitleFlash();
}

// ---- when the CAD is in another tab or window: desktop notification + flashing tab title
const BASE_TITLE = document.title;
let flashTimer = null, flashOn = false;
function awayFromCad() { return document.hidden || !document.hasFocus(); }
function askNotifyPermission() {
  if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) {} }
}
let swReg = null;
function registerSW() {
  if (!('serviceWorker' in navigator) || swReg) return;
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
}
async function showDesktop(title, body, tag) {
  const opts = { body, icon: 'logo.png?v=2', badge: 'logo.png?v=2', tag, requireInteraction: true, renotify: true };
  try {
    const reg = swReg || (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) return await reg.showNotification(title, opts);
  } catch (e) {}
  const n = new Notification(title, opts); n.onclick = () => { window.focus(); n.close(); };
}
function desktopNotify(c) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !awayFromCad()) return;
  showDesktop('New call: ' + c.type + ' (' + c.priority + ')', c.address + '\n' + c.details, 'call-' + c.id).catch(() => {});
}
function notifyBarHtml() {
  if (!('Notification' in window)) return '<div class="alert amber">This browser cannot show desktop notifications.</div>';
  const p = Notification.permission;
  if (p === 'granted') return `<div class="alert clear" style="justify-content:space-between"><span>Desktop alerts are on. You will get a Windows notification when a call is assigned to you and the CAD is in the background.</span><button class="btn plain sm" id="ntTest">Send test alert</button></div>`;
  if (p === 'denied') return '<div class="alert">Desktop alerts are blocked. Click the padlock or settings icon next to the address (or the site settings in the browser), set Notifications to Allow, then reload.</div>';
  return `<div class="alert amber" style="justify-content:space-between"><span>Desktop alerts are off. Enable them to be told about new calls while you are in another window, e.g. Roblox.</span><button class="btn sm" id="ntOn">Enable desktop alerts</button></div>`;
}
function bindNotifyBar() {
  const on = $('#ntOn'), test = $('#ntTest');
  if (on) on.onclick = async () => { try { await Notification.requestPermission(); } catch (e) {} registerSW(); $('#ntBar').innerHTML = notifyBarHtml(); bindNotifyBar(); };
  if (test) test.onclick = () => {
    toast('Test sent. Switch to your other window within 5 seconds to see it.');
    setTimeout(() => showDesktop('Garda CAD test alert', 'Desktop alerts are working.', 'cad-test').catch(e => toast('Could not show it: ' + e.message, true)), 5000);
  };
}
function updateTitleFlash() {
  const pending = shownAlerts.size;
  if (pending && awayFromCad()) {
    if (!flashTimer) flashTimer = setInterval(() => {
      flashOn = !flashOn; document.title = flashOn ? '(' + shownAlerts.size + ') NEW CALL' : BASE_TITLE;
    }, 900);
  } else { clearInterval(flashTimer); flashTimer = null; document.title = BASE_TITLE; }
}
document.addEventListener('visibilitychange', updateTitleFlash);
window.addEventListener('focus', updateTitleFlash);
window.addEventListener('blur', updateTitleFlash);
document.addEventListener('click', askNotifyPermission, { once: true });

// ---- live push so alerts arrive instantly even when this tab is in the background
let alertStream = null;
function openStream() {
  closeStream();
  return; // Worker version: alerts arrive by polling (keeps Cloudflare usage low)
}
function closeStream() { if (alertStream) { alertStream.close(); alertStream = null; } }

function startAlerts() { stopAlerts(); askNotifyPermission(); registerSW(); pollAlerts(); openStream(); alertTimer = setInterval(pollAlerts, 4000); }
function stopAlerts() {
  closeStream(); clearInterval(flashTimer); flashTimer = null; document.title = BASE_TITLE;
  clearInterval(alertTimer); alertTimer = null; clearInterval(ctlTimer);
  [...shownAlerts.keys()].forEach(id => { const el = shownAlerts.get(id); if (el) el.remove(); }); shownAlerts.clear();
  officersCache = null;
}
