/* ------------------------------------------------------------------ *
 * ui.js — all screen rendering + interactions
 * ------------------------------------------------------------------ */
'use strict';

const UI = {
  tab: 'home',
  skillView: null,        // open skill detail
  toastTimer: null,
  qtySelections: {},      // recipeKey -> chosen qty preset

  /* ============================ helpers ============================ */

  screenEl() { return document.getElementById('screen'); },

  toast(msg, type = 'info') {
    const box = document.getElementById('toasts');
    const t = Util.el('div', 'toast ' + type, Util.esc(msg));
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => t.remove(), 3000);
  },

  modal(html, onMount) {
    this.closeModal();
    const root = document.getElementById('modal-root');
    const backdrop = Util.el('div', 'modal-backdrop');
    const m = Util.el('div', 'modal', html);
    backdrop.appendChild(m);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) this.closeModal(); });
    root.appendChild(backdrop);
    if (onMount) onMount(m);
  },

  closeModal() { document.getElementById('modal-root').innerHTML = ''; },

  confirm(title, body, okLabel, onOk) {
    this.modal(`
      <h2>${Util.esc(title)}</h2>
      <p class="card-sub">${Util.esc(body)}</p>
      <div class="modal-actions">
        <button class="btn secondary" data-act="cancel">Cancel</button>
        <button class="btn danger-btn" data-act="ok" style="background:linear-gradient(180deg,#b23b3b,#8f2d2d);border-color:var(--red)">${Util.esc(okLabel)}</button>
      </div>`, m => {
        m.querySelector('[data-act=cancel]').onclick = () => this.closeModal();
        m.querySelector('[data-act=ok]').onclick = () => { this.closeModal(); onOk(); };
      });
  },

  /* ============================ render loop ============================ */

  render() {
    this.renderTopbar();
    const screen = this.screenEl();
    screen.innerHTML = '';
    switch (this.tab) {
      case 'home': screen.appendChild(this.renderHome()); break;
      case 'skills': screen.appendChild(this.skillView ? this.renderSkillDetail(this.skillView) : this.renderSkills()); break;
      case 'dungeons': screen.appendChild(this.renderDungeons()); break;
      case 'character': screen.appendChild(this.renderCharacter()); break;
      case 'shop': screen.appendChild(this.renderShop()); break;
      case 'quests': screen.appendChild(this.renderQuests()); break;
      case 'town': screen.appendChild(this.renderTown ? this.renderTown() : Util.el('div', 'empty-note', 'Town not loaded.')); break;
    }
  },

  /** Cheap per-tick refresh of live elements (no full re-render). */
  updateLive() {
    this.renderTopbar();
    if (this.updateTownLive) this.updateTownLive();
    const bar = document.getElementById('session-progress-fill');
    const label = document.getElementById('session-progress-label');
    const live = document.getElementById('session-live');
    const btn = document.getElementById('btn-collect');
    if (!bar || !label || !live || !btn) { return; }
    const sess = Engine.session();
    if (!sess) return;
    const total = sess.endsAt - sess.startedAt;
    const pct = Util.clamp(((Date.now() - sess.startedAt) / total) * 100, 0, 100);
    bar.style.width = pct + '%';
    bar.classList.toggle('done', Engine.isComplete(sess));
    const remaining = Math.max(0, sess.endsAt - Date.now());
    label.textContent = Engine.isComplete(sess) ? 'Ready to collect!' : Util.fmtTime(remaining) + ' remaining';
    live.innerHTML = this._liveStatsHtml(sess);
    btn.disabled = !Engine.isComplete(sess);
    btn.textContent = Engine.isComplete(sess) ? '📦 Collect rewards' : '⏳ In progress…';
  },

  renderTopbar() {
    document.getElementById('coins').textContent = Util.fmt(State.state.coins);
    document.getElementById('total-level').textContent = State.totalLevel();
    document.getElementById('hp-display').textContent = State.level('hitpoints') * 10;
  },

  /* ============================ HOME ============================ */

  renderHome() {
    const wrap = Util.el('div');
    const sess = Engine.session();

    if (sess) {
      wrap.appendChild(this._sessionCard(sess));
    } else {
      const idle = Util.el('div', 'card session-hero');
      idle.innerHTML = `
        <span class="emoji">😴</span>
        <div class="session-title">Your hero is idle</div>
        <div class="session-meta">Send them to work: train a skill or clear a dungeon.<br>They keep going for up to an hour while this tab is closed.</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
          <button class="btn" data-go="skills">🎯 Train a skill</button>
          <button class="btn secondary" data-go="dungeons">🏰 Fight in a dungeon</button>
        </div>`;
      idle.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
        this.tab = b.dataset.go; this._setTab();
      });
      wrap.appendChild(idle);
    }

    // Recent activity log
    const logCard = Util.el('div', 'card');
    logCard.appendChild(Util.el('h2', null, '📖 Adventure log'));
    const logList = Util.el('div', 'log-list');
    if (State.state.log.length === 0) {
      logList.appendChild(Util.el('div', 'empty-note', 'Nothing has happened yet. Go start an adventure!'));
    } else {
      for (const entry of State.state.log.slice(0, 25)) {
        const e = Util.el('div', 'log-entry ' + entry.type);
        const time = new Date(entry.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        e.innerHTML = `<span class="log-time">${time}</span>${Util.esc(entry.msg)}`;
        logList.appendChild(e);
      }
    }
    logCard.appendChild(logList);
    wrap.appendChild(logCard);
    return wrap;
  },

  _sessionCard(sess) {
    const card = Util.el('div', 'card');
    const emoji = { mining: '⛏️', woodcutting: '🪓', fishing: '🎣', thieving: '🗝️', agility: '🏃', firemaking: '🔥', smithing: '🔨', cooking: '🍳', fletching: '🏹', crafting: '💎', runecrafting: '✨', prayer: '🙏', combat: '⚔️', tower: '🗼', ranged: '🎯', strength: '💪', magic: '🔮', attack: '⚔️', defense: '🛡️', herblore: '🧪' }[sess.skill] || '🎯';
    const skillName = GameData.skillDefs.find(d => d.key === sess.skill)?.name || sess.skill;

    card.innerHTML = `
      <div class="session-hero">
        <span class="emoji">${emoji}</span>
        <div class="session-title">${Util.esc(sess.kind === 'dungeon' || sess.kind === 'tower' ? sess.label : `${skillName}: ${sess.label}`)}</div>
        <div class="session-meta">${sess.kind === 'dungeon'
          ? `Style: ${Util.prettify(sess.style)} · Minute ${Util.clamp(Engine.revealedFrames(sess), 0, sess.frames.length)} of ${sess.frames.length}`
          : `Minute ${Util.clamp(Engine.revealedFrames(sess), 0, sess.frames.length)} of ${sess.frames.length}`}</div>
      </div>
      <div class="progress-wrap">
        <div id="session-progress-fill" class="progress-fill"></div>
        <div id="session-progress-label" class="progress-label"></div>
      </div>
      <div id="session-live" class="session-live"></div>
      <div id="combat-hp"></div>`;

    const collectBtn = Util.el('button', 'btn success full', '⏳ In progress…');
    collectBtn.id = 'btn-collect';
    collectBtn.style.maxWidth = '340px';
    collectBtn.style.margin = '10px auto 0';
    collectBtn.style.display = 'block';
    collectBtn.disabled = true;
    collectBtn.onclick = () => this._collectFlow();
    card.appendChild(collectBtn);
    return card;
  },

  _liveStatsHtml(sess) {
    const { xp } = Engine.liveXp(sess);
    const n = Util.clamp(Engine.revealedFrames(sess), 0, sess.frames.length);
    const parts = [`XP so far: <b>${Util.fmt(xp)}</b>`];
    if (sess.kind === 'dungeon') {
      let kills = 0, food = 0;
      for (let i = 0; i < n; i++) {
        kills += sess.frames[i].kills || 0;
        food += Object.values(sess.frames[i].foodConsumed || {}).reduce((a, b) => a + b, 0);
      }
      const lastFrame = sess.frames[Math.max(0, n - 1)];
      parts.push(`Kills: <b>${kills}</b>`);
      if (lastFrame && lastFrame.maxHp) parts.push(`HP: <b>${lastFrame.hpAfter}/${lastFrame.maxHp}</b>`);
      if (food > 0) parts.push(`Food eaten: <b>${food}</b>`);
    } else {
      // Count items revealed so far
      const counts = {};
      for (let i = 0; i < n; i++)
        for (const [k, v] of Object.entries(sess.frames[i].items || {})) counts[k] = (counts[k] || 0) + v;
      const itemStr = Object.entries(counts).filter(([k]) => k !== 'coins')
        .slice(0, 3).map(([k, v]) => `${Util.fmt(v)} ${GameData.name(k)}`).join(', ');
      if (itemStr) parts.push(`Loot: <b>${itemStr}</b>`);
      if (counts.coins) parts.push(`🪙 <b>${Util.fmt(counts.coins)}</b>`);
    }
    return parts.join(' · ');
  },

  _collectFlow() {
    const summary = Engine.collect();
    if (!summary) return;
    const xpRows = Object.entries(summary.xpBySkill).map(([k, v]) =>
      `<div class="rw"><span>${GameData.skillDefs.find(d => d.key === k)?.name || Util.prettify(k)} XP</span><b>+${Util.fmt(v)}</b></div>`).join('');
    const itemRows = Object.entries(summary.items)
      .sort((a, b) => (b[1] - a[1])).slice(0, 14)
      .map(([k, v]) => `<div class="rw"><span>${GameData.name(k)}</span><b>+${Util.fmt(v)}</b></div>`).join('');
    const ammoRows = [
      ...Object.entries(summary.foodConsumed).map(([k, v]) => `<div class="rw"><span>${GameData.name(k)} eaten</span><b>−${Util.fmt(v)}</b></div>`),
      ...Object.entries(summary.arrowsConsumed).map(([k, v]) => `<div class="rw"><span>${GameData.name(k)} used</span><b>−${Util.fmt(v)}</b></div>`),
      ...Object.entries(summary.runesConsumed).map(([k, v]) => `<div class="rw"><span>${GameData.name(k)} used</span><b>−${Util.fmt(v)}</b></div>`),
    ].join('');

    if (summary.died) State.pushLog(`💀 Your hero fell in ${GameData.dungeons[summary.dungeon]?.display_name || 'the dungeon'} — the loot was lost.`, 'death');
    else if (summary.dungeon) State.pushLog(`🏰 ${GameData.dungeons[summary.dungeon]?.display_name || 'Dungeon'} cleared: ${summary.kills} kills.`, 'quest');

    this.modal(`
      <h2>${summary.died ? '💀 You died!' : '🎉 Session complete!'}</h2>
      ${summary.died ? '<p class="card-sub">Your hero was overwhelmed and the remaining loot was lost. XP earned before death is kept — bring more food or train Defense next time.</p>' : ''}
      ${summary.kills ? `<p class="card-sub" style="color:var(--gold)">${summary.kills} enemies defeated</p>` : ''}
      <div class="reward-list">
        ${xpRows || '<div class="rw"><span>No XP gained</span><b>—</b></div>'}
        ${itemRows}
        ${ammoRows}
      </div>
      <div class="modal-actions"><button class="btn" data-act="close">Nice!</button></div>
    `, m => { m.querySelector('[data-act=close]').onclick = () => this.closeModal(); });

    State.save();
    this.render();
  },

  /* ============================ SKILLS ============================ */

  renderSkills() {
    const wrap = Util.el('div');
    const card = Util.el('div', 'card');
    card.appendChild(Util.el('h2', null, '🎯 Skills'));
    card.appendChild(Util.el('p', 'card-sub', 'Tap a skill to start a training session. Each session runs in real time — even with the tab closed.'));
    const grid = Util.el('div', 'skills-grid');
    for (const def of GameData.skillDefs) {
      const lvl = State.level(def.key);
      const tile = Util.el('div', 'skill-tile');
      const cur = State.xp(def.key);
      const next = lvl < 99 ? Sim.xpForLevel(lvl + 1) : cur;
      const prev = Sim.xpForLevel(lvl);
      const pct = lvl >= 99 ? 100 : Util.clamp(((cur - prev) / Math.max(1, next - prev)) * 100, 0, 100);
      tile.innerHTML = `<div class="sk-emoji">${def.icon}</div><div class="sk-name">${def.name}</div><div class="sk-level">${lvl}</div><div class="sk-xpbar"><div style="width:${pct}%"></div></div>`;
      tile.onclick = () => { this.skillView = def.key; this.render(); };
      grid.appendChild(tile);
    }
    card.appendChild(grid);
    wrap.appendChild(card);
    return wrap;
  },

  renderSkillDetail(skillKey) {
    const def = GameData.skillDefs.find(d => d.key === skillKey);
    const wrap = Util.el('div');
    const back = Util.el('button', 'back-link', '← All skills');
    back.onclick = () => { this.skillView = null; this.render(); };

    const card = Util.el('div', 'card');
    const lvl = State.level(skillKey);
    card.appendChild(Util.el('h2', null, `${def.icon} ${def.name} <span class="tag blue">level ${lvl}</span>`));
    card.appendChild(Util.el('p', 'card-sub', def.desc));

    const list = Util.el('div', 'row-list');
    const busy = Engine.hasSession();
    const combatSkills = ['attack', 'strength', 'defense', 'ranged', 'magic', 'hitpoints'];

    if (skillKey === 'farming' && this.renderFarming) {
      wrap.appendChild(back);
      wrap.appendChild(this.renderFarming());
      return wrap;
    }
    if (skillKey === 'slayer') {
      card.appendChild(Util.el('div', 'empty-note', 'Slayer is trained by completing tasks from the Slayer Master — visit the 🏘️ Town tab. Each on-task kill earns Slayer XP.'));
      wrap.appendChild(back);
      wrap.appendChild(card);
      return wrap;
    }
    if (combatSkills.includes(skillKey)) {
      card.appendChild(Util.el('div', 'empty-note', `${def.name} is trained by fighting in Dungeons. ${skillKey === 'hitpoints' ? 'You gain Hitpoints XP from every fight.' : 'Switch your combat style on the Dungeons screen to train it.'}`));
    } else {
      const rows = this._skillActivityRows(skillKey, busy);
      if (rows.length === 0) card.appendChild(Util.el('div', 'empty-note', 'Nothing available yet.'));
      rows.forEach(r => list.appendChild(r));
      card.appendChild(list);
    }
    wrap.appendChild(back);
    wrap.appendChild(card);
    return wrap;
  },

  _startRow({ icon, name, sub, locked, lockedReason, onStart, extra }) {
    const row = Util.el('div', 'row' + (locked ? ' locked' : ''));
    const actions = Util.el('div', 'row-actions');
    if (extra) actions.appendChild(extra);
    const btn = Util.el('button', 'btn small', locked ? '🔒' : 'Start');
    btn.disabled = locked || Engine.hasSession();
    if (!locked) btn.onclick = onStart;
    actions.appendChild(btn);
    row.innerHTML = `
      <div class="row-icon">${icon}</div>
      <div class="row-main">
        <div class="row-name">${Util.esc(name)}</div>
        <div class="row-sub">${sub || ''}</div>
      </div>`;
    row.appendChild(actions);
    if (locked && lockedReason) row.title = lockedReason;
    return row;
  },

  _qtyPicker(key, max) {
    const presets = [60, 120, 300].filter(p => p < max);
    presets.push(max);
    const current = this.qtySelections[key] ?? max;
    const div = Util.el('div', 'qty-picker');
    const opts = [...new Set(presets)];
    for (const p of opts) {
      const b = Util.el('button', null, p === max ? 'All' : String(p));
      if (p === current) b.classList.add('active');
      b.onclick = e => { e.stopPropagation(); this.qtySelections[key] = p; this.render(); };
      div.appendChild(b);
    }
    return div;
  },

  _skillActivityRows(skillKey, busy) {
    const rows = [];
    const lvl = State.level(skillKey);
    const mk = (def) => this._startRow(def);

    if (skillKey === 'mining') {
      for (const [key, ore] of Object.entries(GameData.ores)) {
        const locked = lvl < ore.level_required;
        rows.push(mk({
          icon: '🪨', name: ore.display_name,
          sub: `${ore.xp_per_ore} XP/ore · always drops · gem chance` + (locked ? ` · 🔒 Mining ${ore.level_required}` : ''),
          locked, lockedReason: `Requires Mining ${ore.level_required}`,
          onStart: () => this._tryStart(() => Engine.startSkillSession('mining', key)),
        }));
      }
    } else if (skillKey === 'woodcutting') {
      for (const [key, tree] of Object.entries(GameData.trees)) {
        const locked = lvl < tree.level_required;
        rows.push(mk({
          icon: '🌲', name: tree.display_name,
          sub: `${tree.xp_per_log} XP/log · yields ${GameData.name(tree.log_name)}` + (locked ? ` · 🔒 Woodcutting ${tree.level_required}` : ''),
          locked, lockedReason: `Requires Woodcutting ${tree.level_required}`,
          onStart: () => this._tryStart(() => Engine.startSkillSession('woodcutting', key)),
        }));
      }
    } else if (skillKey === 'fishing') {
      for (const [key, fish] of Object.entries(GameData.fish)) {
        const locked = lvl < fish.level_required;
        rows.push(mk({
          icon: '🐟', name: GameData.name(key),
          sub: `${fish.xp_per_catch} XP/catch · cook it for food` + (locked ? ` · 🔒 Fishing ${fish.level_required}` : ''),
          locked, lockedReason: `Requires Fishing ${fish.level_required}`,
          onStart: () => this._tryStart(() => Engine.startSkillSession('fishing', key)),
        }));
      }
    } else if (skillKey === 'thieving') {
      for (const npc of GameData.thievingNpcs) {
        const locked = lvl < npc.level_required;
        rows.push(mk({
          icon: '💰', name: npc.display_name,
          sub: `${npc.base_xp} XP · ${npc.coins_min}–${npc.coins_max} coins + loot · failures stun you`,
          locked, lockedReason: `Requires Thieving ${npc.level_required}`,
          onStart: () => this._tryStart(() => Engine.startSkillSession('thieving', npc.key)),
        }));
      }
    } else if (skillKey === 'agility') {
      for (const [key, course] of Object.entries(GameData.agilityCourses)) {
        const locked = lvl < course.level_required;
        rows.push(mk({
          icon: '🏃', name: course.display_name,
          sub: `${course.xp_per_success} XP/lap · higher Agility = shorter sessions (60→40 min)` + (locked ? ` · 🔒 Agility ${course.level_required}` : ''),
          locked, lockedReason: `Requires Agility ${course.level_required}`,
          onStart: () => this._tryStart(() => Engine.startSkillSession('agility', key)),
        }));
      }
    } else if (skillKey === 'firemaking') {
      for (const [key, log] of Object.entries(GameData.logs)) {
        const ashKey = GameData.ashByLog[key];
        if (!ashKey) continue;
        const locked = lvl < log.level_required;
        const have = State.count(key);
        const qty = Math.min(have, this.qtySelections['fm_' + key] ?? have);
        rows.push(mk({
          icon: '🔥', name: `${GameData.name(key)} → ${GameData.name(ashKey)}`,
          sub: `${log.xp_per_log} XP/log · have ${Util.fmt(have)}` + (locked ? ` · 🔒 Firemaking ${log.level_required}` : '') + (have < 1 ? ' · no logs!' : ''),
          locked: locked || have < 1,
          lockedReason: locked ? `Requires Firemaking ${log.level_required}` : 'No logs — chop some trees or buy them.',
          extra: have > 60 ? this._qtyPicker('fm_' + key, have) : null,
          onStart: () => this._tryStart(() => Engine.startSkillSession('firemaking', key, this.qtySelections['fm_' + key])),
        }));
      }
    } else if (skillKey === 'smithing' || skillKey === 'fletching' || skillKey === 'crafting') {
      for (const [key, recipe] of Object.entries(GameData.recipes[skillKey])) {
        const locked = lvl < recipe.level_required;
        const mats = Object.entries(recipe.materials || {})
          .map(([m, n]) => `<span class="${State.count(m) >= n ? 'mat-ok' : 'mat-missing'}">${n}× ${GameData.name(m)} (${Util.fmt(State.count(m))})</span>`)
          .join(' · ');
        let maxQty = 500;
        for (const [m, n] of Object.entries(recipe.materials || {})) maxQty = Math.min(maxQty, Math.floor(State.count(m) / n));
        rows.push(mk({
          icon: { smithing: '🔧', fletching: '🏹', crafting: '💍' }[skillKey],
          name: recipe.display_name,
          sub: `${mats} · ${recipe.xp_per_item} XP` + (locked ? ` · 🔒 ${Util.prettify(skillKey)} ${recipe.level_required}` : ''),
          locked: locked || maxQty < 1,
          lockedReason: locked ? `Requires ${Util.prettify(skillKey)} ${recipe.level_required}` : 'Not enough materials',
          extra: maxQty > 60 ? this._qtyPicker(skillKey + '_' + key, maxQty) : null,
          onStart: () => this._tryStart(() => Engine.startSkillSession(skillKey, key, this.qtySelections[skillKey + '_' + key])),
        }));
      }
    } else if (skillKey === 'cooking') {
      for (const [key, recipe] of Object.entries(GameData.recipes.cooking)) {
        const locked = lvl < recipe.level_required;
        const have = State.count(recipe.raw_item);
        rows.push(mk({
          icon: '🍳', name: recipe.display_name,
          sub: `${recipe.raw_item ? Util.fmt(have) : 0}× ${GameData.name(recipe.raw_item)} · ${recipe.xp_per_item} XP · heals ${recipe.healing_value * 10} HP` + (locked ? ` · 🔒 Cooking ${recipe.level_required}` : ''),
          locked: locked || have < 1,
          lockedReason: locked ? `Requires Cooking ${recipe.level_required}` : `Need ${GameData.name(recipe.raw_item)} — catch it fishing or loot it.`,
          extra: have > 60 ? this._qtyPicker('ck_' + key, have) : null,
          onStart: () => this._tryStart(() => Engine.startSkillSession('cooking', key, this.qtySelections['ck_' + key])),
        }));
      }
    } else if (skillKey === 'runecrafting') {
      for (const [key, rune] of Object.entries(GameData.runes)) {
        const locked = lvl < rune.level_required;
        const have = Math.floor(State.count('rune_essence') / (rune.essence_cost || 1));
        rows.push(mk({
          icon: '✨', name: rune.display_name,
          sub: `${rune.essence_cost}× rune essence each · ${rune.xp_per_rune} XP · cast it with Magic` + (locked ? ` · 🔒 Runecrafting ${rune.level_required}` : ''),
          locked: locked || have < 1,
          lockedReason: locked ? `Requires Runecrafting ${rune.level_required}` : 'Need rune essence',
          extra: have > 60 ? this._qtyPicker('rc_' + key, have) : null,
          onStart: () => this._tryStart(() => Engine.startSkillSession('runecrafting', key, this.qtySelections['rc_' + key])),
        }));
      }
    } else if (skillKey === 'prayer') {
      for (const [key, bone] of Object.entries(GameData.bones)) {
        const have = State.count(key);
        rows.push(mk({
          icon: bone.is_ash ? '🔥' : '🦴', name: bone.display_name,
          sub: `${bone.xp_per_bone} XP each · have ${Util.fmt(have)}` + (have < 1 ? ' — none in inventory' : ''),
          locked: have < 1,
          lockedReason: `Need ${bone.display_name} — enemies drop bones; ashes come from Firemaking`,
          extra: have > 60 ? this._qtyPicker('pr_' + key, have) : null,
          onStart: () => this._tryStart(() => Engine.startSkillSession('prayer', key, this.qtySelections['pr_' + key])),
        }));
      }
    }
    return rows;
  },

  _tryStart(fn) {
    const res = fn();
    if (res.error) { this.toast(res.error, 'error'); return; }
    this.toast(`${res.session.label} — session started!`, 'success');
    State.pushLog(`▶️ Started: ${res.session.label}`);
    State.save();
    this.tab = 'home';
    this._setTab();
  },

  /* ============================ DUNGEONS ============================ */

  renderDungeons() {
    const wrap = Util.el('div');

    // Style + loadout card
    const styleCard = Util.el('div', 'card');
    styleCard.appendChild(Util.el('h2', null, '⚔️ Combat setup'));
    const styleRow = Util.el('div', 'style-row');
    const styles = [
      { key: 'attack', label: '⚔️ Attack', sub: 'melee accuracy XP' },
      { key: 'strength', label: '💪 Strength', sub: 'melee damage XP' },
      { key: 'defense', label: '🛡️ Defense', sub: 'defense XP' },
      { key: 'ranged', label: '🏹 Ranged', sub: 'bow + arrows' },
      { key: 'magic', label: '🔮 Magic', sub: 'staff + spell' },
    ];
    for (const st of styles) {
      const b = Util.el('button', 'style-btn' + (State.state.combatStyle === st.key ? ' active' : ''),
        `${st.label}<small>${st.sub}</small>`);
      b.onclick = () => {
        State.state.combatStyle = st.key;
        // Swap to the weapon remembered for this style when it fits and is owned
        const remembered = State.state.styleWeapons[st.key];
        const currentWeapon = State.equippedItem('weapon');
        const currentFits = { attack: ['attack', 'strength', null], strength: ['attack', 'strength', null], defense: ['attack', 'strength', null], ranged: ['ranged'], magic: ['magic'] }[st.key]
          .includes(currentWeapon ? GameData.equipment[currentWeapon]?.combat_style : null);
        if (remembered && remembered !== currentWeapon && !currentFits && State.count(remembered) > 0) {
          if (currentWeapon) State.unequip('weapon');
          State.state.equipped.weapon = remembered;
          State.removeItem(remembered, 1);
        }
        State.save();
        this.render();
      };
      styleRow.appendChild(b);
    }
    styleCard.appendChild(styleRow);

    // Loadout summary
    const ctx = State.combatContext();
    const bonuses = State.combatBonuses();
    const weaponKey = State.equippedItem('weapon');
    const weapon = weaponKey ? GameData.equipment[weaponKey] : null;
    const meleeStyles = ['attack', 'strength', 'defense'];
    let maxHit = 0, atkBonus = 0;
    if (State.state.combatStyle === 'ranged') {
      const arrowKey = Object.keys(ctx.arrows || {})[0];
      maxHit = Sim._rangedMaxHit(State.level('ranged'), bonuses.rangedStr, arrowKey ? GameData.arrowBonuses[arrowKey] || 0 : 0);
      atkBonus = bonuses.rangedAttack;
    } else if (State.state.combatStyle === 'magic') {
      const spell = State.state.activeSpell ? GameData.spells[State.state.activeSpell] : null;
      maxHit = (spell?.max_hit || 0) + bonuses.magicDmg;
      atkBonus = bonuses.magicAttack;
    } else {
      const effStr = State.level('strength') + bonuses.strength;
      maxHit = Math.max(1, Math.floor(1 + effStr * (bonuses.strength + 64) / 640));
      atkBonus = bonuses.attack;
    }
    const styleErr = Engine.validateStyle(State.state.combatStyle);

    const summary = Util.el('div', 'bonus-grid');
    summary.style.marginTop = '12px';
    summary.innerHTML = `
      <div class="bonus-cell"><div class="bc-label">Weapon</div><div class="bc-value" style="font-size:12px">${weapon ? Util.esc(weapon.display_name) : '— none —'}</div></div>
      <div class="bonus-cell"><div class="bc-label">Max hit</div><div class="bc-value">${maxHit}</div></div>
      <div class="bonus-cell"><div class="bc-label">Attack bonus</div><div class="bc-value">+${atkBonus}</div></div>
      <div class="bonus-cell"><div class="bc-label">Defense</div><div class="bc-value">${State.level('defense')} +${bonuses.defense}</div></div>
      <div class="bonus-cell"><div class="bc-label">Max HP</div><div class="bc-value">${State.level('hitpoints') * 10}</div></div>
      <div class="bonus-cell"><div class="bc-label">Food in bag</div><div class="bc-value">${Util.fmt(Object.values(ctx.food).reduce((a, b) => a + b, 0))}</div></div>`;
    styleCard.appendChild(summary);

    if (styleErr) {
      const err = Util.el('div', 'card-sub');
      err.style.color = 'var(--red)';
      err.style.marginTop = '8px';
      err.textContent = '⚠️ ' + styleErr;
      styleCard.appendChild(err);
    }

    // Combat potion selector (one dose consumed per combat session)
    const potionsOwned = Object.keys(GameData.potionEffects).filter(k => State.count(k) > 0);
    if (potionsOwned.length > 0) {
      const sel = Util.el('select', 'fancy');
      sel.style.marginTop = '10px';
      sel.innerHTML = '<option value="">— no potion —</option>' +
        potionsOwned.map(k => {
          const eff = Object.entries(GameData.potionEffects[k]).map(([st, v]) => `+${v} ${st}`).join(', ');
          return `<option value="${k}" ${State.state.activePotion === k ? 'selected' : ''}>${GameData.name(k)} ×${Util.fmt(State.count(k))} (${eff})</option>`;
        }).join('');
      sel.onchange = () => { State.state.activePotion = sel.value || null; State.save(); this.render(); };
      styleCard.appendChild(sel);
      const note = Util.el('div', 'card-sub');
      note.style.marginTop = '6px';
      note.textContent = '🧪 One dose is consumed per dungeon/tower session — bonuses last the whole run.';
      styleCard.appendChild(note);
    }

    // Spell / arrow pickers
    if (State.state.combatStyle === 'magic') {
      const sel = Util.el('select', 'fancy');
      sel.style.marginTop = '10px';
      sel.innerHTML = '<option value="">— choose a spell —</option>' +
        Object.entries(GameData.spells).map(([k, s]) => {
          const locked = State.level('magic') < s.magic_level_required;
          return `<option value="${k}" ${State.state.activeSpell === k ? 'selected' : ''} ${locked ? 'disabled' : ''}>${s.display_name} — max hit ${s.max_hit}, ${s.rune_cost}× ${GameData.name(s.rune_type)}${locked ? ' (Magic ' + s.magic_level_required + ')' : ''}</option>`;
        }).join('');
      sel.onchange = () => { State.state.activeSpell = sel.value || null; State.save(); this.render(); };
      styleCard.appendChild(sel);
      const runeNote = Util.el('div', 'card-sub');
      runeNote.style.marginTop = '6px';
      const spell = State.state.activeSpell ? GameData.spells[State.state.activeSpell] : null;
      if (spell) {
        const inf = weapon?.infinite_runes;
        runeNote.innerHTML = inf
          ? `♾️ ${weapon.display_name} provides infinite ${GameData.name(spell.rune_type)}s`
          : `You have ${Util.fmt(State.count(spell.rune_type))}× ${GameData.name(spell.rune_type)} (craft them with Runecrafting)`;
      }
      styleCard.appendChild(runeNote);
    }
    if (State.state.combatStyle === 'ranged') {
      const arrowsOwned = Object.keys(GameData.arrowBonuses).filter(k => State.count(k) > 0);
      const sel = Util.el('select', 'fancy');
      sel.style.marginTop = '10px';
      sel.innerHTML = (arrowsOwned.length === 0 ? '<option value="">— no arrows — fletch or loot some!</option>' : '') +
        arrowsOwned.map(k => `<option value="${k}" ${State.equippedItem('arrows') === k ? 'selected' : ''}>${GameData.name(k)} ×${Util.fmt(State.count(k))} (+${GameData.arrowBonuses[k]} str)</option>`).join('');
      sel.onchange = () => {
        // Arrows are a selection, not consumed from inventory when equipped
        State.state.equipped.arrows = sel.value || null;
        State.save(); this.render();
      };
      styleCard.appendChild(sel);
    }

    wrap.appendChild(styleCard);

    // Dungeon list
    const listCard = Util.el('div', 'card');
    listCard.appendChild(Util.el('h2', null, '🏰 Dungeons'));
    listCard.appendChild(Util.el('p', 'card-sub', 'Sessions run in real time. Your hero auto-eats food when hurt — dying forfeits the loot but keeps XP gained so far.'));
    const list = Util.el('div', 'row-list');
    const ctx2 = State.combatContext();
    const totalFoodHeal = Object.entries(ctx2.food).reduce((s, [k, v]) => s + (GameData.foodHeals[k] || 0) * 10 * v, 0);
    for (const d of GameData.dungeonList()) {
      if (!State.dungeonUnlocked(d.name)) continue;
      const rating = Sim.estimateSurvival(d, ctx2.defense, ctx2.hitpoints, totalFoodHeal);
      const ratingTag = { LIKELY: ['green', 'Likely survive'], RISKY: ['orange', 'Risky'], UNLIKELY: ['red', 'Unlikely'] }[rating];
      const enemies = [...new Set(d.enemy_spawns.map(s => GameData.enemies[s.enemy]?.display_name || s.enemy))].slice(0, 4).join(', ');
      list.appendChild(this._startRow({
        icon: '🏰',
        name: `${d.display_name} <span class="tag ${ratingTag[0]}">${ratingTag[1]}</span>`,
        sub: `Rec. level ${d.recommended_level} · ${enemies}${d.safe_zone ? ' · 🕊️ safe zone (no death)' : ''}`,
        locked: false,
        onStart: () => this._tryStart(() => Engine.startDungeonSession(d.name)),
      }));
    }
    listCard.appendChild(list);
    wrap.appendChild(listCard);
    return wrap;
  },

  /* ============================ CHARACTER ============================ */

  renderCharacter() {
    const wrap = Util.el('div');
    const grid = Util.el('div', 'grid-2');

    // Equipment card
    const eqCard = Util.el('div', 'card');
    eqCard.appendChild(Util.el('h2', null, '🧝 Equipment'));
    eqCard.appendChild(Util.el('p', 'card-sub', 'Tap a filled slot to unequip. Better gear from dungeon loot, smithing, fletching and crafting.'));
    const eg = Util.el('div', 'equip-grid');
    const slotIcons = { weapon: '⚔️', shield: '🛡️', head: '⛑️', body: '👕', legs: '👖', boots: '👟', cape: '🧣', ring: '💍', necklace: '📿', pickaxe: '⛏️', axe: '🪓', fishing_rod: '🎣', hammer: '🔨', tinderbox: '🔥', grappling_hook: '🪝', frying_pan: '🍳', lockpick: '🗝️', hoe: '🌾' };
    for (const slot of [...State.SLOTS(), ...State.TOOL_SLOTS()]) {
      const key = State.equippedItem(slot);
      const cell = Util.el('div', 'equip-slot' + (key ? ' filled' : ''));
      const eq = key ? GameData.equipment[key] : null;
      let bonusTxt = '';
      if (eq) {
        const parts = [];
        if (eq.attack_bonus) parts.push(`+${eq.attack_bonus} atk`);
        if (eq.strength_bonus) parts.push(`+${eq.strength_bonus} str`);
        if (eq.defense_bonus) parts.push(`+${eq.defense_bonus} def`);
        if (eq.ranged_attack_bonus) parts.push(`+${eq.ranged_attack_bonus} rng atk`);
        if (eq.ranged_strength_bonus) parts.push(`+${eq.ranged_strength_bonus} rng str`);
        if (eq.magic_attack_bonus) parts.push(`+${eq.magic_attack_bonus} mag atk`);
        if (eq.magic_damage_bonus) parts.push(`+${eq.magic_damage_bonus} mag dmg`);
        for (const [field, label] of Object.entries({ mining_efficiency: '⛏️', woodcutting_efficiency: '🪓', fishing_efficiency: '🎣', thieving_efficiency: '🗝️', agility_efficiency: '🏃', smithing_efficiency: '🔨', cooking_efficiency: '🍳', firemaking_efficiency: '🔥' }))
          if (eq[field] && eq[field] !== 1) parts.push(`${label} ${eq[field]}×`);
        bonusTxt = parts.join(' · ');
      }
      cell.innerHTML = `<div class="slot-name">${slotIcons[slot] || ''} ${slot}</div><div class="slot-item">${key ? Util.esc(GameData.equipment[key]?.display_name || GameData.name(key)) : 'empty'}</div><div class="row-sub">${bonusTxt}</div>`;
      if (key) cell.onclick = () => { State.unequip(slot); State.save(); this.render(); };
      eg.appendChild(cell);
    }
    eqCard.appendChild(eg);
    grid.appendChild(eqCard);

    // Inventory card
    const invCard = Util.el('div', 'card');
    invCard.appendChild(Util.el('h2', null, '🎒 Inventory'));
    const inv = Util.el('div', 'row-list');
    const entries = Object.entries(State.state.inventory).filter(([, v]) => v > 0)
      .sort((a, b) => Engine.sellPrice(b[0]) * b[1] - Engine.sellPrice(a[0]) * a[1]);
    if (entries.length === 0) inv.appendChild(Util.el('div', 'empty-note', 'Empty — go gather some resources!'));
    for (const [key, qty] of entries) {
      const eq = GameData.equipment[key];
      const isEquippable = eq && State.meetsRequirements(key);
      const price = Engine.sellPrice(key);
      const row = Util.el('div', 'row');
      row.innerHTML = `
        <div class="row-icon">${eq ? '🔧' : GameData.isFood(key) ? '🍖' : '📦'}</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(GameData.name(key))} <span class="tag">×${Util.fmt(qty)}</span>${GameData.isFood(key) ? `<span class="tag green">heals ${GameData.foodHeals[key] || 0} HP</span>` : ''}</div>
          <div class="row-sub">Sells for ${price} 🪙 each${eq && !State.meetsRequirements(key) ? ' · <span class="mat-missing">level too low to equip</span>' : ''}</div>
        </div>`;
      const actions = Util.el('div', 'row-actions');
      if (isEquippable) {
        const eb = Util.el('button', 'btn small secondary', 'Equip');
        eb.onclick = () => {
          const err = State.equip(key);
          if (err) this.toast(err, 'error');
          State.save(); this.render();
        };
        actions.appendChild(eb);
      }
      const s1 = Util.el('button', 'btn small secondary', 'Sell 1');
      s1.onclick = () => {
        const r = Engine.sell(key, 1);
        if (r.error) this.toast(r.error, 'error'); else this.toast(`Sold 1 ${GameData.name(key)} for ${r.coins} 🪙`);
        State.save(); this.render();
      };
      const sa = Util.el('button', 'btn small secondary', 'All');
      sa.onclick = () => {
        const r = Engine.sell(key, qty);
        if (r.error) this.toast(r.error, 'error'); else this.toast(`Sold ${Util.fmt(qty)} ${GameData.name(key)} for ${Util.fmt(r.coins)} 🪙`);
        State.save(); this.render();
      };
      actions.appendChild(s1); actions.appendChild(sa);
      row.appendChild(actions);
      inv.appendChild(row);
    }
    invCard.appendChild(inv);
    grid.appendChild(invCard);

    wrap.appendChild(grid);
    return wrap;
  },

  /* ============================ SHOP ============================ */

  renderShop() {
    const wrap = Util.el('div');
    const grid = Util.el('div', 'grid-2');

    const buyCard = Util.el('div', 'card');
    buyCard.appendChild(Util.el('h2', null, '🛒 General Store'));
    buyCard.appendChild(Util.el('p', 'card-sub', `Your purse: ${Util.fmt(State.state.coins)} 🪙`));
    const buyList = Util.el('div', 'row-list');
    for (const entry of Engine.buyEntries()) {
      const row = Util.el('div', 'row');
      row.innerHTML = `
        <div class="row-icon">🛍️</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(entry.name)}</div>
          <div class="row-sub">${Util.esc(entry.category)} — ${Util.esc(entry.desc || '')}</div>
        </div>
        <div class="row-actions">
          <span class="tag gold">${entry.price} 🪙</span>
          <button class="btn small secondary" data-q="1">×1</button>
          <button class="btn small secondary" data-q="10">×10</button>
          <button class="btn small secondary" data-q="100">×100</button>
        </div>`;
      row.querySelectorAll('button').forEach(b => b.onclick = () => {
        const qty = parseInt(b.dataset.q, 10);
        const r = Engine.buy(entry.key, qty);
        if (r.error) this.toast(r.error, 'error');
        else { this.toast(`Bought ${qty}× ${entry.name}`); State.pushLog(`🛍️ Bought ${qty}× ${entry.name}`); }
        State.save(); this.render();
      });
      buyList.appendChild(row);
    }
    buyCard.appendChild(buyList);
    grid.appendChild(buyCard);

    const sellCard = Util.el('div', 'card');
    sellCard.appendChild(Util.el('h2', null, '💰 Sell'));
    sellCard.appendChild(Util.el('p', 'card-sub', 'Sell spare loot and resources. Food keeps you alive — don\'t sell everything!'));
    const sellList = Util.el('div', 'row-list');
    const entries = Object.entries(State.state.inventory).filter(([, v]) => v > 0);
    if (entries.length === 0) sellList.appendChild(Util.el('div', 'empty-note', 'Nothing to sell.'));
    for (const [key, qty] of entries) {
      const row = Util.el('div', 'row');
      row.innerHTML = `
        <div class="row-icon">📦</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(GameData.name(key))} ×${Util.fmt(qty)}</div>
          <div class="row-sub">${Engine.sellPrice(key)} 🪙 each · total ${Util.fmt(Engine.sellPrice(key) * qty)}</div>
        </div>
        <div class="row-actions">
          <button class="btn small secondary" data-q="1">Sell 1</button>
          <button class="btn small secondary" data-q="all">All</button>
        </div>`;
      row.querySelectorAll('button').forEach(b => b.onclick = () => {
        const n = b.dataset.q === 'all' ? qty : parseInt(b.dataset.q, 10);
        const r = Engine.sell(key, n);
        if (r.error) this.toast(r.error, 'error'); else this.toast(`Sold for ${Util.fmt(r.coins)} 🪙`, 'success');
        State.save(); this.render();
      });
      sellList.appendChild(row);
    }
    sellCard.appendChild(sellList);
    grid.appendChild(sellCard);

    wrap.appendChild(grid);
    return wrap;
  },

  /* ============================ QUESTS ============================ */

  renderQuests() {
    const wrap = Util.el('div');
    const card = Util.el('div', 'card');
    card.appendChild(Util.el('h2', null, '📜 Quests'));
    const quests = Engine.questsAvailable();
    const claimedCount = quests.filter(q => State.state.quests[q.id]?.claimed).length;
    card.appendChild(Util.el('p', 'card-sub', `${claimedCount} / ${quests.length} quests claimed. Progress is tracked automatically as you play — claim rewards when done.`));

    const list = Util.el('div', 'row-list');
    const sorted = quests.sort((a, b) => a.tier - b.tier);
    for (const q of sorted) {
      const p = Engine.questProgress(q);
      const row = Util.el('div', 'row quest-row' + (p.claimed ? ' claimed' : '') + (p.complete && !p.claimed ? ' complete' : ''));
      const pct = Util.clamp((p.count / p.goal) * 100, 0, 100);
      row.innerHTML = `
        <div class="row-icon">${p.claimed ? '✅' : p.complete ? '🎁' : '📜'}</div>
        <div class="row-main">
          <div class="row-name">${Util.esc(q.name)} ${p.unlocked ? '' : '<span class="tag">🔒 finish ' + Util.esc(GameData.quests[q.requires_previous]?.name || 'previous') + '</span>'}</div>
          <div class="row-sub">${Util.esc(q.description)} · reward: ${q.rewards?.coins ? Util.fmt(q.rewards.coins) + ' 🪙 ' : ''}${q.rewards?.xp ? Util.fmt(q.rewards.xp) + ' XP ' : ''}${Object.entries(q.rewards?.items || {}).map(([k, v]) => `${v}× ${GameData.name(k)}`).join(', ')}</div>
          <div class="qbar"><div style="width:${pct}%"></div></div>
          <div class="row-sub">${Util.fmt(Math.min(p.count, p.goal))} / ${Util.fmt(p.goal)}</div>
        </div>
        <div class="row-actions">
          ${p.claimed ? '<span class="tag green">Claimed</span>' : `<button class="btn small ${p.complete && p.unlocked ? 'success' : 'secondary'}" ${p.complete && p.unlocked ? '' : 'disabled'}>Claim</button>`}
        </div>`;
      const btn = row.querySelector('button');
      if (btn && p.complete && p.unlocked) btn.onclick = () => {
        const r = Engine.claimQuest(q.id);
        if (r.error) this.toast(r.error, 'error');
        else this.toast(`Quest complete: ${q.name}!`, 'success');
        State.save(); this.render();
      };
      list.appendChild(row);
    }
    card.appendChild(list);
    wrap.appendChild(card);
    return wrap;
  },

  /* ============================ tab plumbing ============================ */

  _setTab() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === this.tab));
    this.render();
    window.scrollTo({ top: 0 });
  },

  bindTabs() {
    document.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => { this.tab = t.dataset.tab; this._setTab(); };
    });
  },
};

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) module.exports = { UI };
