const test = require('node:test');
const assert = require('node:assert');
const { wavInfo, wavSeconds } = require('../src/wav');

function makeWav(hz, seconds, ch = 1, bits = 16) {
  const bytes = Math.round(hz * seconds) * ch * (bits / 8);
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.write('WAVE', 8);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(hz, 24);
  buf.writeUInt16LE(bits, 34);
  return buf;
}

test('按 WAV 头算时长（16kHz）', () => {
  const info = wavInfo(makeWav(16000, 2));
  assert.strictEqual(info.hz, 16000);
  assert.ok(Math.abs(info.seconds - 2) < 0.01, '实际: ' + info.seconds);
});

test('采样率不是 16k 时也正确', () => {
  // F3 声库 fsc=148 → 16000*148/100 = 23680
  const info = wavInfo(makeWav(23680, 1.5));
  assert.strictEqual(info.hz, 23680);
  assert.ok(Math.abs(info.seconds - 1.5) < 0.01, '实际: ' + info.seconds);
});

test('wavSeconds 是它的简写', () => {
  assert.ok(Math.abs(wavSeconds(makeWav(44100, 1)) - 1) < 0.01);
});

test('坏数据不抛错，返回 0', () => {
  assert.strictEqual(wavSeconds(Buffer.alloc(10)), 0);
  assert.strictEqual(wavSeconds(null), 0);
});

test('真实合成：不同引擎的采样率都读得对', async () => {
  const { synthe } = require('../src');
  const { resolve } = require('../src/voice/characters');

  // 灵梦走 AQTK10 F1：fsc=100 → 16kHz
  assert.strictEqual(resolve('reimu').params.fsc, 100);
  const a = await synthe('ゆっくり', { voice: 'reimu' });
  assert.strictEqual(wavInfo(a).hz, 16000, 'AQTK10 F1 应为 16kHz');

  // 琪露诺走 AQTK10 F3：fsc=148 → 23680Hz
  assert.strictEqual(resolve('cirno').params.fsc, 148);
  const b = await synthe('ゆっくり', { voice: 'cirno' });
  assert.ok(wavInfo(b).hz > 16000, 'F3 采样率应更高，实际 ' + wavInfo(b).hz);

  // 天子走 AQTK1（v86）：8kHz
  const d = await synthe('ゆっくり', { voice: 'tenshi' });
  assert.strictEqual(wavInfo(d).hz, 8000, 'AQTK1 应为 8kHz，实际 ' + wavInfo(d).hz);

  // 帕琪是同引擎 + pitch 1.04 → 8320Hz
  const e = await synthe('ゆっくり', { voice: 'patchouli' });
  assert.strictEqual(wavInfo(e).hz, 8320, '帕琪应是 8320Hz，实际 ' + wavInfo(e).hz);
});
