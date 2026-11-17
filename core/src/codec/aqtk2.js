'use strict';

/**
 * AquesTalk2 绑定（原生 x64 DLL）。
 *
 * 与 AQTK10 的区别：
 *   - 没有 7 个声质参数，只有「速度」一个可调
 *   - 音色完全由 phont 声库文件决定（aq_f1c.phont 等）
 *   - 输出 8000Hz（AQTK10 是 16000Hz）
 *   - 没有 SetDevKey：Eva 版就是完整可用的
 *
 * 接口：AquesTalk2_Synthe_Utf8(koe, speed, size, phontPtr)
 * phontPtr 传 NULL 用内藏默认音质；传 phont 文件内容的内存指针则用那个声库。
 */

const fs = require('node:fs');
const koffi = require('koffi');
const { shiftPitch } = require('../wav');

function open({ dllPath, phontDir }) {
  const lib = koffi.load(dllPath);

  const Synthe = lib.func('AquesTalk2_Synthe_Utf8', 'void *', [
    'const char *', // koe
    'int',          // speed
    koffi.out(koffi.pointer('int')), // size out
    'void *',       // phontDat
  ]);
  const FreeWave = lib.func('AquesTalk2_FreeWave', 'void', ['void *']);

  // phont 文件只读一次，缓存住（同一个声库反复用）
  const phontCache = new Map();

  function loadPhont(name) {
    if (!name) return null;
    if (phontCache.has(name)) return phontCache.get(name);

    const file = name.endsWith('.phont') ? name : name + '.phont';
    const full = phontDir + '/' + file;

    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch (err) {
      throw new Error('找不到 phont 声库: ' + full + '（' + err.message + '）');
    }

    phontCache.set(name, buf);
    return buf;
  }

  return {
    /**
     * @param {string} koe 音声記号列
     * @param {{speed?: number, phont?: string, pitch?: number}} opts
     * @returns {Buffer} WAV（8000Hz）
     */
    synthe(koe, opts = {}) {
      const speed = Math.round(opts.speed ?? 100);
      const phont = loadPhont(opts.phont);

      const size = [0];
      const ptr = Synthe(koe, speed, size, phont);
      if (!ptr) {
        const err = new Error('AquesTalk2_Synthe 失败: code=' + size[0] + (phont ? '' : '（可能 phont 不对）'));
        err.code = size[0];
        throw err;
      }

      const buf = Buffer.from(koffi.decode(ptr, koffi.array('uint8', size[0])));
      FreeWave(ptr);

      // 音高：AQTK2 同样没有音高参数，靠改采样率
      return opts.pitch && opts.pitch !== 1 ? shiftPitch(buf, opts.pitch) : buf;
    },

    /** 这个声库里有哪些 phont */
    phonts() {
      try {
        return fs.readdirSync(phontDir).filter((f) => f.endsWith('.phont'));
      } catch {
        return [];
      }
    },

    close() {}
  };
}

module.exports = { open };
