// Verlauf: Monatskalender, Tagesliste und Editor zum Korrigieren/Nachtragen eines Tages.

import { state, emptyDay, putDay, removeDay } from './store.js';
import { ABSENCES, dayResult, sumRange, validateDay } from './calc.js';
import { keyOf, monthOf, monthRange, addMonths, eachDay, weekdayOf, clock, tsAt, fmtDuration, fmtBalance, fmtMonth, fmtDate, WEEKDAYS_SHORT } from './time.js';
import { esc, toast, vibrate, openModal, closeModal, confirmDialog, saveFile, ICONS } from './ui-common.js';
import { buildCsv } from './export.js';

let root = null;
let month = null;

const tone = (min) => (min > 0 ? 'plus' : min < 0 ? 'minus' : 'even');
const shortBalance = (min) => (min === 0 ? '±0' : fmtBalance(min));

export function mountHistory(container) {
  root = container;
  root.addEventListener('click', onClick);
}

export function renderHistory() {
  if (!root || !state.settings) return;
  const now = Date.now();
  const today = keyOf(now);
  month ??= monthOf(today);
  const [from, to] = monthRange(month);
  const results = eachDay(from, to).map((k) => dayResult(k, state.days[k], state.settings, now));
  const sum = sumRange(from, to, state.days, state.settings, now);
  const lead = (weekdayOf(from) + 6) % 7; // Montag = erste Spalte
  const isCurrent = month === monthOf(today);
  const running = results.some((r) => r.isToday && r.ev.open);

  root.innerHTML = `
    <header class="view-head">
      <button type="button" class="icon-btn" data-action="prev" aria-label="Vorheriger Monat">${ICONS.left}</button>
      <h1>${fmtMonth(month)}</h1>
      <button type="button" class="icon-btn" data-action="next" aria-label="Nächster Monat">${ICONS.right}</button>
    </header>
    ${isCurrent ? '' : '<button type="button" class="link-btn center" data-action="current">Zum aktuellen Monat</button>'}
    <section class="month-sum">
      <div><span>Soll</span><b>${fmtDuration(sum.target)}</b></div>
      <div><span>Ist</span><b>${fmtDuration(sum.actual)}</b></div>
      <div><span>Saldo</span><b class="${tone(sum.balance)}">${fmtBalance(sum.balance)}</b></div>
    </section>
    <p class="note center">${month > monthOf(today) ? 'Zukünftiger Monat' : `Stand bis heute${running ? ', ohne den laufenden Tag' : ''}`}${sum.missing ? ` · ${sum.missing} Tag${sum.missing === 1 ? '' : 'e'} ohne Eintrag` : ''}</p>
    <div class="calendar" role="grid">
      ${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<div class="cal-head">${d}</div>`).join('')}
      ${'<div></div>'.repeat(lead)}
      ${results.map(cellHtml).join('')}
    </div>
    <div class="legend">
      <span><i class="dot plus"></i>Plus</span><span><i class="dot minus"></i>Minus</span>
      <span><i class="dot holiday"></i>F Feiertag</span><span><i class="dot absence"></i>U/K/G Abwesend</span>
      <span><i class="dot missing"></i>? fehlt</span>
    </div>
    <ul class="day-list">${results.map(rowHtml).join('')}</ul>
    <button type="button" class="btn btn-secondary btn-block" data-action="csv">CSV für ${fmtMonth(month)} speichern</button>`;
}

function cellHtml(r) {
  let cls = '';
  let text = '';
  if (r.absence) {
    cls = 'absence';
    text = { urlaub: 'U', krank: 'K', gleittag: 'G' }[r.absence];
  } else if (r.incomplete || r.missing) {
    cls = 'missing';
    text = '?';
  } else if (r.ev.hasTimes && r.isToday && r.ev.open) {
    cls = 'running';
    text = '•••';
  } else if (r.ev.hasTimes && r.counts) {
    cls = tone(r.balance);
    text = shortBalance(r.balance);
  } else if (r.holiday) {
    cls = 'holiday';
    text = 'F';
  } else if (r.weekend) {
    cls = 'weekend';
  }
  if (r.isToday) cls += ' today';
  if (r.isFuture) cls += ' future';
  return `<button type="button" class="cal-cell ${cls}" data-day="${r.key}" aria-label="${fmtDate(r.key)}">
    <span class="cal-num">${Number(r.key.slice(8))}</span><span class="cal-info">${text}</span></button>`;
}

function rowHtml(r) {
  const d = state.days[r.key];
  const tags = [];
  if (r.holiday) tags.push(`<span class="tag tag-holiday">${esc(r.holiday)}</span>`);
  if (r.absence) tags.push(`<span class="tag tag-absence">${ABSENCES[r.absence]}</span>`);
  if (r.missing) tags.push('<span class="tag tag-missing">fehlt</span>');
  if (r.incomplete) tags.push('<span class="tag tag-missing">Gehen fehlt</span>');
  if (r.beforeStart && d) tags.push('<span class="tag">vor Startdatum</span>');
  if (d?.note) tags.push(`<span class="tag tag-note">${esc(d.note)}</span>`);
  const times = r.ev.hasTimes
    ? `<span class="day-row-times">${clock(d.checkIn)}–${d.checkOut != null ? clock(d.checkOut) : '…'} · P ${fmtDuration(r.ev.actualPause)}${r.ev.autoPause ? ` +${r.ev.autoPause}′` : ''}</span>`
    : '';
  const off = !d && (r.weekend || r.holiday);
  const bal = r.counts && !off ? fmtBalance(r.balance) : r.isToday && r.ev.open ? 'läuft' : '';
  const cls = ['day-row', r.isToday ? 'is-today' : '', off ? 'is-off' : '', r.isFuture ? 'is-future' : ''].join(' ');
  return `<li><button type="button" class="${cls}" data-day="${r.key}">
    <span class="day-row-date"><b>${WEEKDAYS_SHORT[weekdayOf(r.key)]}</b> ${r.key.slice(8)}.${r.key.slice(5, 7)}.</span>
    <span class="day-row-main">${times}${tags.join('')}</span>
    <span class="day-row-net">${r.ev.hasTimes ? fmtDuration(r.net) : ''}</span>
    <span class="day-row-bal ${r.counts ? tone(r.balance) : ''}">${bal}</span>
  </button></li>`;
}

function onClick(event) {
  const dayBtn = event.target.closest('[data-day]');
  if (dayBtn) return openDayEditor(dayBtn.dataset.day);
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'prev') month = addMonths(month, -1);
  else if (action === 'next') month = addMonths(month, 1);
  else if (action === 'current') month = monthOf(keyOf(Date.now()));
  else if (action === 'csv') {
    const [from, to] = monthRange(month);
    saveFile(`arbeitszeit-${month}.csv`, buildCsv(from, to, state.days, state.settings, Date.now()), 'text/csv;charset=utf-8');
    toast('CSV gespeichert (Ordner „Downloads“)');
    return;
  } else return;
  renderHistory();
  window.scrollTo({ top: 0 });
}

// ---------- Tages-Editor ----------

/** Wandelt "HH:MM" in einen Zeitstempel um; unveränderte Zeiten behalten ihren Originalwert. */
function toTs(key, text, original) {
  if (!text) return null;
  if (original != null && keyOf(original) === key && clock(original) === text) return original;
  return tsAt(key, text);
}

export function openDayEditor(key) {
  const dlg = document.getElementById('day-dialog');
  const orig = state.days[key] ? structuredClone(state.days[key]) : null;
  const src = orig ?? emptyDay(key);
  const isToday = key === keyOf(Date.now());
  const isFuture = key > keyOf(Date.now());
  const form = {
    absence: src.absence || '',
    in: src.checkIn != null ? clock(src.checkIn) : '',
    out: src.checkOut != null ? clock(src.checkOut) : '',
    pauses: [...src.pauses]
      .sort((a, b) => a.start - b.start)
      .map((p) => ({ s: clock(p.start), e: p.end != null ? clock(p.end) : '', os: p.start, oe: p.end })),
    note: src.note || '',
  };
  let showErrors = false;

  const buildDay = () => ({
    ...src,
    absence: form.absence || null,
    checkIn: toTs(key, form.in, src.checkIn),
    checkOut: toTs(key, form.out, src.checkOut),
    pauses: form.pauses.filter((p) => p.s || p.e).map((p) => ({ start: toTs(key, p.s, p.os), end: toTs(key, p.e, p.oe) })),
    note: form.note.trim(),
  });

  const r0 = dayResult(key, src, state.settings, Date.now());
  const info = [
    r0.holiday ? `${esc(r0.holiday)} · kein Soll` : r0.target > 0 ? `Soll ${fmtDuration(r0.target)} h` : r0.weekend ? 'Wochenende · kein Soll' : 'Kein Soll',
    r0.beforeStart ? 'vor dem Startdatum – zählt nicht zum Saldo' : '',
  ].filter(Boolean);

  dlg.innerHTML = `
    <form class="sheet" novalidate>
      <header class="sheet-head">
        <button type="button" class="icon-btn" data-act="close" aria-label="Schließen">${ICONS.close}</button>
        <h2>${fmtDate(key)}</h2>
        <button type="submit" class="btn btn-primary btn-small">Speichern</button>
      </header>
      <div class="sheet-body">
        <p class="note">${info.join(' · ')}</p>
        <fieldset class="field">
          <legend>Abwesenheit</legend>
          <div class="seg">
            ${[['', 'Keine'], ...Object.entries(ABSENCES)]
              .map(([v, l]) => `<label class="seg-item"><input type="radio" name="absence" value="${v}" ${form.absence === v ? 'checked' : ''}><span>${l}</span></label>`)
              .join('')}
          </div>
          <p class="hint">Urlaub/Krank: Soll gilt als erfüllt (±0). Gleittag: volles Tagessoll wird abgezogen.</p>
        </fieldset>
        ${
          isFuture
            ? '<p class="hint">Für zukünftige Tage kannst du nur Abwesenheiten eintragen.</p>'
            : `<div class="grid2">
          <label class="field"><span>Kommen</span><input type="time" name="in" value="${form.in}"></label>
          <label class="field"><span>Gehen</span><input type="time" name="out" value="${form.out}"></label>
        </div>
        ${isToday ? '<p class="hint">„Gehen“ leer lassen = noch eingecheckt. Leeres Pausenende = Pause läuft.</p>' : ''}
        <div class="field">
          <span class="field-label">Pausen</span>
          <div class="pause-rows" data-el="pauses"></div>
          <button type="button" class="btn btn-secondary btn-block" data-act="add-pause">${ICONS.plus}<span>Pause hinzufügen</span></button>
        </div>`
        }
        <label class="field"><span>Notiz</span><input type="text" name="note" maxlength="200" placeholder="optional" value="${esc(form.note)}"></label>
        <div class="preview" data-el="preview"></div>
        <ul class="errors" data-el="errors"></ul>
        ${orig ? '<button type="button" class="btn btn-danger-outline btn-block" data-act="delete">Tag löschen</button>' : ''}
      </div>
    </form>`;

  const pausesEl = dlg.querySelector('[data-el="pauses"]');
  const previewEl = dlg.querySelector('[data-el="preview"]');
  const errorsEl = dlg.querySelector('[data-el="errors"]');

  function renderPauses() {
    if (!pausesEl) return;
    pausesEl.innerHTML = form.pauses.length
      ? form.pauses
          .map(
            (p, i) => `<div class="pause-row" data-i="${i}">
              <input type="time" data-field="s" value="${p.s}" aria-label="Pause ${i + 1} Beginn">
              <span class="pause-dash">–</span>
              <input type="time" data-field="e" value="${p.e}" aria-label="Pause ${i + 1} Ende">
              <button type="button" class="icon-btn" data-act="del-pause" data-i="${i}" aria-label="Pause ${i + 1} löschen">${ICONS.trash}</button>
            </div>`,
          )
          .join('')
      : '<p class="hint">Keine Pausen erfasst.</p>';
  }

  function refresh() {
    const day = buildDay();
    const now = Date.now();
    const r = dayResult(key, day, state.settings, now);
    const ev = r.ev;
    const credited = day.absence === 'urlaub' || day.absence === 'krank';
    previewEl.innerHTML =
      ev.hasTimes || day.absence
        ? `<div class="pv"><span>Anwesenheit</span><b>${fmtDuration(ev.presence)}</b></div>
           <div class="pv"><span>Pause</span><b>${fmtDuration(ev.actualPause)}${ev.autoPause ? ` + ${ev.autoPause} Min. autom.` : ''}</b></div>
           <div class="pv"><span>Netto</span><b>${fmtDuration(r.net)}</b></div>
           <div class="pv"><span>Soll</span><b>${fmtDuration(r.target)}</b></div>
           <div class="pv"><span>Saldo</span><b class="${tone(r.balance)}">${fmtBalance(r.balance)}</b></div>
           ${ev.shortBlocks ? '<p class="hint">Pausen unter 15 Min. zählen nicht zur Mindestpause.</p>' : ''}
           ${credited && ev.hasTimes ? '<p class="hint">Bei Urlaub/Krank werden erfasste Zeiten nicht angerechnet.</p>' : ''}`
        : '';
    const errors = validateDay(day, now);
    errorsEl.innerHTML = showErrors ? errors.map((e) => `<li>${esc(e)}</li>`).join('') : '';
    return errors;
  }

  dlg.oninput = (event) => {
    const t = event.target;
    if (t.name === 'absence') form.absence = t.value;
    else if (t.name === 'in' || t.name === 'out' || t.name === 'note') form[t.name] = t.value;
    else if (t.dataset.field) form.pauses[Number(t.closest('.pause-row').dataset.i)][t.dataset.field] = t.value;
    refresh();
  };

  dlg.onclick = async (event) => {
    const act = event.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'close') closeModal(dlg);
    if (act.dataset.act === 'add-pause') {
      form.pauses.push({ s: '', e: '', os: null, oe: null });
      renderPauses();
      refresh();
      pausesEl.querySelector('.pause-row:last-child input')?.focus();
    }
    if (act.dataset.act === 'del-pause') {
      form.pauses.splice(Number(act.dataset.i), 1);
      renderPauses();
      refresh();
    }
    if (act.dataset.act === 'delete') {
      const ok = await confirmDialog({ title: 'Tag löschen?', text: `Alle Einträge vom ${fmtDate(key)} werden gelöscht.`, ok: 'Löschen', danger: true });
      if (!ok) return;
      await removeDay(key);
      closeModal(dlg);
      toast('Tag gelöscht', { action: { label: 'Rückgängig', run: () => putDay(orig) } });
    }
  };

  dlg.onsubmit = async (event) => {
    event.preventDefault();
    showErrors = true;
    if (refresh().length) {
      vibrate([60, 40, 60]);
      errorsEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    await putDay(buildDay());
    closeModal(dlg);
    toast(`${fmtDate(key)} gespeichert`, { action: { label: 'Rückgängig', run: () => (orig ? putDay(orig) : removeDay(key)) } });
  };

  renderPauses();
  refresh();
  openModal(dlg);
}
