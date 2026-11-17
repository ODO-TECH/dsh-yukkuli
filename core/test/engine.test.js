const test = require('node:test');
const assert = require('node:assert');
const engine = require('../src/engine');

// Slice 5: 引擎 seam —— 同一接口，两种实现

test('engines 列出可用的引擎名', () => {
  const names = engine.available();
  assert.ok(Array.isArray(names), '应返回数组');
  assert.ok(names.includes('local'), '应包含 local');
});

test('local 引擎满足统一接口', async () => {
  const e = await engine.open({ kind: 'local' });
  assert.strictEqual(typeof e.synthe, 'function', '应有 synthe');
  assert.strictEqual(typeof e.close, 'function', '应有 close');
  assert.strictEqual(e.kind, 'local');

  const wav = await e.synthe('ゆっくりしていってね', { voice: 'f1', emotion: 'neutral' });
  assert.strictEqual(wav.slice(0, 4).toString(), 'RIFF');
  e.close();
});

test('未知引擎明确报错，不静默降级', async () => {
  await assert.rejects(
    () => engine.open({ kind: 'no-such-engine' }),
    /unknown engine|未知/i
  );
});

test('remote 未配置时明确报错，不偷偷回落 local', async () => {
  // remote 需要 endpoint；没配就该拒绝，而不是假装成功
  await assert.rejects(
    () => engine.open({ kind: 'remote', endpoint: null }),
    /endpoint|配置/i
  );
});
