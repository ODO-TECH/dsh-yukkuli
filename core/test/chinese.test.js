const test = require('node:test');
const assert = require('node:assert');
const { synthe, zh2jp, toKoe } = require('../src');

// Slice 3: 中文 → 假名 → 语音
test('中文转假名产出假名而非汉字', () => {
  const kana = zh2jp('你好');
  assert.ok(kana.length > 0, '不应为空');
  assert.ok(!/[\u4e00-\u9fa5]/.test(kana), '不应残留汉字，实际: ' + kana);
  assert.ok(/[\u3040-\u30ff]/.test(kana), '应含假名，实际: ' + kana);
});

test('中文可以合成为合法 WAV', async () => {
  const wav = await synthe('你好，我是油库里');
  assert.strictEqual(wav.slice(0, 4).toString(), 'RIFF');
  assert.strictEqual(wav.readUInt32LE(24), 16000);
  assert.ok(wav.length > 44);
});

test('空文本应明确报错而不是返回空音频', async () => {
  await assert.rejects(() => synthe(''), /text|空|empty/i);
});
