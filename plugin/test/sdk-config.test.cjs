const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

/**
 * SDK 路径：配置优先级、命令、自检、失败提示。
 *
 * 真实故障背景见 core/test/config-check.test.js 的头注释：
 * 默认根改到 ~/yukkuri-sdk 之后本机没设 env，插件照常加载、开关开着、
 * 一句不响，日志里只有 koffi 的「找不到指定的模块」。
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-sdk-'));
const CFG = path.join(TMP, 'cfg.json');

function fakeSdk(root) {
  fs.mkdirSync(path.join(root, 'aqtk10_win', 'lib64'), { recursive: true });
  fs.mkdirSync(path.join(root, 'aqk2k_win', 'lib64'), { recursive: true });
  fs.writeFileSync(path.join(root, 'aqtk10_win', 'lib64', 'AquesTalk.dll'), '');
  fs.writeFileSync(path.join(root, 'aqk2k_win', 'lib64', 'AqKanji2Koe.dll'), '');
  return root;
}

function makeSession(id) {
  const events = [];
  let seq = 0;
  return {
    id,
    get seq() { return seq; },
    push(text, turn) {
      seq += 1;
      events.push({ seq, type: 'assistant/message', data: { turn, message: { id: 'm' + seq, content: [{ type: 'text', text }] } } });
      seq += 1;
      events.push({ seq, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
    },
    snapshotEvents: (from) => events.filter((e) => e.seq > from),
    deriveMessages: () => events,
  };
}

let logs = [];
const realLog = console.log;

async function mount(cfgPatch, sessions) {
  delete globalThis.__yukkuriSeenTurns;
  delete globalThis.__yukkuriStats;
  delete globalThis.__yukkuriStore;
  delete globalThis.__yukkuriHost;

  fs.writeFileSync(CFG, JSON.stringify(Object.assign({
    enabled: true, watch: [], voice: 'f1', emotion: 'neutral',
    maxKana: 100, intervalMs: 60, keepSegments: 40, mode: 'auto', sdkRoot: '',
  }, cfgPatch)));

  process.env.YUKKURI_CFG_PATH = CFG;
  process.env.YUKKURI_INTERVAL_MS = '60';
  process.env.YUKKURI_MUTE = '1';
  // 让配置里的 sdkRoot 有机会生效（env 优先级最高）
  delete process.env.YUKKURI_SDK_ROOT;

  logs = [];
  console.log = (...a) => { logs.push(a.join(' ')); };

  const routes = new Map();
  const commands = [];
  const ctx = {
    webServer: { register({ path: p, handler }) { routes.set(p, handler); return () => routes.delete(p); } },
    sessions: { list: () => sessions, get: (id) => sessions.find((s) => s.id === id) },
    sessionTitle: { get: () => ({ title: 't' }) },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    interval() { return () => {}; },
    inject(deps, fn) {
      const scope = {};
      if (deps.includes('commands')) scope.commands = { register: (c) => commands.push(c) };
      if (deps.includes('webServer')) scope.webServer = ctx.webServer;
      if (deps.includes('sessionTitle')) scope.sessionTitle = ctx.sessionTitle;
      fn(scope);
    },
  };

  const url = 'file://' + path.resolve(__dirname, '../lib/index.js').replace(/\\/g, '/');
  const mod = await import(url + '?v=' + Math.random());
  mod.apply(ctx);

  const cmd = commands.find((c) => c.name === 'yukkuri');
  return { mod, routes, commands, cmd, run: (input) => cmd.handler({ rawInput: input }) };
}

function call(handler, { method = 'GET', url = '/', body = null } = {}) {
  return new Promise((resolve) => {
    const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; resolve(this); } };
    const req = {
      method,
      url,
      on(ev, cb) {
        if (ev === 'data' && body !== null) cb(Buffer.from(JSON.stringify(body)));
        if (ev === 'end') setImmediate(cb);
      },
      destroy() {},
    };
    handler(req, res);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SDK_OK = fakeSdk(path.join(TMP, 'sdk-ok'));

test('sdk 子命令报告路径与自检结果', async () => {
  const { run } = await mount({ sdkRoot: SDK_OK }, []);
  const r = await run('sdk');
  assert.strictEqual(r.kind, 'success');
  assert.ok(r.text.includes(SDK_OK), r.text);
  assert.ok(r.text.includes('✓'), r.text);
});

test('中文路径被拒，且不写进配置', async () => {
  const { run } = await mount({}, []);
  const before = fs.readFileSync(CFG, 'utf8');
  const r = await run('sdk D:\\Users Data\\Desktop\\油库里语音\\sdk');
  assert.strictEqual(r.kind, 'error');
  assert.ok(r.text.includes('非 ASCII'), r.text);
  assert.strictEqual(fs.readFileSync(CFG, 'utf8'), before, '被拒的路径不该落盘');
});

test('不存在的目录被拒', async () => {
  const { run } = await mount({}, []);
  const r = await run('sdk ' + path.join(TMP, 'nope'));
  assert.strictEqual(r.kind, 'error');
  assert.ok(r.text.includes('目录不存在'), r.text);
});

test('sdk <路径> 写盘 + 注入 env + 自检变绿', async () => {
  const { run } = await mount({}, []);
  const r = await run('sdk ' + SDK_OK);
  assert.strictEqual(r.kind, 'success', r.text);
  assert.ok(r.text.includes('✓'), r.text);

  const saved = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  assert.strictEqual(saved.sdkRoot, SDK_OK);
  assert.strictEqual(process.env.YUKKURI_SDK_ROOT, SDK_OK);
});

test('sdk auto 清掉配置里的路径', async () => {
  const { run } = await mount({ sdkRoot: SDK_OK }, []);
  const r = await run('sdk auto');
  assert.strictEqual(r.kind, 'success', r.text);
  const saved = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  assert.strictEqual(saved.sdkRoot, '');
});

test('/state 带 sdk 自检（前端要用它显示绿/红）', async () => {
  const { routes } = await mount({ sdkRoot: SDK_OK }, []);
  const res = await call(routes.get('/dsh-yukkuri/state'), { url: '/dsh-yukkuri/state' });
  const json = JSON.parse(res.body);
  assert.strictEqual(json.sdk.ok, true);
  assert.strictEqual(json.sdk.sdkRoot, SDK_OK);
});

test('POST /config 的非法 sdkRoot 返回 400 且不落盘', async () => {
  const { routes } = await mount({}, []);
  const before = fs.readFileSync(CFG, 'utf8');
  const res = await call(routes.get('/dsh-yukkuri/config'), {
    method: 'POST',
    url: '/dsh-yukkuri/config',
    body: { sdkRoot: path.join(TMP, 'not-there') },
  });
  assert.strictEqual(res.code, 400);
  assert.strictEqual(fs.readFileSync(CFG, 'utf8'), before);
});

test('SDK 不可用时，合成失败只提示一次（且带上路径）', async () => {
  const s = makeSession('sess-x');
  const bogus = path.join(TMP, 'gone');
  const { } = await mount({ sdkRoot: bogus, watch: ['sess-x'] }, [s]);

  await sleep(200);
  s.push('第一句。', 1);
  await sleep(700);
  s.push('第二句。', 2);
  await sleep(700);

  const hits = logs.filter((l) => l.includes('合成失败'));
  assert.strictEqual(hits.length, 1, '应只提示一次，实际 ' + hits.length + ' 条: ' + JSON.stringify(logs));
  assert.ok(hits[0].includes(bogus), '提示里必须带路径: ' + hits[0]);
});

test.after(() => {
  console.log = realLog;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  delete process.env.YUKKURI_SDK_ROOT;
});
