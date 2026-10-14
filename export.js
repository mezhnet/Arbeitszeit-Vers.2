// CSV-Export (für den Abgleich mit der offiziellen Zeiterfassung) und JSON-Backup.

import { eachDay, clock, fmtDuration, WEEKDAYS_SHORT, weekdayOf } from './time.js';
import { dayResult, ABSENCES, normalizeSettings } from './calc.js';

export const BACKUP_APP = 'arbeitszeit-gleitzeit';

// Excel (deutsch) erwartet Semikolon als Trenner und versteht nur das ASCII-Minus.
const csvDur = (min) => fmtDuration(min).replace('−', '-');
const csvBal = (min) => (min > 0 ? '+' : '') + csvDur(min);
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const deDate = (key) => key.split('-').reverse().join('.');

/** CSV für den Zeitraum `from`–`to` (inklusive), mit Summenzeile. */
export function buildCsv(from, to, days, settings, now) {
  const rows = [
    ['Datum', 'Wochentag', 'Kommen', 'Gehen', 'Pausenzeiten', 'Pause tatsächlich', 'Pause angerechnet', 'Anwesenheit', 'Netto', 'Soll', 'Saldo', 'Art', 'Bemerkung'],
  ];
  const sum = { net: 0, target: 0, balance: 0 };
  for (const key of eachDay(from, to)) {
    const d = days[key];
    const r = dayResult(key, d, settings, now);
    if (!d && (r.isFuture || r.beforeStart || (r.target === 0 && !r.holiday))) continue;
    const ev = r.ev;
    const kind = [
      r.holiday,
      r.absence ? ABSENCES[r.absence] : null,
      r.missing ? 'fehlt' : null,
      r.incomplete ? 'Auschecken fehlt' : null,
      r.weekend && !r.holiday ? 'Wochenende' : null,
      r.beforeStart ? 'vor Startdatum' : null,
      r.isToday && ev.open ? 'läuft' : null,
    ].filter(Boolean);
    const pauses = (d?.pauses || [])
      .filter((p) => p.start != null)
      .map((p) => `${clock(p.start)}-${p.end != null ? clock(p.end) : ''}`)
      .join(', ');
    rows.push([
      deDate(key),
      WEEKDAYS_SHORT[weekdayOf(key)],
      d?.checkIn != null ? clock(d.checkIn) : '',
      d?.checkOut != null ? clock(d.checkOut) : '',
      pauses,
      ev.hasTimes ? csvDur(ev.actualPause) : '',
      ev.hasTimes ? csvDur(ev.deductedPause) : '',
      ev.hasTimes ? csvDur(ev.presence) : '',
      ev.hasTimes ? csvDur(r.net) : '',
      csvDur(r.target),
      r.counts ? csvBal(r.balance) : '',
      kind.join(', '),
      d?.note || '',
    ]);
    if (r.counts) {
      sum.net += r.net;
      sum.target += r.target;
      sum.balance += r.balance;
    }
  }
  rows.push([]);
  rows.push(['Summe', '', '', '', '', '', '', '', csvDur(sum.net), csvDur(sum.target), csvBal(sum.balance), '', '']);
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Komplette Sicherung als JSON-Text. */
export function buildBackup(days, settings, now) {
  const list = Object.values(days).sort((a, b) => (a.date < b.date ? -1 : 1));
  return JSON.stringify({ app: BACKUP_APP, version: 1, exportedAt: new Date(now).toISOString(), settings, days: list }, null, 2);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Bringt einen (importierten) Tag in eine saubere Form. */
export function sanitizeDay(d) {
  return {
    date: d.date,
    checkIn: num(d.checkIn),
    checkOut: num(d.checkOut),
    pauses: Array.isArray(d.pauses)
      ? d.pauses.map((p) => ({ start: num(p?.start), end: num(p?.end) })).filter((p) => p.start != null)
      : [],
    absence: typeof d.absence === 'string' && Object.hasOwn(ABSENCES, d.absence) ? d.absence : null,
    note: typeof d.note === 'string' ? d.note : '',
    plan: num(d.plan),
    updatedAt: num(d.updatedAt) ?? 0,
  };
}

/** Liest eine Sicherung. Wirft einen Fehler mit deutscher Meldung, wenn die Datei nicht passt. */
export function parseBackup(text, fallbackStart) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist keine gültige JSON-Datei.');
  }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.days)) {
    throw new Error('Das ist keine Sicherungsdatei dieser App.');
  }
  const days = {};
  for (const d of data.days) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new Error('Die Sicherung enthält einen ungültigen Tag.');
    days[d.date] = sanitizeDay(d);
  }
  return { days, settings: normalizeSettings(data.settings, fallbackStart) };
}
