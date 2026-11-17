'use strict';

const crypto = require('node:crypto');
const engine = require('./engine');
const presets = require('./voice/presets');
const { zh2jp, hasChinese, prepareText } = require('./text/zh2jp');
const { LruCache } = require('./cache');

let active = null;
let activeKind = null;

// ----------------------------------------------------------------
// 缓存
// ----------------------------------------------------------------

/**
 * 纯内存 LRU。容量按「段数」算：一段平均 ~200KB，500 段约 100MB 上限。
 * 不用磁盘 —— 合成一段只要 ~8ms，落盘收益抵不过管理成本，
 * 而且语音内容不该留在硬盘上。
 */
const DEFAULT_CACHE_SIZE = 500;
const cache = new LruCache(Number(process.env.YUKKURI_CACHE_SIZE) || DEFAULT_CACHE_SIZE);
let cacheEnabled = true;

/**
 * 缓存键：内容哈希。
 *
 * 必须覆盖所有影响输出的因素 —— 少一个就会串音：
 *   文本 + 声源 + 情绪 + 显式参数 + 引擎类型
 *
 * 用 sha256 的前 16 位（64 bit），碰撞概率对本地缓存来说足够低。
 */
function cacheKey(text, opts, kind) {
  // 参数要稳定序列化（对象 key 顺序可能不同）
  const params = opts.params || {};
  const paramStr = Object.keys(params)
    .sort()
    .map((k) => k + '=' + params[k])
    .join('&');

  const payload = [
    kind || 'local',
    opts.voice || 'f1',
    opts.emotion || 'neutral',
    paramStr,
    opts.koe !== undefined ? 'koe:' + opts.koe : 'text:' + text,
  ].join('\u0000');

  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}

const cacheControl = {
  stats: () => cache.stats(),
  clear: () => cache.clear(),
  enable: () => { cacheEnabled = true; },
  disable: () => { cacheEnabled = false; },
  isEnabled: () => cacheEnabled,
};

// ----------------------------------------------------------------
// 引擎
// ----------------------------------------------------------------

/**
 * 取得引擎单例。
 * 默认 local；用 configure() 或 YUKKURI_ENGINE / YUKKURI_ENDPOINT 环境变量切换。
 */
async function getEngine() {
  if (active) return active;

  const kind = activeKind || process.env.YUKKURI_ENGINE || 'local';
  active = await engine.open({
    kind,
    endpoint: process.env.YUKKURI_ENDPOINT || null,
  });
  activeKind = kind;
  return active;
}

/**
 * 切换引擎。在首次合成之前调用最可靠（会关掉已开的引擎）。
 * @param {{engine?: string, endpoint?: string}} cfg
 */
function configure(cfg = {}) {
  if (active) {
    active.close();
    active = null;
  }
  activeKind = cfg.engine || null;
  if (cfg.endpoint) process.env.YUKKURI_ENDPOINT = cfg.endpoint;
}

// ----------------------------------------------------------------
// 主接口
// ----------------------------------------------------------------

/**
 * 合成油库里语音（带缓存）。
 *
 * @param {string} text 日文，或中文（自动走 zh2jp 转假名）
 * @param {object} [opts]
 * @param {string} [opts.voice='f1'] 角色 id 或预设名
 * @param {string} [opts.emotion='neutral'] neutral|happy|angry|sad|surprised|shy|sleepy
 * @param {object} [opts.params] 直接覆盖 spd/pit/acc/lmd/fsc/vol
 * @param {string} [opts.koe] 已转好的音素，跳过全部文本处理
 * @param {boolean} [opts.noCache] 本次绕过缓存
 * @returns {Promise<Buffer>} WAV（16kHz 单声道 16bit）
 */
async function synthe(text, opts = {}) {
  const e = await getEngine();
  const useCache = cacheEnabled && !opts.noCache;
  const key = useCache ? cacheKey(text, opts, e.kind) : null;

  if (useCache) {
    const hit = cache.get(key);
    if (hit) return Buffer.from(hit); // 返回副本，防止调用方改动污染缓存
  }

  const wav = await e.synthe(text, opts);

  // 存的必须是副本：调用方拿到的是同一个 Buffer，它一改就会把缓存里的也改掉。
  // （这不是理论问题 —— 测试里改成 0xff 之后，第二次取回来的就是坏数据。）
  if (useCache) cache.set(key, Buffer.from(wav));

  return wav;
}

/** 预加载引擎，避免首次合成的加载延迟 */
async function warmup() {
  const e = await getEngine();
  return e.kind;
}

/** 只做到音素这一步（总是走本地 k2k，不受引擎配置影响） */
function toKoe(text) {
  const config = require('./config');
  const aqk2k = require('./codec/aqk2k');
  const k2k = aqk2k.open({
    dllPath: config.AQK2K_DLL,
    dicDir: config.AQK2K_DIC,
    devKey: config.resolveKeys().k2k,
  });
  try {
    return k2k.convert(prepareText(text));
  } finally {
    k2k.close();
  }
}

function close() {
  if (!active) return;
  active.close();
  active = null;
  activeKind = null;
}

module.exports = {
  synthe,
  warmup,
  configure,
  toKoe,
  zh2jp,
  hasChinese,
  close,
  presets,
  cacheControl,
  wavInfo: require('./wav').wavInfo,
  wavSeconds: require('./wav').wavSeconds,
  engines: engine,
};
