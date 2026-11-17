'use strict';

/**
 * 分段：把长文本切成 AQTK10 能稳定合成的片段。
 *
 * 分段依据是实测出来的，不是拍脑袋：
 *   - 无标点连续 200 假名 → ERR 122（内部缓冲区溢出）
 *   - 带标点分隔的 1000 假名 → OK
 *
 * 所以真正要控制的是「单个短语的长度」，不是总长度。
 * 而中文转假名会膨胀约 2.3 倍，必须按换算后的假名数量算。
 */

const DEFAULT_MAX_KANA = 100;
// 中文句子天然很短：「第一句。」只有 3 个假名，「你好。」只有 2 个。
// 阈值定高了会把正常句子当成碎片合并掉（实测 4 就会把三句话并成一段）。
// 1 的意思是：只有「一。」「嗯。」这类单音节碎片才考虑合并。
const DEFAULT_MIN_KANA = 1;

/** 句末标点（强边界） */
const SENTENCE_END = /[。！？!?…]/;
/** 句中停顿（弱边界） */
const CLAUSE_BREAK = /[，、；：,;:]/;

/**
 * 数一段文本里「要发音的字符」数量。
 *
 * 假名 + 汉字各算 1（汉字在日文里也占一个音节单位，保守估计）。
 * 标点、空白、拉丁字母不算。
 *
 * 对中文来说这是低估 —— 中文会先转成假名再念，膨胀在后面算。
 * 所以调用方应该先 zh2jp 再数，那才是真实发音量。
 */
function countKana(text) {
  if (!text) return 0;
  const m = text.match(/[\u3040-\u30ff\u4e00-\u9fa5]/g);
  return m ? m.length : 0;
}

/**
 * 先把文本按标点切成「原子片段」，保持边界标点。
 */
function splitByPunctuation(text) {
  const out = [];
  let buf = '';

  for (const ch of text) {
    buf += ch;
    if (SENTENCE_END.test(ch)) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);

  return out;
}

/**
 * 把超长的一段按逗号再切。
 */
function splitLong(piece, maxKana) {
  if (countKana(piece) <= maxKana) return [piece];

  const parts = [];
  let buf = '';
  for (const ch of piece) {
    buf += ch;
    if (CLAUSE_BREAK.test(ch) && countKana(buf) >= maxKana * 0.6) {
      parts.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf);

  // 逗号也切不开的（比如一长串没有标点的假名），按字符硬切
  const out = [];
  for (const p of parts) {
    if (countKana(p) <= maxKana) {
      out.push(p);
      continue;
    }
    let chunk = '';
    let n = 0;
    for (const ch of p) {
      chunk += ch;
      if (/[\u3040-\u30ff\u4e00-\u9fa5]/.test(ch)) n += 1;
      if (n >= maxKana) {
        out.push(chunk);
        chunk = '';
        n = 0;
      }
    }
    if (chunk.trim()) out.push(chunk);
  }
  return out;
}

/**
 * 把过短的相邻片段合并，避免「好。」「行。」这种碎片。
 *
 * 两条约束，缺一不可：
 *   1. 只合并「极短」的片段（< minKana），正常句子不参与
 *   2. 合并后仍不能超过 maxKana
 *
 * 之前的实现只看「两个都短」，结果三句正常的中文（各 4 假名）被一路并成一句。
 * 现在额外要求：**合并后的结果仍算短**才继续并，否则宁可留成几段。
 */
function mergeShort(pieces, minKana, maxKana) {
  const out = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last === undefined) {
      out.push(p);
      continue;
    }

    const cur = countKana(p);
    const prev = countKana(last);
    const merged = prev + cur;

    // 只有「当前这段极短」且「并进去还只是个小片段」才合并。
    // merged 上限用 8：并完之后最多也就一个短短语，不会把整段吃进去。
    const shouldMerge = cur < minKana && merged <= Math.min(maxKana, 8);

    if (shouldMerge) {
      out[out.length - 1] = last + p;
    } else {
      out.push(p);
    }
  }
  return out;
}

/**
 * 把文本切成可合成的片段。
 *
 * @param {string} text
 * @param {{maxKana?: number, minKana?: number}} [opts]
 * @returns {string[]} 片段数组（已去空、已合并过短片段）
 */
function segment(text, opts = {}) {
  const maxKana = opts.maxKana ?? DEFAULT_MAX_KANA;
  const minKana = opts.minKana ?? DEFAULT_MIN_KANA;

  if (!text || !text.trim()) return [];

  const sentences = splitByPunctuation(text);
  const pieces = [];
  for (const s of sentences) {
    for (const p of splitLong(s, maxKana)) {
      if (p.trim()) pieces.push(p);
    }
  }

  return mergeShort(pieces, minKana, maxKana)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = { segment, countKana, DEFAULT_MAX_KANA, DEFAULT_MIN_KANA };
