const test = require('node:test');
const assert = require('node:assert');
const { synthe } = require('../src');

// Slice 1: 最窄的端到端 —— 只要一个合法的 WAV 回来
test('synthe 返回合法 WAV（16kHz 单声道 16bit）', async () => {
  const wav = await synthe('ゆっくりしていってね');

  assert.ok(Buffer.isBuffer(wav), '应返回 Buffer');
  assert.strictEqual(wav.length > 44, true, '应长于 WAV 头');
  assert.strictEqual(wav.slice(0, 4).toString(), 'RIFF', 'RIFF 魔数');
  assert.strictEqual(wav.slice(8, 12).toString(), 'WAVE', 'WAVE 标识');
  assert.strictEqual(wav.readUInt32LE(24), 16000, '16kHz 采样率');
  assert.strictEqual(wav.readUInt16LE(22), 1, '单声道');
  assert.strictEqual(wav.readUInt16LE(34), 16, '16bit');

  const seconds = (wav.length - 44) / 2 / 16000;
  assert.ok(seconds > 0.5, '时长应大于 0.5s，实际 ' + seconds.toFixed(2) + 's');
});
