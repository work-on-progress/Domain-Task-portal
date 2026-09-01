/**
 * Domain Task Portal — Backend  (v2, built for the real DevOps Domain Task Sheet)
 * ------------------------------------------------------------------------------
 * Deploy as: Web app | Execute as: Me | Who has access: Anyone
 *
 * What changed from v1 and why
 *   Your sheet has no Faculty Email column, headers are not always in row 1,
 *   every tab names its status column differently, and one faculty member is
 *   written five different ways. So this version:
 *     - identifies faculty by Mentor UID first, name second, using a _Faculty tab
 *     - finds the header row itself (row 1, 2 or 3)
 *     - detects status columns and keeps each tab's own vocabulary
 *     - reads the ToDo tab as the department task board
 *   None of your existing tabs has to change.
 */

/* ============================== CONFIGURATION ============================= */

const CONFIG = {
  // OAuth Client ID from Google Cloud Console. Same value as config.js.
  CLIENT_ID: 'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',

  // Anyone listed here sees the whole workbook, whatever _Faculty says.
  MASTER_EMAILS: ['hod.cs@university.edu'],

  // Leave '' when the script lives inside the sheet (Extensions > Apps Script).
  SPREADSHEET_ID: '',

  // Portal control tabs. Created by "Set up portal" in the sheet menu.
  FACULTY_TAB: '_Faculty',
  TASKS_TAB: '_Tasks',
  BOARD_TAB: 'ToDo',

  // Restrict sign-in to one domain, e.g. 'lpu.in'. '' allows any Google account.
  ALLOWED_DOMAIN: '',

  // Columns matching these words go only to the row's own mentor and to masters,
  // and never appear in the compact table.
  PRIVATE_COLUMN_WORDS: ['contact', 'phone', 'mobile', 'parent', 'email', 'cgpa', 'pan card']
};

/* ============================ COLUMN DICTIONARY =========================== */

const WORDS = {
  reg: ['registration number', 'registrationnumber', 'registeration number', 'reg number',
        'reg no', 'regno', 'registration no', 'roll number', 'rollnumber', 'roll no',
        'registration', 'superset id', 'student registration no'],
  student: ['student name', 'studentname', 'first name', 'firstname', 'candidate name',
            'candidate full name', 'name'],
  ownerUid: ['mentor uid', 'uid of placement mentor', 'faculty uid', 'mentor id', 'faculty id',
             'uid', 'mentor'],
  ownerName: ['mentor name', 'mentorname', 'placement mentor', 'faculty name', 'faculty member',
              'faculty assigned', 'mentor', 'name of hos cos hod'],
  hod: ['mentor hod', 'mentorhod', 'school hod', 'hod', 'student hod'],
  statusHint: ['status', 'taken', 'attempt', 'register', 'verif', 'pendency', 'placed',
               'placement', 'mars', 'checked', 'submitted', 'complete', 'progress', 'done'],
  remarks: ['remark', 'comment', 'note', 'feedback', 'detail', 'description', 'observation'],
  skip: ['s no', 'sno', 'sr no', 'serial'],
  item: ['title', 'project', 'certification', 'domain', 'initiative', 'task', 'activity']
};

const DONE_WORDS = ['registered', 'completed', 'complete', 'done', 'taken', 'yes', 'verified',
                    'approved', 'selected', 'placed', 'submitted', 'closed', 'attempted',
                    'documents checked', 'document checked', 'checked'];
const OPEN_PREFIX = ['not ', 'not-', 'non ', 'no ', 'no-', 'pending', 'absent', 'na', 'nope', 'n a'];

/** Status words and stray notes that sometimes land in a mentor column. */
function looksLikeName_(value) {
  const v = cellText_(value);
  if (!v || v.length < 3 || v.length > 60) return false;
  if (/[0-9(){}\[\]>]/.test(v)) return false;
  if (/^(not|non|no|yes|pending|absent|na|nil|tbd|done|taken|registered|allocated)\b/i.test(v)) return false;
  return /[a-z]/i.test(v);
}

/* ================================ ENDPOINTS =============================== */

function doGet(e) {
  try {
    const who = authenticate((e && e.parameter && e.parameter.token) || '');
    const only = (e && e.parameter && e.parameter.tab) || '';
    return json(buildDataset(who, { onlyTab: only, withDetail: !!only }));
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const who = authenticate(body.token || '');
    if (body.action === 'updateCell') return json(updateCell(who, body));
    if (body.action === 'fetch') return json(buildDataset(who, {}));
    throw new Error('Unknown action: ' + body.action);
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

/* ============================== AUTHENTICATION ============================ */

function authenticate(token) {
  if (!token) throw new Error('SESSION_EXPIRED');

  const cache = CacheService.getScriptCache();
  const key = 'idt_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));

  let claims = cache.get(key);
  if (claims) {
    claims = JSON.parse(claims);
  } else {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('SESSION_EXPIRED');
    claims = JSON.parse(res.getContentText());
    if (claims.aud !== CONFIG.CLIENT_ID) throw new Error('Token was issued for a different app. CLIENT_ID must match in Code.gs and config.js.');
    if (Number(claims.exp) * 1000 < Date.now()) throw new Error('SESSION_EXPIRED');
    if (String(claims.email_verified) !== 'true') throw new Error('This Google account is not verified.');
    cache.put(key, JSON.stringify(claims), 300);
  }

  const email = String(claims.email || '').toLowerCase().trim();
  if (!email) throw new Error('SESSION_EXPIRED');
  if (CONFIG.ALLOWED_DOMAIN && email.split('@')[1] !== CONFIG.ALLOWED_DOMAIN.toLowerCase()) {
    throw new Error('Use your ' + CONFIG.ALLOWED_DOMAIN + ' account to sign in.');
  }

  const person = lookupFaculty_(email);
  const master = CONFIG.MASTER_EMAILS.map(function (m) { return m.toLowerCase().trim(); });

  if (!person && master.indexOf(email) === -1) throw new Error('NOT_LISTED:' + email);

  return {
    email: email,
    picture: claims.picture || '',
    uid: person ? person.uid : '',
    name: person ? person.name : (claims.name || email),
    aliases: person ? person.aliases : [],
    role: (master.indexOf(email) > -1 || (person && person.role === 'MASTER')) ? 'MASTER'
        : (person && person.role === 'HOD') ? 'HOD' : 'FACULTY'
  };
}

/* ============================== SHEET PLUMBING ============================ */

function ss_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function norm_(v) {
  return String(v == null ? '' : v)
    .replace(/[^A-Za-z0-9 \/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** "Dr. Alok Misra" and "alok misra" collapse to the same key. */
function nameKey_(v) {
  return norm_(v)
    .replace(/\b(dr|mr|mrs|ms|prof|professor|sir|madam|maam)\b\.?/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strips the trailing ".0" Sheets adds to numeric IDs. */
function idKey_(v) {
  const s = String(v == null ? '' : v).trim();
  const n = s.replace(/\.0+$/, '');
  return /^[0-9]+$/.test(n) ? n : norm_(s);
}

function cellText_(v) {
  if (v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number' && Math.abs(v - Math.round(v)) < 1e-9 && Math.abs(v) >= 1000) {
    return String(Math.round(v));
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

/* ============================ HEADER DETECTION ============================ */

/** Scans the first rows and returns the index of the most header-like one. */
function findHeaderRow_(values) {
  let best = -1, bestScore = -1;
  const limit = Math.min(values.length, 8);

  for (let r = 0; r < limit; r++) {
    const cells = values[r].map(cellText_);
    const filled = cells.filter(function (c) { return c !== ''; });
    if (filled.length < 3) continue;

    // A paragraph of instructions is one long cell, not a header row.
    const longest = Math.max.apply(null, filled.map(function (c) { return c.length; }));
    if (longest > 120 && filled.length < 4) continue;

    let score = filled.length;
    filled.forEach(function (c) {
      const n = norm_(c);
      if (n.length < 40) score += 1;
      ['reg', 'student', 'ownerUid', 'ownerName', 'statusHint', 'remarks'].forEach(function (g) {
        if (WORDS[g].some(function (w) { return n.indexOf(w) > -1; })) score += 3;
      });
    });
    score -= r;   // prefer the earliest strong candidate
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

function hasWord_(header, group) {
  const n = norm_(header);
  if (!n) return false;
  return WORDS[group].some(function (w) { return n.indexOf(w) > -1; });
}

/**
 * Works out what each column is, from the header text and the values below it.
 * Returns { reg, student, ownerUid, ownerName, hod, statuses[], remarks[], info[], private[] }
 */
function classifyColumns_(header, dataRows) {
  const out = { reg: -1, student: -1, ownerUid: -1, ownerName: -1, hod: -1,
                statuses: [], remarks: [], info: [], private: [] };

  const sample = dataRows.slice(0, 250);

  header.forEach(function (raw, i) {
    const label = cellText_(raw);
    const n = norm_(label);
    if (!n || hasWord_(label, 'skip')) return;

    const values = sample.map(function (r) { return cellText_(r[i]); })
                         .filter(function (v) { return v !== ''; });
    const distinct = {};
    values.forEach(function (v) { distinct[v.toLowerCase()] = (distinct[v.toLowerCase()] || 0) + 1; });
    const distinctCount = Object.keys(distinct).length;
    const numericShare = values.length
      ? values.filter(function (v) { return /^[0-9.,\-\/ ]+$/.test(v); }).length / values.length : 0;

    const isHod = /\bhod\b|\bhos\b|\bcos\b/.test(n);
    const isPrivate = CONFIG.PRIVATE_COLUMN_WORDS.some(function (w) { return n.indexOf(w) > -1; });

    if (isHod) {
      if (out.hod === -1 && !/uid|\bid\b/.test(n) && numericShare < 0.5) out.hod = i;
      else out.info.push(i);
      return;
    }

    if (out.reg === -1 && hasWord_(label, 'reg') && numericShare > 0.5) { out.reg = i; return; }

    if (out.ownerUid === -1 && hasWord_(label, 'ownerUid') && numericShare > 0.5) {
      out.ownerUid = i; return;
    }

    if (out.ownerName === -1 && hasWord_(label, 'ownerName') &&
        n.indexOf('school') === -1 && numericShare < 0.5) {
      out.ownerName = i; return;
    }

    if (out.student === -1 && hasWord_(label, 'student') &&
        n.indexOf('mentor') === -1 && n.indexOf('faculty') === -1 &&
        n.indexOf('company') === -1 && n.indexOf('school') === -1 && numericShare < 0.4) {
      out.student = i; return;
    }

    if (hasWord_(label, 'remarks')) { out.remarks.push(i); return; }

    // A status column: a short, repeating vocabulary under a status-ish header.
    if (hasWord_(label, 'statusHint') && values.length >= 3 && numericShare < 0.4 &&
        distinctCount <= 20 && distinctCount < values.length) {
      const ordered = Object.keys(distinct).sort(function (a, b) { return distinct[b] - distinct[a]; });
      out.statuses.push({
        col: i,
        label: label,
        options: ordered.slice(0, 12).map(function (k) {
          for (var v = 0; v < values.length; v++) if (values[v].toLowerCase() === k) return values[v];
          return k;
        })
      });
      return;
    }

    (isPrivate ? out.private : out.info).push(i);
  });

  return out;
}

function isDone_(value, doneList) {
  const v = norm_(value);
  if (!v) return false;
  if (doneList && doneList.length) {
    return doneList.some(function (d) { return v === norm_(d); });
  }
  for (var i = 0; i < OPEN_PREFIX.length; i++) if (v.indexOf(OPEN_PREFIX[i]) === 0) return false;
  return DONE_WORDS.some(function (d) { return v.indexOf(d) > -1; });
}

/* ============================== _Faculty TAB ============================== */

function readFacultyTab_() {
  const sheet = ss_().getSheetByName(CONFIG.FACULTY_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues().map(function (r) {
    return {
      uid: idKey_(r[0]),
      name: cellText_(r[1]),
      email: cellText_(r[2]).toLowerCase(),
      role: (cellText_(r[3]) || 'FACULTY').toUpperCase(),
      aliases: cellText_(r[4]).split(/[;|]/).map(function (s) { return s.trim(); })
                 .filter(function (s) { return s; })
    };
  }).filter(function (p) { return p.email || p.uid; });
}

function lookupFaculty_(email) {
  const list = readFacultyTab_();
  for (var i = 0; i < list.length; i++) if (list[i].email && list[i].email === email) return list[i];
  return null;
}

/** Index of the directory, so a row's mentor cell can be resolved to one person. */
function facultyIndex_() {
  const list = readFacultyTab_();
  const byUid = {}, byName = {};
  list.forEach(function (p) {
    if (p.uid) byUid[p.uid] = p;
    [p.name].concat(p.aliases).forEach(function (n) {
      const k = nameKey_(n);
      if (k) byName[k] = p;
    });
  });
  return { byUid: byUid, byName: byName };
}

/** Resolves a row's mentor cells to one canonical person, or null. */
function resolveOwner_(index, uidValue, nameValue) {
  if (uidValue) {
    const parts = String(uidValue).split(/[,:;]+/).map(idKey_);
    for (var i = 0; i < parts.length; i++) if (index.byUid[parts[i]]) return index.byUid[parts[i]];
  }
  if (nameValue) {
    const k = nameKey_(nameValue);
    if (index.byName[k]) return index.byName[k];
    // "Akshansh" should still resolve to "Akshansh Rana".
    const keys = Object.keys(index.byName);
    for (var j = 0; j < keys.length; j++) {
      if (k.length > 3 && (keys[j].indexOf(k + ' ') === 0 || k.indexOf(keys[j] + ' ') === 0)) {
        return index.byName[keys[j]];
      }
    }
  }
  return null;
}

/** True when this row belongs to this person. UID wins; name is the fallback. */
function ownsRow_(who, uidValue, nameValue) {
  if (who.uid && uidValue) {
    if (idKey_(uidValue) === who.uid) return true;
    // Some cells hold "16967::Dr. Gursharan Singh" or a comma list.
    if (String(uidValue).split(/[,:;]+/).map(idKey_).indexOf(who.uid) > -1) return true;
  }
  if (nameValue) {
    const cell = nameKey_(nameValue);
    if (!cell) return false;
    const mine = [who.name].concat(who.aliases || []).map(nameKey_).filter(Boolean);
    for (var i = 0; i < mine.length; i++) {
      if (cell === mine[i]) return true;
      // "Akshansh" matches "Akshansh Rana"; "Dr. Jaspreet" matches "Dr. Jaspreet Kaur".
      if (cell.length > 3 &&
          (mine[i].indexOf(cell + ' ') === 0 || cell.indexOf(mine[i] + ' ') === 0)) return true;
    }
  }
  return false;
}

/* =============================== _Tasks TAB =============================== */

const TASK_HEADERS = ['Tab name', 'Show in portal', 'Task title', 'Deadline',
                      'Header row', 'Owner column', 'Status columns', 'Done values', 'Link'];

function readTaskConfig_() {
  const sheet = ss_().getSheetByName(CONFIG.TASKS_TAB);
  const map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, TASK_HEADERS.length).getValues().forEach(function (r) {
    const tab = cellText_(r[0]);
    if (!tab) return;
    map[tab] = {
      show: norm_(r[1]) !== 'no',
      title: cellText_(r[2]) || tab,
      deadline: cellText_(r[3]),
      headerRow: Number(r[4]) || 0,
      ownerColumn: cellText_(r[5]),
      statusColumns: cellText_(r[6]).split(/\s*\|\s*/).filter(function (s) { return s; }),
      doneValues: cellText_(r[7]).split(/\s*[,|]\s*/).filter(function (s) { return s; }),
      link: cellText_(r[8])
    };
  });
  return map;
}

/* ============================= THE TASK BOARD ============================= */

function readBoard_() {
  const sheet = ss_().getSheetByName(CONFIG.BOARD_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(1, 1, sheet.getLastRow(), Math.min(sheet.getLastColumn(), 6)).getValues();

  // The board header is the row that names both a task and a deadline.
  let head = -1;
  for (var i = 0; i < Math.min(values.length, 8); i++) {
    const cells = values[i].map(norm_);
    if (cells.some(function (c) { return c.indexOf('task') > -1; }) &&
        cells.some(function (c) { return c.indexOf('deadline') > -1 || c.indexOf('due') > -1; })) {
      head = i; break;
    }
  }
  if (head < 0) head = findHeaderRow_(values);
  if (head < 0) return [];

  const header = values[head].map(norm_);
  const col = function (word) {
    for (var i = 0; i < header.length; i++) if (header[i].indexOf(word) > -1) return i;
    return -1;
  };
  const cTask = col('task'), cDue = col('deadline'), cTab = col('domain sheet'), cLink = col('link');

  const items = [];
  for (var r = head + 1; r < values.length; r++) {
    const title = cTask > -1 ? cellText_(values[r][cTask]) : '';
    if (!title) continue;
    const linkCell = cLink > -1 ? cellText_(values[r][cLink]) : '';
    const url = (linkCell.match(/https?:\/\/[^\s,]+/) || [''])[0];
    items.push({
      title: title.split(/["\n]/)[0].trim().slice(0, 120) || title.slice(0, 120),
      note: linkCell.replace(/https?:\/\/[^\s,]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
      deadline: cDue > -1 ? cellText_(values[r][cDue]) : '',
      tab: cTab > -1 ? cellText_(values[r][cTab]).replace(/^["']+|["']+$/g, '').trim() : '',
      url: url
    });
  }
  return items;
}

/* ============================== BUILD DATASET ============================= */

function buildDataset(who, opts) {
  opts = opts || {};
  const book = ss_();
  const cfg = readTaskConfig_();
  const isMaster = who.role === 'MASTER';

  // A master sees the whole department, which is a lot of rows, so the extra
  // per-row columns are fetched only when one tab is opened.
  const withDetail = opts.withDetail || !isMaster;

  const index = facultyIndex_();
  const unmatched = {};
  const tasks = [];
  const rows = [];
  const skipped = [];

  book.getSheets().forEach(function (sheet) {
    const tab = sheet.getName();
    if (tab === CONFIG.FACULTY_TAB || tab === CONFIG.TASKS_TAB || tab === CONFIG.BOARD_TAB) return;
    if (tab.charAt(0) === '_' || sheet.isSheetHidden()) return;
    if (opts.onlyTab && tab !== opts.onlyTab) return;

    const conf = cfg[tab] || { statusColumns: [], doneValues: [] };
    conf.statusColumns = conf.statusColumns || [];
    conf.doneValues = conf.doneValues || [];
    if (conf.show === false) return;

    const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 2) return;

    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const head = conf.headerRow ? conf.headerRow - 1 : findHeaderRow_(values);
    if (head < 0) { skipped.push({ tab: tab, why: 'no header row found' }); return; }

    const header = values[head].map(cellText_);
    const body = values.slice(head + 1);
    const cols = classifyColumns_(header, body);

    // Anything set in _Tasks overrides the detection.
    if (conf.ownerColumn) {
      const oi = header.map(norm_).indexOf(norm_(conf.ownerColumn));
      if (oi > -1) {
        if (/uid|\bid\b/.test(norm_(conf.ownerColumn))) { cols.ownerUid = oi; }
        else { cols.ownerName = oi; }
      }
    }
    if (conf.statusColumns.length) {
      const detected = {};
      cols.statuses.forEach(function (s) { detected[norm_(s.label)] = s; });
      cols.statuses = conf.statusColumns.map(function (label) {
        const i = header.map(norm_).indexOf(norm_(label));
        if (i < 0) return null;
        return detected[norm_(label)] || { col: i, label: header[i], options: [] };
      }).filter(Boolean);
    }

    if (cols.ownerUid === -1 && cols.ownerName === -1) {
      skipped.push({ tab: tab, why: 'no mentor or faculty column' }); return;
    }
    // Tabs that track faculty work rather than students (projects, targets)
    // use a title column as the item label instead.
    let itemCol = -1;
    if (cols.reg === -1 && cols.student === -1) {
      for (var q = 0; q < cols.info.length; q++) {
        if (hasWord_(header[cols.info[q]], 'item')) { itemCol = cols.info[q]; break; }
      }
      if (itemCol === -1) {
        skipped.push({ tab: tab, why: 'no student or title column' }); return;
      }
      cols.info = cols.info.filter(function (i) { return i !== itemCol; });
    }

    const task = {
      tab: tab,
      title: (conf.title || tab).trim(),
      deadline: conf.deadline || '',
      link: conf.link || '',
      headerRow: head + 1,
      statuses: cols.statuses.map(function (s) { return { label: s.label, options: s.options }; })
    };

    let kept = 0;
    let lastUid = '', lastName = '', inheritedCount = 0;

    for (var r = 0; r < body.length; r++) {
      const row = body[r];
      let uidCell = cols.ownerUid > -1 ? cellText_(row[cols.ownerUid]) : '';
      let nameCell = cols.ownerName > -1 ? cellText_(row[cols.ownerName]) : '';
      let inherited = false;

      if (uidCell || nameCell) {
        lastUid = uidCell; lastName = nameCell;
      } else if (lastUid || lastName) {
        // Some tabs write the mentor once and leave the rows below blank.
        uidCell = lastUid; nameCell = lastName; inherited = true; inheritedCount++;
      } else {
        continue;
      }

      const mine = ownsRow_(who, uidCell, nameCell);
      let visible = isMaster || mine;
      if (!visible && who.role === 'HOD' && cols.hod > -1) {
        visible = ownsRow_(who, '', cellText_(row[cols.hod]));
      }
      if (!visible) continue;

      const reg = cols.reg > -1 ? cellText_(row[cols.reg]) : '';
      const student = cols.student > -1 ? cellText_(row[cols.student])
                    : (itemCol > -1 ? cellText_(row[itemCol]) : '');
      if (!reg && !student) continue;

      const person = resolveOwner_(index, uidCell, nameCell);
      if (!person) {
        const raw = nameCell || uidCell;
        unmatched[raw] = (unmatched[raw] || 0) + 1;
      }
      const record = {
        tab: tab,
        row: head + 2 + r,
        reg: reg,
        student: student,
        owner: person ? person.name : (nameCell || uidCell),
        ownerId: person ? (person.uid || nameKey_(person.name)) : nameKey_(nameCell || uidCell),
        inherited: inherited,
        statuses: cols.statuses.map(function (s) {
          const value = cellText_(row[s.col]);
          return { label: s.label, value: value, done: isDone_(value, conf.doneValues) };
        }),
        remarks: cols.remarks.map(function (i) {
          return { label: header[i], value: cellText_(row[i]) };
        }).filter(function (x) { return x.label; })
      };

      if (withDetail) {
        record.info = cols.info.map(function (i) {
          return { label: header[i], value: cellText_(row[i]) };
        }).filter(function (x) { return x.label && x.value; });

        // Contact numbers and the like go only to the row's own mentor, or a master.
        if (mine || isMaster) {
          record.private = cols.private.map(function (i) {
            return { label: header[i], value: cellText_(row[i]) };
          }).filter(function (x) { return x.label && x.value; });
        }
      }

      rows.push(record);
      kept++;
    }

    task.rowsForMe = kept;
    task.kind = itemCol > -1 ? 'faculty' : 'student';
    task.itemLabel = itemCol > -1 ? header[itemCol] : 'Student';
    task.inheritedOwners = inheritedCount;
    tasks.push(task);
  });

  return {
    ok: true,
    role: who.role,
    email: who.email,
    name: who.name,
    uid: who.uid,
    picture: who.picture,
    board: readBoard_(),
    tasks: tasks,
    rows: rows,
    skipped: isMaster ? skipped : [],
    unmatched: isMaster ? Object.keys(unmatched)
      .sort(function (a, b) { return unmatched[b] - unmatched[a]; })
      .slice(0, 20)
      .map(function (k) { return { name: k, rows: unmatched[k] }; }) : [],
    onlyTab: opts.onlyTab || '',
    hasDetail: withDetail,
    generatedAt: new Date().toISOString()
  };
}

/* ================================= WRITES ================================= */

/**
 * Writes one cell — a status value or a remark — after re-checking ownership
 * and that the row still holds the student the browser thinks it does.
 */
function updateCell(who, body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = ss_().getSheetByName(String(body.tab || ''));
    if (!sheet) throw new Error('That tab no longer exists. Refresh to reload.');

    const rowNum = Number(body.row);
    if (!rowNum || rowNum < 2 || rowNum > sheet.getLastRow()) throw new Error('STALE_ROW');

    const lastCol = sheet.getLastColumn();
    const headerRow = Number(body.headerRow) || 1;
    const header = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(cellText_);
    const rowValues = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];

    const target = header.map(norm_).indexOf(norm_(body.column));
    if (target < 0) throw new Error('Column "' + body.column + '" is not on this tab any more.');

    if (who.role !== 'MASTER') {
      const cols = classifyColumns_(header, [rowValues]);
      const uidCell = cols.ownerUid > -1 ? cellText_(rowValues[cols.ownerUid]) : '';
      const nameCell = cols.ownerName > -1 ? cellText_(rowValues[cols.ownerName]) : '';
      let allowed = ownsRow_(who, uidCell, nameCell);
      if (!allowed && who.role === 'HOD' && cols.hod > -1) {
        allowed = ownsRow_(who, '', cellText_(rowValues[cols.hod]));
      }
      if (!allowed) throw new Error('This row is not assigned to you.');

      if (cols.reg > -1 && body.reg && idKey_(rowValues[cols.reg]) !== idKey_(body.reg)) {
        throw new Error('STALE_ROW');
      }
    }

    sheet.getRange(rowNum, target + 1).setValue(String(body.value == null ? '' : body.value).slice(0, 500));
    return { ok: true, tab: sheet.getName(), row: rowNum, column: body.column, value: body.value };
  } finally {
    lock.releaseLock();
  }
}

/* =========================== SET-UP FROM THE SHEET ======================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Task Portal')
    .addItem('Set up portal (build _Faculty and _Tasks)', 'setupPortal')
    .addItem('Refresh faculty list', 'refreshFacultyTab')
    .addItem('Refresh task list', 'refreshTasksTab')
    .addItem('Check what the portal can read', 'diagnose')
    .addToUi();
}

function setupPortal() {
  const f = refreshFacultyTab();
  const t = refreshTasksTab();
  SpreadsheetApp.getUi().alert(
    'Two control tabs are ready.\n\n' +
    '_Faculty — ' + f + ' mentors found across your tabs, with their UID and every name variant ' +
    'used for them. Fill in the Email column. That is the only manual step.\n\n' +
    '_Tasks — ' + t + ' tabs listed, with what the portal detected in each. Set "Show in portal" ' +
    'to No for anything faculty should not see.');
}

/** Scans every tab for mentor UID/name pairs and writes them into _Faculty. */
function refreshFacultyTab() {
  const book = ss_();
  const found = {};      // uid -> { name: true }
  const nameOnly = {};

  book.getSheets().forEach(function (sheet) {
    const tab = sheet.getName();
    if (tab.charAt(0) === '_' || tab === CONFIG.BOARD_TAB) return;
    if (sheet.getLastRow() < 2 || sheet.getLastColumn() < 2) return;

    const values = sheet.getRange(1, 1, Math.min(sheet.getLastRow(), 600), sheet.getLastColumn()).getValues();
    const head = findHeaderRow_(values);
    if (head < 0) return;
    const cols = classifyColumns_(values[head].map(cellText_), values.slice(head + 1));

    values.slice(head + 1).forEach(function (row) {
      const uid = cols.ownerUid > -1 ? idKey_(row[cols.ownerUid]) : '';
      const name = cols.ownerName > -1 ? cellText_(row[cols.ownerName]) : '';
      if (/^[0-9]{4,6}$/.test(uid)) {
        if (!found[uid]) found[uid] = {};
        if (looksLikeName_(name)) found[uid][name] = true;
      } else if (looksLikeName_(name) && nameKey_(name).split(' ').length >= 2) {
        nameOnly[name] = true;
      }
    });
  });

  const knownNames = {};
  Object.keys(found).forEach(function (uid) {
    Object.keys(found[uid]).forEach(function (n) { knownNames[nameKey_(n)] = uid; });
  });

  const sheet = getOrCreate_(CONFIG.FACULTY_TAB,
    ['Mentor UID', 'Faculty name', 'Email (fill this in)', 'Role', 'Name variants found in sheets']);

  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues().forEach(function (r) {
      const k = idKey_(r[0]) || nameKey_(r[1]);
      if (k) existing[k] = r;
    });
  }

  const out = [];
  Object.keys(found).sort().forEach(function (uid) {
    const variants = Object.keys(found[uid]).sort(function (a, b) { return b.length - a.length; });
    const prev = existing[uid] || [];
    out.push([uid, cellText_(prev[1]) || variants[0] || '', cellText_(prev[2]),
              cellText_(prev[3]) || 'FACULTY', variants.join(' | ')]);
  });
  Object.keys(nameOnly).sort().forEach(function (name) {
    if (knownNames[nameKey_(name)]) return;
    const prev = existing[nameKey_(name)] || [];
    out.push(['', cellText_(prev[1]) || name, cellText_(prev[2]), cellText_(prev[3]) || 'FACULTY', name]);
  });

  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  if (out.length) sheet.getRange(2, 1, out.length, 5).setValues(out);
  sheet.autoResizeColumns(1, 5);
  return out.length;
}

/** Lists every tab with what the portal detected, so the HOD can correct it. */
function refreshTasksTab() {
  const book = ss_();
  const sheet = getOrCreate_(CONFIG.TASKS_TAB, TASK_HEADERS);

  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, TASK_HEADERS.length).getValues().forEach(function (r) {
      if (cellText_(r[0])) existing[cellText_(r[0])] = r;
    });
  }

  const board = {};
  readBoard_().forEach(function (b) { if (b.tab && !board[b.tab]) board[b.tab] = b; });

  const out = [];
  book.getSheets().forEach(function (s) {
    const tab = s.getName();
    if (tab.charAt(0) === '_' || tab === CONFIG.BOARD_TAB) return;
    if (s.getLastRow() < 2 || s.getLastColumn() < 2) return;

    const values = s.getRange(1, 1, Math.min(s.getLastRow(), 300), s.getLastColumn()).getValues();
    const head = findHeaderRow_(values);
    const header = head > -1 ? values[head].map(cellText_) : [];
    const cols = head > -1 ? classifyColumns_(header, values.slice(head + 1))
                           : { statuses: [], ownerUid: -1, ownerName: -1, reg: -1, student: -1 };
    const usable = head > -1 && (cols.ownerUid > -1 || cols.ownerName > -1) &&
                   (cols.reg > -1 || cols.student > -1);
    const prev = existing[tab] || [];
    const b = board[tab] || {};

    out.push([
      tab,
      cellText_(prev[1]) || (usable ? 'Yes' : 'No'),
      cellText_(prev[2]) || b.title || tab.trim(),
      cellText_(prev[3]) || b.deadline || '',
      cellText_(prev[4]) || (head + 1),
      cellText_(prev[5]) || (cols.ownerName > -1 ? header[cols.ownerName]
                            : (cols.ownerUid > -1 ? header[cols.ownerUid] : '')),
      cellText_(prev[6]) || cols.statuses.map(function (x) { return x.label; }).join(' | '),
      cellText_(prev[7]) || '',
      cellText_(prev[8]) || b.url || ''
    ]);
  });

  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, TASK_HEADERS.length).clearContent();
  if (out.length) sheet.getRange(2, 1, out.length, TASK_HEADERS.length).setValues(out);
  sheet.autoResizeColumns(1, TASK_HEADERS.length);
  return out.length;
}

function getOrCreate_(name, headers) {
  const book = ss_();
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#16233b').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  return sheet;
}

/** Prints, per tab, what the portal detected. Read it in the execution log. */
function diagnose() {
  const lines = [];
  ss_().getSheets().forEach(function (s) {
    const tab = s.getName();
    if (s.getLastRow() < 2 || s.getLastColumn() < 2) { lines.push(tab + ' -> empty'); return; }
    const values = s.getRange(1, 1, Math.min(s.getLastRow(), 300), s.getLastColumn()).getValues();
    const head = findHeaderRow_(values);
    if (head < 0) { lines.push(tab + ' -> no header row'); return; }
    const header = values[head].map(cellText_);
    const c = classifyColumns_(header, values.slice(head + 1));
    lines.push(tab + ' -> header row ' + (head + 1) +
      ' | student: ' + (c.student > -1 ? header[c.student] : '-') +
      ' | reg: ' + (c.reg > -1 ? header[c.reg] : '-') +
      ' | mentor: ' + (c.ownerName > -1 ? header[c.ownerName] : '-') +
      ' | uid: ' + (c.ownerUid > -1 ? header[c.ownerUid] : '-') +
      ' | status: ' + (c.statuses.map(function (x) { return x.label; }).join(', ') || '-'));
  });
  Logger.log(lines.join('\n'));
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
