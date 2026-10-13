// Start der App: Daten laden, Ansichten aufbauen, Live-Aktualisierung, Service Worker.

import { init, subscribe, onError } from './store.js';
import { mountToday, updateToday } from './ui-today.js';
import { mountHistory, renderHistory } from './ui-history.js';
import { mountSettings, renderSettings } from './ui-settings.js';
import { esc, toast } from './ui-common.js';

const VIEWS = ['today', 'history', 'settings'];
let current = 'today';

function goTo(view) {
  current = view;
  for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tabbar [data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  if (view === 'today') updateToday();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
  window.scrollTo({ top: 0 });
}

async function main() {
  onError((err) => toast(`Speichern fehlgeschlagen: ${err?.message || err}`, { level: 'danger', duration: 10000 }));
  try {
    await init();
  } catch (err) {
    document.getElementById('app').innerHTML = `<div class="fatal"><h1>Daten konnten nicht geladen werden</h1><p>${esc(err?.message || err)}</p><p>Bitte die App schließen und neu öffnen.</p></div>`;
    return;
  }
  // Bittet Chrome, die Daten nicht bei Speichermangel zu löschen (bei installierten Apps meist automatisch).
  navigator.storage?.persist?.().catch(() => {});

  mountToday(document.getElementById('view-today'), { goTo });
  mountHistory(document.getElementById('view-history'));
  mountSettings(document.getElementById('view-settings'));

  document.querySelector('.tabbar').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-view]');
    if (btn) goTo(btn.dataset.view);
  });

  // Daten geändert → sichtbare Ansicht aktualisieren (Einstellungen zeichnen sich selbst neu,
  // damit halb ausgefüllte Eingaben nicht verloren gehen).
  subscribe(() => {
    if (current === 'today') updateToday();
    if (current === 'history') renderHistory();
  });

  goTo('today');

  // Alle Werte werden aus Zeitstempeln berechnet – der Takt aktualisiert nur die Anzeige.
  setInterval(() => {
    if (current === 'today' && !document.hidden) updateToday();
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (current === 'today') updateToday();
    if (current === 'history') renderHistory();
  });

  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const banner = document.getElementById('update-banner');
  const hadController = Boolean(navigator.serviceWorker.controller);
  let waiting = null;

  const offerUpdate = (worker) => {
    waiting = worker;
    banner.hidden = false;
  };
  banner.querySelector('button').addEventListener('click', () => {
    banner.hidden = true;
    waiting?.postMessage({ type: 'SKIP_WAITING' });
  });

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      // Beim Zurückkehren in die App nach einer neuen Version schauen
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('Service Worker konnte nicht registriert werden:', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // erste Installation: kein Neuladen nötig
    reloading = true;
    location.reload();
  });
}

main();
