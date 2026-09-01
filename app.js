/* Domain Task Portal — frontend
   ---------------------------------------------------------------
   Every tab in the department sheet names its columns differently, so
   the server sends each row with its own status labels and options and
   this file renders whatever it gets. */

(function () {
  'use strict';

  var CFG = window.PORTAL_CONFIG || {};
  var STORE_KEY = 'domainPortalCredential';

  var state = {
    credential: null,
    data: null,
    taskByTab: {},
    charts: {},
    expanded: {},
    detailed: {},
    filters: { q: '', task: '', faculty: '', show: '' }
  };

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function show(view) {
    ['view-auth', 'view-loading', 'view-error', 'view-dash'].forEach(function (id) {
      $(id).hidden = (id !== view);
    });
    $('session-bar').hidden = (view !== 'view-dash');
    $('ledger').hidden = (view !== 'view-dash');
  }

  function toast(message, isError) {
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' err' : '');
    el.setAttribute('role', 'status');
    el.textContent = message;
    $('toast').appendChild(el);
    setTimeout(function () { el.remove(); }, isError ? 6500 : 3200);
  }

  function fail(message, title) {
    $('error-title').textContent = title || 'Could not load your data';
    $('error-text').textContent = message;
    show('view-error');
  }

  /* ─────────────────────────── sign-in ─────────────────────────── */

  function decodeJwt(token) {
    try {
      var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(part))));
    } catch (e) { return null; }
  }

  function storedCredential() {
    var token = sessionStorage.getItem(STORE_KEY);
    if (!token) return null;
    var claims = decodeJwt(token);
    if (!claims || (claims.exp * 1000) - 60000 < Date.now()) {
      sessionStorage.removeItem(STORE_KEY);
      return null;
    }
    return token;
  }

  function onCredential(response) {
    state.credential = response.credential;
    sessionStorage.setItem(STORE_KEY, response.credential);
    $('auth-note').hidden = true;
    loadData();
  }

  function signOut(note) {
    state.credential = null;
    state.data = null;
    sessionStorage.removeItem(STORE_KEY);
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    Object.keys(state.charts).forEach(function (k) { state.charts[k].destroy(); });
    state.charts = {};
    show('view-auth');
    if (note) { $('auth-note').textContent = note; $('auth-note').hidden = false; }
  }

  function initGoogle() {
    if (!window.google || !google.accounts || !google.accounts.id) return setTimeout(initGoogle, 120);

    google.accounts.id.initialize({
      client_id: CFG.GOOGLE_CLIENT_ID,
      callback: onCredential,
      auto_select: true,
      cancel_on_tap_outside: false
    });
    google.accounts.id.renderButton($('gsi-button'), {
      theme: 'filled_blue', size: 'large', shape: 'pill',
      text: 'signin_with', logo_alignment: 'left', width: 260
    });

    var token = storedCredential();
    if (token) { state.credential = token; loadData(); }
    else { show('view-auth'); google.accounts.id.prompt(); }
  }

  /* ─────────────────────────── network ─────────────────────────── */

  function api(options) {
    if (options.method === 'GET') {
      var url = CFG.API_URL + '?token=' + encodeURIComponent(state.credential);
      if (options.tab) url += '&tab=' + encodeURIComponent(options.tab);
      return fetch(url, { method: 'GET', redirect: 'follow' }).then(function (r) { return r.json(); });
    }
    if (options.method === 'POST') {
      return fetch(CFG.API_URL, {
        method: 'POST',
        // text/plain keeps this a simple request, so no CORS preflight.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: state.credential }, options.body))
      }).then(function (r) { return r.json(); });
    }
  }

  function handleError(message) {
    if (message === 'SESSION_EXPIRED') { signOut('Your session expired. Sign in again.'); return true; }
    if (message.indexOf('NOT_LISTED:') === 0) {
      fail('The address ' + message.split(':')[1] + ' is not in the _Faculty tab of the department sheet yet. ' +
           'Ask the HOD to add it against your name, then sign in again.', 'Account not listed');
      return true;
    }
    return false;
  }

  function loadData() {
    show('view-loading');
    api({ method: 'GET' })
      .then(function (res) {
        if (!res || !res.ok) {
          var msg = (res && res.error) || 'The server returned an unexpected response.';
          if (!handleError(msg)) fail(msg);
          return;
        }
        state.data = res;
        state.taskByTab = {};
        res.tasks.forEach(function (t) { state.taskByTab[t.tab] = t; });
        state.expanded = {};
        render();
      })
      .catch(function () {
        fail('The portal could not reach the Apps Script web app. Check API_URL in config.js, and that the deployment access is set to "Anyone".');
      });
  }

  /* ─────────────────────── derived numbers ─────────────────────── */

  function isMaster() { return state.data.role === 'MASTER'; }

  function rowTotals(row) {
    var done = 0;
    row.statuses.forEach(function (s) { if (s.done) done++; });
    return { done: done, total: row.statuses.length };
  }

  function tally(rows) {
    var done = 0, total = 0, openRows = 0;
    rows.forEach(function (r) {
      var t = rowTotals(r);
      done += t.done; total += t.total;
      if (t.total && t.done < t.total) openRows++;
    });
    return { done: done, total: total, open: total - done, openRows: openRows };
  }

  function pct(part, whole) { return whole ? Math.round((part / whole) * 100) : 0; }

  /* ───────────────────────── rendering ─────────────────────────── */

  function render() {
    var d = state.data;
    var claims = decodeJwt(state.credential) || {};

    $('page-sub').textContent = [CFG.INSTITUTION_NAME, CFG.DEPARTMENT_NAME]
      .filter(Boolean).join(' · ');
    $('page-title').textContent = isMaster() ? 'Department overview' : 'My assigned work';
    $('user-name').textContent = d.name || claims.name || d.email;
    $('user-role').textContent = isMaster() ? 'Master access'
      : (d.role === 'HOD' ? 'HOD view' : (d.uid ? 'Mentor UID ' + d.uid : d.email));
    if (d.picture || claims.picture) $('user-photo').src = d.picture || claims.picture;

    $('wrap-faculty').hidden = !isMaster();
    $('charts').hidden = !isMaster();
    $('stamp').textContent = new Date(d.generatedAt).toLocaleString();

    var notes = [];
    if (d.skipped && d.skipped.length) {
      notes.push('Tabs not shown: ' + d.skipped.map(function (s) { return s.tab + ' (' + s.why + ')'; }).join(', ') + '.');
    }
    if (d.unmatched && d.unmatched.length) {
      notes.push('Mentor names with no match in _Faculty: ' +
        d.unmatched.map(function (u) { return u.name + ' (' + u.rows + ')'; }).join(', ') + '.');
    }
    $('skipped-note').textContent = notes.length ? ' ' + notes.join(' ') : '';

    renderBoard();
    renderStats();
    renderLedger();
    buildFilters();
    if (isMaster()) renderCharts();
    renderTable();
    show('view-dash');
  }

  function renderBoard() {
    var items = (state.data.board || []).filter(function (b) { return b.title; });
    $('board-wrap').hidden = !items.length;
    if (!items.length) return;

    var mine = 0;
    var html = items.map(function (b) {
      var task = b.tab && state.taskByTab[b.tab];
      var rows = task ? state.data.rows.filter(function (r) { return r.tab === b.tab; }) : [];
      var t = tally(rows);
      if (rows.length) mine++;

      var progress = '';
      if (t.total) {
        progress = '<div class="mt-3"><div class="board-bar"><span style="width:' + pct(t.done, t.total) + '%"></span></div>' +
          '<p class="mt-1.5 text-[12px] text-ink-mute tnum">' + t.done + ' of ' + t.total + ' done</p></div>';
      } else if (rows.length) {
        progress = '<p class="mt-3 text-[12px] text-ink-mute tnum">' + rows.length + ' rows, no status column</p>';
      } else if (b.tab) {
        progress = '<p class="mt-3 text-[12px] text-ink-mute">Nothing assigned to you</p>';
      }

      return '<article class="board-card' + (rows.length ? ' is-mine' : '') + '">' +
        '<h3 class="font-medium leading-snug">' + esc(b.title) + '</h3>' +
        (b.deadline ? '<p class="mt-1 text-[12px] font-medium text-marigold">Due ' + esc(b.deadline) + '</p>' : '') +
        (b.note ? '<p class="mt-2 text-[12px] leading-relaxed text-ink-mute">' + esc(b.note.slice(0, 130)) + '</p>' : '') +
        progress +
        '<div class="mt-3 flex gap-2">' +
          (rows.length ? '<button class="board-btn" data-open-tab="' + esc(b.tab) + '">Open list</button>' : '') +
          (b.url ? '<a class="board-btn" href="' + esc(b.url) + '" target="_blank" rel="noopener">External link</a>' : '') +
        '</div></article>';
    }).join('');

    $('board').innerHTML = html;
    $('board-count').textContent = mine + ' of ' + items.length + ' involve you';
  }

  function statBlock(label, value, note) {
    return '<div class="stat"><p class="stat-label">' + esc(label) + '</p>' +
           '<p class="stat-value">' + esc(value) + '</p>' +
           '<p class="stat-note">' + esc(note || '') + '</p></div>';
  }

  function renderStats() {
    var rows = state.data.rows;
    var t = tally(rows);
    var students = {};
    rows.forEach(function (r) { if (r.reg) students[r.reg] = true; });
    var tabs = {};
    rows.forEach(function (r) { tabs[r.tab] = true; });

    if (isMaster()) {
      var faculty = {};
      rows.forEach(function (r) { if (r.ownerId) faculty[r.ownerId] = true; });
      $('stats').innerHTML =
        statBlock('Task tabs live', state.data.tasks.length, Object.keys(tabs).length + ' with rows in them') +
        statBlock('Students tracked', Object.keys(students).length, rows.length + ' rows in total') +
        statBlock('Department progress', pct(t.done, t.total) + '%', t.done + ' of ' + t.total + ' checks done') +
        statBlock('Faculty involved', Object.keys(faculty).length, t.openRows + ' rows still open');
    } else {
      $('stats').innerHTML =
        statBlock('Tasks I appear in', Object.keys(tabs).length, 'of ' + state.data.tasks.length + ' tabs') +
        statBlock('Students assigned to me', Object.keys(students).length, rows.length + ' rows in total') +
        statBlock('My progress', pct(t.done, t.total) + '%', t.done + ' of ' + t.total + ' checks done') +
        statBlock('Rows still open', t.openRows, t.open + ' individual checks pending');
    }
  }

  function renderLedger() {
    var t = tally(state.data.rows);
    var total = t.total || 1;
    document.querySelector('#ledger [data-seg="done"]').style.width = (t.done / total * 100) + '%';
    document.querySelector('#ledger [data-seg="open"]').style.width = (t.open / total * 100) + '%';
  }

  function buildFilters() {
    var tabsWithRows = {};
    state.data.rows.forEach(function (r) { tabsWithRows[r.tab] = (tabsWithRows[r.tab] || 0) + 1; });

    var options = state.data.tasks
      .filter(function (t) { return tabsWithRows[t.tab]; })
      .map(function (t) {
        return '<option value="' + esc(t.tab) + '"' + (t.tab === state.filters.task ? ' selected' : '') + '>' +
               esc(t.title) + ' (' + tabsWithRows[t.tab] + ')</option>';
      }).join('');
    $('f-task').innerHTML = '<option value="">All tasks</option>' + options;

    if (isMaster()) {
      var names = [];
      state.data.rows.forEach(function (r) {
        if (r.owner && names.indexOf(r.owner) === -1) names.push(r.owner);
      });
      names.sort();
      $('f-faculty').innerHTML = '<option value="">All faculty</option>' + names.map(function (n) {
        return '<option value="' + esc(n) + '"' + (n === state.filters.faculty ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('');
    }
  }

  function visibleRows() {
    var f = state.filters;
    var q = f.q.trim().toLowerCase();
    return state.data.rows.filter(function (r) {
      if (f.task && r.tab !== f.task) return false;
      if (f.faculty && r.owner !== f.faculty) return false;
      if (q && (r.student + ' ' + r.reg).toLowerCase().indexOf(q) === -1) return false;
      if (f.show) {
        var t = rowTotals(r);
        if (!t.total) return false;
        if (f.show === 'open' && t.done >= t.total) return false;
        if (f.show === 'done' && t.done < t.total) return false;
      }
      return true;
    });
  }

  function statusSelect(row, index, status, options) {
    var list = (options || []).slice();
    if (status.value && list.indexOf(status.value) === -1) list.unshift(status.value);
    if (list.indexOf('') === -1) list.push('');

    return '<select class="status-select" data-state="' + (status.done ? 'done' : (status.value ? 'open' : 'blank')) + '" ' +
      'data-tab="' + esc(row.tab) + '" data-row="' + row.row + '" data-index="' + index + '" ' +
      'data-column="' + esc(status.label) + '" data-reg="' + esc(row.reg) + '" ' +
      'title="' + esc(status.label) + '" aria-label="' + esc(status.label) + ' for ' + esc(row.student) + '">' +
      list.map(function (o) {
        return '<option value="' + esc(o) + '"' + (o === status.value ? ' selected' : '') + '>' +
               (o === '' ? '— blank —' : esc(o)) + '</option>';
      }).join('') + '</select>';
  }

  function rowKey(r) { return r.tab + '#' + r.row; }

  function detailRow(r, span) {
    var fields = (r.remarks || []).concat(r.info || []).concat(r.private || [])
      .filter(function (x) { return x.value; });
    if (!fields.length && !(r.remarks || []).length) {
      var pending = !state.data.hasDetail && !state.detailed[r.tab];
      return '<tr class="detail"><td colspan="' + span + '">' +
        (pending ? 'Loading the rest of this row…' : 'Nothing else recorded on this row.') +
        '</td></tr>';
    }
    var editable = (r.remarks || []).map(function (x) {
      return '<label class="detail-field"><span>' + esc(x.label) + '</span>' +
        '<input class="remark-input" value="' + esc(x.value) + '" placeholder="Add a note" ' +
        'data-tab="' + esc(r.tab) + '" data-row="' + r.row + '" data-column="' + esc(x.label) + '" ' +
        'data-reg="' + esc(r.reg) + '"></label>';
    }).join('');
    var readOnly = (r.info || []).concat(r.private || []).filter(function (x) { return x.value; })
      .map(function (x) {
        return '<div class="detail-field"><span>' + esc(x.label) + '</span><p>' + esc(x.value) + '</p></div>';
      }).join('');
    return '<tr class="detail"><td colspan="' + span + '"><div class="detail-grid">' + editable + readOnly + '</div></td></tr>';
  }

  function renderTable() {
    var rows = visibleRows();
    var single = state.filters.task ? state.taskByTab[state.filters.task] : null;
    var master = isMaster();

    var headers = [];
    if (!single) headers.push('Task');
    headers.push(single && single.kind === 'faculty' ? (single.itemLabel || 'Item') : 'Student');
    headers.push('Reg. no.');
    if (master) headers.push('Faculty');
    if (single) {
      single.statuses.forEach(function (s) { headers.push(s.label); });
      if (!single.statuses.length) headers.push('Status');
    } else {
      headers.push('Progress');
    }
    headers.push('');

    $('table-head').innerHTML = '<tr>' + headers.map(function (h, i) {
      return '<th' + (i === headers.length - 1 ? ' class="w-8"' : '') + '>' + esc(h) + '</th>';
    }).join('') + '</tr>';

    if (!rows.length) {
      $('table-body').innerHTML = '<tr><td colspan="' + headers.length + '" class="px-4 py-16 text-center text-ink-mute">' +
        (state.data.rows.length
          ? 'No rows match these filters.'
          : 'Nothing is assigned to you yet. When your name or Mentor UID appears on a task tab, it shows up here.') +
        '</td></tr>';
      $('table-foot').innerHTML = '';
      return;
    }

    var html = rows.slice(0, 800).map(function (r) {
      var t = rowTotals(r);
      var cells = '';

      if (!single) cells += '<td><span class="task-chip">' + esc(state.taskByTab[r.tab] ? state.taskByTab[r.tab].title : r.tab) + '</span></td>';
      cells += '<td class="font-medium">' + esc(r.student || '—') +
               (r.inherited ? '<span class="inherit-flag" title="Mentor carried down from the row above">carried</span>' : '') + '</td>';
      cells += '<td class="tnum text-ink-mute">' + esc(r.reg || '—') + '</td>';
      if (master) cells += '<td>' + esc(r.owner || '—') + '</td>';

      if (single) {
        if (single.statuses.length) {
          single.statuses.forEach(function (s, i) {
            var mine = r.statuses[i] || { label: s.label, value: '', done: false };
            cells += '<td>' + statusSelect(r, i, mine, s.options) + '</td>';
          });
        } else {
          cells += '<td class="text-ink-mute">No status column on this tab</td>';
        }
      } else if (!t.total) {
        cells += '<td class="text-ink-mute text-[13px]">reference list</td>';
      } else {
        var task = state.taskByTab[r.tab];
        cells += '<td><div class="flex items-center gap-2">' +
          statusSelect(r, 0, r.statuses[0], task && task.statuses[0] ? task.statuses[0].options : []) +
          (t.total > 1 ? '<span class="more-chip" title="' + esc(r.statuses.slice(1).map(function (s) { return s.label + ': ' + (s.value || '—'); }).join(' · ')) + '">+' + (t.total - 1) + '</span>' : '') +
          '</div></td>';
      }

      cells += '<td class="text-right"><button class="expand-btn" data-key="' + esc(rowKey(r)) + '" aria-label="Show details">' +
               (state.expanded[rowKey(r)] ? '&minus;' : '+') + '</button></td>';

      return '<tr data-key="' + esc(rowKey(r)) + '">' + cells + '</tr>' +
             (state.expanded[rowKey(r)] ? detailRow(r, headers.length) : '');
    }).join('');

    $('table-body').innerHTML = html;

    var t2 = tally(rows);
    $('table-foot').innerHTML =
      '<span>Showing ' + Math.min(rows.length, 800) + ' of ' + state.data.rows.length + ' rows' +
      (rows.length > 800 ? ' — narrow the filters to see the rest' : '') + '</span>' +
      '<span class="tnum">' + t2.done + ' done · ' + t2.open + ' open' +
      (t2.total ? ' · ' + pct(t2.done, t2.total) + '%' : '') + '</span>';
  }

  /* ────────────────────────── charts ──────────────────────────── */

  function renderCharts() {
    var byFaculty = {}, byTask = {};

    state.data.rows.forEach(function (r) {
      var t = rowTotals(r);
      if (!t.total) return;

      var f = r.owner || '—';
      if (!byFaculty[f]) byFaculty[f] = { done: 0, total: 0 };
      byFaculty[f].done += t.done; byFaculty[f].total += t.total;

      var title = state.taskByTab[r.tab] ? state.taskByTab[r.tab].title : r.tab;
      if (!byTask[title]) byTask[title] = { done: 0, total: 0 };
      byTask[title].done += t.done; byTask[title].total += t.total;
    });

    var names = Object.keys(byFaculty).sort(function (a, b) {
      return pct(byFaculty[b].done, byFaculty[b].total) - pct(byFaculty[a].done, byFaculty[a].total);
    }).slice(0, 25);

    draw('faculty', 'chart-faculty', {
      type: 'bar',
      data: {
        labels: names,
        datasets: [{
          data: names.map(function (n) { return pct(byFaculty[n].done, byFaculty[n].total); }),
          backgroundColor: '#0e6e62', hoverBackgroundColor: '#0a5449',
          borderRadius: 3, maxBarThickness: 26
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) {
            var f = byFaculty[c.label];
            return c.parsed.x + '% — ' + f.done + ' of ' + f.total + ' checks done';
          }}}
        },
        scales: {
          x: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } }, grid: { color: '#eef0f4' } },
          y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } }
        }
      }
    });

    var taskNames = Object.keys(byTask).sort(function (a, b) { return byTask[b].total - byTask[a].total; }).slice(0, 12);
    draw('task', 'chart-task', {
      type: 'bar',
      data: {
        labels: taskNames,
        datasets: [
          { label: 'Done', data: taskNames.map(function (t) { return byTask[t].done; }), backgroundColor: '#0e6e62', borderRadius: 2 },
          { label: 'Open', data: taskNames.map(function (t) { return byTask[t].total - byTask[t].done; }), backgroundColor: '#c98a06', borderRadius: 2 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14 } } },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: '#eef0f4' } },
          y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } }
        }
      }
    });
  }

  function draw(key, canvasId, spec) {
    if (state.charts[key]) state.charts[key].destroy();
    Chart.defaults.font.family = '"Instrument Sans", system-ui, sans-serif';
    Chart.defaults.color = '#64748b';
    state.charts[key] = new Chart($(canvasId).getContext('2d'), spec);
  }

  /**
   * Opens one task tab. A master's first load leaves out the extra columns to
   * keep it quick, so those are fetched here, once per tab.
   */
  function openTask(tab) {
    state.filters.task = tab;
    state.expanded = {};
    renderTable();

    if (!tab || state.data.hasDetail || state.detailed[tab]) return;

    api({ method: 'GET', tab: tab })
      .then(function (res) {
        if (!res || !res.ok) return;
        var byRow = {};
        res.rows.forEach(function (r) { byRow[r.row] = r; });
        state.data.rows.forEach(function (r) {
          if (r.tab !== tab) return;
          var full = byRow[r.row];
          if (full) { r.info = full.info || []; r.private = full.private || []; }
        });
        state.detailed[tab] = true;
        if (state.filters.task === tab) renderTable();
      })
      .catch(function () { /* details are optional; the table still works */ });
  }

  /* ────────────────────────── updates ─────────────────────────── */

  function findRow(tab, rowNum) {
    for (var i = 0; i < state.data.rows.length; i++) {
      if (state.data.rows[i].tab === tab && state.data.rows[i].row === Number(rowNum)) return state.data.rows[i];
    }
    return null;
  }

  function saveStatus(select) {
    var record = findRow(select.dataset.tab, select.dataset.row);
    if (!record) return;

    var index = Number(select.dataset.index);
    var status = record.statuses[index];
    var previous = status ? status.value : '';
    var next = select.value;
    var task = state.taskByTab[record.tab];

    select.disabled = true;
    api({ method: 'POST', body: {
      action: 'updateCell', tab: record.tab, row: record.row,
      headerRow: task ? task.headerRow : 1,
      column: select.dataset.column, value: next, reg: record.reg
    }})
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Update failed');
        if (status) {
          status.value = next;
          status.done = looksDone(next);
        }
        renderStats(); renderLedger();
        if (isMaster()) renderCharts();
        renderTable();
        flash(record);
        toast(select.dataset.column + ' set to "' + (next || 'blank') + '" for ' + (record.student || record.reg));
      })
      .catch(function (err) {
        select.value = previous;
        var message = String(err.message || err);
        if (message === 'STALE_ROW') message = 'That row moved in the sheet. Press Refresh data and try again.';
        if (!handleError(message)) toast(message, true);
      })
      .then(function () { select.disabled = false; });
  }

  function saveRemark(input) {
    var record = findRow(input.dataset.tab, input.dataset.row);
    if (!record) return;
    var field = (record.remarks || []).filter(function (x) { return x.label === input.dataset.column; })[0];
    if (!field || input.value === field.value) return;

    var previous = field.value;
    var task = state.taskByTab[record.tab];

    api({ method: 'POST', body: {
      action: 'updateCell', tab: record.tab, row: record.row,
      headerRow: task ? task.headerRow : 1,
      column: input.dataset.column, value: input.value, reg: record.reg
    }})
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Update failed');
        field.value = input.value;
        toast('Saved to ' + input.dataset.column);
      })
      .catch(function (err) {
        input.value = previous;
        var message = String(err.message || err);
        if (!handleError(message)) toast(message, true);
      });
  }

  /** Mirrors the server's rule so the page can colour a cell before a reload. */
  function looksDone(value) {
    var v = String(value || '').toLowerCase().trim();
    if (!v) return false;
    if (/^(not|non|no|pending|absent|na|nope)\b/.test(v)) return false;
    return /(registered|complete|done|taken|yes|verified|approved|selected|placed|submitted|closed|attempted|checked)/.test(v);
  }

  function flash(record) {
    var key = rowKey(record);
    Array.prototype.forEach.call($('table-body').querySelectorAll('tr'), function (tr) {
      if (tr.dataset.key === key) tr.classList.add('saved');
    });
  }

  /* ────────────────────────── export ──────────────────────────── */

  function exportCsv() {
    var rows = visibleRows();
    if (!rows.length) return toast('Nothing to download with these filters.', true);

    var quote = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var header = ['Task tab', 'Student or item', 'Registration no.', 'Faculty', 'Status column', 'Value', 'Done'];
    var lines = [header.map(quote).join(',')];

    rows.forEach(function (r) {
      if (!r.statuses.length) {
        lines.push([r.tab, r.student, r.reg, r.owner, '', '', ''].map(quote).join(','));
        return;
      }
      r.statuses.forEach(function (s) {
        lines.push([r.tab, r.student, r.reg, r.owner, s.label, s.value, s.done ? 'Yes' : 'No'].map(quote).join(','));
      });
    });

    var url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'domain-tasks-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ────────────────────────── wiring ──────────────────────────── */

  function bind() {
    $('btn-refresh').addEventListener('click', loadData);
    $('btn-retry').addEventListener('click', loadData);
    $('btn-switch').addEventListener('click', function () { signOut(); });
    $('btn-signout').addEventListener('click', function () { signOut(); });
    $('btn-export').addEventListener('click', exportCsv);

    var timer;
    $('f-search').addEventListener('input', function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () { state.filters.q = e.target.value; renderTable(); }, 180);
    });
    $('f-task').addEventListener('change', function (e) {
      openTask(e.target.value);
    });
    $('f-faculty').addEventListener('change', function (e) { state.filters.faculty = e.target.value; renderTable(); });
    $('f-state').addEventListener('change', function (e) { state.filters.show = e.target.value; renderTable(); });

    $('board').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-open-tab]');
      if (!btn) return;
      $('f-task').value = btn.dataset.openTab;
      openTask(btn.dataset.openTab);
      $('f-task').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    $('table-body').addEventListener('change', function (e) {
      if (e.target.classList.contains('status-select')) saveStatus(e.target);
    });
    $('table-body').addEventListener('click', function (e) {
      var btn = e.target.closest('.expand-btn');
      if (!btn) return;
      state.expanded[btn.dataset.key] = !state.expanded[btn.dataset.key];
      renderTable();
    });
    $('table-body').addEventListener('blur', function (e) {
      if (e.target.classList.contains('remark-input')) saveRemark(e.target);
    }, true);
    $('table-body').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.classList.contains('remark-input')) e.target.blur();
    });
  }

  function start() {
    var missing = [];
    if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE') === 0) missing.push('API_URL');
    if (!CFG.GOOGLE_CLIENT_ID || CFG.GOOGLE_CLIENT_ID.indexOf('PASTE') === 0) missing.push('GOOGLE_CLIENT_ID');
    if (missing.length) {
      return fail('Open config.js and set ' + missing.join(' and ') + '. Steps 3 and 5 of SETUP.md explain where each value comes from.', 'Not configured yet');
    }
    bind();
    initGoogle();
  }

  document.addEventListener('DOMContentLoaded', start);
})();
