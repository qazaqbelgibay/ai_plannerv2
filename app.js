/* ═══════════════════════════════════════════
   DayOS — app.js
   Pure JS, zero dependencies, all data in localStorage
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Constants ── */
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const TRANSITION_BUFFER = 10; // minutes between blocks
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
  /* dayState = { wakeTime, nextWakeTime, mood, currentBlockIndex, blockStartedAt, sleepTime, windDownTime, built: ISO date } */
  let activityHistory = load('dayos_history', {});
  let gymWeekLog = load('dayos_gymweek', { week: currentWeekId(), count: 0 });
  let windDownNotified = false;

  /* ── Timer ── */
  let timerInterval = null;

  /* ── Helpers ── */
  function currentWeekId () {
    const d = new Date(); const jan1 = new Date(d.getFullYear(),0,1);
    return d.getFullYear() + '-W' + Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  }
  function pad (n) { return String(n).padStart(2, '0'); }
  function fmtTime (date) { return pad(date.getHours()) + ':' + pad(date.getMinutes()); }
  function fmtDuration (mins) {
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h > 0 ? h + 'h ' + (m > 0 ? m + 'm' : '') : m + 'm';
  }
  function parseTimeToday (str) {
    const [h, m] = str.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0); return d;
  }
  function parseTimeTomorrow (str) {
    const d = parseTimeToday(str);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
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

  function isEveningSlot (startDate) {
    return startDate.getHours() >= 20;
  }

  function moodMatchesCategory (mood, category) {
    if (!mood) return true;
    const map = {
      'stay_in': ['Entertainment', 'Self-care'],
      'get_outside': ['Outdoors', 'Social'],
      'social': ['Social', 'Outdoors']
    };
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
    if (candidates.length === 0) {
      candidates = pool.slice();
    }
    let idx = profile.enrichmentIndex % candidates.length;
    const pick = candidates[idx];
    profile.enrichmentIndex = (profile.enrichmentIndex + 1) % pool.length;
    save('dayos_profile', profile);
    return pick;
  }

  function enrichmentDuration (tag, availableMinutes) {
    const [lo, hi] = durationRange(tag);
    if (tag === 'short') return Math.min(25, availableMinutes);
    if (tag === 'medium') return Math.min(60, availableMinutes);
    return Math.min(Math.max(lo, availableMinutes), availableMinutes);
  }

  /* ── Scheduling Engine ── */
  function buildSchedule (wakeStr, nextWakeStr, mood) {
    const now = new Date();
    const sleepTime = addMinutes(parseTimeTomorrow(nextWakeStr), -8 * 60);
    const windDownStart = addMinutes(sleepTime, -WIND_DOWN_DURATION);
    let cursor = new Date(Math.max(now.getTime(), parseTimeToday(wakeStr).getTime()));

    // Reset gym count if new week
    const wk = currentWeekId();
    if (gymWeekLog.week !== wk) { gymWeekLog = { week: wk, count: 0 }; save('dayos_gymweek', gymWeekLog); }

    // Gather fixed events for today
    const dayName = todayDayName();
    const fixedEvents = profile.fixedEvents
      .filter(e => e.day === dayName)
      .map(e => ({
        id: 'fixed_' + e.id,
        name: e.name,
        emoji: '📌',
        start: parseTimeToday(e.start),
        end: parseTimeToday(e.end),
        fixed: true,
        type: 'fixed'
      }))
      .sort((a, b) => a.start - b.start);

    // Blocks to schedule
    const blocks = [];
    let enrichmentPlaced = false;

    // Priority queue of activities
    const activities = [];

    // Non-negotiables
    for (const nn of profile.nonNegotiables) {
      if (nn.id === 'gym' && gymWeekLog.count >= (nn.weeklyTarget || 4)) continue;
      const dur = getEffectiveDuration(nn.id, nn.defaultDuration);
      activities.push({ ...nn, duration: dur, priority: 'non-negotiable', type: 'work' });
    }

    // Optional priorities
    for (const op of profile.optionalPriorities) {
      const dur = getEffectiveDuration(op.id, op.defaultDuration);
      activities.push({ ...op, duration: dur, priority: 'optional', type: 'work' });
    }

    // Build timeline: interleave fixed events and scheduled activities
    function getNextFixed (afterTime) {
      return fixedEvents.find(e => e.start >= afterTime);
    }

    function availableBefore (deadline) {
      return Math.max(0, minutesBetween(cursor, deadline));
    }

    function placeBlock (act, start, dur) {
      blocks.push({
        id: act.id,
        name: act.name,
        emoji: act.emoji,
        start: new Date(start),
        end: addMinutes(start, dur),
        duration: dur,
        type: act.type || 'work',
        isEnrichment: act.type === 'enrichment',
        fixed: false
      });
      cursor = addMinutes(start, dur + TRANSITION_BUFFER);
    }

    function placeFixedBlock (fe) {
      blocks.push({
        id: fe.id,
        name: fe.name,
        emoji: fe.emoji,
        start: new Date(fe.start),
        end: new Date(fe.end),
        duration: minutesBetween(fe.start, fe.end),
        type: 'fixed',
        isEnrichment: false,
        fixed: true
      });
      cursor = addMinutes(fe.end, TRANSITION_BUFFER);
    }

    // Fill the day
    let actIdx = 0;
    const maxIterations = 100;
    let iter = 0;

    while (cursor < windDownStart && iter < maxIterations) {
      iter++;
      const nextFixed = getNextFixed(cursor);
      const deadline = nextFixed ? new Date(Math.min(nextFixed.start.getTime(), windDownStart.getTime())) : windDownStart;
      const avail = availableBefore(deadline);

      if (avail < 5) {
        // Not enough time — jump to after fixed event if there is one
        if (nextFixed && cursor < nextFixed.start) {
          // Place fixed event
          cursor = new Date(nextFixed.start);
          placeFixedBlock(nextFixed);
          continue;
        }
        break;
      }

      // Try to place next activity
      if (actIdx < activities.length) {
        const act = activities[actIdx];
        const dur = act.duration;

        // Energy check: high energy after 8pm gets deferred
        if ((act.energy === 'high') && isEveningSlot(cursor)) {
          actIdx++;
          continue;
        }

        if (dur + TRANSITION_BUFFER <= avail || dur <= avail) {
          const actualDur = Math.min(dur, avail - TRANSITION_BUFFER);
          if (actualDur >= 15) {
            placeBlock(act, cursor, actualDur < dur ? actualDur : dur);
            actIdx++;
            continue;
          }
        }

        // Not enough room before next fixed — try enrichment or skip to fixed
        if (nextFixed && avail >= MIN_ENRICHMENT_MINUTES + TRANSITION_BUFFER && !enrichmentPlaced) {
          const eDur = Math.max(MIN_ENRICHMENT_MINUTES, avail - TRANSITION_BUFFER);
          const pick = pickEnrichment(eDur, mood);
          if (pick) {
            const realDur = Math.min(enrichmentDuration(pick.duration, eDur), eDur);
            placeBlock({ id: pick.id, name: pick.name, emoji: pick.emoji, type: 'enrichment' }, cursor, realDur);
            enrichmentPlaced = true;
            continue;
          }
        }

        // Jump to after fixed event
        if (nextFixed) {
          cursor = new Date(nextFixed.start);
          placeFixedBlock(nextFixed);
          continue;
        }

        // Can't fit — try next activity
        actIdx++;
        continue;
      }

      // All scheduled activities placed — fill remaining with enrichment
      const remainAvail = availableBefore(deadline) - TRANSITION_BUFFER;
      if (remainAvail >= MIN_ENRICHMENT_MINUTES) {
        const pick = pickEnrichment(remainAvail, mood);
        if (pick) {
          const realDur = Math.min(enrichmentDuration(pick.duration, remainAvail), remainAvail);
          placeBlock({ id: pick.id, name: pick.name, emoji: pick.emoji, type: 'enrichment' }, cursor, realDur);
          enrichmentPlaced = true;
          continue;
        }
      }

      // Jump past fixed events
      if (nextFixed) {
        cursor = new Date(nextFixed.start);
        placeFixedBlock(nextFixed);
        continue;
      }

      break;
    }

    // Hard rule: ensure at least one enrichment block
    if (!enrichmentPlaced && blocks.length > 0) {
      // Find the lowest-priority block and replace it, or shrink last block
      const lastBlock = blocks[blocks.length - 1];
      if (!lastBlock.fixed) {
        const stolen = Math.max(MIN_ENRICHMENT_MINUTES, 15);
        if (lastBlock.duration > stolen + 15) {
          lastBlock.duration -= stolen + TRANSITION_BUFFER;
          lastBlock.end = addMinutes(lastBlock.start, lastBlock.duration);
          const enrichStart = addMinutes(lastBlock.end, TRANSITION_BUFFER);
          const pick = pickEnrichment(stolen, mood);
          if (pick) {
            blocks.push({
              id: pick.id, name: pick.name, emoji: pick.emoji,
              start: enrichStart, end: addMinutes(enrichStart, stolen),
              duration: stolen, type: 'enrichment', isEnrichment: true, fixed: false
            });
            enrichmentPlaced = true;
          }
        } else {
          // Replace last block entirely if it's optional
          const isOptional = profile.optionalPriorities.some(o => o.id === lastBlock.id);
          if (isOptional) {
            const pick = pickEnrichment(lastBlock.duration, mood);
            if (pick) {
              lastBlock.name = pick.name;
              lastBlock.emoji = pick.emoji;
              lastBlock.id = pick.id;
              lastBlock.type = 'enrichment';
              lastBlock.isEnrichment = true;
              enrichmentPlaced = true;
            }
          }
        }
      }
    }

    // If still no enrichment and there's any time at all, insert a minimal one before wind-down
    if (!enrichmentPlaced) {
      const lastEnd = blocks.length > 0 ? blocks[blocks.length - 1].end : cursor;
      const gap = minutesBetween(lastEnd, windDownStart) - TRANSITION_BUFFER;
      if (gap >= MIN_ENRICHMENT_MINUTES) {
        const pick = pickEnrichment(gap, mood);
        if (pick) {
          const eStart = addMinutes(lastEnd, TRANSITION_BUFFER);
          const eDur = Math.min(enrichmentDuration(pick.duration, gap), gap);
          blocks.push({
            id: pick.id, name: pick.name, emoji: pick.emoji,
            start: eStart, end: addMinutes(eStart, eDur),
            duration: eDur, type: 'enrichment', isEnrichment: true, fixed: false
          });
        }
      }
    }

    // Add wind-down block
    blocks.push({
      id: 'wind_down', name: 'Wind Down', emoji: '🌙',
      start: new Date(windDownStart), end: new Date(sleepTime),
      duration: WIND_DOWN_DURATION, type: 'winddown', isEnrichment: false, fixed: true
    });

    // Add sleep block marker
    blocks.push({
      id: 'sleep', name: 'Sleep', emoji: '😴',
      start: new Date(sleepTime), end: addMinutes(sleepTime, 480),
      duration: 480, type: 'sleep', isEnrichment: false, fixed: true
    });

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
    if (activityHistory[activityId].length > 50) {
      activityHistory[activityId] = activityHistory[activityId].slice(-50);
    }
    save('dayos_history', activityHistory);

    // Track gym weekly
    if (activityId === 'gym') {
      const wk = currentWeekId();
      if (gymWeekLog.week !== wk) gymWeekLog = { week: wk, count: 0 };
      gymWeekLog.count++;
      save('dayos_gymweek', gymWeekLog);
    }
  }

  /* ── Wind-down check ── */
  function checkWindDown () {
    if (!dayState || !dayState.windDownTime) return;
    const wdt = new Date(dayState.windDownTime);
    const now = new Date();
    const minsUntil = minutesBetween(now, wdt);
    if (minsUntil <= 30 && minsUntil > 0 && !windDownNotified) {
      windDownNotified = true;
      showWindDownBanner();
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification('DayOS', { body: 'Wind down in ' + Math.round(minsUntil) + ' minutes — start your evening routine.', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">🌙</text></svg>' });
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

  /* ── Request notification permission ── */
  function requestNotifPermission () {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  /* ═══════════════════════════════════
     UI RENDERING
     ═══════════════════════════════════ */

  const $ = (id) => document.getElementById(id);

  function showScreen (screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    $(screenId).classList.remove('hidden');
    // Update nav
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const tabMap = { screenStart: 'navStart', screenBlock: 'navBlock', screenFull: 'navFull', screenSettings: 'navSettings' };
    const tab = $(tabMap[screenId]);
    if (tab) tab.classList.add('active');
  }

  /* ── Start Screen ── */
  function renderStartScreen () {
    // Set default times
    const wakeInput = $('inputWake');
    const nextWakeInput = $('inputNextWake');
    if (!wakeInput.value) {
      const now = new Date();
      wakeInput.value = pad(now.getHours()) + ':' + pad(now.getMinutes());
    }
    if (!nextWakeInput.value) {
      nextWakeInput.value = '07:00';
    }
    showScreen('screenStart');
  }

  /* ── Block View ── */
  function renderBlockView () {
    if (!todaySchedule || !dayState) { renderStartScreen(); return; }

    const idx = dayState.currentBlockIndex;
    if (idx >= todaySchedule.length) {
      renderDayComplete();
      return;
    }

    const block = todaySchedule[idx];
    const isEnrichment = block.isEnrichment || block.type === 'enrichment';
    const card = $('focusCard');
    card.className = 'focus-card' + (isEnrichment ? ' enrichment' : '');

    $('blockEmoji').textContent = block.emoji;
    $('blockName').textContent = block.name;
    $('blockTimeRange').textContent = fmtTime(new Date(block.start)) + ' – ' + fmtTime(new Date(block.end)) + '  ·  ' + fmtDuration(block.duration);

    // Start timer if block is active
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

  function completeBlock () {
    if (!dayState || !dayState.blockStartedAt) return;
    clearInterval(timerInterval);

    const block = todaySchedule[dayState.currentBlockIndex];
    const elapsed = (Date.now() - new Date(dayState.blockStartedAt).getTime()) / 60000;
    recordBlockCompletion(block.id, elapsed);

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
    $('focusCard').innerHTML = '<div class="day-complete"><div class="dc-emoji">🎉</div><div class="dc-title">Day Complete!</div><p class="dc-sub">Great work today. Rest well.</p><button class="btn btn-secondary" onclick="window.DayOS.resetDay()">Start New Day</button></div>';
    $('blockEmoji').textContent = '';
    $('blockName').textContent = '';
    $('blockTimeRange').textContent = '';
    $('timerDisplay').textContent = '';
    $('timerLabelEl').textContent = '';
    $('btnDone').classList.add('hidden');
    showScreen('screenBlock');
  }

  /* ── Full Day View ── */
  function renderFullDay () {
    if (!todaySchedule) return;
    const list = $('fullDayList');
    list.innerHTML = '';

    todaySchedule.forEach((block, i) => {
      // Transition buffer (visual only)
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

      li.innerHTML =
        '<span class="item-emoji">' + block.emoji + '</span>' +
        '<div class="item-info"><div class="item-name">' + block.name + '</div>' +
        '<div class="item-time">' + fmtTime(new Date(block.start)) + ' – ' + fmtTime(new Date(block.end)) + '</div></div>' +
        '<span class="item-dur">' + fmtDuration(block.duration) + '</span>';

      list.appendChild(li);
    });

    showScreen('screenFull');
  }

  /* ── Settings Screen ── */
  function renderSettings () {
    renderNonNegotiables();
    renderOptionalPriorities();
    renderEnrichmentPool();
    renderFixedEvents();
    renderHistory();
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
        '<span class="nn-name">' + nn.name + '</span>' +
        '<div class="nn-detail">' + nn.energy + ' energy</div>' +
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
        '<span class="nn-name">' + op.name + '</span>' +
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
        '<span class="ei-name">' + e.name + '</span>' +
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

    profile.enrichmentPool.push({
      id: 'e' + Date.now(),
      name, emoji, category, duration
    });
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
        '<div class="fe-info"><span class="fe-day">' + ev.day + '</span> <span class="fe-time">' + ev.start + ' – ' + ev.end + '</span><div class="fe-name">' + ev.name + '</div></div>' +
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

    profile.fixedEvents.push({
      id: 'fe' + Date.now(),
      name, day, start, end
    });
    save('dayos_profile', profile);
    $('newEventName').value = '';
    $('newEventStart').value = '';
    $('newEventEnd').value = '';
    renderFixedEvents();
  }

  function renderHistory () {
    const container = $('historyList');
    container.innerHTML = '';
    const allActivities = [...profile.nonNegotiables, ...profile.optionalPriorities];
    allActivities.forEach(act => {
      const hist = activityHistory[act.id];
      if (!hist || hist.length === 0) return;
      const avg = Math.round(hist.slice(-ROLLING_WINDOW).reduce((s, v) => s + v, 0) / Math.min(hist.length, ROLLING_WINDOW));
      const isLearned = hist.length >= ROLLING_THRESHOLD;
      const div = document.createElement('div');
      div.className = 'history-activity';
      div.innerHTML =
        '<div class="ha-name">' + act.emoji + ' ' + act.name + '</div>' +
        '<div class="ha-stats">' +
          hist.length + ' sessions · avg ' + fmtDuration(avg) +
          (isLearned ? ' · <span style="color:#6c63ff">learned</span>' : ' · ' + (ROLLING_THRESHOLD - hist.length) + ' more to learn') +
          ' · default ' + fmtDuration(act.defaultDuration) +
        '</div>' +
        '<div class="history-bar"><div class="history-bar-fill" style="width:' + Math.min(100, (hist.length / ROLLING_THRESHOLD) * 100) + '%"></div></div>';
      container.appendChild(div);
    });
    // Enrichment history
    profile.enrichmentPool.forEach(e => {
      const hist = activityHistory[e.id];
      if (!hist || hist.length === 0) return;
      const avg = Math.round(hist.reduce((s, v) => s + v, 0) / hist.length);
      const div = document.createElement('div');
      div.className = 'history-activity';
      div.innerHTML =
        '<div class="ha-name">' + e.emoji + ' ' + e.name + '</div>' +
        '<div class="ha-stats">' + hist.length + ' sessions · avg ' + fmtDuration(avg) + '</div>';
      container.appendChild(div);
    });
    if (container.children.length === 0) {
      container.innerHTML = '<p style="color:#555;font-size:0.9rem;">No activity history yet. Complete blocks to see your data here.</p>';
    }
  }

  /* ── Reset Day ── */
  function resetDay () {
    clearInterval(timerInterval);
    todaySchedule = null;
    dayState = null;
    windDownNotified = false;
    localStorage.removeItem('dayos_schedule');
    localStorage.removeItem('dayos_daystate');
    const banner = document.getElementById('windDownBanner');
    if (banner) banner.remove();
    $('btnDone').classList.remove('hidden');
    $('timerLabelEl').textContent = 'ELAPSED';
    renderStartScreen();
  }

  /* ── Reset All Data ── */
  function resetAll () {
    if (!confirm('This will erase ALL your DayOS data including activity history and profile. Continue?')) return;
    clearInterval(timerInterval);
    localStorage.removeItem('dayos_profile');
    localStorage.removeItem('dayos_schedule');
    localStorage.removeItem('dayos_daystate');
    localStorage.removeItem('dayos_history');
    localStorage.removeItem('dayos_gymweek');
    profile = defaultProfile();
    todaySchedule = null;
    dayState = null;
    activityHistory = {};
    gymWeekLog = { week: currentWeekId(), count: 0 };
    windDownNotified = false;
    renderStartScreen();
  }

  /* ── Build Day Action ── */
  function buildMyDay () {
    const wakeStr = $('inputWake').value;
    const nextWakeStr = $('inputNextWake').value;
    if (!wakeStr || !nextWakeStr) return;

    // Read mood
    let mood = null;
    const activeMood = document.querySelector('.mood-btn.active');
    if (activeMood) mood = activeMood.dataset.mood;

    requestNotifPermission();

    const result = buildSchedule(wakeStr, nextWakeStr, mood);
    todaySchedule = result.blocks;
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

    save('dayos_schedule', todaySchedule);
    save('dayos_daystate', dayState);
    renderBlockView();
  }

  /* ── Init ── */
  function init () {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Mood buttons
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
        if (this.classList.contains('active')) {
          this.classList.remove('active');
        } else {
          this.classList.add('active');
        }
      });
    });

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
    $('navSettings').addEventListener('click', () => renderSettings());

    // Actions
    $('btnBuildDay').addEventListener('click', buildMyDay);
    $('btnDone').addEventListener('click', completeBlock);
    $('btnSeeFullDay').addEventListener('click', renderFullDay);
    $('btnRecalculate').addEventListener('click', recalculateFromNow);
    $('btnBackToCurrent').addEventListener('click', () => renderBlockView());
    $('btnAddEnrichment').addEventListener('click', addEnrichmentItem);
    $('btnAddFixedEvent').addEventListener('click', addFixedEvent);
    $('btnResetAll').addEventListener('click', resetAll);

    // Check if there's an active day
    if (todaySchedule && dayState) {
      // Check if built today
      const builtDate = dayState.built ? new Date(dayState.built).toDateString() : '';
      if (builtDate === new Date().toDateString()) {
        renderBlockView();
      } else {
        resetDay();
      }
    } else {
      renderStartScreen();
    }

    // Periodic wind-down check
    setInterval(checkWindDown, 30000);
  }

  // Expose for inline handlers
  window.DayOS = { resetDay };

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
