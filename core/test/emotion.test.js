const test = require('node:test');
const assert = require('node:assert');
const { synthe, presets } = require('../src');

// Slice 2: 情绪参数真的改变波形
test('不同情绪产生不同波形', async () => {
  const base = await synthe('ゆっくりしていってね', { emotion: 'neutral' });
  const happy = await synthe('ゆっくりしていってね', { emotion: 'happy' });
  const sad = await synthe('ゆっくりしていってね', { emotion: 'sad' });

  assert.notDeepStrictEqual(base, happy, 'happy 应与 neutral 不同');
  assert.notDeepStrictEqual(base, sad, 'sad 应与 neutral 不同');
  assert.notDeepStrictEqual(happy, sad, 'happy 应与 sad 不同');
});

test('显式参数覆盖情绪', () => {
  // happy 会抬高 pit，但显式 pit 应压过它
  const v = presets.resolve('f1', 'happy', { pit: 50 });
  assert.strictEqual(v.pit, 50, '显式 pit 应优先');
});

test('参数被钳制在 SDK 允许范围', () => {
  const v = presets.resolve('f1', 'neutral', { spd: 9999, pit: -5 });
  assert.ok(v.spd <= 300 && v.spd >= 50, 'spd 应被钳制，实际 ' + v.spd);
  assert.ok(v.pit >= 20 && v.pit <= 200, 'pit 应被钳制，实际 ' + v.pit);
});
