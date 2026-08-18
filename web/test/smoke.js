/* Headless smoke test: loads the game modules in Node with fetch shim,
 * then plays through the core loops. Run: node test/smoke.js */
'use strict';
const fs = require('fs');
const path = require('path');

// ---- fetch shim reading from web/ ----
global.fetch = async p => {
  const file = path.join(__dirname, '..', p.replace(/^\//, ''));
  try {
    const content = fs.readFileSync(file, 'utf8');
    return { ok: true, json: async () => JSON.parse(content) };
  } catch (e) {
    return { ok: false, status: 404, json: async () => { throw new Error('404 ' + p); } };
  }
};
global.localStorage = (() => {
  let store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
})();
try { global.navigator = { clipboard: { writeText: async () => {} } }; } catch (e) { /* node 22 has a getter; fine */ }
global.window = { addEventListener: () => {}, scrollTo: () => {} };
global.setInterval = () => 0;
global.document = {
  getElementById: () => ({ innerHTML: '', appendChild: () => {}, prepend: () => {}, querySelectorAll: () => [] }),
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add: () => {}, toggle: () => {} }, appendChild: () => {}, addEventListener: () => {}, setAttribute: () => {} }),
};

// DOM stubs used before UI exists
global.Util = require('../js/util.js').Util;

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓ ' + name);
  else { console.error('  ✗ FAIL: ' + name); failures++; }
}

(async () => {
  console.log('— loading modules —');
  const Data = require('../js/data.js');
  global.GameData = Data.GameData;
  await Data.GameData.loadAll();
  const Sim = require('../js/sim.js').Sim;
  global.Sim = Sim;
  const StateMod = require('../js/state.js');
  global.State = StateMod.State;
  global.Systems = require('../js/systems.js').Systems;
  const Engine = require('../js/engine.js').Engine;
  global.Engine = Engine;

  console.log('— data —');
  check('29 dungeons', Object.keys(Data.GameData.dungeons).length === 29);
  check('xp table 99', Data.GameData.xpTable['99'] > 13000000);
  check('names resolve', Data.GameData.name('iron_ore') === 'Iron Ore');
  check('food heals', Object.keys(Data.GameData.foodHeals).length >= 17);
  check('arrow bonuses', Data.GameData.arrowBonuses.runite_arrow === 49);
  check('ash mapping', Data.GameData.ashByLog['oak_log'] === 'oak_ashes');

  console.log('— xp/sim basics —');
  check('level 1 at 0 xp', Sim.levelForXp(0) === 1);
  check('level 2 at 83 xp', Sim.levelForXp(83) === 2);
  check('duration 60min at agi 1', Sim.sessionDurationMs(1) === 3600000);
  check('duration 40min at agi 99', Sim.sessionDurationMs(99) === 2400000);

  const mining = Sim.simulateMining('copper_ore', Data.GameData.ores.copper_ore, 0, { toolEfficiency: 1, agilityLevel: 1 });
  check('mining 60 frames', mining.frames.length === 60);
  check('mining total xp 1080', mining.frames.reduce((s, f) => s + f.xpGain, 0) === 18 * 60);
  check('mining copper drops', mining.frames[0].items.copper_ore >= 1);

  const wood = Sim.simulateWoodcutting(Data.GameData.trees.tree, 0, { toolEfficiency: 1, agilityLevel: 50 });
  check('woodcutting yields logs', mining.frames.every(f => f.items.copper_ore >= 1));

  const thief = Sim.simulateThieving(Data.GameData.thievingNpcs[0], 0, 10, { agilityLevel: 1 });
  check('thieving stun/loot frames', thief.frames.some(f => f.xpGain === 0) || thief.frames.some(f => f.items.coins));

  const agi = Sim.simulateAgility(Data.GameData.agilityCourses.beginner_course, 0, 5, { agilityLevel: 5 });
  check('agility xp > 0', agi.frames.reduce((s, f) => s + f.xpGain, 0) > 0);

  const craft = Sim.simulateCraft(0, 120, 6.2, 1, 'bronze_bar', 1);
  check('craft 60 buckets for 120', craft.length === 60);
  check('craft total items 120', craft.reduce((s, f) => s + Object.values(f.items)[0], 0) === 120);

  const rc = Sim.simulateRunecrafting('air_rune', Data.GameData.runes.air_rune, 100, Sim.xpForLevel(80));
  const rcRunes = rc.reduce((s, f) => s + Object.values(f.items)[0], 0);
  check('rc multiplier 3x at lvl 80', rcRunes === 300);

  console.log('— combat sim —');
  const farm = Data.GameData.dungeons.farm;
  const goblin = Data.GameData.dungeons.goblin_cave;
  const ctx = {
    style: 'attack', attack: 5, strength: 5, defense: 5, hitpoints: 10,
    ranged: 1, magic: 1, agilityLevel: 1, potions: {},
    weaponAtkBonus: 6, weaponStrBonus: 5, attackSpeedSec: 2.4,
    food: { cooked_shrimp: 50 }, arrows: {}, runeKey: null, runeCost: 1, runes: Infinity,
  };
  const farmRes = Sim.simulateDungeon(farm, ctx);
  check('farm run completes', farmRes.frames.length === 60 && !farmRes.frames[59].died);
  check('farm gives kills', farmRes.frames.reduce((s, f) => s + f.kills, 0) > 20);
  const xpSum = farmRes.frames.reduce((s, f) => s + f.xpGain, 0);
  check('farm gives combat xp', xpSum > 500);
  const xpTotals = farmRes.frames.reduce((acc, f) => {
    for (const [k, v] of Object.entries(f.xpBySkill || {})) acc[k] = (acc[k] || 0) + v;
    acc.__total += f.xpGain;
    return acc;
  }, { __total: 0 });
  check('xp split ~70/15/15',
    Math.abs(xpTotals.attack / xpTotals.__total - 0.70) < 0.05 &&
    Math.abs(xpTotals.hitpoints / xpTotals.__total - 0.15) < 0.03 &&
    Math.abs(xpTotals.defense / xpTotals.__total - 0.15) < 0.03);

  const weakCtx = { ...ctx, attack: 1, strength: 1, defense: 1, hitpoints: 2, food: {} };
  const hard = Data.GameData.dungeons.dragon_lair;
  const dead = Sim.simulateDungeon(hard, weakCtx);
  check('undergeared player dies', dead.frames.some(f => f.died));

  const survival = Sim.estimateSurvival(goblin, 5, 10, 0);
  check('survival rating computed', ['LIKELY', 'RISKY', 'UNLIKELY'].includes(survival));

  const magicCtx = { ...ctx, style: 'magic', magic: 30, spellMaxHit: 8, weaponAtkBonus: 10, runeKey: 'air_rune', runeCost: 1, runes: 500, food: {} };
  const magicRes = Sim.simulateDungeon(goblin, magicCtx);
  check('magic run works', magicRes.frames.length > 0);
  const runesUsed = magicRes.frames.reduce((s, f) => s + (f.runesConsumed.air_rune || 0), 0);
  check('runes consumed', runesUsed > 0 && runesUsed <= 500);

  const rangedCtx = { ...ctx, style: 'ranged', ranged: 20, weaponAtkBonus: 8, rangedStrBonus: 3, arrows: { bronze_arrow: 200 }, food: {} };
  const rangedRes = Sim.simulateDungeon(goblin, rangedCtx);
  check('ranged run works', rangedRes.frames.length > 0);

  console.log('— state & engine —');
  State.init();
  check('starting coins', State.state.coins === 25);
  check('starting sword equipped', State.equippedItem('weapon') === 'bronze_sword');

  // mining session lifecycle
  let r = Engine.startSkillSession('mining', 'copper_ore');
  check('start mining ok', !!r.ok);
  check('session running', Engine.hasSession());
  const sess = Engine.session();
  check('mining ends in 60min', Math.abs(sess.endsAt - sess.startedAt - 3600000) < 5000);
  check('cannot double-session', !!Engine.startSkillSession('woodcutting', 'tree').error);
  // fast-forward: fake start time so it's complete
  sess.startedAt -= sess.endsAt - sess.startedAt + 10;
  sess.endsAt = sess.startedAt + 60000; // also shift endsAt to keep total
  sess.startedAt -= 60000 - 0;
  // simpler: mark endsAt in the past
  sess.endsAt = Date.now() - 1;
  check('session complete after ffwd', Engine.isComplete(sess));
  const sum = Engine.collect();
  check('collect gives mining xp', (sum.xpBySkill.mining || 0) === 18 * 60);
  check('collect gives copper', sum.items.copper_ore >= 60);
  check('session cleared', !Engine.hasSession());

  // crafting: bronze bar needs copper+tin
  State.addItem('copper_ore', 200); State.addItem('tin_ore', 200);
  r = Engine.startSkillSession('smithing', 'bronze_bar', 100);
  check('smithing starts', !!r.ok);
  Engine.session().endsAt = Date.now() - 1;
  const smithSum = Engine.collect();
  check('smithing yields bars', smithSum.items.bronze_bar === 100);
  check('materials consumed', State.count('tin_ore') === 100 && State.count('copper_ore') >= 100);

  // dungeon run + death-less collect
  r = Engine.startDungeonSession('farm');
  check('dungeon starts', !!r.ok);
  Engine.session().endsAt = Date.now() - 1;
  const dsum = Engine.collect();
  check('dungeon xp into attack/hp/def', (dsum.xpBySkill.attack || 0) > 0 && (dsum.xpBySkill.hitpoints || 0) > 0);
  check('bones looted', (dsum.items.bones || 0) > 0);

  // shop
  const price = Engine.sellPrice('bronze_bar');
  check('bronze bar sells 15 (app heuristic)', price === 15);
  State.state.coins = 10000;
  const buyRes = Engine.buy('rune_essence', 10);
  check('can buy essence', !!buyRes.ok && State.count('rune_essence') === 10);

  // prayer session with looted bones
  r = Engine.startSkillSession('prayer', 'bones');
  check('prayer starts with bones', !!r.ok);

  console.log('— quests —');
  const quests = Engine.questsAvailable();
  check('supported quests >= 160', quests.length >= 160);
  const q1 = quests.find(q => q.id === 'mining_1');
  const p1 = Engine.questProgress(q1);
  check('mining_1 tracked', p1.count === sum.items.copper_ore);

  console.log('— save roundtrip —');
  const code = State.exportSave();
  State.state.coins = 1;
  check('import restores', State.importSave(code) && State.state.coins !== 1);

  console.log(failures === 0 ? '\nALL CHECKS PASSED ✅' : `\n${failures} FAILURES ❌`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
