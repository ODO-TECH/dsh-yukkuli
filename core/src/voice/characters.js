'use strict';

/**
 * 东方角色音色对照表。
 *
 * 混用三个引擎，音色按各声库预设原值，不做无谓覆盖。
 *
 *   aqtk10  原生 x64 DLL，7 个声质参数，16000Hz（F3 因 fsc=148 是 23680Hz）
 *   aqtk2   原生 x64 DLL + phont 声库文件，8000Hz
 *   aqtk1   官方只有 32 位 DLL，走 v86 WASM，8000Hz
 */

/** AQTK10 预设声种，数值取自 AquesTalk.h 的 gVoice_* */
const PRESETS = {
  F1: { bas: 0, spd: 100, vol: 100, pit: 100, acc: 100, lmd: 100, fsc: 100 },
  F2: { bas: 1, spd: 100, vol: 100, pit: 77, acc: 150, lmd: 100, fsc: 100 },
  F3: { bas: 0, spd: 80, vol: 100, pit: 100, acc: 100, lmd: 61, fsc: 148 },
  R1: { bas: 2, spd: 100, vol: 100, pit: 30, acc: 20, lmd: 190, fsc: 100 },
};

/**
 * 角色定义。
 *
 * speed:  AQTK1 / AQTK2 的语速（默认 100）
 * pitch:  AQTK1 / AQTK2 的音高倍数（默认 1）。
 *         这两个引擎没有音高参数，只能靠改 WAV 采样率实现 ——
 *         采样率乘 N，播放时音高和语速都乘 N（跟 AQTK10 的 fsc 一个道理）。
 *         所以「音高升 4%、语速慢 4%」= speed 92 + pitch 1.04。
 */
const CHARACTERS = {
  cirno:          { name: '琪露诺',       engine: 'aqtk10', preset: 'F3' },
  tenshi:         { name: '比那名居天子', engine: 'aqtk1',  voice: 'f1' },
  // 帕琪：AQTK1 f1，音高 +4%、语速 -4%
  patchouli:      { name: '帕秋莉·诺蕾姬', engine: 'aqtk1', voice: 'f1', speed: 92, pitch: 1.04 },
  marisa:         { name: '雾雨魔理沙',   engine: 'aqtk10', preset: 'F2' },
  reimu:          { name: '博丽灵梦',     engine: 'aqtk10', preset: 'F1' },
  patchouli_bass: { name: '低音炮帕秋莉', engine: 'aqtk1',  voice: 'r1' },
};

const SPDRANGE = [50, 300];

function clampSpeed(v) {
  return Math.min(SPDRANGE[1], Math.max(SPDRANGE[0], Math.round(v)));
}

/**
 * 把角色 + 情绪 解析成「用哪个引擎、带什么参数」。
 *
 * 情绪的处理是不对称的，这是引擎能力差异：
 *   aqtk10 有 7 个声质参数 → 音高/重音/声质都能调
 *   aqtk1 / aqtk2 只有「速度」→ 情绪只影响语速
 *
 * @param {string} id 角色 id
 * @param {{emotion?: string, params?: object}} [opts]
 * @returns {{engine: string, params: object, character: string}}
 */
function resolve(id, opts = {}) {
  const c = CHARACTERS[id];
  if (!c) {
    throw new Error(
      'unknown character: ' + JSON.stringify(id) +
      '（可用: ' + Object.keys(CHARACTERS).join(', ') + '）'
    );
  }

  const emoName = opts.emotion || 'neutral';
  const overrides = opts.params || {};
  const emo = require('./presets').EMOTIONS[emoName];
  if (!emo) throw new Error('unknown emotion: ' + emoName);

  if (c.engine === 'aqtk10') {
    const base = PRESETS[c.preset];
    if (!base) throw new Error('AQTK10 没有这个预设: ' + c.preset);

    const params = { ...base };
    for (const k of ['spd', 'vol', 'pit', 'acc', 'lmd', 'fsc']) {
      if (emo[k]) params[k] += emo[k];
    }
    for (const k of ['spd', 'vol', 'pit', 'acc', 'lmd', 'fsc']) {
      if (overrides[k] !== undefined) params[k] = overrides[k];
    }
    params.spd = clampSpeed(params.spd);
    return { engine: 'aqtk10', params, character: id };
  }

  if (c.engine === 'aqtk1') {
    const baseSpeed = c.speed != null ? c.speed : 100;
    const speed = overrides.spd !== undefined ? overrides.spd : baseSpeed + (emo.spd || 0);

    const params = { voice: c.voice, speed: clampSpeed(speed) };
    if (c.pitch != null && c.pitch !== 1) params.pitch = c.pitch;
    return { engine: 'aqtk1', params, character: id };
  }

  if (c.engine === 'aqtk2') {
    const baseSpeed = c.speed != null ? c.speed : 100;
    const speed = overrides.spd !== undefined ? overrides.spd : baseSpeed + (emo.spd || 0);

    const params = { phont: c.phont, speed: clampSpeed(speed) };
    if (c.pitch != null && c.pitch !== 1) params.pitch = c.pitch;
    return { engine: 'aqtk2', params, character: id };
  }

  throw new Error('角色 ' + id + ' 的引擎无法识别: ' + c.engine);
}

/** 按显示名找角色 */
function findByName(name) {
  for (const [id, c] of Object.entries(CHARACTERS)) {
    if (c.name === name) return id;
  }
  return null;
}

function list() {
  return Object.entries(CHARACTERS).map(([id, c]) => ({
    id,
    name: c.name,
    engine: c.engine,
    lib: c.preset || c.voice || c.phont,
    speed: c.speed,
    pitch: c.pitch,
  }));
}

module.exports = { CHARACTERS, PRESETS, resolve, findByName, list };
