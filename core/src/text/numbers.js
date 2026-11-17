'use strict';

/**
 * 把阿拉伯数字转成中文读法。
 *
 * 为什么必须做这件事：
 *   AqKanji2Koe 遇到阿拉伯数字会输出 <NUMK VAL="8080"> 这样的标签，
 *   而 AQTK10 按**日语**规则读数字 —— 中文回复里的 8080 会被念成「はっせんはちじゅう」。
 *   所以在中文文本进合成之前，先把数字换成本来该有的中文读法。
 *
 * 读法规则（按中文习惯，不是逐位死读）：
 *   - 整体读：123 → 一百二十三
 *   - 逐位读：年份（2026年）、小数（1.3.3）、前导零（007）、5 位以上（10086）
 *   - 百分号：50% → 百分之五十
 */

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const UNITS = ['', '十', '百', '千'];
const BIG_UNITS = ['', '万', '亿'];

/** 逐位读：2026 → 二零二六 */
function digitByDigit(s) {
  return [...s].map((ch) => DIGITS[Number(ch)] ?? ch).join('');
}

/** 四位数以内按中文自然读法 */
function naturalBelow10000(s) {
  const n = Number(s);
  if (n === 0) return '零';

  const digits = s.padStart(4, '0').split('').map(Number);
  let out = '';
  let zeroPending = false;

  for (let i = 0; i < 4; i++) {
    const d = digits[i];
    const unit = UNITS[3 - i];
    if (d === 0) {
      zeroPending = out.length > 0;
      continue;
    }
    if (zeroPending) {
      out += '零';
      zeroPending = false;
    }
    out += DIGITS[d] + unit;
  }

  // 「一十三」→「十三」：中文里十位是 1 时不读「一」
  if (out.startsWith('一十')) out = out.slice(1);
  return out;
}

/** 按万/亿分组读 */
function naturalInteger(s) {
  const clean = s.replace(/^0+/, '');
  if (!clean) return '零';
  if (clean.length <= 4) return naturalBelow10000(clean);

  // 从右往左每四位一组
  const groups = [];
  let rest = clean;
  while (rest.length > 0) {
    groups.unshift(rest.slice(-4));
    rest = rest.slice(0, -4);
  }

  let out = '';
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const n = Number(g);
    const big = BIG_UNITS[groups.length - 1 - i] || '';
    if (n === 0) {
      // 整组为零：只在后面还有非零组时补一个零
      const rest2 = groups.slice(i + 1).some((x) => Number(x) !== 0);
      if (out && rest2 && !out.endsWith('零')) out += '零';
      continue;
    }
    // 组内不足四位且前面有内容时补零（例如 10005 → 一万零五）
    if (out && g.length < 4 && g[0] === '0' && !out.endsWith('零')) out += '零';
    out += naturalBelow10000(g) + big;
  }

  return out;
}

/**
 * 主入口：替换文本里的数字。
 * @param {string} text
 * @returns {string}
 */
function toChineseNumerals(text) {
  if (!text) return text || '';

  // 小数允许 1.3.3 这种多段（版本号），所以用 (?:\.\d+)+ 而不是单段
  return text.replace(/(-?)(\d+)((?:\.\d+)+)?(%?)/g, (match, neg, intPart, decPart, pct, offset, whole) => {
    // 小数：逐位 + 每个点都读出来（1.3.3 → 一点三点三，不是 一点三三）
    if (decPart) {
      const head = digitByDigit(intPart);
      const decText = digitByDigit(decPart.slice(1).replace(/\./g, '点'));
      return (neg ? '负' : '') + head + '点' + decText + (pct ? '%' : '');
    }

    // 看后面紧跟着的字（跳过空格）判断语境
    const tail = whole.slice(offset + match.length).replace(/^\s+/, '');
    const after = tail.slice(0, 1);
    const isYear = after === '年';

    // 语境：端口号、编号、密码这类要一位一位念
    const before = whole.slice(Math.max(0, offset - 8), offset);
    const looksLikeCode = /端口|编号|代号|密码|验证码|账号|工号|学号|电话|手机号|[Ii][Dd]$/.test(before);

    const hasLeadingZero = intPart.length > 1 && intPart[0] === '0';
    // 5 位以上：整数末尾有多个零的（10000、12000）按自然读，
    // 其余多半是端口/ID（10086、8080 这种）逐位读更像话
    const longEnough = intPart.length >= 5;
    const isRound = /0{3,}$/.test(intPart);
    const tooLong = longEnough && !isRound;

    let body;
    if (isYear || hasLeadingZero || tooLong || (looksLikeCode && intPart.length >= 3)) {
      body = digitByDigit(intPart);
    } else {
      body = naturalInteger(intPart);
    }

    if (pct) return '百分之' + body;
    return (neg ? '负' : '') + body;
  });
}

module.exports = { toChineseNumerals, digitByDigit, naturalInteger };
