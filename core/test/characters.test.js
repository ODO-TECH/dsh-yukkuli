const test = require('node:test');
const assert = require('node:assert');
const { CHARACTERS, PRESETS, resolve, findByName, list } = require('../src/voice/characters');

test('对照表：6 个角色（蕾咪已移除）', () => {
  assert.strictEqual(Object.keys(CHARACTERS).length, 6);
  for (const id of ['cirno','tenshi','patchouli','patchouli_bass','marisa','reimu']) {
    assert.ok(CHARACTERS[id], '缺角色: ' + id);
  }
  assert.strictEqual(CHARACTERS.remilia, undefined, '蕾咪应已移除');
  assert.throws(() => resolve('remilia'), /unknown character/);
});

test('引擎分配', () => {
  assert.strictEqual(resolve('cirno').engine, 'aqtk10');
  assert.strictEqual(resolve('marisa').engine, 'aqtk10');
  assert.strictEqual(resolve('reimu').engine, 'aqtk10');
  assert.strictEqual(resolve('tenshi').engine, 'aqtk1');
  assert.strictEqual(resolve('patchouli').engine, 'aqtk1');
  assert.strictEqual(resolve('patchouli_bass').engine, 'aqtk1');
});

test('AQTK10 角色用预设原值', () => {
  assert.deepStrictEqual(resolve('cirno').params, PRESETS.F3);
  assert.deepStrictEqual(resolve('marisa').params, PRESETS.F2);
  assert.deepStrictEqual(resolve('reimu').params, PRESETS.F1);
  assert.strictEqual(resolve('marisa').params.pit, 77, 'F2 的音高是 77');
});

test('帕琪：AQTK1 f1 + 音高 1.04 + 语速 92', () => {
  const p = resolve('patchouli');
  assert.strictEqual(p.params.voice, 'f1', '声库应为 f1（不是 f2）');
  assert.strictEqual(p.params.speed, 92, '语速应慢一点');
  assert.strictEqual(p.params.pitch, 1.04, '音高应高一点');
});

test('其他 AQTK1 角色没有 pitch（保持预设）', () => {
  const t = resolve('tenshi');
  assert.deepStrictEqual(t.params, { voice: 'f1', speed: 100 });
  assert.strictEqual(t.params.pitch, undefined);

  const b = resolve('patchouli_bass');
  assert.deepStrictEqual(b.params, { voice: 'r1', speed: 100 });
});

test('情绪：AQTK10 调参数，AQTK1 只调速度', () => {
  const happy = resolve('reimu', { emotion: 'happy' }).params;
  assert.ok(happy.pit > PRESETS.F1.pit);
  assert.ok(happy.acc > PRESETS.F1.acc);

  const t1 = resolve('tenshi', { emotion: 'happy' }).params;
  assert.ok(t1.speed > 100);
  assert.strictEqual(Object.keys(t1).sort().join(','), 'speed,voice');
});

test('帕琪的情绪也叠在 92 之上', () => {
  // happy 的 spd 偏移是 +6
  const p = resolve('patchouli', { emotion: 'happy' }).params;
  assert.strictEqual(p.speed, 98, '实际 ' + p.speed);
  assert.strictEqual(p.pitch, 1.04, '音高不该被情绪改掉');
});

test('未知角色/情绪明确报错', () => {
  assert.throws(() => resolve('sakuya'), /unknown character/);
  assert.throws(() => resolve('reimu', { emotion: 'nope' }), /unknown emotion/);
});

test('中文名可反查', () => {
  assert.strictEqual(findByName('博丽灵梦'), 'reimu');
  assert.strictEqual(findByName('帕秋莉·诺蕾姬'), 'patchouli');
  assert.strictEqual(findByName('蕾米莉亚·斯卡雷特'), null, '蕾咪已移除');
});

test('真实合成：采样率反映 pitch', async () => {
  const { synthe } = require('../src');
  const { wavInfo } = require('../src/wav');

  const base = await synthe('ゆっくり', { voice: 'tenshi' });
  assert.strictEqual(wavInfo(base).hz, 8000, 'AQTK1 基准 8kHz');

  const p = await synthe('ゆっくり', { voice: 'patchouli' });
  assert.strictEqual(wavInfo(p).hz, 8320, '帕琪应是 8000 × 1.04');
});
