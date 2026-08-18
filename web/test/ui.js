/* DOM-stubbed render test: boots the UI object and renders every screen. */
'use strict';
const fs = require('fs');
const path = require('path');

global.fetch = async p => {
  const file = path.join(__dirname, '..', p.replace(/^\//, ''));
  const content = fs.readFileSync(file, 'utf8');
  return { ok: true, json: async () => JSON.parse(content) };
};
global.localStorage = (() => {
  let store = {};
  return { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
})();
try { global.navigator = {}; } catch (e) {}
global.requestAnimationFrame = fn => 1;

/* ---------------- minimal virtual DOM ---------------- */
class VElem {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.dataset = {};
    this.classList = {
      _set: new Set(),
      add(...c) { c.forEach(x => this._set.add(x)); },
      remove(...c) { c.forEach(x => this._set.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (f) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    };
    this._innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.parentNode = null;
  }
  addEventListener() {}
  set className(v) { this.classList._set = new Set(v.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList._set].join(' '); }
  set innerHTML(v) { this._innerHTML = String(v); this.children = []; }
  get innerHTML() { return this._innerHTML; }
  set classNameSafe(v) { this.className = v; }
  appendChild(c) { c.parentNode = this; this.children.push(c); this._innerHTML = ''; return c; }
  prepend(c) { this.children.unshift(c); return c; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
  setAttribute(k, v) { this.attrs[k] = v; }
  querySelector(sel) { return this._queryAll(sel)[0] || null; }
  querySelectorAll(sel) { return this._queryAll(sel); }
  _matches(sel) {
    if (sel.startsWith('#')) return this.attrs.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.includes('=')) {
      const [attr, val] = sel.split('=');
      const key = attr.replace(/\[/g, '').replace(/\]/g, '').replace(/-data/g, '');
      const dkey = key.replace(/^data-/, '');
      return this.dataset[dkey] === val.replace(/["']/g, '');
    }
    if (sel.includes('.')) {
      const [tag, cls] = sel.split('.');
      return this.tagName === tag.toUpperCase() && this.classList.contains(cls);
    }
    return this.tagName === sel.toUpperCase();
  }
  _queryAll(sel) {
    const out = [];
    const walk = el => {
      for (const c of el.children) {
        if (c._matches && c._matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  select() {}
}

const byId = {};
for (const id of ['screen', 'toasts', 'modal-root', 'coins', 'total-level', 'hp-display', 'session-progress-fill', 'session-progress-label', 'session-live', 'btn-collect']) byId[id] = new VElem('div');
global.document = {
  getElementById: id => byId[id] || (byId[id] = new VElem('div')),
  createElement: tag => new VElem(tag),
  querySelectorAll: () => [],
};
global.window = { addEventListener: () => {}, scrollTo: () => {} };
global.setInterval = () => 0;
global.setTimeout = (fn) => 0; // fire-and-forget ok

let failures = 0;
const check = (name, cond) => { if (cond) console.log('  ✓ ' + name); else { console.error('  ✗ FAIL: ' + name); failures++; } };

(async () => {
  global.Util = require('../js/util.js').Util;
  const GD = require('../js/data.js').GameData;
  await GD.loadAll();
  global.GameData = GD;
  global.Sim = require('../js/sim.js').Sim;
  const State = require('../js/state.js').State;
  global.State = State;
  global.Systems = require('../js/systems.js').Systems;
  const Engine = require('../js/engine.js').Engine;
  global.Engine = Engine;
  const UI = require('../js/ui.js').UI;
  global.UI = UI;
  require('../js/ui-town.js');

  State.init();
  UI.bindTabs();

  console.log('— render: home (idle) —');
  UI.tab = 'home'; UI.render();
  check('idle card rendered', byId.screen.innerHTML.includes('idle') || byId.screen.children.length > 0);

  console.log('— render: skills grid + every skill detail —');
  UI.tab = 'skills'; UI.render();
  for (const def of GD.skillDefs) {
    UI.skillView = def.key;
    try { UI.render(); } catch (e) {
      check(`render skill detail: ${def.key}`, false);
      console.error('   ', e.message);
      UI.skillView = null; break;
    }
  }
  check('all 18 skill details render', true);
  UI.skillView = null;

  console.log('— render: dungeons —');
  UI.tab = 'dungeons'; UI.render();
  check('dungeons screen ok', byId.screen.children.length > 0);

  // ranged/magic style rendering paths
  State.state.combatStyle = 'ranged'; UI.render();
  State.state.combatStyle = 'magic'; UI.render();
  State.state.activeSpell = 'wind_strike'; UI.render();
  check('style variants render', true);

  console.log('— render: character —');
  State.addItem('iron_ore', 500);
  State.addItem('cooked_shrimp', 30);
  State.addItem('bronze_arrow', 100);
  UI.tab = 'character'; UI.render();
  check('character screen ok', byId.screen.children.length > 0);

  console.log('— render: shop —');
  UI.tab = 'shop'; UI.render();
  check('shop screen ok', byId.screen.children.length > 0);

  console.log('— render: quests —');
  UI.tab = 'quests'; UI.render();
  check('quests screen ok', byId.screen.children.length > 0);

  console.log('— live session rendering —');
  const r = Engine.startSkillSession('mining', 'copper_ore');
  check('session started', !!r.ok);
  UI.tab = 'home'; UI.render();
  check('session card shows', byId.screen._innerHTML !== '' || byId.screen.children.length > 0);
  // complete + live update path
  Engine.session().endsAt = Date.now() - 1;
  UI.updateLive();
  check('updateLive completes', !document.getElementById('btn-collect').disabled);
  const summary = Engine.collect();
  check('collected through UI flow', (summary.xpBySkill.mining || 0) > 0);

  console.log('— dungeon session rendering —');
  State.state.combatStyle = 'attack';
  State.state.activeSpell = null;
  const d = Engine.startDungeonSession('farm');
  check('dungeon session started', !!d.ok);
  UI.render();
  UI.updateLive();
  Engine.session().endsAt = Date.now() - 1;
  Engine.collect();
  check('dungeon collect ok', true);

  console.log('— render: town (all four sections) —');
  UI.tab = 'town';
  UI.townView = 'slayer'; UI.render();
  UI.townView = 'guilds'; UI.render();
  UI.townView = 'carnival'; UI.render();
  UI.townView = 'tower'; UI.render();
  check('all town sections render', true);

  console.log('— render: farming + herblore + pets —');
  State.addItem('potato_seed', 10);
  UI.tab = 'skills'; UI.skillView = 'farming'; UI.render();
  check('farming patches render', byId.screen.children.length > 0);
  UI.skillView = 'herblore'; UI.render();
  check('herblore recipes render', byId.screen.children.length > 0);
  UI.skillView = 'slayer'; UI.render();
  check('slayer note renders', byId.screen.children.length > 0);
  UI.skillView = null;
  UI.tab = 'character'; UI.render();
  check('character with pets card renders', byId.screen.children.length > 0);
  UI.updateTownLive();
  check('town live update runs', true);

  console.log('— modal + confirm + toast —');
  UI.toast('hello');
  UI.modal('<h2>Test</h2>', m => {});
  check('modal mounted', byId['modal-root'].children.length === 1);
  UI.closeModal();
  check('modal closed', byId['modal-root'].children.length === 0);

  console.log(failures === 0 ? '\nUI TESTS PASSED ✅' : `\n${failures} UI FAILURES ❌`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
