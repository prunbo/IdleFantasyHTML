/* file:// boot test: loads the game with NO fetch and NO HTTP server — exactly
 * what happens when index.html is opened straight from disk. The embedded
 * js/game-bundle.js must supply every asset. Run: node test/file-protocol.js */
'use strict';

// NOTE: deliberately NO global.fetch here — that's the point.
global.localStorage = (() => {
  let store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
})();
global.window = { addEventListener: () => {}, scrollTo: () => {} };
global.setInterval = () => 0;
global.document = {
  getElementById: () => ({ innerHTML: '', appendChild: () => {}, prepend: () => {}, querySelectorAll: () => [] }),
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add: () => {}, toggle: () => {} }, appendChild: () => {} }),
};

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log('  ✓ ' + name);
  else { console.error('  ✗ FAIL: ' + name); failures++; }
};

(async () => {
  // 1. The embedded bundle loads on its own
  const { GAME_BUNDLE } = require('../js/game-bundle.js');
  // In the browser, game-bundle.js is a classic script loaded before data.js,
  // so its top-level const is visible to later scripts. Mirror that here:
  global.GAME_BUNDLE = GAME_BUNDLE;
  check('bundle is non-empty', Object.keys(GAME_BUNDLE).length >= 90);
  check('bundle covers data + locales',
    ['xp_table.json', 'dungeons.json', 'dungeons/farm.json', 'skilling_dungeons/copper_caverns.json',
     'trade_routes/local_market.json', 'recipes/construction.json', 'buildings.json', 'raid_bosses.json',
     'seasonal_events.json', 'i18n/en.json', 'i18n/de.json']
      .every(k => GAME_BUNDLE[k] != null));

  // 2. Full boot with no fetch anywhere
  global.Util = require('../js/util.js').Util;
  const GD = require('../js/data.js').GameData;
  global.GameData = GD;
  await GD.loadAll();
  check('GameData.loadAll() boots from the bundle', GD.loaded);
  check('29 dungeons', Object.keys(GD.dungeons).length === 29);
  check('town buildings present', Object.keys(GD.townBuildings).length === 9);

  global.Sim = require('../js/sim.js').Sim;
  global.State = require('../js/state.js').State;
  global.Systems = require('../js/systems.js').Systems;
  require('../js/systems-town.js');
  global.I18n = require('../js/i18n.js').I18n;
  const Engine = require('../js/engine.js').Engine;
  global.Engine = Engine;
  const UI = require('../js/ui.js').UI;
  global.UI = UI;
  require('../js/ui-town.js');

  await I18n.load('pt-BR');
  check('locale loads from the bundle', I18n.t('nav_home') !== null);
  State.init();

  // 3. Play a session purely offline-file style
  State.state.coins = 10000;
  const r = Engine.startSkillSession('mining', 'copper_ore');
  check('session starts', !!r.ok);
  State.state.session.startedAt -= 1e11; State.state.session.endsAt = 0;
  const sum = Engine.collect();
  check('session collects', (sum.xpBySkill.mining || 0) > 0);
  const m = Engine.startSkillSession('mercantile', 'local_market');
  check('mercantile works offline', !!m.ok);
  State.state.session.startedAt -= 1e11; State.state.session.endsAt = 0;
  Engine.collect();
  check('save still round-trips', typeof localStorage.getItem('idle-fantasy-web-save-v1') === 'string');

  console.log(failures ? `\n${failures} FAILURES ❌` : '\nFILE:// BOOT TESTS PASSED ✅ — double-click index.html and it runs');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
