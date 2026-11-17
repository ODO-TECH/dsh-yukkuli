'use strict';

const config = require('../config');
const aqtk10 = require('../codec/aqtk10');
const aqtk1 = require('../codec/aqtk1');
const aqtk2 = require('../codec/aqtk2');
const aqk2k = require('../codec/aqk2k');
const presets = require('../voice/presets');
const characters = require('../voice/characters');
const { prepareText } = require('../text/zh2jp');

/**
 * 本地引擎：三个 AquesTalk 引擎 + AqKanji2Koe。
 *
 * 各角色按对照表指定的引擎合成：
 *   aqtk10  原生 x64 DLL（7 参数，16000Hz）
 *   aqtk2   原生 x64 DLL + phont（只有速度，8000Hz）
 *   aqtk1   32 位 DLL，走 v86 WASM（只有速度，8000Hz）
 *
 * 引擎按需惰性打开：只有真的用到 AQTK1/AQTK2 才付加载代价。
 */
async function open() {
  const keys = config.resolveKeys();

  const k2k = aqk2k.open({
    dllPath: config.AQK2K_DLL,
    dicDir: config.AQK2K_DIC,
    devKey: keys.k2k,
  });

  // AQTK10 便宜（8ms），直接开
  let tk10 = aqtk10.open({
    dllPath: config.AQTK10_DLL,
    devKey: keys.aqtk10,
    usrKey: keys.aqtk10Usr,
  });

  // AQTK1 / AQTK2 惰性加载
  let tk1 = null;
  let tk2 = null;

  function ensure1() {
    if (!tk1) {
      tk1 = aqtk1.open({ baseUrl: config.AQTK1_BASE_URL });
    }
    return tk1;
  }

  function ensure2() {
    if (!tk2) {
      tk2 = aqtk2.open({
        dllPath: config.AQTK2_DLL,
        phontDir: config.AQTK2_PHONT_DIR,
      });
    }
    return tk2;
  }

  return {
    kind: 'local',

    /**
     * @param {string} text 日文或中文
     * @param {{voice?: string, emotion?: string, params?: object, koe?: string}} opts
     * @returns {Promise<Buffer>} WAV（采样率随引擎/声库变化）
     */
    async synthe(text, opts = {}) {
      let koe;

      if (opts.koe !== undefined) {
        koe = opts.koe;
      } else {
        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error('text 不能为空');
        }
        koe = k2k.convert(prepareText(text));
        if (!koe) throw new Error('文本无法转换为音声記号列: ' + JSON.stringify(text));
      }

      const name = opts.voice || 'f1';

      // 角色 → 按对照表指定的引擎
      if (characters.CHARACTERS[name]) {
        const target = characters.resolve(name, {
          emotion: opts.emotion,
          params: opts.params,
        });

        if (target.engine === 'aqtk10') return tk10.synthe(koe, target.params);
        if (target.engine === 'aqtk1') return ensure1().synthe(koe, target.params);
        if (target.engine === 'aqtk2') return ensure2().synthe(koe, target.params);
        throw new Error('未知引擎: ' + target.engine);
      }

      // 预设声库名（f1 / f2 / ...）→ 一律走 AQTK10
      const voice = presets.resolve(name, opts.emotion, opts.params || {});
      return tk10.synthe(koe, voice);
    },

    /** 预先打开某个角色要用的引擎（可选） */
    async warmup(voiceName) {
      const c = characters.CHARACTERS[voiceName];
      if (!c) return;
      if (c.engine === 'aqtk1') await ensure1().warmup(c.voice);
      if (c.engine === 'aqtk2') ensure2();
    },

    async close() {
      k2k.close();
      if (tk10) tk10.close();
      if (tk1) await tk1.close();
      if (tk2) tk2.close();
      tk10 = null;
      tk1 = null;
      tk2 = null;
    },
  };
}

module.exports = { open };
