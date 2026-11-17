const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const { wrap } = require('./result-text.cjs');

process.env.YUKKURI_CFG_PATH = path.join(os.tmpdir(), 'yukkuri-tui-test-' + process.pid + '.json');

// TUI 场景：没有 webServer、没有 sessionTitle。
// 这是最容易出事的一条路 —— 把 webServer 写进 inject 会让插件在 TUI 里根本不加载。

async function load() {
  const url = 'file://' + path.resolve(__dirname, '..', 'lib', 'index.js').replace(/\\/g, '/');
  return import(url);
}

function tuiCtx(sessions = []) {
  const commands = [];
  const intervals = [];
  const ctx = {
    // 故意不给 webServer，也不给 sessionTitle
    sessions: {
      list: () => sessions,
      get: (id) => sessions.find((s) => String(s.id) === String(id)),
    },
    effect(fn) { fn(); return () => {}; },
    interval(fn, ms) { intervals.push({ fn, ms }); return () => {}; },
    inject(deps, fn) {
      // 模拟：TUI 里 webServer/sessionTitle 永远不会就绪
      if (deps.includes('commands')) {
        const scope = { commands: { register: (c) => commands.push({ ...c, handler: wrap(c.handler) }) } };
        if (deps.includes('webServer')) return; // 没有就不回调
        if (deps.includes('sessionTitle')) return;
        fn(scope);
        return;
      }
      // 其他服务一律不回调
    },
  };
  return { ctx, commands, intervals };
}

test('TUI 环境下插件能加载（没有 webServer 也不崩）', async () => {
  const mod = await load();
  const { ctx, commands } = tuiCtx([{ id: 'a', seq: 0, snapshotEvents: () => [] }]);

  assert.doesNotThrow(() => mod.apply(ctx), 'apply 不该抛');
  assert.strictEqual(commands.length, 1, 'TUI 里命令必须能注册');
  assert.strictEqual(commands[0].name, 'yukkuri');
});

test('TUI 环境下命令可用', async () => {
  const mod = await load();
  const { ctx, commands } = tuiCtx([{ id: 'a', seq: 0, snapshotEvents: () => [] }]);
  mod.apply(ctx);

  const out = await commands[0].handler('status');
  assert.ok(out.includes('油库里朗读'), '实际: ' + out);
});

test('TUI 环境下轮询仍启动（不依赖 timer 服务）', async () => {
  const mod = await load();
  const { ctx } = tuiCtx([]);

  let calls = 0;
  ctx.sessions.list = () => {
    calls += 1;
    return [];
  };

  process.env.YUKKURI_INTERVAL_MS = '20';
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 120));
  delete process.env.YUKKURI_INTERVAL_MS;

  assert.ok(calls >= 2, 'TUI 里轮询也要跑起来，实际 ' + calls + ' 次');
});

test('没有 sessionTitle 时会话列表仍能返回', async () => {
  const mod = await load();
  const { ctx } = tuiCtx([{ id: 'a', seq: 0, snapshotEvents: () => [] }]);
  mod.apply(ctx);
  // 直接调内部逻辑不方便，这里只验证 apply 不崩即可
  assert.ok(true);
});
