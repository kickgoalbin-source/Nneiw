// Garda CAD - Cloudflare Worker
// Static files (public/) are served by Workers Assets. All /api/* calls run in ONE Durable Object
// ("Cad") so the data is always consistent. Data is stored in the Durable Object's SQLite storage.

const enc = new TextEncoder();
const ITER = 10000; // PBKDF2 rounds (kept low so a log-in fits the Worker CPU limit)

function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
const uid = () => randHex(6);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function safeEq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function hash(pw, salt, iter) {
  salt = salt || randHex(16); iter = iter || ITER;
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iter }, key, 256);
  return 'p1$' + iter + '$' + salt + '$' + hex(bits);
}
async function verify(pw, stored) {
  const p = String(stored).split('$');
  if (p[0] !== 'p1') return false;
  return safeEq(await hash(pw, p[2], parseInt(p[1], 10)), String(stored));
}

// ---------- storage (Durable Object SQLite) ----------
let SQL = null, db = null, lastChunks = [];
const sessions = new Map(); // token -> username
const fails = new Map();    // ip -> { n, until }
const CHUNK = 400000;

async function seed() {
  return {
    users: [
      { username: 'GARDA-1234', password: await hash('2245'), name: 'Administrator', rank: 'Superintendent', badge: '1234', isAdmin: true, avatar: '' }
    ],
    civilians: [
      {
        id: uid(), firstName: 'Sandra', lastName: 'Murphy', dob: '1991-04-12', gender: 'Female', height: '168 cm',
        address: '14 Ashgrove Park, Tallaght, Dublin 24', phone: '087 123 4567',
        description: 'Slim build, shoulder-length brown hair, green eyes. Small tattoo on left wrist.',
        photo: '', flags: ['Known to Gardaí'],
        offences: [
          { date: '2023-06-02', offence: 'Shoplifting (Theft Act 2001 s.4)', outcome: 'Fine €300' },
          { date: '2025-01-19', offence: 'Public Order Offence', outcome: 'Adult Caution' }
        ],
        licence: { number: 'D1234567', class: 'B', status: 'Valid', issued: '2012-05-01', expiry: '2032-05-01', points: 4,
          offences: [
            { date: '2024-03-11', offence: 'Speeding 80 in 60 zone', points: 3, fine: '€160' },
            { date: '2025-08-02', offence: 'Mobile phone use while driving', points: 3, fine: '€120' }
          ] },
        vehicles: [ { id: uid(), reg: '191-D-12345', make: 'Volkswagen', model: 'Golf', colour: 'Grey', year: '2019', tax: 'Valid', insurance: 'Valid', nct: 'Valid', status: 'Clear' } ]
      },
      {
        id: uid(), firstName: 'Sean', lastName: "O'Brien", dob: '1985-11-30', gender: 'Male', height: '183 cm',
        address: '2 Main Street, Naas, Co. Kildare', phone: '086 555 0101',
        description: 'Heavy build, shaved head, beard. Scar above right eyebrow.',
        photo: '', flags: ['Wanted - Bench Warrant', 'Caution: Violent'],
        offences: [
          { date: '2019-09-14', offence: 'Assault Causing Harm', outcome: '18 months (suspended)' },
          { date: '2022-02-08', offence: 'Possession of Controlled Drugs (s.3)', outcome: 'Fine €1,000' }
        ],
        licence: { number: 'D7654321', class: 'B, C1', status: 'Disqualified', issued: '2004-01-10', expiry: '2029-01-10', points: 12,
          offences: [ { date: '2023-07-21', offence: 'Drink driving', points: 0, fine: 'Disqualified 2 years' } ] },
        vehicles: [ { id: uid(), reg: '08-KE-4411', make: 'Ford', model: 'Transit', colour: 'White', year: '2008', tax: 'Expired', insurance: 'None', nct: 'Expired', status: 'Seize on sight' } ]
      },
      {
        id: uid(), firstName: 'Aoife', lastName: 'Kelly', dob: '2000-07-03', gender: 'Female', height: '162 cm',
        address: 'Apt 5, Riverside Court, Galway', phone: '085 222 3344',
        description: 'Red curly hair, glasses.', photo: '', flags: [], offences: [],
        licence: { number: 'G1122334', class: 'B', status: 'Valid', issued: '2019-09-01', expiry: '2029-09-01', points: 0, offences: [] },
        vehicles: [ { id: uid(), reg: '231-G-998', make: 'Toyota', model: 'Yaris', colour: 'Red', year: '2023', tax: 'Valid', insurance: 'Valid', nct: 'N/A', status: 'Clear' } ]
      }
    ]
  };
}

async function load() {
  SQL.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
  const rows = SQL.exec("SELECT v FROM kv WHERE k LIKE 'db:%' ORDER BY k").toArray();
  if (rows.length) { lastChunks = rows.map(r => r.v); db = JSON.parse(lastChunks.join('')); }
  else { db = await seed(); save(); }
  db.reports = db.reports || []; db.calls = db.calls || []; db.counters = db.counters || {};
  if (!db.users.find(u => u.username === 'GARDA-1234')) { db.users.unshift((await seed()).users[0]); save(); }
  try {
    const r = SQL.exec("SELECT v FROM kv WHERE k = 'sessions'").toArray();
    if (r.length) Object.entries(JSON.parse(r[0].v)).forEach(([k, v]) => sessions.set(k, v));
  } catch (e) {}
}
function save() {
  const s = JSON.stringify(db), chunks = [];
  for (let i = 0; i < s.length;) {
    let end = Math.min(s.length, i + CHUNK);
    const c = s.charCodeAt(end - 1);
    if (end < s.length && c >= 0xD800 && c <= 0xDBFF) end--; // never split a surrogate pair
    chunks.push(s.slice(i, end)); i = end;
  }
  chunks.forEach((c, i) => { if (lastChunks[i] !== c) SQL.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', 'db:' + String(i).padStart(4, '0'), c); });
  if (chunks.length < lastChunks.length) SQL.exec("DELETE FROM kv WHERE k LIKE 'db:%' AND k > ?", 'db:' + String(chunks.length - 1).padStart(4, '0'));
  lastChunks = chunks;
}
function saveSessions() {
  while (sessions.size > 500) sessions.delete(sessions.keys().next().value);
  SQL.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', 'sessions', JSON.stringify(Object.fromEntries(sessions)));
}

// ---------- helpers ----------
function clientIp(req) { return String(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim(); }
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
function send(res, code, obj) {
  return new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function body(req) {
  if (parseInt(req.headers.get('content-length') || '0', 10) > 15e6) throw httpErr(413, 'That upload is too large (15 MB max).');
  const txt = await req.text();
  if (txt.length > 15e6) throw httpErr(413, 'That upload is too large (15 MB max).');
  try { return txt ? JSON.parse(txt) : {}; } catch (e) { throw httpErr(400, 'Bad request data.'); }
}
function auth(req) {
  let t = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!t) { try { t = new URL(req.url).searchParams.get('token') || ''; } catch (e) {} }
  const name = t ? sessions.get(t) : null;
  return name ? db.users.find(u => u.username === name) : null;
}
const publicUser = u => ({ username: u.username, name: u.name, rank: u.rank, badge: u.badge, isAdmin: !!u.isAdmin, avatar: u.avatar || '' });
const fullName = c => (c.firstName + ' ' + c.lastName).trim();
function age(dob) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}
const withAge = c => Object.assign({}, c, { fullName: fullName(c), age: age(c.dob) });

function cleanCivilian(b, existing) {
  const c = existing || { id: uid() };
  const str = v => (v == null ? '' : String(v)).slice(0, 2000);
  ['firstName', 'lastName', 'dob', 'gender', 'height', 'address', 'phone', 'description'].forEach(k => { if (k in b) c[k] = str(b[k]); });
  if ('photo' in b) c.photo = str(b.photo).startsWith('data:image') ? String(b.photo) : '';
  if (Array.isArray(b.flags)) c.flags = b.flags.map(str).filter(Boolean);
  if (Array.isArray(b.offences)) c.offences = b.offences.map(o => ({ date: str(o.date), offence: str(o.offence), outcome: str(o.outcome), by: str(o.by) }));
  if (b.licence) {
    const l = b.licence;
    c.licence = { number: str(l.number), class: str(l.class), status: str(l.status), issued: str(l.issued), expiry: str(l.expiry),
      points: Number(l.points) || 0,
      offences: Array.isArray(l.offences) ? l.offences.map(o => ({ date: str(o.date), offence: str(o.offence), points: Number(o.points) || 0, fine: str(o.fine), by: str(o.by) })) : [] };
  }
  if (Array.isArray(b.vehicles)) c.vehicles = b.vehicles.map(v => ({ id: v.id || uid(), reg: str(v.reg).toUpperCase(), make: str(v.make), model: str(v.model),
    colour: str(v.colour), year: str(v.year), tax: str(v.tax), insurance: str(v.insurance), nct: str(v.nct), status: str(v.status) }));
  c.flags = c.flags || []; c.offences = c.offences || []; c.vehicles = c.vehicles || [];
  c.licence = c.licence || { number: '', class: '', status: 'None', issued: '', expiry: '', points: 0, offences: [] };
  return c;
}


// ---------- officer actions ----------
const today = () => new Date().toISOString().slice(0, 10);
const byLine = u => (u.rank + ' ' + u.name + ' (' + u.username + ')').trim();
function applyAction(c, b, me) {
  const str = v => (v == null ? '' : String(v)).trim().slice(0, 2000);
  const L = c.licence = c.licence || { number: '', class: '', status: 'None', issued: '', expiry: '', points: 0, offences: [] };
  L.offences = L.offences || [];
  switch (b.type) {
    case 'points': {
      if (!L.number) return { error: 'This person holds no driving licence, so points cannot be added.' };
      const pts = Math.max(0, Math.min(12, parseInt(b.points, 10) || 0));
      if (!str(b.offence)) return { error: 'Enter the offence.' };
      L.offences.push({ date: str(b.date) || today(), offence: str(b.offence), points: pts, fine: str(b.fine), by: byLine(me) });
      L.points = (Number(L.points) || 0) + pts;
      if (L.points >= 12 && !/disqual|revoked/i.test(L.status)) L.status = 'Disqualified';
      return {};
    }
    case 'removePoints': {
      const i = Number(b.index); const o = L.offences[i];
      if (!o) return { error: 'That entry no longer exists.' };
      if (!me.isAdmin) return { error: 'Only an administrator can remove road traffic offences.' };
      L.offences.splice(i, 1); L.points = Math.max(0, (Number(L.points) || 0) - (Number(o.points) || 0));
      return {};
    }
    case 'licenceStatus':
      if (!L.number) return { error: 'This person holds no driving licence.' };
      L.status = str(b.status) || L.status; return {};
    case 'conviction':
      if (!str(b.offence)) return { error: 'Enter the offence.' };
      c.offences.push({ date: str(b.date) || today(), offence: str(b.offence), outcome: str(b.outcome), by: byLine(me) });
      return {};
    case 'flagAdd':
      if (!str(b.flag)) return { error: 'Enter the marker text.' };
      if (!c.flags.includes(str(b.flag))) c.flags.push(str(b.flag)); return {};
    case 'flagRemove':
      c.flags = c.flags.filter(f => f !== b.flag); return {};
    case 'vehicleUpdate': {
      const v = c.vehicles.find(x => x.id === b.vehicleId);
      if (!v) return { error: 'That vehicle is no longer registered to this person.' };
      ['status', 'tax', 'insurance', 'nct'].forEach(k => { if (k in b) v[k] = str(b[k]); });
      return {};
    }
    case 'vehicleAdd': {
      const reg = str(b.reg).toUpperCase();
      if (!reg) return { error: 'Enter the registration.' };
      if (db.civilians.some(x => x.vehicles.some(v => v.reg.replace(/[\s-]/g, '') === reg.replace(/[\s-]/g, '')))) return { error: reg + ' is already registered to someone.' };
      c.vehicles.push({ id: uid(), reg, make: str(b.make), model: str(b.model), colour: str(b.colour), year: str(b.year), tax: str(b.tax) || 'Valid', insurance: str(b.insurance) || 'Valid', nct: str(b.nct) || 'Valid', status: 'Clear' });
      return {};
    }
  }
  return { error: 'Unknown action.' };
}

// ---------- reports ----------
const REPORT_TYPES = { arrest: ['Arrest report', 'AR'], incident: ['Incident report', 'IR'], traffic: ['Road traffic report', 'RT'], collision: ['Collision report', 'CR'], statement: ['Witness statement', 'WS'], search: ['Search report', 'SR'] };
function cleanReport(b, existing, me) {
  const str = (v, n) => (v == null ? '' : String(v)).slice(0, n || 20000);
  if (!existing && !REPORT_TYPES[b.type]) return { error: 'Choose a report type.' };
  const r = existing || { id: uid(), type: b.type, created: new Date().toISOString(), officer: { username: me.username, name: me.name, rank: me.rank, badge: me.badge }, effectsApplied: false };
  if (!existing) {
    const [name, code] = REPORT_TYPES[r.type];
    const yr = new Date().getFullYear();
    db.counters[code + yr] = (db.counters[code + yr] || 0) + 1;
    r.ref = code + '/' + yr + '/' + String(db.counters[code + yr]).padStart(5, '0');
    r.typeName = name;
  }
  r.title = str(b.title, 200) || r.title || '';
  if (!r.title) return { error: 'Give the report a title.' };
  r.status = b.status === 'Submitted' ? 'Submitted' : (existing && existing.status === 'Submitted' ? 'Submitted' : 'Draft');
  r.fields = {}; Object.keys(b.fields || {}).slice(0, 40).forEach(k => { r.fields[str(k, 40)] = str(b.fields[k]); });
  r.narrative = str(b.narrative);
  r.addCharges = !!b.addCharges;
  r.points = b.points ? { offence: str(b.points.offence, 300), points: parseInt(b.points.points, 10) || 0, fine: str(b.points.fine, 100) } : null;
  // snapshot of the person and vehicle at the time of writing
  if ('civId' in b) {
    const c = db.civilians.find(x => x.id === b.civId);
    r.civId = c ? c.id : '';
    r.subject = c ? { fullName: fullName(c), firstName: c.firstName, lastName: c.lastName, dob: c.dob, age: age(c.dob), gender: c.gender, height: c.height, address: c.address, phone: c.phone,
      description: c.description, photo: c.photo, flags: c.flags.slice(), licence: { number: c.licence.number, status: c.licence.status, class: c.licence.class, points: c.licence.points }, convictions: c.offences.length } : null;
    const v = c && c.vehicles.find(x => x.id === b.vehicleId);
    r.vehicle = v ? Object.assign({}, v) : null;
  }
  r.updated = new Date().toISOString();
  r.updatedBy = me.username;
  return r;
}
function applyReportEffects(r, me) {
  if (r.effectsApplied) return;
  r.effectsApplied = true;
  const c = db.civilians.find(x => x.id === r.civId);
  if (!c) return;
  if (r.type === 'arrest' && r.addCharges && r.fields.offences) {
    const d = (r.fields.when || '').slice(0, 10) || today();
    r.fields.offences.split(/\n|;/).map(s => s.trim()).filter(Boolean).forEach(o =>
      c.offences.push({ date: d, offence: o, outcome: 'Arrested, charge pending (' + r.ref + ')', by: byLine(me) }));
  }
  if (r.type === 'traffic' && r.points && r.points.offence) {
    applyAction(c, { type: 'points', date: (r.fields.when || '').slice(0, 10), offence: r.points.offence + ' (' + r.ref + ')', points: r.points.points, fine: r.points.fine }, me);
  }
}


// ---------- control room: calls ----------
const CALL_PRIORITIES = ['Emergency', 'Urgent', 'Routine'];
function cleanCall(b, existing, me) {
  const str = (v, n) => (v == null ? '' : String(v)).trim().slice(0, n || 4000);
  const c = existing || { id: uid(), created: new Date().toISOString(), createdBy: { username: me.username, name: me.name, rank: me.rank }, status: 'Pending', units: [], log: [] };
  if (!existing) {
    const yr = new Date().getFullYear();
    db.counters['CAD' + yr] = (db.counters['CAD' + yr] || 0) + 1;
    c.ref = 'CAD/' + yr + '/' + String(db.counters['CAD' + yr]).padStart(5, '0');
  }
  const caller = b.caller || {};
  c.caller = { civId: str(caller.civId, 40), name: str(caller.name, 200), phone: str(caller.phone, 60), address: str(caller.address, 400) };
  c.type = str(b.type, 80) || 'Other';
  c.priority = CALL_PRIORITIES.includes(b.priority) ? b.priority : 'Urgent';
  c.address = str(b.address, 400);
  c.details = str(b.details);
  if (!c.address) return { error: 'Enter the address of the incident.' };
  if (!c.details) return { error: 'Enter what happened.' };
  return c;
}
function callLog(c, me, text) { c.log.push({ at: new Date().toISOString(), by: me ? me.username : 'SYSTEM', text }); }
const callOpen = c => c.status !== 'Closed';
function callSummary(c) {
  return { id: c.id, ref: c.ref, type: c.type, priority: c.priority, address: c.address, details: c.details,
    caller: c.caller.name, created: c.created, status: c.status, units: c.units.map(u => u.username) };
}

async function api(req, res, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req), f = fails.get(ip);
    if (f && f.until > Date.now()) return send(res, 429, { error: 'Too many failed log-ins. Wait a few minutes and try again.' });
    const b = await body(req);
    const u = db.users.find(x => x.username.toUpperCase() === String(b.username || '').trim().toUpperCase());
    if (!u || !(await verify(String(b.password || ''), u.password))) {
      const n = ((f && f.n) || 0) + 1;
      fails.set(ip, { n, until: n >= 8 ? Date.now() + 5 * 60e3 : 0 });
      return send(res, 401, { error: 'User ID or password is incorrect.' });
    }
    fails.delete(ip);
    const token = randHex(24);
    sessions.set(token, u.username); saveSessions();
    return send(res, 200, { token, user: publicUser(u) });
  }

  const me = auth(req);
  if (!me) return send(res, 401, { error: 'Not logged in' });

  if (p === '/api/logout' && m === 'POST') { sessions.delete((req.headers.get('authorization') || '').replace('Bearer ', '')); saveSessions(); return send(res, 200, { ok: true }); }
  if (p === '/api/me' && m === 'GET') return send(res, 200, publicUser(me));
  if (p === '/api/me' && m === 'PUT') {
    const b = await body(req);
    if ('avatar' in b) me.avatar = String(b.avatar || '').startsWith('data:image') ? b.avatar : '';
    if (b.newPassword) {
      if (!(await verify(String(b.currentPassword || ''), me.password))) return send(res, 400, { error: 'Current password is wrong' });
      me.password = await hash(b.newPassword);
    }
    save(); return send(res, 200, publicUser(me));
  }

  // Civilian search & profile
  if (p === '/api/civilians' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    let list = db.civilians;
    if (q) list = list.filter(c => fullName(c).toLowerCase().includes(q) || c.lastName.toLowerCase().startsWith(q) || (c.licence.number || '').toLowerCase() === q);
    return send(res, 200, list.slice(0, 25).map(c => ({ id: c.id, fullName: fullName(c), dob: c.dob, age: age(c.dob), photo: c.photo, flags: c.flags })));
  }
  let mt = p.match(/^\/api\/civilians\/([\w]+)$/);
  if (mt) {
    const idx = db.civilians.findIndex(c => c.id === mt[1]);
    if (m === 'GET') return idx < 0 ? send(res, 404, { error: 'Not found' }) : send(res, 200, withAge(db.civilians[idx]));
    if (!me.isAdmin) return send(res, 403, { error: 'Admin only' });
    if (idx < 0) return send(res, 404, { error: 'Not found' });
    if (m === 'PUT') { db.civilians[idx] = cleanCivilian(await body(req), db.civilians[idx]); save(); return send(res, 200, withAge(db.civilians[idx])); }
    if (m === 'DELETE') { db.civilians.splice(idx, 1); save(); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/civilians' && m === 'POST') {
    if (!me.isAdmin) return send(res, 403, { error: 'Admin only' });
    const b = await body(req);
    if (!b.firstName || !b.lastName) return send(res, 400, { error: 'First and last name are required' });
    const c = cleanCivilian(b); db.civilians.push(c); save(); return send(res, 200, withAge(c));
  }

  // Officer actions on a person record (any logged-in officer)
  mt = p.match(/^\/api\/civilians\/(\w+)\/action$/);
  if (mt && m === 'POST') {
    const c = db.civilians.find(x => x.id === mt[1]);
    if (!c) return send(res, 404, { error: 'That person record no longer exists.' });
    const r = applyAction(c, await body(req), me);
    if (r.error) return send(res, 400, r);
    save(); return send(res, 200, withAge(c));
  }

  // Reports
  if (p === '/api/reports' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const civ = url.searchParams.get('civ');
    let list = db.reports;
    if (civ) list = list.filter(r => r.civId === civ);
    if (q) list = list.filter(r => [r.ref, r.title, r.subject && r.subject.fullName, r.officer.name, r.officer.username, r.typeName].join(' ').toLowerCase().includes(q));
    return send(res, 200, list.slice().reverse().map(r => ({ id: r.id, ref: r.ref, type: r.type, typeName: r.typeName, title: r.title, status: r.status,
      subject: r.subject ? r.subject.fullName : '', officer: r.officer, created: r.created, updated: r.updated })));
  }
  if (p === '/api/reports' && m === 'POST') {
    const b = await body(req);
    const r = cleanReport(b, null, me);
    if (r.error) return send(res, 400, r);
    db.reports.push(r);
    if (r.status === 'Submitted') applyReportEffects(r, me);
    save(); return send(res, 200, r);
  }
  mt = p.match(/^\/api\/reports\/(\w+)$/);
  if (mt) {
    const r = db.reports.find(x => x.id === mt[1]);
    if (!r) return send(res, 404, { error: 'That report no longer exists.' });
    if (m === 'GET') return send(res, 200, r);
    const own = r.officer.username === me.username;
    if (m === 'PUT') {
      if (!me.isAdmin && !(own && r.status === 'Draft')) return send(res, 403, { error: 'Submitted reports can only be changed by an administrator.' });
      const out = cleanReport(await body(req), r, me);
      if (out.error) return send(res, 400, out);
      if (out.status === 'Submitted') applyReportEffects(out, me);
      save(); return send(res, 200, out);
    }
    if (m === 'DELETE') {
      if (!me.isAdmin && !(own && r.status === 'Draft')) return send(res, 403, { error: 'Only drafts can be deleted by their author.' });
      db.reports = db.reports.filter(x => x !== r); save(); return send(res, 200, { ok: true });
    }
  }

  // Vehicle / licence search
  if (p === '/api/vehicles' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().replace(/\s+/g, '');
    const out = [];
    db.civilians.forEach(c => c.vehicles.forEach(v => {
      if (!q || v.reg.toLowerCase().replace(/[\s-]/g, '').includes(q.replace(/-/g, '')) || fullName(c).toLowerCase().replace(/\s+/g, '').includes(q))
        out.push(Object.assign({}, v, { ownerId: c.id, owner: fullName(c) }));
    }));
    return send(res, 200, out.slice(0, 25));
  }


  // Control room: officers list, calls, dispatch alerts
  if (p === '/api/officers' && m === 'GET') return send(res, 200, db.users.map(publicUser));
  if (p === '/api/alerts' && m === 'GET') {
    return send(res, 200, db.calls.filter(c => callOpen(c) && c.units.some(u => u.username === me.username && !u.ack))
      .map(c => Object.assign(callSummary(c), { attachedAt: c.units.find(u => u.username === me.username).attachedAt })));
  }
  if (p === '/api/calls' && m === 'GET') {
    const f = url.searchParams.get('status') || 'active';
    let list = db.calls;
    if (f === 'active') list = list.filter(callOpen); else if (f === 'closed') list = list.filter(c => !callOpen(c));
    return send(res, 200, list.slice().reverse().slice(0, 200));
  }
  if (p === '/api/calls' && m === 'POST') {
    const c = cleanCall(await body(req), null, me);
    if (c.error) return send(res, 400, c);
    callLog(c, me, 'Call logged by ' + byLine(me));
    db.calls.push(c); save(); return send(res, 200, c);
  }
  mt = p.match(/^\/api\/calls\/(\w+)(?:\/(\w+))?$/);
  if (mt) {
    const c = db.calls.find(x => x.id === mt[1]);
    if (!c) return send(res, 404, { error: 'That call no longer exists.' });
    const sub = mt[2];
    if (!sub && m === 'GET') return send(res, 200, c);
    if (!sub && m === 'PUT') {
      if (!callOpen(c)) return send(res, 400, { error: 'A closed call cannot be edited.' });
      const out = cleanCall(await body(req), c, me);
      if (out.error) return send(res, 400, out);
      callLog(c, me, 'Call details updated by ' + me.username);
      save(); return send(res, 200, c);
    }
    if (!sub && m === 'DELETE') {
      if (!me.isAdmin) return send(res, 403, { error: 'Only an administrator can delete a call.' });
      db.calls = db.calls.filter(x => x !== c); save(); return send(res, 200, { ok: true });
    }
    if (sub === 'attach' && m === 'POST') {
      if (!callOpen(c)) return send(res, 400, { error: 'This call is closed.' });
      const b = await body(req);
      const names = (Array.isArray(b.usernames) ? b.usernames : [b.username]).map(x => String(x || '').toUpperCase());
      let added = 0;
      names.forEach(n => {
        const u = db.users.find(x => x.username === n);
        if (!u || c.units.some(x => x.username === n)) return;
        c.units.push({ username: u.username, name: u.name, rank: u.rank, badge: u.badge, attachedAt: new Date().toISOString(), ack: false, ackAt: null });
        callLog(c, me, byLine(u) + ' attached by ' + me.username); added++;
      });
      if (!added) return send(res, 400, { error: 'Choose an officer who is not already attached.' });
      c.status = 'Dispatched'; save();
      return send(res, 200, c);
    }
    if (sub === 'detach' && m === 'POST') {
      const b = await body(req);
      const i = c.units.findIndex(x => x.username === String(b.username || '').toUpperCase());
      if (i < 0) return send(res, 400, { error: 'That officer is not attached to this call.' });
      const [u] = c.units.splice(i, 1);
      callLog(c, me, byLine(u) + ' removed from call by ' + me.username);
      if (callOpen(c)) c.status = c.units.length ? 'Dispatched' : 'Pending';
      save(); return send(res, 200, c);
    }
    if (sub === 'ack' && m === 'POST') {
      const u = c.units.find(x => x.username === me.username);
      if (!u) return send(res, 400, { error: 'You are not attached to this call.' });
      if (!u.ack) { u.ack = true; u.ackAt = new Date().toISOString(); callLog(c, me, byLine(me) + ' acknowledged the call'); save(); }
      return send(res, 200, c);
    }
    if (sub === 'close' && m === 'POST') {
      if (!callOpen(c)) return send(res, 400, { error: 'This call is already closed.' });
      const b = await body(req);
      c.status = 'Closed'; c.closedAt = new Date().toISOString(); c.closedBy = me.username;
      c.outcome = String(b.outcome || '').trim().slice(0, 2000);
      callLog(c, me, 'Call closed by ' + me.username + (c.outcome ? ': ' + c.outcome : ''));
      save(); return send(res, 200, c);
    }
  }

  // Garda account management
  if (p === '/api/users') {
    if (!me.isAdmin) return send(res, 403, { error: 'Admin only' });
    if (m === 'GET') return send(res, 200, db.users.map(publicUser));
    if (m === 'POST') {
      const b = await body(req);
      const username = String(b.username || '').trim().toUpperCase();
      if (!username || !b.password) return send(res, 400, { error: 'Username and password are required' });
      if (db.users.find(u => u.username === username)) return send(res, 400, { error: 'That username already exists' });
      db.users.push({ username, password: await hash(b.password), name: String(b.name || username), rank: String(b.rank || 'Garda'), badge: String(b.badge || ''), isAdmin: !!b.isAdmin, avatar: '' });
      save(); return send(res, 200, { ok: true });
    }
  }
  mt = p.match(/^\/api\/users\/(.+)$/);
  if (mt) {
    if (!me.isAdmin) return send(res, 403, { error: 'Admin only' });
    const name = decodeURIComponent(mt[1]);
    const u = db.users.find(x => x.username === name);
    if (!u) return send(res, 404, { error: 'Not found' });
    if (m === 'DELETE') {
      if (u.username === 'GARDA-1234' || u.username === me.username) return send(res, 400, { error: 'You cannot delete this account' });
      db.users = db.users.filter(x => x !== u);
      for (const [t, n] of sessions) if (n === name) sessions.delete(t);
      saveSessions();
      save(); return send(res, 200, { ok: true });
    }
    if (m === 'PUT') {
      const b = await body(req);
      if (b.password) u.password = await hash(b.password);
      ['name', 'rank', 'badge'].forEach(k => { if (k in b) u[k] = String(b[k]); });
      if ('isAdmin' in b && u.username !== 'GARDA-1234') u.isAdmin = !!b.isAdmin;
      save(); return send(res, 200, publicUser(u));
    }
  }
  return send(res, 404, { error: 'Unknown endpoint' });
}


// ---------- Durable Object + Worker entry ----------
export class Cad {
  constructor(ctx, env) {
    SQL = ctx.storage.sql;
    this.ready = ctx.blockConcurrencyWhile(load);
  }
  async fetch(req) {
    await this.ready;
    const url = new URL(req.url);
    try {
      if (url.pathname === '/healthz') return send(null, 200, { ok: true });
      return await api(req, null, url);
    } catch (e) {
      if (!e.status) console.error(e);
      return send(null, e.status || 500, { error: e.status ? e.message : 'Server error: ' + e.message });
    }
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
      return env.CAD.get(env.CAD.idFromName('main')).fetch(req);
    }
    return env.ASSETS.fetch(req);
  }
};
