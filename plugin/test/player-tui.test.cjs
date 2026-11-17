const test = require('node:test');
const assert = require('node:assert');
// 这个文件要验证真实的队列与落盘行为，必须把静音关掉。
// （外面整体跑测试时可能设了 YUKKURI_MUTE=1 防止突然出声，别让它泄漏进来。）
delete process.env.YUKKURI_MUTE;

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createTuiPlayer } = require('../lib/player-tui.cjs');

// TUI 播放器：用假的 spawn 验证队列、清理、停止

function fakeSpawn() {
  const spawned = [];
  const fn = (cmd, args) => {
    const child = new EventEmitter();
    child.cmd = cmd;
    child.args = args;
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit('exit', 0); };
    spawned.push(child);
    return child;
  };
  return { fn, spawned };
}

const WAV = Buffer.alloc(44 + 100);

test('play 会写临时文件并 spawn mpv', () => {
  const { fn, spawned } = fakeSpawn();
  const p = createTuiPlayer({ spawnFn: fn, mpvPath: 'mpv.exe' });

  p.play(WAV, { text: 'hi' });
  assert.strictEqual(spawned.length, 1, '应启动一次 mpv');
  assert.strictEqual(spawned[0].cmd, 'mpv.exe');
  assert.ok(spawned[0].args.includes('--no-video'), '应带 --no-video');

  const file = spawned[0].args[spawned[0].args.length - 1];
  assert.ok(fs.existsSync(file), '临时文件应存在: ' + file);
  assert.ok(file.endsWith('.wav'));

  p.dispose();
});

test('播完自动删临时文件并播下一条', () => {
  const { fn, spawned } = fakeSpawn();
  const p = createTuiPlayer({ spawnFn: fn, mpvPath: 'mpv.exe' });

  p.play(WAV);
  p.play(WAV);
  assert.strictEqual(spawned.length, 1, '空闲前只启动一个');

  const firstFile = spawned[0].args[spawned[0].args.length - 1];
  spawned[0].emit('exit', 0);

  assert.ok(!fs.existsSync(firstFile), '第一条应被删掉: ' + firstFile);
  assert.strictEqual(spawned.length, 2, '应接着播第二条');

  p.dispose();
});

test('播完把临时目录也删掉（进程被强杀时不留空目录）', () => {
  const { fn, spawned } = fakeSpawn();
  const p = createTuiPlayer({ spawnFn: fn, mpvPath: 'mpv.exe' });

  p.play(WAV);
  const file = spawned[0].args[spawned[0].args.length - 1];
  const dir = path.dirname(file);
  assert.ok(fs.existsSync(dir), '应建了临时目录: ' + dir);

  spawned[0].emit('exit', 0);
  assert.ok(!fs.existsSync(file), '文件应被删掉');
  assert.ok(!fs.existsSync(dir), '空目录也应被删掉: ' + dir);

  p.dispose();
});

test('队列里还有待播的段时，不能把目录删掉', () => {
  const { fn, spawned } = fakeSpawn();
  const p = createTuiPlayer({ spawnFn: fn, mpvPath: 'mpv.exe' });

  p.play(WAV);
  p.play(WAV);
  const dir = path.dirname(spawned[0].args[spawned[0].args.length - 1]);

  spawned[0].emit('exit', 0);
  assert.ok(fs.existsSync(dir), '第二条还在目录里，目录不能删: ' + dir);

  p.dispose();
});

test('stop 会杀掉进程并清空队列', () => {
  const { fn, spawned } = fakeSpawn();
  const p = createTuiPlayer({ spawnFn: fn, mpvPath: 'mpv.exe' });

  p.play(WAV);
  p.play(WAV);
  p.play(WAV);
  assert.ok(p.isPlaying());

  p.stop();
  assert.strictEqual(spawned[0].killed, true, '应被杀掉');
  assert.strictEqual(p.isPlaying(), false);
  assert.strictEqual(p.depth(), 0, '队列应清空');
  assert.strictEqual(spawned.length, 1, '停止后不该再启动新的');

  p.dispose();
});

test('stop 之后还能再 play', () => {
  const { fn, spawned } = fakeSpawn();
  const p = createTuiPlayer({ spawnFn: fn, mpvPath: 'mpv.exe' });

  p.play(WAV);
  p.stop();
  p.play(WAV);
  assert.strictEqual(spawned.length, 2, '停止后应能重新开始');

  p.dispose();
});

test('空音频不播', () => {
  const { fn, spawned } = fakeSpawn();
  const p = createTuiPlayer({ spawnFn: fn });
  p.play(Buffer.alloc(0));
  p.play(null);
  assert.strictEqual(spawned.length, 0);
});

test('spawn 抛错时继续处理队列', () => {
  const errs = [];
  let n = 0;
  const fn = () => {
    n += 1;
    throw new Error('mpv 不存在');
  };
  const p = createTuiPlayer({ spawnFn: fn, onError: (e) => errs.push(e) });

  p.play(WAV);
  p.play(WAV);
  assert.ok(errs.length >= 1, '应报错');

  p.dispose();
});

test('depth 反映队列深度', () => {
  const { fn } = fakeSpawn();
  const p = createTuiPlayer({ spawnFn: fn });
  assert.strictEqual(p.depth(), 0);
  p.play(WAV);
  assert.strictEqual(p.depth(), 1);
  p.play(WAV);
  assert.strictEqual(p.depth(), 2);
  p.dispose();
});
