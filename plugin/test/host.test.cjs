const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const { wrap } = require('./result-text.cjs');

// 测试用独立配置，绝不碰真实的那份
process.env.YUKKURI_CFG_PATH = path.join(os.tmpdir(), 'yukkuri-test-' + process.pid + '.json');

// 用假的 ctx 跑一遍插件生命周期，验证路由注册与配置读写
// 不启动真实 DSH，也不碰 DLL（延迟加载）

async function loadPlugin() {
  // 用动态 import 加载 ESM
  const url = 'file://' + path.resolve(__dirname, '../lib/index.js').replace(/\\/g, '/');
  return import(url);
}

function fakeCtx() {
  const routes = new Map();
  const intervals = [];
  const commands = [];
  const effects = [];

  const ctx = {
    eff: null,
    webServer: {
      register({ kind, path, handler }) {
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
    sessions: {
      list: () => [],
      get: () => undefined,
    },
    sessionTitle: { get: () => ({ title: 'test' }) },
    effect(fn) {
      effects.push(fn);
      const d = fn();
      return typeof d === 'function' ? d : () => {};
    },
    interval(fn, ms) {
      intervals.push({ fn, ms });
      return () => {};
    },
    inject(deps, fn) {
      const scope = {};
      if (deps.includes('commands')) {
        // DSH 只收 CommandResult；测试断言的是文本，统一包一层（顺带校验形状）
        scope.commands = { register: (c) => commands.push({ ...c, handler: wrap(c.handler) }) };
      }
      if (deps.includes('webServer')) scope.webServer = ctx.webServer;
      if (deps.includes('sessionTitle')) scope.sessionTitle = ctx.sessionTitle;
      fn(scope);
    },
  };

  return { ctx, routes, intervals, commands, effects };
}

test('插件能加载并注册路由', async () => {
  const mod = await loadPlugin();
  assert.strictEqual(mod.name, 'yukkuri-tts');
  assert.ok(Array.isArray(mod.inject));
  assert.ok(mod.inject.includes('sessions'));
  // 回归测试：webServer 绝不能进 inject —— TUI 没有它，
  // 写进去会让整个插件在 TUI 端拒绝加载
  assert.ok(!mod.inject.includes('webServer'), 'webServer 必须是可选依赖: ' + JSON.stringify(mod.inject));
  assert.ok(!mod.inject.includes('sessionTitle'), 'sessionTitle 也应是可选依赖');

  const { ctx, routes } = fakeCtx();
  mod.apply(ctx);

  const paths = Array.from(routes.keys());
  assert.ok(paths.includes('/dsh-yukkuri/state'), '应注册 state: ' + paths.join(', '));
  assert.ok(paths.includes('/dsh-yukkuri/config'));
  assert.ok(paths.includes('/dsh-yukkuri/sessions'));
  assert.ok(paths.includes('/dsh-yukkuri/audio'));
  assert.ok(paths.includes('/dsh-yukkuri/pending'));
  assert.ok(paths.includes('/dsh-yukkuri/say'));
});

test('注册了 yukkuri 命令', async () => {
  const mod = await loadPlugin();
  const { ctx, commands } = fakeCtx();
  mod.apply(ctx);

  assert.strictEqual(commands.length, 1, '应注册一个命令');
  assert.strictEqual(commands[0].name, 'yukkuri');
  assert.strictEqual(typeof commands[0].handler, 'function');
});

test('命令 status 返回状态', async () => {
  const mod = await loadPlugin();
  const { ctx, commands } = fakeCtx();
  mod.apply(ctx);

  const out = await commands[0].handler('status');
  assert.ok(typeof out === 'string');
  assert.ok(out.includes('油库里朗读'), '实际: ' + out);
});

test('命令 on/off 切换 enabled', async () => {
  const mod = await loadPlugin();
  const { ctx, commands } = fakeCtx();
  mod.apply(ctx);

  const off = await commands[0].handler('off');
  assert.ok(off.includes('关闭'), '实际: ' + off);
  const status1 = await commands[0].handler('status');
  assert.ok(status1.includes('关'), '关闭后状态应为关: ' + status1);

  const on = await commands[0].handler('on');
  assert.ok(on.includes('开启'), '实际: ' + on);
  const status2 = await commands[0].handler('status');
  assert.ok(status2.includes('开'), '开启后状态应为开: ' + status2);
});

test('未知命令给出提示', async () => {
  const mod = await loadPlugin();
  const { ctx, commands } = fakeCtx();
  mod.apply(ctx);

  const out = await commands[0].handler('nonsense');
  assert.ok(out.includes('未知') || out.includes('可用'), '实际: ' + out);
});

test('启动后轮询真的在跑（sessions.list 被反复调用）', async () => {
  const mod = await loadPlugin();
  const { ctx } = fakeCtx();

  let calls = 0;
  ctx.sessions.list = () => {
    calls += 1;
    return [];
  };
  // 把间隔调小，省测试时间
  process.env.YUKKURI_INTERVAL_MS = '20';

  mod.apply(ctx);

  // start() 会立刻 tick 一次，之后按间隔继续
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(calls >= 2, '轮询应持续触发，实际调用 ' + calls + ' 次');

  delete process.env.YUKKURI_INTERVAL_MS;
});
