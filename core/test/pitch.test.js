const test = require('node:test');
const assert = require('node:assert');
const { shiftPitch } = require('../src/wav');

function makeWav(hz, seconds) {
  const bytes = Math.round(hz * seconds) * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.write('WAVE', 8);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(hz, 24);
  buf.writeUInt16LE(16, 34);
  return buf;
}

// 改采样率 = 改播放速度与音高。这是 AQTK1/AQTK2 唯一能调音高的办法
// （它们没有音高参数，只能靠重采样）。

test('pitch 1.04 把采样率抬 4%', () => {
  const out = shiftPitch(makeWav(8000, 1), 1.04);
  assert.strictEqual(out.readUInt32LE(24), 8320);
});

test('字节数不变（只改头部）', () => {
  const src = makeWav(8000, 1);
  const out = shiftPitch(src, 1.04);
  assert.strictEqual(out.length, src.length);
});

test('音高提升后时长变短', () => {
  const src = makeWav(8000, 1);
  const out = shiftPitch(src, 1.25);
  const before = (src.length - 44) / 2 / 8000;
  const after = (out.length - 44) / 2 / out.readUInt32LE(24);
  assert.ok(Math.abs(after - before / 1.25) < 0.01, '实际 ' + after);
});

test('pitch 1 原样返回（不复制也不改）', () => {
  const src = makeWav(8000, 1);
  const out = shiftPitch(src, 1);
  assert.strictEqual(out.readUInt32LE(24), 8000);
});

test('非法 pitch 明确报错', () => {
  const src = makeWav(8000, 1);
  assert.throws(() => shiftPitch(src, 0), /pitch/i);
  assert.throws(() => shiftPitch(src, -1), /pitch/i);
});

test('不是 WAV 就原样返回', () => {
  const junk = Buffer.from('not a wav');
  assert.strictEqual(shiftPitch(junk, 1.04), junk);
});
