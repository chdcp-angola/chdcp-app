/* ============================================================
   CHDCP – AGENDA · Ecosystem.gs (v0.6.0)
   La ficha dell'attività diventa il centro operativo:
     - matrice azioni deterministica (override → Detailed Plan → ACTION_MATRIX → regole di riserva)
     - partecipanti previsti: un solo risolutore (getActivityParticipants_)
     - presenze → ATTENDANCE_SUBMISSIONS (staging di questo file; il Hub le importa
       con Data Entry → COURSE_ATTENDANCE → REPORTING_DB → dashboard)
     - sezione del Detailed Training Plan per Activity ID (Hub DETAILED_PLAN, sola lettura)
     - questionário: modulo esistente precompilato (anche "Código da actividade")
     - link a CHDCP Learning & Assessment con biglietto firmato (niente secondo PIN)
     - API JSON (doPost) per l'app installabile (PWA), solo funzioni in lista
   Regole invariate: mai scrivere in Operations, piani mensili o Training Hub.
   ============================================================ */

const ECO = {
  MATRIX_CACHE_S: 600,
  DP_CACHE_S: 3600,
  TICKET_TTL_MS: 5 * 60 * 1000,
  API: ['apiUsers', 'apiLogin', 'apiLogout', 'apiResume', 'apiChangeOwnPin', 'apiAgendaAll', 'apiActivityDetail',
    'apiAttendanceContext', 'apiSaveAttendance', 'apiPeopleSearch', 'apiEvalLink', 'apiLaLink'],
  ACTIONS: ['ATTENDANCE', 'TOJ', 'THEORY', 'EVALUATION']
};

/* Regole di riserva (coppie Activity Type + Methodology non ancora in ACTION_MATRIX).
   [campo, pattern, presenze, toj, teorica, questionário] — prima che corrisponde */
const ECO_FALLBACK_ = [
  ['PLATFORM', 'asynchron|assincron|e-learning|elearning|skilla', 'N', 'N', 'N', 'N'],
  ['ANY', '\\btoj\\b|on[ -]the[ -]job|training on the job', 'N', 'Y', 'N', 'N'],
  ['ANY', 'exam|exame|test|prova|quiz|written|escrit|avaliacao teorica|theor.*assess|pre-?test|post-?test|pos-?teste', 'Y', 'N', 'Y', 'N'],
  ['ANY', 'protocol|procedur|working group|grupo de trabalho|meeting|reuni|briefing|debriefing|coordination|coordenac', 'Y', 'N', 'N', 'N'],
  ['ANY', 'frontal|lesson|lecture|aula|lezione|workshop|course|curso|seminar|semin|simula|hands-?on|practical|pratic|skills? lab|formacao|training', 'Y', 'N', 'N', 'Y']
];


/* ============================================================
   MATRICE AZIONI
   ============================================================ */

let ECO_MX_ = null;

/* { 'tipo|metodologia' normalizzati: {att,toj,th,ev} } dal foglio ACTION_MATRIX */
function ecoMatrix_() {
  if (ECO_MX_) return ECO_MX_;
  const cache = CacheService.getScriptCache();
  try { ECO_MX_ = JSON.parse(cache.get('ECO_MX') || 'null'); } catch (e) { ECO_MX_ = null; }
  if (ECO_MX_) return ECO_MX_;
  const out = {};
  try {
    const t = apRead_('ACTION_MATRIX');
    t.rows.forEach(r => {
      const m = apNorm_(apGet_(t, r, 'Methodology'));
      const ty = apNorm_(apGet_(t, r, 'Activity Type'));
      if (!m && !ty) return;
      out[ty + '|' + m] = {
        att: apYes_(apGet_(t, r, 'Attendance Y/N')), toj: apYes_(apGet_(t, r, 'TOJ Y/N')),
        th: apYes_(apGet_(t, r, 'Theory Y/N')), ev: apYes_(apGet_(t, r, 'Evaluation Y/N'))
      };
    });
  } catch (e) { /* foglio non ancora creato */ }
  ECO_MX_ = out;
  try { cache.put('ECO_MX', JSON.stringify(out), ECO.MATRIX_CACHE_S); } catch (e) { /* best effort */ }
  return out;
}

function ecoFallback_(a) {
  const txt = { PLATFORM: apNorm_(a.platform), METHOD: apNorm_(a.method) };
  txt.ANY = [apNorm_(a.type), txt.METHOD, apNorm_([a.title, a.fullTitle].join(' ')), txt.PLATFORM].join(' ');
  for (let i = 0; i < ECO_FALLBACK_.length; i++) {
    const r = ECO_FALLBACK_[i];
    if (new RegExp(r[1], 'i').test(txt[r[0]] || txt.ANY)) return { att: r[2] === 'Y', toj: r[3] === 'Y', th: r[4] === 'Y', ev: r[5] === 'Y' };
  }
  return { att: false, toj: false, th: false, ev: false };
}

/*
 * Azioni previste dall'attività (indipendenti dall'utente):
 * 1 override nel piano (Assessment Type / Attendance Required)
 * 2 Detailed Plan (righe ACTIVITY_PLAN dell'Activity ID)
 * 3 ACTION_MATRIX (Activity Type + Methodology)
 * 4 regole di riserva
 */
function ecoKinds_(a) {
  const none = { att: false, toj: false, th: false, ev: false, src: 'NONE' };
  if (!a || a.hidden || a.async) return none;
  const mx = ecoMatrix_();
  const ty = apNorm_(a.type), me = apNorm_(a.method);
  let k = mx[ty + '|' + me] || mx['|' + me];
  let src = 'MATRIX';
  if (!k) { k = ecoFallback_(a); src = 'FALLBACK'; }
  k = { att: k.att, toj: k.toj, th: k.th, ev: k.ev, src: src };

  const dp = ecoDpFor_(a.id);
  if (dp.length) {
    if (dp.some(x => /toj/i.test(x.type))) k.toj = true;
    if (dp.some(x => /theor|teor|test|exam|escrit|written|quiz|prova/i.test(apNorm_(x.assess)))) { k.th = true; k.att = true; }
    k.src += '+DP';
  }

  const ov = apNorm_(a.assessment).toUpperCase();
  if (ov) {
    k.toj = /TOJ/.test(ov);
    k.th = /THEOR|TEOR/.test(ov);
    k.src = 'OVERRIDE';
  }
  if (a.attendanceReq) { k.att = apYes_(a.attendanceReq); k.src = 'OVERRIDE'; }
  return k;
}

/* Azioni per l'utente: dipendono dal ruolo SULL'ATTIVITÀ, mai dallo stato ADMIN */
function ecoActionsFor_(a, role) {
  const k = ecoKinds_(a);
  if (role === 'TRAINER') {
    return ECO.ACTIONS.filter(x => (x === 'ATTENDANCE' && k.att) || (x === 'TOJ' && k.toj) || (x === 'THEORY' && k.th) || (x === 'EVALUATION' && k.ev));
  }
  if (role === 'PARTICIPANT') return k.ev ? ['EVALUATION'] : [];
  return [];
}

/* Menu: aggiunge in ACTION_MATRIX ogni coppia Activity Type + Methodology dei piani (righe esistenti mai toccate) */
function ecoBuildActionMatrix() {
  const ss = SpreadsheetApp.getActive();
  apEnsureSheet_(ss, 'ACTION_MATRIX', AP_H.ACTION_MATRIX);
  const sh = ss.getSheetByName('ACTION_MATRIX');
  const t = apRead_('ACTION_MATRIX');
  const have = {};
  t.rows.forEach((r, i) => { have[apNorm_(apGet_(t, r, 'Activity Type')) + '|' + apNorm_(apGet_(t, r, 'Methodology'))] = i; });

  /* coppie dalla finestra dell'agenda + dal master "Activity Planning" (tutto l'anno) */
  const pairs = {};
  const add = a => {
    const key = apNorm_(a.type) + '|' + apNorm_(a.method);
    if (key === '|') return;
    const p = pairs[key] = pairs[key] || { type: a.type, method: a.method, n: 0, ex: a.title, a: a };
    p.n++;
  };
  try { apReadActivities_().list.forEach(add); } catch (e) { /* finestra non leggibile */ }
  try {
    let hub; try { hub = apHub_(); } catch (e) { hub = { areaAlias: {}, byNorm: {}, byToken: {} }; }
    apReadPlan_(apCfg_('OPS_FILE_ID'), { sheet: AP.MASTER_SHEET, hub: hub, holidays: {} }).acts.forEach(add);
  } catch (e) { /* master non leggibile */ }

  const fresh = [];
  let counted = 0;
  Object.keys(pairs).sort().forEach(key => {
    const p = pairs[key];
    if (have[key] !== undefined) {
      const c = t.h[apNorm_('Activities Seen')];
      if (c !== undefined) { sh.getRange(have[key] + 2, c + 1).setValue(p.n); counted++; }
      return;
    }
    const k = ecoFallback_(p.a);
    fresh.push([p.type, p.method, k.att ? 'Y' : 'N', k.toj ? 'Y' : 'N', k.th ? 'Y' : 'N', k.ev ? 'Y' : 'N', 'N', p.n, p.ex, 'Proposta automatica: rivedere e mettere Reviewed = Y']);
  });
  if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, fresh[0].length).setValues(fresh);
  ['Attendance Y/N', 'TOJ Y/N', 'Theory Y/N', 'Evaluation Y/N', 'Reviewed Y/N'].forEach(h => apValidation_(sh, h, ['Y', 'N']));
  sh.getRange(1, 1).setNote('Una riga = una coppia Activity Type + Methodology dei piani (valori esatti). Y/N = azioni mostrate nella ficha al formador.\n' +
    'Precedenza: colonne facoltative del piano (Assessment Type, Attendance Required) → Detailed Plan dell\'Activity ID → questa matrice → regole di riserva.');
  CacheService.getScriptCache().remove('ECO_MX');
  apAlert_('ACTION_MATRIX aggiornata.\n\nCoppie nuove (da rivedere, Reviewed = N): ' + fresh.length + '\nCoppie già presenti: ' + counted +
    '\n\nRivedi le colonne Y/N e metti Reviewed = Y. L\'app usa la matrice entro 10 minuti.');
}


/* ============================================================
   DETAILED TRAINING PLAN (Hub DETAILED_PLAN, sola lettura)
   ============================================================ */

let ECO_DP_ = null;

/* { byId: {Activity ID: [righe ACTIVITY_PLAN]}, toj: [{area,start,end,skills:[{c,d,r}]}] } */
function ecoDpIndex_() {
  if (ECO_DP_) return ECO_DP_;
  const hit = apCacheGet_('ECO_DP');
  if (hit) { ECO_DP_ = hit; return hit; }
  const out = { byId: {}, toj: [] };
  try {
    const sh = SpreadsheetApp.openById(apCfg_('HUB_FILE_ID')).getSheetByName('DETAILED_PLAN');
    if (sh && sh.getLastRow() > 1) {
      const v = sh.getDataRange().getValues();
      const h = apHeaderMap_(v[0].map(String));
      const g = (r, names) => { for (let i = 0; i < names.length; i++) { const c = h[apNorm_(names[i])]; if (c !== undefined) return r[c]; } return ''; };
      const since = apIsoAdd_(apYmd_(new Date()), -120);
      const toj = {};
      v.slice(1).forEach(r => {
        if (String(g(r, ['Check'])).indexOf('SUPERSEDED') >= 0) return;
        const rt = apClean_(g(r, ['Record Type'])).toUpperCase();
        const id = apClean_(g(r, ['Activity ID']));
        const area = apClean_(g(r, ['Training Area (Hub)'])) || apClean_(g(r, ['Training Area'])).toUpperCase();
        const st = apAsDate_(g(r, ['Period Start'])), en = apAsDate_(g(r, ['Period End'])) || st;
        if (rt === 'ACTIVITY_PLAN' && id) {
          (out.byId[id] = out.byId[id] || []).push({
            type: apClean_(g(r, ['Activity Type'])), title: apClean_(g(r, ['Activity Title'])),
            domain: apClean_(g(r, ['Competency Domain'])), la: apClean_(g(r, ['Learning / Competency Area'])),
            phase: apClean_(g(r, ['Learning Phase'])), obj: apClean_(g(r, ['Objective'])),
            know: apClean_(g(r, ['Key Knowledge / Practical Skills'])), assess: apClean_(g(r, ['Assessment Type'])),
            success: apClean_(g(r, ['Success Criterion']))
          });
        } else if (rt === 'TOJ_PLAN' && area && st && apYmd_(en) >= since) {
          const k = area + '|' + apYmd_(st);
          const p = toj[k] = toj[k] || { area: area, start: apYmd_(st), end: apYmd_(en), skills: [] };
          const code = apClean_(g(r, ['TOJ Skill Code'])).toUpperCase();
          if (code && !p.skills.some(x => x.c === code)) {
            p.skills.push({ c: code, d: apClean_(g(r, ['TOJ Skill Description'])), r: apNum_(g(r, ['Priority Rank'])) || 99 });
          }
        }
      });
      out.toj = Object.keys(toj).map(k => toj[k]);
      out.toj.forEach(p => p.skills.sort((x, y) => x.r - y.r));
    }
  } catch (e) { out.error = e.message; }
  ECO_DP_ = out;
  apCachePut_('ECO_DP', out, ECO.DP_CACHE_S);
  return out;
}

function ecoDpFor_(id) {
  if (!id) return [];
  return ecoDpIndex_().byId[id] || [];
}

/* Sezione del piano utile per QUESTA attività (non il piano intero) */
function ecoPlanSection_(a, k) {
  const rows = ecoDpFor_(a.id);
  const sec = { activity: rows.slice(0, 3), toj: null };
  if (k.toj) {
    const p = ecoDpIndex_().toj.filter(x => x.area === a.area && x.start <= a.date && x.end >= a.date)
      .sort((x, y) => y.start.localeCompare(x.start))[0];
    if (p) sec.toj = { start: p.start, end: p.end, skills: p.skills.slice(0, 8) };
  }
  return sec;
}


/* ============================================================
   PARTECIPANTI PREVISTI — risolutore unico
   ============================================================ */

/*
 * [{pid, name, role, src}] di un'attività:
 * 1 procedura / protocollo → membri del workstream in GOVERNANCE_ASSIGNMENT
 * 2 area → TRAINEE della stessa area in AGENDA_ASSIGNMENT (USER_TRAINING_AREA);
 *   se l'area non ne ha → PERSON_TRAINING_AREA del Hub
 * 3 PARTICIPATION_OVERRIDES: ADD / REMOVE per Activity ID
 * Esclusi: formadores dell'attività, persone inattive. Area ALL: solo 1 e 3.
 */
function getActivityParticipants_(a, rules) {
  let hub;
  try { hub = apHub_(); } catch (e) { hub = { people: {}, areasOf: {} }; }
  rules = rules || apRules_();
  const trainerPids = a.trainers.map(t => t.p).filter(Boolean);
  const ov = (rules.overrides && rules.overrides[a.id]) || [];
  const removed = ov.filter(o => o.remove && o.pid).map(o => o.pid);
  const out = [];
  const seen = {};
  const push = (pid, role, src) => {
    const p = hub.people[pid];
    if (!pid || !p || p.active === false || seen[pid] || removed.indexOf(pid) >= 0 || trainerPids.indexOf(pid) >= 0) return;
    seen[pid] = true;
    out.push({ pid: pid, name: p.name, role: role, src: src });
  };

  const gov = apActivityGovernance_(a);
  if (gov) {
    try {
      const gd = apGovernanceData_();
      Object.keys(gd.byPid).forEach(pid => { const rec = gd.byPid[pid]; if (rec.roles && rec.roles[gov.key]) push(pid, rec.roles[gov.key], 'GOVERNANCE'); });
    } catch (e) { /* governance non leggibile */ }
  }

  if (a.area && a.area !== 'ALL' && !gov) {
    const uidPid = {};
    try {
      const ur = apRead_('USER_REGISTER');
      ur.rows.forEach(r => { const u = apClean_(apGet_(ur, r, 'User ID')); const p = apClean_(apGet_(ur, r, 'Person ID')); if (u && p) uidPid[u] = p; });
      const uta = apRead_('USER_TRAINING_AREA');
      uta.rows.forEach(r => {
        if (!apYes_(apGet_(uta, r, 'Active Y/N'))) return;
        if (apClean_(apGet_(uta, r, 'Training Area')).toUpperCase() !== a.area) return;
        if (apClean_(apGet_(uta, r, 'Participation Role')).toUpperCase() !== 'TRAINEE') return;
        const pid = apClean_(apGet_(uta, r, 'Person ID')) || uidPid[apClean_(apGet_(uta, r, 'User ID'))];
        push(pid, 'TRAINEE', 'AGENDA_ASSIGNMENT');
      });
    } catch (e) { /* fogli utenti non leggibili */ }
    if (!out.length) {
      Object.keys(hub.areasOf || {}).forEach(pid => { if (hub.areasOf[pid].indexOf(a.area) >= 0) push(pid, 'TRAINEE', 'PERSON_TRAINING_AREA'); });
    }
  }

  ov.filter(o => !o.remove && o.pid).forEach(o => push(o.pid, 'TRAINEE', 'OVERRIDE'));
  return out.sort((x, y) => x.name.localeCompare(y.name));
}


/* ============================================================
   CONTESTO AUTORIZZATO (ogni chiamata, lato server)
   ============================================================ */

function ecoContext_(token, activityId, action, opts) {
  opts = opts || {};
  const user = apSession_(token);
  const id = apClean_(activityId);
  const a = apActivities_().list.find(x => x.id === id);
  if (!a) throw new Error('Actividade não encontrada (' + id + '). Actualize a agenda.');
  let hub;
  try { hub = apHub_(); } catch (e) { hub = { areaAlias: {}, areasOf: {} }; }
  const rules = apRules_();
  const memberships = apUserMemberships_(user);
  const areas = apUserAreas_(user, hub, memberships);
  let govData;
  try { govData = apGovernanceData_(); } catch (e) { govData = { byPid: {}, byName: {}, workstreams: [] }; }
  const role = apRole_(user, a, areas, rules, memberships, govData);
  if (!apVisible_(user, a, role, areas)) throw new Error('Sem acesso a esta actividade.');
  if (action && ecoActionsFor_(a, role).indexOf(action) < 0) throw new Error('Esta acção não está disponível para si nesta actividade.');
  if (opts.write) ecoCheckDateWindow_(a);
  return { user: user, a: a, role: role, areas: areas, rules: rules };
}

function ecoCheckDateWindow_(a) {
  const today = apYmd_(new Date());
  if (a.date > today) throw new Error('Só é possível registar a partir do dia da actividade.');
  const limit = apIsoAdd_(a.date, Number(apCfg_('ACTION_MAX_PAST_DAYS')) || 45);
  if (limit && today > limit) throw new Error('Prazo de registo terminado.');
}

function ecoCanWrite_(a) {
  try { ecoCheckDateWindow_(a); return { ok: true }; } catch (e) { return { ok: false, why: e.message }; }
}

function ecoBrief_(a, role) {
  return {
    id: a.id, date: a.date, start: a.start, end: a.end, noTime: a.noTime, dur: a.dur || '', area: a.area, title: a.title,
    fullTitle: a.fullTitle, method: a.method, platform: a.platform, trainers: a.trainers.map(t => t.n), place: a.place, role: role || ''
  };
}


/* ============================================================
   API · FICHA
   ============================================================ */

/* Una sola chiamata leggera all'apertura della ficha */
function apiActivityDetail(token, activityId) {
  const ctx = ecoContext_(token, activityId);
  const a = ctx.a;
  const k = ecoKinds_(a);
  const out = {
    id: a.id, role: ctx.role, ax: ecoActionsFor_(a, ctx.role), src: k.src,
    plan: ecoPlanSection_(a, k), expected: null, roster: null, att: null,
    la: !!apClean_(apCfg_('LA_URL')), canWrite: ecoCanWrite_(a)
  };
  if (ctx.role === 'TRAINER' || ctx.user.visibility === 'FULL' || ctx.user.visibility === 'AREA') {
    const roster = getActivityParticipants_(a, ctx.rules);
    out.expected = roster.length;
    if (ctx.role === 'TRAINER') out.roster = roster.map(p => ({ id: p.pid, n: p.name, r: p.role }));
  }
  const saved = ecoSaved_(a.id);
  if (saved.n) out.att = { n: saved.n, present: saved.present, at: saved.at, by: saved.by };
  return out;
}


/* ============================================================
   API · PRESENÇAS (staging ATTENDANCE_SUBMISSIONS)
   ============================================================ */

function ecoSaved_(activityId) {
  const out = { byPid: {}, n: 0, present: 0, at: 0, by: '' };
  let t;
  try { t = apReadOwn_('ATTENDANCE_SUBMISSIONS'); } catch (e) { return out; }
  t.rows.forEach(r => {
    if (apClean_(apGet_(t, r, 'Activity ID')) !== activityId) return;
    const pid = apClean_(apGet_(t, r, 'Person ID'));
    if (!pid) return;
    const st = apClean_(apGet_(t, r, 'Attendance Status'));
    out.byPid[pid] = { st: st, name: apClean_(apGet_(t, r, 'Trainee')), imp: apClean_(apGet_(t, r, 'Import Status')) };
    out.n++;
    if (st === 'PRESENT') out.present++;
    const d = apGet_(t, r, 'Recorded At');
    if (d instanceof Date && d.getTime() > out.at) { out.at = d.getTime(); out.by = apClean_(apGet_(t, r, 'Recorded By Name')); }
  });
  return out;
}

/* fogli di QUESTO file (la versione di apRead_ legge già il file attivo) */
function apReadOwn_(name) { return apRead_(name); }

function apiAttendanceContext(token, activityId) {
  const ctx = ecoContext_(token, activityId, 'ATTENDANCE');
  const roster = getActivityParticipants_(ctx.a, ctx.rules).map(p => ({ id: p.pid, name: p.name, src: p.src, r: p.role }));
  const saved = ecoSaved_(ctx.a.id);
  Object.keys(saved.byPid).forEach(pid => {
    if (!roster.some(p => p.id === pid)) roster.push({ id: pid, name: saved.byPid[pid].name || pid, src: 'SAVED', r: '' });
  });
  const marks = {};
  Object.keys(saved.byPid).forEach(pid => { marks[pid] = saved.byPid[pid].st; });
  return { act: ecoBrief_(ctx.a, ctx.role), people: roster, saved: marks, savedAt: saved.at, savedBy: saved.by, canWrite: ecoCanWrite_(ctx.a) };
}

/*
 * payload = { clientId, activityId, items: [{ pid, st: 'PRESENT'|'ABSENT' }] }
 * Una riga per Activity ID + Person ID: salvare di nuovo aggiorna (mai doppioni).
 */
function apiSaveAttendance(token, payload) {
  const p = payload || {};
  const ctx = ecoContext_(token, p.activityId, 'ATTENDANCE', { write: true });
  const clientId = apClean_(p.clientId);
  if (!clientId) throw new Error('Pedido inválido (sem identificador).');
  const items = (p.items || []).filter(x => x && x.pid && /^(PRESENT|ABSENT)$/.test(x.st));
  if (!items.length) throw new Error('Marque pelo menos uma pessoa.');
  let hub;
  try { hub = apHub_(); } catch (e) { throw new Error('Training Hub não disponível. Tente de novo.'); }
  items.forEach(x => { if (!hub.people[apClean_(x.pid)]) throw new Error('Pessoa desconhecida no Training Hub: ' + x.pid); });

  const a = ctx.a;
  const now = new Date();
  const res = apWithLock_(() => {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('ATTENDANCE_SUBMISSIONS') || apEnsureSheet_(ss, 'ATTENDANCE_SUBMISSIONS', AP_H.ATTENDANCE_SUBMISSIONS);
    const t = apRead_('ATTENDANCE_SUBMISSIONS');
    const ci = h => t.h[apNorm_(h)];
    if (t.rows.some(r => apClean_(r[ci('Submission ID')]) === clientId)) return { duplicate: true, added: 0, updated: 0 };
    const index = {};
    t.rows.forEach((r, i) => { if (apClean_(r[ci('Activity ID')]) === a.id) index[apClean_(r[ci('Person ID')])] = i; });
    const width = t.headers.length;
    const fresh = [];
    let added = 0, updated = 0;
    items.forEach(x => {
      const pid = apClean_(x.pid);
      const o = {
        'Activity ID': a.id, 'Date': apAsDate_(a.date), 'Training Area': a.area, 'TASK / Corso': a.fullTitle || a.title,
        'Methodology': a.method, 'Trainer': a.trainers.map(tr => tr.n).join(' - '), 'Person ID': pid, 'Trainee': hub.people[pid].name,
        'Attendance Status': x.st, 'Level / Durata corso [min]': a.dur || '', 'TOJ / Course': 'Course', 'Notes': '',
        'Recorded By': ctx.user.id, 'Recorded By Name': ctx.user.name, 'Recorded At': now, 'Submission ID': clientId
      };
      const i = index[pid];
      if (i !== undefined) {
        const row = t.rows[i].slice();
        while (row.length < width) row.push('');
        const prevSt = apClean_(row[ci('Attendance Status')]);
        const prevImp = apClean_(row[ci('Import Status')]);
        Object.keys(o).forEach(h => { const c = ci(h); if (c !== undefined) row[c] = o[h]; });
        /* già nel Hub e cambiato: si segnala, il Hub non viene riscritto */
        if (/^(IMPORTED|ALREADY IN HUB)$/i.test(prevImp) && prevSt !== x.st) {
          row[ci('Import Status')] = 'CHANGED AFTER IMPORT';
          row[ci('Import Issues')] = 'Era ' + prevSt + ' quando foi importado: corrigir COURSE_ATTENDANCE no Hub';
        } else if (!/^(IMPORTED|ALREADY IN HUB)$/i.test(prevImp)) {
          row[ci('Import Status')] = '';
        }
        sh.getRange(i + 2, 1, 1, width).setValues([row.slice(0, width)]);
        updated++;
      } else {
        o['Record ID'] = 'ATT-' + Utilities.getUuid().slice(0, 8).toUpperCase();
        fresh.push(t.headers.map(h => (o[h] === undefined ? '' : o[h])));
        added++;
      }
    });
    if (fresh.length) {
      const first = sh.getLastRow() + 1;
      sh.getRange(first, 1, fresh.length, width).setValues(fresh);
      const dc = ci('Date');
      if (dc !== undefined) sh.getRange(first, dc + 1, fresh.length, 1).setNumberFormat('dd/MM/yyyy');
    }
    return { duplicate: false, added: added, updated: updated };
  });
  if (!res.duplicate) {
    apAudit_(ctx.user, 'ATTENDANCE SAVE', 'ACTIVITY', a.id, a.id, '', {
      present: items.filter(x => x.st === 'PRESENT').length, absent: items.filter(x => x.st === 'ABSENT').length, updated: res.updated
    });
  }
  return {
    ok: true, duplicate: res.duplicate, added: res.added, updated: res.updated,
    present: items.filter(x => x.st === 'PRESENT').length, absent: items.filter(x => x.st === 'ABSENT').length
  };
}

/* Persona fuori dall'elenco previsto (solo formador dell'attività), max 20 */
function apiPeopleSearch(token, activityId, q) {
  const ctx = ecoContext_(token, activityId);
  if (ctx.role !== 'TRAINER') throw new Error('Só o formador da actividade pode adicionar pessoas.');
  const n = apNorm_(q);
  if (n.length < 2) return [];
  const hub = apHub_();
  return Object.keys(hub.people)
    .filter(pid => hub.people[pid].active !== false && apNorm_(hub.people[pid].name + ' ' + pid).indexOf(n) >= 0)
    .slice(0, 20)
    .map(pid => ({ id: pid, name: hub.people[pid].name, areas: hub.areasOf[pid] || [] }));
}


/* ============================================================
   API · QUESTIONÁRIO (Google Form esistente, precompilato)
   ============================================================ */

function apiEvalLink(token, activityId) {
  const ctx = ecoContext_(token, activityId, 'EVALUATION');
  const a = ctx.a;
  const ck = 'ECO_EVAL_' + a.id;
  const cache = CacheService.getScriptCache();
  const hit = cache.get(ck);
  if (hit) { try { const o = JSON.parse(hit); o.trainer = ctx.role === 'TRAINER'; return o; } catch (e) { /* ricalcola */ } }
  let form = null;
  try { form = ecoEvalForm_(); } catch (e) { form = null; }
  if (!form) {
    const url = apClean_(apCfg_('EVAL_FORM_URL'));
    if (!url) throw new Error('Questionário não configurado.');
    return { url: url, prefilled: [], title: 'Questionário', act: ecoBrief_(a, ctx.role), trainer: ctx.role === 'TRAINER' };
  }
  const values = { ACT: a.id, DATE: apAsDate_(a.date), TITLE: a.fullTitle || a.title, TRAINER: a.trainers.map(t => t.n).join(', '), AREA: a.area, TYPE: a.method };
  const resp = form.createResponse();
  const done = [];
  form.getItems().forEach(item => {
    const kind = ecoEvalFieldOf_(item.getTitle());
    if (!kind || done.indexOf(kind) >= 0) return;
    try { const ir = ecoEvalItemResponse_(item, values[kind]); if (ir) { resp.withItemResponse(ir); done.push(kind); } } catch (e) { /* campo libero */ }
  });
  const out = { url: done.length ? resp.toPrefilledUrl() : form.getPublishedUrl(), prefilled: done, title: form.getTitle(), act: ecoBrief_(a, ctx.role) };
  try { cache.put(ck, JSON.stringify(out), 21600); } catch (e) { /* best effort */ }
  out.trainer = ctx.role === 'TRAINER';
  return out;
}

function ecoEvalForm_() {
  const direct = apClean_(apCfg_('EVAL_FORM_URL'));
  if (direct && /\/forms\/d\/[^/]+\/edit/.test(direct) && !/\/forms\/d\/e\//.test(direct)) {
    try { return FormApp.openByUrl(direct); } catch (e) { /* dal foglio risposte */ }
  }
  const url = SpreadsheetApp.openById(apCfg_('EVAL_SOURCE_ID')).getFormUrl();
  if (!url) throw new Error('Foglio risposte senza modulo collegato');
  return FormApp.openByUrl(url);
}

function ecoEvalFieldOf_(title) {
  const t = apNorm_(title);
  if (/codigo da actividade|codigo da atividade|activity id/.test(t)) return 'ACT';
  if (/\b(data|date)\b/.test(t) && !/actualiz|update/.test(t)) return 'DATE';
  if (/formador|trainer|docente|professor|instrutor|facilitador|moderador/.test(t)) return 'TRAINER';
  if (/titulo|title|nome do curso|curso|course|tema/.test(t) && !/tipo|type/.test(t)) return 'TITLE';
  if (/tipo de aula|tipo de sessao|lesson type|teorica ou pratica|modalidade/.test(t)) return 'TYPE';
  if (/\barea\b|servico|departamento|unidade/.test(t) && !/profiss/.test(t)) return 'AREA';
  return '';
}

function ecoEvalItemResponse_(item, value) {
  if (value === '' || value === null || value === undefined) return null;
  const T = FormApp.ItemType;
  const pick = (choices) => {
    const v = apNorm_(value);
    const vals = choices.map(c => c.getValue());
    const exact = vals.find(x => apNorm_(x) === v);
    if (exact) return exact;
    const part = vals.filter(x => apNorm_(x).length > 2 && (v.indexOf(apNorm_(x)) >= 0 || apNorm_(x).indexOf(v) >= 0));
    return part.length === 1 ? part[0] : null;
  };
  switch (item.getType()) {
    case T.TEXT: return item.asTextItem().createResponse(String(value));
    case T.PARAGRAPH_TEXT: return item.asParagraphTextItem().createResponse(String(value));
    case T.DATE: return value instanceof Date ? item.asDateItem().createResponse(value) : null;
    case T.LIST: { const it = item.asListItem(); const c = pick(it.getChoices()); return c ? it.createResponse(c) : null; }
    case T.MULTIPLE_CHOICE: { const it = item.asMultipleChoiceItem(); const c = pick(it.getChoices()); return c ? it.createResponse(c) : null; }
    default: return null;
  }
}


/* ============================================================
   LINK A LEARNING & ASSESSMENT (biglietto firmato, 5 minuti, uso singolo)
   ============================================================ */

/*
 * mode: toj | theory | person | area | home
 * params: { activityId, personId, area }
 * pwa: true se l'app gira come app installata → link alla PWA di Learning & Assessment
 */
function apiLaLink(token, mode, params, pwa) {
  const user = apSession_(token);
  const p = params || {};
  const m = ['toj', 'theory', 'person', 'area', 'home'].indexOf(String(mode)) >= 0 ? String(mode) : 'home';
  const q = { mode: m };

  if (m === 'toj' || m === 'theory') {
    const ctx = ecoContext_(token, p.activityId, m === 'toj' ? 'TOJ' : 'THEORY');
    const a = ctx.a;
    Object.assign(q, { activityId: a.id, area: a.area, date: a.date, title: a.title });
  } else if (m === 'person') {
    q.personId = apClean_(p.personId) || user.personId;
  } else if (m === 'area') {
    q.area = apClean_(p.area);
  }

  const secret = apClean_(apCfg_('LA_TICKET_SECRET'));
  const base = pwa && apClean_(apCfg_('PWA_URL')) ? apClean_(apCfg_('PWA_URL')).replace(/\/+$/, '') + '/avaliacao/' : apClean_(apCfg_('LA_URL'));
  if (!base) throw new Error('Learning & Assessment ainda não está ligado à Agenda (menu do Hub "Collega Agenda").');
  if (secret) q.t = ecoTicket_(user, secret);
  apAudit_(user, 'LA LINK', 'APP', m, q.activityId || '', '', q.personId || q.area || '');
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
}

/* biglietto = base64url(payload) . base64url(HMAC-SHA256(payload, chiave)) */
function ecoTicket_(user, secret) {
  const payload = JSON.stringify({
    v: 1, u: user.id, p: user.personId || '', n: user.name, r: user.role, s: user.visibility,
    t: Date.now(), x: Utilities.getUuid().slice(0, 12)
  });
  const b64 = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  const body = b64(Utilities.newBlob(payload).getBytes());
  const sig = b64(Utilities.computeHmacSha256Signature(body, secret));
  return body + '.' + sig;
}

function ecoShowLinkStatus() {
  const la = apClean_(apCfg_('LA_URL'));
  const sec = apClean_(apCfg_('LA_TICKET_SECRET'));
  const pwa = apClean_(apCfg_('PWA_URL'));
  apAlert_('COLLEGAMENTO AGENDA ↔ LEARNING & ASSESSMENT\n\n' +
    'LA_URL: ' + (la || '— manca (Hub: menu Learning & Assessment > Collega Agenda)') + '\n' +
    'Chiave biglietti: ' + (sec ? 'presente' : '— manca (stesso menu del Hub)') + '\n' +
    'App installabili (PWA_URL): ' + (pwa || '— non ancora pubblicate'));
}


/* ============================================================
   CARICAMENTO VELOCE (rilettura ogni 30 min nelle ore di lavoro)
   ============================================================ */

function ecoWarmInstall() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'ecoWarmCache').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('ecoWarmCache').timeBased().everyMinutes(30).create();
  const t0 = Date.now();
  ecoWarmCache(true);
  apAlert_('Caricamento veloce attivo: piani, Hub, governance e Detailed Plan riletti ogni 30 minuti (' +
    apCfg_('WARM_FROM_HOUR') + '–' + apCfg_('WARM_TO_HOUR') + ' ora di Luanda).\nPrima lettura: ' + Math.round((Date.now() - t0) / 1000) + ' s.');
}

function ecoWarmCache(force) {
  const h = Number(Utilities.formatDate(new Date(), apTz_(), 'H'));
  if (force !== true && (h < Number(apCfg_('WARM_FROM_HOUR')) || h >= Number(apCfg_('WARM_TO_HOUR')))) return;
  const cache = CacheService.getScriptCache();
  const step = (label, fn) => { try { fn(); } catch (e) { console.log('Riscaldamento ' + label + ': ' + e.message); } };
  step('Hub', () => { cache.remove('AP_HUB_N'); apHub_(); });
  step('governance', () => { cache.remove('AP_GOV_V1'); apGovernanceData_(); });
  step('Detailed Plan', () => { cache.remove('ECO_DP_N'); ECO_DP_ = null; ecoDpIndex_(); });
  step('attività', () => { apCachePut_('AP_ACTS', apReadActivities_(), Math.max(Number(apCfg_('CACHE_SECONDS')) || 300, 2700)); });
}


/* ============================================================
   API JSON PER L'APP INSTALLABILE (PWA)
   POST text/plain {fn, args} → {ok, v} | {ok:false, e}
   Solo le funzioni in ECO.API (le stesse già chiamabili dalla pagina).
   ============================================================ */

function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = String(body.fn || '');
    if (ECO.API.indexOf(fn) < 0) throw new Error('API: função não permitida');
    const f = globalThis[fn];
    if (typeof f !== 'function') throw new Error('API: função inexistente');
    out = { ok: true, v: f.apply(null, Array.isArray(body.args) ? body.args : []) };
  } catch (err) {
    out = { ok: false, e: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
