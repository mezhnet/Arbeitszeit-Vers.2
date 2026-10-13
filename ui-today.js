// Hauptbildschirm „Heute“: Feierabend, Live-Werte, Warnungen und die zwei großen Buttons.
// Das Gerüst wird einmal aufgebaut; jede Sekunde werden nur Texte aktualisiert,
// damit Buttons beim Antippen nie ausgetauscht werden.

import { state, getDay, emptyDay, putDay, removeDay } from './store.js';
import { RULES, ABSENCES, dayResult, computeEnd, getWarnings, totals } from './calc.js';
import { keyOf, clock, toMinutes, fmtDuration, fmtBalance, fmtStopwatch, fmtDateLong, fmtDate, MS_PER_MIN } from './time.js';
import { esc, toast, vibrate, confirmDialog, ICONS } from './ui-common.js';
import { openDayEditor } from './ui-history.js';

let root = null;
let navigate = () => {};
const el = {};
const last = {};
let busyUntil = 0;
let totalsCache = { key: '', value: null };
const seenWarnings = new Set();

export function mountToday(container, { goTo }) {
  root = container;
  navigate = goTo;
  root.innerHTML = `
    <div class="today-scroll">
    <header class="today-head">
      <div>
        <h1 class="today-date" data-el="date"></h1>
        <div class="today-target" data-el="target"></div>
      </div>
      <button type="button" class="icon-btn" data-action="edit-today" aria-label="Heute bearbeiten">${ICONS.edit}</button>
    </header>
    <div class="stack" data-el="banners"></div>
    <section class="hero" data-el="hero" aria-live="polite">
      <div class="hero-label" data-el="heroLabel"></div>
      <div class="hero-value" data-el="heroValue"></div>
      <div class="hero-sub" data-el="heroSub"></div>
    </section>
    <div class="stack" data-el="warnings"></div>
    <section class="stats">
      <div class="stat"><div class="stat-label">Netto heute</div><div class="stat-value" data-el="net"></div><div class="stat-sub" data-el="netSub"></div></div>
      <div class="stat"><div class="stat-label">Pause</div><div class="stat-value" data-el="pause"></div><div class="stat-sub" data-el="pauseSub"></div></div>
      <div class="stat"><div class="stat-label">Saldo heute</div><div class="stat-value" data-el="bal"></div><div class="stat-sub" data-el="balSub"></div></div>
    </section>
    <section class="totals">
      <div class="total"><div class="total-label">Woche</div><div class="total-value" data-el="week"></div></div>
      <div class="total"><div class="total-label">Monat</div><div class="total-value" data-el="month"></div></div>
      <div class="total total-main"><div class="total-label">Gleitzeit gesamt</div><div class="total-value" data-el="total"></div></div>
    </section>
    <p class="note" data-el="totalsNote"></p>
    </div>
    <div class="actions">
      <div class="pause-live" data-el="pauseLive" hidden>
        <span class="pause-live-icon">${ICONS.coffee}</span>
        <span class="pause-live-clock" data-el="pauseClock"></span>
        <span class="pause-live-text" data-el="pauseText"></span>
      </div>
      <button type="button" class="btn-big" data-action="pause" data-el="pauseBtn">
        <span class="btn-big-label" data-el="pauseLabel"></span>
        <span class="btn-big-sub" data-el="pauseSub2"></span>
      </button>
      <button type="button" class="btn-big" data-action="main" data-el="mainBtn">
        <span class="btn-big-label" data-el="mainLabel"></span>
        <span class="btn-big-sub" data-el="mainSub"></span>
      </button>
    </div>`;
  root.querySelectorAll('[data-el]').forEach((node) => (el[node.dataset.el] = node));
  root.addEventListener('click', onClick);
}

// ---------- kleine DOM-Helfer (ändern nur, wenn sich etwas geändert hat) ----------

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function setClass(node, cls) {
  if (node.className !== cls) node.className = cls;
}

function setHtml(name, node, html) {
  if (last[name] !== html) {
    node.innerHTML = html;
    last[name] = html;
  }
}

const tone = (min) => (min > 0 ? 'plus' : min < 0 ? 'minus' : 'even');

function setBalance(node, min, base) {
  setText(node, fmtBalance(min));
  setClass(node, `${base} ${tone(min)}`);
}

function alertHtml({ level, title, text, detail, button }) {
  return `<div class="alert alert-${level}${text ? '' : ' alert-compact'}" role="${level === 'info' ? 'status' : 'alert'}">
    <div class="alert-icon">${level === 'info' ? ICONS.info : ICONS.alert}</div>
    <div class="alert-body">
      <div class="alert-title">${esc(title)}</div>
      ${text ? `<div class="alert-text">${esc(text)}</div>` : ''}
      ${detail ? `<div class="alert-detail">${esc(detail)}</div>` : ''}
    </div>
    ${button || ''}
  </div>`;
}

// ---------- Aktualisierung ----------

export function updateToday() {
  if (!root || !state.settings) return;
  const now = Date.now();
  const key = keyOf(now);
  const day = getDay(key);
  const r = dayResult(key, day, state.settings, now);
  const ev = r.ev;
  const status = !ev.hasTimes ? 'idle' : ev.open ? (ev.pauseRunning ? 'pause' : 'work') : 'done';

  const cacheKey = `${state.version}|${toMinutes(now)}`;
  if (totalsCache.key !== cacheKey) totalsCache = { key: cacheKey, value: totals(state.days, state.settings, now) };
  const t = totalsCache.value;

  setText(el.date, fmtDateLong(key));
  setText(el.target, targetLine(r));
  renderBanners(key, t);
  renderHero(r, day, status, now);
  renderWarnings(day, r, status, now);
  renderStats(r, day, status);

  setBalance(el.week, t.week, 'total-value');
  setBalance(el.month, t.month, 'total-value');
  setBalance(el.total, t.total, 'total-value');
  setText(el.totalsNote, !t.todayCounted && (status === 'work' || status === 'pause') ? 'Heute wird nach dem Auschecken in Woche, Monat und Gesamt eingerechnet.' : '');

  renderButtons(day, r, status, now);
}

function targetLine(r) {
  if (r.absence === 'gleittag') return `Gleittag · Soll ${fmtDuration(r.target)} h`;
  if (r.absence) return `${ABSENCES[r.absence]} · Soll gilt als erfüllt`;
  if (r.holiday) return `${r.holiday} · kein Soll`;
  if (r.target <= 0) return r.weekend ? 'Wochenende · kein Soll' : 'Kein Soll';
  return `Soll heute ${fmtDuration(r.target)} h`;
}

function renderBanners(key, t) {
  const open = Object.values(state.days)
    .filter((d) => d.date < key && d.checkIn != null && d.checkOut == null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  let html = open
    .map((d) =>
      alertHtml({
        level: 'danger',
        title: `Gehen-Zeit fehlt: ${fmtDate(d.date)}`,
        button: `<button type="button" class="btn btn-small" data-action="open-day" data-day="${d.date}">Nachtragen</button>`,
      }),
    )
    .join('');
  if (t.missing > 0) {
    html += alertHtml({
      level: 'info',
      title: t.missing === 1 ? '1 Arbeitstag ohne Eintrag (zählt als Minus)' : `${t.missing} Arbeitstage ohne Eintrag (zählen als Minus)`,
      button: '<button type="button" class="btn btn-small" data-action="goto-history">Ansehen</button>',
    });
  }
  setHtml('banners', el.banners, html);
}

function renderHero(r, day, status, now) {
  let label = '';
  let value = '';
  let sub = '';
  let mood = '';
  if (status === 'done') {
    label = 'Ausgecheckt um';
    value = clock(day.checkOut);
    sub = `Netto ${fmtDuration(r.net)} h · Saldo ${fmtBalance(r.balance)}`;
    mood = 'done';
  } else if (r.absence && status === 'idle') {
    label = 'Heute';
    value = ABSENCES[r.absence];
    sub = r.absence === 'gleittag' ? `${fmtBalance(r.balance)} vom Gleitzeitkonto` : 'Soll gilt als erfüllt';
    mood = 'off';
  } else if (r.target <= 0) {
    label = r.holiday ? 'Feiertag' : 'Kein Soll heute';
    value = status === 'idle' ? 'Frei' : fmtDuration(r.net);
    sub = status === 'idle' ? r.holiday || 'Wochenende' : 'Jede Minute zählt als Plus';
    mood = 'off';
  } else if (status === 'idle') {
    const e = computeEnd({ checkIn: now, checkOut: null, pauses: [] }, r.target, now);
    label = 'Feierabend um';
    value = e ? clock(e.end) : '—';
    sub = 'wenn du jetzt eincheckst';
    mood = 'idle';
  } else {
    const e = computeEnd(day, r.target, now);
    if (e?.reached) {
      label = 'Tagessoll erreicht';
      value = 'Feierabend';
      sub = `Saldo heute ${fmtBalance(r.balance)}`;
      mood = 'reached';
    } else if (e) {
      label = 'Feierabend um';
      value = clock(e.end);
      sub = `noch ${fmtDuration(toMinutes(e.end) - toMinutes(now))} h`;
      if (e.pauseUntil) sub += ` · Pause bis mind. ${clock(e.pauseUntil)}`;
      mood = 'work';
    } else {
      label = 'Feierabend';
      value = '—';
    }
  }
  setText(el.heroLabel, label);
  setText(el.heroValue, value);
  setText(el.heroSub, sub);
  const isWord = !/^[\d—]/.test(value); // Wörter wie „Urlaub“ etwas kleiner als Uhrzeiten
  setClass(el.hero, `hero hero-${mood}${isWord ? ' hero-word' : ''}`);
}

function warningView(w) {
  switch (w.type) {
    case 'six-pre':
      return {
        level: 'warn',
        title: w.minutesLeft ? `In ${w.minutesLeft} Min. erreichst du 6:00 h` : 'Jetzt sind 6:00 h erreicht',
        text: `Jetzt gehen oder bis mindestens ${fmtDuration(w.stayPresence)} h Anwesenheit bleiben – dazwischen verlierst du Zeit.`,
        detail: `Gehen bis ${clock(w.leaveBy)} ohne Abzug · sonst bis mindestens ${clock(w.stayUntil)} bleiben`,
      };
    case 'six-loss':
      return {
        level: 'warn',
        title: 'Du verlierst gerade Zeit',
        text: `Seit ${clock(w.since)} werden ${Math.round((w.stayUntil - w.since) / MS_PER_MIN)} Min. Pause automatisch abgezogen. Bleib bis mindestens ${clock(w.stayUntil)} (${fmtDuration(w.stayPresence)} h Anwesenheit).`,
      };
    case 'nine-pre':
      return {
        level: 'warn',
        title: w.minutesLeft ? `In ${w.minutesLeft} Min. erreichst du 9:00 h` : 'Jetzt sind 9:00 h erreicht',
        text: `Ab dann gelten 45 Min. Pause (§ 4 ArbZG) – es werden ${w.extra} Min. zusätzlich abgezogen.`,
        detail: `Jetzt gehen (bis ${clock(w.leaveBy)}) oder bis mindestens ${clock(w.stayUntil)} bleiben`,
      };
    case 'nine-loss':
      return {
        level: 'warn',
        title: 'Jetzt gelten 45 Min. Pause',
        text: `Seit ${clock(w.since)} werden ${w.extra} Min. zusätzlich abgezogen. Bleib bis mindestens ${clock(w.stayUntil)}, sonst verlierst du Zeit.`,
      };
    case 'max-pre':
      return {
        level: 'danger',
        title: 'Höchstarbeitszeit naht',
        text: `In ${w.minutesLeft} Min. erreichst du die gesetzliche Höchstarbeitszeit von 10 Stunden (§ 3 ArbZG).`,
      };
    case 'max-reached':
      return {
        level: 'danger',
        title: 'Höchstarbeitszeit erreicht',
        text: '10 Stunden Arbeitszeit sind erreicht (§ 3 ArbZG). Bitte jetzt auschecken.',
      };
    default:
      return null;
  }
}

function renderWarnings(day, r, status, now) {
  const items = [];
  if (status === 'work' || status === 'pause') {
    for (const w of getWarnings(day, r.target, now)) {
      const view = warningView(w);
      if (view) items.push({ id: w.type, ...view });
    }
  }
  if (r.ev.shortBlocks > 0) {
    items.push({ id: 'short', level: 'info', title: 'Kurze Pause', text: 'Pausen unter 15 Min. werden abgezogen, zählen aber nicht zur gesetzlichen Mindestpause.' });
  }
  setHtml('warnings', el.warnings, items.map(alertHtml).join(''));
  // Neue Warnung → kurz vibrieren (einmal pro Tag und Warnungsart)
  for (const w of items) {
    const id = `${keyOf(now)}:${w.id}`;
    if (w.level !== 'info' && !seenWarnings.has(id)) {
      seenWarnings.add(id);
      if (!document.hidden) vibrate([200, 100, 200]);
    }
  }
}

function renderStats(r, day, status) {
  const ev = r.ev;
  setText(el.net, fmtDuration(ev.hasTimes ? r.net : 0));
  setText(el.netSub, status === 'done' ? `${clock(day.checkIn)}–${clock(day.checkOut)}` : status === 'idle' ? '' : `seit ${clock(day.checkIn)}`);

  setText(el.pause, fmtDuration(ev.actualPause));
  let pauseSub = '';
  if (ev.autoPause > 0) pauseSub = `+${ev.autoPause} Min. automatisch`;
  else if ((status === 'work' || status === 'pause') && r.target > RULES.firstLimit && ev.qualifyingPause < RULES.firstBreak) {
    pauseSub = `Pflichtpause: noch ${RULES.firstBreak - ev.qualifyingPause} Min.`;
  } else if (ev.qualifyingPause >= RULES.firstBreak) pauseSub = 'Mindestpause ✓';
  setText(el.pauseSub, pauseSub);

  if (status === 'idle' && !r.absence) {
    setText(el.bal, '—');
    setClass(el.bal, 'stat-value');
  } else {
    setBalance(el.bal, r.balance, 'stat-value');
  }
  setText(el.balSub, status === 'work' || status === 'pause' ? 'wenn du jetzt gehst' : '');
}

function renderButtons(day, r, status, now) {
  if (status === 'idle') {
    setText(el.mainLabel, 'Einchecken');
    setText(el.mainSub, '');
    setClass(el.mainBtn, 'btn-big btn-go');
  } else if (status === 'done') {
    setText(el.mainLabel, 'Wieder einchecken');
    setText(el.mainSub, `ausgecheckt um ${clock(day.checkOut)}`);
    setClass(el.mainBtn, 'btn-big btn-go-soft');
  } else {
    setText(el.mainLabel, 'Auschecken');
    setText(el.mainSub, `eingecheckt seit ${clock(day.checkIn)}`);
    setClass(el.mainBtn, 'btn-big btn-stop');
  }

  if (status === 'pause') {
    const p = r.ev.runningPause;
    const minutes = toMinutes(now) - toMinutes(p.start);
    setText(el.pauseLabel, 'Pause beenden');
    setText(el.pauseSub2, `läuft seit ${clock(p.start)}`);
    setClass(el.pauseBtn, 'btn-big btn-pause-active');
    el.pauseLive.hidden = false;
    setText(el.pauseClock, fmtStopwatch((now - p.start) / 1000));
    setText(el.pauseText, minutes < RULES.minBlock ? 'zählt ab 15 Min. zur Mindestpause' : 'zählt zur Mindestpause ✓');
  } else {
    setText(el.pauseLabel, 'Pause starten');
    setText(el.pauseSub2, status === 'work' ? '' : 'erst nach dem Einchecken');
    setClass(el.pauseBtn, 'btn-big btn-pause');
    el.pauseLive.hidden = true;
  }
  el.pauseBtn.disabled = status !== 'work' && status !== 'pause';
}

// ---------- Aktionen ----------

async function onClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const action = btn.dataset.action;
  if (action === 'edit-today') return openDayEditor(keyOf(Date.now()));
  if (action === 'open-day') return openDayEditor(btn.dataset.day);
  if (action === 'goto-history') return navigate('history');
  // Schutz gegen versehentlichen Doppeltipp
  if (Date.now() < busyUntil) return;
  busyUntil = Date.now() + 1200;
  if (action === 'main') await onMain();
  if (action === 'pause') await onPause();
}

async function commit(before, after, message) {
  vibrate(25);
  const saving = putDay(after); // Zustand ist sofort aktualisiert, das Schreiben läuft im Hintergrund weiter
  updateToday();
  toast(message, { action: { label: 'Rückgängig', run: () => undo(after.date, before) }, duration: 7000 });
  await saving;
}

async function undo(key, before) {
  if (before) await putDay(before);
  else await removeDay(key);
  updateToday();
  toast('Rückgängig gemacht', { duration: 2000 });
}

/** Beendet eine laufende Pause. Gibt ihre Dauer in Minuten zurück (0 = verworfen) oder null. */
function closeRunningPause(day, now) {
  const p = day.pauses.find((x) => x.end == null);
  if (!p) return null;
  const minutes = toMinutes(now) - toMinutes(p.start);
  if (minutes <= 0) {
    day.pauses.splice(day.pauses.indexOf(p), 1);
    return 0;
  }
  p.end = now;
  return minutes;
}

async function onMain() {
  const now = Date.now();
  const key = keyOf(now);
  const before = getDay(key);
  const day = before ? structuredClone(before) : emptyDay(key);

  if (day.checkIn == null) {
    if (day.absence) {
      const ok = await confirmDialog({
        title: 'Trotzdem einchecken?',
        text: `Für heute ist „${ABSENCES[day.absence]}“ eingetragen. Der Eintrag wird dabei entfernt.`,
        ok: 'Einchecken',
      });
      if (!ok) return;
      day.absence = null;
    }
    day.checkIn = Date.now();
    return commit(before, day, `Eingecheckt um ${clock(day.checkIn)}`);
  }

  if (day.checkOut == null) {
    closeRunningPause(day, now);
    day.checkOut = now;
    const r = dayResult(key, day, state.settings, now);
    return commit(before, day, `Ausgecheckt um ${clock(now)} · Saldo heute ${fmtBalance(r.balance)}`);
  }

  const ok = await confirmDialog({
    title: 'Wieder einchecken?',
    text: `Du hast heute um ${clock(day.checkOut)} ausgecheckt.\nDie Zeit seitdem wird als Pause gezählt.`,
    ok: 'Weiterarbeiten',
  });
  if (!ok) return;
  const t = Date.now();
  const since = clock(day.checkOut);
  if (toMinutes(t) > toMinutes(day.checkOut)) day.pauses.push({ start: day.checkOut, end: t });
  day.checkOut = null;
  return commit(before, day, `Wieder eingecheckt – Zeit seit ${since} zählt als Pause`);
}

async function onPause() {
  const now = Date.now();
  const key = keyOf(now);
  const before = getDay(key);
  if (!before || before.checkIn == null || before.checkOut != null) return;
  const day = structuredClone(before);
  if (!day.pauses.some((p) => p.end == null)) {
    day.pauses.push({ start: now, end: null });
    return commit(before, day, `Pause gestartet um ${clock(now)}`);
  }
  const minutes = closeRunningPause(day, now);
  const message =
    minutes === 0
      ? 'Pause verworfen (kürzer als 1 Min.)'
      : minutes < RULES.minBlock
        ? `Pause beendet (${minutes} Min.) – unter 15 Min. zählt sie nicht zur Mindestpause`
        : `Pause beendet (${fmtDuration(minutes)} h)`;
  return commit(before, day, message);
}
