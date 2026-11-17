'use strict';

/**
 * 远端引擎：yukumo.net 风格的 HTTP TTS 端点。
 *
 * 保留的原因：官方站点的音质（同一套 AQTK10，但服务端参数调校更细）
 * 以及将来个人授权服务都走这条路。这不是"以后可能会用"的空想 ——
 * 社区项目 zh-yukuuri 证明了接口形态，只要端点可达就能用。
 *
 * 端点形态（与官网一致）：
 *   {endpoint}/:aqtk/koe.mp3?type=..&speed=..&volume=..&pitch=..&accent=..&lmd=..&fsc=..&kanji=..
 *
 * 已知限制：www.yukumo.net 的 /api/* 被 Cloudflare 拦截，直连不通。
 * 本适配器不做任何绕过尝试 —— 端点不可达就如实失败。
 */

function buildUrl(endpoint, aqtk, koe, voice) {
  const v = voice || {};
  const q = new URLSearchParams({
    type: v.type || 'f1',
    speed: String(v.spd ?? 100),
    volume: String(v.vol ?? 100),
    pitch: String(v.pit ?? 100),
    accent: String(v.acc ?? 100),
    lmd: String(v.lmd ?? 100),
    fsc: String(v.fsc ?? 100),
    kanji: koe,
    effect: 'none',
  });
  return endpoint.replace(/\/+$/, '') + '/' + aqtk + '/koe.mp3?' + q.toString();
}

/**
 * @param {{endpoint: string, aqtk?: string, timeoutMs?: number}} opts
 */
async function open(opts = {}) {
  const { endpoint, aqtk = 'aqtk10', timeoutMs = 15000 } = opts;

  if (!endpoint || typeof endpoint !== 'string') {
    throw new Error('remote 引擎需要配置 endpoint（例如 https://your-proxy/）');
  }

  return {
    kind: 'remote',
    endpoint,

    /**
     * @param {string} koe 已转好的音素（远端负责自己转换时也可传原文）
     * @param {{params?: object, type?: string}} o
     */
    async synthe(koe, o = {}) {
      const url = buildUrl(endpoint, aqtk, koe, { ...(o.params || {}), type: o.type });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          throw new Error('remote 引擎返回 ' + res.status + '（端点: ' + endpoint + '）');
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.slice(0, 4).toString() !== 'RIFF') {
          throw new Error('remote 引擎返回的不是 WAV（可能是错误页）');
        }
        return buf;
      } finally {
        clearTimeout(timer);
      }
    },

    close() {},
  };
}

module.exports = { open, buildUrl };
