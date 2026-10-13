// Einstellungen: Sollzeiten, Gleitzeitkonto (Start), Feiertage, Export, Backup.

import { state, updateSettings, replaceAll } from './store.js';
import { defaultSettings, weekTargetsFor } from './calc.js';
import { saarlandHolidays } from './holidays.js';
import { keyOf, fmtDuration, fmtBalance, fmtDate, WEEKDAYS_LONG, WEEKDAYS_SHORT } from './time.js';
import { buildCsv, buildBackup, parseBackup } from './export.js';
import { esc, toast, confirmDialog, saveFile, canShareFile, shareFile } from './ui-common.js';

let root = null;
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Montag zuerst
const deDate = (key) => key.split('-').reverse().join('.');

export function mountSettings(container) {
  root = container;
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
}

export function renderSettings() {
  if (!root || !state.settings) return;
  const s = state.settings;
  const today = keyOf(Date.now());
  const current = weekTargetsFor(today, s);
  const year = Number(today.slice(0, 4));
  const holidays = [...saarlandHolidays(year).entries()];
  if (s.dec24and31Off) holidays.push([`${year}-12-24`, 'Heiligabend (dienstfrei)'], [`${year}-12-31`, 'Silvester (dienstfrei)']);
  holidays.sort(([a], [b]) => (a < b ? -1 : 1));
  const abs = Math.abs(s.startBalance);
  const lastBackup = s.lastBackupAt ? fmtDate(keyOf(s.lastBackupAt)) : 'noch nie';

  root.innerHTML = `
    <header class="view-head"><h1>Einstellungen</h1></header>

    <section class="card">
      <h2>Sollarbeitszeit</h2>
      <div class="targets">
        ${ORDER.map(
          (wd) => `<div class="target-row">
            <span class="target-day">${WEEKDAYS_LONG[wd]}</span>
            <input type="number" inputmode="numeric" min="0" max="23" name="h${wd}" value="${Math.floor(current[wd] / 60)}" aria-label="${WEEKDAYS_LONG[wd]} Stunden"><span>h</span>
            <input type="number" inputmode="numeric" min="0" max="59" name="m${wd}" value="${current[wd] % 60}" aria-label="${WEEKDAYS_LONG[wd]} Minuten"><span>min</span>
          </div>`,
        ).join('')}
      </div>
      <p class="week-sum">Woche: <b data-el="weekSum">${fmtDuration(current.reduce((a, b) => a + b, 0))} h</b></p>
      <label class="field"><span>Gültig ab</span><input type="date" name="validFrom" value="${today}"></label>
      <p class="hint">Frühere Tage behalten ihre bisherige Sollzeit. Willst du einen Fehler von Anfang an korrigieren, wähle das Startdatum (${deDate(s.startDate)}) oder früher.</p>
      <button type="button" class="btn btn-primary btn-block" data-action="save-targets">Sollzeiten speichern</button>
      ${
        s.targets.length > 1
          ? `<details class="details"><summary>Sollzeit-Verlauf (${s.targets.length})</summary><ul class="plain-list">
          ${s.targets
            .map(
              (t) => `<li><div><b>${t.validFrom <= '2000-01-01' ? 'von Anfang an' : `ab ${deDate(t.validFrom)}`}</b><br>
                <small>${ORDER.map((wd) => `${WEEKDAYS_SHORT[wd]} ${fmtDuration(t.minutes[wd])}`).join(' · ')}</small></div>
                <button type="button" class="btn btn-small btn-danger-outline" data-action="del-target" data-from="${t.validFrom}">Löschen</button></li>`,
            )
            .join('')}</ul></details>`
          : ''
      }
    </section>

    <section class="card">
      <h2>Gleitzeitkonto</h2>
      <label class="field"><span>Startdatum der Erfassung</span><input type="date" name="startDate" value="${s.startDate}" required></label>
      <div class="field">
        <span class="field-label">Übertrag zum Startdatum</span>
        <div class="balance-input">
          <select name="sign" aria-label="Vorzeichen">
            <option value="1" ${s.startBalance >= 0 ? 'selected' : ''}>+ Plus</option>
            <option value="-1" ${s.startBalance < 0 ? 'selected' : ''}>− Minus</option>
          </select>
          <input type="number" inputmode="numeric" min="0" name="bh" value="${Math.floor(abs / 60)}" aria-label="Stunden"><span>h</span>
          <input type="number" inputmode="numeric" min="0" max="59" name="bm" value="${abs % 60}" aria-label="Minuten"><span>min</span>
        </div>
      </div>
      <p class="hint">Trag hier den Saldo aus deiner bisherigen Zeiterfassung ein. Tage vor dem Startdatum zählen nicht.</p>
      <button type="button" class="btn btn-primary btn-block" data-action="save-account">Speichern</button>
    </section>

    <section class="card">
      <h2>Feiertage Saarland</h2>
      <label class="switch">
        <input type="checkbox" name="dec24" ${s.dec24and31Off ? 'checked' : ''}>
        <span>24.12. und 31.12. dienstfrei (§ 6 Abs. 3 TVöD/TV-L)</span>
      </label>
      <details class="details"><summary>Feiertage ${year} anzeigen</summary>
        <ul class="plain-list">${holidays.map(([k, n]) => `<li><span>${fmtDate(k)}</span><span>${esc(n)}</span></li>`).join('')}</ul>
      </details>
    </section>

    <section class="card">
      <h2>Daten &amp; Backup</h2>
      <p class="hint">Alle Daten liegen nur auf diesem Handy. Speichere regelmäßig ein Backup, z. B. einmal im Monat in Google Drive.</p>
      <p class="kv"><span>Letztes Backup</span><b>${lastBackup}</b></p>
      <p class="kv"><span>Dauerhafter Speicher</span><b data-el="persist">…</b></p>
      <div class="button-stack">
        <button type="button" class="btn btn-primary btn-block" data-action="backup">Backup speichern (JSON)</button>
        ${canShareFile('backup.json', 'application/json') ? '<button type="button" class="btn btn-secondary btn-block" data-action="backup-share">Backup teilen …</button>' : ''}
        <button type="button" class="btn btn-secondary btn-block" data-action="restore">Backup wiederherstellen</button>
        <button type="button" class="btn btn-secondary btn-block" data-action="csv">CSV-Export (gesamter Zeitraum)</button>
        ${canShareFile('export.csv', 'text/csv') ? '<button type="button" class="btn btn-secondary btn-block" data-action="csv-share">CSV teilen …</button>' : ''}
      </div>
      <input type="file" accept=".json,application/json" data-el="file" hidden>
    </section>

    <section class="card">
      <h2>So wird gerechnet</h2>
      <ul class="rules">
        <li>Netto = Anwesenheit − Pausen. Tatsächliche Pausen werden immer voll abgezogen.</li>
        <li>Über 6:00 h Arbeitszeit: mindestens 30 Min. Pause – Fehlendes wird automatisch abgezogen (nicht gestaffelt).</li>
        <li>Über 9:00 h (nach Abzug der 30 Min.): mindestens 45 Min. Pause (§ 4 ArbZG).</li>
        <li>Pausenblöcke unter 15 Min. werden abgezogen, zählen aber nicht zur Mindestpause.</li>
        <li>Urlaub und Krank: Soll erfüllt (±0). Gleittag: volles Tagessoll wird abgezogen.</li>
        <li>Minutengenau: Sekunden werden abgeschnitten. Höchstarbeitszeit 10 h (§ 3 ArbZG).</li>
      </ul>
    </section>

    <section class="card">
      <h2>Alle Daten löschen</h2>
      <p class="hint">Löscht alle Tage und Einstellungen von diesem Handy. Mach vorher ein Backup!</p>
      <button type="button" class="btn btn-danger-outline btn-block" data-action="wipe">Alle Daten löschen</button>
    </section>

    <p class="note center">Arbeitszeit · Version <span data-el="version">…</span></p>`;

  fillAsyncInfo();
}

async function fillAsyncInfo() {
  const persistEl = root.querySelector('[data-el="persist"]');
  const versionEl = root.querySelector('[data-el="version"]');
  try {
    const persisted = await navigator.storage?.persisted?.();
    persistEl.textContent = persisted ? 'aktiv ✓' : 'nicht aktiv';
  } catch {
    persistEl.textContent = 'unbekannt';
  }
  versionEl.textContent = await getVersion();
}

function getVersion() {
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) return Promise.resolve('–');
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(e.data?.version ?? '–');
    ctrl.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    setTimeout(() => resolve('–'), 1500);
  });
}

const field = (name) => root.querySelector(`[name="${name}"]`);
const intOf = (name) => {
  const v = field(name).value.trim();
  return v === '' ? 0 : Number(v);
};

function readTargets() {
  const minutes = [0, 0, 0, 0, 0, 0, 0];
  for (const wd of ORDER) {
    const h = intOf(`h${wd}`);
    const m = intOf(`m${wd}`);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59 || h * 60 + m > 24 * 60) return null;
    minutes[wd] = h * 60 + m;
  }
  return minutes;
}

function onInput(event) {
  if (/^[hm]\d$/.test(event.target.name)) {
    const t = readTargets();
    root.querySelector('[data-el="weekSum"]').textContent = t ? `${fmtDuration(t.reduce((a, b) => a + b, 0))} h` : 'ungültige Eingabe';
  }
}

async function onChange(event) {
  const t = event.target;
  if (t.name === 'dec24') {
    await updateSettings({ dec24and31Off: t.checked });
    toast(t.checked ? '24.12. und 31.12. sind dienstfrei' : '24.12. und 31.12. sind normale Arbeitstage');
    renderSettings();
  }
  if (t.dataset.el === 'file' && t.files?.[0]) {
    await restore(t.files[0]);
    t.value = '';
  }
}

async function onClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const s = state.settings;
  const now = Date.now();
  const today = keyOf(now);
  switch (btn.dataset.action) {
    case 'save-targets': {
      const minutes = readTargets();
      if (!minutes) return toast('Bitte gültige Sollzeiten eingeben (Minuten 0–59).', { level: 'danger' });
      const validFrom = field('validFrom').value || today;
      const targets = s.targets.filter((t) => t.validFrom !== validFrom).concat({ validFrom, minutes });
      await updateSettings({ targets });
      toast(`Sollzeiten ab ${deDate(validFrom)} gespeichert`);
      return renderSettings();
    }
    case 'del-target': {
      if (s.targets.length < 2) return;
      const from = btn.dataset.from;
      const ok = await confirmDialog({ title: 'Eintrag löschen?', text: `Sollzeiten ${from <= '2000-01-01' ? 'von Anfang an' : `ab ${deDate(from)}`} löschen?`, ok: 'Löschen', danger: true });
      if (!ok) return;
      await updateSettings({ targets: s.targets.filter((t) => t.validFrom !== from) });
      return renderSettings();
    }
    case 'save-account': {
      const startDate = field('startDate').value;
      const h = intOf('bh');
      const m = intOf('bm');
      if (!startDate) return toast('Bitte ein Startdatum wählen.', { level: 'danger' });
      if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) return toast('Bitte einen gültigen Übertrag eingeben (Minuten 0–59).', { level: 'danger' });
      const startBalance = Number(field('sign').value) * (h * 60 + m);
      await updateSettings({ startDate, startBalance });
      toast(`Gespeichert: Start ${deDate(startDate)}, Übertrag ${fmtBalance(startBalance)}`);
      return renderSettings();
    }
    case 'backup':
      saveFile(`arbeitszeit-backup-${today}.json`, buildBackup(state.days, s, now), 'application/json');
      await updateSettings({ lastBackupAt: now });
      toast('Backup gespeichert (Ordner „Downloads“)');
      return renderSettings();
    case 'backup-share':
      await shareFile(`arbeitszeit-backup-${today}.json`, buildBackup(state.days, s, now), 'application/json');
      await updateSettings({ lastBackupAt: now });
      return renderSettings();
    case 'restore':
      return root.querySelector('[data-el="file"]').click();
    case 'csv':
      saveFile(`arbeitszeit-${s.startDate}-bis-${today}.csv`, buildCsv(s.startDate, today, state.days, s, now), 'text/csv;charset=utf-8');
      return toast('CSV gespeichert (Ordner „Downloads“)');
    case 'csv-share':
      return shareFile(`arbeitszeit-${s.startDate}-bis-${today}.csv`, buildCsv(s.startDate, today, state.days, s, now), 'text/csv');
    case 'wipe': {
      const ok1 = await confirmDialog({ title: 'Alle Daten löschen?', text: 'Alle erfassten Tage und Einstellungen werden von diesem Handy gelöscht.', ok: 'Weiter', danger: true });
      if (!ok1) return;
      const ok2 = await confirmDialog({ title: 'Wirklich alles löschen?', text: 'Das kann nicht rückgängig gemacht werden.', ok: 'Endgültig löschen', danger: true });
      if (!ok2) return;
      await replaceAll({}, defaultSettings(today));
      toast('Alle Daten gelöscht');
      return renderSettings();
    }
    default:
  }
}

async function restore(file) {
  try {
    const { days, settings } = parseBackup(await file.text(), keyOf(Date.now()));
    const count = Object.keys(days).length;
    const ok = await confirmDialog({
      title: 'Backup wiederherstellen?',
      text: `Die Datei enthält ${count} Tage (Start ${deDate(settings.startDate)}).\nAlle aktuellen Daten auf diesem Handy werden dadurch ersetzt.`,
      ok: 'Wiederherstellen',
      danger: true,
    });
    if (!ok) return;
    await replaceAll(days, settings);
    toast(`Backup wiederhergestellt (${count} Tage)`);
    renderSettings();
  } catch (err) {
    toast(err.message || 'Die Datei konnte nicht gelesen werden.', { level: 'danger', duration: 8000 });
  }
}
