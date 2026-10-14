// App-Zustand im Speicher + sofortiges Schreiben in IndexedDB.

import * as db from './db.js';
import { normalizeSettings } from './calc.js';
import { keyOf } from './time.js';

export const state = { days: {}, settings: null, version: 0 };

const listeners = new Set();
let reportError = (err) => console.error(err);

export function subscribe(fn) {
  listeners.add(fn);
}

export function onError(fn) {
  reportError = fn;
}

function changed() {
  state.version++;
  for (const fn of listeners) fn();
}

export async function init() {
  const { days, settings } = await db.loadAll();
  state.days = days;
  state.settings = normalizeSettings(settings, keyOf(Date.now()));
  if (!settings) await db.saveSettings(state.settings);
}

export function getDay(key) {
  return state.days[key] ?? null;
}

export function emptyDay(key) {
  return { date: key, checkIn: null, checkOut: null, pauses: [], absence: null, note: '', plan: null };
}

/** Speichert einen Tag. Ein komplett leerer Tag wird gelöscht. */
export async function putDay(day) {
  const empty = day.checkIn == null && !day.absence && !day.pauses?.length && !day.note && day.plan == null;
  if (empty) return removeDay(day.date);
  const copy = { ...structuredClone(day), updatedAt: Date.now() };
  state.days[copy.date] = copy;
  changed();
  try {
    await db.saveDay(copy);
  } catch (err) {
    reportError(err);
  }
}

export async function removeDay(key) {
  if (!(key in state.days)) return;
  delete state.days[key];
  changed();
  try {
    await db.deleteDay(key);
  } catch (err) {
    reportError(err);
  }
}

export async function updateSettings(patch) {
  state.settings = normalizeSettings({ ...state.settings, ...patch }, state.settings.startDate);
  changed();
  try {
    await db.saveSettings(state.settings);
  } catch (err) {
    reportError(err);
  }
}

/** Ersetzt alle Daten (Backup wiederherstellen). Erst speichern, dann anzeigen. */
export async function replaceAll(days, settings) {
  await db.replaceAll(days, settings);
  state.days = days;
  state.settings = settings;
  changed();
}
