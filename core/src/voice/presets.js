'use strict';

const characters = require('./characters');

/**
 * AQTK10 预设声种。数值直接取自 AquesTalk.h 的 gVoice_* 常量。
 * bas: 0=F1E 1=F2E 2=M1E
 */
const PRESETS = {
  f1: { bas: 0, spd: 100, vol: 100, pit: 100, acc: 100, lmd: 100, fsc: 100 },
  f2: { bas: 1, spd: 100, vol: 100, pit: 77, acc: 150, lmd: 100, fsc: 100 },
  f3: { bas: 0, spd: 80, vol: 100, pit: 100, acc: 100, lmd: 61, fsc: 148 },
  m1: { bas: 2, spd: 100, vol: 100, pit: 30, acc: 100, lmd: 100, fsc: 100 },
  m2: { bas: 2, spd: 105, vol: 100, pit: 45, acc: 130, lmd: 120, fsc: 100 },
  r1: { bas: 2, spd: 100, vol: 100, pit: 30, acc: 20, lmd: 190, fsc: 100 },
  r2: { bas: 1, spd: 70, vol: 100, pit: 50, acc: 50, lmd: 50, fsc: 180 },
};

/**
 * 情绪 → 参数偏移。叠加在预设之上，不替换。
 * 用心之处：pit/acc/lmd 三者共同决定"语气"，单改一个听不出情绪。
 */
const EMOTIONS = {
  neutral: {},
  happy: { pit: +18, acc: +30, spd: +6 },
  angry: { pit: +8, acc: +55, spd: +12, vol: +15 },
  sad: { pit: -14, acc: -25, spd: -10, lmd: -12 },
  surprised: { pit: +30, acc: +25, spd: +8 },
  shy: { pit: +10, acc: -15, spd: -6, vol: -10 },
  sleepy: { pit: -8, acc: -30, spd: -18, lmd: -8 },
};

const CLAMP = { spd: [50, 300], vol: [0, 300], pit: [20, 200], acc: [0, 200], lmd: [0, 200], fsc: [50, 200] };

function clamp(name, value) {
  const [lo, hi] = CLAMP[name] || [0, 300];
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/**
 * 把 (声源, 情绪, 显式覆盖) 合成一个 AQTK_VOICE。
 *
 * 声源名可以是：
 *   - 预设声库名：f1 f2 f3 m1 m2 r1 r2
 *   - 角色 id：reimu marisa cirno ... （见 voice/characters.js）
 *
 * @param {string} voiceName 预设名或角色 id
 * @param {string} emotionName
 * @param {object} overrides 直接指定 spd/pit/... 优先级最高
 */
function resolve(voiceName = 'f1', emotionName = 'neutral', overrides = {}) {
  const base = PRESETS[voiceName] || characters.voiceOf(voiceName);
  const emo = EMOTIONS[emotionName];
  if (!emo) throw new Error('unknown emotion: ' + emotionName);

  const out = { bas: base.bas };
  for (const k of ['spd', 'vol', 'pit', 'acc', 'lmd', 'fsc']) {
    let v = base[k] + (emo[k] || 0);
    if (overrides[k] !== undefined) v = overrides[k];
    out[k] = clamp(k, v);
  }
  return out;
}

/** 这个名字是预设还是角色？ */
function isCharacter(name) {
  return !!characters.CHARACTERS[name];
}

/** 全部可用声源（预设 + 角色），供 UI 列表用 */
function listAll() {
  const out = Object.keys(PRESETS).map((id) => ({ id, kind: 'preset', name: id }));
  for (const c of characters.list()) {
    out.push({ id: c.id, kind: 'character', name: c.name, aqtk1: c.aqtk1, spd: c.spd, pit: c.pit });
  }
  return out;
}

module.exports = { PRESETS, EMOTIONS, resolve, clamp, isCharacter, listAll };
