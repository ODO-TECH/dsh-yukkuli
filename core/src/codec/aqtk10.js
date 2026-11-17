'use strict';

const koffi = require('koffi');

const VOICE = koffi.struct('AQTK_VOICE', {
  bas: 'int', // 基础音素片 F1E/F2E/M1E (0/1/2)
  spd: 'int', // 话速 50-300
  vol: 'int', // 音量 0-300
  pit: 'int', // 音高 20-200
  acc: 'int', // 重音 0-200
  lmd: 'int', // 声质1 0-200
  fsc: 'int', // 声质2(采样率) 50-200
});

/** 错误码 → 可读文案（来自 AQTK10 手册第 5 页） */
const ERRORS = {
  100: 'その他のエラー',
  101: 'メモリ不足',
  103: '音声記号列指定エラー（語頭の長音・促音の連続など）',
  104: '音声記号列に有効な読みがない',
  105: '音声記号列に未定義の読み記号',
  106: 'タグの指定が正しくない',
  107: 'タグの長さ制限超過',
  108: 'タグ内の値指定が正しくない',
  120: '音声記号列が長すぎる',
  121: '1フレーズ中の読み記号が多すぎる',
  122: '音声記号列が長い（内部バッファオーバー）',
};

let state = null; // { lib, Synthe, FreeWave }

function load(dllPath) {
  const lib = koffi.load(dllPath);
  const Synthe = lib.func('AquesTalk_Synthe_Utf8', 'void *', [
    VOICE, 'const char *', koffi.out(koffi.pointer('int')),
  ]);
  const FreeWave = lib.func('AquesTalk_FreeWave', 'void', ['void *']);
  const SetDevKey = lib.func('AquesTalk_SetDevKey', 'int', ['const char *']);
  const SetUsrKey = lib.func('AquesTalk_SetUsrKey', 'int', ['const char *']);
  return { lib, Synthe, FreeWave, SetDevKey, SetUsrKey };
}

/**
 * 打开引擎。devKey/usrKey 为 null 时不设置（评估版）。
 * 返回 { synthe(koe, voice), close() }
 */
function open({ dllPath, devKey = null, usrKey = null }) {
  const api = load(dllPath);

  if (devKey) {
    const rc = api.SetDevKey(devKey);
    if (rc !== 0) throw new Error('AquesTalk_SetDevKey 被拒绝 (rc=' + rc + ')');
  }
  if (usrKey) {
    const rc = api.SetUsrKey(usrKey);
    if (rc !== 0) throw new Error('AquesTalk_SetUsrKey 被拒绝 (rc=' + rc + ')');
  }

  return {
    /**
     * @param {string} koe 音声記号列（平假名/片假名记号，不是普通文本）
     * @param {object} voice AQTK_VOICE 覆盖项
     * @returns {Buffer} WAV
     */
    synthe(koe, voice = {}) {
      const v = {
        bas: voice.bas ?? 0,
        spd: voice.spd ?? 100,
        vol: voice.vol ?? 100,
        pit: voice.pit ?? 100,
        acc: voice.acc ?? 100,
        lmd: voice.lmd ?? 100,
        fsc: voice.fsc ?? 100,
      };
      const size = [0];
      const ptr = api.Synthe(v, koe, size);
      if (!ptr) {
        const code = size[0];
        const err = new Error('AquesTalk_Synthe 失败: ' + (ERRORS[code] || 'code=' + code));
        err.code = code;
        throw err;
      }
      const buf = Buffer.from(koffi.decode(ptr, koffi.array('uint8', size[0])));
      api.FreeWave(ptr);
      return buf;
    },
    close() {
      state = null;
    },
  };
}

module.exports = { open, VOICE, ERRORS };
