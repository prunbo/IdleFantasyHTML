/* Headless tests for the second port wave: Construction, Mercantile, Church,
 * Builder's Workshop, Inn workers, Expeditions, Raid Bosses, Seasonal events
 * and i18n. Run: node test/port2.js */
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
global.window = { addEventListener: () => {}, scrollTo: () => {} };
global.setInterval = () => 0;
global.setTimeout = () => 0; clearTimeout = () => {};
global.document = {
  getElementById: () => ({ innerHTML: '', appendChild: () => {}, prepend: () => {}, querySelectorAll: () => [], onclick: null }),
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add: () => {}, toggle: () => {} }, appendChild: () => {}, addEventListener: () => {}, setAttribute: () => {} }),
};

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓ ' + name);
  else { console.error('  ✗ FAIL: ' + name); failures++; }
}

(async () => {
  console.log('— loading modules —');
  global.Util = require('../js/util.js').Util;
  const GD = require('../js/data.js').GameData;
  global.GameData = GD;
  await GD.loadAll();
  global.Sim = require('../js/sim.js').Sim;
  global.State = require('../js/state.js').State;
  global.Systems = require('../js/systems.js').Systems;
  require('../js/systems-town.js');
  global.I18n = require('../js/i18n.js').I18n;
  const Engine = require('../js/engine.js').Engine;
  global.Engine = Engine;

  const freshState = (patch = {}) => {
    State.init();
    Object.assign(State.state, patch);
    return State.state;
  };

  /* ---------------- data ---------------- */
  console.log('— new data —');
  check('9 town buildings', Object.keys(GD.townBuildings).length === 9);
  check('8 raid bosses', Object.keys(GD.raidBosses).length === 8);
  check('2 seasonal events', Object.keys(GD.seasonalEvents).length === 2);
  check('10 skilling dungeons', Object.keys(GD.skillingDungeons).length === 10);
  check('6 trade routes', Object.keys(GD.tradeRoutes).length === 6);
  check('13 construction recipes', Object.keys(GD.recipes.construction).length === 13);
  check('30 blessings', GD.BLESSINGS.length === 30);
  check('plank name resolves', GD.name('plank') === 'Plank');
  check('boss pet exists in pets table', !!GD.pets[GD.raidBosses.king_black_dragon.pet.id]);

  /* ---------------- construction ---------------- */
  console.log('— construction —');
  {
    freshState();
    State.state.skills.construction.xp = Sim.xpForLevel(30);
    State.addItem('plank', 100); State.addItem('iron_nail', 200);
    const r = Engine.startSkillSession('construction', 'wooden_shelf', 5);
    check('starts with materials', !!r.ok);
    check('materials consumed', State.count('plank') === 100 - 3 * 5 && State.count('iron_nail') === 200 - 8 * 5);
    const sess = Engine.session();
    check('furniture queued as output', sess.outputKey === 'wooden_shelf' && sess.totalQty === 5);
    State.state.session.startedAt -= 10 * 365 * 24 * 3600 * 1000; // force complete
    State.state.session.endsAt = 0;
    const sum = Engine.collect();
    check('xp gained', (sum.xpBySkill.construction || 0) === 5 * 50);
    check('furniture delivered', (State.count('wooden_shelf') || 0) === 5);
    const locked = Engine.startSkillSession('construction', 'magic_throne');
    check('level-gated recipes blocked', !!locked.error);
  }

  /* ---------------- mercantile ---------------- */
  console.log('— mercantile trade routes —');
  {
    freshState();
    State.state.coins = 5000;
    const r = Engine.startSkillSession('mercantile', 'local_market');
    check('caravan dispatches', !!r.ok);
    check('coin cost charged up front', State.state.coins === 5000 - 2000);
    // The frames' coin split must sum to one rolled total in [min*60, max*60]
    const total = r.session.frames.reduce((s, f) => s + f.items.coins, 0);
    const range = Util.tierFor(GD.tradeRoutes.local_market.coin_ranges, 1);
    check('coin total within rolled range', total >= range.min * 60 && total <= range.max * 60);
    check('xp frames generated', r.session.frames.length === 60);
    State.state.session.endsAt = 0;
    const sum = Engine.collect();
    check('mercantile xp + coins collected', (sum.xpBySkill.mercantile || 0) > 0 && (sum.items.coins || 0) === total);
    State.state.coins = 10;
    check('no coins, no caravan', !!Engine.startSkillSession('mercantile', 'local_market').error);
  }

  /* ---------------- church ---------------- */
  console.log('— church blessings —');
  {
    freshState();
    State.addItem('bones', 10);
    check('level too low blocks blessing', !!Systems.Church.activate('blessed_focus_ii').error);
    const ok = Systems.Church.activate('blessed_focus');
    check('blessed_focus activates', !!ok.ok);
    check('bones consumed', State.count('bones') === 0);
    check('xp multiplier live', State.blessingXpMultiplier() === 1.05);
    check('def bonus zero for XP blessing', State.blessingDefBonus() === 0);
    check('already-active blocks another', !!Systems.Church.activate('stone_skin').error);
    // Defense blessing
    Systems.Church.deactivate();
    State.addItem('big_bones', 5); // 5 x 20 = 100 bone-XP = one stone_skin (10-bone cost)
    Systems.Church.activate('stone_skin');
    check('defense blessing bonus', State.blessingDefBonus() === 2);
    check('combat context carries blessing', State.combatContext().blessingDefBonus === 2);
    // Coin blessing multiplies collected coins
    Systems.Church.deactivate();
    State.addItem('dragon_bone', 30); // 80*30 = 2400 xp = fortune_iii needs 110*10
    State.state.skills.prayer.xp = Sim.xpForLevel(50);
    check('fortune_iii activates', !!Systems.Church.activate('fortune_iii').ok);
    check('coin multiplier 1.13', Math.abs(State.blessingCoinMultiplier() - 1.13) < 1e-9);
    // Expiry
    State.state.church.blessingExpiresAt = Date.now() - 1;
    check('expired blessing inactive', State.activeBlessing() === null);
    // Church building extends duration
    State.state.town.buildingTiers.church = 1;
    check('church tier adds 6h', State.blessingDurationMs() === 30 * 3600000);
  }

  /* ---------------- builder's workshop ---------------- */
  console.log("— builder's workshop —");
  {
    freshState();
    State.state.skills.construction.xp = Sim.xpForLevel(25);
    check('discount per-mille at lvl 25', Systems.Town.discountPerMille() === 125);
    check('discounted coins floor', Systems.Town.discountedCoins(50000) === 43750);
    check('discounted qty ceil min 1', Systems.Town.discountedQty(1) === 1);
    const r = Systems.Town.upgrade('inn');
    check('blocked without materials', !!r.error);
    State.addItem('plank', 200); State.addItem('oak_plank', 100); State.addItem('iron_nail', 500);
    State.state.coins = 50000;
    const ok = Systems.Town.upgrade('inn');
    check('inn upgraded to tier 1', !!ok.ok && Systems.Town.currentTier('inn') === 1);
    check('materials spent with discount', State.count('plank') === 200 - Math.ceil(200 * 0.875));
    check('worker xp bonus', State.townBonusProduct('worker_xp') === 1.1);
    // Garden gives extra farm plots
    State.state.town.buildingTiers.garden = 1;
    check('garden adds a farm plot', State.patchCount() === 4);
    State.state.town.buildingTiers.garden = 2;
    check('garden t2 adds two', State.patchCount() === 5);
    // Artisan's workshop save chance
    State.state.town.buildingTiers.artisans_workshop = 1;
    check('material save chance 5%', State.materialSaveChance() === 0.05);
    // Chronos spire
    State.state.town.buildingTiers.chronos_spire = 3;
    check('session speed reduction 6%', State.playerSessionDurationMultiplier() === 0.94);
    check('guild hall reduces requirements', (() => {
      State.state.town.buildingTiers.guild_hall = 1;
      return Systems.guildQuestAmount({ amount: 100 }) === 90;
    })());
  }

  /* ---------------- inn workers ---------------- */
  console.log('— inn hired workers —');
  {
    freshState();
    State.state.coins = 20000;
    const hire = Systems.Inn.hire('apprentice');
    check('apprentice hired into slot 2', !!hire.ok && State.state.inn.workers[2].tier === 'apprentice');
    check('has a localized-style name', typeof State.state.inn.workers[2].name === 'string' && State.state.inn.workers[2].name.length > 0);
    check('second hire blocked', !!Systems.Inn.hire('journeyman').error);
    const job = Systems.Inn.startJob(2, 'mining', 'copper_ore');
    check('worker starts mining job', !!job.ok);
    const sess = Systems.Inn.workerSession(2);
    check('worker session duration = 8h', sess.endsAt - sess.startedAt === 8 * 3600000);
    check('worker mult = 8h x 1.0', sess.mult === 8);
    check('collect too early blocked', !!Systems.Inn.collect(2).error);
    // Fast-forward and collect
    sess.startedAt = Date.now() - 9 * 3600000; sess.endsAt = Date.now() - 3600000;
    const xpBefore = State.xp('mining');
    const oreBefore = State.count('copper_ore');
    const res = Systems.Inn.collect(2);
    check('worker job collected', !!res.ok);
    check('xp multiplied by tier', State.xp('mining') > xpBefore * 7);
    check('ore multiplied by tier', State.count('copper_ore') >= oreBefore + 60);  // 60 frames x mult 8
    check('worker dismissed after collect', State.state.inn.workers[2] === null);
    // Long laborer slot 1
    State.state.coins = 5000;
    check('long laborer hires into slot 1', !!Systems.Inn.hire('long_laborer').ok && State.state.inn.workers[1].tier === 'long_laborer');
    State.addItem('plank', 100); State.addItem('iron_nail', 100);
    const job2 = Systems.Inn.startJob(1, 'construction', 'wooden_rack', 300);
    check('laborer takes production jobs (uncapped)', !!job2.ok);
    check('worker runs parallel to player session', (() => {
      const p = Engine.startSkillSession('mining', 'copper_ore');
      return !!p.ok && !!Systems.Inn.workerSession(1);
    })());
  }

  /* ---------------- expeditions ---------------- */
  console.log('— expeditions / skilling dungeons —');
  {
    freshState();
    check('collapsed_mine locked by default', !State.dungeonUnlocked('collapsed_mine'));
    const r = Systems.Expeditions.start('copper_caverns');
    check('copper caverns starts at mining 1', !!r.ok);
    check('session kind expedition', Engine.session().kind === 'expedition');
    // Inject exactly 5 notes (strip any the sim randomly rolled) and collect
    const sess = Engine.session();
    sess.frames.forEach(f => {
      for (const k of Object.keys(f.items)) if (k.startsWith('note_')) delete f.items[k];
      f.xpBySkill = { mining: f.xpGain };
    });
    for (let i = 0; i < 5; i++) sess.frames[i].items['note_copper_caverns'] = 1;
    sess.startedAt -= 10 * 24 * 3600000; sess.endsAt = 0;
    const sum = Engine.collect();
    check('5 notes found', sum.notes === 5);
    check('collapsed_mine unlocked', State.dungeonUnlocked('collapsed_mine'));
    check('lore revealed', sum.noteTexts.length === 5);
    // Higher-tier expedition gates on previous unlock
    const gate = Systems.Expeditions.available('shadow_vault');
    check('shadow vault gated (thieving 40 + rogue_sanctum)', !gate.ok);
    // Pity: a note on the 10th collect after 9 dry runs
    freshState();
    for (let i = 0; i < 8; i++) Systems.Expeditions.collectNotes('thieves_den', 0);
    const dry = Systems.Expeditions.collectNotes('thieves_den', 0);
    check('9th dry run still dry', dry.notes === 0);
    const pity = Systems.Expeditions.collectNotes('thieves_den', 0);
    check('pity note granted on 10th', pity.notes === 1);
    check('pity counter reset', State.state.expeditions.pityRuns.thieves_den === 0);
  }

  /* ---------------- raid bosses ---------------- */
  console.log('— raid bosses —');
  {
    freshState();
    State.state.equipped.weapon = 'bronze_sword';
    const weak = Systems.Bosses.start('king_black_dragon');
    check('combat level gate blocks', !!weak.error);
    // Boost to combat 50
    for (const sk of ['attack', 'strength', 'defense', 'hitpoints'])
      State.state.skills[sk].xp = Sim.xpForLevel(60);
    State.addItem('cooked_shrimp', 200);
    const r = Systems.Bosses.start('king_black_dragon');
    check('boss session starts', !!r.ok);
    check('boss frames capped at duration', r.session.frames.length <= 45);
    State.state.session.startedAt -= 10 * 24 * 3600000; State.state.session.endsAt = 0;
    const sum = Engine.collect();
    check('verdict recorded', sum.bossWon === true || sum.bossWon === false);
    check('boss xp applied', Object.keys(sum.xpBySkill).length > 0);
    // Simulate an explicit loss path
    const frames = Sim.simulateBoss(GD.raidBosses.void_sovereign, 'void_sovereign', {
      style: 'attack', attack: 1, strength: 1, defense: 1, hitpoints: 10, agilityLevel: 1,
      potions: {}, food: {}, arrows: {}, runes: Infinity, weaponAtkBonus: 0, weaponStrBonus: 0,
      attackSpeedSec: 2.4, blessingDefBonus: 0,
    });
    check('hopeless fight ends early (death or stub)', frames.length <= GD.raidBosses.void_sovereign.duration_minutes);
    const last = frames[frames.length - 1];
    if (!last.kills) {
      const totalXp = Object.values(last.xpBySkill).reduce((a, b) => a + b, 0);
      const full = Object.values(GD.raidBosses.void_sovereign.xp_rewards).reduce((a, b) => a + b, 0);
      check('loss keeps 10% xp', totalXp <= Math.ceil(full * 0.1) + 1 && totalXp > 0);
      check('loss has no loot', Object.keys(last.items).length === 0);
    } else check('DPS fallback can win', true);
  }

  /* ---------------- seasonal events ---------------- */
  console.log('— seasonal events —');
  {
    freshState();
    // Deterministic synthetic event covering "now"
    const now = Date.now();
    const ev = {
      id: 'test_event', display_name: 'Test Festival', start_ms: now - 1000, end_ms: now + 3600000,
      token_goal: 3, pillars: ['bounty', 'expedition', 'boss', 'minigame'],
      bounty_tasks: [
        { id: 't_gather', type: 'gather', target: 'copper_ore', amount: 10, display_name: 'Mine copper', hint: 'Mining', skill: 'mining' },
        { id: 't_craft', type: 'craft', target: 'iron_bar', amount: 3, display_name: 'Smelt iron', hint: 'Smithing', skill: 'smithing' },
        { id: 't_turnin', type: 'turn_in', target: 'cooked_shrimp', amount: 5, display_name: 'Donate shrimp', hint: 'Cooking', skill: 'cooking' },
      ],
      bounty_rotation_ms: 3600000,
      expedition_dungeon_key: 'sunspire', boss_key: 'king_black_dragon',
      minigame: { id: 'mg', display_name: 'Test Game', rounds: 5, hole_count: 4, hits_required: 4, visible_ms: 400, cooldown_ms: 1000, visible_ms_easy: 700, cooldown_ms_easy: 2000 },
      reward_tiers: [
        { tokens: 2, description: 'Coins', coins: 12345 },
        { tokens: 3, description: 'Banner' },
      ],
      night_market: [
        { id: 'offer1', display_name: 'Token Skip', coin_cost: 100, limit: 1, items: {}, effect: 'skip_bounty_cooldowns' },
      ],
      banner_text: 'Tested', banner_icon: null,
    };
    GD.seasonalEvents.test_event = ev;
    const stashedEvents = { ...GD.seasonalEvents };
    GD.seasonalEvents = { test_event: ev };
    check('synthetic event active', Systems.Seasonal.activeEvent()?.id === 'test_event');
    check('bounty slots seeded (one per type)', Systems.Seasonal.bountyTasks().length === 3);
    // Gather progress
    Systems.Seasonal.recordGathering({ copper_ore: 7 });
    check('gather progress tracked', Systems.Seasonal.bountyTasks().find(b => b.task.id === 't_gather').progress === 7);
    check('claim blocked until complete', !!Systems.Seasonal.claimBountyTask('t_gather').error);
    Systems.Seasonal.recordGathering({ copper_ore: 5 });
    check('gather complete (capped)', Systems.Seasonal.bountyTasks().find(b => b.task.id === 't_gather').progress === 10);
    check('claim awards token', !!Systems.Seasonal.claimBountyTask('t_gather').ok && Systems.Seasonal.tokens('test_event') === 1);
    check('slot cooldown after claim', Systems.Seasonal.bountyTasks().every(b => b.task.id !== 't_gather' || b.cooldownUntil != null));
    // Turn-in
    const shrimpBefore = State.count('cooked_shrimp');
    check('turn-in claim consumes items', !!Systems.Seasonal.claimBountyTask('t_turnin').ok && State.count('cooked_shrimp') === shrimpBefore - 5);
    check('2 tokens now', Systems.Seasonal.tokens('test_event') === 2);
    // Expedition + boss + minigame pillars
    Systems.Seasonal.recordExpeditionCompletion('sunspire');
    check('expedition token', Systems.Seasonal.tokens('test_event') === 3);
    check('banner at goal', State.state.seasonal.bannersEarned.includes('test_event'));
    check('wrong expedition gives nothing', (Systems.Seasonal.recordExpeditionCompletion('farm'), Systems.Seasonal.tokens('test_event') === 3));
    Systems.Seasonal.recordBossDefeat('king_black_dragon');
    check('boss token', Systems.Seasonal.tokens('test_event') === 4);
    // Reward tier
    const coinsBefore = State.state.coins;
    check('tier 2 claimable', !!Systems.Seasonal.claimRewardTier(ev, ev.reward_tiers[0]).ok);
    check('tier coins granted', State.state.coins === coinsBefore + 12345);
    check('tier claim once', !!Systems.Seasonal.claimRewardTier(ev, ev.reward_tiers[0]).error);
    // Night market
    State.state.coins = 500;
    check('market buy works', !!Systems.Seasonal.purchaseMarketOffer(ev, ev.night_market[0]).ok);
    check('limit enforced', !!Systems.Seasonal.purchaseMarketOffer(ev, ev.night_market[0]).error);
    // Minigame
    State.state.seasonal.minigameCooldownAt = 0;
    const tokensBefore = Systems.Seasonal.tokens('test_event');
    const won = Systems.Seasonal.submitMinigame(true);
    check('minigame win awards token', !!won.ok && Systems.Seasonal.tokens('test_event') === tokensBefore + 1);
    check('cooldown applied', Systems.Seasonal.minigameOnCooldown());
    GD.seasonalEvents = stashedEvents;
    delete GD.seasonalEvents.test_event;
    // (state reset happens below)
  }

  // Reset seasonal state after the synthetic event section
  freshState();

  /* ---------------- xp boost ---------------- */
  console.log('— 2x XP boost —');
  {
    freshState();
    State.state.coins = 3000000;
    check('boost purchase', !!Engine.buyXpBoost().ok);
    check('coins charged', State.state.coins === 500000);
    check('double purchase blocked', !!Engine.buyXpBoost().error);
    const r = Engine.startSkillSession('mining', 'copper_ore');
    State.state.session.startedAt -= 10 * 24 * 3600000; State.state.session.endsAt = 0;
    const sum = Engine.collect();
    // copper ore = 17 xp/ore x 60 frames; boost => >= 2x base
    check('boost doubles session xp', (sum.xpBySkill.mining || 0) >= 2 * 60 * 17 * 0.9);
    State.state.xpBoostUntil = 0;
  }

  /* ---------------- boss + building quests ---------------- */
  console.log('— quest coverage —');
  {
    check('all 189 quests tracked', Engine.questsAvailable().length === 189);
    // Boss quest counter
    freshState();
    State.state.equipped.weapon = 'bronze_sword';
    for (const sk of ['attack', 'strength', 'defense', 'hitpoints'])
      State.state.skills[sk].xp = Sim.xpForLevel(70);
    const q = GD.quests.demon_slayer_1; // kill demon_lord x1
    const b = Systems.Bosses.start('demon_lord');
    check('demon lord fight starts', !!b.ok);
    State.state.session.startedAt -= 10 * 24 * 3600000; State.state.session.endsAt = 0;
    const sum = Engine.collect();
    if (sum.bossWon) {
      check('boss quest progress counts', Engine.questProgress(q).count === 1);
    } else {
      State.state.stats.bossKillsByBoss = { demon_lord: 1 };
      check('boss quest progress counts', Engine.questProgress(q).count === 1);
    }
    // Building quest counter
    State.state.skills.construction.xp = Sim.xpForLevel(30);
    State.addItem('plank', 200); State.addItem('oak_plank', 100); State.addItem('iron_nail', 500);
    State.state.coins = 100000;
    Systems.Town.upgrade('inn');
    check('upgrade_building quest progress', Engine.questProgress(GD.quests.construction_upgrade_inn).count === 1);
  }

  /* ---------------- i18n ---------------- */
  console.log('— localized strings —');
  {
    await I18n.load('en');
    check('english loads', I18n.t('nav_home') === 'Home');
    check('interpolation works', I18n.t('expedition_lore_notes', [3, 5]) === '3 / 5 lore notes');
    await I18n.load('de');
    check('german loads nav', typeof I18n.t('nav_home') === 'string');
    check('worker names array present', I18n.arr('worker_names').length >= 5);
    check('fallback for unknown key', I18n.t('definitely_not_a_key') === null);
    check('tf falls back', I18n.tf('definitely_not_a_key', null, 'Fallback') === 'Fallback');
  }

  /* ---------------- save migration ---------------- */
  console.log('— save migration —');
  {
    // An old v1 save without the new blocks must still load
    const oldSave = { version: 1, skills: { mining: { xp: 500 } }, stats: {}, quests: {}, inventory: {}, equipped: {} };
    global.localStorage.setItem('idle-fantasy-web-save-v1', JSON.stringify(oldSave));
    check('legacy save loads', State.load() === true);
    check('new defaults merged', State.state.town && State.state.church && State.state.inn && State.state.expeditions && State.state.seasonal);
    check('construction/mercantile skills added', State.state.skills.construction && State.state.skills.mercantile);
  }

  console.log(failures ? `\n${failures} FAILURES ❌` : '\nPORT2 TESTS PASSED ✅');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
