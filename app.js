(function () {
  var STORAGE_KEY = 'student-progress-app-v1';
  var SYNC_CONFIG_KEY = 'student-progress-sync-config-v1';
  var VIEW = document.querySelector('#view');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var importInput = document.querySelector('#importJsonInput');
  var exportJsonBtn = document.querySelector('#exportJsonBtn');
  var ui = {
    activeTab: 'dashboard',
    selectedStudentId: null,
    dashboardTeacherId: 'all',
    studentTeacherId: 'all',
    assignmentTeacherId: 'all',
    progressTeacherId: 'all',
    progressStudentId: 'all',
    progressBookId: 'all',
    progressStatus: 'all',
    progressQuery: '',
    showProgressFilters: false,
    alertsTeacherId: 'all',
    detailTeacherId: 'all',
    detailStudentId: null,
    consultTeacherId: 'all',
    consultStartDate: '',
    consultWeeks: 4,
    consultStartTime: '14:00',
    consultInterval: 20,
    consultMaxPerDay: 6,
    consultDraft: [],
    consultConflicts: [],
    homeworkTeacherId: 'all',
    homeworkStudentId: 'all',
    homeworkStatus: 'all',
    showHomeworkFilters: false,
    quickTeacherId: 'all',
    quickBookId: 'all',
    showQuickFilters: false,
    aiTeacherId: 'all',
    aiStudentId: null,
    aiTemplate: '균형 평가',
    aiTone: '학부모 상담용',
    aiLength: '보통',
    aiKeywords: '',
    aiDraft: '',
    aiStatus: '',
    aiBusy: false
  };
  var state = loadState();
  var syncConfig = loadSyncConfig();
  var syncTimer = null;
  var syncStatus = '';

  function seedState() {
    var students = [];
    for (var i = 1; i <= 35; i += 1) students.push({ id: 'stu-' + i, name: '학생 ' + String(i).padStart(2, '0'), teacherId: '', teacherIds: [], memo: '' });
    var counts = [12, 10, 8, 15, 6];
    var books = counts.map(function (unitCount, index) { return { id: 'book-' + (index + 1), name: '책 ' + String(index + 1).padStart(2, '0'), unitCount: unitCount, memo: '책 이름과 단원 수를 실제 값으로 바꾸세요' }; });
    return { version: 6, teachers: [], students: students, books: books, assignments: [], progress: {}, homework: [], consultations: [], consultationSettings: {}, consultationSchedule: [], evaluations: [] };
  }

  function normalizeState(data) {
    if (!data || !data.students || !data.books || !data.assignments || !data.progress) return seedState();
    data.version = Math.max(Number(data.version || 1), 6);
    data.teachers = Array.isArray(data.teachers) ? data.teachers : [];
    data.homework = Array.isArray(data.homework) ? data.homework : [];
    data.consultations = Array.isArray(data.consultations) ? data.consultations : [];
    data.consultationSettings = data.consultationSettings && typeof data.consultationSettings === 'object' ? data.consultationSettings : {};
    data.consultationSchedule = Array.isArray(data.consultationSchedule) ? data.consultationSchedule : [];
    data.evaluations = Array.isArray(data.evaluations) ? data.evaluations : [];
    data.students.forEach(function (student) { normalizeStudentTeachers(student); delete student.status; });
    data.students.forEach(function (student) { data.consultationSettings[student.id] = normalizeConsultationSetting(data.consultationSettings[student.id], student); });
    data.teachers.forEach(function (teacher) { if (teacher.memo == null) teacher.memo = ''; });
    data.homework.forEach(function (item) { var ids = normalizeTeacherIdList(item.teacherIds); if (!ids.length && item.teacherId) ids = normalizeTeacherIdList(item.teacherId); if (item.status == null) item.status = 'todo'; if (item.memo == null) item.memo = ''; if (item.createdAt == null) item.createdAt = new Date().toISOString(); item.teacherIds = ids; item.teacherId = ids[0] || ''; });
    data.consultations.forEach(function (item) { var ids = normalizeTeacherIdList(item.teacherIds); if (!ids.length && item.teacherId) ids = normalizeTeacherIdList(item.teacherId); if (item.type == null) item.type = '상담 메모'; if (item.date == null) item.date = new Date().toISOString().slice(0, 10); item.teacherIds = ids; item.teacherId = ids[0] || ''; });
    data.consultationSchedule.forEach(function (item) { var student = data.students.find(function (s) { return s.id === item.studentId; }); var ids = normalizeTeacherIdList(item.teacherIds); if (!ids.length && item.teacherId) ids = normalizeTeacherIdList(item.teacherId); if (!ids.length && student) ids = studentTeacherIds(student); item.teacherIds = ids; item.teacherId = ids[0] || ''; if (item.status == null) item.status = 'scheduled'; if (item.duration == null) item.duration = 20; if (item.memo == null) item.memo = ''; if (item.createdAt == null) item.createdAt = new Date().toISOString(); });
    data.evaluations.forEach(function (item) { var ids = normalizeTeacherIdList(item.teacherIds); if (!ids.length && item.teacherId) ids = normalizeTeacherIdList(item.teacherId); item.teacherIds = ids; item.teacherId = ids[0] || ''; });
    return data;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedState();
      var parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (error) { return seedState(); }
  }

  function saveState(options) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!(options && options.skipSync)) scheduleAutoSync();
  }

  function loadSyncConfig() {
    try {
      var raw = localStorage.getItem(SYNC_CONFIG_KEY);
      if (!raw) return { url: '', token: '', auto: false, lastSync: '' };
      var parsed = JSON.parse(raw);
      return { url: parsed.url || '', token: parsed.token || '', auto: Boolean(parsed.auto), lastSync: parsed.lastSync || '' };
    } catch (error) {
      return { url: '', token: '', auto: false, lastSync: '' };
    }
  }

  function saveSyncConfig() {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(syncConfig));
  }

  function setSyncStatus(message) {
    syncStatus = message || '';
    var node = document.querySelector('#syncStatusText');
    if (node) node.textContent = syncStatus;
  }

  function setAiStatus(message) {
    ui.aiStatus = message || '';
    var node = document.querySelector('#aiStatusText');
    if (node) node.textContent = ui.aiStatus;
  }

  function scheduleAutoSync() {
    if (!syncConfig.auto || !syncConfig.url) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { saveToGoogleSheet(true); }, 1400);
  }

  function registerMobileAppShell() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('./service-worker.js').catch(function () {});
  }

  function normalizeSyncUrl(url) {
    return String(url || '').trim();
  }

  function syncEndpointUrl(action) {
    var url = normalizeSyncUrl(syncConfig.url);
    if (!url) return '';
    var params = 'action=' + encodeURIComponent(action);
    if (syncConfig.token) params += '&token=' + encodeURIComponent(syncConfig.token);
    return url + (url.indexOf('?') === -1 ? '?' : '&') + params;
  }

  function requestJson(url, options) {
    return fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function loadViaJsonp() {
    return new Promise(function (resolve, reject) {
      var callbackName = '__studentProgressSync_' + Date.now().toString(36);
      var script = document.createElement('script');
      var done = false;
      window[callbackName] = function (payload) {
        done = true;
        delete window[callbackName];
        script.remove();
        resolve(payload);
      };
      script.onerror = function () {
        if (done) return;
        delete window[callbackName];
        script.remove();
        reject(new Error('JSONP load failed'));
      };
      script.src = syncEndpointUrl('load') + '&callback=' + encodeURIComponent(callbackName) + '&t=' + Date.now();
      document.body.append(script);
      setTimeout(function () {
        if (done) return;
        delete window[callbackName];
        script.remove();
        reject(new Error('JSONP timeout'));
      }, 12000);
    });
  }

  function assertSyncPayload(payload) {
    if (payload && payload.ok === false) throw new Error(payload.error || '구글 시트 요청이 실패했습니다.');
    return payload;
  }

  function extractStateFromSyncPayload(payload) {
    assertSyncPayload(payload);
    var nextState = payload && (payload.state || (payload.data && payload.data.state));
    if (!nextState || !nextState.students || !nextState.books || !nextState.assignments || !nextState.progress) {
      throw new Error('시트에 저장된 앱 데이터가 없습니다.');
    }
    return nextState;
  }

  function fetchSheetStatePayload() {
    return requestJson(syncEndpointUrl('load'), { method: 'GET' }).catch(loadViaJsonp);
  }

  function verifySheetSave() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 900);
    }).then(fetchSheetStatePayload).then(function (payload) {
      extractStateFromSyncPayload(payload);
      return true;
    });
  }

  function evaluateViaJsonp(input) {
    return new Promise(function (resolve, reject) {
      var callbackName = '__studentEvaluationAi_' + Date.now().toString(36);
      var script = document.createElement('script');
      var done = false;
      window[callbackName] = function (payload) {
        done = true;
        delete window[callbackName];
        script.remove();
        resolve(payload);
      };
      script.onerror = function () {
        if (done) return;
        delete window[callbackName];
        script.remove();
        reject(new Error('AI JSONP failed'));
      };
      script.src = syncEndpointUrl('evaluate') + '&callback=' + encodeURIComponent(callbackName) + '&input=' + encodeURIComponent(JSON.stringify(input)) + '&t=' + Date.now();
      document.body.append(script);
      setTimeout(function () {
        if (done) return;
        delete window[callbackName];
        script.remove();
        reject(new Error('AI response timeout'));
      }, 30000);
    });
  }

  function postViaHiddenForm(payload) {
    return new Promise(function (resolve) {
      var frameName = 'syncFrame' + Date.now().toString(36);
      var frame = document.createElement('iframe');
      frame.name = frameName;
      frame.hidden = true;
      var form = document.createElement('form');
      form.method = 'POST';
      form.action = syncEndpointUrl('save');
      form.target = frameName;
      form.hidden = true;
      var input = document.createElement('input');
      input.name = 'data';
      input.value = JSON.stringify(payload);
      form.append(input);
      document.body.append(frame, form);
      frame.addEventListener('load', function () {
        setTimeout(function () { frame.remove(); form.remove(); resolve({ ok: true, fallback: true }); }, 200);
      });
      form.submit();
      setTimeout(function () {
        if (document.body.contains(frame)) {
          frame.remove();
          form.remove();
          resolve({ ok: true, fallback: true });
        }
      }, 5000);
    });
  }

  function saveToGoogleSheet(isAuto) {
    if (!syncConfig.url) {
      setSyncStatus('Apps Script URL을 먼저 입력하세요.');
      return Promise.resolve(false);
    }
    setSyncStatus(isAuto ? '자동 저장 중...' : '구글 시트에 저장 중...');
    var payload = { action: 'save', state: state, savedAt: new Date().toISOString() };
    return requestJson(syncEndpointUrl('save'), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).catch(function () {
      return postViaHiddenForm(payload);
    }).then(function (payload) {
      assertSyncPayload(payload);
      return verifySheetSave();
    }).then(function () {
      syncConfig.lastSync = new Date().toISOString();
      saveSyncConfig();
      setSyncStatus('저장 완료 ' + new Date().toLocaleTimeString());
      return true;
    }).catch(function (error) {
      setSyncStatus('저장 실패: ' + (error && error.message ? error.message : error));
      return false;
    });
  }

  function loadFromGoogleSheet() {
    if (!syncConfig.url) {
      setSyncStatus('Apps Script URL을 먼저 입력하세요.');
      return Promise.resolve(false);
    }
    setSyncStatus('구글 시트에서 불러오는 중...');
    return fetchSheetStatePayload().then(function (payload) {
      var nextState = extractStateFromSyncPayload(payload);
      state = normalizeState(nextState);
      saveState({ skipSync: true });
      syncConfig.lastSync = new Date().toISOString();
      saveSyncConfig();
      ui.selectedStudentId = state.students[0] ? state.students[0].id : null;
      ui.aiStudentId = state.students[0] ? state.students[0].id : null;
      setSyncStatus('불러오기 완료 ' + new Date().toLocaleTimeString());
      render();
      return true;
    }).catch(function (error) {
      setSyncStatus('불러오기 실패: ' + (error && error.message ? error.message : error));
      return false;
    });
  }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function escapeHtml(value) { return String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
  function clampUnitCount(value) { var parsed = parseInt(value, 10); if (Number.isNaN(parsed)) return 0; return Math.max(0, Math.min(80, parsed)); }
  function percent(done, total) { return total ? Math.round((done / total) * 100) : 0; }
  function getStudent(id) { return state.students.find(function (student) { return student.id === id; }); }
  function getBook(id) { return state.books.find(function (book) { return book.id === id; }); }
  function getTeacher(id) { return state.teachers.find(function (teacher) { return teacher.id === id; }); }
  function getAssignment(studentId, bookId) { return state.assignments.find(function (assignment) { return assignment.studentId === studentId && assignment.bookId === bookId; }); }
  function progressKey(assignmentId, unitNumber) { return assignmentId + ':' + unitNumber; }
  function getRecord(assignmentId, unitNumber) { return state.progress[progressKey(assignmentId, unitNumber)] || { done: false, date: '', memo: '' }; }
  function setRecord(assignmentId, unitNumber, patch) { var key = progressKey(assignmentId, unitNumber); state.progress[key] = Object.assign({}, getRecord(assignmentId, unitNumber), patch); saveState(); }

  function normalizeTeacherIdList(ids) {
    var raw = Array.isArray(ids) ? ids : (ids ? [ids] : []);
    var seen = {};
    return raw.map(function (id) { return String(id || '').trim(); }).filter(function (id) {
      if (!id || id === 'all' || id === 'unassigned' || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function normalizeStudentTeachers(student) {
    var ids = normalizeTeacherIdList(student.teacherIds);
    if (!ids.length && student.teacherId) ids = normalizeTeacherIdList(student.teacherId);
    student.teacherIds = ids;
    student.teacherId = ids[0] || '';
  }

  function studentTeacherIds(student) {
    if (!student) return [];
    var ids = normalizeTeacherIdList(student.teacherIds);
    if (!ids.length && student.teacherId) ids = normalizeTeacherIdList(student.teacherId);
    return ids;
  }

  function setStudentTeacherIds(student, ids) {
    if (!student) return [];
    var normalized = normalizeTeacherIdList(ids);
    student.teacherIds = normalized;
    student.teacherId = normalized[0] || '';
    return normalized;
  }

  function teacherName(teacherId) {
    if (!teacherId) return '미지정';
    if (teacherId === 'unassigned') return '담당 미지정';
    var teacher = getTeacher(teacherId);
    return teacher ? teacher.name : '삭제된 선생님';
  }

  function teacherNamesForIds(ids) {
    var normalized = normalizeTeacherIdList(ids);
    if (!normalized.length) return '미지정';
    return normalized.map(function (teacherId) { return teacherName(teacherId); }).join(', ');
  }

  function teacherNamesForStudent(student) {
    return teacherNamesForIds(studentTeacherIds(student));
  }

  function firstTeacherIdForStudent(student) {
    var ids = studentTeacherIds(student);
    return ids[0] || '';
  }

  function teacherMatches(student, teacherId) {
    if (!student) return false;
    if (!teacherId || teacherId === 'all') return true;
    var ids = studentTeacherIds(student);
    if (teacherId === 'unassigned') return !ids.length;
    return ids.indexOf(teacherId) !== -1;
  }

  function studentsByTeacher(teacherId) {
    return state.students.filter(function (student) { return teacherMatches(student, teacherId || 'all'); });
  }

  function firstStudentIdForTeacher(teacherId) {
    var students = studentsByTeacher(teacherId || 'all');
    return students[0] ? students[0].id : null;
  }

  function teacherOptions(selectedId, includeAll, includeUnassigned) {
    var options = includeAll ? '<option value="all" ' + (selectedId === 'all' ? 'selected' : '') + '>전체 선생님</option>' : '';
    if (includeUnassigned) options += '<option value="unassigned" ' + (selectedId === 'unassigned' ? 'selected' : '') + '>담당 미지정</option>';
    return options + state.teachers.map(function (teacher) {
      return '<option value="' + teacher.id + '" ' + (selectedId === teacher.id ? 'selected' : '') + '>' + escapeHtml(teacher.name) + '</option>';
    }).join('');
  }

  function studentOptions(selectedId, includeAll, teacherId) {
    var students = studentsByTeacher(teacherId || 'all');
    var all = includeAll ? '<option value="all">전체 학생</option>' : '';
    return all + students.map(function (s) { return '<option value="' + s.id + '" ' + (selectedId === s.id ? 'selected' : '') + '>' + escapeHtml(s.name) + '</option>'; }).join('');
  }

  function bookOptions(selectedId, includeAll) { var all = includeAll ? '<option value="all">전체 책</option>' : ''; return all + state.books.map(function (b) { return '<option value="' + b.id + '" ' + (selectedId === b.id ? 'selected' : '') + '>' + escapeHtml(b.name) + '</option>'; }).join(''); }

  var CONSULT_WEEKDAYS = [
    { value: 1, label: '월' },
    { value: 2, label: '화' },
    { value: 3, label: '수' },
    { value: 4, label: '목' },
    { value: 5, label: '금' },
    { value: 6, label: '토' },
    { value: 0, label: '일' }
  ];

  function normalizeWeekdays(days) {
    var raw = Array.isArray(days) ? days : [];
    var seen = {};
    return raw.map(function (day) { return Number(day); }).filter(function (day) {
      if (Number.isNaN(day) || day < 0 || day > 6 || seen[day]) return false;
      seen[day] = true;
      return true;
    });
  }

  function normalizeConsultationSetting(setting, student) {
    setting = setting && typeof setting === 'object' ? setting : {};
    var teacherIds = studentTeacherIds(student);
    return {
      enabled: setting.enabled !== false,
      cycle: ['weekly','biweekly','monthly','as-needed'].indexOf(setting.cycle) !== -1 ? setting.cycle : 'monthly',
      weekdays: normalizeWeekdays(setting.weekdays).length ? normalizeWeekdays(setting.weekdays) : [1, 2, 3, 4, 5],
      teacherId: setting.teacherId && teacherIds.indexOf(setting.teacherId) !== -1 ? setting.teacherId : (teacherIds[0] || ''),
      priority: setting.priority === 'high' ? 'high' : 'normal',
      preferredTime: String(setting.preferredTime || '').trim(),
      memo: String(setting.memo || '').trim()
    };
  }

  function consultationSetting(studentId) {
    var student = getStudent(studentId);
    state.consultationSettings = state.consultationSettings || {};
    state.consultationSettings[studentId] = normalizeConsultationSetting(state.consultationSettings[studentId], student);
    return state.consultationSettings[studentId];
  }

  function consultationCycleLabel(cycle) {
    return ({ weekly: '매주', biweekly: '2주마다', monthly: '월 1회', 'as-needed': '필요 시' })[cycle] || '월 1회';
  }

  function consultationCycleOptions(selected) {
    return ['weekly','biweekly','monthly','as-needed'].map(function (cycle) {
      return '<option value="' + cycle + '" ' + (selected === cycle ? 'selected' : '') + '>' + consultationCycleLabel(cycle) + '</option>';
    }).join('');
  }

  function consultationStatusLabel(status) {
    return ({ scheduled: '예정', done: '완료', canceled: '취소' })[status] || '예정';
  }

  function consultationStatusOptions(selected) {
    return ['scheduled','done','canceled'].map(function (status) {
      return '<option value="' + status + '" ' + (selected === status ? 'selected' : '') + '>' + consultationStatusLabel(status) + '</option>';
    }).join('');
  }

  function consultationPriorityLabel(priority) {
    return priority === 'high' ? '높음' : '보통';
  }

  function weekdayLabels(days) {
    var normalized = normalizeWeekdays(days);
    return CONSULT_WEEKDAYS.filter(function (day) { return normalized.indexOf(day.value) !== -1; }).map(function (day) { return day.label; }).join(', ');
  }

  function consultationCycleDays(cycle) {
    return ({ weekly: 7, biweekly: 14, monthly: 28 })[cycle] || 0;
  }

  function addDays(dateString, days) {
    var date = parseDateValue(dateString || todayString()) || new Date();
    date.setDate(date.getDate() + Number(days || 0));
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function compareDates(a, b) {
    return String(a || '').localeCompare(String(b || ''));
  }

  function latestConsultationDate(studentId) {
    var dates = [];
    consultationsForStudent(studentId).forEach(function (item) { if (item.date) dates.push(item.date); });
    (state.consultationSchedule || []).forEach(function (item) {
      if (item.studentId === studentId && item.status === 'done' && item.date) dates.push(item.date);
    });
    return dates.sort().pop() || '';
  }

  function nextDueDate(studentId) {
    var setting = consultationSetting(studentId);
    var cycleDays = consultationCycleDays(setting.cycle);
    if (!setting.enabled || !cycleDays) return '';
    var latest = latestConsultationDate(studentId);
    return latest ? addDays(latest, cycleDays) : todayString();
  }

  function timeToMinutes(time) {
    var parts = String(time || '14:00').split(':');
    return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
  }

  function minutesToTime(minutes) {
    var hour = Math.floor(minutes / 60);
    var minute = minutes % 60;
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  function consultationTeacherOptions(selectedId, student) {
    var ids = studentTeacherIds(student);
    var options = '<option value="">자동</option>';
    return options + ids.map(function (teacherId) {
      return '<option value="' + teacherId + '" ' + (selectedId === teacherId ? 'selected' : '') + '>' + escapeHtml(teacherName(teacherId)) + '</option>';
    }).join('');
  }

  function activeAssignments() {
    return state.assignments.filter(function (assignment) {
      var student = getStudent(assignment.studentId);
      var book = getBook(assignment.bookId);
      return assignment.active && student && book && book.unitCount > 0;
    });
  }

  function activeAssignmentsByTeacher(teacherId) {
    return activeAssignments().filter(function (assignment) { return teacherMatches(getStudent(assignment.studentId), teacherId || 'all'); });
  }

  function assignmentTotals(assignment) {
    var book = getBook(assignment.bookId);
    var total = book ? book.unitCount : 0;
    var done = 0;
    for (var unit = 1; unit <= total; unit += 1) if (getRecord(assignment.id, unit).done) done += 1;
    return { total: total, done: done, remaining: total - done, rate: percent(done, total) };
  }

  function studentTotals(studentId) {
    return activeAssignments().filter(function (assignment) { return assignment.studentId === studentId; }).reduce(function (sum, assignment) {
      var totals = assignmentTotals(assignment); sum.books += 1; sum.total += totals.total; sum.done += totals.done; return sum;
    }, { books: 0, total: 0, done: 0 });
  }

  function bookTotals(bookId, teacherId) {
    return activeAssignmentsByTeacher(teacherId || 'all').filter(function (assignment) { return assignment.bookId === bookId; }).reduce(function (sum, assignment) {
      var totals = assignmentTotals(assignment); sum.students += 1; sum.total += totals.total; sum.done += totals.done; return sum;
    }, { students: 0, total: 0, done: 0 });
  }

  function overallTotals(teacherId) {
    return activeAssignmentsByTeacher(teacherId || 'all').reduce(function (sum, assignment) {
      var totals = assignmentTotals(assignment); sum.assignments += 1; sum.total += totals.total; sum.done += totals.done; return sum;
    }, { assignments: 0, total: 0, done: 0 });
  }

  function ensureAiStudentId() {
    if (ui.aiStudentId && getStudent(ui.aiStudentId) && teacherMatches(getStudent(ui.aiStudentId), ui.aiTeacherId)) return ui.aiStudentId;
    ui.aiStudentId = firstStudentIdForTeacher(ui.aiTeacherId);
    return ui.aiStudentId;
  }

  function studentProgressSummary(studentId) {
    var assignments = activeAssignments().filter(function (assignment) { return assignment.studentId === studentId; });
    if (!assignments.length) return { text: '아직 배정된 책이 없습니다.', books: [] };
    var books = assignments.map(function (assignment) {
      var book = getBook(assignment.bookId);
      var totals = assignmentTotals(assignment);
      return { bookName: book ? book.name : '', total: totals.total, done: totals.done, remaining: totals.remaining, rate: totals.rate };
    });
    return {
      books: books,
      text: books.map(function (item) {
        return item.bookName + ': ' + item.done + '/' + item.total + '단원 완료, ' + item.rate + '%, 남은 단원 ' + item.remaining + '개';
      }).join(' / ')
    };
  }

  function localEvaluationPrefix(reason) {
    return reason ? '[AI 연결 전 기본 초안] ' + reason + '\n\n' : '';
  }

  function generateLocalEvaluation(student, keywords, tone, length, summary, reason) {
    var name = student ? student.name : '해당 학생';
    var teacher = student ? teacherNamesForStudent(student) : '미지정';
    var memo = student && student.memo ? ' 참고 메모로는 ' + student.memo + '이 있습니다.' : '';
    var progressText = summary && summary.text ? summary.text : '진도 정보가 아직 충분하지 않습니다.';
    var closing = length === '짧게' ? '' : '\n\n앞으로는 현재의 장점을 유지하면서 보완이 필요한 부분을 한 가지씩 짚어 주면 더 안정적인 성장이 기대됩니다.';
    var detail = length === '자세히' ? '\n\n담당 선생님은 ' + teacher + '이며, 진도 현황은 ' + progressText + '입니다. 이 흐름을 기준으로 다음 수업에서는 이해도 확인과 오답 정리를 함께 보면 좋겠습니다.' : '\n\n담당 선생님은 ' + teacher + '이며, 진도 현황은 ' + progressText + '입니다.';
    return localEvaluationPrefix(reason) + name + ' 학생은 ' + keywords + '의 모습이 관찰됩니다.' + memo + detail + closing;
  }

  function generateEvaluation() {
    ensureAiStudentId();
    var student = getStudent(ui.aiStudentId);
    var keywords = ui.aiKeywords.trim();
    if (!student) { alert('학생을 먼저 선택하세요.'); return Promise.resolve(false); }
    if (!keywords) { alert('평가에 반영할 키워드를 입력하세요.'); return Promise.resolve(false); }
    var summary = studentProgressSummary(student.id);
    var input = {
      studentName: student.name,
      studentMemo: student.memo || '',
      teacherName: teacherNamesForStudent(student),
      template: ui.aiTemplate,
      keywords: keywords,
      tone: ui.aiTone,
      length: ui.aiLength,
      progressSummary: summary.text,
      books: summary.books
    };
    ui.aiBusy = true;
    ui.aiDraft = 'AI가 평가 문장을 작성하는 중입니다...';
    setAiStatus('작성 중입니다.');
    renderAiEvaluation();
    if (!syncConfig.url) {
      ui.aiDraft = generateLocalEvaluation(student, keywords, ui.aiTone, ui.aiLength, summary, '데이터 탭에 Apps Script URL을 연결하면 실제 AI로 작성됩니다.');
      ui.aiBusy = false;
      setAiStatus('Apps Script URL이 없어 기본 초안을 만들었습니다.');
      renderAiEvaluation();
      return Promise.resolve(false);
    }
    return requestJson(syncEndpointUrl('evaluate'), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'evaluate', input: input })
    }).catch(function () {
      return evaluateViaJsonp(input);
    }).then(function (payload) {
      if (!payload || !payload.ok || !payload.text) throw new Error(payload && payload.error ? payload.error : 'AI 응답이 비어 있습니다.');
      ui.aiDraft = String(payload.text).trim();
      setAiStatus('AI 평가 작성 완료');
      return true;
    }).catch(function (error) {
      var reason = error && error.message ? error.message : String(error);
      ui.aiDraft = generateLocalEvaluation(student, keywords, ui.aiTone, ui.aiLength, summary, 'AI 호출에 실패해 기본 초안을 만들었습니다. 원인: ' + reason);
      setAiStatus('AI 호출 실패: ' + reason);
      return false;
    }).finally(function () {
      ui.aiBusy = false;
      renderAiEvaluation();
    });
  }

  function saveEvaluationDraft() {
    ensureAiStudentId();
    var student = getStudent(ui.aiStudentId);
    var content = ui.aiDraft.trim();
    if (!student) { alert('학생을 먼저 선택하세요.'); return; }
    if (!content) { alert('저장할 평가 문장이 없습니다.'); return; }
    state.evaluations = state.evaluations || [];
    state.evaluations.unshift({
      id: uid('eval'),
      studentId: student.id,
      studentName: student.name,
      teacherIds: studentTeacherIds(student),
      teacherId: firstTeacherIdForStudent(student),
      teacherName: teacherNamesForStudent(student),
      teacherNames: teacherNamesForStudent(student),
      keywords: ui.aiKeywords.trim(),
      tone: ui.aiTone,
      length: ui.aiLength,
      content: content,
      createdAt: new Date().toISOString()
    });
    saveState();
    setAiStatus('평가를 저장했습니다.');
    renderAiEvaluation();
  }

  function deleteEvaluation(evaluationId) {
    if (!confirm('저장된 평가를 삭제할까요?')) return;
    state.evaluations = (state.evaluations || []).filter(function (item) { return item.id !== evaluationId; });
    saveState();
    setAiStatus('평가를 삭제했습니다.');
    renderAiEvaluation();
  }

  function copyEvaluationDraft() {
    var content = ui.aiDraft.trim();
    if (!content) { alert('복사할 평가 문장이 없습니다.'); return; }
    function copied() { setAiStatus('평가 문장을 복사했습니다.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(content).then(copied).catch(function () {
        var output = document.querySelector('#aiDraftOutput');
        if (output) { output.focus(); output.select(); document.execCommand('copy'); copied(); }
      });
      return;
    }
    var output = document.querySelector('#aiDraftOutput');
    if (output) { output.focus(); output.select(); document.execCommand('copy'); copied(); }
  }

  function progressRows() {
    var rows = [];
    activeAssignments().forEach(function (assignment) {
      var student = getStudent(assignment.studentId);
      var book = getBook(assignment.bookId);
      if (!student || !book) return;
      for (var unit = 1; unit <= book.unitCount; unit += 1) {
        var record = getRecord(assignment.id, unit);
        rows.push(Object.assign({ assignment: assignment, student: student, book: book, unit: unit, unitName: unit + '단원' }, record));
      }
    });
    return rows;
  }

  function studentProgressUnitRows(studentId) {
    return progressRows().filter(function (row) { return row.student.id === studentId; }).sort(function (a, b) {
      return a.book.name.localeCompare(b.book.name) || a.unit - b.unit;
    });
  }

  function renderStudentProgressUnitRows(rows, doneList) {
    return rows.map(function (row) {
      return '<tr><td>' + escapeHtml(row.book.name) + '</td><td class="numeric">' + row.unit + '</td><td>' + escapeHtml(row.unitName) + '</td><td>' + escapeHtml(doneList ? (row.date || '체크일 없음') : '미완료') + '</td><td>' + escapeHtml(row.memo || '') + '</td></tr>';
    }).join('');
  }

  function downloadText(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  function progressCsv() {
    var header = ['선생님', '학생 이름', '책 이름', '단원번호', '단원명', '완료', '체크일', '메모'];
    var rows = progressRows().map(function (row) { return [teacherNamesForStudent(row.student), row.student.name, row.book.name, row.unit, row.unitName, row.done ? 'TRUE' : 'FALSE', row.date, row.memo]; });
    return [header].concat(rows).map(function (row) { return row.map(function (cell) { return '"' + String(cell == null ? '' : cell).replaceAll('"', '""') + '"'; }).join(','); }).join('\n');
  }

  function renderProgressBar(rate) { return '<div class="progress-bar" title="' + rate + '%"><span style="--value:' + rate + '%"></span></div>'; }
  function emptyState(title, body) { return '<div class="empty-state"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(body) + '</span></div>'; }


  function todayString() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function parseDateValue(value) {
    if (!value) return null;
    var date = new Date(String(value) + 'T00:00:00');
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function daysBetween(fromDate, toDate) {
    var from = parseDateValue(fromDate);
    var to = parseDateValue(toDate || todayString());
    if (!from || !to) return null;
    return Math.floor((to.getTime() - from.getTime()) / 86400000);
  }

  function homeworkStatusLabel(status) {
    return ({ todo: '예정', partial: '일부 완료', done: '완료', missing: '미제출' })[status] || '예정';
  }

  function homeworkStatusClass(status) {
    return ({ todo: 'todo', partial: 'partial', done: 'done', missing: 'missing' })[status] || 'todo';
  }

  function homeworkStatusOptions(selected) {
    return ['todo','partial','done','missing'].map(function (status) {
      return '<option value="' + status + '" ' + (selected === status ? 'selected' : '') + '>' + homeworkStatusLabel(status) + '</option>';
    }).join('');
  }

  function studentAssignments(studentId) {
    return activeAssignments().filter(function (assignment) { return assignment.studentId === studentId; });
  }

  function latestProgressDate(studentId) {
    var latest = '';
    studentAssignments(studentId).forEach(function (assignment) {
      var book = getBook(assignment.bookId);
      if (!book) return;
      for (var unit = 1; unit <= book.unitCount; unit += 1) {
        var record = getRecord(assignment.id, unit);
        if (record.done && record.date && (!latest || record.date > latest)) latest = record.date;
      }
    });
    return latest;
  }

  function homeworkForStudent(studentId) {
    return (state.homework || []).filter(function (item) { return item.studentId === studentId; });
  }

  function consultationsForStudent(studentId) {
    return (state.consultations || []).filter(function (item) { return item.studentId === studentId; });
  }

  function evaluationsForStudent(studentId) {
    return (state.evaluations || []).filter(function (item) { return item.studentId === studentId; });
  }

  function studentAlertItems(student) {
    var alerts = [];
    var assignments = studentAssignments(student.id);
    var latest = latestProgressDate(student.id);
    if (assignments.length && !latest) alerts.push({ level: 'critical', student: student, title: '진도 체크 기록 없음', body: '배정된 책은 있지만 완료 체크 기록이 없습니다.' });
    if (latest) {
      var gap = daysBetween(latest, todayString());
      if (gap != null && gap >= 14) alerts.push({ level: 'critical', student: student, title: '진도 체크 지연', body: '마지막 진도 체크 후 ' + gap + '일이 지났습니다.' });
      else if (gap != null && gap >= 7) alerts.push({ level: 'warning', student: student, title: '진도 확인 필요', body: '마지막 진도 체크 후 ' + gap + '일이 지났습니다.' });
    }
    assignments.forEach(function (assignment) {
      var book = getBook(assignment.bookId);
      var totals = assignmentTotals(assignment);
      if (book && totals.total >= 5 && totals.rate < 30) alerts.push({ level: 'warning', student: student, title: '진도율 낮음', body: book.name + ' 진도율이 ' + totals.rate + '%입니다.' });
    });
    homeworkForStudent(student.id).forEach(function (item) {
      if (item.status !== 'done' && item.dueDate && item.dueDate < todayString()) alerts.push({ level: 'critical', student: student, title: '숙제 기한 지남', body: (item.title || '숙제') + ' 기한이 ' + item.dueDate + '입니다.' });
    });
    var missingCount = homeworkForStudent(student.id).filter(function (item) { return item.status === 'missing'; }).length;
    if (missingCount >= 2) alerts.push({ level: 'warning', student: student, title: '미제출 누적', body: '미제출 숙제가 ' + missingCount + '건 있습니다.' });
    return alerts;
  }

  function allAlerts(teacherId) {
    var items = [];
    studentsByTeacher(teacherId || 'all').forEach(function (student) { items = items.concat(studentAlertItems(student)); });
    return items.sort(function (a, b) { return (a.level === 'critical' ? 0 : 1) - (b.level === 'critical' ? 0 : 1); });
  }

  function ensureDetailStudentId() {
    if (ui.detailStudentId && getStudent(ui.detailStudentId) && teacherMatches(getStudent(ui.detailStudentId), ui.detailTeacherId)) return ui.detailStudentId;
    ui.detailStudentId = firstStudentIdForTeacher(ui.detailTeacherId);
    return ui.detailStudentId;
  }

  function filteredHomework() {
    return (state.homework || []).filter(function (item) {
      var student = getStudent(item.studentId);
      if (!student) return false;
      if (!teacherMatches(student, ui.homeworkTeacherId)) return false;
      if (ui.homeworkStudentId !== 'all' && item.studentId !== ui.homeworkStudentId) return false;
      if (ui.homeworkStatus !== 'all' && item.status !== ui.homeworkStatus) return false;
      return true;
    }).sort(function (a, b) { return String(a.dueDate || '').localeCompare(String(b.dueDate || '')); });
  }

  function filteredConsultationSchedule() {
    return (state.consultationSchedule || []).filter(function (item) {
      var student = getStudent(item.studentId);
      if (!student) return false;
      if (!teacherMatches(student, ui.consultTeacherId)) return false;
      return true;
    }).sort(function (a, b) {
      return (String(a.date || '') + String(a.time || '')).localeCompare(String(b.date || '') + String(b.time || ''));
    });
  }

  function updateConsultationSetting(studentId, field, value, checked) {
    var setting = consultationSetting(studentId);
    if (field === 'enabled') setting.enabled = checked;
    else if (field === 'weekday') {
      var day = Number(value);
      var days = normalizeWeekdays(setting.weekdays);
      if (checked && days.indexOf(day) === -1) days.push(day);
      if (!checked) days = days.filter(function (item) { return item !== day; });
      setting.weekdays = normalizeWeekdays(days).sort();
    } else if (field === 'cycle') setting.cycle = value;
    else if (field === 'teacherId') setting.teacherId = value;
    else if (field === 'priority') setting.priority = value;
    else setting[field] = String(value || '').trim();
    state.consultationSettings[studentId] = setting;
    saveState();
    render();
  }

  function existingConsultationSlotMap() {
    var map = {};
    (state.consultationSchedule || []).forEach(function (item) {
      if (item.status !== 'canceled' && item.date && item.time) map[item.date + ' ' + item.time] = true;
    });
    return map;
  }

  function buildConsultationDraft() {
    var startDate = ui.consultStartDate || todayString();
    var weeks = Math.max(1, Math.min(12, Number(ui.consultWeeks || 4)));
    var endDate = addDays(startDate, weeks * 7 - 1);
    var maxPerDay = Math.max(1, Math.min(20, Number(ui.consultMaxPerDay || 6)));
    var interval = Math.max(5, Math.min(120, Number(ui.consultInterval || 20)));
    var startMinutes = timeToMinutes(ui.consultStartTime || '14:00');
    var slotMap = existingConsultationSlotMap();
    var dailyCounts = {};
    var draft = [];
    var conflicts = [];
    var candidates = studentsByTeacher(ui.consultTeacherId).filter(function (student) {
      var setting = consultationSetting(student.id);
      if (!setting.enabled || setting.cycle === 'as-needed') return false;
      var due = nextDueDate(student.id);
      return due && compareDates(due, endDate) <= 0;
    }).sort(function (a, b) {
      var sa = consultationSetting(a.id);
      var sb = consultationSetting(b.id);
      if (sa.priority !== sb.priority) return sa.priority === 'high' ? -1 : 1;
      return compareDates(nextDueDate(a.id), nextDueDate(b.id)) || a.name.localeCompare(b.name);
    });

    candidates.forEach(function (student) {
      var setting = consultationSetting(student.id);
      var due = nextDueDate(student.id);
      var date = compareDates(due, startDate) > 0 ? due : startDate;
      var placed = null;
      while (compareDates(date, endDate) <= 0 && !placed) {
        var day = parseDateValue(date).getDay();
        if (setting.weekdays.indexOf(day) !== -1) {
          dailyCounts[date] = dailyCounts[date] || 0;
          for (var slot = 0; slot < maxPerDay; slot += 1) {
            var time = minutesToTime(startMinutes + slot * interval);
            var key = date + ' ' + time;
            if (!slotMap[key]) {
              slotMap[key] = true;
              dailyCounts[date] += 1;
              placed = {
                id: uid('consult-draft'),
                studentId: student.id,
                studentName: student.name,
                teacherId: setting.teacherId || firstTeacherIdForStudent(student),
                teacherName: teacherName(setting.teacherId || firstTeacherIdForStudent(student)),
                date: date,
                time: time,
                duration: interval,
                cycle: setting.cycle,
                priority: setting.priority,
                dueDate: due,
                memo: setting.memo || ''
              };
              break;
            }
          }
        }
        date = addDays(date, 1);
      }
      if (placed) draft.push(placed);
      else conflicts.push({ studentId: student.id, studentName: student.name, dueDate: due, weekdays: weekdayLabels(setting.weekdays), reason: '가능한 요일에 빈 자리가 없습니다.' });
    });

    ui.consultDraft = draft;
    ui.consultConflicts = conflicts;
  }

  function saveConsultationDraft() {
    if (!ui.consultDraft.length) { alert('저장할 상담 일정이 없습니다.'); return; }
    state.consultationSchedule = state.consultationSchedule || [];
    ui.consultDraft.forEach(function (item) {
      state.consultationSchedule.push({
        id: uid('consult'),
        studentId: item.studentId,
        teacherId: item.teacherId || '',
        teacherIds: item.teacherId ? [item.teacherId] : [],
        date: item.date,
        time: item.time,
        duration: item.duration,
        status: 'scheduled',
        memo: item.memo || '',
        createdAt: new Date().toISOString()
      });
    });
    ui.consultDraft = [];
    ui.consultConflicts = [];
    saveState();
    render();
  }

  function deleteConsultationSchedule(scheduleId) {
    if (!confirm('상담 일정을 삭제할까요?')) return;
    state.consultationSchedule = (state.consultationSchedule || []).filter(function (item) { return item.id !== scheduleId; });
    saveState();
    render();
  }

  function aiTemplateOptions(selected) {
    return ['균형 평가','칭찬 중심','보완점 중심','월말 리포트','학부모 문자','상담 기록'].map(function (template) {
      return '<option value="' + template + '" ' + (selected === template ? 'selected' : '') + '>' + template + '</option>';
    }).join('');
  }

  function aiTemplateHint(template) {
    return ({
      '균형 평가': '장점과 보완점을 균형 있게 정리합니다.',
      '칭찬 중심': '잘한 점과 성장 흐름을 부드럽게 강조합니다.',
      '보완점 중심': '개선이 필요한 부분과 다음 과제를 구체적으로 씁니다.',
      '월말 리포트': '한 달의 흐름을 학부모 안내문처럼 정리합니다.',
      '학부모 문자': '짧고 자연스러운 메시지 형태로 작성합니다.',
      '상담 기록': '교사용 상담 메모처럼 객관적으로 정리합니다.'
    })[template] || '';
  }

  function renderAlerts() {
    var alerts = allAlerts(ui.alertsTeacherId);
    var rows = alerts.map(function (item) {
      return '<article class="alert-item ' + (item.level === 'critical' ? 'critical' : '') + '"><div><strong>' + escapeHtml(item.title) + '</strong></div><div>' + escapeHtml(item.body) + '</div><div class="alert-meta">' + escapeHtml(teacherNamesForStudent(item.student)) + ' · ' + escapeHtml(item.student.name) + '</div><div class="row-actions"><button class="secondary-button" data-action="open-detail-student" data-student-id="' + item.student.id + '">상세</button></div></article>';
    }).join('');
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>알림</h2><p>' + alerts.length + '건</p></div><div class="toolbar"><select class="select" id="alertsTeacherFilter">' + teacherOptions(ui.alertsTeacherId, true, true) + '</select></div></div><section class="panel"><div class="panel-body alert-list">' + (rows || emptyState('확인할 알림이 없습니다', '진도와 숙제 흐름이 안정적입니다.')) + '</div></section></div>';
  }

  function renderHomework() {
    var rows = filteredHomework().map(function (item) {
      var student = getStudent(item.studentId);
      return '<tr data-homework-id="' + item.id + '"><td>' + escapeHtml(teacherNamesForStudent(student)) + '</td><td>' + escapeHtml(student.name) + '</td><td><input class="field" data-action="update-homework" data-field="title" value="' + escapeHtml(item.title || '') + '"></td><td><input class="field" type="date" data-action="update-homework" data-field="dueDate" value="' + escapeHtml(item.dueDate || '') + '"></td><td><select class="select" data-action="update-homework" data-field="status">' + homeworkStatusOptions(item.status) + '</select></td><td><input class="field" data-action="update-homework" data-field="memo" value="' + escapeHtml(item.memo || '') + '"></td><td><div class="row-actions"><button class="mini-button danger" data-action="delete-homework" title="삭제" aria-label="삭제">×</button></div></td></tr>';
    }).join('');
    var advanced = ui.showHomeworkFilters ? '<div class="filters advanced-filters"><select class="select" id="homeworkStudentFilter">' + studentOptions(ui.homeworkStudentId, true, ui.homeworkTeacherId) + '</select><select class="select" id="homeworkStatusFilter"><option value="all" ' + (ui.homeworkStatus === 'all' ? 'selected' : '') + '>전체 상태</option><option value="todo" ' + (ui.homeworkStatus === 'todo' ? 'selected' : '') + '>예정</option><option value="partial" ' + (ui.homeworkStatus === 'partial' ? 'selected' : '') + '>일부 완료</option><option value="done" ' + (ui.homeworkStatus === 'done' ? 'selected' : '') + '>완료</option><option value="missing" ' + (ui.homeworkStatus === 'missing' ? 'selected' : '') + '>미제출</option></select></div>' : '';
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>숙제</h2><p>' + filteredHomework().length + '건</p></div></div><section class="panel"><div class="panel-body"><div class="filter-row"><select class="select" id="homeworkTeacherFilter">' + teacherOptions(ui.homeworkTeacherId, true, true) + '</select><button class="secondary-button" id="toggleHomeworkFilters">필터</button></div>' + advanced + '</div></section><section class="panel"><div class="panel-body"><form class="form-grid students" id="homeworkForm"><select class="select" name="studentId" required>' + studentOptions('', false, ui.homeworkTeacherId) + '</select><input class="field" name="title" placeholder="숙제 내용" required><input class="field" name="dueDate" type="date" value="' + todayString() + '"><select class="select" name="status">' + homeworkStatusOptions('todo') + '</select><input class="field" name="memo" placeholder="메모"><button class="primary-button" type="submit">추가</button></form></div><div class="table-wrap"><table><thead><tr><th>선생님</th><th>학생</th><th>숙제</th><th>기한</th><th>상태</th><th>메모</th><th class="numeric">관리</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7">' + emptyState('숙제가 없습니다', '학생별 숙제를 추가하세요.') + '</td></tr>') + '</tbody></table></div></section></div>';
  }

  function renderConsultSchedule() {
    if (!ui.consultStartDate) ui.consultStartDate = todayString();
    var visibleStudents = studentsByTeacher(ui.consultTeacherId);
    var dueStudents = visibleStudents.filter(function (student) {
      var due = nextDueDate(student.id);
      return due && compareDates(due, addDays(ui.consultStartDate, Number(ui.consultWeeks || 4) * 7 - 1)) <= 0;
    });
    var settingRows = visibleStudents.map(function (student) {
      var setting = consultationSetting(student.id);
      var weekdays = CONSULT_WEEKDAYS.map(function (day) {
        var checked = setting.weekdays.indexOf(day.value) !== -1;
        return '<label class="weekday-check"><input type="checkbox" data-action="update-consult-setting" data-field="weekday" data-student-id="' + student.id + '" value="' + day.value + '" ' + (checked ? 'checked' : '') + '><span>' + day.label + '</span></label>';
      }).join('');
      return '<tr data-student-id="' + student.id + '"><td>' + escapeHtml(student.name) + '</td><td>' + escapeHtml(teacherNamesForStudent(student)) + '</td><td><label class="sync-toggle"><input type="checkbox" data-action="update-consult-setting" data-field="enabled" data-student-id="' + student.id + '" ' + (setting.enabled ? 'checked' : '') + '> 사용</label></td><td><select class="select" data-action="update-consult-setting" data-field="cycle" data-student-id="' + student.id + '">' + consultationCycleOptions(setting.cycle) + '</select></td><td><div class="weekday-check-list">' + weekdays + '</div></td><td><select class="select" data-action="update-consult-setting" data-field="teacherId" data-student-id="' + student.id + '">' + consultationTeacherOptions(setting.teacherId, student) + '</select></td><td><select class="select" data-action="update-consult-setting" data-field="priority" data-student-id="' + student.id + '"><option value="normal" ' + (setting.priority === 'normal' ? 'selected' : '') + '>보통</option><option value="high" ' + (setting.priority === 'high' ? 'selected' : '') + '>높음</option></select></td><td><input class="field" data-action="update-consult-setting" data-field="preferredTime" data-student-id="' + student.id + '" placeholder="예: 16시 이후" value="' + escapeHtml(setting.preferredTime || '') + '"></td><td><input class="field" data-action="update-consult-setting" data-field="memo" data-student-id="' + student.id + '" placeholder="메모" value="' + escapeHtml(setting.memo || '') + '"></td><td>' + escapeHtml(nextDueDate(student.id) || '-') + '</td></tr>';
    }).join('');
    var draftRows = ui.consultDraft.map(function (item) {
      return '<tr><td>' + escapeHtml(item.date) + '</td><td>' + escapeHtml(item.time) + '</td><td>' + escapeHtml(item.teacherName || '') + '</td><td>' + escapeHtml(item.studentName) + '</td><td>' + escapeHtml(consultationCycleLabel(item.cycle)) + '</td><td>' + escapeHtml(consultationPriorityLabel(item.priority)) + '</td><td>' + escapeHtml(item.dueDate || '') + '</td><td>' + escapeHtml(item.memo || '') + '</td></tr>';
    }).join('');
    var conflictRows = ui.consultConflicts.map(function (item) {
      return '<tr><td>' + escapeHtml(item.studentName) + '</td><td>' + escapeHtml(item.dueDate || '') + '</td><td>' + escapeHtml(item.weekdays || '') + '</td><td>' + escapeHtml(item.reason || '') + '</td></tr>';
    }).join('');
    var scheduleRows = filteredConsultationSchedule().map(function (item) {
      var student = getStudent(item.studentId);
      return '<tr data-consult-id="' + item.id + '"><td><input class="field" type="date" data-action="update-consult-schedule" data-field="date" value="' + escapeHtml(item.date || '') + '"></td><td><input class="field" type="time" data-action="update-consult-schedule" data-field="time" value="' + escapeHtml(item.time || '') + '"></td><td>' + escapeHtml(student ? teacherNamesForStudent(student) : teacherNamesForIds(item.teacherIds || item.teacherId || '')) + '</td><td>' + escapeHtml(student ? student.name : '') + '</td><td><select class="select" data-action="update-consult-schedule" data-field="status">' + consultationStatusOptions(item.status) + '</select></td><td><input class="field" data-action="update-consult-schedule" data-field="memo" value="' + escapeHtml(item.memo || '') + '"></td><td><div class="row-actions"><button class="mini-button danger" data-action="delete-consult-schedule" title="삭제" aria-label="삭제">×</button></div></td></tr>';
    }).join('');
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>상담 일정</h2><p>예정 필요 학생 ' + dueStudents.length + '명 · 확정 일정 ' + (state.consultationSchedule || []).length + '건</p></div><div class="toolbar"><select class="select" id="consultTeacherFilter">' + teacherOptions(ui.consultTeacherId, true, true) + '</select></div></div><section class="panel"><div class="panel-head"><h3>자동 상담표 만들기</h3></div><div class="panel-body consult-generator"><label class="stacked-field"><span>시작일</span><input class="field" type="date" id="consultStartDate" value="' + escapeHtml(ui.consultStartDate) + '"></label><label class="stacked-field"><span>기간</span><select class="select" id="consultWeeks"><option value="2" ' + (Number(ui.consultWeeks) === 2 ? 'selected' : '') + '>2주</option><option value="4" ' + (Number(ui.consultWeeks) === 4 ? 'selected' : '') + '>4주</option><option value="8" ' + (Number(ui.consultWeeks) === 8 ? 'selected' : '') + '>8주</option></select></label><label class="stacked-field"><span>첫 시간</span><input class="field" type="time" id="consultStartTime" value="' + escapeHtml(ui.consultStartTime) + '"></label><label class="stacked-field"><span>간격</span><input class="field" type="number" min="5" max="120" step="5" id="consultInterval" value="' + escapeHtml(ui.consultInterval) + '"></label><label class="stacked-field"><span>하루 최대</span><input class="field" type="number" min="1" max="20" id="consultMaxPerDay" value="' + escapeHtml(ui.consultMaxPerDay) + '"></label><div class="data-actions"><button class="primary-button" id="buildConsultSchedule">자동 생성</button><button class="secondary-button" id="saveConsultDraft">일정 저장</button><button class="secondary-button" id="clearConsultDraft">미리보기 비우기</button></div></div></section><section class="panel"><div class="panel-head"><h3>생성 결과 미리보기</h3></div><div class="table-wrap"><table><thead><tr><th>날짜</th><th>시간</th><th>선생님</th><th>학생</th><th>주기</th><th>우선순위</th><th>기준일</th><th>메모</th></tr></thead><tbody>' + (draftRows || '<tr><td colspan="8">' + emptyState('아직 생성된 상담표가 없습니다', '자동 생성을 누르면 저장 전 미리보기가 표시됩니다.') + '</td></tr>') + '</tbody></table></div></section>' + (conflictRows ? '<section class="panel"><div class="panel-head"><h3>배정 실패</h3></div><div class="table-wrap"><table><thead><tr><th>학생</th><th>상담 기준일</th><th>가능 요일</th><th>이유</th></tr></thead><tbody>' + conflictRows + '</tbody></table></div></section>' : '') + '<section class="panel"><div class="panel-head"><h3>확정된 상담 일정</h3></div><div class="table-wrap"><table><thead><tr><th>날짜</th><th>시간</th><th>선생님</th><th>학생</th><th>상태</th><th>메모</th><th class="numeric">관리</th></tr></thead><tbody>' + (scheduleRows || '<tr><td colspan="7">' + emptyState('확정된 상담 일정이 없습니다', '상담표를 자동 생성한 뒤 일정 저장을 누르세요.') + '</td></tr>') + '</tbody></table></div></section><section class="panel"><div class="panel-head"><h3>학생별 상담 설정</h3></div><div class="table-wrap"><table class="consult-settings-table"><thead><tr><th>학생</th><th>담당</th><th>사용</th><th>주기</th><th>가능 요일</th><th>상담 선생님</th><th>우선순위</th><th>가능 시간</th><th>메모</th><th>다음 기준일</th></tr></thead><tbody>' + (settingRows || '<tr><td colspan="10">' + emptyState('학생이 없습니다', '학생을 먼저 추가하세요.') + '</td></tr>') + '</tbody></table></div></section></div>';
  }

  function renderStudentDetail() {
    ensureDetailStudentId();
    var student = getStudent(ui.detailStudentId);
    var summary = student ? studentTotals(student.id) : { books: 0, total: 0, done: 0 };
    var rate = percent(summary.done, summary.total);
    var bookRows = student ? studentAssignments(student.id).map(function (assignment) {
      var book = getBook(assignment.bookId); var totals = assignmentTotals(assignment);
      return '<tr><td>' + escapeHtml(book ? book.name : '') + '</td><td class="numeric">' + totals.done + '/' + totals.total + '</td><td>' + renderProgressBar(totals.rate) + '</td><td class="numeric">' + totals.rate + '%</td></tr>';
    }).join('') : '';
    var unitRows = student ? studentProgressUnitRows(student.id) : [];
    var doneUnitRows = unitRows.filter(function (row) { return row.done; });
    var todoUnitRows = unitRows.filter(function (row) { return !row.done; });
    var doneUnitTableRows = renderStudentProgressUnitRows(doneUnitRows, true);
    var todoUnitTableRows = renderStudentProgressUnitRows(todoUnitRows, false);
    var progressUnitPanels = student ? '<div class="two-column progress-list-grid"><section class="panel"><div class="panel-head"><h3>완료 단원</h3><span class="muted">' + doneUnitRows.length + '개</span></div><div class="table-wrap"><table class="progress-unit-table"><thead><tr><th>책</th><th class="numeric">단원</th><th>단원명</th><th>체크일</th><th>메모</th></tr></thead><tbody>' + (doneUnitTableRows || '<tr><td colspan="5">' + emptyState('완료한 단원이 없습니다', '진도 체크에서 완료한 단원이 여기에 표시됩니다.') + '</td></tr>') + '</tbody></table></div></section><section class="panel"><div class="panel-head"><h3>비완료 단원</h3><span class="muted">' + todoUnitRows.length + '개</span></div><div class="table-wrap"><table class="progress-unit-table"><thead><tr><th>책</th><th class="numeric">단원</th><th>단원명</th><th>상태</th><th>메모</th></tr></thead><tbody>' + (todoUnitTableRows || '<tr><td colspan="5">' + emptyState('남은 단원이 없습니다', '배정된 책의 단원을 모두 완료했습니다.') + '</td></tr>') + '</tbody></table></div></section></div>' : '';
    var homeworkRows = student ? homeworkForStudent(student.id).slice().sort(function (a, b) { return String(a.dueDate || '').localeCompare(String(b.dueDate || '')); }).map(function (item) {
      return '<tr><td>' + escapeHtml(item.title || '') + '</td><td>' + escapeHtml(item.dueDate || '') + '</td><td><span class="status-dot ' + homeworkStatusClass(item.status) + '">' + homeworkStatusLabel(item.status) + '</span></td><td>' + escapeHtml(item.memo || '') + '</td></tr>';
    }).join('') : '';
    var history = [];
    if (student) {
      consultationsForStudent(student.id).forEach(function (item) { history.push({ date: item.date || '', label: item.type || '상담 메모', body: item.content || '', id: item.id, kind: 'consultation' }); });
      evaluationsForStudent(student.id).forEach(function (item) { history.push({ date: (item.createdAt || '').slice(0, 10), label: 'AI 평가 · ' + (item.tone || ''), body: item.content || '', id: item.id, kind: 'evaluation' }); });
    }
    history.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    var historyRows = history.map(function (item) {
      var deleteButton = item.kind === 'consultation' ? '<button class="mini-button danger" data-action="delete-consultation" data-consultation-id="' + item.id + '" title="삭제" aria-label="삭제">×</button>' : '';
      return '<article class="timeline-item"><div class="evaluation-meta">' + escapeHtml(item.date || '') + ' · ' + escapeHtml(item.label) + '</div><p class="evaluation-content">' + escapeHtml(item.body).replaceAll('\n', '<br>') + '</p><div class="row-actions">' + deleteButton + '</div></article>';
    }).join('');
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>학생 상세</h2><p>' + (student ? escapeHtml(student.name) : '학생 없음') + '</p></div><div class="toolbar"><select class="select" id="detailTeacherFilter">' + teacherOptions(ui.detailTeacherId, true, true) + '</select><select class="select" id="detailStudentSelect">' + studentOptions(ui.detailStudentId, false, ui.detailTeacherId) + '</select></div></div>' + (student ? '<div class="detail-grid"><section class="panel"><div class="panel-head"><h3>기본 정보</h3></div><div class="table-wrap"><table><tbody><tr><th>학생</th><td>' + escapeHtml(student.name) + '</td></tr><tr><th>선생님</th><td>' + escapeHtml(teacherNamesForStudent(student)) + '</td></tr><tr><th>메모</th><td>' + escapeHtml(student.memo || '') + '</td></tr><tr><th>진도</th><td>' + summary.done + '/' + summary.total + ' · ' + rate + '%</td></tr></tbody></table></div></section><section class="panel"><div class="panel-head"><h3>책별 진도</h3></div><div class="table-wrap"><table><thead><tr><th>책</th><th class="numeric">완료/전체</th><th>진도</th><th class="numeric">%</th></tr></thead><tbody>' + (bookRows || '<tr><td colspan="4">' + emptyState('배정된 책이 없습니다', '책 배정 화면에서 사용하는 책을 체크하세요.') + '</td></tr>') + '</tbody></table></div></section></div>' + progressUnitPanels + '<section class="panel"><div class="panel-head"><h3>숙제</h3></div><div class="table-wrap"><table><thead><tr><th>숙제</th><th>기한</th><th>상태</th><th>메모</th></tr></thead><tbody>' + (homeworkRows || '<tr><td colspan="4">' + emptyState('숙제가 없습니다', '숙제 탭에서 추가하세요.') + '</td></tr>') + '</tbody></table></div></section><section class="panel"><div class="panel-head"><h3>상담/평가 이력</h3></div><div class="panel-body"><form class="form-grid students" id="consultationForm"><input type="hidden" name="studentId" value="' + student.id + '"><input class="field" type="date" name="date" value="' + todayString() + '"><select class="select" name="type"><option>상담 메모</option><option>학부모 연락</option><option>학습 관찰</option><option>수업 특이사항</option></select><input class="field" name="content" placeholder="상담 또는 관찰 내용을 입력" required><button class="primary-button" type="submit">추가</button></form></div><div class="panel-body timeline-list">' + (historyRows || emptyState('이력이 없습니다', '상담 메모를 추가하거나 AI 평가를 저장하세요.')) + '</div></section>' : emptyState('학생이 없습니다', '학생을 먼저 추가하세요.')) + '</div>';
  }

  function renderDashboard() {
    var visibleStudents = studentsByTeacher(ui.dashboardTeacherId);
    var totals = overallTotals(ui.dashboardTeacherId);
    var rate = percent(totals.done, totals.total);
    var studentRows = visibleStudents.map(function (student) {
      var item = studentTotals(student.id); var rateValue = percent(item.done, item.total);
      return '<tr><td>' + escapeHtml(teacherNamesForStudent(student)) + '</td><td>' + escapeHtml(student.name) + '</td><td class="numeric">' + item.books + '</td><td class="numeric">' + item.total + '</td><td class="numeric">' + item.done + '</td><td class="numeric">' + (item.total - item.done) + '</td><td>' + renderProgressBar(rateValue) + '</td><td class="numeric">' + rateValue + '%</td></tr>';
    }).join('');
    var bookRows = state.books.filter(function (book) { return book.unitCount > 0; }).map(function (book) {
      var item = bookTotals(book.id, ui.dashboardTeacherId); var rateValue = percent(item.done, item.total);
      return '<tr><td>' + escapeHtml(book.name) + '</td><td class="numeric">' + item.students + '</td><td class="numeric">' + item.total + '</td><td class="numeric">' + item.done + '</td><td class="numeric">' + (item.total - item.done) + '</td><td>' + renderProgressBar(rateValue) + '</td><td class="numeric">' + rateValue + '%</td></tr>';
    }).join('');
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>요약</h2><p>' + (ui.dashboardTeacherId === 'all' ? '전체 선생님' : teacherName(ui.dashboardTeacherId)) + ' 기준</p></div><div class="toolbar"><select class="select" id="dashboardTeacherFilter">' + teacherOptions(ui.dashboardTeacherId, true, true) + '</select></div></div><div class="summary-grid"><div class="summary-card teal"><div class="label">학생 수</div><div class="value">' + visibleStudents.length + '</div></div><div class="summary-card blue"><div class="label">선생님 수</div><div class="value">' + state.teachers.length + '</div></div><div class="summary-card orange"><div class="label">학생별 책 배정</div><div class="value">' + totals.assignments + '</div></div><div class="summary-card slate"><div class="label">진도율</div><div class="value">' + rate + '%</div></div></div><div class="two-column"><section class="panel"><div class="panel-head"><h2>학생별 진도</h2></div><div class="table-wrap"><table><thead><tr><th>선생님</th><th>학생</th><th class="numeric">책</th><th class="numeric">전체</th><th class="numeric">완료</th><th class="numeric">남음</th><th>진도</th><th class="numeric">%</th></tr></thead><tbody>' + (studentRows || '<tr><td colspan="8">' + emptyState('표시할 학생이 없습니다', '학생 화면에서 담당 선생님을 지정하세요.') + '</td></tr>') + '</tbody></table></div></section><section class="panel"><div class="panel-head"><h2>책별 진도</h2></div><div class="table-wrap"><table><thead><tr><th>책</th><th class="numeric">학생</th><th class="numeric">전체</th><th class="numeric">완료</th><th class="numeric">남음</th><th>진도</th><th class="numeric">%</th></tr></thead><tbody>' + (bookRows || '<tr><td colspan="7">' + emptyState('책이 없습니다', '책 화면에서 추가하세요.') + '</td></tr>') + '</tbody></table></div></section></div></div>';
  }

  function renderStudents() {
    var filteredStudents = studentsByTeacher(ui.studentTeacherId);
    var rows = filteredStudents.map(function (student) {
      var selectedTeacherIds = studentTeacherIds(student);
      var teacherChecks = state.teachers.length ? state.teachers.map(function (teacher) {
        var checked = selectedTeacherIds.indexOf(teacher.id) !== -1;
        return '<label class="teacher-check"><input type="checkbox" data-action="toggle-student-teacher" data-student-id="' + student.id + '" data-teacher-id="' + teacher.id + '" ' + (checked ? 'checked' : '') + '><span>' + escapeHtml(teacher.name) + '</span></label>';
      }).join('') : '<span class="muted">선생님을 먼저 추가하세요</span>';
      return '<tr data-student-id="' + student.id + '"><td><input class="field" data-action="update-student" data-field="name" value="' + escapeHtml(student.name) + '"></td><td><div class="teacher-check-list">' + teacherChecks + '</div></td><td><input class="field" data-action="update-student" data-field="memo" value="' + escapeHtml(student.memo) + '"></td><td><div class="row-actions"><button class="mini-button" data-action="open-detail-student" data-student-id="' + student.id + '" title="상세" aria-label="상세">&gt;</button><button class="mini-button danger" data-action="delete-student" title="삭제" aria-label="삭제">×</button></div></td></tr>';
    }).join('');
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>학생</h2><p>' + filteredStudents.length + '/' + state.students.length + '명</p></div><div class="toolbar"><select class="select" id="studentTeacherFilter">' + teacherOptions(ui.studentTeacherId, true, true) + '</select></div></div><section class="panel"><div class="panel-body"><form class="form-grid student-form" id="studentForm"><input class="field" name="name" placeholder="학생 이름" required><select class="select" name="teacherId"><option value="">담당 미지정</option>' + state.teachers.map(function (teacher) { return '<option value="' + teacher.id + '">' + escapeHtml(teacher.name) + '</option>'; }).join('') + '</select><input class="field" name="memo" placeholder="메모"><button class="primary-button" type="submit">추가</button></form></div><div class="table-wrap"><table><thead><tr><th>학생 이름</th><th>선생님</th><th>메모</th><th class="numeric">관리</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4">' + emptyState('표시할 학생이 없습니다', '필터를 바꾸거나 학생을 추가하세요.') + '</td></tr>') + '</tbody></table></div></section></div>';
  }

  function renderTeachers() {
    var rows = state.teachers.map(function (teacher) {
      var studentCount = studentsByTeacher(teacher.id).length;
      var totals = overallTotals(teacher.id);
      var rate = percent(totals.done, totals.total);
      return '<tr data-teacher-id="' + teacher.id + '"><td><input class="field" data-action="update-teacher" data-field="name" value="' + escapeHtml(teacher.name) + '"></td><td><input class="field" data-action="update-teacher" data-field="memo" value="' + escapeHtml(teacher.memo || '') + '"></td><td class="numeric">' + studentCount + '</td><td class="numeric">' + totals.assignments + '</td><td class="numeric">' + totals.done + '/' + totals.total + '</td><td>' + renderProgressBar(rate) + '</td><td class="numeric">' + rate + '%</td><td><div class="row-actions"><button class="mini-button danger" data-action="delete-teacher" title="삭제" aria-label="삭제">×</button></div></td></tr>';
    }).join('');
    var unassignedTotals = overallTotals('unassigned');
    var unassignedRate = percent(unassignedTotals.done, unassignedTotals.total);
    var unassignedRow = '<tr><td>담당 미지정</td><td class="muted">아직 선생님이 지정되지 않은 학생</td><td class="numeric">' + studentsByTeacher('unassigned').length + '</td><td class="numeric">' + unassignedTotals.assignments + '</td><td class="numeric">' + unassignedTotals.done + '/' + unassignedTotals.total + '</td><td>' + renderProgressBar(unassignedRate) + '</td><td class="numeric">' + unassignedRate + '%</td><td></td></tr>';
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>선생님</h2><p>' + state.teachers.length + '명 · 미지정 학생 ' + studentsByTeacher('unassigned').length + '명</p></div></div><section class="panel"><div class="panel-body"><form class="form-grid teachers" id="teacherForm"><input class="field" name="name" placeholder="선생님 이름" required><input class="field" name="memo" placeholder="메모"><button class="primary-button" type="submit">추가</button></form></div><div class="table-wrap"><table><thead><tr><th>선생님 이름</th><th>메모</th><th class="numeric">학생</th><th class="numeric">배정</th><th class="numeric">완료/전체</th><th>진도</th><th class="numeric">%</th><th class="numeric">관리</th></tr></thead><tbody>' + (rows + unassignedRow) + '</tbody></table></div></section></div>';
  }

  function renderBooks() {
    var rows = state.books.map(function (book) {
      return '<tr data-book-id="' + book.id + '"><td><input class="field" data-action="update-book" data-field="name" value="' + escapeHtml(book.name) + '"></td><td><input class="field" type="number" min="0" max="80" data-action="update-book" data-field="unitCount" value="' + book.unitCount + '"></td><td><input class="field" data-action="update-book" data-field="memo" value="' + escapeHtml(book.memo) + '"></td><td><div class="row-actions"><button class="mini-button danger" data-action="delete-book" title="삭제" aria-label="삭제">×</button></div></td></tr>';
    }).join('');
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>책</h2><p>' + state.books.length + '권</p></div></div><section class="panel"><div class="panel-body"><form class="form-grid books" id="bookForm"><input class="field" name="name" placeholder="책 이름" required><input class="field" name="unitCount" type="number" min="1" max="80" value="10" required><input class="field" name="memo" placeholder="메모"><button class="primary-button" type="submit">추가</button></form></div><div class="table-wrap"><table><thead><tr><th>책 이름</th><th class="numeric">단원 수</th><th>메모</th><th class="numeric">관리</th></tr></thead><tbody>' + rows + '</tbody></table></div></section></div>';
  }

  function renderAssignments() {
    var visibleStudents = studentsByTeacher(ui.assignmentTeacherId);
    if (!ui.selectedStudentId || !getStudent(ui.selectedStudentId) || !teacherMatches(getStudent(ui.selectedStudentId), ui.assignmentTeacherId)) ui.selectedStudentId = visibleStudents[0] ? visibleStudents[0].id : null;
    var selectedStudent = getStudent(ui.selectedStudentId);
    var studentButtons = visibleStudents.map(function (student) {
      var count = activeAssignments().filter(function (a) { return a.studentId === student.id; }).length;
      return '<button class="student-pill ' + (student.id === ui.selectedStudentId ? 'active' : '') + '" data-action="select-assignment-student" data-student-id="' + student.id + '"><span>' + escapeHtml(student.name) + '</span><strong>' + count + '</strong></button>';
    }).join('');
    var checks = selectedStudent ? state.books.map(function (book) {
      var assignment = getAssignment(selectedStudent.id, book.id);
      var checked = assignment && assignment.active;
      return '<label class="check-card"><input type="checkbox" data-action="toggle-assignment" data-student-id="' + selectedStudent.id + '" data-book-id="' + book.id + '" ' + (checked ? 'checked' : '') + '><span><strong>' + escapeHtml(book.name) + '</strong><span>' + book.unitCount + '단원</span></span><span>' + (checked ? '사용' : '') + '</span></label>';
    }).join('') : '';
    var activeRows = activeAssignmentsByTeacher(ui.assignmentTeacherId).map(function (assignment) {
      var student = getStudent(assignment.studentId); var book = getBook(assignment.bookId); var totals = assignmentTotals(assignment);
      return '<tr><td>' + escapeHtml(teacherNamesForStudent(student)) + '</td><td>' + escapeHtml(student.name) + '</td><td>' + escapeHtml(book.name) + '</td><td class="numeric">' + totals.total + '</td><td class="numeric">' + totals.done + '</td><td>' + renderProgressBar(totals.rate) + '</td><td class="numeric">' + totals.rate + '%</td></tr>';
    }).join('');
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>책 배정</h2><p>' + activeAssignmentsByTeacher(ui.assignmentTeacherId).length + '건</p></div><div class="toolbar"><select class="select" id="assignmentTeacherFilter">' + teacherOptions(ui.assignmentTeacherId, true, true) + '</select></div></div><div class="assignment-layout"><aside class="panel"><div class="panel-head"><h3>학생</h3></div><div class="panel-body student-list">' + (studentButtons || emptyState('학생이 없습니다', '학생 화면에서 담당 선생님을 지정하세요.')) + '</div></aside><section class="panel"><div class="panel-head"><h3>' + (selectedStudent ? escapeHtml(selectedStudent.name) : '책') + '</h3></div><div class="panel-body"><div class="book-check-grid">' + (checks || emptyState('책이 없습니다', '책 화면에서 추가하세요.')) + '</div></div></section></div><section class="panel"><div class="panel-head"><h3>배정 목록</h3></div><div class="table-wrap"><table><thead><tr><th>선생님</th><th>학생</th><th>책</th><th class="numeric">전체</th><th class="numeric">완료</th><th>진도</th><th class="numeric">%</th></tr></thead><tbody>' + (activeRows || '<tr><td colspan="7">' + emptyState('배정된 책이 없습니다', '학생을 선택하고 사용하는 책을 체크하세요.') + '</td></tr>') + '</tbody></table></div></section></div>';
  }

  function filteredProgressRows() {
    var query = ui.progressQuery.trim().toLowerCase();
    return progressRows().filter(function (row) {
      if (!teacherMatches(row.student, ui.progressTeacherId)) return false;
      if (ui.progressStudentId !== 'all' && row.student.id !== ui.progressStudentId) return false;
      if (ui.progressBookId !== 'all' && row.book.id !== ui.progressBookId) return false;
      if (ui.progressStatus === 'done' && !row.done) return false;
      if (ui.progressStatus === 'todo' && row.done) return false;
      if (!query) return true;
      return (teacherNamesForStudent(row.student) + ' ' + row.student.name + ' ' + row.book.name + ' ' + row.unitName + ' ' + row.memo).toLowerCase().includes(query);
    });
  }

  function renderProgress() {
    var filtered = filteredProgressRows();
    var rows = filtered.map(function (row) {
      return '<tr data-assignment-id="' + row.assignment.id + '" data-unit="' + row.unit + '"><td>' + escapeHtml(teacherNamesForStudent(row.student)) + '</td><td>' + escapeHtml(row.student.name) + '</td><td>' + escapeHtml(row.book.name) + '</td><td class="numeric">' + row.unit + '</td><td>' + escapeHtml(row.unitName) + '</td><td><input type="checkbox" data-action="toggle-progress" ' + (row.done ? 'checked' : '') + '></td><td><input class="field" type="date" data-action="update-progress-date" value="' + escapeHtml(row.date) + '"></td><td><input class="field" data-action="update-progress-memo" value="' + escapeHtml(row.memo) + '"></td><td><span class="status-badge ' + (row.done ? 'done' : 'todo') + '">' + (row.done ? '완료' : '미완료') + '</span></td></tr>';
    }).join('');
    var advanced = ui.showProgressFilters ? '<div class="filters advanced-filters"><select class="select" id="progressStudentFilter">' + studentOptions(ui.progressStudentId, true, ui.progressTeacherId) + '</select><select class="select" id="progressBookFilter">' + bookOptions(ui.progressBookId, true) + '</select><select class="select" id="progressStatusFilter"><option value="all" ' + (ui.progressStatus === 'all' ? 'selected' : '') + '>전체</option><option value="todo" ' + (ui.progressStatus === 'todo' ? 'selected' : '') + '>미완료</option><option value="done" ' + (ui.progressStatus === 'done' ? 'selected' : '') + '>완료</option></select><input class="field" id="progressQuery" value="' + escapeHtml(ui.progressQuery) + '" placeholder="검색"></div>' : '';
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>진도 체크</h2><p>' + filtered.length + '개 단원</p></div></div><section class="panel"><div class="panel-body"><div class="filter-row"><select class="select" id="progressTeacherFilter">' + teacherOptions(ui.progressTeacherId, true, true) + '</select><button class="secondary-button" id="toggleProgressFilters">필터</button></div>' + advanced + '</div><div class="table-wrap"><table><thead><tr><th>선생님</th><th>학생</th><th>책</th><th class="numeric">단원</th><th>단원명</th><th>완료</th><th>체크일</th><th>메모</th><th>상태</th></tr></thead><tbody>' + (rows || '<tr><td colspan="9">' + emptyState('표시할 단원이 없습니다', '책 배정 화면에서 사용하는 책을 체크하세요.') + '</td></tr>') + '</tbody></table></div></section></div>';
  }

  function renderQuick() {
    var assignments = activeAssignmentsByTeacher(ui.quickTeacherId).filter(function (a) { return ui.quickBookId === 'all' || a.bookId === ui.quickBookId; });
    var maxUnits = Math.max.apply(null, [0].concat(assignments.map(function (a) { var book = getBook(a.bookId); return book ? book.unitCount : 0; })));
    var cappedUnits = Math.min(maxUnits, 40);
    var headers = [];
    for (var i = 1; i <= cappedUnits; i += 1) headers.push('<th>' + i + '</th>');
    var rows = assignments.map(function (assignment) {
      var student = getStudent(assignment.studentId); var book = getBook(assignment.bookId); var totals = assignmentTotals(assignment); var cells = [];
      for (var unit = 1; unit <= cappedUnits; unit += 1) {
        if (unit > book.unitCount) cells.push('<td></td>');
        else cells.push('<td><input type="checkbox" data-action="quick-toggle" data-assignment-id="' + assignment.id + '" data-unit="' + unit + '" ' + (getRecord(assignment.id, unit).done ? 'checked' : '') + '></td>');
      }
      return '<tr><td>' + escapeHtml(teacherNamesForStudent(student)) + '</td><td>' + escapeHtml(student.name) + '</td><td>' + escapeHtml(book.name) + '</td>' + cells.join('') + '<td class="numeric">' + totals.done + '/' + totals.total + '</td><td class="numeric">' + totals.rate + '%</td></tr>';
    }).join('');
    var advanced = ui.showQuickFilters ? '<div class="advanced-filters"><select class="select" id="quickBookFilter">' + bookOptions(ui.quickBookId, true) + '</select></div>' : '';
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>빠른 체크</h2><p>' + assignments.length + '건</p></div></div><section class="panel"><div class="panel-body"><div class="filter-row"><select class="select" id="quickTeacherFilter">' + teacherOptions(ui.quickTeacherId, true, true) + '</select><button class="secondary-button" id="toggleQuickFilters">필터</button></div>' + advanced + '</div><div class="table-wrap"><table class="quick-table"><thead><tr><th>선생님</th><th>학생</th><th>책</th>' + headers.join('') + '<th>완료</th><th>%</th></tr></thead><tbody>' + (rows || '<tr><td colspan="' + (cappedUnits + 5) + '">' + emptyState('빠르게 체크할 책이 없습니다', '책 배정 화면에서 사용하는 책을 체크하세요.') + '</td></tr>') + '</tbody></table></div></section></div>';
  }

  function aiKeywordCategories() {
    return [
      { title: '태도/습관', items: ['성실함', '꾸준함', '집중력', '수업 참여도', '질문을 잘함', '발표 자신감', '숙제 이행', '준비물 관리'] },
      { title: '학습 이해', items: ['개념 이해 우수', '응용력', '문제 해결력', '독해력', '연산 정확도', '계산 속도', '어휘력', '문장 구성력'] },
      { title: '보완점', items: ['집중 지속 필요', '꼼꼼함 필요', '복습 필요', '연산 속도 개선', '서술형 연습', '숙제 습관 형성', '자신감 향상', '실수 줄이기'] },
      { title: '성장 변화', items: ['최근 향상', '안정적인 진도', '적극성 증가', '오답 감소', '학습 리듬 형성', '자기주도성 향상', '태도 개선', '표현력 향상'] }
    ];
  }

  function renderAiKeywordSuggestions() {
    return '<div class="keyword-suggestions">' + aiKeywordCategories().map(function (group) {
      return '<div class="keyword-group"><div class="keyword-group-title">' + escapeHtml(group.title) + '</div><div class="keyword-chip-list">' + group.items.map(function (keyword) {
        return '<button type="button" class="keyword-chip" data-action="add-ai-keyword" data-keyword="' + escapeHtml(keyword) + '">' + escapeHtml(keyword) + '</button>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  function addAiKeyword(keyword) {
    keyword = String(keyword || '').trim();
    if (!keyword) return;
    var items = ui.aiKeywords.split(',').map(function (item) { return item.trim(); }).filter(Boolean);
    if (!items.some(function (item) { return item === keyword; })) items.push(keyword);
    ui.aiKeywords = items.join(', ');
    setAiStatus('키워드를 추가했습니다.');
    renderAiEvaluation();
  }

  function clearAiKeywords() {
    ui.aiKeywords = '';
    setAiStatus('키워드를 비웠습니다.');
    renderAiEvaluation();
  }

  function renderAiEvaluation() {
    ensureAiStudentId();
    var student = getStudent(ui.aiStudentId);
    var summary = student ? studentProgressSummary(student.id) : { text: '학생을 먼저 추가하세요.', books: [] };
    var recent = (state.evaluations || []).slice().sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    var savedItems = recent.map(function (item) {
      var created = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
      return '<article class="evaluation-item"><div class="evaluation-meta">' + escapeHtml(item.teacherNames || item.teacherName || teacherNamesForIds(item.teacherIds || item.teacherId || '')) + ' · ' + escapeHtml(item.studentName || '') + ' · ' + escapeHtml(item.tone || '') + ' · ' + escapeHtml(created) + '</div><p class="evaluation-content">' + escapeHtml(item.content || '').replaceAll('\n', '<br>') + '</p><div class="row-actions"><button class="mini-button danger" data-action="delete-evaluation" data-evaluation-id="' + item.id + '" title="삭제" aria-label="삭제">×</button></div></article>';
    }).join('');
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>AI 평가</h2><p>' + recent.length + '건 저장됨</p></div></div><div class="ai-layout"><section class="panel"><div class="panel-head"><h3>평가 작성</h3></div><div class="panel-body ai-form"><label class="stacked-field"><span>선생님</span><select class="select" id="aiTeacherFilter">' + teacherOptions(ui.aiTeacherId, true, true) + '</select></label><label class="stacked-field"><span>학생</span><select class="select" id="aiStudentSelect">' + studentOptions(ui.aiStudentId, false, ui.aiTeacherId) + '</select></label><label class="stacked-field"><span>템플릿</span><select class="select" id="aiTemplateSelect">' + aiTemplateOptions(ui.aiTemplate) + '</select></label><p class="template-hint">' + escapeHtml(aiTemplateHint(ui.aiTemplate)) + '</p><label class="stacked-field"><span>유형</span><select class="select" id="aiToneSelect">' + ['학부모 상담용','생활기록부식','짧은 문자','상담 메모'].map(function (tone) { return '<option value="' + tone + '" ' + (ui.aiTone === tone ? 'selected' : '') + '>' + tone + '</option>'; }).join('') + '</select></label><label class="stacked-field"><span>분량</span><select class="select" id="aiLengthSelect">' + ['짧게','보통','자세히'].map(function (length) { return '<option value="' + length + '" ' + (ui.aiLength === length ? 'selected' : '') + '>' + length + '</option>'; }).join('') + '</select></label><label class="stacked-field"><span>키워드</span><textarea class="textarea ai-keywords" id="aiKeywordsInput" placeholder="예: 성실함, 연산 속도 개선 필요, 숙제는 꾸준함">' + escapeHtml(ui.aiKeywords) + '</textarea></label><div class="keyword-head"><span>자주 쓰는 키워드</span><button type="button" class="mini-button" id="clearAiKeywords" title="키워드 비우기" aria-label="키워드 비우기">×</button></div>' + renderAiKeywordSuggestions() + '<p class="ai-progress-summary">' + escapeHtml(summary.text) + '</p><div class="data-actions"><button class="primary-button" id="generateEvaluationBtn" ' + (ui.aiBusy ? 'disabled' : '') + '>AI 평가 작성</button><button class="secondary-button" id="saveEvaluationBtn">저장</button><button class="secondary-button" id="copyEvaluationBtn">복사</button></div><p class="sync-status" id="aiStatusText">' + escapeHtml(ui.aiStatus || '키워드를 입력하고 AI 평가 작성을 누르세요.') + '</p></div></section><section class="panel"><div class="panel-head"><h3>작성된 평가</h3></div><div class="panel-body"><textarea class="textarea ai-output" id="aiDraftOutput" placeholder="작성된 평가가 여기에 표시됩니다.">' + escapeHtml(ui.aiDraft) + '</textarea></div></section></div><section class="panel"><div class="panel-head"><h3>저장된 평가</h3></div><div class="panel-body evaluation-list">' + (savedItems || emptyState('저장된 평가가 없습니다', '작성 후 저장을 누르면 여기에 남습니다.')) + '</div></section></div>';
  }

  function renderData() {
    var totals = overallTotals();
    var lastSync = syncConfig.lastSync ? new Date(syncConfig.lastSync).toLocaleString() : '아직 없음';
    VIEW.innerHTML = '<div class="view-stack"><div class="section-head"><div><h2>데이터</h2><p>선생님 ' + state.teachers.length + '명 · 학생 ' + state.students.length + '명 · 책 ' + state.books.length + '권 · 배정 ' + totals.assignments + '건</p></div></div><section class="panel"><div class="panel-head"><h3>구글 시트 자동 연동</h3></div><div class="panel-body"><div class="sync-grid"><label class="sync-field"><span>Apps Script Web App URL</span><input class="field" id="syncUrlInput" value="' + escapeHtml(syncConfig.url) + '" placeholder="https://script.google.com/macros/s/.../exec"></label><label class="sync-field"><span>연동 PIN</span><input class="field" id="syncTokenInput" value="' + escapeHtml(syncConfig.token) + '" placeholder="선택 입력"></label><label class="sync-toggle"><input type="checkbox" id="syncAutoInput" ' + (syncConfig.auto ? 'checked' : '') + '> 자동 저장</label><div class="data-actions"><button class="primary-button" id="saveSheetNow">구글 시트에 저장</button><button class="secondary-button" id="loadSheetNow">구글 시트에서 불러오기</button></div><p class="sync-status" id="syncStatusText">' + escapeHtml(syncStatus || ('마지막 동기화: ' + lastSync)) + '</p></div></div></section><section class="panel"><div class="panel-head"><h3>파일 백업</h3></div><div class="panel-body"><div class="data-actions"><button class="primary-button" id="dataExportJson">JSON 내보내기</button><button class="secondary-button" id="dataExportCsv">진도 CSV 내보내기</button><label class="secondary-button" for="dataImportJson">JSON 가져오기</label><input id="dataImportJson" type="file" accept="application/json,.json" hidden><button class="danger-button" id="resetData">초기화</button></div></div></section><section class="panel"><div class="panel-head"><h3>현재 구조</h3></div><div class="table-wrap"><table><tbody><tr><th>선생님</th><td>' + state.teachers.length + '명</td></tr><tr><th>담당 미지정 학생</th><td>' + studentsByTeacher('unassigned').length + '명</td></tr><tr><th>학생</th><td>' + state.students.length + '명</td></tr><tr><th>책</th><td>' + state.books.length + '권</td></tr><tr><th>학생별 책 배정</th><td>' + totals.assignments + '건</td></tr><tr><th>숙제</th><td>' + (state.homework || []).length + '건</td></tr><tr><th>상담 이력</th><td>' + (state.consultations || []).length + '건</td></tr><tr><th>AI 평가</th><td>' + (state.evaluations || []).length + '건</td></tr><tr><th>전체 단원</th><td>' + totals.total + '개</td></tr><tr><th>완료 단원</th><td>' + totals.done + '개</td></tr></tbody></table></div></section></div>';
  }

  function render() {
    tabs.forEach(function (tab) { tab.classList.toggle('active', tab.dataset.tab === ui.activeTab); });
    ({ dashboard: renderDashboard, alerts: renderAlerts, students: renderStudents, detail: renderStudentDetail, consultSchedule: renderConsultSchedule, teachers: renderTeachers, books: renderBooks, assignments: renderAssignments, progress: renderProgress, homework: renderHomework, quick: renderQuick, ai: renderAiEvaluation, data: renderData })[ui.activeTab]();
  }

  function addStudent(form) { var data = new FormData(form); var name = String(data.get('name') || '').trim(); if (!name) return; var teacherIds = normalizeTeacherIdList(String(data.get('teacherId') || '').trim()); state.students.push({ id: uid('stu'), name: name, teacherIds: teacherIds, teacherId: teacherIds[0] || '', memo: String(data.get('memo') || '').trim() }); saveState(); render(); }
  function addTeacher(form) { var data = new FormData(form); var name = String(data.get('name') || '').trim(); if (!name) return; state.teachers.push({ id: uid('teacher'), name: name, memo: String(data.get('memo') || '').trim() }); saveState(); render(); }
  function addHomework(form) { var data = new FormData(form); var studentId = String(data.get('studentId') || '').trim(); var title = String(data.get('title') || '').trim(); if (!studentId || !title) return; var student = getStudent(studentId); var teacherIds = studentTeacherIds(student); state.homework.push({ id: uid('hw'), studentId: studentId, teacherIds: teacherIds, teacherId: teacherIds[0] || '', title: title, dueDate: String(data.get('dueDate') || '').trim(), status: String(data.get('status') || 'todo'), memo: String(data.get('memo') || '').trim(), createdAt: new Date().toISOString() }); saveState(); render(); }
  function addConsultation(form) { var data = new FormData(form); var studentId = String(data.get('studentId') || '').trim(); var content = String(data.get('content') || '').trim(); if (!studentId || !content) return; var student = getStudent(studentId); var teacherIds = studentTeacherIds(student); state.consultations.unshift({ id: uid('note'), studentId: studentId, teacherIds: teacherIds, teacherId: teacherIds[0] || '', type: String(data.get('type') || '상담 메모'), date: String(data.get('date') || todayString()), content: content, createdAt: new Date().toISOString() }); saveState(); renderStudentDetail(); }
  function addBook(form) { var data = new FormData(form); var name = String(data.get('name') || '').trim(); if (!name) return; state.books.push({ id: uid('book'), name: name, unitCount: clampUnitCount(data.get('unitCount')), memo: String(data.get('memo') || '').trim() }); saveState(); render(); }

  function deleteStudent(studentId) {
    var student = getStudent(studentId); if (!student) return; if (!confirm(student.name + ' 학생을 삭제할까요?')) return;
    var assignmentIds = state.assignments.filter(function (a) { return a.studentId === studentId; }).map(function (a) { return a.id; });
    state.students = state.students.filter(function (item) { return item.id !== studentId; });
    state.assignments = state.assignments.filter(function (a) { return a.studentId !== studentId; });
    state.evaluations = (state.evaluations || []).filter(function (item) { return item.studentId !== studentId; });
    state.homework = (state.homework || []).filter(function (item) { return item.studentId !== studentId; });
    state.consultations = (state.consultations || []).filter(function (item) { return item.studentId !== studentId; });
    state.consultationSchedule = (state.consultationSchedule || []).filter(function (item) { return item.studentId !== studentId; });
    if (state.consultationSettings) delete state.consultationSettings[studentId];
    Object.keys(state.progress).forEach(function (key) { if (assignmentIds.some(function (id) { return key.indexOf(id + ':') === 0; })) delete state.progress[key]; });
    if (ui.selectedStudentId === studentId) ui.selectedStudentId = state.students[0] ? state.students[0].id : null;
    if (ui.aiStudentId === studentId) ui.aiStudentId = state.students[0] ? state.students[0].id : null;
    saveState(); render();
  }

  function deleteHomework(homeworkId) { if (!confirm('숙제를 삭제할까요?')) return; state.homework = (state.homework || []).filter(function (item) { return item.id !== homeworkId; }); saveState(); render(); }
  function deleteConsultation(consultationId) { if (!confirm('상담 이력을 삭제할까요?')) return; state.consultations = (state.consultations || []).filter(function (item) { return item.id !== consultationId; }); saveState(); renderStudentDetail(); }

  function deleteTeacher(teacherId) {
    var teacher = getTeacher(teacherId); if (!teacher) return; if (!confirm(teacher.name + ' 선생님을 삭제할까요? 학생에게서 해당 선생님 배정만 해제됩니다.')) return;
    state.teachers = state.teachers.filter(function (item) { return item.id !== teacherId; });
    state.students.forEach(function (student) {
      setStudentTeacherIds(student, studentTeacherIds(student).filter(function (id) { return id !== teacherId; }));
    });
    ['dashboardTeacherId','studentTeacherId','assignmentTeacherId','progressTeacherId','quickTeacherId','aiTeacherId','alertsTeacherId','detailTeacherId','homeworkTeacherId','consultTeacherId'].forEach(function (key) { if (ui[key] === teacherId) ui[key] = 'all'; });
    saveState(); render();
  }

  function deleteBook(bookId) {
    var book = getBook(bookId); if (!book) return; if (!confirm(book.name + ' 책을 삭제할까요?')) return;
    var assignmentIds = state.assignments.filter(function (a) { return a.bookId === bookId; }).map(function (a) { return a.id; });
    state.books = state.books.filter(function (item) { return item.id !== bookId; });
    state.assignments = state.assignments.filter(function (a) { return a.bookId !== bookId; });
    Object.keys(state.progress).forEach(function (key) { if (assignmentIds.some(function (id) { return key.indexOf(id + ':') === 0; })) delete state.progress[key]; });
    if (ui.progressBookId === bookId) ui.progressBookId = 'all'; if (ui.quickBookId === bookId) ui.quickBookId = 'all';
    saveState(); render();
  }

  function toggleAssignment(studentId, bookId, active) { var assignment = getAssignment(studentId, bookId); if (!assignment) state.assignments.push({ id: uid('asg'), studentId: studentId, bookId: bookId, active: active }); else assignment.active = active; saveState(); render(); }
  function exportJson() { var stamp = new Date().toISOString().slice(0, 10); downloadText('student-progress-' + stamp + '.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8'); }

  function importJson(file) {
    if (!file) return;
    file.text().then(function (text) {
      var imported = JSON.parse(text);
      if (!imported.students || !imported.books || !imported.assignments || !imported.progress) { alert('가져올 수 없는 파일입니다.'); return; }
      state = normalizeState(imported); saveState(); ui.selectedStudentId = firstStudentIdForTeacher(ui.assignmentTeacherId); ui.aiStudentId = firstStudentIdForTeacher(ui.aiTeacherId); render();
    }).catch(function () { alert('파일을 읽지 못했습니다.'); });
  }

  tabs.forEach(function (tab) { tab.addEventListener('click', function () { ui.activeTab = tab.dataset.tab; render(); }); });
  exportJsonBtn.addEventListener('click', exportJson);
  importInput.addEventListener('change', function (event) { importJson(event.target.files[0]); });

  document.addEventListener('submit', function (event) {
    if (event.target.id === 'studentForm') { event.preventDefault(); addStudent(event.target); }
    if (event.target.id === 'teacherForm') { event.preventDefault(); addTeacher(event.target); }
    if (event.target.id === 'homeworkForm') { event.preventDefault(); addHomework(event.target); }
    if (event.target.id === 'consultationForm') { event.preventDefault(); addConsultation(event.target); }
    if (event.target.id === 'bookForm') { event.preventDefault(); addBook(event.target); }
  });

  document.addEventListener('change', function (event) {
    var target = event.target; var action = target.dataset.action; var studentRow = target.closest('[data-student-id]'); var teacherRow = target.closest('[data-teacher-id]'); var homeworkRow = target.closest('[data-homework-id]'); var consultRow = target.closest('[data-consult-id]'); var bookRow = target.closest('[data-book-id]'); var progressRow = target.closest('[data-assignment-id][data-unit]');
    if (action === 'update-student' && studentRow) { var student = getStudent(studentRow.dataset.studentId); if (!student) return; if (target.dataset.field === 'teacherId') setStudentTeacherIds(student, target.value ? [target.value.trim()] : []); else student[target.dataset.field] = target.value.trim(); saveState(); render(); }
    if (action === 'toggle-student-teacher' && studentRow) { var assignedStudent = getStudent(studentRow.dataset.studentId); if (!assignedStudent) return; var assignedTeacherIds = studentTeacherIds(assignedStudent); if (target.checked && assignedTeacherIds.indexOf(target.dataset.teacherId) === -1) assignedTeacherIds.push(target.dataset.teacherId); if (!target.checked) assignedTeacherIds = assignedTeacherIds.filter(function (id) { return id !== target.dataset.teacherId; }); setStudentTeacherIds(assignedStudent, assignedTeacherIds); saveState(); render(); }
    if (action === 'update-teacher' && teacherRow) { var teacher = getTeacher(teacherRow.dataset.teacherId); if (!teacher) return; teacher[target.dataset.field] = target.value.trim(); saveState(); render(); }
    if (action === 'update-homework' && homeworkRow) { var homework = state.homework.find(function (item) { return item.id === homeworkRow.dataset.homeworkId; }); if (!homework) return; homework[target.dataset.field] = target.value.trim(); saveState(); render(); }
    if (action === 'update-consult-setting') updateConsultationSetting(target.dataset.studentId, target.dataset.field, target.value, target.checked);
    if (action === 'update-consult-schedule' && consultRow) { var consult = (state.consultationSchedule || []).find(function (item) { return item.id === consultRow.dataset.consultId; }); if (!consult) return; consult[target.dataset.field] = target.value.trim(); saveState(); render(); }
    if (action === 'update-book' && bookRow) { var book = getBook(bookRow.dataset.bookId); if (!book) return; if (target.dataset.field === 'unitCount') book.unitCount = clampUnitCount(target.value); else book[target.dataset.field] = target.value.trim(); saveState(); render(); }
    if (action === 'toggle-assignment') toggleAssignment(target.dataset.studentId, target.dataset.bookId, target.checked);
    if (action === 'toggle-progress' && progressRow) { var old = getRecord(progressRow.dataset.assignmentId, Number(progressRow.dataset.unit)); setRecord(progressRow.dataset.assignmentId, Number(progressRow.dataset.unit), { done: target.checked, date: target.checked ? old.date || new Date().toISOString().slice(0, 10) : old.date }); render(); }
    if (action === 'update-progress-date' && progressRow) setRecord(progressRow.dataset.assignmentId, Number(progressRow.dataset.unit), { date: target.value });
    if (action === 'update-progress-memo' && progressRow) setRecord(progressRow.dataset.assignmentId, Number(progressRow.dataset.unit), { memo: target.value.trim() });
    if (action === 'quick-toggle') { var prior = getRecord(target.dataset.assignmentId, Number(target.dataset.unit)); setRecord(target.dataset.assignmentId, Number(target.dataset.unit), { done: target.checked, date: target.checked ? prior.date || new Date().toISOString().slice(0, 10) : prior.date }); render(); }
    if (target.id === 'alertsTeacherFilter') { ui.alertsTeacherId = target.value; render(); }
    if (target.id === 'dashboardTeacherFilter') { ui.dashboardTeacherId = target.value; render(); }
    if (target.id === 'studentTeacherFilter') { ui.studentTeacherId = target.value; render(); }
    if (target.id === 'assignmentTeacherFilter') { ui.assignmentTeacherId = target.value; render(); }
    if (target.id === 'detailTeacherFilter') { ui.detailTeacherId = target.value; ui.detailStudentId = firstStudentIdForTeacher(ui.detailTeacherId); render(); }
    if (target.id === 'detailStudentSelect') { ui.detailStudentId = target.value; render(); }
    if (target.id === 'homeworkTeacherFilter') { ui.homeworkTeacherId = target.value; ui.homeworkStudentId = 'all'; render(); }
    if (target.id === 'homeworkStudentFilter') { ui.homeworkStudentId = target.value; render(); }
    if (target.id === 'homeworkStatusFilter') { ui.homeworkStatus = target.value; render(); }
    if (target.id === 'consultTeacherFilter') { ui.consultTeacherId = target.value; ui.consultDraft = []; ui.consultConflicts = []; render(); }
    if (target.id === 'consultWeeks') { ui.consultWeeks = Number(target.value || 4); render(); }
    if (target.id === 'progressTeacherFilter') { ui.progressTeacherId = target.value; ui.progressStudentId = 'all'; render(); }
    if (target.id === 'progressStudentFilter') { ui.progressStudentId = target.value; render(); }
    if (target.id === 'progressBookFilter') { ui.progressBookId = target.value; render(); }
    if (target.id === 'progressStatusFilter') { ui.progressStatus = target.value; render(); }
    if (target.id === 'quickTeacherFilter') { ui.quickTeacherId = target.value; render(); }
    if (target.id === 'quickBookFilter') { ui.quickBookId = target.value; render(); }
    if (target.id === 'aiTeacherFilter') { ui.aiTeacherId = target.value; ui.aiStudentId = firstStudentIdForTeacher(ui.aiTeacherId); setAiStatus(''); renderAiEvaluation(); }
    if (target.id === 'aiStudentSelect') { ui.aiStudentId = target.value; setAiStatus(''); renderAiEvaluation(); }
    if (target.id === 'aiTemplateSelect') { ui.aiTemplate = target.value; setAiStatus(''); renderAiEvaluation(); }
    if (target.id === 'aiToneSelect') { ui.aiTone = target.value; setAiStatus(''); }
    if (target.id === 'aiLengthSelect') { ui.aiLength = target.value; setAiStatus(''); }
    if (target.id === 'dataImportJson') importJson(target.files[0]);
    if (target.id === 'syncAutoInput') { syncConfig.auto = target.checked; saveSyncConfig(); setSyncStatus(syncConfig.auto ? '자동 저장 켜짐' : '자동 저장 꺼짐'); }
  });

  document.addEventListener('click', function (event) {
    var target = event.target.closest('button'); if (!target) return; var action = target.dataset.action;
    if (action === 'delete-student') deleteStudent(target.closest('[data-student-id]').dataset.studentId);
    if (action === 'delete-teacher') deleteTeacher(target.closest('[data-teacher-id]').dataset.teacherId);
    if (action === 'delete-book') deleteBook(target.closest('[data-book-id]').dataset.bookId);
    if (action === 'select-assignment-student') { ui.selectedStudentId = target.dataset.studentId; render(); }
    if (action === 'open-detail-student') { ui.detailStudentId = target.dataset.studentId; var studentForDetail = getStudent(ui.detailStudentId); ui.detailTeacherId = firstTeacherIdForStudent(studentForDetail) || 'all'; ui.activeTab = 'detail'; render(); }
    if (target.id === 'dataExportJson') exportJson();
    if (target.id === 'dataExportCsv') { var stamp = new Date().toISOString().slice(0, 10); downloadText('progress-' + stamp + '.csv', progressCsv(), 'text/csv;charset=utf-8'); }
    if (target.id === 'saveSheetNow') saveToGoogleSheet(false);
    if (target.id === 'loadSheetNow') { if (!confirm('구글 시트의 데이터로 현재 앱 데이터를 바꿀까요?')) return; loadFromGoogleSheet(); }
    if (target.id === 'generateEvaluationBtn') generateEvaluation();
    if (target.id === 'saveEvaluationBtn') saveEvaluationDraft();
    if (target.id === 'copyEvaluationBtn') copyEvaluationDraft();
    if (target.id === 'buildConsultSchedule') { buildConsultationDraft(); renderConsultSchedule(); }
    if (target.id === 'saveConsultDraft') saveConsultationDraft();
    if (target.id === 'clearConsultDraft') { ui.consultDraft = []; ui.consultConflicts = []; renderConsultSchedule(); }
    if (target.id === 'toggleProgressFilters') { ui.showProgressFilters = !ui.showProgressFilters; render(); }
    if (target.id === 'toggleQuickFilters') { ui.showQuickFilters = !ui.showQuickFilters; render(); }
    if (target.id === 'toggleHomeworkFilters') { ui.showHomeworkFilters = !ui.showHomeworkFilters; render(); }
    if (action === 'delete-homework') deleteHomework(target.closest('[data-homework-id]').dataset.homeworkId);
    if (action === 'delete-consult-schedule') deleteConsultationSchedule(target.closest('[data-consult-id]').dataset.consultId);
    if (action === 'delete-consultation') deleteConsultation(target.dataset.consultationId);
    if (action === 'add-ai-keyword') addAiKeyword(target.dataset.keyword);
    if (target.id === 'clearAiKeywords') clearAiKeywords();
    if (action === 'delete-evaluation') deleteEvaluation(target.dataset.evaluationId);
    if (target.id === 'resetData') { if (!confirm('초기 상태로 되돌릴까요?')) return; state = seedState(); saveState(); ui.selectedStudentId = state.students[0] ? state.students[0].id : null; ui.aiStudentId = state.students[0] ? state.students[0].id : null; ui.aiDraft = ''; ui.aiKeywords = ''; render(); }
  });

  document.addEventListener('input', function (event) {
    if (event.target.id === 'progressQuery') { ui.progressQuery = event.target.value; renderProgress(); }
    if (event.target.id === 'aiKeywordsInput') ui.aiKeywords = event.target.value;
    if (event.target.id === 'aiDraftOutput') ui.aiDraft = event.target.value;
    if (event.target.id === 'consultStartDate') ui.consultStartDate = event.target.value || todayString();
    if (event.target.id === 'consultStartTime') ui.consultStartTime = event.target.value || '14:00';
    if (event.target.id === 'consultInterval') ui.consultInterval = Number(event.target.value || 20);
    if (event.target.id === 'consultMaxPerDay') ui.consultMaxPerDay = Number(event.target.value || 6);
    if (event.target.id === 'syncUrlInput') { syncConfig.url = normalizeSyncUrl(event.target.value); saveSyncConfig(); setSyncStatus('연동 URL 저장됨'); }
    if (event.target.id === 'syncTokenInput') { syncConfig.token = event.target.value.trim(); saveSyncConfig(); setSyncStatus('연동 PIN 저장됨'); }
  });
  registerMobileAppShell();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () {
      if (syncConfig.auto && syncConfig.url) saveToGoogleSheet(true);
    });
  }
  render();
})();
