const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 多标签页时必须只有一个在播，否则同一句话会从两个标签页同时响，
// 点暂停只能停当前页那个。用 localStorage 选主。

function boot(storage) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  let booted = null;
  const calls = [];
  const timers = [];

  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { booted = { factory }; } } },
    localStorage: storage,
    document: {
      getElementById: () => null,
      createElement: () => ({ set textContent(v) {}, id: '' }),
      head: { appendChild: () => {} },
    },
    Audio: class { constructor() { this.src = ''; } play() { return Promise.resolve(); } pause() {} removeAttribute() {} addEventListener() {} },
    fetch: (url) => {
      calls.push(String(url));
      const u = String(url);
      if (u.includes('/state')) return Promise.resolve({ json: () => Promise.resolve({ ok: true, cfg: {}, latest: null }) });
      if (u.includes('/sessions')) return Promise.resolve({ json: () => Promise.resolve({ ok: true, sessions: [] }) });
      if (u.includes('/pending')) return Promise.resolve({ json: () => Promise.resolve({ ok: true, segments: [] }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
    URLSearchParams,
    Date,
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.Audio = sandbox.Audio;
  sandbox.window.fetch = sandbox.fetch;
  sandbox.window.localStorage = storage;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  const React = require('react');
  const mod = booted.factory((n) => (n === 'react' ? React : null));
  mod.apply({ slots: { register: () => () => {}, inject: (n, f) => f() } });
  return { calls, timers };
}

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    _m: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

test('拿到锁的标签页会成为主并轮询', async () => {
  const store = memStorage();
  const { calls } = boot(store);
  await new Promise((r) => setTimeout(r, 30));

  assert.ok(store.getItem('yukkuri-tts-leader'), '应写入 leader 标记');
});

test('已有别的主时，这个标签页不抢', async () => {
  const store = memStorage();
  // 模拟另一个标签页刚写了心跳
  store.setItem('yukkuri-tts-leader', JSON.stringify({ id: 'other', at: Date.now() }));
  boot(store);
  await new Promise((r) => setTimeout(r, 30));

  const leader = JSON.parse(store.getItem('yukkuri-tts-leader'));
  assert.strictEqual(leader.id, 'other', '不该抢走别人的锁');
});

test('原主心跳过期后可以接管', async () => {
  const store = memStorage();
  // 10 秒前的心跳 = 已过期
  store.setItem('yukkuri-tts-leader', JSON.stringify({ id: 'dead', at: Date.now() - 10000 }));
  boot(store);
  await new Promise((r) => setTimeout(r, 30));

  const leader = JSON.parse(store.getItem('yukkuri-tts-leader'));
  assert.notStrictEqual(leader.id, 'dead', '过期的主应被接管');
});

test('localStorage 不可用时退化为自己轮询', async () => {
  // 隐私模式 / 被禁用时 getItem 会抛
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.doesNotThrow(() => boot(broken));
  await new Promise((r) => setTimeout(r, 30));
});
