const test = require('node:test');
const assert = require('node:assert');
const { synthe, cacheControl, presets } = require('../src');

// 缓存必须接进 synthe，而且键要覆盖所有影响输出的参数

test('相同输入第二次命中缓存（不重新合成）', async () => {
  cacheControl.clear();
  const t = '缓存测试专用句' + Date.now();

  const t0 = process.hrtime.bigint();
  await synthe(t, { voice: 'reimu' });
  const first = Number(process.hrtime.bigint() - t0) / 1e6;

  const t1 = process.hrtime.bigint();
  await synthe(t, { voice: 'reimu' });
  const second = Number(process.hrtime.bigint() - t1) / 1e6;

  const s = cacheControl.stats();
  assert.strictEqual(s.hits >= 1, true, '应至少命中一次，实际: ' + JSON.stringify(s));
  assert.ok(second < first, '第二次应更快（走了缓存）: ' + first + 'ms vs ' + second + 'ms');
});

test('换声源不命中', async () => {
  cacheControl.clear();
  const t = '换声源' + Date.now();
  await synthe(t, { voice: 'reimu' });
  await synthe(t, { voice: 'marisa' });
  const s = cacheControl.stats();
  assert.strictEqual(s.hits, 0, '不同声源不该命中: ' + JSON.stringify(s));
  assert.strictEqual(s.misses, 2);
});

test('换情绪不命中', async () => {
  cacheControl.clear();
  const t = '换情绪' + Date.now();
  await synthe(t, { voice: 'reimu', emotion: 'neutral' });
  await synthe(t, { voice: 'reimu', emotion: 'happy' });
  const s = cacheControl.stats();
  assert.strictEqual(s.hits, 0, '不同情绪不该命中: ' + JSON.stringify(s));
});

test('换参数不命中', async () => {
  cacheControl.clear();
  const t = '换参数' + Date.now();
  await synthe(t, { voice: 'reimu', params: { pit: 100 } });
  await synthe(t, { voice: 'reimu', params: { pit: 101 } });
  const s = cacheControl.stats();
  assert.strictEqual(s.hits, 0, '参数不同不该命中: ' + JSON.stringify(s));
});

test('缓存内容与直接合成一致', async () => {
  cacheControl.clear();
  const t = '一致性检查' + Date.now();
  const a = await synthe(t, { voice: 'cirno' });
  const b = await synthe(t, { voice: 'cirno' });
  assert.deepStrictEqual(a, b, '缓存返回的应与第一次完全相同');
});

test('可以关闭缓存', async () => {
  cacheControl.clear();
  cacheControl.disable();
  const t = '关闭缓存' + Date.now();
  await synthe(t, { voice: 'reimu' });
  await synthe(t, { voice: 'reimu' });
  const s = cacheControl.stats();
  assert.strictEqual(s.hits, 0, '关闭后不该命中: ' + JSON.stringify(s));
  cacheControl.enable();
});

test('返回的是副本，调用方改动不会污染缓存', async () => {
  cacheControl.clear();
  const t = '副本检查' + Date.now();
  const a = await synthe(t, { voice: 'reimu' });
  const orig = Buffer.from(a);
  a[0] = 0xff;                       // 调用方乱改
  const b = await synthe(t, { voice: 'reimu' });
  assert.deepStrictEqual(b, orig, '缓存里的内容不该被调用方改坏');
});
