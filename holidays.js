// Gesetzliche Feiertage im Saarland. Ostern wird berechnet, es gibt keine festen Jahreslisten.

import { addDays, pad2 } from './time.js';

/** Ostersonntag (gregorianisch) nach Meeus/Jones/Butcher → "YYYY-MM-DD". */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

const cache = new Map();

/** Alle gesetzlichen Feiertage eines Jahres im Saarland: Map "YYYY-MM-DD" → Name. */
export function saarlandHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const easter = easterSunday(year);
  const list = [
    [`${year}-01-01`, 'Neujahr'],
    [addDays(easter, -2), 'Karfreitag'],
    [addDays(easter, 1), 'Ostermontag'],
    [`${year}-05-01`, 'Tag der Arbeit'],
    [addDays(easter, 39), 'Christi Himmelfahrt'],
    [addDays(easter, 50), 'Pfingstmontag'],
    [addDays(easter, 60), 'Fronleichnam'],
    [`${year}-08-15`, 'Mariä Himmelfahrt'],
    [`${year}-10-03`, 'Tag der Deutschen Einheit'],
    [`${year}-11-01`, 'Allerheiligen'],
    [`${year}-12-25`, '1. Weihnachtsfeiertag'],
    [`${year}-12-26`, '2. Weihnachtsfeiertag'],
  ];
  const map = new Map();
  for (const [key, name] of list) {
    // Christi Himmelfahrt kann auf den 1. Mai fallen (z. B. 2008).
    map.set(key, map.has(key) ? `${map.get(key)} / ${name}` : name);
  }
  cache.set(year, map);
  return map;
}

/** Name des Feiertags an diesem Tag oder null. */
export function holidayName(key) {
  return saarlandHolidays(Number(key.slice(0, 4))).get(key) ?? null;
}
