/* ------------------------------------------------------------------ *
 * main.js — boot, tick loop, autosave, offline catch-up
 * ------------------------------------------------------------------ */
'use strict';

(async function boot() {
  // Load game data assets
  try {
    await GameData.loadAll();
  } catch (e) {
    document.getElementById('screen').innerHTML =
      '<div class="card"><h2>⚠️ Failed to load game data</h2><p class="card-sub">' +
      Util.esc(String(e.message)) +
      '</p><p class="card-sub">This game must be served over HTTP (e.g. <code>python3 -m http.server</code> from the web/ folder) — opening index.html directly from disk blocks the data files.</p></div>';
    return;
  }

  State.init();
  const loaded = State.load();
  // Compute away-time BEFORE overwriting the timestamp
  const awayMs = loaded && State.state.lastSeenAt ? Date.now() - State.state.lastSeenAt : 0;

  Engine.restoreLastStart();
  UI.bindTabs();
  UI.render();

  // Offline welcome-back banner
  const awaySess = Engine.session();
  if (awaySess && awayMs > 60000) {
    const doneWhileAway = awaySess.endsAt <= Date.now();
    const banner = Util.el('div', 'offline-banner',
      doneWhileAway
        ? `🌙 Welcome back! ${awaySess.label} finished while you were away — collect your rewards below.`
        : `🌙 Welcome back! Your hero is still working on ${awaySess.label} (${Util.fmtTime(awaySess.endsAt - Date.now())} to go).`);
    document.getElementById('screen').prepend(banner);
  }

  State.state.lastSeenAt = Date.now();
  State.save();

  // Tick: refresh live session readouts
  setInterval(() => UI.updateLive(), 500);

  // Autosave every 10s
  setInterval(() => { State.state.lastSeenAt = Date.now(); State.save(); }, 10000);
  window.addEventListener('beforeunload', () => { State.state.lastSeenAt = Date.now(); State.save(); });

  // Top-bar actions
  document.getElementById('btn-export').onclick = () => {
    const code = State.exportSave();
    UI.modal(`
      <h2>📤 Export save</h2>
      <p class="card-sub">Copy this code somewhere safe. Paste it into Import on any device.</p>
      <textarea class="fancy" style="width:100%;height:120px" readonly>${code}</textarea>
      <div class="modal-actions">
        <button class="btn secondary" data-act="copy">Copy</button>
        <button class="btn" data-act="close">Done</button>
      </div>`, m => {
        m.querySelector('[data-act=close]').onclick = () => UI.closeModal();
        m.querySelector('[data-act=copy]').onclick = () => {
          m.querySelector('textarea').select();
          navigator.clipboard?.writeText(code);
          UI.toast('Save code copied!', 'success');
        };
      });
  };

  document.getElementById('btn-import').onclick = () => {
    UI.modal(`
      <h2>📥 Import save</h2>
      <p class="card-sub">Paste an exported save code. This replaces your current progress.</p>
      <textarea class="fancy" style="width:100%;height:120px" placeholder="Paste save code…"></textarea>
      <div class="modal-actions">
        <button class="btn secondary" data-act="cancel">Cancel</button>
        <button class="btn" data-act="ok">Import</button>
      </div>`, m => {
        m.querySelector('[data-act=cancel]').onclick = () => UI.closeModal();
        m.querySelector('[data-act=ok]').onclick = () => {
          const code = m.querySelector('textarea').value;
          if (State.importSave(code)) {
            UI.closeModal();
            UI.toast('Save imported!', 'success');
            UI.render();
          } else UI.toast('Invalid save code.', 'error');
        };
      });
  };

  document.getElementById('btn-reset').onclick = () => {
    UI.confirm('Reset game?', 'This permanently deletes your hero, skills, items and quests.', 'Delete everything', () => {
      State.reset();
      UI.toast('Game reset. A fresh adventure awaits!', 'success');
      UI.render();
    });
  };
})();
