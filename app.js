/* Garda CAD - front end */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const fmtDate = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString('en-IE', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const dlDate = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? d : String(x.getDate()).padStart(2, '0') + '.' + String(x.getMonth() + 1).padStart(2, '0') + '.' + String(x.getFullYear()).slice(2); };
const pid = id => 'P' + String(parseInt(String(id).slice(0, 7), 16) % 10000000).padStart(7, '0');
const content = $('#content');
let token = sessionStorage.getItem('cadToken') || '';
let me = null;
let recent = JSON.parse(sessionStorage.getItem('cadRecent') || '[]');

const ICON_WARN = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 1 21h22L12 2zm1 15h-2v2h2v-2zm0-7h-2v5h2v-5z"/></svg>';
const COUNTY = { C: 'CORCAIGH', CE: 'AN CLÁR', CN: 'AN CABHÁN', CW: 'CEATHARLACH', D: 'BAILE ÁTHA CLIATH', DL: 'DÚN NA NGALL', G: 'GAILLIMH', KE: 'CILL DARA', KK: 'CILL CHAINNIGH', KY: 'CIARRAÍ', L: 'LUIMNEACH', LD: 'AN LONGFORT', LH: 'LÚ', LM: 'LIATROIM', LS: 'LAOIS', MH: 'AN MHÍ', MN: 'MUINEACHÁN', MO: 'MAIGH EO', OY: 'UÍBH FHAILÍ', RN: 'ROS COMÁIN', SO: 'SLIGEACH', T: 'TIOBRAID ÁRANN', W: 'PORT LÁIRGE', WH: 'AN IARMHÍ', WX: 'LOCH GARMAN', WW: 'CILL MHANTÁIN' };

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { logout(true); throw new Error('Your session ended. Log in again.'); }
  if (!res.ok) throw new Error(data.error || 'The server did not accept that request (HTTP ' + res.status + '). If this is the login page, the request is not reaching the CAD server; check the proxy or Cloudflare setup.');
  return data;
}
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
}
function avatarHtml(src, name, cls = 'avatar') {
  return src ? `<img class="${cls}" src="${esc(src)}" alt="">` : `<div class="${cls}">${esc(initials(name))}</div>`;
}
function readImage(file, max = 420) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject; img.src = r.result;
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}
function pickImage() {
  return new Promise(resolve => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async () => resolve(i.files[0] ? await readImage(i.files[0]) : null);
    i.click();
  });
}

// ---------- Clock ----------
function tick() {
  const n = new Date();
  const s = n.toLocaleDateString('en-IE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) + '  ' + n.toLocaleTimeString('en-IE');
  if ($('#sbClock')) $('#sbClock').textContent = s;
  if ($('#loginClock')) $('#loginClock').textContent = s;
}
setInterval(tick, 1000); tick();

// ---------- Login / logout ----------
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try {
    const r = await api('/login', { method: 'POST', body: { username: $('#lu').value, password: $('#lp').value } });
    token = r.token; sessionStorage.setItem('cadToken', token); me = r.user;
    enterApp();
  } catch (err) { $('#loginErr').textContent = err.message; $('#lp').select(); }
});
async function logout(silent) {
  if (typeof stopAlerts === 'function') stopAlerts();
  if (!silent) try { await api('/logout', { method: 'POST' }); } catch (e) {}
  token = ''; me = null; sessionStorage.removeItem('cadToken');
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  $('#lp').value = ''; $('#lu').focus();
}
function enterApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderOfficer(); go('dashboard'); startAlerts();
}
function renderOfficer() {
  $('#officer').innerHTML = `<div><div>${esc(me.rank)} ${esc(me.name)}</div><div class="rank">${esc(me.username)}${me.badge ? ', badge ' + esc(me.badge) : ''}</div></div>${avatarHtml(me.avatar, me.name)}`;
  $('#sbUser').textContent = 'Logged in: ' + me.username + (me.isAdmin ? ' (administrator)' : '');
  api('/civilians').then(l => { $('#sbCount').textContent = l.length + ' person records'; }).catch(() => {});
}

// ---------- Navigation ----------
const PAGES = { dashboard: 'Person enquiry', vehicles: 'Vehicle and licence enquiry', reports: 'Reports', control: 'Control', settings: 'Settings' };
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
function go(page, arg) {
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#pageName').textContent = PAGES[page];
  content.scrollTop = 0;
  ({ dashboard: pageDashboard, vehicles: pageVehicles, reports: pageReports, control: pageControl, settings: pageSettings })[page](arg);
}
function pageBlank() { content.innerHTML = ''; }

// ---------- Query bar with dropdown ----------
function queryBar(el, label, placeholder, fetcher, renderOpt, onPick) {
  el.innerHTML = `<div class="querybar"><label class="qlabel" for="q">${esc(label)}</label>
    <div class="combo"><input id="q" placeholder="${esc(placeholder)}" autocomplete="off" role="combobox"><div class="listbox hidden" role="listbox"></div></div>
    <button class="btn" id="qGo">Search</button></div>`;
  const input = el.querySelector('input'), lb = el.querySelector('.listbox');
  let items = [], sel = -1, timer, seq = 0;
  const close = () => { lb.classList.add('hidden'); sel = -1; };
  const draw = () => {
    if (!input.value.trim()) return close();
    lb.innerHTML = items.length ? items.map((it, i) => `<div class="opt ${i === sel ? 'sel' : ''}" data-i="${i}" role="option">${renderOpt(it)}</div>`).join('')
      : `<div class="opt none">No records match “${esc(input.value.trim())}”. Check the spelling or search by surname.</div>`;
    lb.classList.remove('hidden');
  };
  const run = async () => { const q = input.value.trim(); if (!q) return close(); const my = ++seq; const r = await fetcher(q); if (my !== seq) return; items = r; sel = -1; draw(); };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 140); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items.length && !lb.classList.contains('hidden')) pick(items[Math.max(sel, 0)]); else run(); }
    else if (e.key === 'Escape') close();
  });
  el.querySelector('#qGo').onclick = async () => { await run(); if (items.length === 1) pick(items[0]); };
  lb.addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); pick(items[+d.dataset.i]); } });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('focus', () => { if (items.length) draw(); });
  function pick(it) { close(); input.value = ''; items = []; onPick(it); }
  input.focus();
}

// ---------- Shared bits ----------
function status(v) {
  const s = String(v || '—');
  const cls = /^(valid|clear|current|n\/a)$/i.test(s) ? 'ok' : /expired|none|disqual|revoked|seize|stolen|wanted|suspend/i.test(s) ? 'bad' : 'warn';
  return `<span class="st ${cls}">${esc(s)}</span>`;
}
function plate(reg, big) {
  const parts = String(reg || '').toUpperCase().split('-');
  const county = COUNTY[parts[1]] || '';
  return `<span class="plate${big ? ' lg' : ''}"><span class="s"><i></i>IRL</span><span class="t"><span class="c">${esc(county)}</span><span class="r">${esc(String(reg || '').toUpperCase())}</span></span></span>`;
}
function meter(p) {
  p = Math.max(0, Math.min(12, Number(p) || 0));
  return `<div class="meter ${p >= 12 ? 'hi' : p >= 7 ? '' : 'lo'}" title="${p} of 12 penalty points">${Array.from({ length: 12 }, (_, i) => `<i class="${i < p ? 'on' : ''}"></i>`).join('')}</div>`;
}
function licenceCard(c) {
  const L = c.licence || {};
  if (!L.number) return '<div class="none">No driving licence held.</div>';
  return `<div class="dl" title="Double-click to open the full licence record">
    <div class="eu"><i></i>IRL</div>
    <div class="hd"><b>CEADÚNAS TIOMÁNA</b><span>DRIVING LICENCE · ÉIRE / IRELAND</span></div>
    ${c.photo ? `<img class="ph" src="${esc(c.photo)}" alt="">` : '<div class="ph">No photo</div>'}
    <div class="f">
      <div><em>1.</em><b>${esc(String(c.lastName).toUpperCase())}</b></div>
      <div><em>2.</em><b>${esc(String(c.firstName).toUpperCase())}</b></div>
      <div><em>3.</em>${dlDate(c.dob)} ÉIRE</div>
      <div><em>4a.</em>${dlDate(L.issued)} <em style="margin-left:6px">4b.</em>${dlDate(L.expiry)}</div>
      <div><em>4c.</em>RSA</div>
      <div><em>5.</em><b>${esc(L.number)}</b></div>
    </div>
    <div class="sig">${esc(c.firstName)} ${esc(c.lastName)}</div>
    <div class="cat">9. ${esc(L.class || '—')}</div>
  </div>`;
}
function onDoubleTap(el, fn) {
  el.addEventListener('dblclick', fn);
  let last = 0;
  el.addEventListener('touchend', e => { const n = Date.now(); if (n - last < 350) { e.preventDefault(); fn(); } last = n; });
}
function warnings(flags) {
  return flags.length
    ? `<div class="alert${flags.some(f => /wanted|violent|armed|weapon|danger|firearm|escape/i.test(f)) ? '' : ' amber'}">${ICON_WARN}<span>${flags.map(esc).join('. ')}</span></div>`
    : '<div class="alert clear">No warning markers on this person.</div>';
}
function remember(c) {
  recent = [{ id: c.id, name: c.fullName, dob: c.dob, at: Date.now() }, ...recent.filter(r => r.id !== c.id)].slice(0, 10);
  sessionStorage.setItem('cadRecent', JSON.stringify(recent));
}

// ---------- Person enquiry ----------
function pageDashboard(civId) {
  content.innerHTML = '<div id="qb"></div><div class="workspace" id="ws"></div>';
  queryBar($('#qb'), 'Name', 'Forename or surname, e.g. Sandra',
    q => api('/civilians?q=' + encodeURIComponent(q)),
    c => `${avatarHtml(c.photo, c.fullName)}<div><div class="n">${esc(c.fullName)}</div><div class="d">Born ${fmtDate(c.dob)}, age ${c.age ?? '—'}</div></div><div class="w">${c.flags.length ? esc(c.flags[0]) : ''}</div>`,
    c => showProfile(c.id));
  if (civId) showProfile(civId); else showRecent();
}
function showRecent() {
  $('#ws').innerHTML = `<div class="panel"><div class="ph">Your recent enquiries</div><div class="pb flush">
    ${recent.length ? `<table class="grid"><tr><th>Name</th><th>Date of birth</th><th>Viewed</th></tr>
      ${recent.map(r => `<tr class="click" data-id="${esc(r.id)}"><td>${esc(r.name)}</td><td>${fmtDate(r.dob)}</td><td>${new Date(r.at).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}</table>`
      : '<div class="none">No enquiries yet this session. Type a name in the box above to find a person.</div>'}
  </div></div>`;
  $('#ws').querySelectorAll('[data-id]').forEach(r => r.onclick = () => showProfile(r.dataset.id));
}

async function showProfile(id) {
  const ws = $('#ws');
  let c; try { c = await api('/civilians/' + id); } catch (e) { ws.innerHTML = `<div class="none">${esc(e.message)}</div>`; return; }
  remember(c);
  ws.innerHTML = `
  ${warnings(c.flags)}
  <div class="panel"><div class="ph">Person record<span class="r">${pid(c.id)} <button class="btn plain sm" data-act="markers">Warning markers</button> <button class="btn sm" data-act="report">New report</button></span></div><div class="pb">
    <div class="person">
      <div class="mug">${c.photo ? `<img class="img" src="${esc(c.photo)}" alt="">` : '<div class="img">No photograph</div>'}<div class="cap">${pid(c.id)}</div></div>
      <table class="kv">
        <tr><th>Surname</th><td><b>${esc(String(c.lastName).toUpperCase())}</b></td><th>Forename</th><td>${esc(c.firstName)}</td></tr>
        <tr><th>Date of birth</th><td>${fmtDate(c.dob)}</td><th>Age</th><td>${c.age ?? '—'}</td></tr>
        <tr><th>Gender</th><td>${esc(c.gender || '—')}</td><th>Height</th><td>${esc(c.height || '—')}</td></tr>
        <tr><th>Address</th><td colspan="3">${esc(c.address || '—')}</td></tr>
        <tr><th>Phone</th><td colspan="3">${esc(c.phone || '—')}</td></tr>
        <tr><th>Description</th><td colspan="3">${esc(c.description || '—')}</td></tr>
      </table>
    </div>
  </div></div>

  <div class="split">
    <div class="panel"><div class="ph">Driving licence<span class="r">${c.licence.number ? status(c.licence.status) + ' <button class="btn plain sm" data-act="points">Add penalty points</button>' : ''}</span></div><div class="pb">
      ${licenceCard(c)}
      ${c.licence.number ? `<div class="dl-hint">Double-click the licence to open the full licence record.</div>` : ''}
    </div></div>
    <div class="panel"><div class="ph">Vehicles<span class="r">${c.vehicles.length} registered <button class="btn plain sm" data-act="vehicle">Register vehicle</button></span></div><div class="pb flush">
      ${c.vehicles.length ? `<table class="grid"><tr><th>Registration</th><th>Vehicle</th><th>Status</th></tr>${c.vehicles.map(v => `<tr class="click" data-v="${esc(v.id)}"><td>${plate(v.reg)}</td><td>${esc(v.colour)} ${esc(v.make)} ${esc(v.model)}, ${esc(v.year)}</td><td>${status(v.status)}</td></tr>`).join('')}</table>` : '<div class="none">No vehicles registered to this person.</div>'}
    </div></div>
  </div>

  <div class="panel"><div class="ph">Convictions and cautions<span class="r">${c.offences.length} on record <button class="btn plain sm" data-act="conviction">Add conviction</button></span></div><div class="pb flush">
    ${c.offences.length ? `<table class="grid"><tr><th style="width:110px">Date</th><th>Offence</th><th>Outcome</th><th>Recorded by</th></tr>${c.offences.map(o => `<tr><td>${fmtDate(o.date)}</td><td>${esc(o.offence)}</td><td>${esc(o.outcome)}</td><td class="muted">${esc(o.by || '')}</td></tr>`).join('')}</table>` : '<div class="none">No previous convictions or cautions.</div>'}
  </div></div>
  <div class="panel"><div class="ph">Reports<span class="r" id="repCount"></span></div><div class="pb flush" id="repList"><div class="none">Loading…</div></div></div>`;
  loadPersonReports(c);
  bindRecordActions(ws, c, () => showProfile(c.id));
  const dl = ws.querySelector('.dl');
  if (dl) onDoubleTap(dl, () => go('vehicles', { licenceOf: c.id }));
  ws.querySelectorAll('[data-v]').forEach(r => r.onclick = () => go('vehicles', { licenceOf: c.id, veh: r.dataset.v }));
}

// ---------- Vehicle and licence enquiry ----------
function pageVehicles(arg) {
  content.innerHTML = '<div id="qb"></div><div class="workspace" id="ws"></div>';
  queryBar($('#qb'), 'Registration, name or licence no.', 'e.g. 191-D-12345',
    async q => {
      const [veh, ppl] = await Promise.all([api('/vehicles?q=' + encodeURIComponent(q)), api('/civilians?q=' + encodeURIComponent(q))]);
      return [...veh.map(v => ({ kind: 'veh', ...v })), ...ppl.map(p => ({ kind: 'lic', ...p }))];
    },
    it => it.kind === 'veh'
      ? `<div></div><div><div class="n">${esc(it.reg)}</div><div class="d">${esc(it.colour)} ${esc(it.make)} ${esc(it.model)}, owner ${esc(it.owner)}</div></div><div class="w">${/clear/i.test(it.status) ? '' : esc(it.status)}</div>`
      : `${avatarHtml(it.photo, it.fullName)}<div><div class="n">${esc(it.fullName)}</div><div class="d">Licence record, born ${fmtDate(it.dob)}</div></div><div></div>`,
    it => it.kind === 'veh' ? showLicence(it.ownerId, it.id) : showLicence(it.id));
  if (arg && arg.licenceOf) showLicence(arg.licenceOf, arg.veh);
  else $('#ws').innerHTML = '<div class="none">Enter a registration plate, a person’s name or a licence number above.</div>';
}
async function showLicence(civId, vehId) {
  const ws = $('#ws');
  let c; try { c = await api('/civilians/' + civId); } catch (e) { ws.innerHTML = `<div class="none">${esc(e.message)}</div>`; return; }
  const L = c.licence || { offences: [] };
  const v = vehId && c.vehicles.find(x => x.id === vehId);
  ws.innerHTML = `
  ${c.flags.length ? warnings(c.flags) : ''}
  ${v ? `<div class="panel"><div class="ph">Vehicle record<span class="r"><button class="btn plain sm" data-act="vupdate" data-vid="${esc(v.id)}">Update vehicle status</button></span></div><div class="pb">
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      <div>${plate(v.reg, true)}</div>
      <table class="kv" style="flex:1;min-width:300px">
        <tr><th>Make and model</th><td>${esc(v.make)} ${esc(v.model)}</td><th>Colour</th><td>${esc(v.colour)}</td></tr>
        <tr><th>Year</th><td>${esc(v.year)}</td><th>Vehicle status</th><td>${status(v.status)}</td></tr>
        <tr><th>Motor tax</th><td>${status(v.tax)}</td><th>Insurance</th><td>${status(v.insurance)}</td></tr>
        <tr><th>NCT</th><td>${status(v.nct)}</td><th>Registered owner</th><td><button class="linkbtn" data-open>${esc(c.fullName)}</button></td></tr>
      </table>
    </div></div></div>` : ''}

  <div class="panel"><div class="ph">Driving licence record<span class="r">${L.number ? '<button class="btn sm" data-act="points">Add penalty points</button> <button class="btn plain sm" data-act="lstatus">Change licence status</button> ' : ''}<button class="btn plain sm" data-open>Open person record</button></span></div><div class="pb">
    ${L.number ? `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      ${licenceCard(c)}
      <table class="kv" style="flex:1;min-width:280px">
        <tr><th>Holder</th><td>${esc(c.fullName)}</td></tr>
        <tr><th>Licence no.</th><td><b>${esc(L.number)}</b></td></tr>
        <tr><th>Status</th><td>${status(L.status)}</td></tr>
        <tr><th>Categories</th><td>${esc(L.class || '—')}</td></tr>
        <tr><th>Issued / expires</th><td>${fmtDate(L.issued)} to ${fmtDate(L.expiry)}</td></tr>
        <tr><th>Penalty points</th><td><div style="display:flex;align-items:center;gap:10px">${meter(L.points)}<b>${L.points} / 12</b></div>${L.points >= 12 ? '<div class="st bad" style="margin-top:4px">12 points reached: disqualified for 6 months</div>' : ''}</td></tr>
      </table></div>` : `<div class="none">${esc(c.fullName)} holds no driving licence.</div>`}
  </div></div>

  <div class="split">
    <div class="panel"><div class="ph">Vehicles owned<span class="r">${c.vehicles.length}</span></div><div class="pb flush">
      ${c.vehicles.length ? `<table class="grid"><tr><th>Registration</th><th>Vehicle</th><th>Tax</th><th>Insurance</th><th>NCT</th></tr>
      ${c.vehicles.map(x => `<tr class="click ${x.id === vehId ? 'on' : ''}" data-v="${esc(x.id)}"><td>${plate(x.reg)}</td><td>${esc(x.colour)} ${esc(x.make)} ${esc(x.model)}</td><td>${status(x.tax)}</td><td>${status(x.insurance)}</td><td>${status(x.nct)}</td></tr>`).join('')}</table>` : '<div class="none">No vehicles registered.</div>'}
    </div></div>
    <div class="panel"><div class="ph">Road traffic offences<span class="r">${(L.offences || []).length}</span></div><div class="pb flush">
      ${L.offences && L.offences.length ? `<table class="grid"><tr><th>Date</th><th>Offence</th><th>Points</th><th>Penalty</th>${me.isAdmin ? '<th></th>' : ''}</tr>${L.offences.map((o, i) => `<tr title="${esc(o.by ? 'Issued by ' + o.by : '')}"><td>${fmtDate(o.date)}</td><td>${esc(o.offence)}</td><td>${o.points}</td><td>${esc(o.fine)}</td>${me.isAdmin ? `<td style="text-align:right"><button class="btn plain sm" data-act="rmpts" data-i="${i}">Remove</button></td>` : ''}</tr>`).join('')}</table>` : '<div class="none">No road traffic offences recorded.</div>'}
    </div></div>
  </div>`;
  ws.querySelectorAll('[data-open]').forEach(b => b.onclick = () => go('dashboard', c.id));
  ws.querySelectorAll('[data-v]').forEach(r => r.onclick = () => showLicence(civId, r.dataset.v));
  bindRecordActions(ws, c, () => showLicence(civId, vehId));
}

// ---------- Modal dialog ----------
function modal(title, html, onOk, okLabel = 'Save') {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="ph">${esc(title)}</div><div class="pb">${html}<div class="merr"></div>
    <div class="bar"><button class="btn" data-ok>${esc(okLabel)}</button><button class="btn plain" data-cancel>Cancel</button></div></div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('[data-cancel]').onclick = close;
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  back.querySelector('[data-ok]').onclick = async () => {
    try { await onOk(back); close(); } catch (e) { back.querySelector('.merr').textContent = e.message; }
  };
  const first = back.querySelector('input,select,textarea'); (first || back.querySelector('[data-ok]')).focus();
  return back;
}
const act = (c, body) => api('/civilians/' + c.id + '/action', { method: 'POST', body });
const opts = (list, val) => list.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('');
const PRESETS = [
  ['Speeding', 3, '€160'], ['Holding or using a mobile phone while driving', 3, '€120'], ['Driver not wearing a seatbelt', 3, '€120'],
  ['Failing to stop at a red traffic light', 3, '€120'], ['Failing to stop at a stop sign', 3, '€80'], ['Careless driving', 5, '€120'],
  ['Dangerous overtaking', 3, '€120'], ['No NCT certificate', 3, '€60'], ['Driving without insurance', 5, 'Court summons'],
  ['Driving on a hard shoulder', 1, '€60'], ['Learner driving unaccompanied', 2, '€120'], ['Failing to display L plates', 2, '€120']
];
const VSTATUS = ['Clear', 'Stolen', 'Seize on sight', 'Of interest', 'Seized', 'Written off'];
function pointsForm(prefix) {
  return `<div class="form">
    <div class="full"><label for="${prefix}Pre">Offence</label><select id="${prefix}Pre"><option value="">Choose an offence…</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])} (${p[1]} pts, ${esc(p[2])})</option>`).join('')}<option value="custom">Other offence…</option></select></div>
    <div class="full"><label for="${prefix}Off">Offence wording</label><input id="${prefix}Off"></div>
    <div><label for="${prefix}Pts">Penalty points</label><input id="${prefix}Pts" type="number" min="0" max="12" value="0"></div>
    <div><label for="${prefix}Fine">Fine or penalty</label><input id="${prefix}Fine"></div>
  </div>`;
}
function bindPointsForm(root, prefix) {
  root.querySelector('#' + prefix + 'Pre').onchange = e => {
    const p = PRESETS[e.target.value]; if (!p) return;
    root.querySelector('#' + prefix + 'Off').value = p[0]; root.querySelector('#' + prefix + 'Pts').value = p[1]; root.querySelector('#' + prefix + 'Fine').value = p[2];
  };
}

function bindRecordActions(ws, c, refresh) {
  const done = msg => { toast(msg); refresh(); };
  const on = (name, fn) => ws.querySelectorAll(`[data-act="${name}"]`).forEach(b => b.onclick = () => fn(b));
  on('points', () => {
    const m = modal('Add penalty points for ' + c.fullName, `<p style="margin:0 0 10px">Current total: <b>${c.licence.points} / 12</b>. Reaching 12 disqualifies the driver automatically.</p>
      ${pointsForm('pp')}<div class="form" style="margin-top:8px"><div><label for="ppDate">Date</label><input id="ppDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div></div>`,
      async r => { await act(c, { type: 'points', offence: r.querySelector('#ppOff').value, points: r.querySelector('#ppPts').value, fine: r.querySelector('#ppFine').value, date: r.querySelector('#ppDate').value }); done('Penalty points added'); }, 'Add points');
    bindPointsForm(m, 'pp');
  });
  on('rmpts', b => {
    if (confirm('Remove this road traffic offence and its points?')) act(c, { type: 'removePoints', index: b.dataset.i }).then(() => done('Offence removed')).catch(e => toast(e.message, true));
  });
  on('lstatus', () => modal('Licence status', `<div class="form"><div><label for="lsS">Status</label><select id="lsS">${opts(['Valid', 'Expired', 'Suspended', 'Disqualified', 'Learner Permit', 'Revoked'], c.licence.status)}</select></div></div>`,
    async r => { await act(c, { type: 'licenceStatus', status: r.querySelector('#lsS').value }); done('Licence status changed'); }));
  on('conviction', () => modal('Add conviction or caution for ' + c.fullName, `<div class="form">
      <div><label for="cvD">Date</label><input id="cvD" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="full"><label for="cvO">Offence</label><input id="cvO" placeholder="e.g. Theft (s.4 Criminal Justice (Theft and Fraud Offences) Act 2001)"></div>
      <div class="full"><label for="cvR">Outcome</label><input id="cvR" list="outcomes" placeholder="e.g. Fine €500"><datalist id="outcomes"><option>Adult caution</option><option>Fine</option><option>Community service</option><option>Suspended sentence</option><option>Custodial sentence</option><option>Charged, awaiting court</option></datalist></div></div>`,
    async r => { await act(c, { type: 'conviction', date: r.querySelector('#cvD').value, offence: r.querySelector('#cvO').value, outcome: r.querySelector('#cvR').value }); done('Conviction added'); }, 'Add to record'));
  on('markers', () => {
    const m = modal('Warning markers for ' + c.fullName, `<div id="mkList">${c.flags.length ? c.flags.map(f => `<div class="mkrow"><span>${esc(f)}</span><button class="btn plain sm" data-rmflag="${esc(f)}">Remove</button></div>`).join('') : '<div class="none" style="padding:0 0 8px">No markers on this person.</div>'}</div>
      <div class="form"><div class="full"><label for="mkN">Add a marker</label><input id="mkN" list="mkl" placeholder="e.g. Caution: violent"><datalist id="mkl"><option>Wanted</option><option>Caution: violent</option><option>Caution: carries weapons</option><option>Known to Gardaí</option><option>Missing person</option><option>Bail conditions</option><option>Drug user</option><option>Mental health</option></datalist></div></div>`,
      async r => { const f = r.querySelector('#mkN').value.trim(); if (f) await act(c, { type: 'flagAdd', flag: f }); done('Markers updated'); }, 'Done');
    m.querySelectorAll('[data-rmflag]').forEach(b => b.onclick = async () => { await act(c, { type: 'flagRemove', flag: b.dataset.rmflag }); b.parentElement.remove(); c.flags = c.flags.filter(f => f !== b.dataset.rmflag); refresh(); });
  });
  on('vehicle', () => modal('Register a vehicle to ' + c.fullName, `<div class="form">
      <div><label for="vR">Registration</label><input id="vR" placeholder="e.g. 241-D-1234"></div><div><label for="vMk">Make</label><input id="vMk"></div><div><label for="vMd">Model</label><input id="vMd"></div>
      <div><label for="vC">Colour</label><input id="vC"></div><div><label for="vY">Year</label><input id="vY"></div>
      <div><label for="vT">Motor tax</label><select id="vT">${opts(['Valid', 'Expired'])}</select></div><div><label for="vI">Insurance</label><select id="vI">${opts(['Valid', 'None', 'Expired'])}</select></div><div><label for="vN">NCT</label><select id="vN">${opts(['Valid', 'Expired', 'N/A'])}</select></div></div>`,
    async r => { const g = id => r.querySelector('#' + id).value; await act(c, { type: 'vehicleAdd', reg: g('vR'), make: g('vMk'), model: g('vMd'), colour: g('vC'), year: g('vY'), tax: g('vT'), insurance: g('vI'), nct: g('vN') }); done('Vehicle registered'); }, 'Register vehicle'));
  on('vupdate', b => {
    const v = c.vehicles.find(x => x.id === b.dataset.vid);
    modal('Update ' + v.reg, `<div class="form"><div><label for="uS">Vehicle status</label><select id="uS">${opts(VSTATUS, v.status)}</select></div>
      <div><label for="uT">Motor tax</label><select id="uT">${opts(['Valid', 'Expired'], v.tax)}</select></div><div><label for="uI">Insurance</label><select id="uI">${opts(['Valid', 'None', 'Expired'], v.insurance)}</select></div><div><label for="uN">NCT</label><select id="uN">${opts(['Valid', 'Expired', 'N/A'], v.nct)}</select></div></div>`,
      async r => { const g = id => r.querySelector('#' + id).value; await act(c, { type: 'vehicleUpdate', vehicleId: v.id, status: g('uS'), tax: g('uT'), insurance: g('uI'), nct: g('uN') }); done('Vehicle updated'); });
  });
  on('report', () => go('reports', { newFor: c.id }));
}
async function loadPersonReports(c) {
  const list = await api('/reports?civ=' + c.id).catch(() => []);
  if (!$('#repList')) return;
  $('#repCount').textContent = list.length + ' linked';
  $('#repList').innerHTML = list.length ? `<table class="grid"><tr><th>Reference</th><th>Type</th><th>Title</th><th>Officer</th><th>Date</th><th>Status</th></tr>
    ${list.map(r => `<tr class="click" data-rep="${esc(r.id)}"><td>${esc(r.ref)}</td><td>${esc(r.typeName)}</td><td>${esc(r.title)}</td><td>${esc(r.officer.name)}</td><td>${fmtDate(r.created)}</td><td>${repStatus(r.status)}</td></tr>`).join('')}</table>`
    : '<div class="none">No reports mention this person.</div>';
  $('#repList').querySelectorAll('[data-rep]').forEach(t => t.onclick = () => go('reports', { open: t.dataset.rep }));
}

// ---------- Settings ----------
function pageSettings(tab) {
  tab = tab || 'profile';
  const tabs = [['profile', 'My account']];
  if (me.isAdmin) tabs.push(['accounts', 'Garda accounts'], ['civilians', 'Civilian records']);
  content.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div class="workspace" id="ws"></div>`;
  content.querySelectorAll('.tab').forEach(b => b.onclick = () => pageSettings(b.dataset.t));
  ({ profile: settingsProfile, accounts: settingsAccounts, civilians: settingsCivilians })[tab]();
}
function settingsProfile() {
  $('#ws').innerHTML = `
  <div class="panel"><div class="ph">Profile picture</div><div class="pb">
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      ${avatarHtml(me.avatar, me.name, 'big-av')}
      <div><div style="font-size:15px;font-weight:600">${esc(me.rank)} ${esc(me.name)}</div><div style="color:var(--muted)">${esc(me.username)}${me.badge ? ', badge ' + esc(me.badge) : ''}</div>
      <div class="bar"><button class="btn" id="chAv">Change picture</button>${me.avatar ? '<button class="btn plain" id="rmAv">Remove picture</button>' : ''}</div></div>
    </div></div></div>
  <div class="panel"><div class="ph">Password</div><div class="pb">
    <div class="form" style="max-width:520px"><div><label for="cp">Current password</label><input type="password" id="cp"></div><div><label for="np">New password</label><input type="password" id="np"></div></div>
    <div class="bar"><button class="btn" id="savePw">Change password</button></div></div></div>
  <div class="panel"><div class="ph">Session</div><div class="pb"><button class="btn danger" id="logoutBtn">Log out</button></div></div>`;
  $('#chAv').onclick = async () => { const img = await pickImage(); if (!img) return; me = await api('/me', { method: 'PUT', body: { avatar: img } }); renderOfficer(); settingsProfile(); toast('Picture changed'); };
  if ($('#rmAv')) $('#rmAv').onclick = async () => { me = await api('/me', { method: 'PUT', body: { avatar: '' } }); renderOfficer(); settingsProfile(); toast('Picture removed'); };
  $('#savePw').onclick = async () => {
    try { await api('/me', { method: 'PUT', body: { currentPassword: $('#cp').value, newPassword: $('#np').value } }); toast('Password changed'); $('#cp').value = $('#np').value = ''; }
    catch (e) { toast(e.message, true); }
  };
  $('#logoutBtn').onclick = () => logout();
}

async function settingsAccounts() {
  const users = await api('/users');
  $('#ws').innerHTML = `
  <div class="panel"><div class="ph">Create Garda account</div><div class="pb">
    <div class="form">
      <div><label for="nu">User ID</label><input id="nu" placeholder="GARDA-5678"></div>
      <div><label for="npw">Password</label><input id="npw"></div>
      <div><label for="nn">Name</label><input id="nn" placeholder="J. Byrne"></div>
      <div><label for="nr">Rank</label><select id="nr">${['Garda', 'Sergeant', 'Inspector', 'Superintendent', 'Chief Superintendent', 'Assistant Commissioner', 'Commissioner', 'Reserve Garda'].map(r => `<option>${r}</option>`).join('')}</select></div>
      <div><label for="nb">Badge no.</label><input id="nb"></div>
      <div style="display:flex;align-items:flex-end"><label class="check"><input type="checkbox" id="na"> Administrator</label></div>
    </div>
    <div class="bar"><button class="btn" id="createU">Create account</button></div></div></div>
  <div class="panel"><div class="ph">Accounts<span class="r">${users.length}</span></div><div class="pb flush">
    <table class="grid"><tr><th></th><th>User ID</th><th>Name</th><th>Rank</th><th>Badge</th><th>Access</th><th></th></tr>
    ${users.map(u => `<tr><td style="width:44px">${avatarHtml(u.avatar, u.name)}</td><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td><td>${esc(u.rank)}</td><td>${esc(u.badge)}</td><td>${u.isAdmin ? 'Administrator' : 'Standard'}</td>
      <td style="white-space:nowrap;text-align:right">${u.username !== 'GARDA-1234' ? `<button class="btn plain sm" data-reset="${esc(u.username)}">Reset password</button> ${u.username !== me.username ? `<button class="btn danger sm" data-del="${esc(u.username)}">Delete</button>` : ''}` : ''}</td></tr>`).join('')}
    </table></div></div>`;
  $('#createU').onclick = async () => {
    try {
      await api('/users', { method: 'POST', body: { username: $('#nu').value, password: $('#npw').value, name: $('#nn').value, rank: $('#nr').value, badge: $('#nb').value, isAdmin: $('#na').checked } });
      toast('Account created'); settingsAccounts();
    } catch (e) { toast(e.message, true); }
  };
  $('#ws').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete account ' + b.dataset.del + '? They will be logged out immediately.')) return;
    try { await api('/users/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); toast('Account deleted'); settingsAccounts(); } catch (e) { toast(e.message, true); }
  });
  $('#ws').querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const pw = prompt('New password for ' + b.dataset.reset + ':'); if (!pw) return;
    await api('/users/' + encodeURIComponent(b.dataset.reset), { method: 'PUT', body: { password: pw } }); toast('Password reset');
  });
}

async function settingsCivilians() {
  const list = await api('/civilians');
  $('#ws').innerHTML = `
  <div class="panel"><div class="ph">Civilian records<span class="r"><button class="btn sm" id="newCiv">New civilian</button></span></div><div class="pb flush">
    <table class="grid"><tr><th></th><th>Record</th><th>Name</th><th>Date of birth</th><th>Warnings</th><th></th></tr>
    ${list.map(c => `<tr><td style="width:44px">${avatarHtml(c.photo, c.fullName)}</td><td>${pid(c.id)}</td><td><b>${esc(c.fullName)}</b></td><td>${fmtDate(c.dob)}</td><td class="st bad">${c.flags.map(esc).join(', ')}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn plain sm" data-edit="${c.id}">Edit</button> <button class="btn danger sm" data-delc="${c.id}">Delete</button></td></tr>`).join('')}
    </table></div></div><div id="civEditor"></div>`;
  $('#newCiv').onclick = () => civEditor(null);
  $('#ws').querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => civEditor(await api('/civilians/' + b.dataset.edit)));
  $('#ws').querySelectorAll('[data-delc]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this civilian record? This cannot be undone.')) return;
    await api('/civilians/' + b.dataset.delc, { method: 'DELETE' }); toast('Record deleted'); settingsCivilians(); renderOfficer();
  });
}

function civEditor(c) {
  const isNew = !c;
  c = c || { firstName: '', lastName: '', dob: '', gender: '', height: '', address: '', phone: '', description: '', photo: '', flags: [], offences: [], vehicles: [],
    licence: { number: '', class: 'B', status: 'Valid', issued: '', expiry: '', points: 0, offences: [] } };
  const st = { photo: c.photo, offences: [...c.offences], lOff: [...(c.licence.offences || [])], vehicles: [...c.vehicles] };
  const ed = $('#civEditor');
  const inp = (id, label, val, type = 'text', cls = '') => `<div class="${cls}"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val)}"></div>`;
  function rows(key, cols) {
    return `<div class="rows">${st[key].map((r, i) => `<div class="row" style="grid-template-columns:${cols.map(c => c[2] || '1fr').join(' ')} auto">
      ${cols.map(([f, ph, , t]) => `<input data-k="${key}" data-i="${i}" data-f="${f}" type="${t || 'text'}" placeholder="${ph}" aria-label="${ph}" value="${esc(r[f])}">`).join('')}
      <button class="btn plain sm" data-rm="${key}" data-i="${i}" title="Remove row">Remove</button></div>`).join('') || '<div class="none" style="padding:4px 0">None.</div>'}</div>`;
  }
  const offCols = [['date', 'Date', '140px', 'date'], ['offence', 'Offence'], ['outcome', 'Outcome or sentence']];
  const lOffCols = [['date', 'Date', '140px', 'date'], ['offence', 'Offence'], ['points', 'Points', '70px', 'number'], ['fine', 'Penalty', '140px']];
  const vehCols = [['reg', 'Registration', '120px'], ['make', 'Make'], ['model', 'Model'], ['colour', 'Colour', '90px'], ['year', 'Year', '70px'], ['tax', 'Tax', '80px'], ['insurance', 'Insurance', '90px'], ['nct', 'NCT', '80px'], ['status', 'Status', '120px']];
  const section = (title, add, body) => `<div class="panel"><div class="ph">${title}${add ? `<span class="r"><button class="btn plain sm" data-add="${add}">Add row</button></span>` : ''}</div><div class="pb">${body}</div></div>`;

  function draw() {
    ed.innerHTML = `<h3 style="color:var(--blue);margin:18px 0 10px;font-size:15px">${isNew ? 'New civilian record' : 'Editing ' + esc(c.firstName + ' ' + c.lastName) + ', ' + pid(c.id)}</h3>
    ${section('Personal details', '', `<div style="display:flex;gap:16px;flex-wrap:wrap">
      <div class="mug">${st.photo ? `<img class="img" src="${esc(st.photo)}" alt="">` : '<div class="img">No photograph</div>'}
        <div class="bar"><button class="btn plain sm" id="cPhoto">Upload photo</button>${st.photo ? '<button class="btn plain sm" id="cPhotoRm">Remove</button>' : ''}</div></div>
      <div class="form" style="flex:1">
        ${inp('cFirst', 'Forename', c.firstName)}${inp('cLast', 'Surname', c.lastName)}${inp('cDob', 'Date of birth', c.dob, 'date')}
        <div><label for="cGender">Gender</label><select id="cGender">${['', 'Male', 'Female', 'Other'].map(g => `<option ${g === c.gender ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        ${inp('cHeight', 'Height', c.height)}${inp('cPhone', 'Phone', c.phone)}
        ${inp('cAddr', 'Address', c.address, 'text', 'full')}
        <div class="full"><label for="cDesc">Description</label><textarea id="cDesc" rows="2">${esc(c.description)}</textarea></div>
        ${inp('cFlags', 'Warning markers, separated by commas', c.flags.join(', '), 'text', 'full')}
      </div></div>`)}
    ${section('Convictions and cautions', 'offences', rows('offences', offCols))}
    ${section('Driving licence', '', `<div class="form">${inp('lNum', 'Licence no. (leave blank if none)', c.licence.number)}${inp('lClass', 'Categories', c.licence.class)}
      <div><label for="lStatus">Status</label><select id="lStatus">${['Valid', 'Expired', 'Suspended', 'Disqualified', 'Learner Permit', 'Revoked'].map(s => `<option ${s === c.licence.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      ${inp('lPts', 'Penalty points', c.licence.points, 'number')}${inp('lIss', 'Issued', c.licence.issued, 'date')}${inp('lExp', 'Expires', c.licence.expiry, 'date')}</div>`)}
    ${section('Road traffic offences', 'lOff', rows('lOff', lOffCols))}
    ${section('Vehicles', 'vehicles', `<div style="overflow-x:auto"><div style="min-width:900px">${rows('vehicles', vehCols)}</div></div>`)}
    <div class="bar" style="margin-bottom:20px"><button class="btn" id="cSave">${isNew ? 'Create record' : 'Save record'}</button><button class="btn plain" id="cCancel">Cancel</button></div>`;
    bind();
  }
  function capture() {
    ['firstName:cFirst', 'lastName:cLast', 'dob:cDob', 'gender:cGender', 'height:cHeight', 'phone:cPhone', 'address:cAddr', 'description:cDesc'].forEach(p => { const [k, id] = p.split(':'); c[k] = $('#' + id).value; });
    c.flags = $('#cFlags').value.split(',').map(s => s.trim()).filter(Boolean);
    c.licence = { number: $('#lNum').value, class: $('#lClass').value, status: $('#lStatus').value, points: +$('#lPts').value || 0, issued: $('#lIss').value, expiry: $('#lExp').value };
    ed.querySelectorAll('[data-k]').forEach(i => { st[i.dataset.k][+i.dataset.i] = Object.assign({}, st[i.dataset.k][+i.dataset.i], { [i.dataset.f]: i.value }); });
  }
  function bind() {
    $('#cPhoto').onclick = async () => { capture(); const img = await pickImage(); if (img) { st.photo = img; draw(); } };
    if ($('#cPhotoRm')) $('#cPhotoRm').onclick = () => { capture(); st.photo = ''; draw(); };
    ed.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { capture(); st[b.dataset.add].push({}); draw(); });
    ed.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { capture(); st[b.dataset.rm].splice(+b.dataset.i, 1); draw(); });
    $('#cCancel').onclick = () => { ed.innerHTML = ''; };
    $('#cSave').onclick = async () => {
      capture();
      const payload = Object.assign({}, c, { photo: st.photo, offences: st.offences, vehicles: st.vehicles, licence: Object.assign({}, c.licence, { offences: st.lOff }) });
      try {
        if (isNew) await api('/civilians', { method: 'POST', body: payload });
        else await api('/civilians/' + c.id, { method: 'PUT', body: payload });
        toast(isNew ? 'Record created' : 'Record saved'); settingsCivilians(); renderOfficer();
      } catch (e) { toast(e.message, true); }
    };
  }
  draw();
  ed.scrollIntoView({ behavior: 'smooth' });
}

// ---------- Boot ----------
(async () => {
  if (token) { try { me = await api('/me'); enterApp(); return; } catch (e) {} }
  $('#lu').focus();
})();
