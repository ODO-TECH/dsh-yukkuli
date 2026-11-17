const test = require('node:test');
const assert = require('node:assert');
const { createPipeline } = require('../lib/pipeline.cjs');

// 朗读管线：一轮对话的原文 → 一组合成好的音频段
// 用假的 synth 函数，避免测试依赖真实 DLL

function fakeSynth(record) {
  return async (text, opts) => {
    record.push({ text, opts });
    return Buffer.from('RIFF' + text);
  };
}

function makeWav(samples) {
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.write('WAVE', 8);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt16LE(16, 34);
  return buf;
}

test('一段短文本产出一段音频', async () => {
  const calls = [];
  const p = createPipeline({ synth: fakeSynth(calls) });
  const segs = await p.render('你好呀。', { voice: 'reimu' });
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].index, 0);
  assert.ok(Buffer.isBuffer(segs[0].wav));
  assert.strictEqual(segs[0].text, '你好呀。');
});

test('多句产出多段，按顺序', async () => {
  const calls = [];
  const p = createPipeline({ synth: fakeSynth(calls) });
  const segs = await p.render('第一句。第二句。第三句。', { voice: 'reimu' });
  assert.strictEqual(segs.length, 3);
  assert.deepStrictEqual(segs.map((s) => s.index), [0, 1, 2]);
  assert.ok(segs[0].text.indexOf('第一') === 0);
});

test('Markdown 会被清理掉', async () => {
  const calls = [];
  const p = createPipeline({ synth: fakeSynth(calls) });
  const src = '看这个。\n\n```js\ncode();\n```\n\n还有这个。';
  const segs = await p.render(src, { voice: 'reimu' });
  const all = segs.map((s) => s.text).join('');
  assert.ok(all.indexOf('code()') < 0, '代码不该被念: ' + all);
});

test('每段带自己的时长（按 WAV 头算）', async () => {
  const synth = async () => makeWav(1000);
  const p = createPipeline({ synth });
  const segs = await p.render('测试。', {});
  assert.ok(Math.abs(segs[0].seconds - 0.0625) < 0.01, '实际: ' + segs[0].seconds);
});

test('空文本产出空数组', async () => {
  const p = createPipeline({ synth: async () => makeWav(1) });
  assert.deepStrictEqual(await p.render('', {}), []);
  assert.deepStrictEqual(await p.render('```\ncode\n```', {}), []);
});

test('某一段合成失败不影响其他段', async () => {
  const errs = [];
  let n = 0;
  const synth = async () => {
    n += 1;
    if (n === 2) throw new Error('第二段炸了');
    return makeWav(100);
  };
  const p = createPipeline({ synth, onError: (e) => errs.push(e) });
  const segs = await p.render('第一句。第二句。第三句。', {});
  assert.strictEqual(segs.length, 2, '失败的段被跳过，其余保留: ' + segs.length);
  assert.strictEqual(errs.length, 1);
});

test('onSegment 逐段回调（流水线播放用）', async () => {
  const got = [];
  const p = createPipeline({
    synth: async () => makeWav(100),
    onSegment: (seg) => got.push(seg.index),
  });
  await p.render('一。二。三。', {});
  assert.deepStrictEqual(got, [0, 1, 2], '每段合成完就应回调');
});

test('切换声源会重新合成（不串用缓存）', async () => {
  const calls = [];
  const p = createPipeline({ synth: fakeSynth(calls) });
  await p.render('同一句话。', { voice: 'reimu' });
  const after1 = calls.length;
  await p.render('同一句话。', { voice: 'marisa' });
  assert.strictEqual(calls.length, after1 * 2, '换了声源应重新合成');
});
