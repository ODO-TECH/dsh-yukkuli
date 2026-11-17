const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const { wrap } = require('./result-text.cjs');

// 测试用独立配置，绝不碰真实的那份
process.env.YUKKURI_CFG_PATH = path.join(os.tmpdir(), 'yukkuri-test-' + process.pid + '.json');

// TUI 命令的详细行为

async function mount(sessions = []) {
  const url = 'file://' + path.resolve(__dirname, '..', 'lib', 'index.js').replace(/\\/g, '/');
  const mod = await import(url);

  const routes = new Map();
  const commands = [];
  const ctx = {
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => {}; } },
    sessions: {
      list: () => sessions,
      get: (id) => sessions.find((s) => String(s.id) === String(id)),
    },
    sessionTitle: { get: () => ({ title: 't' }) },
    effect(fn) { fn(); return () => {}; },
    interval() { return () => {}; },
    inject(deps, fn) {
      const scope = {};
      if (deps.includes('commands')) scope.commands = { register: (c) => commands.push({ ...c, handler: wrap(c.handler) }) };
      if (deps.includes('webServer')) scope.webServer = ctx.webServer;
      if (deps.includes('sessionTitle')) scope.sessionTitle = ctx.sessionTitle;
      fn(scope);
    },
  };
  mod.apply(ctx);
  return { commands, routes };
}

test('watch 命令能查看与修改监听名单', async () => {
  const { commands } = await mount([{ id: 'a', seq: 0, snapshotEvents: () => [] }, { id: 'b', seq: 0, snapshotEvents: () => [] }]);
  const h = commands[0].handler;

  const show = await h('watch');
  assert.ok(show.includes('当前监听'), '实际: ' + show);

  const setAll = await h('watch all');
  assert.ok(setAll.includes('a') && setAll.includes('b'), '应列出两个: ' + setAll);

  const setNone = await h('watch none');
  assert.ok(setNone.includes('无'), '实际: ' + setNone);
});

test('watch <id> 指定单个会话', async () => {
  const { commands } = await mount([]);
  const out = await commands[0].handler('watch sess-42');
  assert.ok(out.includes('sess-42'), '实际: ' + out);
});

test('on 会绑定当前会话（TUI 只读当前）', async () => {
  const { commands } = await mount([]);
  const h = commands[0].handler;

  // 带上 meta.sessionId，模拟 TUI 传参
  const out = await h('on', { sessionId: 'cur-1' });
  assert.ok(out.includes('cur-1'), '应绑定当前会话: ' + out);

  const show = await h('watch');
  assert.ok(show.includes('cur-1'), '名单里应有当前会话: ' + show);
});

test('on 拿不到会话时给出明确提示', async () => {
  const { commands } = await mount([]);
  const out = await commands[0].handler('on');
  assert.ok(out.includes('拿不到') || out.includes('当前会话'), '实际: ' + out);
});

test('voice / emotion 切换生效', async () => {
  const { commands } = await mount([]);
  const h = commands[0].handler;

  const v = await h('voice cirno');
  assert.ok(v.includes('cirno'), '实际: ' + v);

  const e = await h('emotion happy');
  assert.ok(e.includes('happy'), '实际: ' + e);

  const st = await h('status');
  assert.ok(st.includes('cirno') && st.includes('happy'), '状态应反映: ' + st);
});
