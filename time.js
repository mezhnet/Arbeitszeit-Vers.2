// Zeit- und Datumshilfen.
// Zeitstempel sind Epoch-Millisekunden; Tage werden als lokaler Schlüssel "YYYY-MM-DD" geführt.

export const MS_PER_MIN = 60000;

export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Zeitstempel → ganze Minuten seit Epoch (Sekunden werden abgeschnitten). */
export function toMinutes(ts) {
  return Math.floor(ts / MS_PER_MIN);
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Date → "YYYY-MM-DD" in lokaler Zeit. */
export function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Tagesschlüssel für einen Zeitstempel. */
export function keyOf(ts) {
  return dateKey(new Date(ts));
}

/** "YYYY-MM-DD" → Date (lokale Mitternacht). */
export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** Wochentag: 0 = Sonntag … 6 = Samstag. */
export function weekdayOf(key) {
  return keyToDate(key).getDay();
}

/** Montag der Woche, in der `key` liegt. */
export function mondayOf(key) {
  const wd = weekdayOf(key);
  return addDays(key, wd === 0 ? -6 : 1 - wd);
}

/** "YYYY-MM-DD" → "YYYY-MM". */
export function monthOf(key) {
  return key.slice(0, 7);
}

/** Erster und letzter Tag eines Monats "YYYY-MM". */
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${ym}-01`, `${ym}-${pad2(last)}`];
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** Alle Tagesschlüssel von `from` bis `to` (beide inklusive). */
export function eachDay(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Tag + "HH:MM" → Zeitstempel. */
export function tsAt(key, hhmm) {
  const [y, m, d] = key.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

/** Zeitstempel → "HH:MM". */
export function clock(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Minuten → "8:15" bzw. "−0:15". */
export function fmtDuration(min) {
  const sign = min < 0 ? '−' : '';
  const a = Math.abs(min);
  return `${sign}${Math.floor(a / 60)}:${pad2(a % 60)}`;
}

/** Saldo mit Vorzeichen: "+0:45", "−0:15", "±0:00". */
export function fmtBalance(min) {
  if (min === 0) return '±0:00';
  return (min > 0 ? '+' : '') + fmtDuration(min);
}

/** Sekunden → "12:34" bzw. "1:02:03" (für die laufende Pause). */
export function fmtStopwatch(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

/** "2026-10-12" → "Mo, 12.10.2026". */
export function fmtDate(key) {
  const [y, m, d] = key.split('-');
  return `${WEEKDAYS_SHORT[weekdayOf(key)]}, ${d}.${m}.${y}`;
}

/** "2026-10-12" → "Montag, 12. Oktober 2026". */
export function fmtDateLong(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${WEEKDAYS_LONG[weekdayOf(key)]}, ${d}. ${MONTHS[m - 1]} ${y}`;
}

/** "2026-10" → "Oktober 2026". */
export function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
