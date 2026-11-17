'use strict';

const path = require('node:path');
const { resolveCorePath } = require('./core-path.cjs');

/**
 * 没显式传 extract / segment 时，按和插件入口同一套规则去找 core。
 *
 * 以前这里直接 `require('../../core/src/text/extract')`：在源码仓库里恰好能解析到，
 * 一装进 node_modules 就指向不存在的目录。现在走 core-path，且 npm 布局也认。
 */
function requireCore(spec) {
  const { path: corePath } = resolveCorePath({
    siblingBase: path.join(__dirname, '..', '..', 'core', 'src'),
    resolveModule: (id) => require.resolve(id),
  });
  return require(corePath + '/' + spec);
}

/**
 * 朗读管线：一轮对话的原文 → 一组合成好的音频段。
 *
 * 三件事串起来：
 *   extract（只留能念的自然语言）→ segment（切成能合成的长度）→ synth（合成）

 * 关键设计是 onSegment 回调：每合成完一段就交出去，
 * 播放端可以立刻开播，不必等整轮全部合成完。
 * 这就是「长文本不卡」的实现方式 —— 不是优化，是结构决定的。
 */

function createPipeline(opts = {}) {
  const synth = opts.synth;
  const onError = opts.onError || (() => {});
  const onSegment = opts.onSegment || null;
  // 默认用 core 的实现；显式传进来是为了测试（可以不碰真实 DLL / 词典）
  const extract = opts.extract || requireCore('text/extract').extract;
  const segment = opts.segment || requireCore('text/segment').segment;

  if (typeof synth !== 'function') {
    throw new Error('createPipeline 需要 synth 函数');
  }
  if (typeof extract !== 'function') {
    throw new Error('createPipeline 的 extract 不是函数');
  }
  if (typeof segment !== 'function') {
    throw new Error('createPipeline 的 segment 不是函数');
  }

  // 时长从 WAV 头算 —— 采样率不是固定的（F3 声库 fsc=148 → 23680Hz）
  const wavSeconds =
    opts.wavSeconds ||
    (() => {
      try {
        return requireCore('wav').wavSeconds;
      } catch {
        return (buf) => {
          if (!buf || buf.length <= 44) return 0;
          const hz = buf.readUInt32LE(24) || 16000;
          const ch = buf.readUInt16LE(22) || 1;
          const bits = buf.readUInt16LE(34) || 16;
          return (buf.length - 44) / (bits / 8) / ch / hz;
        };
      }
    })();

  return {
    /**
     * @param {string} raw 一轮对话的原文
     * @param {{voice?: string, emotion?: string, params?: object, maxKana?: number}} vopts
     * @returns {Promise<Array<{index:number, text:string, wav:Buffer, seconds:number}>>}
     */
    async render(raw, vopts = {}) {
      const clean = extract(raw);
      if (!clean) return [];

      const pieces = segment(clean, { maxKana: vopts.maxKana });
      if (!pieces.length) return [];

      const out = [];
      for (let i = 0; i < pieces.length; i++) {
        const text = pieces[i];
        let wav;
        try {
          wav = await synth(text, {
            voice: vopts.voice,
            emotion: vopts.emotion,
            params: vopts.params,
          });
        } catch (err) {
          // 一段失败不该毁掉整轮 —— 跳过它，继续念后面
          onError(err, { index: i, text });
          continue;
        }

        const seg = { index: i, text, wav, seconds: wavSeconds(wav) };
        out.push(seg);

        // 逐段回调：播放端可以边收边播
        if (onSegment) {
          try {
            onSegment(seg);
          } catch (err) {
            onError(err, { index: i, text, phase: 'onSegment' });
          }
        }
      }

      return out;
    },
  };
}

module.exports = { createPipeline };
