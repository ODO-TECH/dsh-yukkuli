const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Web 端自动朗读：客户端必须自己去拉 /pending，
// 否则服务端合成完了没人播 —— 这是最容易漏的一环。

function boot(opts = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  let booted = null;

  const calls = [];
  const timers = [];

  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { booted = { factory }; } } },
    document: {
      getElementById: () => null,
      createElement: () => ({ set textContent(v) {}, id: '' }),
      head: { appendChild: () => {} },
    },
    Audio: class {
      constructor() { this.src = ''; }
      play() { return Promise.resolve(); }
      pause() {}
      removeAttribute() {}
      addEventListener() {}
    },
    fetch: (url) => {
      calls.push(String(url));
      const u = String(url);
      if (u.includes('/state')) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, cfg: {}, segments: 0, latest: opts.latest ?? null }) });
      }
      if (u.includes('/sessions')) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, sessions: [] }) });
      }
      if (u.includes('/pending')) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, segments: opts.segments || [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    },
    // 记录定时器但不真的跑
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
    URLSearchParams,
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.Audio = sandbox.Audio;
  sandbox.window.fetch = sandbox.fetch;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  const React = require('react');
  const mod = booted.factory((n) => (n === 'react' ? React : null));
  mod.apply({ slots: { register: () => () => {}, inject: (n, f) => f() } });

  return { calls, timers };
}

test('apply 之后会启动轮询', async () => {
  const { timers } = boot();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(timers.length >= 1, '应启动至少一个定时器（拉 /pending）');
  assert.ok(timers[0].ms >= 500, '间隔别太短，实际 ' + timers[0].ms);
});

test('轮询会请求 /pending', async () => {
  const { calls, timers } = boot();
  await new Promise((r) => setTimeout(r, 20));

  // 手动触发一次轮询
  if (timers[0]) timers[0].fn();
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(calls.some((c) => c.includes('/pending')), '应请求 /pending，实际: ' + calls.join(', '));
});

test('初次不拉历史（用 latest 做起点）', async () => {
  const { calls, timers } = boot({ latest: '42' });
  await new Promise((r) => setTimeout(r, 20));
  if (timers[0]) timers[0].fn();
  await new Promise((r) => setTimeout(r, 20));

  const poll = calls.filter((c) => c.includes('/pending'));
  assert.ok(poll.length > 0);
  assert.ok(poll.some((c) => c.includes('after=42')), '应以 latest 为起点，避免回放历史: ' + poll.join(', '));
});
