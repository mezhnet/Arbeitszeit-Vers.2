// Gemeinsame Oberflächen-Helfer: Escaping, Toast, Dialoge mit Zurück-Geste, Dateien speichern/teilen.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Kurzes haptisches Feedback (falls vom Gerät unterstützt). */
export function vibrate(pattern = 15) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* nicht unterstützt */
  }
}

// ---------- Toast (kurzer Hinweis unten, optional mit Aktion wie „Rückgängig“) ----------

let toastTimer = null;

export function toast(message, { action = null, duration = 5000, level = 'info' } = {}) {
  const el = document.getElementById('toast');
  el.className = `toast toast-${level}`;
  el.innerHTML = `<span class="toast-msg">${esc(message)}</span>${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ''}`;
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', () => {
      hideToast();
      action.run();
    });
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

export function hideToast() {
  document.getElementById('toast').hidden = true;
}

// ---------- Dialoge ----------
// Jeder geöffnete Dialog bekommt einen Eintrag im Browserverlauf. So schließt die
// Zurück-Geste von Android den Dialog, statt die App zu verlassen.

const stack = [];
let ignorePops = 0;

export function openModal(dialog, { onClose } = {}) {
  const entry = { dialog, onClose };
  stack.push(entry);
  history.pushState({ modal: stack.length }, '');
  dialog.addEventListener(
    'close',
    () => {
      // Vom Browser geschlossen (Zurück-Geste / Esc), nicht über closeModal()
      const i = stack.indexOf(entry);
      if (i === -1) return;
      stack.splice(i, 1);
      ignorePops++;
      history.back();
      entry.onClose?.();
    },
    { once: true },
  );
  dialog.showModal();
}

export function closeModal(dialog) {
  const i = stack.findIndex((e) => e.dialog === dialog);
  if (i === -1) return;
  const [entry] = stack.splice(i, 1);
  ignorePops++;
  history.back();
  entry.dialog.close();
  entry.onClose?.();
}

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const entry = stack.pop();
  if (entry) {
    entry.dialog.close();
    entry.onClose?.();
  }
});

/** Bestätigungsdialog. Liefert true (OK) oder false (Abbrechen/Zurück). */
export function confirmDialog({ title, text = '', ok = 'OK', cancel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('confirm-dialog');
    dlg.innerHTML = `
      <div class="confirm">
        <h2>${esc(title)}</h2>
        ${text ? `<p>${esc(text).replace(/\n/g, '<br>')}</p>` : ''}
        <div class="confirm-buttons">
          ${cancel ? `<button type="button" class="btn btn-secondary" data-answer="no">${esc(cancel)}</button>` : ''}
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">${esc(ok)}</button>
        </div>
      </div>`;
    let answer = false;
    dlg.querySelectorAll('[data-answer]').forEach((btn) =>
      btn.addEventListener('click', () => {
        answer = btn.dataset.answer === 'yes';
        closeModal(dlg);
      }),
    );
    openModal(dlg, { onClose: () => resolve(answer) });
  });
}

// ---------- Dateien ----------

/** Speichert eine Datei über den Download des Browsers (landet unter „Downloads“). */
export function saveFile(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function canShareFile(filename, mime) {
  try {
    return Boolean(navigator.canShare?.({ files: [new File(['x'], filename, { type: mime })] }));
  } catch {
    return false;
  }
}

/** Öffnet das Android-Teilen-Menü (z. B. Google Drive, E-Mail). */
export async function shareFile(filename, content, mime) {
  try {
    await navigator.share({ files: [new File([content], filename, { type: mime })], title: filename });
  } catch (err) {
    if (err?.name !== 'AbortError') throw err;
  }
}

// ---------- Symbole (inline SVG) ----------

const svg = (path) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const ICONS = {
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  left: svg('<path d="m15 18-6-6 6-6"/>'),
  right: svg('<path d="m9 18 6-6-6-6"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  alert: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  coffee: svg('<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2M10 2v2M14 2v2"/>'),
};
