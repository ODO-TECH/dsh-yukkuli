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
const SDK_ROOT = process.env.YUKKURI_SDK_ROOT || path.join(os.homedir(), 'yukkuri-sdk');

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
    sdkRootFromEnv: Boolean(process.env.YUKKURI_SDK_ROOT),
    aqtk10: fs.existsSync(AQTK10_DLL),
    aqtk2: fs.existsSync(AQTK2_DLL),
    aqtk2Phont: fs.existsSync(AQTK2_PHONT_DIR),
    aqk2k: fs.existsSync(AQK2K_DLL),
    dic: fs.existsSync(path.join(AQK2K_DIC, 'aqdic.bin')),
  };
  if (!d.sdkRootIsAscii) {
    d.hint = 'SDK 路径含非 ASCII 字符，AqKanji2Koe 会读不出词典。换到纯 ASCII 路径（如 ~/yukkuri-sdk）。';
  } else if (!d.aqtk10 || !d.aqk2k) {
    d.hint = '没在 ' + SDK_ROOT + ' 找到 SDK。把 SDK 放这里，或设 YUKKURI_SDK_ROOT 指向它。';
  }
  return d;
}

module.exports = {
  SDK_ROOT,
  AQTK10_DLL,
  AQTK1_BASE_URL,
  AQTK2_DLL,
  AQTK2_PHONT_DIR,
  AQK2K_DLL,
  AQK2K_DIC,
  resolveKeys,
  describe,
};
