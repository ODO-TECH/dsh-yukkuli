'use strict';

const path = require('node:path');
const os = require('node:os');

/**
 * SDK 根目录。必须是纯 ASCII 路径：
 * AqKanji2Koe 用 ANSI 编码读词典路径，非 ASCII 会让 Create 返回 NULL（err=200）。
 *
 * 默认 `~/yukkuri-sdk`（用户主目录下），装到别处就设 YUKKURI_SDK_ROOT。
 * 这里刻意不写任何一台机器的绝对路径 —— 写死的那份在别人机器上只会变成
 * 「DLL 找不到」或者更难查的「辞書パスの文字コード不正」。
 */
/** 默认位置：用户主目录下（不写死任何一台机器的盘符） */
const DEFAULT_SDK_ROOT = path.join(os.homedir(), 'yukkuri-sdk');

const SDK_ROOT = process.env.YUKKURI_SDK_ROOT || DEFAULT_SDK_ROOT;

// 来源也在 require 那一刻定死：SDK_ROOT 之后不会再变，若这里改为读 process.env，
// 调用方改了 env 之后 describe() 就会「路径是 env 的、来源说成 default」。
const SDK_ROOT_SOURCE = process.env.YUKKURI_SDK_ROOT ? 'env' : 'default';

/** 只在 env 与默认值真的不同的时候，才值得把两个候选都列出来 */
function sdkCandidates() {
  const fs = require('node:fs');
  const list = [{ path: SDK_ROOT, exists: fs.existsSync(SDK_ROOT), source: SDK_ROOT_SOURCE }];
  if (DEFAULT_SDK_ROOT !== SDK_ROOT) {
    list.push({ path: DEFAULT_SDK_ROOT, exists: fs.existsSync(DEFAULT_SDK_ROOT), source: 'default' });
  }
  return list;
}

const AQTK10_DLL = path.join(SDK_ROOT, 'aqtk10_win', 'lib64', 'AquesTalk.dll');
const AQK2K_DLL = path.join(SDK_ROOT, 'aqk2k_win', 'lib64', 'AqKanji2Koe.dll');
const AQK2K_DIC = path.join(SDK_ROOT, 'aqk2k_win', 'aq_dic');

const AQTK2_DLL = path.join(SDK_ROOT, 'aqtk2-win-eva', 'lib64', 'AquesTalk2.dll');
const AQTK2_PHONT_DIR = path.join(SDK_ROOT, 'aqtk2-win-eva', 'phont');

/**
 * AQTK1 没有原生 x64 库（官方只发 32 位 DLL），所以走 aquestalk.js 的 v86 WASM。
 * 那个包的声库目录可以覆盖 —— 默认用 node_modules 里的。
 */
const AQTK1_BASE_URL = process.env.YUKKURI_AQTK1_URL || null;

/**
 * 解析许可证密钥。
 *
 * 优先级：环境变量（官方 key）> kg 现算（学习版）。
 * 接入正版 SDK 后，只要设这两个环境变量即可，代码不用动：
 *   YUKKURI_AQTK10_DEV_KEY / YUKKURI_AQTK10_USR_KEY / YUKKURI_AQK2K_DEV_KEY
 */
function resolveKeys() {
  const kg = require('./kg');

  return {
    aqtk10: process.env.YUKKURI_AQTK10_DEV_KEY || kg.generateDevKey('tk10'),
    aqtk10Usr: process.env.YUKKURI_AQTK10_USR_KEY || kg.generateUsrKey('tk10'),
    k2k: process.env.YUKKURI_AQK2K_DEV_KEY || kg.generateDevKey('k2k'),
  };
}

/** 启动自检：路径存在且是 ASCII */
function describe() {
  const fs = require('node:fs');
  const d = {
    sdkRoot: SDK_ROOT,
    sdkRootIsAscii: /^[\x20-\x7E]*$/.test(SDK_ROOT),
    sdkRootFromEnv: SDK_ROOT_SOURCE === 'env',
    // 默认值在别人机器上同样不可达，所以「这个路径是谁给的」必须能被看见
    sdkRootSource: SDK_ROOT_SOURCE,
    candidates: sdkCandidates(),
    aqtk10: fs.existsSync(AQTK10_DLL),
    aqtk2: fs.existsSync(AQTK2_DLL),
    aqtk2Phont: fs.existsSync(AQTK2_PHONT_DIR),
    aqk2k: fs.existsSync(AQK2K_DLL),
    dic: fs.existsSync(path.join(AQK2K_DIC, 'aqdic.bin')),
  };
  if (!d.sdkRootIsAscii) {
    d.hint = 'SDK 路径含非 ASCII 字符（' + SDK_ROOT + '），AqKanji2Koe 用 ANSI 读词典路径，会返回 NSW 200。'
      + '换到纯 ASCII 路径，或把 YUKKURI_SDK_ROOT 指向一个纯 ASCII 目录。';
  } else if (!d.aqtk10 || !d.aqk2k) {
    d.hint = '没在 ' + SDK_ROOT + ' 找到 SDK。二选一：把 SDK 放到 ' + DEFAULT_SDK_ROOT
      + '，或设 YUKKURI_SDK_ROOT 指向现有的 SDK 目录（必须是纯 ASCII 路径）。';
  }
  return d;
}

/**
 * 机器可判读的自检结果。插件在首次合成前先问它，
 * 这样失败信息里会带上路径，而不是 koffi 那句「找不到指定的模块」。
 * @returns {{ok: boolean, code: 'ok'|'sdk-missing'|'sdk-not-ascii', sdkRoot: string, source: string, message: string}}
 */
function check() {
  const d = describe();
  const base = { sdkRoot: d.sdkRoot, source: d.sdkRootSource };
  if (!d.sdkRootIsAscii) {
    return Object.assign({ ok: false, code: 'sdk-not-ascii' }, base, { message: d.hint });
  }
  if (!d.aqtk10 || !d.aqk2k) {
    const missing = [!d.aqtk10 && 'aqtk10_win/lib64/AquesTalk.dll', !d.aqk2k && 'aqk2k_win/lib64/AqKanji2Koe.dll']
      .filter(Boolean).join('、');
    return Object.assign({ ok: false, code: 'sdk-missing' }, base, { message: d.hint + '（缺：' + missing + '）' });
  }
  return Object.assign({ ok: true, code: 'ok' }, base, { message: 'SDK 就位：' + d.sdkRoot });
}

module.exports = {
  SDK_ROOT,
  DEFAULT_SDK_ROOT,
  AQTK10_DLL,
  AQTK1_BASE_URL,
  AQTK2_DLL,
  AQTK2_PHONT_DIR,
  AQK2K_DLL,
  AQK2K_DIC,
  resolveKeys,
  describe,
  check,
};
