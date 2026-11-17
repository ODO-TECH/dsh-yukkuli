'use strict';

/**
 * AquesTalk1 绑定。
 *
 * 为什么走 WASM 而不是原生 DLL：
 *   AQTK1 的官方 DLL 只有 32 位（PE32 / x86），
 *   而 Node 是 x64 —— koffi 加载不了不同架构的库。
 *   aquestalk.js 用 v86 在 WebAssembly 里模拟 Win32，
 *   所以我们能拿到真正的 AQTK1 音色（不是近似）。
 *
 * 代价：
 *   - 每句约 50-100ms（AQTK10 是 8ms）—— 播放一句要 2 秒，够用
 *   - 首次加载约 200ms（一次性）
 *   - 输出 8000Hz
 *
 * 好消息：这个包里的 DLL 是**完整版**，没有评估版「ナ行/マ行变ヌ」的限制
 * （实测「なにぬねの」与「ぬぬぬぬぬ」波形不同）。
 */

const { shiftPitch } = require('../wav');

const VOICES = ['f1', 'f2', 'f3', 'm1', 'm2', 'r1', 'dvd', 'imd1', 'jgr'];

function open(opts = {}) {
  const loadOptions = opts.baseUrl ? { baseUrl: opts.baseUrl } : {};

  // 每个声库一个 v86 实例；按需加载并缓存
  const instances = new Map();
  let closed = false;

  async function instance(voice) {
    if (closed) throw new Error('AQTK1 已关闭');
    if (!VOICES.includes(voice)) {
      throw new Error('AQTK1 没有这个声库: ' + voice + '（可用: ' + VOICES.join(', ') + '）');
    }

    if (instances.has(voice)) return instances.get(voice);

    const { load } = await import('aquestalk.js');
    const promise = load(voice, loadOptions);
    instances.set(voice, promise);
    return promise;
  }

  return {
    /**
     * @param {string} koe 音声記号列
     * @param {{speed?: number, voice?: string, pitch?: number}} o
     * @returns {Promise<Buffer>} WAV（8000Hz）
     */
    async synthe(koe, o = {}) {
      const voice = o.voice || 'f1';
      const speed = Math.round(o.speed ?? 100);

      const aq = await instance(voice);
      const wav = Buffer.from(aq.run(koe, speed));

      // 音高：AQTK1 本身没有这个参数，只能靠改采样率
      // （会让语速同比例变快，所以调用方要先把 speed 调慢来补偿）
      return o.pitch && o.pitch !== 1 ? shiftPitch(wav, o.pitch) : wav;
    },

    /** 预热（可选）：提前把某个声库加载好 */
    async warmup(voice = 'f1') {
      await instance(voice);
    },

    async close() {
      closed = true;
      for (const p of instances.values()) {
        try {
          const aq = await p;
          if (aq && typeof aq.destroy === 'function') await aq.destroy();
        } catch {}
      }
      instances.clear();
    },
  };
}

module.exports = { open, VOICES };
