const test = require('node:test');
const assert = require('node:assert');
const { toChineseNumerals } = require('../src/text/numbers');

// 中文文本里的阿拉伯数字必须转成中文读法。
// 不转的话 AqKanji2Koe 会吐 <NUMK VAL="..."> 标签，AQTK10 按**日语**读，
// 中文回复里的 8080 就被念成「はっせんはちじゅう」了。

test('小整数按中文自然读法', () => {
  assert.strictEqual(toChineseNumerals('8'), '八');
  assert.strictEqual(toChineseNumerals('10'), '十');
  assert.strictEqual(toChineseNumerals('13'), '十三');
  assert.strictEqual(toChineseNumerals('45'), '四十五');
  assert.strictEqual(toChineseNumerals('100'), '一百');
  assert.strictEqual(toChineseNumerals('123'), '一百二十三');
  assert.strictEqual(toChineseNumerals('1234'), '一千二百三十四');
});

test('万的读法', () => {
  assert.strictEqual(toChineseNumerals('10000'), '一万');
  assert.strictEqual(toChineseNumerals('12000'), '一万二千');
});

test('年份逐位读', () => {
  assert.strictEqual(toChineseNumerals('2026年'), '二零二六年');
  assert.strictEqual(toChineseNumerals('2026 年'), '二零二六 年');
});

test('小数逐位读', () => {
  assert.strictEqual(toChineseNumerals('1.3.3'), '一点三点三');
  assert.strictEqual(toChineseNumerals('3.14'), '三点一四');
});

test('百分号', () => {
  assert.strictEqual(toChineseNumerals('50%'), '百分之五十');
});

test('长数字逐位读（端口/ID 更像）', () => {
  assert.strictEqual(toChineseNumerals('8080'), '八千零八十');
  assert.strictEqual(toChineseNumerals('10086'), '一零零八六');
});

test('前导零逐位读', () => {
  assert.strictEqual(toChineseNumerals('007'), '零零七');
});

test('混在句子里只换数字', () => {
  assert.strictEqual(toChineseNumerals('一共 123 个文件'), '一共 一百二十三 个文件');
  assert.strictEqual(toChineseNumerals('第 3 行'), '第 三 行');
  assert.strictEqual(toChineseNumerals('耗时 45 毫秒'), '耗时 四十五 毫秒');
});

test('端口/编号这类按位读', () => {
  assert.strictEqual(toChineseNumerals('端口 8080'), '端口 八零八零');
  assert.strictEqual(toChineseNumerals('编号 123'), '编号 一二三');
  assert.strictEqual(toChineseNumerals('密码 4455'), '密码 四四五五');
});

test('不含数字的文本原样返回', () => {
  assert.strictEqual(toChineseNumerals('你好呀'), '你好呀');
  assert.strictEqual(toChineseNumerals(''), '');
});

test('负数', () => {
  assert.strictEqual(toChineseNumerals('-5'), '负五');
});
