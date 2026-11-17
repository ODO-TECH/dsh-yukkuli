const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { buildUrl } = require('../src/engine/remote');
const engine = require('../src/engine');

// remote 适配器：URL 形态要与官网一致（社区项目已验证过这条路）
test('buildUrl 拼出 yukumo 兼容的 URL', () => {
  const url = buildUrl('https://example.test', 'aqtk10', 'ゆっくり', {
    type: 'f1', spd: 120, pit: 130, acc: 140, lmd: 110, fsc: 105, vol: 100,
  });

  assert.ok(url.startsWith('https://example.test/aqtk10/koe.mp3?'), '实际: ' + url);
  const q = new URL(url).searchParams;
  assert.strictEqual(q.get('type'), 'f1');
  assert.strictEqual(q.get('speed'), '120');
  assert.strictEqual(q.get('pitch'), '130');
  assert.strictEqual(q.get('accent'), '140');
  assert.strictEqual(q.get('lmd'), '110');
  assert.strictEqual(q.get('fsc'), '105');
  assert.strictEqual(q.get('kanji'), 'ゆっくり');
});

test('endpoint 末尾斜杠不产生双斜杠', () => {
  const a = buildUrl('https://example.test/', 'aqtk10', 'あ', {});
  const b = buildUrl('https://example.test', 'aqtk10', 'あ', {});
  assert.strictEqual(a, b);
  assert.ok(!a.includes('//aqtk10'), '实际: ' + a);
});

// 用本地 HTTP 服务器验证真实往返 + 错误页识别
test('remote 能取回 WAV', async () => {
  const wavBytes = Buffer.concat([
    Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
    Buffer.alloc(4),
    Buffer.from([0x57, 0x41, 0x56, 0x45]), // WAVE
    Buffer.alloc(100),
  ]);

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/wav' });
    res.end(wavBytes);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const e = await engine.open({ kind: 'remote', endpoint: 'http://127.0.0.1:' + port });
    const got = await e.synthe('ゆっくり', { params: { spd: 100 } });
    assert.strictEqual(got.slice(0, 4).toString(), 'RIFF');
    assert.strictEqual(got.length, wavBytes.length);
    e.close();
  } finally {
    server.close();
  }
});

test('远端返回错误页时明确报错，不当作音频', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>blocked</html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const e = await engine.open({ kind: 'remote', endpoint: 'http://127.0.0.1:' + port });
    await assert.rejects(() => e.synthe('あ', {}), /WAV|错误页/i);
    e.close();
  } finally {
    server.close();
  }
});

test('远端返回 403 时报错并带上状态码', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('forbidden');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const e = await engine.open({ kind: 'remote', endpoint: 'http://127.0.0.1:' + port });
    await assert.rejects(() => e.synthe('あ', {}), /403/);
    e.close();
  } finally {
    server.close();
  }
});
