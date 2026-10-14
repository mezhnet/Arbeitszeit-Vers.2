// Berechnungslogik für Arbeitszeit und Gleitzeit-Saldo.
// Reine Funktionen ohne DOM- oder Speicherzugriff – abgesichert durch tests/calc.test.js.
// Gerechnet wird minutengenau: Sekunden werden abgeschnitten (wie am Zeiterfassungsterminal).

import { MS_PER_MIN, toMinutes, keyOf, weekdayOf, mondayOf, monthOf, monthRange, eachDay } from './time.js';
import { holidayName } from './holidays.js';

export const RULES = Object.freeze({
  firstLimit: 360, // mehr als 6:00 h Arbeitszeit …
  firstBreak: 30, // … → mindestens 30 Min. Pause
  secondLimit: 540, // mehr als 9:00 h (nach Abzug der 30 Min.) …
  secondBreak: 45, // … → mindestens 45 Min. Pause (§ 4 ArbZG)
  minBlock: 15, // kürzere Pausenblöcke zählen nicht zur Mindestpause
  maxWork: 600, // Höchstarbeitszeit 10:00 h (§ 3 ArbZG)
  warnAhead: 10, // Vorwarnzeit in Minuten
});

export const ABSENCES = Object.freeze({ urlaub: 'Urlaub', krank: 'Krank', gleittag: 'Gleittag' });

/** Sollzeiten pro Wochentag in Minuten, Index 0 = Sonntag … 6 = Samstag. */
export const DEFAULT_TARGETS = Object.freeze([0, 495, 495, 495, 495, 360, 0]);

export function defaultSettings(startDate) {
  return {
    schemaVersion: 1,
    targets: [{ validFrom: '2000-01-01', minutes: [...DEFAULT_TARGETS] }],
    startDate,
    startBalance: 0,
    dec24and31Off: true,
  };
}

/** Ergänzt fehlende Felder und sortiert die Sollzeit-Historie. */
export function normalizeSettings(s, fallbackStart) {
  const base = defaultSettings(fallbackStart);
  const out = { ...base, ...(s || {}) };
  const targets = Array.isArray(out.targets) && out.targets.length ? out.targets : base.targets;
  out.targets = targets
    .map((t) => ({ validFrom: String(t.validFrom), minutes: DEFAULT_TARGETS.map((d, i) => Number(t.minutes?.[i] ?? d)) }))
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1));
  out.startBalance = Number(out.startBalance) || 0;
  out.dec24and31Off = out.dec24and31Off !== false;
  return out;
}

const sum = (list) => list.reduce((a, b) => a + b, 0);

/**
 * Wendet die Pausenregeln an.
 * @param {number} presence Anwesenheit in Minuten
 * @param {number[]} blocks Dauer der einzelnen Pausenblöcke in Minuten
 */
export function applyPauseRules(presence, blocks) {
  const actualPause = sum(blocks);
  const qualifyingPause = sum(blocks.filter((b) => b >= RULES.minBlock));
  let requiredPause = 0;
  let deductedPause = actualPause;
  // Tatsächliche Pausen werden immer voll abgezogen. Fehlt Mindestpause, wird der Rest
  // in voller Höhe abgezogen (nicht gestaffelt).
  if (presence - actualPause > RULES.firstLimit) {
    requiredPause = RULES.firstBreak;
    deductedPause = actualPause + Math.max(0, RULES.firstBreak - qualifyingPause);
    if (presence - deductedPause > RULES.secondLimit) {
      requiredPause = RULES.secondBreak;
      deductedPause = actualPause + Math.max(0, RULES.secondBreak - qualifyingPause);
    }
  }
  return {
    presence,
    actualPause,
    qualifyingPause,
    requiredPause,
    deductedPause,
    autoPause: deductedPause - actualPause,
    net: presence - deductedPause,
  };
}

/** Sortiert Intervalle und verschmilzt überlappende oder direkt aneinandergrenzende. */
export function mergeIntervals(list) {
  const sorted = list.filter((iv) => iv.end > iv.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
      if (iv.running) last.running = true;
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/**
 * Wertet einen Tag zum Zeitpunkt `now` aus. Ist der Tag noch offen (nicht ausgecheckt),
 * laufen Anwesenheit und eine offene Pause bis `now`.
 */
export function evaluateDay(day, now) {
  if (!day || day.checkIn == null) {
    return { ...applyPauseRules(0, []), hasTimes: false, open: false, inMin: null, endMin: null, blocks: [], shortBlocks: 0, pauseRunning: false, runningPause: null };
  }
  const inMin = toMinutes(day.checkIn);
  const open = day.checkOut == null;
  const endMin = Math.max(inMin, open ? toMinutes(now) : toMinutes(day.checkOut));
  const pauses = day.pauses || [];
  const runningPause = open ? pauses.find((p) => p.end == null) ?? null : null;
  const blocks = mergeIntervals(
    pauses
      .filter((p) => p.start != null)
      .map((p) => ({
        start: Math.max(inMin, toMinutes(p.start)),
        end: Math.min(endMin, p.end == null ? endMin : toMinutes(p.end)),
        running: open && p.end == null,
      })),
  );
  const result = applyPauseRules(endMin - inMin, blocks.map((b) => b.end - b.start));
  return {
    ...result,
    hasTimes: true,
    open,
    inMin,
    endMin,
    blocks,
    shortBlocks: blocks.filter((b) => !b.running && b.end - b.start < RULES.minBlock).length,
    pauseRunning: runningPause != null,
    runningPause,
  };
}

/** Sollzeiten (7 Werte) für einen Tag laut Historie: der letzte Eintrag mit validFrom ≤ key. */
export function weekTargetsFor(key, settings) {
  let entry = settings.targets[0];
  for (const t of settings.targets) {
    if (t.validFrom <= key) entry = t;
    else break;
  }
  return entry.minutes;
}

/** Soll eines Tages inkl. Feiertag bzw. dienstfreiem 24./31.12. */
export function targetInfo(key, settings) {
  const wd = weekdayOf(key);
  const regular = weekTargetsFor(key, settings)[wd] || 0;
  let holiday = holidayName(key);
  if (!holiday && settings.dec24and31Off) {
    const md = key.slice(5);
    if (md === '12-24') holiday = 'Heiligabend (dienstfrei)';
    if (md === '12-31') holiday = 'Silvester (dienstfrei)';
  }
  return { target: holiday ? 0 : regular, regular, holiday, weekend: wd === 0 || wd === 6 };
}

/**
 * Vollständiges Tagesergebnis inkl. Saldo und Status.
 * Urlaub/Krank: Soll gilt als erfüllt (Saldo ±0). Gleittag: Soll bleibt, Saldo = Netto − Soll.
 */
export function dayResult(key, day, settings, now) {
  const today = keyOf(now);
  const info = targetInfo(key, settings);
  const ev = evaluateDay(day, now);
  const absence = day?.absence || null;
  const isToday = key === today;
  const isFuture = key > today;
  const isPast = key < today;
  const beforeStart = key < settings.startDate;
  const incomplete = isPast && ev.hasTimes && ev.open; // Auschecken vergessen
  const missing = isPast && !beforeStart && !ev.hasTimes && !absence && info.target > 0;
  const net = incomplete ? 0 : ev.net;
  const credited = absence === 'urlaub' || absence === 'krank';
  const actual = credited ? info.target : net;
  const balance = actual - info.target;
  const counts = !beforeStart && !isFuture && (!isToday || absence != null || (ev.hasTimes && !ev.open));
  return { key, ...info, absence, ev, net, actual, balance, isToday, isFuture, beforeStart, incomplete, missing, counts };
}

/** Summen über einen Zeitraum (nur Tage, die zählen: ab Startdatum, bis heute). */
export function sumRange(from, to, days, settings, now) {
  const res = { balance: 0, target: 0, actual: 0, net: 0, missing: 0, incomplete: 0 };
  const last = to < keyOf(now) ? to : keyOf(now);
  const first = from > settings.startDate ? from : settings.startDate;
  if (first > last) return res;
  for (const key of eachDay(first, last)) {
    const r = dayResult(key, days[key], settings, now);
    if (r.missing) res.missing++;
    if (r.incomplete) res.incomplete++;
    res.net += r.counts ? r.net : 0;
    if (!r.counts) continue;
    res.balance += r.balance;
    res.target += r.target;
    res.actual += r.actual;
  }
  return res;
}

/** Wochen-, Monats- und Gesamtsaldo. Der heutige Tag zählt erst nach dem Auschecken. */
export function totals(days, settings, now) {
  const today = keyOf(now);
  const week = sumRange(mondayOf(today), today, days, settings, now);
  const month = sumRange(monthRange(monthOf(today))[0], today, days, settings, now);
  const all = sumRange(settings.startDate, today, days, settings, now);
  return {
    week: week.balance,
    month: month.balance,
    total: settings.startBalance + all.balance,
    missing: all.missing,
    incomplete: all.incomplete,
    todayCounted: dayResult(today, days[today], settings, now).counts,
  };
}

function firstEndMinute(inMin, fromMin, blocks, target) {
  for (let t = fromMin; t <= fromMin + 24 * 60; t++) {
    if (applyPauseRules(t - inMin, blocks).net >= target) return t;
  }
  return null;
}

/**
 * Frühester Feierabend ab jetzt: erste Minute, zu der die Netto-Arbeitszeit das Soll erreicht
 * (die automatisch abgezogene Pflichtpause ist dabei eingerechnet).
 * Eine laufende Pause endet entweder jetzt oder – falls das früher zum Feierabend führt –
 * nach 15 Min., damit sie zur Mindestpause zählt (`pauseUntil`).
 */
export function computeEnd(day, target, now) {
  if (!day || day.checkIn == null || day.checkOut != null || target <= 0) return null;
  const ev = evaluateDay(day, now);
  if (ev.net >= target) return { end: now, reached: true, pauseUntil: null };
  const nowMin = toMinutes(now);
  const done = ev.blocks.filter((b) => !b.running).map((b) => b.end - b.start);
  const run = ev.blocks.find((b) => b.running);
  const resumeOptions = run ? [nowMin, Math.max(nowMin, run.start + RULES.minBlock)] : [nowMin];
  let best = null;
  for (const resume of resumeOptions) {
    const blocks = run ? [...done, resume - run.start] : done;
    const end = firstEndMinute(ev.inMin, resume, blocks, target);
    if (end != null && (best == null || end < best.end)) best = { end, pauseUntil: resume > nowMin ? resume : null };
  }
  if (!best) return null;
  return {
    end: best.end * MS_PER_MIN,
    reached: false,
    pauseUntil: best.pauseUntil == null ? null : best.pauseUntil * MS_PER_MIN,
  };
}

/** Tag für Planungen: der laufende Tag oder – noch nicht eingecheckt – „Einchecken jetzt“. */
function planningDay(day, now) {
  return day && day.checkIn != null && day.checkOut == null ? day : { checkIn: now, checkOut: null, pauses: [] };
}

/** Frühester Feierabend für eine gewünschte Netto-Arbeitszeit (`planMinutes`), auch ohne Check-in. */
export function planEnd(day, planMinutes, now) {
  return computeEnd(planningDay(day, now), planMinutes, now);
}

/**
 * Netto-Arbeitszeit, wenn man um `leaveTs` geht. Eine laufende Pause endet jetzt,
 * weitere Pausen werden nicht angenommen. Ohne Check-in: Einchecken jetzt.
 */
export function netIfLeaving(day, leaveTs, now) {
  const base = planningDay(day, now);
  const hypo = { ...base, pauses: (base.pauses || []).map((p) => ({ start: p.start, end: p.end ?? now })), checkOut: leaveTs };
  return evaluateDay(hypo, leaveTs).net;
}

/**
 * Bester Zeitpunkt zum Gehen zwischen jetzt und `leaveTs`: der früheste Moment mit der
 * höchsten Netto-Arbeitszeit. Liegt er vor `leaveTs`, verliert man beim späteren Gehen Zeit
 * (automatischer Pausenabzug) oder gewinnt nichts.
 */
export function bestLeaveUntil(day, leaveTs, now) {
  let best = null;
  for (let t = toMinutes(now); t <= toMinutes(leaveTs); t++) {
    const ts = t * MS_PER_MIN;
    const net = netIfLeaving(day, ts, now);
    if (!best || net > best.net) best = { at: ts, net };
  }
  return best;
}

/**
 * Warnungen für den laufenden Tag (nur solange eingecheckt).
 * Typen: six-pre, six-loss (Tage mit Soll ≤ 6:00 h), nine-pre, nine-loss, max-pre, max-reached.
 * `leaveBy`/`stayUntil`/`since` sind Zeitstempel, `stayPresence` Anwesenheit in Minuten.
 */
export function getWarnings(day, target, now) {
  const ev = evaluateDay(day, now);
  const out = [];
  if (!ev.hasTimes || !ev.open) return out;
  const P = ev.presence;
  const A = ev.actualPause;
  const Q = ev.qualifyingPause;
  const W0 = P - A;
  const at = (presence) => (ev.inMin + presence) * MS_PER_MIN;

  if (!ev.pauseRunning) {
    // 6-h-Grenze: an Tagen mit Soll bis 6:00 h (standardmäßig Freitag)
    if (target > 0 && target <= RULES.firstLimit && Q < RULES.firstBreak) {
      const cliff = A + RULES.firstLimit; // letzte Minute ohne Abzug
      const safe = cliff + RULES.firstBreak - Q; // ab hier wieder 6:00 h netto
      if (W0 >= RULES.firstLimit - RULES.warnAhead && W0 <= RULES.firstLimit) {
        out.push({ type: 'six-pre', minutesLeft: RULES.firstLimit - W0, leaveBy: at(cliff), stayUntil: at(safe), stayPresence: safe });
      } else if (W0 > RULES.firstLimit && P < safe) {
        out.push({ type: 'six-loss', since: at(cliff), stayUntil: at(safe), stayPresence: safe });
      }
    }
    // 9-h-Grenze: danach gelten 45 Min. Pause
    if (W0 > RULES.firstLimit && Q < RULES.secondBreak) {
      const d1 = A + Math.max(0, RULES.firstBreak - Q);
      const W1 = P - d1;
      const drop = Math.max(0, RULES.secondBreak - Q) - Math.max(0, RULES.firstBreak - Q);
      const cliff = d1 + RULES.secondLimit;
      const safe = cliff + drop;
      if (W1 >= RULES.secondLimit - RULES.warnAhead && W1 <= RULES.secondLimit) {
        out.push({ type: 'nine-pre', minutesLeft: RULES.secondLimit - W1, extra: drop, leaveBy: at(cliff), stayUntil: at(safe) });
      } else if (W1 > RULES.secondLimit && P < safe) {
        out.push({ type: 'nine-loss', extra: drop, since: at(cliff), stayUntil: at(safe) });
      }
    }
  }
  // Höchstarbeitszeit (§ 3 ArbZG)
  if (ev.net >= RULES.maxWork) {
    out.push({ type: 'max-reached' });
  } else if (ev.net >= RULES.maxWork - RULES.warnAhead) {
    out.push({ type: 'max-pre', minutesLeft: RULES.maxWork - ev.net });
  }
  return out;
}

/** Prüft einen Tag vor dem Speichern im Editor. Gibt eine Liste deutscher Fehlermeldungen zurück. */
export function validateDay(day, now) {
  const errors = [];
  const today = keyOf(now);
  const isToday = day.date === today;
  const { checkIn, checkOut } = day;
  const pauses = [...(day.pauses || [])].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  if (day.date > today && (checkIn != null || checkOut != null || pauses.length)) {
    errors.push('Für zukünftige Tage können nur Abwesenheiten eingetragen werden.');
    return errors;
  }
  if (checkIn == null) {
    if (checkOut != null || pauses.length) errors.push('Bitte eine Kommen-Zeit eintragen.');
    return errors;
  }
  if (checkIn > now) errors.push('Kommen liegt in der Zukunft.');
  if (checkOut == null) {
    if (!isToday) errors.push('Bitte eine Gehen-Zeit eintragen.');
  } else {
    if (toMinutes(checkOut) <= toMinutes(checkIn)) errors.push('Gehen muss nach Kommen liegen.');
    if (checkOut > now) errors.push('Gehen liegt in der Zukunft.');
  }
  pauses.forEach((p, i) => {
    const n = i + 1;
    if (p.start == null) {
      errors.push(`Pause ${n}: Bitte Beginn eintragen.`);
      return;
    }
    if (toMinutes(p.start) < toMinutes(checkIn)) errors.push(`Pause ${n} beginnt vor dem Kommen.`);
    if (p.start > now) errors.push(`Pause ${n} liegt in der Zukunft.`);
    if (p.end == null) {
      const mayRun = isToday && checkOut == null && i === pauses.length - 1;
      if (!mayRun) errors.push(`Pause ${n}: Bitte Ende eintragen.`);
    } else {
      if (toMinutes(p.end) <= toMinutes(p.start)) errors.push(`Pause ${n}: Ende muss nach Beginn liegen.`);
      if (checkOut != null && toMinutes(p.end) > toMinutes(checkOut)) errors.push(`Pause ${n} endet nach dem Gehen.`);
      if (p.end > now) errors.push(`Pause ${n} endet in der Zukunft.`);
    }
    const prev = pauses[i - 1];
    if (prev && prev.start != null && prev.end != null && toMinutes(p.start) < toMinutes(prev.end)) {
      errors.push(`Pause ${n} überschneidet sich mit Pause ${i}.`);
    }
  });
  return errors;
}
