// „Früher gehen“: geplante Arbeitszeit für heute festlegen.
// Zeigt Feierabend, Gleitzeit-Abzug und Gleitzeit-Stand danach – wahlweise ausgehend von
// Stunden („Ich arbeite heute 6 h“) oder von einer Uhrzeit („Ich gehe um 14:00“).

import { state, getDay, emptyDay, putDay } from './store.js';
import { RULES, dayResult, totals, planEnd, netIfLeaving, bestLeaveUntil } from './calc.js';
import { keyOf, clock, tsAt, toMinutes, fmtDuration, fmtBalance } from './time.js';
import { esc, toast, vibrate, openModal, closeModal } from './ui-common.js';

const tone = (min) => (min > 0 ? 'plus' : min < 0 ? 'minus' : 'even');

/** Darf heute geplant werden? (nicht nach dem Auschecken, nicht bei Urlaub/Krank) */
export function canPlan(day) {
  if (day?.absence === 'urlaub' || day?.absence === 'krank') return false;
  return !(day?.checkIn != null && day.checkOut != null);
}

export function openPlanDialog() {
  const dlg = document.getElementById('plan-dialog');
  const now0 = Date.now();
  const key = keyOf(now0);
  const day = getDay(key);
  if (!canPlan(day)) return;
  const r = dayResult(key, day, state.settings, now0);
  const target = r.target;
  const t = totals(state.days, state.settings, now0);
  const totalBefore = t.todayCounted ? t.total - r.balance : t.total; // Stand ohne heute
  let plan = day?.plan ?? target;
  let leaveHint = '';

  const chips = [...new Set([240, 300, 360, 420, target].filter((m) => m > 0 && m <= RULES.maxWork))].sort((a, b) => a - b);

  dlg.innerHTML = `
    <form class="confirm plan" novalidate>
      <h2>Arbeitszeit für heute planen</h2>
      <p class="hint">Wie lange willst du heute arbeiten (netto)? ${target > 0 ? `Dein Soll: ${fmtDuration(target)} h.` : 'Heute gibt es kein Soll.'}</p>
      <div class="chips">
        ${chips.map((m) => `<button type="button" class="chip" data-min="${m}">${m === target ? `Soll ${fmtDuration(m)}` : `${fmtDuration(m)} h`}</button>`).join('')}
      </div>
      <div class="plan-hm">
        <input type="number" inputmode="numeric" min="0" max="10" name="h" aria-label="Stunden"><span>h</span>
        <input type="number" inputmode="numeric" min="0" max="59" name="m" aria-label="Minuten"><span>min</span>
      </div>
      <label class="field"><span>… oder gehen um</span><input type="time" name="leave"></label>
      <div class="plan-result" data-el="result"></div>
      <div class="confirm-buttons">
        <button type="button" class="btn btn-secondary" data-act="cancel">Abbrechen</button>
        <button type="submit" class="btn btn-primary">Übernehmen</button>
      </div>
      ${day?.plan != null ? '<button type="button" class="link-btn" data-act="clear">Plan löschen (wieder normales Soll)</button>' : ''}
    </form>`;

  const form = dlg.querySelector('form');
  const hEl = form.elements.h;
  const mEl = form.elements.m;
  const leaveEl = form.elements.leave;
  const resultEl = dlg.querySelector('[data-el="result"]');

  function setHm() {
    hEl.value = Math.floor(plan / 60);
    mEl.value = plan % 60;
  }

  function render({ syncLeave }) {
    const now = Date.now();
    const current = getDay(key);
    const valid = Number.isInteger(plan) && plan > 0 && plan <= RULES.maxWork;
    form.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.min) === plan));
    if (!valid) {
      resultEl.innerHTML = `<p class="errors-inline">${plan > RULES.maxWork ? 'Mehr als 10:00 h sind nicht erlaubt (§ 3 ArbZG).' : 'Bitte eine Arbeitszeit eingeben.'}</p>`;
      return false;
    }
    const e = planEnd(current, plan, now);
    if (syncLeave) leaveEl.value = e && !e.reached ? clock(e.end) : '';
    const delta = plan - target;
    const q = r.ev.qualifyingPause;
    const pauseNote =
      plan > RULES.secondLimit && q < RULES.secondBreak
        ? 'Enthält 45 Min. Pflichtpause (über 9:00 h).'
        : plan > RULES.firstLimit && q < RULES.firstBreak
          ? 'Enthält 30 Min. Pflichtpause (über 6:00 h). Bis genau 6:00 h ginge es ohne Pause.'
          : '';
    resultEl.innerHTML = `
      <div class="plan-row"><span>Feierabend</span><b>${e?.reached ? 'jetzt ✓' : e ? clock(e.end) : '—'}</b></div>
      <div class="plan-row"><span>Gleitzeit heute</span><b class="${tone(delta)}">${fmtBalance(delta)}</b></div>
      <div class="plan-row"><span>Gleitzeit danach</span><b class="${tone(totalBefore + delta)}">${fmtBalance(totalBefore + delta)}</b></div>
      ${current?.checkIn == null ? '<p class="hint">Gerechnet ab jetzt – so, als würdest du gleich einchecken.</p>' : ''}
      ${pauseNote ? `<p class="hint">${pauseNote}</p>` : ''}
      ${leaveHint ? `<p class="plan-tip">${esc(leaveHint)}</p>` : ''}`;
    return true;
  }

  function fromHours() {
    const h = hEl.value.trim() === '' ? 0 : Number(hEl.value);
    const m = mEl.value.trim() === '' ? 0 : Number(mEl.value);
    plan = Number.isInteger(h) && Number.isInteger(m) && h >= 0 && m >= 0 && m <= 59 ? h * 60 + m : NaN;
    leaveHint = '';
    render({ syncLeave: true });
  }

  function fromLeaveTime() {
    if (!leaveEl.value) return;
    const now = Date.now();
    const leave = tsAt(key, leaveEl.value);
    if (toMinutes(leave) <= toMinutes(now)) {
      leaveHint = 'Diese Uhrzeit ist schon vorbei.';
      render({ syncLeave: false });
      return;
    }
    const current = getDay(key);
    const netAtLeave = netIfLeaving(current, leave, now);
    const best = bestLeaveUntil(current, leave, now);
    plan = netAtLeave;
    leaveHint = '';
    if (best && toMinutes(best.at) < toMinutes(leave)) {
      // Früher gehen bringt gleich viel oder mehr (automatischer Pausenabzug) → das vorschlagen
      plan = best.net;
      leaveHint =
        best.net > netAtLeave
          ? `Tipp: Geh lieber schon um ${clock(best.at)} – dann hast du ${fmtDuration(best.net)} h statt ${fmtDuration(netAtLeave)} h netto. Dazwischen wird Pause abgezogen.`
          : `Tipp: Schon um ${clock(best.at)} hast du dieselben ${fmtDuration(best.net)} h netto.`;
    }
    setHm();
    render({ syncLeave: false });
  }

  async function save(newPlan) {
    const before = getDay(key);
    const d = before ? structuredClone(before) : emptyDay(key);
    d.plan = newPlan === target ? null : newPlan;
    vibrate(25);
    closeModal(dlg);
    await putDay(d);
    const e = d.plan != null ? planEnd(getDay(key), d.plan, Date.now()) : null;
    toast(d.plan != null ? `Plan: ${fmtDuration(d.plan)} h${e && !e.reached ? ` – Feierabend um ${clock(e.end)}` : ''}` : 'Plan gelöscht – normales Soll', {
      action: { label: 'Rückgängig', run: () => (before ? putDay(before) : putDay({ ...d, plan: null })) },
      duration: 7000,
    });
  }

  form.addEventListener('input', (event) => {
    if (event.target === hEl || event.target === mEl) fromHours();
  });
  leaveEl.addEventListener('change', fromLeaveTime);
  form.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (chip) {
      plan = Number(chip.dataset.min);
      leaveHint = '';
      setHm();
      render({ syncLeave: true });
    }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') closeModal(dlg);
    if (act === 'clear') save(target);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (render({ syncLeave: false })) save(plan);
    else vibrate([60, 40, 60]);
  });

  setHm();
  render({ syncLeave: true });
  openModal(dlg);
}
