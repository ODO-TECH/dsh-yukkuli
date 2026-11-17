const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');

// DSH 可能多次加载客户端脚本（HMR / 多次注入）。
// 若每次加载都新建播放器和轮询，同一段音频会被播好几遍，
// 而且多个 audio 同时响 —— 用户听到的就是「自动朗读触发三次」。
// 所以播放器与轮询必须是 window 级单例。

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');

function makeSandbox() {
  const loads = [];
  const timers = [];
  const audios = [];

  const sandbox = {};
  sandbox.window = {
    __ModuleLoader__: {
      load: (opts) => { loads.push(opts); },
    },
  };
  sandbox.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  sandbox.document = {
    getElementById: () => null,
    createElement: () => {
      return { id: '', set textContent(v) {} };
    },
    head: { appendChild: () => {} },
  };
  sandbox.Audio = class {
    constructor() {
      this.src = '';
      audios.push(this);
    }
    play() { return Promise.resolve(); }
    pause() {}
    removeAttribute() {}
    addEventListener() {}
  };
  sandbox.fetch = () => {
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, latest: null, segments: [], sessions: [] }) });
  };
  sandbox.setInterval = (fn, ms) => {
    timers.push({ fn: fn, ms: ms });
    return timers.length;
  };
  sandbox.clearInterval = () => {};
  sandbox.setTimeout = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.console = console;
  sandbox.URLSearchParams = URLSearchParams;

  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.Audio = sandbox.Audio;
  sandbox.window.fetch = sandbox.fetch;

  vm.createContext(sandbox);
  return { sandbox: sandbox, loads: loads, timers: timers, audios: audios };
}

function injectOnce(sandbox) {
  const before = sandbox.__loads.length;
  vm.runInContext(SRC, sandbox);
  const entry = sandbox.__loads[before];
  const mod = entry.factory((n) => (n === 'react' ? React : null));
  mod.apply({ slots: { register: () => () => {}, inject: (n, f) => f() } });
  return mod;
}

test('客户端被加载两次也只启动一条轮询', async () => {
  const env = makeSandbox();
  env.sandbox.__loads = env.loads;

  injectOnce(env.sandbox);
  injectOnce(env.sandbox);

  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(env.timers.length, 1, '只该有一条轮询定时器，实际 ' + env.timers.length);
});

test('两次加载共用一个播放器', async () => {
  const env = makeSandbox();
  env.sandbox.__loads = env.loads;

  const mod1 = injectOnce(env.sandbox);
  const mod2 = injectOnce(env.sandbox);

  await new Promise((r) => setTimeout(r, 60));

  assert.ok(mod1.__player, 'player 应被创建并导出');
  assert.strictEqual(mod1.__player, mod2.__player, '两个实例应共用同一个 player');
});
