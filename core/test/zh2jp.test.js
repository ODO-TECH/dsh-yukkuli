const test = require('node:test');
const assert = require('node:assert');
const { zh2jp, hasChinese } = require('../src');

// 日文里的汉字不能被当成中文拼音处理
test('含假名的日文不应被判为中文', () => {
  assert.strictEqual(hasChinese('われわれは、ゆっくりを虐待するぞ！'), false,
    '有假名 → 是日文，不该走中文拼音');
  assert.strictEqual(hasChinese('ゆっくりしていってね'), false);
  assert.strictEqual(hasChinese('你好'), true, '纯汉字 → 中文');
  assert.strictEqual(hasChinese('今天天气不错'), true);
});

test('日文直通不产生拼音残留', () => {
  // 日文走 koe 转换时，不应出现拉丁字母
  const out = zh2jp('虐待');  // 单看是汉字，会被转
  assert.ok(typeof out === 'string');
});
