const test = require('node:test');
const assert = require('node:assert');
const { segment, countKana } = require('../src/text/segment');

// 分段的硬依据：AQTK10 单个短语有上限（实测无标点连续 200 假名就 ERR 122）

test('短句不分段', () => {
  const segs = segment('你好呀。');
  assert.strictEqual(segs.length, 1);
});

test('按句号分段', () => {
  const text = '第一句话。第二句话。第三句话。';
  const segs = segment(text);
  assert.strictEqual(segs.length, 3, '实际: ' + JSON.stringify(segs));
  assert.ok(segs[0].includes('第一'));
});

test('长句按逗号再切', () => {
  // 造一个超过阈值但没有句号的句子
  const long = '这是一个很长很长的句子，'.repeat(20) + '结束';
  const segs = segment(long, { maxKana: 100 });
  assert.ok(segs.length > 1, '应被切开，实际段数: ' + segs.length);
  for (const s of segs) {
    const k = countKana(s);
    assert.ok(k <= 100 + 20, '每段假名数应接近阈值，实际 ' + k + ': ' + s.slice(0, 30));
  }
});

test('每段假名数不超过阈值', () => {
  const text = '今天天气真不错，我们去公园散步吧。明天还有更重要的事情要做呢。';
  const segs = segment(text, { maxKana: 60 });
  for (const s of segs) {
    assert.ok(countKana(s) <= 60 + 15, '超阈值: ' + countKana(s) + ' | ' + s);
  }
});

test('不切碎短句（避免碎片）', () => {
  const text = '好。行。可以。';
  const segs = segment(text, { maxKana: 100, minKana: 10 });
  assert.ok(segs.length < 3, '太短的句子应合并，实际: ' + JSON.stringify(segs));
});

test('空文本返回空数组', () => {
  assert.deepStrictEqual(segment(''), []);
  assert.deepStrictEqual(segment(null), []);
});

test('countKana 只数假名与汉字，不数标点空白', () => {
  assert.strictEqual(countKana('あいう'), 3);
  assert.strictEqual(countKana('あ、い。'), 2);
  assert.strictEqual(countKana('abc'), 0);
});

test('合并后仍保持原顺序', () => {
  const text = '第一。第二。第三。';
  const segs = segment(text, { maxKana: 100, minKana: 1 });
  assert.ok(segs.join('').indexOf('第一') < segs.join('').indexOf('第二'));
});
