'use strict';

const koffi = require('koffi');

/** AqKanji2Koe 错误码（手册：200 番台=系统词典不正，300 番台=用户词典不正） */
const ERRORS = {
  200: 'システム辞書(aqdic.bin)が不正、または辞書パスの文字コード不正',
  300: 'ユーザ辞書(aq_user.dic)が不正',
  1: '音声記号列に変換できない文字が含まれる',
  2: '出力バッファ不足',
};

/**
 * 打开词典引擎。
 *
 * 重要：dicDir 必须是纯 ASCII 路径。该 DLL 用 ANSI 编码读取路径，
 * 非 ASCII 字符会导致 Create 返回 NULL（err=200）。
 *
 * @param {{dllPath: string, dicDir: string, devKey?: string|null}} opts
 */
function open({ dllPath, dicDir, devKey = null }) {
  const lib = koffi.load(dllPath);

  const Create = lib.func('AqKanji2Koe_Create', 'void *', [
    'const char *', koffi.out(koffi.pointer('int')),
  ]);
  const Release = lib.func('AqKanji2Koe_Release', 'void', ['void *']);
  const Convert = lib.func('AqKanji2Koe_Convert_utf8', 'int', [
    'void *', 'const char *', koffi.out(koffi.pointer('char')), 'int',
  ]);
  const SetDevKey = lib.func('AqKanji2Koe_SetDevKey', 'int', ['const char *']);

  if (devKey) {
    const rc = SetDevKey(devKey);
    if (rc !== 0) throw new Error('AqKanji2Koe_SetDevKey 被拒绝 (rc=' + rc + ')');
  }

  const err = [0];
  const handle = Create(dicDir, err);
  if (!handle) {
    const e = new Error('AqKanji2Koe_Create 失败: ' + (ERRORS[err[0]] || 'code=' + err[0]));
    e.code = err[0];
    throw e;
  }

  return {
    /** 汉字假名混じり文 → 音声記号列 */
    convert(text) {
      const bufSize = Math.max(256, Buffer.byteLength(text, 'utf8') * 4 + 256);
      const out = Buffer.alloc(bufSize);
      const rc = Convert(handle, text, out, bufSize);
      if (rc !== 0) {
        const e = new Error('AqKanji2Koe_Convert 失败: ' + (ERRORS[rc] || 'code=' + rc));
        e.code = rc;
        throw e;
      }
      return out.toString('utf8').replace(/\0.*$/s, '');
    },
    close() {
      Release(handle);
    },
  };
}

module.exports = { open, ERRORS };
