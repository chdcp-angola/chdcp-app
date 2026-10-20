/* ============================================================
   CHDCP – ACTIVITY PLANNING (agenda operativa, sola lettura)
   Fase 3 · Utenti, partecipazione e governance · v0.5.0 (rete lenta: pacchetto unico apiAgendaAll, filtri sul telefono)
   v0.6.0 · Ecosistema: ficha = centro operativo (azioni, presenze, Detailed Plan, link a
   Learning & Assessment) → vedi Ecosystem.gs. Scrive solo nei fogli di questo file.
   Google Apps Script legato al foglio "CHDCP Activity Planning".

   Legge (mai scrive):
   - CHDCP Operations › MONTHLY_OPERATIONAL_REGISTRY → piani mensili
     (foglio MONTHLY_OPERATIONAL_PLAN)
   - Training Hub › PEOPLE_MASTER, NAME_ALIAS, PERSON_TRAINING_AREA,
     TRAINING_AREA_ALIAS
   - Local Conditions › HOLIDAYS (se HOLIDAYS_SOURCE_FILE_ID è impostato)
   Scrive solo nei fogli di questo file.

   Colonne lette per nome (foglio COLUMN_MAP), mai per posizione.
   Web app: Esegui come: me · Accesso: chiunque. Login nome + PIN.
   ============================================================ */

const AP = {
  VERSION: '0.6.0',
  TITLE: 'CHDCP – Activity Planning',
  APP_NAME: 'CHDCP Agenda',

  OPS_FILE_ID: '1svjAtMXMh_WiLikGwKs1uFuCcBnb6OxqGCeRe23OdI4',
  REGISTRY_SHEET: 'MONTHLY_OPERATIONAL_REGISTRY',
  PLAN_SHEET: 'MONTHLY_OPERATIONAL_PLAN',
  MASTER_SHEET: 'Activity Planning',
  CALENDAR_LOG_SHEET: 'CALENDAR_SYNC_LOG',

  HUB_FILE_ID: '1W5HFNo-k4MeAfUNRarGq2H5cJDaKzPwszBN3h-Nlb9M',
  HOLIDAYS_SOURCE_FILE_ID: '1Wswm0SH8V-n1BTGf_O9CKord3Rue4_nUSLqAS0JrhWc',

  WINDOW_PAST_DAYS: 14,
  WINDOW_FUTURE_DAYS: 60,

  SESSION_DAYS: 30,
  PIN_LENGTH: 4,
  MAX_FAILED: 5,
  LOCK_MINUTES: 15,
  CACHE_SECONDS: 300,
  PEOPLE_CACHE_SECONDS: 3600,

  STATUS_TENTATIVE: 'envisioned|outlined',
  EXEC_DONE: 'executed|reported|uploaded',
  EXEC_HIDDEN: 'cancel|anulad|annull|postpon|adiad|rinvi',
  ASYNC_PATTERN: 'asynchron|assincron|e-learning|elearning',
  DEFAULT_DURATION_MIN: 60,

  MASTER_FALLBACK: 'ON',
  PWA_ORIGIN: '',

  /* v0.6 · ecosistema */
  LA_URL: '',
  LA_TICKET_SECRET: '',
  PWA_URL: '',
  EVAL_SOURCE_ID: '12iXXbkstupRcYPqWMAXw7s5c53WTnMegs-34oFfq3CU',
  EVAL_FORM_URL: '',
  ACTION_MAX_PAST_DAYS: 45,
  WARM_FROM_HOUR: 6,
  WARM_TO_HOUR: 21,

  ROLES: ['ADMIN', 'MANAGER', 'COORDINATOR', 'TRAINER', 'VIEWER'],
  VISIBILITY: ['FULL', 'AREA', 'OWN']
};

/* Intestazioni dei fogli di questo file */
const AP_H = {
  CONFIG: ['Key', 'Value', 'Notes'],
  COLUMN_MAP: ['Source', 'Field', 'Source Headers', 'Required Y/N', 'Notes'],
  HOLIDAYS: ['Date', 'Description', 'Active Y/N'],
  USER_REGISTER: ['User ID', 'Nome', 'Apelido', 'Display Name', 'PIN Hash', 'PIN Salt', 'Role', 'Person ID', 'Visibility',
    'Training Area / Scope', 'Active Y/N', 'Created At', 'Last Login', 'Last Activity', 'Failed Attempts', 'Locked Until',
    'Feed Key', 'Feed Active Y/N', 'Feed Created At', 'Last Feed Access', 'Novo PIN (temporário)', 'PIN Change Required Y/N', 'Name Aliases', 'Sync Source', 'Last Sync'],
  USER_TRAINING_AREA: ['User ID', 'Person ID', 'Training Area', 'Participation Role', 'Source', 'Active Y/N', 'Synced At'],
  PARTICIPATION_RULES: ['Rule ID', 'Training Area', 'Methodology Pattern', 'Participant Area', 'Participant Role',
    'Include/Exclude', 'Active Y/N', 'Notes'],
  PARTICIPATION_OVERRIDES: ['Activity ID', 'Person ID', 'User ID', 'Action', 'Note', 'Created By', 'Created At'],
  TYPE_STYLE: ['Methodology Pattern', 'Label PT', 'Color', 'Icon', 'Order'],
  SOURCE_STATUS: ['Checked At', 'Source', 'Month', 'Year', 'File ID', 'Rows Read', 'Rows Shown', 'Hidden', 'Without ID',
    'Duplicates', 'Missing Columns', 'Error'],
  SOURCE_HEADERS: ['Checked At', 'Source', 'Sheet', 'File ID', 'Column', 'Header', 'Mapped Field', 'Sample'],
  UNRESOLVED_NAMES: ['Name', 'Seen In Activity', 'Count', 'Last Seen', 'Suggested Person ID'],
  DIAG_OPS: ['Sheet', 'Row', 'Values'],
  AUDIT_LOG: ['Timestamp', 'User ID', 'Display Name', 'Role', 'Action', 'Entity Type', 'Entity ID', 'Activity ID',
    'Old Value', 'New Value'],
  /* v0.6 · ecosistema */
  ACTION_MATRIX: ['Activity Type', 'Methodology', 'Attendance Y/N', 'TOJ Y/N', 'Theory Y/N', 'Evaluation Y/N', 'Reviewed Y/N',
    'Activities Seen', 'Example', 'Notes'],
  ATTENDANCE_SUBMISSIONS: ['Record ID', 'Activity ID', 'Date', 'Training Area', 'TASK / Corso', 'Methodology', 'Trainer',
    'Person ID', 'Trainee', 'Attendance Status', 'Level / Durata corso [min]', 'TOJ / Course', 'Notes',
    'Recorded By', 'Recorded By Name', 'Recorded At', 'Submission ID',
    'Import Status', 'Import Batch', 'Import Issues', 'Imported At']
};

/* Mappatura predefinita delle colonne delle fonti (scritta in COLUMN_MAP solo se manca) */
const AP_COLMAP_SEED = [
  ['PLAN', 'id', 'Activity ID', 'Y', 'Chiave dell\'attività'],
  ['PLAN', 'date', 'Date|Data', 'Y', 'Data dell\'attività'],
  ['PLAN', 'time', 'Luanda Time|Time|Hora', 'N', 'Ora di inizio: si legge il testo mostrato (15.00, 9.30)'],
  ['PLAN', 'durationMin', 'Exp. Duration [min]', 'N', 'Durata prevista in minuti: fine = inizio + durata'],
  ['PLAN', 'durationH', 'Exp. Duration [h]|Duration [h]', 'N', 'Ripiego se manca la durata in minuti'],
  ['PLAN', 'area', 'Training Area|Área de Formação', 'Y', 'Normalizzata con TRAINING_AREA_ALIAS del Hub'],
  ['PLAN', 'trainer', 'Trainer/Responsible|Trainer / Responsible|Trainer|Responsible', 'N', 'Nomi risolti con NAME_ALIAS'],
  ['PLAN', 'status', 'Status', 'N', 'Envisioned/Outlined = previsto (tratteggiato)'],
  ['PLAN', 'execution', 'Execution', 'N', 'Executed/Reported/Uploaded = fatto; Cancelled/Postponed = nascosto'],
  ['PLAN', 'platform', 'Platform|Plataforma', 'N', 'Etichetta secondaria; asynchronous = senza ora'],
  ['PLAN', 'methodology', 'Methodology|Metodologia', 'N', 'Tipo di attività'],
  ['PLAN', 'title', 'Activity Title|Title|Título', 'Y', 'Titolo'],
  ['PLAN', 'destination', 'Destination', 'N', 'Luogo (prima parte)'],
  ['PLAN', 'room', 'Room|Sala', 'N', 'Sala (seconda parte del luogo)'],
  ['PLAN', 'translator', 'Translator|Translator needed|Tradutor', 'N', 'Traduttore'],
  ['PLAN', 'target', 'Target Audience|Target audience|Público-alvo', 'N', 'Testo libero, solo visualizzato'],
  ['PLAN', 'training', 'Training Activity [Y/N]|Training Activity', 'N', 'Attività formativa S/N'],
  ['PLAN', 'notes', 'Notes', 'N', 'Note'],
  ['PLAN', 'type', 'Activity Type|Training Type|Tipo de Actividade', 'N', 'v0.6: tipo strutturato (matrice azioni ACTION_MATRIX)'],
  ['PLAN', 'assessment', 'Assessment Type|Tipo de Avaliação', 'N', 'v0.6 facoltativo: NONE / TOJ / THEORY / TOJ+THEORY (ha la precedenza sulla matrice)'],
  ['PLAN', 'attendanceReq', 'Attendance Required|Attendance Required [Y/N]|Presenças [S/N]', 'N', 'v0.6 facoltativo: Y/N (ha la precedenza sulla matrice)'],
  ['REGISTRY', 'month', 'Month', 'Y', 'Mese del piano'],
  ['REGISTRY', 'year', 'Year', 'Y', 'Anno del piano'],
  ['REGISTRY', 'fileId', 'Spreadsheet ID', 'Y', 'ID del file del piano mensile'],
  ['REGISTRY', 'status', 'Status', 'N', 'Solo ACTIVE'],
  ['HUB_PEOPLE', 'personId', 'Person ID', 'Y', 'PEOPLE_MASTER'],
  ['HUB_PEOPLE', 'name', 'Name|Person Name|Full Name', 'Y', 'PEOPLE_MASTER'],
  ['HUB_PEOPLE', 'active', 'Active', 'N', 'PEOPLE_MASTER'],
  ['HUB_ALIAS', 'personId', 'Person ID', 'Y', 'NAME_ALIAS'],
  ['HUB_ALIAS', 'alias', 'Alias Name|Normalized Alias', 'Y', 'NAME_ALIAS'],
  ['HUB_PTA', 'personId', 'Person ID', 'Y', 'PERSON_TRAINING_AREA'],
  ['HUB_PTA', 'area', 'Training Area|Area', 'Y', 'PERSON_TRAINING_AREA'],
  ['HUB_PTA', 'home', 'Home Area [Y/N]|Primary [Y/N]|Primary Area [Y/N]', 'N', 'PERSON_TRAINING_AREA'],
  ['HUB_PTA', 'active', 'Active', 'N', 'PERSON_TRAINING_AREA'],
  ['HUB_AREA', 'alias', 'Alias', 'Y', 'TRAINING_AREA_ALIAS'],
  ['HUB_AREA', 'area', 'Training Area', 'Y', 'TRAINING_AREA_ALIAS']
];

const AP_HUB_SHEETS = { HUB_PEOPLE: 'PEOPLE_MASTER', HUB_ALIAS: 'NAME_ALIAS', HUB_PTA: 'PERSON_TRAINING_AREA', HUB_AREA: 'TRAINING_AREA_ALIAS' };
const AP_HUB_TRAINER_SHEET = 'TOJ_APP_USERS';
const AP_HUB_AGENDA_SHEET = 'AGENDA_ASSIGNMENT';
const AP_HUB_GOVERNANCE_SHEET = 'GOVERNANCE_ASSIGNMENT';

const AP_CFG_NOTES = {
  OPS_FILE_ID: 'File CHDCP Operations (registro dei piani mensili). Sola lettura.',
  HUB_FILE_ID: 'Training Data Hub (persone, alias, aree). Sola lettura.',
  HOLIDAYS_SOURCE_FILE_ID: 'File da cui leggere il foglio HOLIDAYS (Local Conditions). Vuoto = foglio HOLIDAYS di questo file.',
  WINDOW_PAST_DAYS: 'Giorni passati mostrati nell\'agenda',
  WINDOW_FUTURE_DAYS: 'Giorni futuri mostrati nell\'agenda',
  SESSION_DAYS: 'Durata della sessione sul telefono (giorni)',
  PIN_LENGTH: 'Cifre del PIN',
  MAX_FAILED: 'Tentativi errati prima del blocco',
  LOCK_MINUTES: 'Minuti di blocco',
  CACHE_SECONDS: 'Secondi di cache delle attività (max 21600)',
  STATUS_TENTATIVE: 'Valori di Status mostrati come "previsto" (tratteggiato), separati da |',
  EXEC_DONE: 'Valori di Execution mostrati come completati, separati da |',
  EXEC_HIDDEN: 'Valori di Execution/Status nascosti di default (annullate, rinviate), separati da |',
  ASYNC_PATTERN: 'Platform/Methodology asincrone: senza ora, fascia "Sem hora"',
  DEFAULT_DURATION_MIN: 'Durata usata se il piano non ne indica una (minuti)',
  MASTER_FALLBACK: 'ON = per i mesi senza piano mensile nel registro si legge il master "Activity Planning" di Operations (attività segnate come provvisorie) · OFF = mesi vuoti',
  PWA_ORIGIN: 'Indirizzo del guscio PWA, es. https://nomeutente.github.io (vuoto = niente PWA)',
  LA_URL: 'Link /exec di CHDCP Learning & Assessment (Hub). Scritto dal menu del Hub "Collega Agenda".',
  LA_TICKET_SECRET: 'Chiave dei biglietti di accesso Agenda → Learning & Assessment. Scritta dal Hub, non modificare.',
  PWA_URL: 'Indirizzo delle app installabili (GitHub Pages), es. https://nomeutente.github.io/chdcp-app — lo mostra il comando 10_PUBBLICA_APP: incollalo qui',
  EVAL_SOURCE_ID: 'Foglio risposte del Google Form "Avaliação do curso" (lo stesso letto dal Hub)',
  EVAL_FORM_URL: 'Facoltativo: link del modulo se non si ricava dal foglio risposte',
  ACTION_MAX_PAST_DAYS: 'Giorni dopo la data dell\'attività in cui si possono ancora registrare presenze',
  WARM_FROM_HOUR: 'Caricamento veloce: dalle ore (Luanda)',
  WARM_TO_HOUR: 'Caricamento veloce: fino alle ore (Luanda)'
};


/* ============================================================
   MENU DEL FOGLIO
   ============================================================ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Activity Planning')
    .addItem('1. Configura / ripara fogli', 'setupActivityPlanningApp')
    .addItem('2. Applica nuovi PIN e crea ID utenti', 'apApplyUserChanges')
    .addItem('3. Sincronizza utenti / agende dal Training Hub', 'apSyncUsersFromHub')
    .addItem('Sblocca utente…', 'apUnlockUserPrompt')
    .addSeparator()
    .addItem('🔎 Diagnostica fonti (piani, Hub, CALENDAR_SYNC_LOG)', 'apDiagnose')
    .addItem('Rileggi subito le attività (svuota cache)', 'apClearCache')
    .addItem('Link dell\'app', 'apShowAppLink')
    .addSeparator()
    .addItem('📋 Genera / aggiorna matrice azioni (ACTION_MATRIX)', 'ecoBuildActionMatrix')
    .addItem('⚡ Attiva caricamento veloce (ogni 30 min)', 'ecoWarmInstall')
    .addItem('🔗 Stato collegamento con Learning & Assessment', 'ecoShowLinkStatus')
    .addToUi();
}


/* ============================================================
   WEB APP
   ============================================================ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  const t = HtmlService.createTemplateFromFile('Index');
  t.pwa = p.pwa === '1' ? '1' : '';
  t.pwaOrigin = apClean_(apCfg_('PWA_ORIGIN')).replace(/\/+$/, '');
  t.appName = AP.APP_NAME;
  return t.evaluate()
    .setTitle(AP.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/* ============================================================
   SETUP
   ============================================================ */

function setupActivityPlanningApp() {

  const ss = SpreadsheetApp.getActive();
  Object.keys(AP_H).forEach(name => apEnsureSheet_(ss, name, AP_H[name]));

  /* CONFIG: chiavi mancanti aggiunte, valori esistenti mai toccati, note sempre in italiano */
  const cfg = ss.getSheetByName('CONFIG');
  const have = {};
  if (cfg.getLastRow() > 1) cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().forEach((r, i) => { have[apClean_(r[0])] = i + 2; });
  Object.keys(AP_CFG_NOTES).forEach(k => {
    if (have[k]) cfg.getRange(have[k], 3).setValue(AP_CFG_NOTES[k]);
    else cfg.appendRow([k, AP[k], AP_CFG_NOTES[k]]);
  });
  cfg.getRange('B:B').setNumberFormat('@');

  /* COLUMN_MAP: righe mancanti (Source + Field) aggiunte, quelle esistenti lasciate come sono */
  const cm = ss.getSheetByName('COLUMN_MAP');
  const cmHave = {};
  if (cm.getLastRow() > 1) cm.getRange(2, 1, cm.getLastRow() - 1, 2).getValues().forEach(r => { cmHave[apClean_(r[0]) + '|' + apClean_(r[1])] = true; });
  const cmNew = AP_COLMAP_SEED.filter(r => !cmHave[r[0] + '|' + r[1]]);
  if (cmNew.length) cm.getRange(cm.getLastRow() + 1, 1, cmNew.length, 5).setValues(cmNew);
  cm.getRange(1, 3).setNote('Intestazioni accettate nella fonte, separate da |. Si usa la prima trovata. Cambiare qui se cambia il nome di una colonna.');

  /* HOLIDAYS locale: solo se vuoto e se non si legge da Local Conditions */
  const hol = ss.getSheetByName('HOLIDAYS');
  if (hol.getLastRow() < 2) {
    let rows = [];
    try { rows = apReadHolidayRows_(apClean_(apCfg_('HOLIDAYS_SOURCE_FILE_ID'))); } catch (e) { rows = []; }
    if (rows.length) {
      hol.getRange(2, 1, rows.length, 3).setValues(rows);
      hol.getRange(2, 1, rows.length, 1).setNumberFormat('dd/MM/yyyy');
      hol.getRange(1, 1).setNote('Copia del foglio HOLIDAYS di Local Conditions (fatta al setup). Se HOLIDAYS_SOURCE_FILE_ID è pieno, l\'app legge sempre l\'originale.');
    }
  }

  /* USER_REGISTER: primo utente */
  const users = ss.getSheetByName('USER_REGISTER');
  if (users.getLastRow() < 2) {
    const o = {
      'User ID': apNewUserId_('Andrea', 'Landini', []), 'Nome': 'Andrea', 'Apelido': 'Landini', 'Display Name': 'Andrea Landini',
      'Role': 'ADMIN', 'Visibility': 'FULL', 'Training Area / Scope': 'ALL', 'Active Y/N': 'Y', 'Created At': new Date(), 'Failed Attempts': 0
    };
    users.getRange(2, 1, 1, AP_H.USER_REGISTER.length).setValues([AP_H.USER_REGISTER.map(h => (o[h] === undefined ? '' : o[h]))]);
  }
  const pinCol = AP_H.USER_REGISTER.indexOf('Novo PIN (temporário)') + 1;
  users.getRange(1, pinCol).setBackground('#fff2cc').setFontColor('#1b2124')
    .setNote('Scrivi qui un PIN nuovo (' + apCfg_('PIN_LENGTH') + ' cifre) e lancia "Applica nuovi PIN": viene cifrato e la cella si svuota.');
  users.getRange(2, pinCol, Math.max(users.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  try {
    const head = users.getRange(1, 1, 1, users.getLastColumn()).getValues()[0].map(String);
    const ac = head.indexOf('Name Aliases') + 1;
    if (ac > 0) users.getRange(1, ac).setNote('Altri modi in cui il nome compare in "Trainer/Responsible" dei piani, separati da | (es. Chelsea Castro|Chelsea De Castro). Servono a riconoscere le attività di cui l\'utente è formatore.');
  } catch (e) { /* ignora */ }
  apValidation_(users, 'Role', AP.ROLES);
  apValidation_(users, 'Visibility', AP.VISIBILITY);
  apValidation_(users, 'Active Y/N', ['Y', 'N']);
  apValidation_(users, 'Feed Active Y/N', ['Y', 'N']);
  apValidation_(users, 'PIN Change Required Y/N', ['Y', 'N']);
  const uta = ss.getSheetByName('USER_TRAINING_AREA');
  apValidation_(uta, 'Participation Role', ['TRAINER', 'TRAINEE']);
  apValidation_(uta, 'Active Y/N', ['Y', 'N']);
  uta.getRange(1, 1).setNote('Sincronizzato dal Training Hub. Una riga = un utente in una Training Area con ruolo TRAINER o TRAINEE. Le righe manuali possono essere mantenute usando Source diverso da HUB:* .');

  /* TYPE_STYLE: tipi reali dei piani mensili (ottobre 2026) */
  const ts = ss.getSheetByName('TYPE_STYLE');
  if (ts.getLastRow() < 2) {
    const rows = [
      ['frontal|lesson|lecture|aula', 'Aula', '#235fb8', '📘', 1],
      ['hands|simul|pratic|practical|skill lab|workshop', 'Prática / simulação', '#11804a', '🩺', 2],
      ['toj|training on the job', 'TOJ', '#7d1d1a', '🏥', 3],
      ['exam|avalia|assessment|test', 'Avaliação', '#a46a00', '📝', 4],
      ['working group|grupo de trabalho|procedure', 'Grupo de trabalho', '#5b3fa8', '🧩', 5],
      ['meeting|reuni', 'Reunião', '#1d7a8a', '👥', 6],
      ['.*', 'Outra actividade', '#65727a', '📌', 99]
    ];
    ts.getRange(2, 1, rows.length, 5).setValues(rows);
  }

  /* PARTICIPATION_RULES / OVERRIDES: menu a tendina */
  apValidation_(ss.getSheetByName('PARTICIPATION_RULES'), 'Include/Exclude', ['INCLUDE', 'EXCLUDE']);
  apValidation_(ss.getSheetByName('PARTICIPATION_RULES'), 'Active Y/N', ['Y', 'N']);
  apValidation_(ss.getSheetByName('PARTICIPATION_OVERRIDES'), 'Action', ['ADD', 'REMOVE']);
  ss.getSheetByName('PARTICIPATION_RULES').getRange(1, 1).setNote(
    'Una riga = chi partecipa alle attività di un\'area/tipo.\n' +
    'Training Area: area dell\'attività (* = tutte). Methodology Pattern: parole della Methodology (vuoto = tutte).\n' +
    'Participant Area: area delle persone che partecipano (SAME = stessa area dell\'attività). Participant Role: ruolo utente (vuoto = tutti).');

  /* fogli tecnici: protezione */
  ['USER_REGISTER', 'USER_TRAINING_AREA', 'AUDIT_LOG', 'SOURCE_STATUS', 'SOURCE_HEADERS'].forEach(n => {
    const sh = ss.getSheetByName(n);
    try {
      if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
        const p = sh.protect().setDescription('Activity Planning – solo lo script e l\'amministratore');
        p.removeEditors(p.getEditors().filter(x => x.getEmail() !== Session.getEffectiveUser().getEmail()));
      }
    } catch (e) { /* protezione non disponibile */ }
  });

  /* ordine dei fogli */
  Object.keys(AP_H).forEach((n, i) => { try { ss.setActiveSheet(ss.getSheetByName(n)); ss.moveActiveSheet(i + 1); } catch (e) { /* ignora */ } });
  ss.setActiveSheet(ss.getSheetByName('USER_REGISTER'));
  try { const s1 = ss.getSheetByName('Foglio1') || ss.getSheetByName('Sheet1'); if (s1 && s1.getLastRow() === 0) ss.deleteSheet(s1); } catch (e) { /* ignora */ }

  apAudit_(null, 'SETUP', 'APP', AP.VERSION, '', '', 'setup');
  apAlert_('ACTIVITY PLANNING PRONTO (Fase 1)\n\n' +
    '1. USER_REGISTER: scrivi un PIN nella colonna gialla e lancia "Applica nuovi PIN".\n' +
    '2. Menu "Diagnostica fonti": controlla SOURCE_STATUS e SOURCE_HEADERS.\n' +
    '3. Torna su Claude e lancia 7_AGGIORNA_Activity_Planning (pubblica la web app).');
}


function apEnsureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  headers.forEach(h => {
    if (cur.indexOf(h) < 0) {
      sh.getRange(1, cur.length + 1).setValue(h);
      cur.push(h);
    }
  });
  sh.getRange(1, 1, 1, cur.length).setFontWeight('bold').setBackground('#7d1d1a').setFontColor('#ffffff').setWrap(true);
  sh.setFrozenRows(1);
  return sh;
}

function apValidation_(sh, header, values) {
  if (!sh) return;
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  const c = head.indexOf(header);
  if (c < 0) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  sh.getRange(2, c + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}


/* ============================================================
   CONFIG E UTILITÀ
   ============================================================ */

let AP_CFG_CACHE_ = null;

function apCfg_(key) {
  if (!AP_CFG_CACHE_) {
    AP_CFG_CACHE_ = {};
    try {
      const sh = SpreadsheetApp.getActive().getSheetByName('CONFIG');
      if (sh && sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
          const k = apClean_(r[0]);
          if (k) AP_CFG_CACHE_[k] = r[1];
        });
      }
    } catch (e) { /* foglio non ancora creato */ }
  }
  const v = AP_CFG_CACHE_[key];
  if (v === undefined || v === '') return AP[key];
  return typeof AP[key] === 'number' ? Number(v) : v;
}

function apClean_(v) {
  return v === null || v === undefined ? '' : String(v).replace(/ /g, ' ').trim();
}

function apNorm_(v) {
  return apClean_(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

function apTz_() {
  return Session.getScriptTimeZone() || 'Africa/Luanda';
}

function apYmd_(d) {
  return Utilities.formatDate(d, apTz_(), 'yyyy-MM-dd');
}

function apAsDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0);
  const m = apClean_(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  const y = apClean_(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return y ? new Date(Number(y[1]), Number(y[2]) - 1, Number(y[3]), 12, 0, 0) : null;
}

/*
 * Ora di inizio "HH:mm" o '' (senza ora).
 * display = testo mostrato nel foglio ("15.00", "9.30", "15:00:00", "30/12/1899").
 * raw = valore della cella (Date del 30/12/1899 o frazione di giorno).
 * Le date del 1899 hanno un fuso storico (LMT): si arrotonda ai 5 minuti.
 */
function apTime_(display, raw) {
  const d = apClean_(display);
  const m = d.match(/(?:^|\s)(\d{1,2})[.:h](\d{2})(?:[.:]\d{2})?\s*$/i) || d.match(/^(\d{1,2})[.:h](\d{2})/i);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return apHm_(Number(m[1]) * 60 + Number(m[2]));
  const h = d.match(/^(\d{1,2})\s*h?$/i);
  if (h && Number(h[1]) < 24) return apHm_(Number(h[1]) * 60);
  if (typeof raw === 'number' && raw > 0 && raw < 1) return apHm_(Math.round(raw * 1440));
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const s = Utilities.formatDate(raw, apTz_(), 'HH:mm');
    let mins = Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
    if (raw.getFullYear() < 1900) mins = Math.round(mins / 5) * 5;
    return mins > 0 && mins < 1440 ? apHm_(mins) : '';
  }
  return '';
}

function apHm_(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function apMinutes_(hm) {
  const m = String(hm || '').match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/* numero da "60", "0,5", "1.20" */
function apNum_(v) {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = apClean_(v).replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function apYes_(v) {
  return /^(y|yes|s|sim|si|true|1)$/i.test(apClean_(v));
}

function apRe_(pattern) {
  try { return new RegExp(apNorm_(pattern) || '$^'); } catch (e) { return /$^/; }
}

function apAlert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

function apWithLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sistema ocupado. Tente novamente dentro de alguns segundos.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* Mappa intestazione normalizzata → indice */
function apHeaderMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const k = apNorm_(h);
    if (k && map[k] === undefined) map[k] = i;
  });
  return map;
}

/* Legge un foglio di questo file: { sh, headers, h, rows } */
function apRead_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Foglio ' + name + ' non trovato: lancia "Configura" dal menu Activity Planning.');
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const values = lastRow ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  const headers = values[0].map(String);
  return { sh: sh, headers: headers, h: apHeaderMap_(headers), rows: values.slice(1) };
}

function apGet_(t, row, name) {
  const i = t.h[apNorm_(name)];
  return i === undefined ? '' : row[i];
}

function apSet_(t, row, name, value) {
  const i = t.h[apNorm_(name)];
  if (i !== undefined) row[i] = value;
}

function apWriteRow_(t, index, row) {
  t.sh.getRange(index + 2, 1, 1, row.length).setValues([row]);
}

function apAppendRows_(name, objs) {
  if (!objs.length) return;
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const rows = objs.map(o => headers.map(h => (o[h] === undefined ? '' : o[h])));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}


/* ============================================================
   COLUMN_MAP: colonne delle fonti per nome
   ============================================================ */

let AP_COLMAP_CACHE_ = null;

/* { SOURCE: { field: { aliases: [...], required: bool } } } */
function apColumnMap_() {
  if (AP_COLMAP_CACHE_) return AP_COLMAP_CACHE_;
  const out = {};
  const put = (src, field, headers, req) => {
    out[src] = out[src] || {};
    out[src][field] = { aliases: apClean_(headers).split('|').map(apClean_).filter(Boolean), required: req };
  };
  AP_COLMAP_SEED.forEach(r => put(r[0], r[1], r[2], r[3] === 'Y'));
  try {
    const t = apRead_('COLUMN_MAP');
    t.rows.forEach(r => {
      const src = apClean_(apGet_(t, r, 'Source')).toUpperCase();
      const f = apClean_(apGet_(t, r, 'Field'));
      if (src && f && apClean_(apGet_(t, r, 'Source Headers'))) put(src, f, apGet_(t, r, 'Source Headers'), apYes_(apGet_(t, r, 'Required Y/N')));
    });
  } catch (e) { /* si usano i valori predefiniti */ }
  AP_COLMAP_CACHE_ = out;
  return out;
}

/* Indici delle colonne di una fonte: { c: {field: idx}, missing: [campi obbligatori assenti] } */
function apCols_(source, headers) {
  const map = apHeaderMap_(headers);
  const def = apColumnMap_()[source] || {};
  const c = {};
  const missing = [];
  Object.keys(def).forEach(f => {
    let idx = -1;
    for (let i = 0; i < def[f].aliases.length; i++) {
      const k = apNorm_(def[f].aliases[i]);
      if (map[k] !== undefined) { idx = map[k]; break; }
    }
    c[f] = idx;
    if (idx < 0 && def[f].required) missing.push(f + ' (' + def[f].aliases.join(' | ') + ')');
  });
  return { c: c, missing: missing };
}


/* ============================================================
   CACHE A BLOCCHI
   ============================================================ */

function apCacheGet_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + '_N') || 0);
  if (!n) return null;
  const keys = Array.from({ length: n }, (_, i) => key + '_' + i);
  const parts = cache.getAll(keys);
  if (Object.keys(parts).length !== n) return null;
  try { return JSON.parse(keys.map(k => parts[k]).join('')); } catch (e) { return null; }
}

function apCachePut_(key, obj, seconds) {
  const json = JSON.stringify(obj);
  const chunks = {};
  let k = 0;
  for (let i = 0; i < json.length; i += 90000) chunks[key + '_' + (k++)] = json.slice(i, i + 90000);
  chunks[key + '_N'] = String(k);
  try { CacheService.getScriptCache().putAll(chunks, Math.min(Number(seconds) || 300, 21600)); } catch (e) { /* troppo grande */ }
}

function apClearCache() {
  CacheService.getScriptCache().removeAll(['AP_ACTS_N', 'AP_HUB_N', 'AP_HOL_N']);
  apAlert_('Cache svuotata: l\'app rilegge subito piani mensili, Hub e festività.');
}


/* ============================================================
   UTENTI E PIN (lato amministratore)
   ============================================================ */

function apHash_(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pin + '|CHDCP-AP', Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function apNewUserId_(nome, apelido, existing) {
  const base = 'U-' + (apNorm_(nome).slice(0, 3) + apNorm_(apelido).replace(/\s+/g, '').slice(0, 3)).toUpperCase().replace(/[^A-Z]/g, 'X');
  let id = base;
  let n = 2;
  while (existing.indexOf(id) >= 0) id = base + (n++);
  return id;
}

/* Menu: crea ID mancanti, completa i default, cifra i PIN della colonna gialla, collega il Person ID */
function apApplyUserChanges() {
  const len = apCfg_('PIN_LENGTH');
  let hub = null;
  try { hub = apHub_(); } catch (e) { hub = null; }

  const res = apWithLock_(() => {
    const t = apRead_('USER_REGISTER');
    const ids = t.rows.map(r => apClean_(apGet_(t, r, 'User ID'))).filter(Boolean);
    let pins = 0, created = 0, linked = 0;
    const errors = [];

    t.rows.forEach((r, i) => {
      const nome = apClean_(apGet_(t, r, 'Nome'));
      if (!nome) return;
      let changed = false;
      const apelido = apClean_(apGet_(t, r, 'Apelido'));

      if (!apClean_(apGet_(t, r, 'User ID'))) {
        const id = apNewUserId_(nome, apelido, ids);
        ids.push(id);
        apSet_(t, r, 'User ID', id);
        apSet_(t, r, 'Created At', new Date());
        created++;
        changed = true;
      }
      const def = { 'Display Name': (nome + ' ' + apelido).trim(), 'Role': 'VIEWER', 'Visibility': 'OWN', 'Active Y/N': 'Y' };
      Object.keys(def).forEach(k => { if (!apClean_(apGet_(t, r, k))) { apSet_(t, r, k, def[k]); changed = true; } });

      if (hub && !apClean_(apGet_(t, r, 'Person ID'))) {
        const pid = apResolveName_(apGet_(t, r, 'Display Name'), hub).personId;
        if (pid) { apSet_(t, r, 'Person ID', pid); linked++; changed = true; }
      }

      const pin = apClean_(apGet_(t, r, 'Novo PIN (temporário)'));
      if (pin) {
        if (!new RegExp('^\\d{' + len + '}$').test(pin)) {
          errors.push(nome + ': il PIN deve avere ' + len + ' cifre');
        } else {
          const salt = Utilities.getUuid();
          apSet_(t, r, 'PIN Salt', salt);
          apSet_(t, r, 'PIN Hash', apHash_(pin, salt));
          apSet_(t, r, 'PIN Change Required Y/N', pin === AP_INITIAL_PIN_ ? 'Y' : 'N');
          apSet_(t, r, 'Failed Attempts', 0);
          apSet_(t, r, 'Locked Until', '');
          pins++;
          apAudit_(null, 'PIN SET', 'USER', apGet_(t, r, 'User ID'), '', '', '');
        }
        apSet_(t, r, 'Novo PIN (temporário)', '');
        changed = true;
      }
      if (changed) apWriteRow_(t, i, r);
    });
    return { pins: pins, created: created, linked: linked, errors: errors };
  });

  apAlert_('UTENTI\n\nID creati: ' + res.created + '\nPIN applicati: ' + res.pins + '\nPerson ID collegati dal Hub: ' + res.linked +
    (res.errors.length ? '\n\nErrori:\n- ' + res.errors.join('\n- ') : ''));
}


/* ============================================================
   SINCRONIZZAZIONE MASSIVA UTENTI DAL TRAINING HUB
   - Hub sempre in sola lettura
   - PEOPLE_MASTER + PERSON_TRAINING_AREA => TRAINEE
   - TOJ_APP_USERS => TRAINER
   - super users => ADMIN / FULL / ALL
   ============================================================ */

const AP_INITIAL_PIN_ = '1111';

const AP_SUPER_USERS_ = [
  'Andrea Landini',
  'Marta Assuncao',
  'Chiara Cavasassi',
  'Giulia Pani',
  'Marcello Mammana',
  'Claudia De Morais',
  'Chelsea De Castro'
];

function apNameParts_(name) {
  const p = apClean_(name).split(/\s+/).filter(Boolean);
  return { nome: p.shift() || '', apelido: p.join(' ') };
}

function apIsSuperUser_(name) {
  const k = apNameKey_(name);
  return AP_SUPER_USERS_.some(x => apNameKey_(x) === k);
}

function apImportedUserId_(pid, name, existingIds) {
  if (pid) {
    const base = 'U-' + apClean_(pid).replace(/^CHDCP-/i, '').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
    let id = base, n = 2;
    while (existingIds.indexOf(id) >= 0) id = base + '-' + (n++);
    return id;
  }
  const np = apNameParts_(name);
  return apNewUserId_(np.nome, np.apelido, existingIds);
}

/* Legge i trainer dal foglio TOJ_APP_USERS del Training Hub. Nessun PIN viene importato. */
function apHubTrainers_(hub) {
  const out = [];
  const ss = SpreadsheetApp.openById(apCfg_('HUB_FILE_ID'));
  const sh = ss.getSheetByName(AP_HUB_TRAINER_SHEET);
  if (!sh) return out;
  const v = sh.getDataRange().getValues();
  if (!v.length) return out;
  const h = apHeaderMap_(v[0].map(String));
  const ci = name => h[apNorm_(name)];
  const ixName = ci('Name'), ixAreas = ci('Areas'), ixActive = ci('Active');
  v.slice(1).forEach(r => {
    const name = ixName === undefined ? '' : apClean_(r[ixName]);
    if (!name) return;
    const av = ixActive === undefined ? '' : apClean_(r[ixActive]);
    if (/^(no|n|false|inactive)$/i.test(av)) return;
    const resolved = apResolveName_(name, hub);
    const rawAreas = ixAreas === undefined ? '' : apClean_(r[ixAreas]);
    const areas = rawAreas.split(/\s*[,;|/]\s*/).map(x => apAreaWith_(x, hub.areaAlias)).filter(Boolean);
    const uniq = [];
    areas.forEach(a => { if (uniq.indexOf(a) < 0) uniq.push(a); });
    out.push({ name: name, personId: resolved.personId || '', areas: uniq });
  });
  return out;
}

/* Indicizza USER_TRAINING_AREA: userId|area => riga */
function apMembershipIndex_(t) {
  const out = {};
  t.rows.forEach((r, i) => {
    const uid = apClean_(apGet_(t, r, 'User ID'));
    const area = apClean_(apGet_(t, r, 'Training Area')).toUpperCase();
    if (uid && area) out[uid + '|' + area] = { row: r, index: i };
  });
  return out;
}

function apHubAgendaAssignments_(hub) {
  const ss = SpreadsheetApp.openById(apCfg_('HUB_FILE_ID'));
  const sh = ss.getSheetByName(AP_HUB_AGENDA_SHEET);
  if (!sh) throw new Error('Nel Training Hub manca il foglio ' + AP_HUB_AGENDA_SHEET + '.');
  const v = sh.getDataRange().getValues();
  if (!v.length || v.length < 2) return [];
  const headers = v[0].map(x => apClean_(x));
  const h = apHeaderMap_(headers);
  const ixName = h[apNorm_('Nome')];
  const ixPid = h[apNorm_('Person ID')];
  const ixBase = h[apNorm_('Role Base')];
  if (ixName === undefined) throw new Error(AP_HUB_AGENDA_SHEET + ': colonna Nome mancante.');

  const reserved = { 'nome': true, 'person id': true, 'role base': true };
  const areaCols = [];
  headers.forEach((head, i) => {
    const n = apNorm_(head);
    if (!head || reserved[n]) return;
    areaCols.push({ index: i, area: apAreaWith_(head, hub.areaAlias) || apClean_(head).toUpperCase() });
  });

  const out = [];
  v.slice(1).forEach((r, rowOffset) => {
    const name = ixName === undefined ? '' : apClean_(r[ixName]);
    if (!name) return;
    const pid = ixPid === undefined ? '' : apClean_(r[ixPid]);
    const base = ixBase === undefined ? '' : apClean_(r[ixBase]).toUpperCase();
    const memberships = [];
    areaCols.forEach(c => {
      const role = apClean_(r[c.index]).toUpperCase();
      if (!role) return;
      if (role !== 'TRAINER' && role !== 'TRAINEE') {
        throw new Error(AP_HUB_AGENDA_SHEET + ' riga ' + (rowOffset + 2) + ': valore non valido in ' + headers[c.index] + ' per ' + name + ': ' + role);
      }
      memberships.push({ area: c.area, role: role });
    });
    let kind = base === 'TRAINER' ? 'TRAINER' : 'TRAINEE';
    if (memberships.some(m => m.role === 'TRAINER')) kind = 'TRAINER';
    out.push({ name: name, personId: pid, baseRole: base, kind: kind, memberships: memberships });
  });
  return out;
}

function apSyncUsersFromHub() {
  /* AGENDA_ASSIGNMENT è il master umano nel Training Hub.
     Questa funzione non scrive mai nel Training Hub: aggiorna solo i fogli locali. */
  const ss = SpreadsheetApp.getActive();
  apEnsureSheet_(ss, 'USER_TRAINING_AREA', AP_H.USER_TRAINING_AREA);
  apEnsureSheet_(ss, 'USER_REGISTER', AP_H.USER_REGISTER);
  apValidation_(ss.getSheetByName('USER_TRAINING_AREA'), 'Participation Role', ['TRAINER', 'TRAINEE']);
  apValidation_(ss.getSheetByName('USER_TRAINING_AREA'), 'Active Y/N', ['Y', 'N']);

  const res = apWithLock_(() => {
    const hub = apHub_();
    const assignments = apHubAgendaAssignments_(hub);
    const users = apRead_('USER_REGISTER');
    const uta = apRead_('USER_TRAINING_AREA');
    const existingIds = users.rows.map(r => apClean_(apGet_(users, r, 'User ID'))).filter(Boolean);

    const byPid = {}, byName = {};
    users.rows.forEach((r, i) => {
      const pid = apClean_(apGet_(users, r, 'Person ID'));
      const nk = apNameKey_(apGet_(users, r, 'Display Name'));
      if (pid) byPid[pid] = { row: r, index: i };
      if (nk) byName[nk] = { row: r, index: i };
    });

    let created = 0, updated = 0, traineeUsers = 0, trainerUsers = 0, superUsers = 0, initialPinsSet = 0;
    let membershipsCreated = 0, membershipsUpdated = 0, membershipsDisabled = 0;
    const desiredMemberships = {};
    const now = new Date();

    function ensureUser(name, pid, kind) {
      let hit = (pid && byPid[pid]) || byName[apNameKey_(name)];
      let r, idx, isNew = false;
      if (!hit) {
        r = Array(users.headers.length).fill('');
        idx = users.rows.length;
        const parts = apNameParts_(name);
        const id = apImportedUserId_(pid, name, existingIds);
        existingIds.push(id);
        apSet_(users, r, 'User ID', id);
        apSet_(users, r, 'Nome', parts.nome);
        apSet_(users, r, 'Apelido', parts.apelido);
        apSet_(users, r, 'Display Name', name);
        apSet_(users, r, 'Person ID', pid || '');
        apSet_(users, r, 'Created At', now);
        apSet_(users, r, 'Failed Attempts', 0);
        users.rows.push(r);
        hit = { row: r, index: idx };
        if (pid) byPid[pid] = hit;
        byName[apNameKey_(name)] = hit;
        created++; isNew = true;
      } else {
        r = hit.row; idx = hit.index;
      }

      const id = apClean_(apGet_(users, r, 'User ID'));
      const isSuper = apIsSuperUser_(name);
      const currentRole = apClean_(apGet_(users, r, 'Role')).toUpperCase();
      const elevated = ['ADMIN', 'MANAGER', 'COORDINATOR'].indexOf(currentRole) >= 0;
      const targetRole = isSuper ? 'ADMIN' : (kind === 'TRAINER' ? (elevated ? currentRole : 'TRAINER') : (currentRole || 'VIEWER'));
      let changed = false;
      function put(k, val, force) {
        if (force || !apClean_(apGet_(users, r, k))) {
          if (String(apGet_(users, r, k) || '') !== String(val || '')) { apSet_(users, r, k, val); changed = true; }
        }
      }
      put('Display Name', name, false);
      put('Person ID', pid || '', false);
      if (isSuper || kind === 'TRAINER' || !apClean_(apGet_(users, r, 'Role'))) put('Role', targetRole, true);
      if (isSuper) {
        put('Visibility', 'FULL', true);
        put('Training Area / Scope', 'ALL', true);
      } else if (!apClean_(apGet_(users, r, 'Visibility'))) {
        put('Visibility', 'OWN', true);
      }
      put('Active Y/N', 'Y', false);

      /* PIN iniziale comune solo per utenti che non hanno ancora un PIN.
         Al primo accesso il cambio PIN è obbligatorio. */
      if (!apClean_(apGet_(users, r, 'PIN Hash'))) {
        const salt = Utilities.getUuid();
        apSet_(users, r, 'PIN Salt', salt);
        apSet_(users, r, 'PIN Hash', apHash_(AP_INITIAL_PIN_, salt));
        apSet_(users, r, 'PIN Change Required Y/N', 'Y');
        apSet_(users, r, 'Failed Attempts', 0);
        apSet_(users, r, 'Locked Until', '');
        initialPinsSet++; changed = true;
      } else if (!apClean_(apGet_(users, r, 'PIN Change Required Y/N'))) {
        apSet_(users, r, 'PIN Change Required Y/N', 'N');
        changed = true;
      }

      put('Sync Source', 'HUB:AGENDA_ASSIGNMENT', true);
      put('Last Sync', now, true);
      if (changed && !isNew) updated++;
      if (isSuper) superUsers++;
      return { id: id, row: r, index: idx, super: isSuper };
    }

    assignments.forEach(a => {
      const u = ensureUser(a.name, a.personId, a.kind);
      if (a.kind === 'TRAINER') trainerUsers++; else traineeUsers++;
      a.memberships.forEach(m => {
        if (!m.area) return;
        const k = u.id + '|' + m.area;
        const prev = desiredMemberships[k];
        const role = (prev && prev.role === 'TRAINER') || m.role === 'TRAINER' ? 'TRAINER' : 'TRAINEE';
        desiredMemberships[k] = { uid: u.id, pid: a.personId || '', area: m.area, role: role, source: 'HUB:AGENDA_ASSIGNMENT' };
      });
    });

    /* I super user restano garantiti anche se qualcuno li cancella accidentalmente dalla matrice. */
    AP_SUPER_USERS_.forEach(name => ensureUser(name, '', 'TRAINER'));

    if (users.rows.length) users.sh.getRange(2, 1, users.rows.length, users.headers.length).setValues(users.rows.map(r => {
      while (r.length < users.headers.length) r.push('');
      return r.slice(0, users.headers.length);
    }));

    const mi = apMembershipIndex_(uta);
    Object.keys(desiredMemberships).forEach(k => {
      const m = desiredMemberships[k];
      const hit = mi[k];
      if (!hit) {
        const r = Array(uta.headers.length).fill('');
        apSet_(uta, r, 'User ID', m.uid);
        apSet_(uta, r, 'Person ID', m.pid);
        apSet_(uta, r, 'Training Area', m.area);
        apSet_(uta, r, 'Participation Role', m.role);
        apSet_(uta, r, 'Source', m.source);
        apSet_(uta, r, 'Active Y/N', 'Y');
        apSet_(uta, r, 'Synced At', now);
        uta.rows.push(r); membershipsCreated++;
      } else {
        const r = hit.row;
        const source = apClean_(apGet_(uta, r, 'Source'));
        if (source && source.indexOf('HUB:') !== 0) return; // manuale: non sovrascrivere
        let ch = false;
        const vals = {
          'Person ID': m.pid || apGet_(uta, r, 'Person ID'),
          'Participation Role': m.role,
          'Source': m.source,
          'Active Y/N': 'Y',
          'Synced At': now
        };
        Object.keys(vals).forEach(h => {
          if (String(apGet_(uta, r, h) || '') !== String(vals[h] || '')) { apSet_(uta, r, h, vals[h]); ch = true; }
        });
        if (ch) membershipsUpdated++;
      }
    });

    /* Disattiva le vecchie righe HUB non presenti nella nuova matrice. Le righe manuali restano intatte. */
    uta.rows.forEach(r => {
      const source = apClean_(apGet_(uta, r, 'Source'));
      if (source.indexOf('HUB:') !== 0) return;
      const k = apClean_(apGet_(uta, r, 'User ID')) + '|' + apClean_(apGet_(uta, r, 'Training Area')).toUpperCase();
      if (!desiredMemberships[k] && apYes_(apGet_(uta, r, 'Active Y/N'))) {
        apSet_(uta, r, 'Active Y/N', 'N');
        apSet_(uta, r, 'Synced At', now);
        membershipsDisabled++;
      }
    });

    if (uta.rows.length) uta.sh.getRange(2, 1, uta.rows.length, uta.headers.length).setValues(uta.rows.map(r => {
      while (r.length < uta.headers.length) r.push('');
      return r.slice(0, uta.headers.length);
    }));

    apClearHubCaches_();
    apAudit_(null, 'AGENDA ASSIGNMENT SYNC', 'APP', AP.VERSION, '', '', {
      usersCreated: created, usersUpdated: updated, trainees: traineeUsers, trainers: trainerUsers,
      membershipsCreated: membershipsCreated, membershipsUpdated: membershipsUpdated, membershipsDisabled: membershipsDisabled,
      initialPinsSet: initialPinsSet, sourceRows: assignments.length
    });

    return { created, updated, traineeUsers, trainerUsers, superUsers, membershipsCreated, membershipsUpdated, membershipsDisabled, initialPinsSet, sourceRows: assignments.length };
  });

  apAlert_('SINCRONIZZAZIONE AGENDE COMPLETATA\n\n' +
    'Fonte: Training Hub › ' + AP_HUB_AGENDA_SHEET +
    '\nPersone lette: ' + res.sourceRows +
    '\nUtenti creati: ' + res.created + '\nUtenti aggiornati: ' + res.updated +
    '\nTrainees: ' + res.traineeUsers + '\nTrainer: ' + res.trainerUsers +
    '\nMembership creati: ' + res.membershipsCreated + '\nMembership aggiornati: ' + res.membershipsUpdated +
    '\nMembership disattivati: ' + res.membershipsDisabled +
    '\nPIN iniziali 1111 impostati: ' + res.initialPinsSet +
    '\n\nIl Training Hub non è stato modificato. Il PIN 1111 viene assegnato solo agli utenti che non avevano ancora un PIN e deve essere cambiato al primo accesso.');
}

function apClearHubCaches_() {
  CacheService.getScriptCache().removeAll(['AP_HUB_N', 'AP_GOV_V1']);
}

function apUnlockUserPrompt() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Sblocca utente', 'User ID (colonna A di USER_REGISTER):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const id = apClean_(r.getResponseText());
  const ok = apWithLock_(() => {
    const t = apRead_('USER_REGISTER');
    const i = t.rows.findIndex(x => apClean_(apGet_(t, x, 'User ID')) === id);
    if (i < 0) return false;
    apSet_(t, t.rows[i], 'Failed Attempts', 0);
    apSet_(t, t.rows[i], 'Locked Until', '');
    apWriteRow_(t, i, t.rows[i]);
    return true;
  });
  if (ok) apAudit_(null, 'USER UNLOCK', 'USER', id, '', '', '');
  ui.alert(ok ? 'Utente sbloccato.' : 'User ID non trovato.');
}

function apShowAppLink() {
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { /* non pubblicata */ }
  const pwa = apClean_(apCfg_('PWA_ORIGIN'));
  apAlert_(url ? 'Link dell\'app:\n\n' + url + (pwa ? '\n\nGuscio PWA: ' + pwa : '') :
    'L\'app non è ancora pubblicata: lancia 7_AGGIORNA_Activity_Planning dal Mac.');
}


/* ============================================================
   AUDIT
   ============================================================ */

function apAudit_(user, action, entityType, entityId, activityId, oldValue, newValue) {
  try {
    apAppendRows_('AUDIT_LOG', [{
      'Timestamp': new Date(),
      'User ID': user ? user.id : 'ADMIN/SCRIPT',
      'Display Name': user ? user.name : '',
      'Role': user ? user.role : '',
      'Action': action,
      'Entity Type': entityType,
      'Entity ID': entityId,
      'Activity ID': activityId || '',
      'Old Value': typeof oldValue === 'object' ? JSON.stringify(oldValue) : (oldValue || ''),
      'New Value': typeof newValue === 'object' ? JSON.stringify(newValue) : (newValue || '')
    }]);
  } catch (e) {
    console.log('Audit non scritto: ' + e.message);
  }
}


/* ============================================================
   AUTENTICAZIONE (nome + PIN, sessione lato server)
   ============================================================ */

function apiUsers() {
  const t = apRead_('USER_REGISTER');
  const uta = apRead_('USER_TRAINING_AREA');
  const areasByUser = {};
  uta.rows.forEach(r => {
    if (!apYes_(apGet_(uta, r, 'Active Y/N'))) return;
    const uid = apClean_(apGet_(uta, r, 'User ID'));
    const area = apClean_(apGet_(uta, r, 'Training Area')).toUpperCase();
    if (!uid || !area) return;
    areasByUser[uid] = areasByUser[uid] || [];
    if (areasByUser[uid].indexOf(area) < 0) areasByUser[uid].push(area);
  });
  const users = t.rows
    .filter(r => apYes_(apGet_(t, r, 'Active Y/N')) && apClean_(apGet_(t, r, 'User ID')) && apClean_(apGet_(t, r, 'PIN Hash')))
    .map(r => {
      const id = apClean_(apGet_(t, r, 'User ID'));
      const areas = (areasByUser[id] || []).slice().sort();
      return {
        id: id,
        name: apClean_(apGet_(t, r, 'Display Name')),
        areas: areas,
        role: apClean_(apGet_(t, r, 'Role')).toUpperCase() || 'VIEWER',
        mustChangePin: apYes_(apGet_(t, r, 'PIN Change Required Y/N'))
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { users: users, pinLength: apCfg_('PIN_LENGTH') };
}

function apiLogin(userId, pin) {
  const id = apClean_(userId);
  const p = apClean_(pin);

  return apWithLock_(() => {
    const t = apRead_('USER_REGISTER');
    const i = t.rows.findIndex(r => apClean_(apGet_(t, r, 'User ID')) === id);
    if (i < 0) throw new Error('Utilizador não encontrado.');
    const r = t.rows[i];
    if (!apYes_(apGet_(t, r, 'Active Y/N'))) throw new Error('Utilizador inactivo. Contacte o administrador.');

    const lockedUntil = apGet_(t, r, 'Locked Until');
    if (lockedUntil instanceof Date && lockedUntil > new Date()) {
      throw new Error('Demasiadas tentativas. Tente de novo depois das ' + Utilities.formatDate(lockedUntil, apTz_(), 'HH:mm') + '.');
    }

    const ok = p && apHash_(p, apClean_(apGet_(t, r, 'PIN Salt'))) === apClean_(apGet_(t, r, 'PIN Hash'));
    if (!ok) {
      const n = (Number(apGet_(t, r, 'Failed Attempts')) || 0) + 1;
      apSet_(t, r, 'Failed Attempts', n);
      if (n >= apCfg_('MAX_FAILED')) {
        apSet_(t, r, 'Locked Until', new Date(Date.now() + apCfg_('LOCK_MINUTES') * 60000));
        apSet_(t, r, 'Failed Attempts', 0);
      }
      apWriteRow_(t, i, r);
      apAudit_({ id: id, name: apGet_(t, r, 'Display Name'), role: apGet_(t, r, 'Role') }, 'LOGIN FAILED', 'USER', id, '', '', 'tentativa ' + n);
      throw new Error(n >= apCfg_('MAX_FAILED') ? 'PIN errado. Utilizador bloqueado por ' + apCfg_('LOCK_MINUTES') + ' minutos.' : 'PIN errado.');
    }

    apSet_(t, r, 'Failed Attempts', 0);
    apSet_(t, r, 'Locked Until', '');
    apSet_(t, r, 'Last Login', new Date());
    apSet_(t, r, 'Last Activity', new Date());
    apWriteRow_(t, i, r);

    const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
    const exp = Date.now() + apCfg_('SESSION_DAYS') * 86400000;
    const props = PropertiesService.getScriptProperties();
    props.setProperty('APS_' + token, JSON.stringify({ u: id, exp: exp }));
    apCleanSessions_(props);

    const user = apUserFromRow_(t, r);
    const mustChangePin = apYes_(apGet_(t, r, 'PIN Change Required Y/N'));
    apAudit_(user, 'LOGIN', 'USER', id, '', '', '');
    return { token: token, user: apUserOut_(user), mustChangePin: mustChangePin };
  });
}

function apiLogout(token) {
  const s = apSession_(token, true);
  PropertiesService.getScriptProperties().deleteProperty('APS_' + apClean_(token));
  if (s) apAudit_(s, 'LOGOUT', 'USER', s.id, '', '', '');
  return true;
}

function apiResume(token) {
  const u = apSession_(token, true);
  if (!u) return null;
  const t = apRead_('USER_REGISTER');
  const r = t.rows.find(x => apClean_(apGet_(t, x, 'User ID')) === u.id);
  return { user: apUserOut_(u), mustChangePin: r ? apYes_(apGet_(t, r, 'PIN Change Required Y/N')) : false };
}

function apiChangeOwnPin(token, newPin, confirmPin) {
  const u = apSession_(token, false);
  const np = apClean_(newPin);
  const cp = apClean_(confirmPin);
  const len = Number(apCfg_('PIN_LENGTH')) || 4;
  if (!new RegExp('^\\d{' + len + '}$').test(np)) throw new Error('O novo PIN deve ter ' + len + ' algarismos.');
  if (np !== cp) throw new Error('Os dois PIN não coincidem.');
  if (np === AP_INITIAL_PIN_) throw new Error('Escolha um PIN diferente de ' + AP_INITIAL_PIN_ + '.');

  return apWithLock_(() => {
    const t = apRead_('USER_REGISTER');
    const i = t.rows.findIndex(r => apClean_(apGet_(t, r, 'User ID')) === u.id);
    if (i < 0) throw new Error('Utilizador não encontrado.');
    const r = t.rows[i];
    const salt = Utilities.getUuid();
    apSet_(t, r, 'PIN Salt', salt);
    apSet_(t, r, 'PIN Hash', apHash_(np, salt));
    apSet_(t, r, 'PIN Change Required Y/N', 'N');
    apSet_(t, r, 'Failed Attempts', 0);
    apSet_(t, r, 'Locked Until', '');
    apSet_(t, r, 'Last Activity', new Date());
    apWriteRow_(t, i, r);
    apAudit_(u, 'PIN CHANGE', 'USER', u.id, '', '', 'self service');
    return { ok: true };
  });
}

function apCleanSessions_(props) {
  const now = Date.now();
  const all = props.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('APS_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

function apUserFromRow_(t, r) {
  const scope = apClean_(apGet_(t, r, 'Training Area / Scope')).toUpperCase();
  const vis = apClean_(apGet_(t, r, 'Visibility')).toUpperCase();
  return {
    id: apClean_(apGet_(t, r, 'User ID')),
    name: apClean_(apGet_(t, r, 'Display Name')),
    first: apClean_(apGet_(t, r, 'Nome')),
    role: apClean_(apGet_(t, r, 'Role')).toUpperCase() || 'VIEWER',
    personId: apClean_(apGet_(t, r, 'Person ID')),
    visibility: AP.VISIBILITY.indexOf(vis) >= 0 ? vis : 'OWN',
    scopeAll: scope === 'ALL',
    scope: !scope || scope === 'ALL' ? null : scope.split(/\s*[,;|\/]\s*/).filter(Boolean),
    keys: apUserKeys_(t, r)
  };
}

/* Nomi con cui l'utente può comparire in Trainer/Responsible: Display Name, Nome + Apelido, Name Aliases (separati da |) */
function apUserKeys_(t, r) {
  const names = [apGet_(t, r, 'Display Name'), apClean_(apGet_(t, r, 'Nome')) + ' ' + apClean_(apGet_(t, r, 'Apelido'))]
    .concat(apClean_(apGet_(t, r, 'Name Aliases')).split('|'));
  const out = [];
  names.map(apNameKey_).filter(Boolean).forEach(k => { if (out.indexOf(k) < 0) out.push(k); });
  return out;
}

/* { chiave nome: User ID } di tutti gli utenti attivi */
function apUserKeyIndex_() {
  const idx = {};
  try {
    const t = apRead_('USER_REGISTER');
    t.rows.forEach(r => {
      const id = apClean_(apGet_(t, r, 'User ID'));
      if (id && apYes_(apGet_(t, r, 'Active Y/N'))) apUserKeys_(t, r).forEach(k => { idx[k] = id; });
    });
  } catch (e) { /* nessun utente */ }
  return idx;
}

function apUserOut_(u) {
  return { id: u.id, name: u.name, first: u.first, role: u.role, visibility: u.visibility, linked: !!u.personId };
}

/* Valida la sessione; con soft=true restituisce null invece di errore */
function apSession_(token, soft) {
  const tk = apClean_(token);
  const raw = tk ? PropertiesService.getScriptProperties().getProperty('APS_' + tk) : null;
  let s = null;
  try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
  if (!s || s.exp < Date.now()) {
    if (soft) return null;
    throw new Error('SESSION: a sessão expirou. Introduza o PIN.');
  }
  const t = apRead_('USER_REGISTER');
  const r = t.rows.find(x => apClean_(apGet_(t, x, 'User ID')) === s.u);
  if (!r || !apYes_(apGet_(t, r, 'Active Y/N'))) {
    if (soft) return null;
    throw new Error('SESSION: utilizador inactivo.');
  }
  const u = apUserFromRow_(t, r);
  u.mustChange = apYes_(apGet_(t, r, 'PIN Change Required Y/N'));
  return u;
}


/* ============================================================
   TRAINING HUB (persone, alias, aree) — sola lettura
   ============================================================ */

/*
 * { people: {pid: {name, active}}, byNorm: {nome normalizzato: pid}, byToken: {cognome: [pid]},
 *   areasOf: {pid: [area]}, homeOf: {pid: area}, areaAlias: {alias norm: AREA}, errors: [] }
 */
function apHub_() {
  const cached = apCacheGet_('AP_HUB');
  if (cached) return cached;

  const hub = { people: {}, byNorm: {}, byToken: {}, areasOf: {}, homeOf: {}, areaAlias: {}, errors: [] };
  const ss = SpreadsheetApp.openById(apCfg_('HUB_FILE_ID'));
  const read = src => {
    const sh = ss.getSheetByName(AP_HUB_SHEETS[src]);
    if (!sh) { hub.errors.push(AP_HUB_SHEETS[src] + ': foglio non trovato nel Hub'); return null; }
    const v = sh.getDataRange().getValues();
    const cols = apCols_(src, v[0].map(String));
    if (cols.missing.length) hub.errors.push(AP_HUB_SHEETS[src] + ': mancano ' + cols.missing.join(', '));
    return { rows: v.slice(1), c: cols.c };
  };
  const g = (t, r, f) => (t.c[f] >= 0 ? r[t.c[f]] : '');

  const area = read('HUB_AREA');
  if (area) area.rows.forEach(r => { const a = apNorm_(g(area, r, 'alias')); if (a) hub.areaAlias[a] = apClean_(g(area, r, 'area')).toUpperCase(); });

  const pm = read('HUB_PEOPLE');
  if (pm) pm.rows.forEach(r => {
    const pid = apClean_(g(pm, r, 'personId'));
    const name = apClean_(g(pm, r, 'name'));
    if (!pid || !name) return;
    const active = !/^(no|n|false|inactive)$/i.test(apClean_(g(pm, r, 'active')));
    hub.people[pid] = { name: name, active: active };
    hub.byNorm[apNorm_(name)] = pid;
    apNorm_(name).split(' ').filter(x => x.length > 2).forEach(tok => {
      hub.byToken[tok] = hub.byToken[tok] || [];
      if (hub.byToken[tok].indexOf(pid) < 0) hub.byToken[tok].push(pid);
    });
  });

  const al = read('HUB_ALIAS');
  if (al) al.rows.forEach(r => {
    const pid = apClean_(g(al, r, 'personId'));
    const a = apNorm_(g(al, r, 'alias'));
    if (pid && a) hub.byNorm[a] = pid;
  });

  const pta = read('HUB_PTA');
  if (pta) pta.rows.forEach(r => {
    const pid = apClean_(g(pta, r, 'personId'));
    if (!pid || /^(no|n|false)$/i.test(apClean_(g(pta, r, 'active')))) return;
    const a = apAreaWith_(g(pta, r, 'area'), hub.areaAlias);
    if (!a) return;
    hub.areasOf[pid] = hub.areasOf[pid] || [];
    if (hub.areasOf[pid].indexOf(a) < 0) hub.areasOf[pid].push(a);
    if (apYes_(g(pta, r, 'home'))) hub.homeOf[pid] = a;
  });

  apCachePut_('AP_HUB', hub, apCfg_('PEOPLE_CACHE_SECONDS') || 3600);
  return hub;
}

/* "MGT ", "NUR - COORD", "Nursing" → codice area del Hub */
function apAreaWith_(v, aliasMap) {
  const raw = apClean_(v);
  if (!raw) return '';
  const k = apNorm_(raw);
  if (aliasMap && aliasMap[k]) return aliasMap[k];
  const dashed = raw.toUpperCase().replace(/\s*[-–—]\s*/g, '-').replace(/\s+/g, ' ');
  if (aliasMap && aliasMap[apNorm_(dashed)]) return aliasMap[apNorm_(dashed)];
  return dashed;
}

/* "Cervellone - Tenca", "Rossi / Bianchi", "A & B" → nomi singoli */
function apSplitNames_(v) {
  return apClean_(v)
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\r\n]+/).join(' ; ')
    .split(/\s+[-–—]\s+|\s*\/\s*|\s*&\s*|\s*,\s*|\s*;\s*|\s+e\s+|\s+and\s+|\s*\+\s*/i)
    .map(apClean_)
    .filter(x => x && !/^(tbd|tbc|n\/?a|-|a definir|por definir|da definire)$/i.test(x));
}

/* Chiave di confronto dei nomi: senza titoli, accenti, spazi doppi */
function apNameKey_(name) {
  return apNorm_(name).replace(/^(dr|dra|prof|enf|sr|sra)\.?\s+/, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Nome → { name, personId } (alias, nome esatto, cognome univoco) */
function apResolveName_(name, hub) {
  const n = apNorm_(name).replace(/^(dr|dra|prof|enf|sr|sra)\.?\s+/, '');
  if (!n) return { name: apClean_(name), personId: '' };
  if (hub.byNorm[n]) return { name: apClean_(name), personId: hub.byNorm[n] };
  const toks = n.split(' ').filter(x => x.length > 2);
  if (toks.length === 1 && hub.byToken[toks[0]] && hub.byToken[toks[0]].length === 1) {
    return { name: apClean_(name), personId: hub.byToken[toks[0]][0] };
  }
  if (toks.length >= 2) {
    const cand = toks.map(t => hub.byToken[t] || []);
    const both = cand[0].filter(pid => cand.slice(1).every(c => c.indexOf(pid) >= 0));
    if (both.length === 1) return { name: apClean_(name), personId: both[0] };
  }
  return { name: apClean_(name), personId: '' };
}


/* ============================================================
   FESTIVITÀ
   ============================================================ */

function apReadHolidayRows_(fileId) {
  const sh = fileId ? SpreadsheetApp.openById(fileId).getSheetByName('HOLIDAYS') : null;
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().filter(r => apAsDate_(r[0]));
}

/* { 'yyyy-MM-dd': descrizione } */
function apHolidays_() {
  const cached = apCacheGet_('AP_HOL');
  if (cached) return cached;
  let rows = [];
  const src = apClean_(apCfg_('HOLIDAYS_SOURCE_FILE_ID'));
  try { rows = apReadHolidayRows_(src); } catch (e) { rows = []; }
  if (!rows.length) {
    try { const t = apRead_('HOLIDAYS'); rows = t.rows; } catch (e) { rows = []; }
  }
  const set = {};
  rows.forEach(r => {
    const d = apAsDate_(r[0]);
    if (d && (apClean_(r[2]) === '' || apYes_(r[2]))) set[apYmd_(d)] = apClean_(r[1]) || 'Feriado';
  });
  apCachePut_('AP_HOL', set, 21600);
  return set;
}

/* Feriado nel giorno, il giorno utile prima o dopo (come Local Conditions) */
function apHolidayFlag_(date, holidays) {
  const wk = d => d.getDay() !== 0 && d.getDay() !== 6;
  const at = d => (wk(d) && holidays[apYmd_(d)]) ? holidays[apYmd_(d)] : '';
  const fmt = d => ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  if (holidays[apYmd_(base)]) return { kind: 'ON', name: holidays[apYmd_(base)], date: fmt(base) };
  if (!wk(base)) return null;
  const nx = new Date(base); do { nx.setDate(nx.getDate() + 1); } while (!wk(nx));
  if (at(nx)) return { kind: 'BEFORE', name: at(nx), date: fmt(nx) };
  const pv = new Date(base); do { pv.setDate(pv.getDate() - 1); } while (!wk(pv));
  if (at(pv)) return { kind: 'AFTER', name: at(pv), date: fmt(pv) };
  return null;
}


/* ============================================================
   ATTIVITÀ DAI PIANI MENSILI
   ============================================================ */

function apActivities_() {
  const cached = apCacheGet_('AP_ACTS');
  if (cached) return cached;
  const res = apReadActivities_();
  apCachePut_('AP_ACTS', res, apCfg_('CACHE_SECONDS'));
  return res;
}

/* Mesi della finestra [{m, y}] */
function apWindow_() {
  const today = apAsDate_(new Date());
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - apCfg_('WINDOW_PAST_DAYS'), 12);
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + apCfg_('WINDOW_FUTURE_DAYS'), 12);
  const months = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push({ m: d.getMonth() + 1, y: d.getFullYear() });
  }
  return { from: from, to: to, months: months };
}

/* Righe del registro: [{m, y, fileId, active}] */
function apRegistry_() {
  const ops = SpreadsheetApp.openById(apCfg_('OPS_FILE_ID'));
  const reg = ops.getSheetByName(AP.REGISTRY_SHEET);
  if (!reg) throw new Error('Registro ' + AP.REGISTRY_SHEET + ' non trovato in CHDCP Operations.');
  const v = reg.getDataRange().getValues();
  const cols = apCols_('REGISTRY', v[0].map(String));
  if (cols.missing.length) throw new Error(AP.REGISTRY_SHEET + ': mancano ' + cols.missing.join(', '));
  const c = cols.c;
  return v.slice(1).map(r => ({
    m: Number(r[c.month]), y: Number(r[c.year]), fileId: apClean_(r[c.fileId]),
    active: c.status < 0 || apClean_(r[c.status]).toUpperCase() === 'ACTIVE'
  })).filter(x => x.fileId && x.m && x.y);
}

/*
 * Legge un piano mensile. Restituisce { acts: [...], stats: {...} }.
 * opts.from/opts.to: limiti di data (Date); opts.seen: Activity ID già visti.
 */
function apReadPlan_(fileId, opts) {
  const stats = { rows: 0, shown: 0, hidden: 0, noId: 0, dup: 0, missing: [], error: '' };
  const acts = [];
  let sh;
  try {
    sh = SpreadsheetApp.openById(fileId).getSheetByName(opts.sheet || AP.PLAN_SHEET);
  } catch (e) {
    stats.error = 'Senza accesso al file (' + e.message + ')';
    return { acts: acts, stats: stats };
  }
  if (!sh) { stats.error = 'Foglio ' + (opts.sheet || AP.PLAN_SHEET) + ' non trovato'; return { acts: acts, stats: stats }; }

  const range = sh.getDataRange();
  const v = range.getValues();
  const cols = apCols_('PLAN', v[0].map(String));
  stats.missing = cols.missing;
  if (cols.missing.length) { stats.error = 'Colonne obbligatorie mancanti'; return { acts: acts, stats: stats }; }
  const c = cols.c;
  /*
   * Date e ora vanno lette come testo mostrato nel foglio sorgente.
   * Evita slittamenti di un giorno quando il fuso del piano mensile
   * differisce dal fuso dello script (es. Europe/Rome vs Africa/Luanda).
   */
  const dv = c.date >= 0 ? sh.getRange(1, c.date + 1, v.length, 1).getDisplayValues() : null;
  const tv = c.time >= 0 ? sh.getRange(1, c.time + 1, v.length, 1).getDisplayValues() : null;
  const g = (r, k) => (c[k] >= 0 ? r[c[k]] : '');

  const hub = opts.hub || { areaAlias: {}, byNorm: {}, byToken: {} };
  const holidays = opts.holidays || {};
  const reTent = apRe_(apCfg_('STATUS_TENTATIVE'));
  const reDone = apRe_(apCfg_('EXEC_DONE'));
  const reHide = apRe_(apCfg_('EXEC_HIDDEN'));
  const reAsync = apRe_(apCfg_('ASYNC_PATTERN'));
  const defDur = apCfg_('DEFAULT_DURATION_MIN');

  v.slice(1).forEach((r, ri) => {
    const title = apClean_(g(r, 'title'));
    const date = apAsDate_(dv ? dv[ri + 1][0] : '') || apAsDate_(g(r, 'date'));
    if (!title && !date) return;
    stats.rows++;
    if (!date || (opts.from && date < opts.from) || (opts.to && date > opts.to)) return;
    if (opts.months && !opts.months[(date.getMonth() + 1) + '/' + date.getFullYear()]) return;
    const id = apClean_(g(r, 'id'));
    if (!id) { stats.noId++; return; }
    if (opts.seen) {
      if (opts.seen[id]) { stats.dup++; return; }
      opts.seen[id] = true;
    }

    const status = apClean_(g(r, 'status'));
    const exec = apClean_(g(r, 'execution'));
    const platform = apClean_(g(r, 'platform'));
    const method = apClean_(g(r, 'methodology'));
    const hidden = reHide.test(apNorm_(exec)) || reHide.test(apNorm_(status));
    const isAsync = reAsync.test(apNorm_(platform)) || reAsync.test(apNorm_(method));

    let start = isAsync ? '' : apTime_(tv ? tv[ri + 1][0] : '', g(r, 'time'));
    let dur = apNum_(g(r, 'durationMin'));
    if (!dur) { const h = apNum_(g(r, 'durationH')); dur = h ? Math.round(h * 60) : null; }
    const end = start ? apHm_(apMinutes_(start) + (dur || defDur)) : '';

    const trainers = apSplitNames_(g(r, 'trainer')).map(n => {
      const x = apResolveName_(n, hub);
      return { n: x.name, p: x.personId, k: apNameKey_(n) };
    });
    const destination = apClean_(g(r, 'destination'));
    const room = apClean_(g(r, 'room'));

    if (hidden) stats.hidden++; else stats.shown++;
    acts.push({
      id: id,
      date: apYmd_(date),
      dow: date.getDay(),
      start: start,
      end: end,
      dur: dur || null,
      noTime: !start,
      async: isAsync,
      area: apAreaWith_(g(r, 'area'), hub.areaAlias),
      title: apShortTitle_(title),
      fullTitle: title,
      method: method,
      platform: platform,
      trainers: trainers,
      status: status,
      exec: exec,
      tentative: reTent.test(apNorm_(status)),
      done: reDone.test(apNorm_(exec)) && !/^(not|nao|non)\b/.test(apNorm_(exec)),
      hidden: hidden,
      place: [destination, room].filter(Boolean).join(' · '),
      destination: destination,
      room: room,
      translator: apClean_(g(r, 'translator')),
      target: apClean_(g(r, 'target')),
      training: apYes_(g(r, 'training')),
      notes: apClean_(g(r, 'notes')),
      type: apClean_(g(r, 'type')),
      assessment: apClean_(g(r, 'assessment')),
      attendanceReq: apClean_(g(r, 'attendanceReq')),
      holiday: apHolidayFlag_(date, holidays),
      provisional: !!opts.provisional,
      src: fileId
    });
  });
  return { acts: acts, stats: stats };
}

function apReadActivities_() {
  const w = apWindow_();
  let hub;
  try { hub = apHub_(); } catch (e) { hub = { areaAlias: {}, byNorm: {}, byToken: {}, errors: ['Hub non leggibile: ' + e.message] }; }
  const holidays = apHolidays_();
  const reg = apRegistry_();
  const seen = {};
  const out = [];
  const missingMonths = [];
  const problems = [];

  w.months.forEach(mo => {
    const row = reg.find(x => x.m === mo.m && x.y === mo.y && x.active);
    const label = String(mo.m).padStart(2, '0') + '/' + mo.y;
    if (!row) { missingMonths.push(label); return; }
    const res = apReadPlan_(row.fileId, { from: w.from, to: w.to, seen: seen, hub: hub, holidays: holidays });
    if (res.stats.error) problems.push(label + ': ' + res.stats.error);
    Array.prototype.push.apply(out, res.acts);
  });

  /* mesi senza piano mensile: master "Activity Planning" di Operations (provvisorio) */
  const fb = apMasterFallback_(missingMonths, w, seen, hub, holidays);
  if (fb.error) problems.push('Activity Planning (master): ' + fb.error);
  Array.prototype.push.apply(out, fb.acts);

  out.sort((a, b) => (a.date + (a.start || '99:99') + a.title).localeCompare(b.date + (b.start || '99:99') + b.title));
  return {
    list: out, missingMonths: missingMonths, problems: problems.concat(hub.errors || []),
    from: apYmd_(w.from), to: apYmd_(w.to), readAt: new Date().getTime()
  };
}

/* Legge dal master solo i mesi senza piano mensile ('MM/yyyy') */
function apMasterFallback_(missingMonths, w, seen, hub, holidays) {
  if (!missingMonths.length || !/^on$/i.test(apClean_(apCfg_('MASTER_FALLBACK')))) return { acts: [], stats: null, error: '' };
  const months = {};
  missingMonths.forEach(l => { const p = l.split('/'); months[Number(p[0]) + '/' + Number(p[1])] = true; });
  const res = apReadPlan_(apCfg_('OPS_FILE_ID'), { sheet: AP.MASTER_SHEET, from: w.from, to: w.to, months: months, seen: seen,
    hub: hub, holidays: holidays, provisional: true });
  return { acts: res.acts, stats: res.stats, error: res.stats.error };
}

/* "Live_Frontal Lesson_Fundamentos…" → "Fundamentos…" */
function apShortTitle_(t) {
  const parts = apClean_(t).split('_');
  if (parts.length >= 3 && /^(live|remote|hybrid|online|presencial|remoto|hibrid)/i.test(parts[0])) {
    return parts.slice(2).join(' ').trim() || apClean_(t);
  }
  return apClean_(t);
}




/* ============================================================
   GOVERNANCE ASSIGNMENT
   - Il Training Hub resta in sola lettura.
   - GOVERNANCE_ASSIGNMENT assegna persone a procedure/protocolli.
   - Le assegnazioni governance NON sono Training Area e non modificano
     USER_TRAINING_AREA: servono solo a calcolare partecipazione/visibilità.
   ============================================================ */

function apGovernanceData_() {
  const cache = CacheService.getScriptCache();
  const ck = 'AP_GOV_V1';
  const cached = cache.get(ck);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* rileggi */ }
  }

  const out = { byPid: {}, byName: {}, workstreams: [] };
  const ss = SpreadsheetApp.openById(apCfg_('HUB_FILE_ID'));
  const sh = ss.getSheetByName(AP_HUB_GOVERNANCE_SHEET);
  if (!sh) return out;
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return out;

  const headers = v[0].map(x => apClean_(x));
  const h = apHeaderMap_(headers);
  const ixName = h[apNorm_('Nome')];
  const ixPid = h[apNorm_('Person ID')];
  const ixActive = h[apNorm_('Active Y/N')];
  if (ixName === undefined) return out;

  const reserved = {
    'nome': true, 'person id': true, 'organisation': true,
    'notes / role': true, 'active y/n': true
  };
  const wsCols = [];
  headers.forEach((head, i) => {
    const n = apNorm_(head);
    if (!head || reserved[n]) return;
    wsCols.push({ index: i, name: apClean_(head), key: apGovKey_(head) });
  });
  out.workstreams = wsCols.map(x => x.name);

  v.slice(1).forEach(r => {
    const name = apClean_(r[ixName]);
    if (!name) return;
    if (ixActive !== undefined) {
      const av = apClean_(r[ixActive]);
      if (av && !apYes_(av)) return;
    }
    const pid = ixPid === undefined ? '' : apClean_(r[ixPid]);
    const roles = {};
    wsCols.forEach(c => {
      const role = apClean_(r[c.index]);
      if (role) roles[c.key] = role;
    });
    const rec = { name: name, personId: pid, roles: roles };
    if (pid) out.byPid[pid] = rec;
    out.byName[apNameKey_(name)] = rec;
  });

  try { cache.put(ck, JSON.stringify(out), Math.min(1800, Number(apCfg_('CACHE_SECONDS')) || 300)); } catch (e) { /* cache best effort */ }
  return out;
}

function apGovKey_(s) {
  const n = apNorm_(s);
  if (/surgical list|lista cirurg|lista de espera/.test(n)) return 'SURGICAL_LIST';
  if (/data management|data mgt|gestao de dados|gestão de dados/.test(n)) return 'DATA_MANAGEMENT';
  if (/procurement|aprovisionamento|aquisicao|aquisição/.test(n)) return 'PROCUREMENT';
  if (/supply chain|cadeia de abastecimento/.test(n)) return 'SUPPLY_CHAIN';
  if (/\bpicc\b/.test(n)) return 'PICC';
  if (/hand hygiene|higiene das maos|higiene das mãos/.test(n)) return 'HAND_HYGIENE';
  return apClean_(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/* Riconosce solo workstream governance, evitando di trasformare in protocollo
   le normali lezioni/TOJ PICC o Hand Hygiene. Le quattro procedure core hanno
   invece aree operative dedicate nella fonte. */
function apActivityGovernance_(act) {
  const area = apNorm_(act.area);
  const method = apNorm_(act.method);
  const text = apNorm_([act.fullTitle, act.title, act.target, act.notes].join(' '));

  if (/surgical list|lista cirurg|lista de espera/.test(area)) return { key: 'SURGICAL_LIST', name: 'Surgical List', type: 'PROCEDURE' };
  if (/data mgt|data management|gestao de dados|gestão de dados/.test(area)) return { key: 'DATA_MANAGEMENT', name: 'Data Management', type: 'PROCEDURE' };
  if (/^pr$|procurement|aprovisionamento/.test(area)) return { key: 'PROCUREMENT', name: 'Procurement', type: 'PROCEDURE' };
  if (/^sc$|supply chain|cadeia de abastecimento/.test(area)) return { key: 'SUPPLY_CHAIN', name: 'Supply Chain', type: 'PROCEDURE' };

  const govMethod = /protocol|procedur|working group|grupo de trabalho|technical working group/.test(method);
  if (govMethod && /\bpicc\b/.test(text)) return { key: 'PICC', name: 'PICC', type: 'PROTOCOL' };
  if (govMethod && /hand hygiene|higiene das maos|higiene das mãos/.test(text)) return { key: 'HAND_HYGIENE', name: 'Hand Hygiene', type: 'PROTOCOL' };
  return null;
}

function apUserGovernanceRole_(user, act, govData) {
  const g = apActivityGovernance_(act);
  if (!g) return '';
  govData = govData || apGovernanceData_();
  const rec = (user.personId && govData.byPid[user.personId]) || govData.byName[apNameKey_(user.name || user.displayName || '')];
  if (!rec || !rec.roles || !rec.roles[g.key]) return '';
  return rec.roles[g.key];
}


/* ============================================================
   PARTECIPAZIONE E VISIBILITÀ (lato server)
   ============================================================ */

function apRules_() {
  const out = { rules: [], overrides: {} };
  try {
    const t = apRead_('PARTICIPATION_RULES');
    t.rows.forEach(r => {
      if (!apYes_(apGet_(t, r, 'Active Y/N'))) return;
      out.rules.push({
        area: apClean_(apGet_(t, r, 'Training Area')).toUpperCase() || '*',
        method: apClean_(apGet_(t, r, 'Methodology Pattern')),
        pArea: apClean_(apGet_(t, r, 'Participant Area')).toUpperCase(),
        pRole: apClean_(apGet_(t, r, 'Participant Role')).toUpperCase(),
        exclude: /^excl/i.test(apClean_(apGet_(t, r, 'Include/Exclude')))
      });
    });
  } catch (e) { /* nessuna regola */ }
  try {
    const t = apRead_('PARTICIPATION_OVERRIDES');
    t.rows.forEach(r => {
      const id = apClean_(apGet_(t, r, 'Activity ID'));
      if (!id) return;
      (out.overrides[id] = out.overrides[id] || []).push({
        pid: apClean_(apGet_(t, r, 'Person ID')),
        uid: apClean_(apGet_(t, r, 'User ID')),
        remove: /^rem/i.test(apClean_(apGet_(t, r, 'Action')))
      });
    });
  } catch (e) { /* nessun override */ }
  return out;
}

/* Membership area/ruolo sincronizzati dal Training Hub. */
function apUserMemberships_(user) {
  const out = [];
  try {
    const t = apRead_('USER_TRAINING_AREA');
    t.rows.forEach(r => {
      if (!apYes_(apGet_(t, r, 'Active Y/N'))) return;
      if (apClean_(apGet_(t, r, 'User ID')) !== user.id) return;
      const area = apClean_(apGet_(t, r, 'Training Area')).toUpperCase();
      const role = apClean_(apGet_(t, r, 'Participation Role')).toUpperCase();
      if (area && (role === 'TRAINER' || role === 'TRAINEE')) out.push({ area: area, role: role });
    });
  } catch (e) { /* compatibilità con installazioni precedenti */ }
  return out;
}

/* Aree dell'utente: USER_TRAINING_AREA -> Scope -> Hub. */
function apUserAreas_(user, hub, memberships) {
  memberships = memberships || apUserMemberships_(user);
  const fromMembership = [];
  memberships.forEach(m => { if (fromMembership.indexOf(m.area) < 0) fromMembership.push(m.area); });
  if (fromMembership.length) return fromMembership;
  if (user.scope) return user.scope.map(a => apAreaWith_(a, hub.areaAlias));
  return (user.personId && hub.areasOf && hub.areasOf[user.personId]) || [];
}

/* '' | 'TRAINER' | 'PARTICIPANT' */
function apRole_(user, act, areas, rules, memberships, govData) {
  const ov = (rules.overrides[act.id] || []).filter(o => (o.pid && o.pid === user.personId) || (o.uid && o.uid === user.id));
  if (ov.some(o => o.remove)) return '';
  const keys = user.keys || [];
  if (act.trainers.some(t => (user.personId && t.p === user.personId) || (t.k && keys.indexOf(t.k) >= 0))) return 'TRAINER';
  if (ov.length) return 'PARTICIPANT';

  /* Procedure/protocolli: membership esplicita dal master GOVERNANCE_ASSIGNMENT.
     LEAD/MEMBER/SUPPORT sono ruoli di governance, non ruoli formativi: nell'agenda
     valgono come partecipazione, non come FORMADOR. */
  if (apUserGovernanceRole_(user, act, govData)) return 'PARTICIPANT';

  memberships = memberships || [];
  const isTrainer = user.role === 'TRAINER' || memberships.some(m => m.role === 'TRAINER');

  /* Regola core concordata: sulle attività ALL partecipano tutti i trainer. */
  let base = '';
  if (act.area === 'ALL' && isTrainer) base = 'TRAINER';
  else {
    const same = memberships.filter(m => m.area === act.area);
    if (same.some(m => m.role === 'TRAINER')) base = 'TRAINER';
    else if (same.some(m => m.role === 'TRAINEE')) base = 'PARTICIPANT';
  }

  /* PARTICIPATION_RULES resta un livello di affinamento; può aggiungere o escludere. */
  let inc = base;
  rules.rules.forEach(r => {
    if (r.area !== '*' && r.area !== act.area) return;
    if (r.method && !apRe_(r.method).test(apNorm_(act.method))) return;
    const pa = r.pArea === 'SAME' ? act.area : r.pArea;
    if (pa && pa !== '*' && areas.indexOf(pa) < 0) return;
    if (r.pRole && r.pRole !== user.role) return;
    if (r.exclude) inc = ''; else if (!inc) inc = 'PARTICIPANT';
  });
  return inc;
}

function apVisible_(user, act, role, areas) {
  if (user.visibility === 'FULL' || user.scopeAll) return true;
  if (role) return true;
  return user.visibility === 'AREA' && areas.indexOf(act.area) >= 0;
}


/* ============================================================
   API DELL'APP (Fase 2: agenda)
   ============================================================ */

/* Stili dei tipi: configurabili nel foglio TYPE_STYLE. */
function apTypeStyles_() {
  const out = [];
  try {
    const t = apRead_('TYPE_STYLE');
    t.rows.forEach(r => {
      const pattern = apClean_(apGet_(t, r, 'Methodology Pattern'));
      if (!pattern) return;
      out.push({
        pattern: pattern,
        label: apClean_(apGet_(t, r, 'Label PT')) || 'Outra actividade',
        color: apClean_(apGet_(t, r, 'Color')) || '#65727a',
        icon: apClean_(apGet_(t, r, 'Icon')) || '📌',
        order: apNum_(apGet_(t, r, 'Order')) || 99
      });
    });
  } catch (e) { /* usa fallback */ }
  if (!out.length) out.push({ pattern: '.*', label: 'Outra actividade', color: '#65727a', icon: '📌', order: 99 });
  out.sort((a, b) => a.order - b.order);
  return out;
}

function apTypeStyleFor_(method, styles) {
  const m = apNorm_(method);
  for (let i = 0; i < styles.length; i++) {
    try { if (new RegExp(styles[i].pattern, 'i').test(m)) return styles[i]; } catch (e) { /* pattern non valido: salta */ }
  }
  return { label: 'Outra actividade', color: '#65727a', icon: '📌', order: 99 };
}

function apIsoAdd_(ymd, days) {
  const p = String(ymd || '').split('-').map(Number);
  if (p.length !== 3 || !p[0]) return '';
  const d = new Date(p[0], p[1] - 1, p[2] + days, 12);
  return apYmd_(d);
}

function apWeekBounds_(anchor) {
  const p = String(anchor || '').split('-').map(Number);
  let d = p.length === 3 && p[0] ? new Date(p[0], p[1] - 1, p[2], 12) : apAsDate_(new Date());
  const delta = (d.getDay() + 6) % 7; // lunedì = 0
  d.setDate(d.getDate() - delta);
  const from = apYmd_(d);
  d.setDate(d.getDate() + 6);
  return { from: from, to: apYmd_(d) };
}

function apAgendaDateBounds_(opts, today) {
  const view = String(opts.view || 'WEEK').toUpperCase();
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.anchor || '')) ? String(opts.anchor) : today;
  if (view === 'TODAY') return { from: anchor, to: anchor, anchor: anchor };
  if (view === 'WEEK') { const w = apWeekBounds_(anchor); return { from: w.from, to: w.to, anchor: anchor }; }
  return { from: '', to: '', anchor: anchor }; // LISTA = tutta la finestra caricata
}

function apHolidayList_(from, to) {
  const hol = apHolidays_();
  return Object.keys(hol).filter(d => (!from || d >= from) && (!to || d <= to)).sort().map(d => ({ date: d, name: hol[d] }));
}

/*
 * Agenda dell'utente nella finestra configurata.
 * Filtri di contenuto applicati sempre lato server.
 * opts: { view, anchor, showHidden, mine, area, method, search }
 */
function apiAgenda(token, opts) {
  const user = apSession_(token);
  opts = opts || {};
  const data = apActivities_();
  let hub;
  try { hub = apHub_(); } catch (e) { hub = { areaAlias: {}, areasOf: {} }; }
  const rules = apRules_();
  const memberships = apUserMemberships_(user);
  const areas = apUserAreas_(user, hub, memberships);
  let govData;
  try { govData = apGovernanceData_(); } catch (e) { govData = { byPid: {}, byName: {}, workstreams: [] }; }
  const styles = apTypeStyles_();
  const today = apYmd_(new Date());
  const bounds = apAgendaDateBounds_(opts, today);
  const areaFilter = apNorm_(opts.area);
  const methodFilter = apNorm_(opts.method);
  const search = apNorm_(opts.search);

  /* Prima calcola il perimetro visibile: serve anche per le faccette dei filtri. */
  const visible = [];
  data.list.forEach(a => {
    if (a.hidden && !opts.showHidden) return;
    const role = apRole_(user, a, areas, rules, memberships, govData);
    if (!apVisible_(user, a, role, areas)) return;
    visible.push({ a: a, role: role });
  });

  const facetAreas = {};
  const facetMethods = {};
  visible.forEach(x => {
    if (x.a.area) facetAreas[x.a.area] = true;
    if (x.a.method) facetMethods[x.a.method] = true;
  });

  const list = [];
  visible.forEach(x => {
    const a = x.a;
    if (opts.mine && !x.role) return;
    if (bounds.from && a.date < bounds.from) return;
    if (bounds.to && a.date > bounds.to) return;
    if (areaFilter && apNorm_(a.area) !== areaFilter && apNorm_(a.area) !== 'all') return;
    if (methodFilter && apNorm_(a.method) !== methodFilter) return;
    if (search) {
      const hay = apNorm_([a.title, a.fullTitle, a.area, a.method, a.platform, a.place, a.status, a.exec]
        .concat(a.trainers.map(t => t.n)).join(' '));
      if (hay.indexOf(search) < 0) return;
    }
    list.push(apActOut_(a, x.role, styles));
  });

  apTouchUser_(user.id);
  return {
    user: apUserOut_(user),
    areas: areas,
    list: list,
    facets: {
      areas: Object.keys(facetAreas).sort(),
      methods: Object.keys(facetMethods).sort()
    },
    holidays: apHolidayList_(bounds.from || data.from, bounds.to || data.to),
    viewFrom: bounds.from || data.from,
    viewTo: bounds.to || data.to,
    anchor: bounds.anchor,
    from: data.from,
    to: data.to,
    readAt: data.readAt,
    warnings: user.role === 'ADMIN' ? data.missingMonths.map(m => 'Sem plano mensal: ' + m + (/^on$/i.test(apClean_(apCfg_('MASTER_FALLBACK'))) ? ' (mostrado o plano geral, provisório)' : '')).concat(data.problems) : [],
    today: today
  };
}

/*
 * v0.5 · Pacchetto unico per l'app: sessione + tutto il perimetro autorizzato
 * della finestra (anche annullate/rinviate, segnate hidden). Vista, date, area,
 * tipo, "as minhas", ricerca e canceladas si filtrano sul telefono.
 * Con sessione non valida restituisce { session: false } (niente errore).
 */
function apiAgendaAll(token) {
  const user = apSession_(token, true);
  if (!user) return { session: false };
  const data = apActivities_();
  let hub;
  try { hub = apHub_(); } catch (e) { hub = { areaAlias: {}, areasOf: {} }; }
  const rules = apRules_();
  const memberships = apUserMemberships_(user);
  const areas = apUserAreas_(user, hub, memberships);
  let govData;
  try { govData = apGovernanceData_(); } catch (e) { govData = { byPid: {}, byName: {}, workstreams: [] }; }
  const styles = apTypeStyles_();
  const tyIndex = [];
  const acts = [];
  data.list.forEach(a => {
    const role = apRole_(user, a, areas, rules, memberships, govData);
    if (!apVisible_(user, a, role, areas)) return;
    const o = apActOut_(a, role, styles);
    const key = o.typeLabel + '|' + o.typeColor + '|' + o.typeIcon;
    let ty = tyIndex.indexOf(key);
    if (ty < 0) { tyIndex.push(key); ty = tyIndex.length - 1; }
    if (a.fullTitle && a.fullTitle !== a.title) o.full = a.fullTitle;
    delete o.typeLabel; delete o.typeColor; delete o.typeIcon; delete o.dow;
    o.ty = ty;
    Object.keys(o).forEach(k => { if (k !== 'trainers' && (o[k] === '' || o[k] === false || o[k] === null || o[k] === undefined)) delete o[k]; });
    acts.push(o);
  });
  apTouchUser_(user.id);
  return {
    session: true,
    v: AP.VERSION,
    user: apUserOut_(user),
    mustChangePin: !!user.mustChange,
    areas: areas,
    types: tyIndex.map(k => { const p = k.split('|'); return { label: p[0], color: p[1], icon: p[2] }; }),
    acts: acts,
    holidays: apHolidayList_(data.from, data.to),
    from: data.from,
    to: data.to,
    readAt: data.readAt,
    today: apYmd_(new Date()),
    warnings: user.role === 'ADMIN' ? data.missingMonths.map(m => 'Sem plano mensal: ' + m + (/^on$/i.test(apClean_(apCfg_('MASTER_FALLBACK'))) ? ' (mostrado o plano geral, provisório)' : '')).concat(data.problems) : []
  };
}

function apActOut_(a, role, styles) {
  const st = apTypeStyleFor_(a.method, styles || []);
  const gov = apActivityGovernance_(a);
  return {
    id: a.id, date: a.date, dow: a.dow, start: a.start, end: a.end, noTime: a.noTime, async: a.async,
    area: a.area, title: a.title, method: a.method, platform: a.platform,
    governance: gov ? gov.name : '', governanceType: gov ? gov.type : '',
    trainers: a.trainers.map(t => t.n), place: a.place, translator: a.translator,
    tentative: a.tentative, done: a.done, hidden: a.hidden, exec: a.exec, status: a.status,
    holiday: a.holiday, provisional: !!a.provisional, role: role || '',
    typeLabel: st.label, typeColor: st.color, typeIcon: st.icon,
    /* v0.6 */
    dur: a.dur || '', target: a.target || '', ax: ecoActionsFor_(a, role)
  };
}

function apTouchUser_(userId) {
  const cache = CacheService.getScriptCache();
  if (cache.get('AP_TOUCH_' + userId)) return;
  cache.put('AP_TOUCH_' + userId, '1', 1800);
  try {
    const t = apRead_('USER_REGISTER');
    const i = t.rows.findIndex(r => apClean_(apGet_(t, r, 'User ID')) === userId);
    if (i >= 0) t.sh.getRange(i + 2, t.h[apNorm_('Last Activity')] + 1).setValue(new Date());
  } catch (e) { /* non bloccante */ }
}


/* ============================================================
   DIAGNOSTICA FONTI (menu) — scrive SOURCE_STATUS, SOURCE_HEADERS, UNRESOLVED_NAMES
   ============================================================ */

function apDiagnose() {
  AP_COLMAP_CACHE_ = null;
  CacheService.getScriptCache().removeAll(['AP_ACTS_N', 'AP_HUB_N', 'AP_HOL_N']);
  const now = new Date();
  const status = [];
  const headers = [];
  const addHeaders = (source, sheet, fileId, sh, mapSource) => {
    if (!sh || !sh.getLastColumn()) return;
    const n = Math.min(sh.getLastColumn(), 120);
    const head = sh.getRange(1, 1, 1, n).getValues()[0].map(String);
    const sample = sh.getLastRow() > 1 ? sh.getRange(2, 1, 1, n).getDisplayValues()[0] : [];
    const mapped = {};
    if (mapSource) { const cc = apCols_(mapSource, head).c; Object.keys(cc).forEach(f => { if (cc[f] >= 0) mapped[cc[f]] = f; }); }
    head.forEach((h, i) => {
      if (!apClean_(h)) return;
      headers.push({ 'Checked At': now, 'Source': source, 'Sheet': sheet, 'File ID': fileId, 'Column': i + 1, 'Header': h,
        'Mapped Field': mapped[i] || '', 'Sample': String(sample[i] || '').slice(0, 120) });
    });
  };

  /* Hub */
  let hub = null;
  try {
    hub = apHub_();
    const hss = SpreadsheetApp.openById(apCfg_('HUB_FILE_ID'));
    Object.keys(AP_HUB_SHEETS).forEach(src => addHeaders('HUB', AP_HUB_SHEETS[src], apCfg_('HUB_FILE_ID'), hss.getSheetByName(AP_HUB_SHEETS[src]), src));
    status.push({ 'Checked At': now, 'Source': 'HUB', 'File ID': apCfg_('HUB_FILE_ID'), 'Rows Read': Object.keys(hub.people).length,
      'Error': (hub.errors || []).join(' · ') });
  } catch (e) {
    status.push({ 'Checked At': now, 'Source': 'HUB', 'File ID': apCfg_('HUB_FILE_ID'), 'Error': e.message });
  }

  /* Operations: registro, master, CALENDAR_SYNC_LOG (solo lettura intestazioni + 1 riga di esempio) */
  let reg = [];
  try {
    const ops = SpreadsheetApp.openById(apCfg_('OPS_FILE_ID'));
    addHeaders('OPS', AP.REGISTRY_SHEET, apCfg_('OPS_FILE_ID'), ops.getSheetByName(AP.REGISTRY_SHEET), 'REGISTRY');
    addHeaders('OPS', AP.MASTER_SHEET, apCfg_('OPS_FILE_ID'), ops.getSheetByName(AP.MASTER_SHEET), 'PLAN');
    const cal = ops.getSheetByName(AP.CALENDAR_LOG_SHEET);
    addHeaders('OPS', AP.CALENDAR_LOG_SHEET, apCfg_('OPS_FILE_ID'), cal, null);
    if (cal) status.push({ 'Checked At': now, 'Source': AP.CALENDAR_LOG_SHEET, 'File ID': apCfg_('OPS_FILE_ID'), 'Rows Read': Math.max(cal.getLastRow() - 1, 0) });
    reg = apRegistry_();
  } catch (e) {
    status.push({ 'Checked At': now, 'Source': 'REGISTRY', 'File ID': apCfg_('OPS_FILE_ID'), 'Error': e.message });
  }

  /* Piani mensili della finestra */
  const w = apWindow_();
  const holidays = apHolidays_();
  const seen = {};
  const unresolved = {};
  const userKeys = apUserKeyIndex_();
  const missingMonths = [];
  let firstPlan = true;
  const noteNames = (acts) => acts.forEach(a => a.trainers.forEach(t => {
    if (t.p) return;
    const k = t.k || apNameKey_(t.n);
    unresolved[k] = unresolved[k] || { 'Name': t.n, 'Seen In Activity': a.id, 'Count': 0, 'Last Seen': a.date,
      'Suggested Person ID': userKeys[k] ? 'USER ' + userKeys[k] + ' (riconosciuto da USER_REGISTER)' : '' };
    unresolved[k].Count++;
  }));
  w.months.forEach(mo => {
    const row = reg.find(x => x.m === mo.m && x.y === mo.y && x.active);
    if (!row) {
      missingMonths.push(String(mo.m).padStart(2, '0') + '/' + mo.y);
      status.push({ 'Checked At': now, 'Source': 'PLAN', 'Month': mo.m, 'Year': mo.y, 'Error': 'Nessun piano ACTIVE nel registro' +
        (/^on$/i.test(apClean_(apCfg_('MASTER_FALLBACK'))) ? ' → si usa il master (riga MASTER)' : '') });
      return;
    }
    if (firstPlan) {
      try { addHeaders('PLAN', AP.PLAN_SHEET, row.fileId, SpreadsheetApp.openById(row.fileId).getSheetByName(AP.PLAN_SHEET), 'PLAN'); } catch (e) { /* errore già sotto */ }
      firstPlan = false;
    }
    const res = apReadPlan_(row.fileId, { from: w.from, to: w.to, seen: seen, hub: hub || undefined, holidays: holidays });
    noteNames(res.acts);
    status.push({ 'Checked At': now, 'Source': 'PLAN', 'Month': mo.m, 'Year': mo.y, 'File ID': row.fileId,
      'Rows Read': res.stats.rows, 'Rows Shown': res.stats.shown, 'Hidden': res.stats.hidden, 'Without ID': res.stats.noId,
      'Duplicates': res.stats.dup, 'Missing Columns': res.stats.missing.join(' · '), 'Error': res.stats.error });
  });

  /* Master per i mesi senza piano */
  if (missingMonths.length) {
    try {
      const fb = apMasterFallback_(missingMonths, w, seen, hub || undefined, holidays);
      if (fb.stats) {
        noteNames(fb.acts);
        status.push({ 'Checked At': now, 'Source': 'MASTER', 'Month': missingMonths.join(' '), 'File ID': apCfg_('OPS_FILE_ID'),
          'Rows Read': fb.stats.rows, 'Rows Shown': fb.stats.shown, 'Hidden': fb.stats.hidden, 'Without ID': fb.stats.noId,
          'Duplicates': fb.stats.dup, 'Missing Columns': fb.stats.missing.join(' · '), 'Error': fb.stats.error });
      }
    } catch (e) {
      status.push({ 'Checked At': now, 'Source': 'MASTER', 'File ID': apCfg_('OPS_FILE_ID'), 'Error': e.message });
    }
  }

  /* DIAG_OPS: copia (solo lettura) di CALENDAR_SYNC_LOG e intestazioni del master */
  const diag = [];
  try {
    const ops = SpreadsheetApp.openById(apCfg_('OPS_FILE_ID'));
    const cal = ops.getSheetByName(AP.CALENDAR_LOG_SHEET);
    if (cal && cal.getLastRow()) {
      cal.getRange(1, 1, Math.min(cal.getLastRow(), 30), Math.max(cal.getLastColumn(), 1)).getDisplayValues()
        .forEach((r, i) => diag.push({ 'Sheet': AP.CALENDAR_LOG_SHEET, 'Row': i + 1, 'Values': r.join(' ¦ ').slice(0, 2000) }));
    }
    const ms = ops.getSheetByName(AP.MASTER_SHEET);
    if (ms && ms.getLastColumn()) {
      diag.push({ 'Sheet': AP.MASTER_SHEET, 'Row': 1, 'Values': ms.getRange(1, 1, 1, ms.getLastColumn()).getDisplayValues()[0].filter(String).join(' ¦ ') });
    }
  } catch (e) {
    diag.push({ 'Sheet': 'ERRORE', 'Row': '', 'Values': e.message });
  }

  /* Festività */
  status.push({ 'Checked At': now, 'Source': 'HOLIDAYS', 'File ID': apClean_(apCfg_('HOLIDAYS_SOURCE_FILE_ID')) || '(questo file)',
    'Rows Read': Object.keys(holidays).length, 'Error': Object.keys(holidays).length ? '' : 'Nessuna festività letta' });

  /* scrittura (fogli di diagnostica: sostituiti a ogni giro) */
  const ss = SpreadsheetApp.getActive();
  [['SOURCE_STATUS', status], ['SOURCE_HEADERS', headers], ['UNRESOLVED_NAMES', Object.keys(unresolved).map(k => unresolved[k])], ['DIAG_OPS', diag]].forEach(x => {
    const sh = apEnsureSheet_(ss, x[0], AP_H[x[0]]);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    apAppendRows_(x[0], x[1]);
  });

  const errors = status.filter(s => s.Error).length;
  const shown = status.filter(s => s.Source === 'PLAN' || s.Source === 'MASTER').reduce((n, s) => n + (Number(s['Rows Shown']) || 0), 0);
  apAudit_(null, 'DIAGNOSE', 'APP', AP.VERSION, '', '', { errors: errors, shown: shown });
  apAlert_('DIAGNOSTICA FONTI\n\nAttività nella finestra: ' + shown + '\nRighe con problemi: ' + errors +
    '\nNomi trainer senza Person ID: ' + Object.keys(unresolved).length + ' (di cui riconosciuti come utenti: ' +
    Object.keys(unresolved).filter(k => userKeys[k]).length + ')' +
    '\n\nDettagli in SOURCE_STATUS, SOURCE_HEADERS (incluse le colonne di CALENDAR_SYNC_LOG) e UNRESOLVED_NAMES.');
}


/* ============================================================
   TEST (editor: esegui apTestFase1 e guarda il registro)
   ============================================================ */

function apTestFase1() {
  const t0 = Date.now();
  const data = apReadActivities_();
  console.log('Attività lette: ' + data.list.length + ' (' + data.from + ' → ' + data.to + ') in ' + (Date.now() - t0) + ' ms');
  console.log('Mesi senza piano: ' + (data.missingMonths.join(', ') || 'nessuno'));
  console.log('Problemi: ' + (data.problems.join(' | ') || 'nessuno'));
  data.list.slice(0, 5).forEach(a => console.log(JSON.stringify(apActOut_(a, ''))));
}
