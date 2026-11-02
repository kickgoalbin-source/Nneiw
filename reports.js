/* Garda CAD - Reports (documents) */
const RTYPES = {
  arrest: { name: 'Arrest report', narrative: 'Account of arrest', vehicle: false, fields: [
    ['when', 'Date and time of arrest', 'datetime-local'], ['location', 'Place of arrest'],
    ['offences', 'Offences (one per line)', 'area'], ['power', 'Power of arrest', 'text', 's.4 Criminal Law Act 1997'],
    ['caution', 'Caution administered', 'select', ['Yes', 'No']], ['station', 'Garda station brought to'],
    ['custody', 'Member in charge'], ['property', 'Property seized', 'area']] },
  incident: { name: 'Incident report', narrative: 'Details of incident', vehicle: true, fields: [
    ['when', 'Date and time of incident', 'datetime-local'], ['location', 'Location'],
    ['category', 'Incident type', 'select', ['Public order', 'Theft', 'Assault', 'Criminal damage', 'Domestic', 'Burglary', 'Drugs', 'Suspicious activity', 'Other']],
    ['others', 'Other persons involved', 'area'], ['action', 'Action taken', 'area']] },
  traffic: { name: 'Road traffic report', narrative: 'Details', vehicle: true, points: true, fields: [
    ['when', 'Date and time', 'datetime-local'], ['location', 'Location'], ['offence', 'Offence detected'],
    ['speed', 'Recorded speed and limit', 'text', 'e.g. 92 km/h in a 60 zone'],
    ['outcome', 'Outcome', 'select', ['Fixed charge notice', 'Summons', 'Verbal warning', 'Arrest', 'Vehicle seized']]] },
  collision: { name: 'Collision report', narrative: 'Account of collision', vehicle: true, fields: [
    ['when', 'Date and time of collision', 'datetime-local'], ['location', 'Location'],
    ['conditions', 'Road and weather conditions'], ['injuries', 'Injuries', 'select', ['None', 'Minor', 'Serious', 'Fatal']],
    ['others', 'Other vehicles and drivers', 'area'], ['damage', 'Damage', 'area']] },
  statement: { name: 'Witness statement', narrative: 'Statement', vehicle: false, declaration: true, fields: [
    ['when', 'Date and time of statement', 'datetime-local'], ['location', 'Statement taken at'], ['occupation', 'Occupation of witness']] },
  search: { name: 'Search report', narrative: 'Account of search', vehicle: true, fields: [
    ['when', 'Date and time of search', 'datetime-local'], ['location', 'Place searched'],
    ['power', 'Search power', 'text', 's.23 Misuse of Drugs Act 1977'], ['grounds', 'Grounds for search', 'area'],
    ['found', 'Items found', 'area'], ['outcome', 'Outcome']] }
};
const repStatus = s => `<span class="st ${s === 'Submitted' ? 'ok' : 'warn'}">${esc(s)}</span>`;
const fmtDT = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? v : d.toLocaleDateString('en-IE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' }); };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

// ---------- list ----------
function pageReports(arg) {
  if (arg && arg.open) return viewReport(arg.open);
  if (arg && arg.newFor) return editReport(null, { civId: arg.newFor });
  if (arg && arg.newType) return editReport(null, { type: arg.newType });
  content.innerHTML = `<div class="querybar">
      <label class="qlabel" for="rType">New</label>
      <select id="rType" class="qsel">${Object.entries(RTYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('')}</select>
      <button class="btn" id="rNew">Create report</button>
      <span class="qsep"></span>
      <label class="qlabel" for="rq">Find</label>
      <div class="combo" style="flex-basis:320px"><input id="rq" placeholder="Reference, title, person or officer"></div>
    </div><div class="workspace" id="ws"></div>`;
  $('#rNew').onclick = () => editReport(null, { type: $('#rType').value });
  let t; $('#rq').oninput = () => { clearTimeout(t); t = setTimeout(() => listReports($('#rq').value), 150); };
  listReports('');
}
async function listReports(q) {
  const list = await api('/reports?q=' + encodeURIComponent(q || ''));
  $('#ws').innerHTML = `<div class="panel"><div class="ph">${q ? 'Matching reports' : 'All reports'}<span class="r">${list.length}</span></div><div class="pb flush">
    ${list.length ? `<table class="grid"><tr><th>Reference</th><th>Type</th><th>Title</th><th>Person</th><th>Officer</th><th>Date</th><th>Status</th></tr>
      ${list.map(r => `<tr class="click" data-rep="${esc(r.id)}"><td style="white-space:nowrap">${esc(r.ref)}</td><td>${esc(r.typeName)}</td><td><b>${esc(r.title)}</b></td><td>${esc(r.subject || '—')}</td><td>${esc(r.officer.rank)} ${esc(r.officer.name)}</td><td style="white-space:nowrap">${fmtDate(r.created)}</td><td>${repStatus(r.status)}</td></tr>`).join('')}</table>`
      : `<div class="none">${q ? 'No reports match that search.' : 'No reports written yet. Choose a report type above and select Create report.'}</div>`}
  </div></div>`;
  $('#ws').querySelectorAll('[data-rep]').forEach(r => r.onclick = () => viewReport(r.dataset.rep));
}

// ---------- shared document pieces ----------
function docHead(typeName, ref, statusTxt, dateTxt) {
  return `<header class="doc-head">
    <img src="logo.png?v=2" alt="">
    <div class="doc-org"><div>An Garda Síochána</div><h1>${esc(typeName)}</h1></div>
    <table class="doc-meta"><tr><th>Reference</th><td>${esc(ref)}</td></tr><tr><th>Status</th><td>${esc(statusTxt)}</td></tr><tr><th>Date</th><td>${esc(dateTxt)}</td></tr></table>
  </header>`;
}
function subjectBlock(s, v) {
  if (!s) return '<p class="doc-empty">No person linked to this report.</p>';
  return `<div class="doc-subject">
    ${s.photo ? `<img class="doc-photo" src="${esc(s.photo)}" alt="">` : '<div class="doc-photo">No photo</div>'}
    <table class="doc-kv">
      <tr><th>Surname</th><td><b>${esc(String(s.lastName || '').toUpperCase())}</b></td><th>Forename</th><td>${esc(s.firstName)}</td></tr>
      <tr><th>Date of birth</th><td>${fmtDate(s.dob)} (${s.age ?? '—'})</td><th>Gender</th><td>${esc(s.gender || '—')}</td></tr>
      <tr><th>Height</th><td>${esc(s.height || '—')}</td><th>Phone</th><td>${esc(s.phone || '—')}</td></tr>
      <tr><th>Address</th><td colspan="3">${esc(s.address || '—')}</td></tr>
      <tr><th>Description</th><td colspan="3">${esc(s.description || '—')}</td></tr>
      <tr><th>Licence</th><td colspan="3">${s.licence && s.licence.number ? `${esc(s.licence.number)}, ${esc(s.licence.status)}, category ${esc(s.licence.class || '—')}, ${s.licence.points} penalty points` : 'No licence held'}</td></tr>
      <tr><th>Markers</th><td colspan="3">${s.flags && s.flags.length ? `<span class="st bad">${s.flags.map(esc).join(', ')}</span>` : 'None'}</td></tr>
      <tr><th>Previous</th><td colspan="3">${s.convictions || (s.offences ? s.offences.length : 0)} conviction(s) or caution(s) on record</td></tr>
      ${v ? `<tr><th>Vehicle</th><td colspan="3">${esc(v.reg)}, ${esc(v.colour)} ${esc(v.make)} ${esc(v.model)} (${esc(v.year)}). Tax ${esc(v.tax)}, insurance ${esc(v.insurance)}, NCT ${esc(v.nct)}</td></tr>` : ''}
    </table></div>`;
}
function officerBlock(o, dateTxt) {
  return `<footer class="doc-foot">
    <table class="doc-kv"><tr><th>Reporting member</th><td>${esc(o.rank)} ${esc(o.name)}</td><th>Badge no.</th><td>${esc(o.badge || '—')}</td></tr>
      <tr><th>User ID</th><td>${esc(o.username)}</td><th>Date</th><td>${esc(dateTxt)}</td></tr></table>
    <div class="doc-sign"><div><span class="sig">${esc(o.name)}</span><i>Signature of reporting member</i></div></div>
  </footer>`;
}

// ---------- view ----------
async function viewReport(id) {
  let r; try { r = await api('/reports/' + id); } catch (e) { toast(e.message, true); return pageReports(); }
  const T = RTYPES[r.type];
  const canEdit = me.isAdmin || (r.officer.username === me.username && r.status === 'Draft');
  const val = f => {
    const v = r.fields[f[0]];
    if (!v) return '<span class="doc-empty">Not recorded</span>';
    return f[2] === 'datetime-local' ? esc(fmtDT(v)) : `<span class="pre">${esc(v)}</span>`;
  };
  content.innerHTML = `<div class="querybar rtool">
      <button class="btn plain" id="rBack">Back to reports</button><span class="qsep"></span>
      ${canEdit ? '<button class="btn" id="rEdit">Edit</button>' : ''}
      <button class="btn plain" id="rPrint">Print</button>
      ${canEdit ? '<button class="btn danger" id="rDel">Delete</button>' : ''}
      ${r.civId ? '<button class="btn plain" id="rPerson">Open person record</button>' : ''}
    </div>
    <div class="desk"><article class="paper">
      ${docHead(r.typeName, r.ref, r.status, fmtDate(r.created))}
      <h2 class="doc-title">${esc(r.title)}</h2>
      <section><h3>1. Person concerned</h3>${subjectBlock(r.subject, r.vehicle)}</section>
      <section><h3>2. Details</h3><table class="doc-kv">${T.fields.map(f => `<tr><th>${esc(f[1])}</th><td>${val(f)}</td></tr>`).join('')}</table></section>
      <section><h3>3. ${esc(T.narrative)}</h3><div class="doc-narr">${r.narrative ? esc(r.narrative) : '<span class="doc-empty">Nothing written.</span>'}</div>
        ${T.declaration ? declaration(r.subject) : ''}</section>
      ${r.type === 'arrest' && r.addCharges ? `<p class="doc-note">Offences ${r.status === 'Submitted' ? 'were added' : 'will be added'} to the person's record on submission.</p>` : ''}
      ${r.type === 'traffic' && r.points && r.points.offence ? `<p class="doc-note">Penalty points: ${esc(r.points.offence)}, ${r.points.points} point(s), ${esc(r.points.fine || 'no fine')}. ${r.status === 'Submitted' ? 'Applied to the licence.' : 'Applied when submitted.'}</p>` : ''}
      ${officerBlock(r.officer, fmtDate(r.updated))}
      <div class="doc-page">${esc(r.ref)}. Page 1 of 1. Last updated ${fmtDT(r.updated)} by ${esc(r.updatedBy || r.officer.username)}.</div>
    </article></div>`;
  $('#rBack').onclick = () => pageReports();
  $('#rPrint').onclick = () => window.print();
  if ($('#rEdit')) $('#rEdit').onclick = () => editReport(r);
  if ($('#rPerson')) $('#rPerson').onclick = () => go('dashboard', r.civId);
  if ($('#rDel')) $('#rDel').onclick = async () => {
    if (!confirm('Delete report ' + r.ref + '? This cannot be undone.')) return;
    try { await api('/reports/' + r.id, { method: 'DELETE' }); toast('Report deleted'); pageReports(); } catch (e) { toast(e.message, true); }
  };
}
function declaration(s) {
  return `<p class="doc-decl">This statement, consisting of one page, is true to the best of my knowledge and belief. I make it knowing that if it is used in evidence I may be prosecuted if I have wilfully stated in it anything which I know to be false.</p>
    <div class="doc-sign"><div><span class="sig">${s ? esc(s.fullName) : ''}</span><i>Signature of witness</i></div></div>`;
}

// ---------- editor ----------
async function editReport(existing, preset = {}) {
  const st = existing
    ? { id: existing.id, type: existing.type, title: existing.title, civId: existing.civId || '', vehicleId: existing.vehicle ? existing.vehicle.id : '', fields: Object.assign({}, existing.fields),
        narrative: existing.narrative || '', addCharges: existing.addCharges, points: existing.points || { offence: '', points: 0, fine: '' }, ref: existing.ref, status: existing.status, created: existing.created, officer: existing.officer }
    : { type: preset.type || 'arrest', title: '', civId: preset.civId || '', vehicleId: '', fields: { when: nowLocal() }, narrative: '', addCharges: true, points: { offence: '', points: 0, fine: '' },
        status: 'Draft', officer: me };
  let person = null;
  const loadPerson = async () => { person = st.civId ? await api('/civilians/' + st.civId).catch(() => null) : null; };
  await loadPerson();

  content.innerHTML = `<div class="querybar rtool">
      <button class="btn plain" id="rBack">${existing ? 'Cancel' : 'Back to reports'}</button><span class="qsep"></span>
      ${existing ? '' : `<label class="qlabel" for="rType">Report type</label><select id="rType" class="qsel">${Object.entries(RTYPES).map(([k, t]) => `<option value="${k}" ${k === st.type ? 'selected' : ''}>${t.name}</option>`).join('')}</select><span class="qsep"></span>`}
      <button class="btn plain" id="rSave">Save draft</button>
      <button class="btn" id="rSubmit">${st.status === 'Submitted' ? 'Save changes' : 'Submit report'}</button>
      <span class="rmsg" id="rMsg"></span>
    </div><div class="desk"><article class="paper editing" id="paper"></article></div>`;

  function draw() {
    const T = RTYPES[st.type];
    $('#paper').innerHTML = `
      ${docHead(T.name, st.ref || 'Assigned on save', st.status, fmtDate(st.created || new Date()))}
      <input class="doc-title-in" id="dTitle" placeholder="Report title, e.g. Arrest of suspect for shoplifting at Tesco, Main Street" value="${esc(st.title)}" aria-label="Report title">
      <section><h3>1. Person concerned</h3>
        <div class="doc-pick"><div class="combo"><input id="dPerson" placeholder="${person ? 'Change person: type a name' : 'Type a name to find the person, e.g. Sandra'}" autocomplete="off"><div class="listbox hidden"></div></div>
          ${person ? '<button class="btn plain sm" id="dClear">Remove person</button>' : ''}</div>
        ${person ? subjectBlock(Object.assign({}, person, { convictions: person.offences.length }), T.vehicle ? person.vehicles.find(v => v.id === st.vehicleId) : null) : ''}
        ${person && T.vehicle ? `<div class="doc-pick"><label for="dVeh">Vehicle involved</label><select id="dVeh"><option value="">None</option>${person.vehicles.map(v => `<option value="${esc(v.id)}" ${v.id === st.vehicleId ? 'selected' : ''}>${esc(v.reg)}, ${esc(v.colour)} ${esc(v.make)} ${esc(v.model)}</option>`).join('')}</select></div>` : ''}
      </section>
      <section><h3>2. Details</h3><table class="doc-kv">${T.fields.map(([k, label, type, ex]) => {
        const v = st.fields[k] || '';
        let input;
        if (type === 'area') input = `<textarea data-f="${k}" rows="2">${esc(v)}</textarea>`;
        else if (type === 'select') input = `<select data-f="${k}"><option value=""></option>${ex.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        else input = `<input data-f="${k}" type="${type || 'text'}" value="${esc(v)}" ${ex ? `placeholder="${esc(ex)}"` : ''}>`;
        return `<tr><th><label>${esc(label)}</label></th><td>${input}</td></tr>`;
      }).join('')}</table></section>
      <section><h3>3. ${esc(T.narrative)}</h3>
        <textarea class="doc-narr-in" id="dNarr" placeholder="Write the full account here, in the first person and in time order.">${esc(st.narrative)}</textarea>
        ${T.declaration ? declaration(person) : ''}</section>
      ${st.type === 'arrest' ? `<label class="check doc-opt"><input type="checkbox" id="dCharges" ${st.addCharges ? 'checked' : ''} ${st.status === 'Submitted' ? 'disabled' : ''}> Add the offences above to the person's record when this report is submitted</label>` : ''}
      ${T.points ? `<div class="doc-opt"><b>Penalty points</b> (applied to the licence when submitted; leave blank for none)
        ${pointsForm('rp')}</div>` : ''}
      ${officerBlock(st.officer, fmtDate(new Date()))}`;
    bind();
  }
  function bind() {
    const p = $('#paper');
    $('#dTitle').oninput = e => { st.title = e.target.value; };
    $('#dNarr').oninput = e => { st.narrative = e.target.value; autoGrow(e.target); };
    autoGrow($('#dNarr'));
    p.querySelectorAll('[data-f]').forEach(i => i.oninput = i.onchange = () => { st.fields[i.dataset.f] = i.value; });
    if ($('#dCharges')) $('#dCharges').onchange = e => { st.addCharges = e.target.checked; };
    if ($('#dVeh')) $('#dVeh').onchange = e => { st.vehicleId = e.target.value; draw(); };
    if ($('#dClear')) $('#dClear').onclick = () => { st.civId = ''; st.vehicleId = ''; person = null; draw(); };
    if (p.querySelector('#rpPre')) {
      bindPointsForm(p, 'rp');
      const pOff = $('#rpOff'), pPts = $('#rpPts'), pFine = $('#rpFine');
      pOff.value = st.points.offence; pPts.value = st.points.points; pFine.value = st.points.fine;
      if (st.status === 'Submitted') [pOff, pPts, pFine, $('#rpPre')].forEach(x => x.disabled = true);
      const sync = () => { st.points = { offence: pOff.value, points: pPts.value, fine: pFine.value }; };
      [pOff, pPts, pFine].forEach(x => x.oninput = sync); $('#rpPre').addEventListener('change', sync);
    }
    personCombo($('#dPerson'), async c => { st.civId = c.id; st.vehicleId = ''; await loadPerson(); if (person && RTYPES[st.type].vehicle && person.vehicles.length === 1) st.vehicleId = person.vehicles[0].id; draw(); });
  }
  draw();

  if ($('#rType')) $('#rType').onchange = e => { st.type = e.target.value; draw(); };
  $('#rBack').onclick = () => existing ? viewReport(existing.id) : pageReports();
  const save = async status => {
    $('#rMsg').textContent = '';
    if (!st.title.trim()) { $('#rMsg').textContent = 'Give the report a title before saving.'; $('#dTitle').focus(); return; }
    if (status === 'Submitted' && st.status !== 'Submitted') {
      const fx = [];
      if (st.type === 'arrest' && st.addCharges && st.fields.offences) fx.push('the offences will be added to ' + (person ? person.fullName : 'the person') + "'s record");
      if (st.type === 'traffic' && st.points.offence) fx.push(st.points.points + ' penalty point(s) will be added to the licence');
      if (!confirm('Submit this report? Once submitted only an administrator can change it.' + (fx.length ? '\n\nOn submission ' + fx.join(' and ') + '.' : ''))) return;
    }
    const body = { type: st.type, title: st.title, civId: st.civId, vehicleId: st.vehicleId, fields: st.fields, narrative: st.narrative, addCharges: st.addCharges,
      points: st.points.offence ? st.points : null, status };
    try {
      const r = existing ? await api('/reports/' + existing.id, { method: 'PUT', body }) : await api('/reports', { method: 'POST', body });
      toast(status === 'Submitted' ? (st.status === 'Submitted' ? 'Changes saved' : 'Report submitted') : 'Draft saved');
      viewReport(r.id);
    } catch (e) { $('#rMsg').textContent = e.message; }
  };
  $('#rSave').onclick = () => save(st.status === 'Submitted' ? 'Submitted' : 'Draft');
  $('#rSave').classList.toggle('hidden', st.status === 'Submitted');
  $('#rSubmit').onclick = () => save('Submitted');
  $('#dTitle').focus();
}
function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.max(260, t.scrollHeight + 4) + 'px'; }

// Inline person picker for documents
function personCombo(input, onPick) {
  const lb = input.parentElement.querySelector('.listbox');
  let items = [], sel = -1, timer, seq = 0;
  const close = () => { lb.classList.add('hidden'); sel = -1; };
  const draw = () => {
    if (!input.value.trim()) return close();
    lb.innerHTML = items.length ? items.map((c, i) => `<div class="opt ${i === sel ? 'sel' : ''}" data-i="${i}">${avatarHtml(c.photo, c.fullName)}<div><div class="n">${esc(c.fullName)}</div><div class="d">Born ${fmtDate(c.dob)}, age ${c.age ?? '—'}</div></div><div class="w">${c.flags.length ? esc(c.flags[0]) : ''}</div></div>`).join('')
      : `<div class="opt none">No person called “${esc(input.value.trim())}” on record. An administrator can add them in Settings.</div>`;
    lb.classList.remove('hidden');
  };
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => { const q = input.value.trim(); if (!q) return close(); const my = ++seq; const r = await api('/civilians?q=' + encodeURIComponent(q)); if (my === seq) { items = r; sel = -1; draw(); } }, 140); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items.length) { close(); onPick(items[Math.max(sel, 0)]); } }
    else if (e.key === 'Escape') close();
  };
  lb.onmousedown = e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); close(); onPick(items[+d.dataset.i]); } };
  input.onblur = () => setTimeout(close, 150);
}
