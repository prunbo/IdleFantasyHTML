/* ------------------------------------------------------------------ *
 * util.js — shared helpers
 * ------------------------------------------------------------------ */
'use strict';

const Util = {
  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },

  /** Random integer in [min, max] inclusive (mirrors Kotlin rnd.nextInt(min, max+1)). */
  randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); },

  /** Pick a random element from a weighted list [{key, weight}]. */
  weightedPick(entries) {
    const total = entries.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * total;
    for (const e of entries) {
      roll -= e.weight;
      if (roll <= 0) return e;
    }
    return entries[entries.length - 1];
  },

  /** Highest tier key (as int) <= level from a {"1": ..., "5": ...} map. */
  tierFor(tiers, level) {
    const keys = Object.keys(tiers).map(Number).sort((a, b) => a - b);
    let found = keys[0];
    for (const k of keys) if (k <= level) found = k;
    return tiers[String(found)];
  },

  fmt(n) {
    n = Math.floor(n);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('en-US');
  },

  fmtTime(ms) {
    if (ms <= 0) return '0s';
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  },

  prettify(key) {
    return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  },

  esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  },
};

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) module.exports = { Util };
