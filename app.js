/* ═══════════════════════════════════════════
   DayOS — app.js
   Pure JS, zero dependencies, all data in localStorage
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Constants ── */
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const TRANSITION_BUFFER = 10;
  const WIND_DOWN_DURATION = 30;
  const MIN_ENRICHMENT_MINUTES = 15;
  const ROLLING_WINDOW = 10;
  const ROLLING_THRESHOLD = 5;

  /* ── Default Profile ── */
  function defaultProfile () {
    return {
      nonNegotiables: [
        { id: 'job_applications', name: 'Job Applications', emoji: '💼', defaultDuration: 45, energy: 'high', freqType: 'daily', freqMin: 5, freqUnit: 'sessions', weeklyTarget: null },
        { id: 'dutch_study', name: 'Dutch Study', emoji: '🇳🇱', defaultDuration: 60, energy: 'medium', freqType: 'daily', freqMin: 1, freqUnit: 'hours', weeklyTarget: null },
        { id: 'gym', name: 'Gym', emoji: '🏋️', defaultDuration: 90, energy: 'medium-high', freqType: 'weekly', freqMin: 2, freqMax: 4, freqUnit: 'sessions', weeklyTarget: 4 }
      ],
      optionalPriorities: [
        { id: 'reading', name: 'Reading', emoji: '📖', defaultDuration: 30, energy: 'low' },
        { id: 'grooming', name: 'Grooming', emoji: '🪞', defaultDuration: 20, energy: 'low' }
      ],
      enrichmentPool: [
        { id: 'e1', name: 'Walk in Leuven', emoji: '🚶', category: 'Outdoors', duration: 'medium' },
        { id: 'e2', name: 'Movie Night', emoji: '🎬', category: 'Entertainment', duration: 'long' },
        { id: 'e3', name: 'Call a Friend', emoji: '📞', category: 'Social', duration: 'medium' },
        { id: 'e4', name: 'Cook Something New', emoji: '🍳', category: 'Self-care', duration: 'medium' },
        { id: 'e5', name: 'Listen to Music', emoji: '🎧', category: 'Entertainment', duration: 'short' },
        { id: 'e6', name: 'Stretch & Meditate', emoji: '🧘', category: 'Self-care', duration: 'short' },
        { id: 'e7', name: 'Explore a Park', emoji: '🌳', category: 'Outdoors', duration: 'long' },
        { id: 'e8', name: 'Coffee with Someone', emoji: '☕', category: 'Social', duration: 'medium' }
      ],
      fixedEvents: [],
      enrichmentIndex: 0
    };
  }

  /* ── Storage helpers ── */
  function load (key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function save (key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  /* ── State ── */
  let profile = load('dayos_profile', defaultProfile());
  let todaySchedule = load('dayos_schedule', null);
  let dayState = load('dayos_daystate', null);
  let activityHistory = load('dayos_history', {});
  let gymWeekLog = load('dayos_gymweek', { week: currentWeekId(), count: 0 });
  let dayLog = load('dayos_daylog', []);
  // dayLog = [{ date: 'YYYY-MM-DD', blocks: int, totalMinutes: int, mood: str|null }]
  let notes = load('dayos_notes', []);
  // notes = [{ date: 'YYYY-MM-DD', time: ISO, activityId: str, activityName: str, emoji: str, text: str }]
  let blockNotes = load('dayos_blocknotes', {});
  // blockNotes = { "blockIndex": "note text" } — for current day only
  let todayTasks = load('dayos_todaytasks', []);
  // todayTasks = [{ id, name, duration, emoji }] — one-off tasks for today, cleared on new day
  let windDownNotified = false;
  let timerInterval = null;

  /* ── Helpers ── */
  function currentWeekId () {
    const d = new Date(); const jan1 = new Date(d.getFullYear(),0,1);
    return d.getFullYear() + '-W' + Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  }
  function pad (n) { return String(n).padStart(2, '0'); }
  function fmtTime (date) {
    if (!(date instanceof Date)) date = new Date(date);
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
  function fmtDuration (mins) {
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h > 0 ? h + 'h ' + (m > 0 ? m + 'm' : '') : m + 'm';
  }
  function fmtDateLong (d) {
    if (!(d instanceof Date)) d = new Date(d);
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function fmtDateShort (d) {
    if (!(d instanceof Date)) d = new Date(d);
    return DAYS_SHORT[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1);
  }
  function todayStr () {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  }
  function parseTimeToday (str) {
    const [h, m] = str.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0); return d;
  }
  function parseTimeNextDay (str) {
    // Next wake time ALWAYS means tomorrow — never today
    const d = parseTimeToday(str);
    d.setDate(d.getDate() + 1);
    return d;
  }
  function minutesBetween (a, b) { return (b - a) / 60000; }
  function addMinutes (date, mins) { return new Date(date.getTime() + mins * 60000); }
  function todayDayName () { return DAYS[new Date().getDay()]; }

  function getEffectiveDuration (activityId, defaultDur) {
    const hist = activityHistory[activityId];
    if (!hist || hist.length < ROLLING_THRESHOLD) return defaultDur;
    const recent = hist.slice(-ROLLING_WINDOW);
    return Math.round(recent.reduce((s, v) => s + v, 0) / recent.length);
  }

  function isEveningSlot (startDate) { return startDate.getHours() >= 20; }

  function moodMatchesCategory (mood, category) {
    if (!mood) return true;
    const map = { 'stay_in': ['Entertainment', 'Self-care'], 'get_outside': ['Outdoors', 'Social'], 'social': ['Social', 'Outdoors'] };
    return !map[mood] || map[mood].includes(category);
  }

  function durationRange (tag) {
    if (tag === 'short') return [0, 30];
    if (tag === 'medium') return [30, 90];
    return [90, 999];
  }

  function pickEnrichment (availableMinutes, mood) {
    const pool = profile.enrichmentPool;
    if (pool.length === 0) return null;
    let candidates = pool.filter(e => {
      const [lo, hi] = durationRange(e.duration);
      const dur = lo === 0 ? Math.min(availableMinutes, 25) : (lo + hi) / 2;
      return dur <= availableMinutes && moodMatchesCategory(mood, e.category);
    });
    if (candidates.length === 0) {
      candidates = pool.filter(e => {
        const [lo] = durationRange(e.duration);
        return (lo === 0 ? 10 : lo) <= availableMinutes;
      });
    }
    if (candidates.length === 0) candidates = pool.slice();
    let idx = profile.enrichmentIndex % candidates.length;
    const pick = candidates[idx];
    profile.enrichmentIndex = (profile.enrichmentIndex + 1) % pool.length;
    save('dayos_profile', profile);
    return pick;
  }

  function enrichmentDuration (tag, availableMinutes) {
    if (tag === 'short') return Math.min(25, availableMinutes);
    if (tag === 'medium') return Math.min(60, availableMinutes);
    return Math.min(90, availableMinutes);
  }

  function getGreeting () {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  /* ── Scheduling Engine ── */
  function buildSchedule (wakeStr, nextWakeStr, mood) {
    const now = new Date();
    const sleepTime = addMinutes(parseTimeNextDay(nextWakeStr), -8 * 60);
    const windDownStart = addMinutes(sleepTime, -WIND_DOWN_DURATION);
    let cursor = new Date(Math.max(now.getTime(), parseTimeToday(wakeStr).getTime()));

    const wk = currentWeekId();
    if (gymWeekLog.week !== wk) { gymWeekLog = { week: wk, count: 0 }; save('dayos_gymweek', gymWeekLog); }

    const dayName = todayDayName();
    const fixedEvents = profile.fixedEvents
      .filter(e => e.day === dayName)
      .map(e => ({
        id: 'fixed_' + e.id, name: e.name, emoji: '📌',
        start: parseTimeToday(e.start), end: parseTimeToday(e.end),
        fixed: true, type: 'fixed'
      }))
      .sort((a, b) => a.start - b.start);

    const blocks = [];
    let enrichmentPlaced = false;
    const activities = [];

    for (const nn of profile.nonNegotiables) {
      if (nn.id === 'gym' && gymWeekLog.count >= (nn.weeklyTarget || 4)) continue;
      activities.push({ ...nn, duration: getEffectiveDuration(nn.id, nn.defaultDuration), priority: 'non-negotiable', type: 'work' });
    }
    // Today's one-off tasks — scheduled right after non-negotiables
    for (const tt of todayTasks) {
      activities.push({ id: tt.id, name: tt.name, emoji: tt.emoji || '📝', duration: tt.duration, energy: 'medium', priority: 'today-task', type: 'work' });
    }
    for (const op of profile.optionalPriorities) {
      activities.push({ ...op, duration: getEffectiveDuration(op.id, op.defaultDuration), priority: 'optional', type: 'work' });
    }

    function getNextFixed (afterTime) { return fixedEvents.find(e => e.start >= afterTime); }
    function availableBefore (deadline) { return Math.max(0, minutesBetween(cursor, deadline)); }

    function placeBlock (act, start, dur) {
      blocks.push({
        id: act.id, name: act.name, emoji: act.emoji,
        start: new Date(start), end: addMinutes(start, dur),
        duration: dur, type: act.type || 'work',
        isEnrichment: act.type === 'enrichment', fixed: false
      });
      cursor = addMinutes(start, dur + TRANSITION_BUFFER);
    }

    function placeFixedBlock (fe) {
      blocks.push({
        id: fe.id, name: fe.name, emoji: fe.emoji,
        start: new Date(fe.start), end: new Date(fe.end),
        duration: minutesBetween(fe.start, fe.end),
        type: 'fixed', isEnrichment: false, fixed: true
      });
      cursor = addMinutes(fe.end, TRANSITION_BUFFER);
    }

    let actIdx = 0;
    let iter = 0;

    while (cursor < windDownStart && iter < 100) {
      iter++;
      const nextFixed = getNextFixed(cursor);
      const deadline = nextFixed ? new Date(Math.min(nextFixed.start.getTime(), windDownStart.getTime())) : windDownStart;
      const avail = availableBefore(deadline);

      if (avail < 5) {
        if (nextFixed && cursor < nextFixed.start) {
          cursor = new Date(nextFixed.start);
          placeFixedBlock(nextFixed);
          continue;
        }
        break;
      }

      if (actIdx < activities.length) {
        const act = activities[actIdx];
        if ((act.energy === 'high') && isEveningSlot(cursor)) { actIdx++; continue; }
        if (act.duration + TRANSITION_BUFFER <= avail || act.duration <= avail) {
          const actualDur = Math.min(act.duration, avail - TRANSITION_BUFFER);
          if (actualDur >= 15) { placeBlock(act, cursor, actualDur < act.duration ? actualDur : act.duration); actIdx++; continue; }
        }
        if (nextFixed && avail >= MIN_ENRICHMENT_MINUTES + TRANSITION_BUFFER && !enrichmentPlaced) {
          const eDur = Math.max(MIN_ENRICHMENT_MINUTES, avail - TRANSITION_BUFFER);
          const pick = pickEnrichment(eDur, mood);
          if (pick) {
            placeBlock({ id: pick.id, name: pick.name, emoji: pick.emoji, type: 'enrichment' }, cursor, Math.min(enrichmentDuration(pick.duration, eDur), eDur));
            enrichmentPlaced = true; continue;
          }
        }
        if (nextFixed) { cursor = new Date(nextFixed.start); placeFixedBlock(nextFixed); continue; }
        actIdx++; continue;
      }

      const remainAvail = availableBefore(deadline) - TRANSITION_BUFFER;
      if (remainAvail >= MIN_ENRICHMENT_MINUTES) {
        const pick = pickEnrichment(remainAvail, mood);
        if (pick) {
          placeBlock({ id: pick.id, name: pick.name, emoji: pick.emoji, type: 'enrichment' }, cursor, Math.min(enrichmentDuration(pick.duration, remainAvail), remainAvail));
          enrichmentPlaced = true; continue;
        }
      }
      if (nextFixed) { cursor = new Date(nextFixed.start); placeFixedBlock(nextFixed); continue; }
      break;
    }

    // Hard rule: at least one enrichment
    if (!enrichmentPlaced && blocks.length > 0) {
      const lastBlock = blocks[blocks.length - 1];
      if (!lastBlock.fixed) {
        const stolen = Math.max(MIN_ENRICHMENT_MINUTES, 15);
        if (lastBlock.duration > stolen + 15) {
          lastBlock.duration -= stolen + TRANSITION_BUFFER;
          lastBlock.end = addMinutes(lastBlock.start, lastBlock.duration);
          const enrichStart = addMinutes(lastBlock.end, TRANSITION_BUFFER);
          const pick = pickEnrichment(stolen, mood);
          if (pick) {
            blocks.push({ id: pick.id, name: pick.name, emoji: pick.emoji, start: enrichStart, end: addMinutes(enrichStart, stolen), duration: stolen, type: 'enrichment', isEnrichment: true, fixed: false });
            enrichmentPlaced = true;
          }
        } else {
          const isOptional = profile.optionalPriorities.some(o => o.id === lastBlock.id);
          if (isOptional) {
            const pick = pickEnrichment(lastBlock.duration, mood);
            if (pick) { lastBlock.name = pick.name; lastBlock.emoji = pick.emoji; lastBlock.id = pick.id; lastBlock.type = 'enrichment'; lastBlock.isEnrichment = true; enrichmentPlaced = true; }
          }
        }
      }
    }
    if (!enrichmentPlaced) {
      const lastEnd = blocks.length > 0 ? blocks[blocks.length - 1].end : cursor;
      const gap = minutesBetween(lastEnd, windDownStart) - TRANSITION_BUFFER;
      if (gap >= MIN_ENRICHMENT_MINUTES) {
        const pick = pickEnrichment(gap, mood);
        if (pick) {
          const eStart = addMinutes(lastEnd, TRANSITION_BUFFER);
          const eDur = Math.min(enrichmentDuration(pick.duration, gap), gap);
          blocks.push({ id: pick.id, name: pick.name, emoji: pick.emoji, start: eStart, end: addMinutes(eStart, eDur), duration: eDur, type: 'enrichment', isEnrichment: true, fixed: false });
        }
      }
    }

    blocks.push({ id: 'wind_down', name: 'Wind Down', emoji: '🌙', start: new Date(windDownStart), end: new Date(sleepTime), duration: WIND_DOWN_DURATION, type: 'winddown', isEnrichment: false, fixed: true });
    blocks.push({ id: 'sleep', name: 'Sleep', emoji: '😴', start: new Date(sleepTime), end: addMinutes(sleepTime, 480), duration: 480, type: 'sleep', isEnrichment: false, fixed: true });

    return { blocks, sleepTime, windDownStart };
  }

  /* ── Recalculate from now ── */
  function recalculateFromNow () {
    if (!dayState) return;
    const result = buildSchedule(dayState.wakeTime, dayState.nextWakeTime, dayState.mood);
    todaySchedule = result.blocks;
    dayState.sleepTime = result.sleepTime.toISOString();
    dayState.windDownTime = result.windDownStart.toISOString();
    dayState.currentBlockIndex = 0;
    dayState.blockStartedAt = null;
    save('dayos_schedule', todaySchedule);
    save('dayos_daystate', dayState);
    renderBlockView();
  }

  /* ── Learning Engine ── */
  function recordBlockCompletion (activityId, durationMinutes) {
    if (activityId.startsWith('fixed_') || activityId === 'wind_down' || activityId === 'sleep') return;
    if (!activityHistory[activityId]) activityHistory[activityId] = [];
    activityHistory[activityId].push(Math.round(durationMinutes));
    if (activityHistory[activityId].length > 50) activityHistory[activityId] = activityHistory[activityId].slice(-50);
    save('dayos_history', activityHistory);

    if (activityId === 'gym') {
      const wk = currentWeekId();
      if (gymWeekLog.week !== wk) gymWeekLog = { week: wk, count: 0 };
      gymWeekLog.count++;
      save('dayos_gymweek', gymWeekLog);
    }

    // Update day log
    const today = todayStr();
    let entry = dayLog.find(d => d.date === today);
    if (!entry) { entry = { date: today, blocks: 0, totalMinutes: 0, mood: dayState ? dayState.mood : null }; dayLog.push(entry); }
    entry.blocks++;
    entry.totalMinutes += Math.round(durationMinutes);
    if (dayLog.length > 90) dayLog = dayLog.slice(-90);
    save('dayos_daylog', dayLog);
  }

  /* ── Wind-down check ── */
  function checkWindDown () {
    if (!dayState || !dayState.windDownTime) return;
    const minsUntil = minutesBetween(new Date(), new Date(dayState.windDownTime));
    if (minsUntil <= 30 && minsUntil > 0 && !windDownNotified) {
      windDownNotified = true;
      showWindDownBanner();
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification('DayOS', { body: 'Wind down in ' + Math.round(minsUntil) + ' minutes — start your evening routine.' });
          }).catch(() => {});
        } catch (e) {
          try { new Notification('DayOS', { body: 'Wind down in ' + Math.round(minsUntil) + ' minutes.' }); } catch (e2) {}
        }
      }
    }
  }

  function showWindDownBanner () {
    if (document.getElementById('windDownBanner')) return;
    const b = document.createElement('div');
    b.id = 'windDownBanner';
    b.className = 'wind-down-banner';
    b.textContent = '🌙 Wind down soon — start your evening routine';
    document.body.prepend(b);
  }

  function requestNotifPermission () {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }

  /* ═══════════════════════════════════
     UI RENDERING
     ═══════════════════════════════════ */

  const $ = (id) => document.getElementById(id);

  function showScreen (screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    $(screenId).classList.remove('hidden');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const tabMap = { screenStart: 'navStart', screenBlock: 'navBlock', screenFull: 'navFull', screenStats: 'navStats', screenSettings: 'navSettings' };
    const tab = $(tabMap[screenId]);
    if (tab) tab.classList.add('active');
  }

  function escapeHtml (str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ── Start Screen ── */
  function renderStartScreen () {
    // Date
    $('todayDate').textContent = fmtDateShort(new Date());
    // Greeting
    $('startGreeting').textContent = getGreeting() + '! Set up your day below.';

    // Default times
    const wakeInput = $('inputWake');
    const nextWakeInput = $('inputNextWake');
    if (!wakeInput.value) {
      const now = new Date();
      wakeInput.value = pad(now.getHours()) + ':' + pad(now.getMinutes());
    }
    if (!nextWakeInput.value) nextWakeInput.value = '07:00';

    updateDayPreview();
    renderTodayTasks();
    renderScheduleSummary();
    showScreen('screenStart');
  }

  function updateDayPreview () {
    const wakeStr = $('inputWake').value;
    const nextWakeStr = $('inputNextWake').value;
    if (!wakeStr || !nextWakeStr) return;

    const wakeTime = parseTimeToday(wakeStr);
    const now = new Date();
    const startTime = new Date(Math.max(now.getTime(), wakeTime.getTime()));
    const sleepTime = addMinutes(parseTimeNextDay(nextWakeStr), -8 * 60);
    const windDown = addMinutes(sleepTime, -WIND_DOWN_DURATION);
    const availHours = Math.max(0, minutesBetween(startTime, windDown) / 60);

    $('previewRange').textContent = fmtTime(startTime) + ' to ' + fmtTime(windDown);
    $('previewWindDown').textContent = fmtTime(windDown);
    $('previewSleep').textContent = fmtTime(sleepTime);
    $('previewHours').textContent = availHours.toFixed(1) + 'h';
  }

  function renderTodayTasks () {
    const container = $('todayTasksList');
    container.innerHTML = '';
    todayTasks.forEach(t => {
      const row = document.createElement('div');
      row.className = 'today-task-row';
      row.innerHTML =
        '<span>' + (t.emoji || '📝') + '</span>' +
        '<span class="tt-name">' + escapeHtml(t.name) + '</span>' +
        '<span class="tt-dur">' + fmtDuration(t.duration) + '</span>' +
        '<button class="btn btn-danger btn-small" data-id="' + t.id + '" style="padding:4px 8px;font-size:0.7rem;">✕</button>';
      container.appendChild(row);
    });
    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', function () {
        todayTasks = todayTasks.filter(t => t.id !== this.dataset.id);
        save('dayos_todaytasks', todayTasks);
        renderTodayTasks();
        renderScheduleSummary();
      });
    });
  }

  function addTodayTask () {
    const name = $('newTodayTask').value.trim();
    const dur = parseInt($('newTodayDur').value) || 30;
    if (!name) return;
    todayTasks.push({ id: 'tt' + Date.now(), name: name, duration: dur, emoji: '📝' });
    save('dayos_todaytasks', todayTasks);
    $('newTodayTask').value = '';
    $('newTodayDur').value = '30';
    renderTodayTasks();
    renderScheduleSummary();
  }

  function renderScheduleSummary () {
    const container = $('scheduleSummary');
    container.innerHTML = '';
    const wk = currentWeekId();
    if (gymWeekLog.week !== wk) { gymWeekLog = { week: wk, count: 0 }; }

    for (const nn of profile.nonNegotiables) {
      if (nn.id === 'gym' && gymWeekLog.count >= (nn.weeklyTarget || 4)) continue;
      const dur = getEffectiveDuration(nn.id, nn.defaultDuration);
      container.innerHTML += '<div class="summary-chip">' + nn.emoji + ' ' + escapeHtml(nn.name) + ' <span style="color:#555">' + fmtDuration(dur) + '</span></div>';
    }
    for (const tt of todayTasks) {
      container.innerHTML += '<div class="summary-chip">' + (tt.emoji || '📝') + ' ' + escapeHtml(tt.name) + ' <span style="color:#555">' + fmtDuration(tt.duration) + '</span></div>';
    }
    for (const op of profile.optionalPriorities) {
      const dur = getEffectiveDuration(op.id, op.defaultDuration);
      container.innerHTML += '<div class="summary-chip">' + op.emoji + ' ' + escapeHtml(op.name) + ' <span style="color:#555">' + fmtDuration(dur) + '</span></div>';
    }
    container.innerHTML += '<div class="summary-chip enrichment-chip">🎯 Enrichment</div>';
    container.innerHTML += '<div class="summary-chip">🌙 Wind Down <span style="color:#555">30m</span></div>';

    const dayName = todayDayName();
    const todayFixed = profile.fixedEvents.filter(e => e.day === dayName);
    for (const fe of todayFixed) {
      container.innerHTML += '<div class="summary-chip">📌 ' + escapeHtml(fe.name) + ' <span style="color:#555">' + fe.start + '–' + fe.end + '</span></div>';
    }
  }

  /* ── Block View ── */
  function renderBlockView () {
    if (!todaySchedule || !dayState) { renderStartScreen(); return; }

    const idx = dayState.currentBlockIndex;
    if (idx >= todaySchedule.length) { renderDayComplete(); return; }

    const block = todaySchedule[idx];
    const isEnrichment = block.isEnrichment || block.type === 'enrichment';
    const card = $('focusCard');
    card.className = 'focus-card' + (isEnrichment ? ' enrichment' : '');

    // Date header
    $('blockDateHeader').textContent = fmtDateLong(new Date());
    // Progress
    const totalBlocks = todaySchedule.filter(b => b.type !== 'sleep').length;
    $('blockProgress').textContent = 'Block ' + (idx + 1) + ' of ' + totalBlocks;

    $('blockEmoji').textContent = block.emoji;
    $('blockName').textContent = block.name;
    $('blockTimeRange').textContent = fmtTime(new Date(block.start)) + ' – ' + fmtTime(new Date(block.end)) + '  ·  ' + fmtDuration(block.duration);

    // Load any existing note for this block
    $('blockNotes').value = blockNotes[String(idx)] || '';

    $('btnDone').classList.remove('hidden');
    $('timerLabelEl').textContent = 'ELAPSED';

    if (!dayState.blockStartedAt) {
      dayState.blockStartedAt = new Date().toISOString();
      save('dayos_daystate', dayState);
    }

    startTimer();
    showScreen('screenBlock');
  }

  function startTimer () {
    clearInterval(timerInterval);
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
  }

  function updateTimer () {
    if (!dayState || !dayState.blockStartedAt) return;
    const elapsed = (Date.now() - new Date(dayState.blockStartedAt).getTime()) / 1000;
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = Math.floor(elapsed % 60);
    $('timerDisplay').textContent = (h > 0 ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
    checkWindDown();
  }

  function saveCurrentNote () {
    if (!dayState) return;
    const noteText = $('blockNotes').value.trim();
    const idx = String(dayState.currentBlockIndex);
    if (noteText) {
      blockNotes[idx] = noteText;
    } else {
      delete blockNotes[idx];
    }
    save('dayos_blocknotes', blockNotes);
  }

  function persistNoteToJournal (blockIndex) {
    const noteText = blockNotes[String(blockIndex)];
    if (!noteText) return;
    const block = todaySchedule[blockIndex];
    notes.push({
      date: todayStr(),
      time: new Date().toISOString(),
      activityId: block.id,
      activityName: block.name,
      emoji: block.emoji,
      text: noteText
    });
    if (notes.length > 200) notes = notes.slice(-200);
    save('dayos_notes', notes);
  }

  function completeBlock () {
    if (!dayState || !dayState.blockStartedAt) return;
    clearInterval(timerInterval);

    // Save note first
    saveCurrentNote();

    const block = todaySchedule[dayState.currentBlockIndex];
    const elapsed = (Date.now() - new Date(dayState.blockStartedAt).getTime()) / 60000;
    recordBlockCompletion(block.id, elapsed);

    // Persist note to journal
    persistNoteToJournal(dayState.currentBlockIndex);

    dayState.currentBlockIndex++;
    dayState.blockStartedAt = null;
    save('dayos_daystate', dayState);

    if (dayState.currentBlockIndex >= todaySchedule.length) {
      renderDayComplete();
    } else {
      renderBlockView();
    }
  }

  function renderDayComplete () {
    const completedBlocks = dayState ? dayState.currentBlockIndex : 0;
    const todayEntry = dayLog.find(d => d.date === todayStr());
    const totalMins = todayEntry ? todayEntry.totalMinutes : 0;

    $('focusCard').innerHTML =
      '<div class="day-complete">' +
        '<div class="dc-emoji">🎉</div>' +
        '<div class="dc-title">Day Complete!</div>' +
        '<p class="dc-sub">You completed ' + completedBlocks + ' blocks (' + fmtDuration(totalMins) + ' tracked). Great work today.</p>' +
        '<button class="btn btn-secondary" onclick="window.DayOS.resetDay()">Start New Day</button>' +
      '</div>';
    $('btnDone').classList.add('hidden');
    showScreen('screenBlock');
  }

  /* ── Full Day View ── */
  function renderFullDay () {
    if (!todaySchedule) { renderStartScreen(); return; }

    $('fullDayTitle').textContent = "Today's Schedule";
    $('fullDayDate').textContent = fmtDateLong(new Date());

    // Summary bar
    const summary = $('fullDaySummary');
    const totalBlocks = todaySchedule.filter(b => b.type !== 'sleep').length;
    const doneSoFar = dayState ? dayState.currentBlockIndex : 0;
    const totalPlannedMins = todaySchedule.filter(b => b.type !== 'sleep').reduce((s, b) => s + b.duration, 0);
    const workMins = todaySchedule.filter(b => b.type === 'work').reduce((s, b) => s + b.duration, 0);
    const enrichMins = todaySchedule.filter(b => b.isEnrichment || b.type === 'enrichment').reduce((s, b) => s + b.duration, 0);

    summary.innerHTML =
      '<div class="fullday-stat"><div class="fullday-stat-val">' + doneSoFar + '/' + totalBlocks + '</div><div class="fullday-stat-label">Done</div></div>' +
      '<div class="fullday-stat"><div class="fullday-stat-val">' + fmtDuration(totalPlannedMins) + '</div><div class="fullday-stat-label">Planned</div></div>' +
      '<div class="fullday-stat"><div class="fullday-stat-val">' + fmtDuration(workMins) + '</div><div class="fullday-stat-label">Work</div></div>' +
      '<div class="fullday-stat"><div class="fullday-stat-val" style="color:#f0a050">' + fmtDuration(enrichMins) + '</div><div class="fullday-stat-label">Fun</div></div>';

    // List
    const list = $('fullDayList');
    list.innerHTML = '';
    todaySchedule.forEach((block, i) => {
      if (i > 0) {
        const buf = document.createElement('li');
        buf.className = 'schedule-item buffer';
        buf.innerHTML = '<div class="buffer-dots"></div>';
        list.appendChild(buf);
      }
      const li = document.createElement('li');
      let cls = 'schedule-item';
      if (dayState && i < dayState.currentBlockIndex) cls += ' completed';
      if (dayState && i === dayState.currentBlockIndex) cls += ' current';
      if (block.isEnrichment || block.type === 'enrichment') cls += ' enrichment-item';
      li.className = cls;

      const noteText = blockNotes[String(i)];
      const noteHtml = noteText ? '<div class="item-note">📝 ' + escapeHtml(noteText) + '</div>' : '';

      li.innerHTML =
        '<span class="item-emoji">' + block.emoji + '</span>' +
        '<div class="item-info"><div class="item-name">' + escapeHtml(block.name) + '</div>' +
        '<div class="item-time">' + fmtTime(new Date(block.start)) + ' – ' + fmtTime(new Date(block.end)) + '</div>' +
        noteHtml + '</div>' +
        '<span class="item-dur">' + fmtDuration(block.duration) + '</span>';
      list.appendChild(li);
    });

    showScreen('screenFull');
  }

  /* ── Statistics Screen ── */
  function renderStats () {
    // Top cards
    const totalDays = dayLog.length;
    const totalBlocks = dayLog.reduce((s, d) => s + d.blocks, 0);
    const totalMinutes = dayLog.reduce((s, d) => s + d.totalMinutes, 0);

    // Calculate streak
    let streak = 0;
    const today = todayStr();
    const sortedDates = dayLog.map(d => d.date).sort().reverse();
    if (sortedDates.length > 0) {
      let checkDate = new Date();
      // If today isn't logged yet, start from yesterday
      if (sortedDates[0] !== today) {
        checkDate.setDate(checkDate.getDate() - 1);
      }
      for (let i = 0; i < 365; i++) {
        const ds = checkDate.getFullYear() + '-' + pad(checkDate.getMonth()+1) + '-' + pad(checkDate.getDate());
        if (sortedDates.includes(ds)) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    $('statTotalDays').textContent = totalDays;
    $('statStreak').textContent = streak;
    $('statBlocksDone').textContent = totalBlocks;
    $('statTotalHours').textContent = (totalMinutes / 60).toFixed(1);

    // Week grid
    renderWeekGrid();
    // Activity breakdown
    renderActivityBreakdown();
    // Activity averages
    renderActivityAverages();
    // Recent days
    renderRecentDays();
    // Notes journal
    renderNotesJournal();

    showScreen('screenStats');
  }

  function renderWeekGrid () {
    const container = $('weekGrid');
    container.innerHTML = '';
    const now = new Date();
    const dayOfWeek = now.getDay();
    // Start from Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
      const logged = dayLog.find(e => e.date === ds);
      const isToday = ds === todayStr();

      let dotClass = 'week-day-dot';
      if (logged) dotClass += ' done';
      else if (isToday) dotClass += ' today';
      else dotClass += ' empty';

      const col = document.createElement('div');
      col.className = 'week-day-col';
      col.innerHTML =
        '<div class="week-day-label">' + DAYS_SHORT[(i + 1) % 7] + '</div>' +
        '<div class="' + dotClass + '">' + (logged ? logged.blocks : (isToday ? '—' : '')) + '</div>';
      container.appendChild(col);
    }
  }

  function renderActivityBreakdown () {
    const container = $('activityBreakdown');
    container.innerHTML = '';

    // Aggregate all time per activity
    const totals = {};
    let maxTotal = 0;
    const allActivities = [...profile.nonNegotiables, ...profile.optionalPriorities, ...profile.enrichmentPool];

    for (const act of allActivities) {
      const hist = activityHistory[act.id];
      if (!hist || hist.length === 0) continue;
      const total = hist.reduce((s, v) => s + v, 0);
      totals[act.id] = { name: act.name, emoji: act.emoji, total, isEnrichment: profile.enrichmentPool.some(e => e.id === act.id) };
      if (total > maxTotal) maxTotal = total;
    }

    if (Object.keys(totals).length === 0) {
      container.innerHTML = '<p style="color:#555;font-size:0.85rem;">No data yet. Complete blocks to see time breakdown.</p>';
      return;
    }

    const sorted = Object.values(totals).sort((a, b) => b.total - a.total);
    for (const item of sorted) {
      const pct = maxTotal > 0 ? (item.total / maxTotal * 100) : 0;
      const row = document.createElement('div');
      row.className = 'activity-bar-row';
      row.innerHTML =
        '<span class="activity-bar-label">' + item.emoji + ' ' + escapeHtml(item.name) + '</span>' +
        '<div class="activity-bar-track"><div class="activity-bar-fill ' + (item.isEnrichment ? 'enrichment' : 'work') + '" style="width:' + pct + '%"></div></div>' +
        '<span class="activity-bar-value">' + fmtDuration(item.total) + '</span>';
      container.appendChild(row);
    }
  }

  function renderActivityAverages () {
    const container = $('activityAverages');
    container.innerHTML = '';
    const allActivities = [...profile.nonNegotiables, ...profile.optionalPriorities];
    let hasData = false;

    allActivities.forEach(act => {
      const hist = activityHistory[act.id];
      if (!hist || hist.length === 0) return;
      hasData = true;
      const avg = Math.round(hist.slice(-ROLLING_WINDOW).reduce((s, v) => s + v, 0) / Math.min(hist.length, ROLLING_WINDOW));
      const isLearned = hist.length >= ROLLING_THRESHOLD;
      const div = document.createElement('div');
      div.className = 'history-activity';
      div.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div class="ha-name">' + act.emoji + ' ' + escapeHtml(act.name) + '</div>' +
          '<button class="btn btn-danger btn-small" data-id="' + act.id + '" style="padding:4px 8px;font-size:0.65rem;">Clear</button>' +
        '</div>' +
        '<div class="ha-stats">' +
          hist.length + ' sessions · avg ' + fmtDuration(avg) +
          (isLearned ? ' · <span style="color:#6c63ff">learned — using real avg</span>' : ' · ' + (ROLLING_THRESHOLD - hist.length) + ' more to learn') +
          ' · default ' + fmtDuration(act.defaultDuration) +
        '</div>' +
        '<div class="history-bar"><div class="history-bar-fill" style="width:' + Math.min(100, (hist.length / ROLLING_THRESHOLD) * 100) + '%"></div></div>';
      container.appendChild(div);
    });

    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', function () {
        const id = this.dataset.id;
        if (!confirm('Clear all history for this activity? The learning engine will reset to default duration.')) return;
        delete activityHistory[id];
        save('dayos_history', activityHistory);
        renderStats();
      });
    });

    if (!hasData) {
      container.innerHTML = '<p style="color:#555;font-size:0.85rem;">Complete at least one block to see learning progress.</p>';
    }
  }

  function renderRecentDays () {
    const container = $('recentDaysLog');
    container.innerHTML = '';

    if (dayLog.length === 0) {
      container.innerHTML = '<p style="color:#555;font-size:0.85rem;">No days logged yet.</p>';
      return;
    }

    const recent = dayLog.slice(-14).reverse();
    for (const day of recent) {
      const d = new Date(day.date + 'T12:00:00');
      const row = document.createElement('div');
      row.className = 'recent-day-row';

      let dots = '';
      for (let i = 0; i < Math.min(day.blocks, 20); i++) {
        dots += '<span class="recent-day-block-dot work-dot"></span>';
      }

      row.innerHTML =
        '<span class="recent-day-date">' + fmtDateShort(d) + '</span>' +
        '<div class="recent-day-blocks">' + dots + '</div>' +
        '<span class="recent-day-count">' + day.blocks + 'b · ' + fmtDuration(day.totalMinutes) + '</span>' +
        '<button class="btn btn-danger btn-small" data-date="' + day.date + '" style="padding:4px 8px;font-size:0.7rem;margin-left:6px;">✕</button>';
      container.appendChild(row);
    }
    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', function () {
        const date = this.dataset.date;
        dayLog = dayLog.filter(d => d.date !== date);
        save('dayos_daylog', dayLog);
        renderStats();
      });
    });
  }

  function renderNotesJournal () {
    const container = $('notesJournal');
    container.innerHTML = '';

    if (notes.length === 0) {
      container.innerHTML = '<p style="color:#555;font-size:0.85rem;">No notes yet. Add notes while working on blocks.</p>';
      return;
    }

    const recent = notes.slice(-20).reverse();
    for (let ni = 0; ni < recent.length; ni++) {
      const note = recent[ni];
      const d = new Date(note.time);
      const noteIdx = notes.length - 1 - ni; // index in the original array
      const entry = document.createElement('div');
      entry.className = 'note-entry';
      entry.innerHTML =
        '<div class="note-entry-header">' +
          '<span class="note-entry-activity">' + note.emoji + ' ' + escapeHtml(note.activityName) + '</span>' +
          '<span style="display:flex;align-items:center;gap:6px;">' +
            '<span class="note-entry-date">' + fmtDateShort(d) + ' ' + fmtTime(d) + '</span>' +
            '<button class="btn btn-danger btn-small" data-idx="' + noteIdx + '" style="padding:2px 6px;font-size:0.65rem;">✕</button>' +
          '</span>' +
        '</div>' +
        '<div class="note-entry-text">' + escapeHtml(note.text) + '</div>';
      container.appendChild(entry);
    }
    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = parseInt(this.dataset.idx);
        notes.splice(idx, 1);
        save('dayos_notes', notes);
        renderNotesJournal();
      });
    });
  }

  /* ── Settings Screen ── */
  function renderSettings () {
    renderNonNegotiables();
    renderOptionalPriorities();
    renderEnrichmentPool();
    renderFixedEvents();
    showScreen('screenSettings');
  }

  function renderNonNegotiables () {
    const container = $('nnList');
    container.innerHTML = '';
    profile.nonNegotiables.forEach(nn => {
      const row = document.createElement('div');
      row.className = 'nn-row';
      row.innerHTML =
        '<span>' + nn.emoji + '</span>' +
        '<span class="nn-name">' + escapeHtml(nn.name) + '</span>' +
        '<div class="nn-detail">' + nn.energy + '</div>' +
        '<input type="number" min="10" max="300" value="' + nn.defaultDuration + '" data-id="' + nn.id + '" class="nn-dur-input">' +
        '<span style="font-size:0.75rem;color:#666">min</span>';
      container.appendChild(row);
    });
    container.querySelectorAll('.nn-dur-input').forEach(inp => {
      inp.addEventListener('change', function () {
        const nn = profile.nonNegotiables.find(n => n.id === this.dataset.id);
        if (nn) { nn.defaultDuration = parseInt(this.value) || nn.defaultDuration; save('dayos_profile', profile); }
      });
    });
  }

  function renderOptionalPriorities () {
    const container = $('opList');
    container.innerHTML = '';
    profile.optionalPriorities.forEach(op => {
      const row = document.createElement('div');
      row.className = 'nn-row';
      row.innerHTML =
        '<span>' + op.emoji + '</span>' +
        '<span class="nn-name">' + escapeHtml(op.name) + '</span>' +
        '<input type="number" min="5" max="180" value="' + op.defaultDuration + '" data-id="' + op.id + '" class="op-dur-input">' +
        '<span style="font-size:0.75rem;color:#666">min</span>';
      container.appendChild(row);
    });
    container.querySelectorAll('.op-dur-input').forEach(inp => {
      inp.addEventListener('change', function () {
        const op = profile.optionalPriorities.find(o => o.id === this.dataset.id);
        if (op) { op.defaultDuration = parseInt(this.value) || op.defaultDuration; save('dayos_profile', profile); }
      });
    });
  }

  function renderEnrichmentPool () {
    const container = $('enrichmentList');
    container.innerHTML = '';
    profile.enrichmentPool.forEach(e => {
      const row = document.createElement('div');
      row.className = 'enrichment-item-row';
      const catClass = 'tag-' + e.category.toLowerCase().replace('-', '');
      row.innerHTML =
        '<span>' + e.emoji + '</span>' +
        '<span class="ei-name">' + escapeHtml(e.name) + '</span>' +
        '<span class="ei-tags"><span class="tag ' + catClass + '">' + e.category + '</span><span class="tag tag-' + e.duration + '">' + e.duration + '</span></span>' +
        '<button class="btn btn-danger btn-small" data-id="' + e.id + '">✕</button>';
      container.appendChild(row);
    });
    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', function () {
        profile.enrichmentPool = profile.enrichmentPool.filter(e => e.id !== this.dataset.id);
        save('dayos_profile', profile);
        renderEnrichmentPool();
      });
    });
  }

  function addEnrichmentItem () {
    const name = $('newEnrichName').value.trim();
    const emoji = $('newEnrichEmoji').value.trim() || '🎯';
    const category = $('newEnrichCategory').value;
    const duration = $('newEnrichDuration').value;
    if (!name) return;
    profile.enrichmentPool.push({ id: 'e' + Date.now(), name, emoji, category, duration });
    save('dayos_profile', profile);
    $('newEnrichName').value = '';
    $('newEnrichEmoji').value = '';
    renderEnrichmentPool();
  }

  function renderFixedEvents () {
    const container = $('fixedEventsList');
    container.innerHTML = '';
    profile.fixedEvents.forEach(ev => {
      const row = document.createElement('div');
      row.className = 'fixed-event-row';
      row.innerHTML =
        '<div class="fe-info"><span class="fe-day">' + ev.day + '</span> <span class="fe-time">' + ev.start + ' – ' + ev.end + '</span><div class="fe-name">' + escapeHtml(ev.name) + '</div></div>' +
        '<button class="btn btn-danger btn-small" data-id="' + ev.id + '">✕</button>';
      container.appendChild(row);
    });
    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', function () {
        profile.fixedEvents = profile.fixedEvents.filter(e => e.id !== this.dataset.id);
        save('dayos_profile', profile);
        renderFixedEvents();
      });
    });
  }

  function addFixedEvent () {
    const name = $('newEventName').value.trim();
    const day = $('newEventDay').value;
    const start = $('newEventStart').value;
    const end = $('newEventEnd').value;
    if (!name || !start || !end) return;
    profile.fixedEvents.push({ id: 'fe' + Date.now(), name, day, start, end });
    save('dayos_profile', profile);
    $('newEventName').value = '';
    $('newEventStart').value = '';
    $('newEventEnd').value = '';
    renderFixedEvents();
  }

  /* ── Reset Day ── */
  function resetDay () {
    clearInterval(timerInterval);
    todaySchedule = null;
    dayState = null;
    blockNotes = {};
    todayTasks = [];
    windDownNotified = false;
    localStorage.removeItem('dayos_schedule');
    localStorage.removeItem('dayos_daystate');
    localStorage.removeItem('dayos_blocknotes');
    localStorage.removeItem('dayos_todaytasks');
    const banner = document.getElementById('windDownBanner');
    if (banner) banner.remove();
    $('btnDone').classList.remove('hidden');
    $('timerLabelEl').textContent = 'ELAPSED';
    renderStartScreen();
  }

  /* ── Reset All Data ── */
  function resetAll () {
    if (!confirm('This will erase ALL your DayOS data including history, notes, and profile. Continue?')) return;
    clearInterval(timerInterval);
    localStorage.removeItem('dayos_profile');
    localStorage.removeItem('dayos_schedule');
    localStorage.removeItem('dayos_daystate');
    localStorage.removeItem('dayos_history');
    localStorage.removeItem('dayos_gymweek');
    localStorage.removeItem('dayos_daylog');
    localStorage.removeItem('dayos_notes');
    localStorage.removeItem('dayos_blocknotes');
    localStorage.removeItem('dayos_todaytasks');
    profile = defaultProfile();
    todaySchedule = null;
    dayState = null;
    activityHistory = {};
    gymWeekLog = { week: currentWeekId(), count: 0 };
    dayLog = [];
    notes = [];
    blockNotes = {};
    todayTasks = [];
    windDownNotified = false;
    renderStartScreen();
  }

  /* ── Build Day Action ── */
  function buildMyDay () {
    const wakeStr = $('inputWake').value;
    const nextWakeStr = $('inputNextWake').value;
    if (!wakeStr || !nextWakeStr) {
      alert('Please set both wake times to build your day.');
      return;
    }

    let mood = null;
    const activeMood = document.querySelector('.mood-btn.active');
    if (activeMood) mood = activeMood.dataset.mood;

    requestNotifPermission();

    const result = buildSchedule(wakeStr, nextWakeStr, mood);

    // Validate: must have at least one real block (not just wind-down + sleep)
    const realBlocks = result.blocks.filter(b => b.type !== 'winddown' && b.type !== 'sleep');
    if (realBlocks.length === 0) {
      const sleepAt = fmtTime(result.sleepTime);
      const windAt = fmtTime(result.windDownStart);
      alert(
        'Not enough time to schedule anything!\n\n' +
        'With tomorrow\'s wake time at ' + nextWakeStr + ', your calculated bedtime is ' + sleepAt +
        ' and wind-down starts at ' + windAt + '.\n\n' +
        'That leaves no room for activities. Try setting a later wake time for tomorrow so your bedtime moves later.'
      );
      return;
    }

    todaySchedule = result.blocks;
    blockNotes = {};
    save('dayos_blocknotes', blockNotes);

    dayState = {
      wakeTime: wakeStr,
      nextWakeTime: nextWakeStr,
      mood: mood,
      currentBlockIndex: 0,
      blockStartedAt: null,
      sleepTime: result.sleepTime.toISOString(),
      windDownTime: result.windDownStart.toISOString(),
      built: new Date().toISOString()
    };

    // Log the day as started
    const today = todayStr();
    if (!dayLog.find(d => d.date === today)) {
      dayLog.push({ date: today, blocks: 0, totalMinutes: 0, mood: mood });
      if (dayLog.length > 90) dayLog = dayLog.slice(-90);
      save('dayos_daylog', dayLog);
    }

    save('dayos_schedule', todaySchedule);
    save('dayos_daystate', dayState);
    renderBlockView();
  }

  /* ── Init ── */
  function init () {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Mood buttons
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const wasActive = this.classList.contains('active');
        document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
        if (!wasActive) this.classList.add('active');
      });
    });

    // Live preview update when times change
    $('inputWake').addEventListener('change', updateDayPreview);
    $('inputNextWake').addEventListener('change', updateDayPreview);

    // Navigation
    $('navStart').addEventListener('click', () => renderStartScreen());
    $('navBlock').addEventListener('click', () => {
      if (todaySchedule && dayState) renderBlockView();
      else renderStartScreen();
    });
    $('navFull').addEventListener('click', () => {
      if (todaySchedule) renderFullDay();
      else renderStartScreen();
    });
    $('navStats').addEventListener('click', () => renderStats());
    $('navSettings').addEventListener('click', () => renderSettings());

    // Actions
    $('btnBuildDay').addEventListener('click', buildMyDay);
    $('btnDone').addEventListener('click', completeBlock);
    $('btnSeeFullDay').addEventListener('click', renderFullDay);
    $('btnRecalculate').addEventListener('click', recalculateFromNow);
    $('btnBackToCurrent').addEventListener('click', () => renderBlockView());
    $('btnSaveNote').addEventListener('click', () => {
      saveCurrentNote();
      const btn = $('btnSaveNote');
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save Note'; }, 1200);
    });
    $('btnAddTodayTask').addEventListener('click', addTodayTask);
    $('newTodayTask').addEventListener('keydown', function (e) { if (e.key === 'Enter') addTodayTask(); });
    $('btnAddEnrichment').addEventListener('click', addEnrichmentItem);
    $('btnAddFixedEvent').addEventListener('click', addFixedEvent);
    $('btnResetAll').addEventListener('click', resetAll);

    // Check if there's an active day
    if (todaySchedule && dayState) {
      const builtDate = dayState.built ? new Date(dayState.built).toDateString() : '';
      if (builtDate === new Date().toDateString()) {
        renderBlockView();
      } else {
        resetDay();
      }
    } else {
      renderStartScreen();
    }

    setInterval(checkWindDown, 30000);
  }

  window.DayOS = { resetDay };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
