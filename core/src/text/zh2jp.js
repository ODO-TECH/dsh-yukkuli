'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pinyin } = require('pinyin-pro');
const PinyinToKana = require('pinyin-to-kana');

let p2k = null;

function dict() {
  if (p2k) return p2k;
  const tsv = fs.readFileSync(path.join(__dirname, 'mapping.tsv'), 'utf8');
  p2k = new PinyinToKana(tsv);
  return p2k;
}

const HAN = /[\u4e00-\u9fa5]/;
const KANA = /[\u3040-\u309f\u30a0-\u30ff]/;
const PUNCT = /[\u3000-\u303f\uff00-\uffef]/;

/**
 * 中文 → 日语假名。
 *
 * 思路与社区 zh-yukuuri 一致：汉字转拼音，再按拼音音节映射成假名。
 * 本质是"用日语的音去读中文"，这是油库里中文语音的通行做法。
 */
function zh2jp(text) {
  if (!text) return '';

  const parts = [];
  for (const ch of [...text]) {
    if (HAN.test(ch)) {
      parts.push(pinyin(ch, { toneType: 'none', type: 'array' })[0] + ' ');
    } else if (PUNCT.test(ch)) {
      parts.push(' ' + ch + ' ');
    } else {
      parts.push(ch);
    }
  }

  return dict().pinyinToKana(parts.join('')).replace(/\s+/g, ' ').trim();
}

/**
 * 这段文本要不要走中文拼音路线？
 *
 * 判据是「有没有假名」而不是「有没有汉字」：日文汉字（虐待、天気）不该被
 * 当成中文拼音读。含假名 = 日文，直通 AqKanji2Koe；纯汉字 = 中文，先转假名。
 */
function hasChinese(text) {
  if (!HAN.test(text)) return false;
  return !KANA.test(text);
}

/**
 * 文本预处理：中文走「数字转中文 → 拼音假名」，日文原样返回。
 *
 * 数字必须在这里换掉 —— AqKanji2Koe 遇到阿拉伯数字会输出
 * <NUMK VAL="8080"> 标签，AQTK10 按**日语**读（はっせんはちじゅう），
 * 中文回复里的数字就全变日语腔了。
 * 日文文本则保持原样：日语读数字本来就读对了。
 *
 * @param {string} text
 * @returns {string}
 */
function prepareText(text) {
  if (!hasChinese(text)) return text;
  const { toChineseNumerals } = require('./numbers');
  return zh2jp(toChineseNumerals(text));
}

module.exports = { zh2jp, hasChinese, prepareText };
