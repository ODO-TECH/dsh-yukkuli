const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// TUI 进程里也有 webServer（dsh-tui-webserver，为 OAuth 挂在 127.0.0.1 的随机端口）。
// 0.2.4 用 hasWebServer 判断「这一轮该走 mpv 还是该交给浏览器」，于是在 TUI 里
// 音频全进了 /pending，而 TUI 没有浏览器来取 —— 插件加载正常、开关开着、一句不响。
// 这一组测试把那个场景钉死：webServer 存在、但没人轮询 /pending → 必须走 mpv。

const CFG = path.join(os.tmpdir(), 'yk-tuiws-' + process.pid + '.json');

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

function fakeReq(url, method) {
  return { url, method: method || 'GET', on() {}, destroy() {} };
}
function fakeRes() {
  return {
    code: 0,
    body: '',
    writeHead(code) { this.code = code; },
    end(s) { this.body = String(s || ''); },
  };
}

async function mount(opts) {
  const { watch = [], sessions = [], mode = 'auto' } = opts || {};
  delete globalThis.__yukkuriSeenTurns;
  delete globalThis.__yukkuriStats;
  delete globalThis.__yukkuriStore;
  delete globalThis.__yukkuriHost;
  delete globalThis.__yukkuriPlayed;

  fs.writeFileSync(CFG, JSON.stringify({
    enabled: true, watch, voice: 'f1', emotion: 'neutral',
    maxKana: 100, intervalMs: 60, keepSegments: 40, mode,
  }));
  process.env.YUKKURI_CFG_PATH = CFG;
  process.env.YUKKURI_INTERVAL_MS = '60';
  // 会加载真 core 真插件，不静音就在用户扬声器里念出来了
  process.env.YUKKURI_MUTE = '1';
  process.env.NODE_NO_WARNINGS = '1';

  const routes = new Map();
  const webServer = {
    register({ path: p, handler }) { routes.set(p, handler); return () => routes.delete(p); },
  };
  const ctx = {
    sessions: { list: () => sessions, get: (id) => sessions.find((s) => s.id === id) },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    inject(deps, fn) {
      const scope = {};
      if (deps.includes('webServer')) scope.webServer = webServer;
      fn(scope);
    },
  };

  const url = 'file://' + path.resolve(__dirname, '../lib/index.js').replace(/\\/g, '/');
  const mod = await import(url + '?v=' + Math.random());
  mod.apply(ctx);
  return { routes, ctx };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getState(routes) {
  const res = fakeRes();
  await routes.get('/dsh-yukkuri/state')(fakeReq('/dsh-yukkuri/state'), res);
  return JSON.parse(res.body);
}
async function pollPending(routes) {
  const res = fakeRes();
  await routes.get('/dsh-yukkuri/pending')(fakeReq('/dsh-yukkuri/pending?after=0'), res);
  return JSON.parse(res.body);
}

test('webServer 存在但没人轮询 /pending 时，仍然用 mpv 播（TUI 的真实处境）', async () => {
  const s = makeSession('tui-sess');
  const { routes } = await mount({ watch: ['ghost-from-web'], sessions: [s] });

  await sleep(600);                 // 等够 4 轮轮询，触发 TUI 兜底绑定
  s.push('第一句。第二句。', 1);
  await sleep(500);

  const st = globalThis.__yukkuriStats || {};
  assert.strictEqual(st.triggers, 1, '应触发一次，实际 ' + st.triggers);
  assert.strictEqual(st.plays, 2, '2 段应各播一次，实际播了 ' + st.plays);

  const state = await getState(routes);
  assert.strictEqual(state.deliver, 'tui', '没人轮询时该走 mpv，state 里是 ' + state.deliver);
  assert.strictEqual(state.segments, 2);
});

test('浏览器开始轮询 /pending 之后，改成交给浏览器（不再碰 mpv）', async () => {
  const s = makeSession('web-sess');
  const { routes } = await mount({ watch: ['web-sess'], sessions: [s] });

  await sleep(300);
  await pollPending(routes);        // 浏览器来取一次 = 有前端在听
  const before = (globalThis.__yukkuriStats || {}).plays || 0;

  s.push('交给浏览器。', 1);
  await sleep(500);

  const st = globalThis.__yukkuriStats || {};
  assert.strictEqual(st.plays, before, '走 web 时不该调 mpv，实际播了 ' + (st.plays - before) + ' 次');

  const pending = await pollPending(routes);
  assert.strictEqual(pending.segments.length, 1, '该段应留在广播队列里，实际 ' + pending.segments.length);

  const state = await getState(routes);
  assert.strictEqual(state.deliver, 'web', '有人轮询时该走 web，实际 ' + state.deliver);
});

test('mode=tui 时，即使有浏览器轮询也用 mpv', async () => {
  const s = makeSession('forced-tui');
  const { routes } = await mount({ watch: ['forced-tui'], sessions: [s], mode: 'tui' });

  await sleep(300);
  await pollPending(routes);
  s.push('强制 mpv。', 1);
  await sleep(500);

  const st = globalThis.__yukkuriStats || {};
  assert.strictEqual(st.plays, 1, '强制 tui 应播一次，实际 ' + st.plays);
  const state = await getState(routes);
  assert.strictEqual(state.deliver, 'tui');
});

test('mode=web 时，即使没人轮询也留给浏览器', async () => {
  const s = makeSession('forced-web');
  const { routes } = await mount({ watch: ['forced-web'], sessions: [s], mode: 'web' });

  await sleep(300);
  s.push('强制 web。', 1);
  await sleep(500);

  const st = globalThis.__yukkuriStats || {};
  assert.strictEqual(st.plays, 0, '强制 web 不该调 mpv，实际 ' + st.plays);
  const pending = await pollPending(routes);
  assert.strictEqual(pending.segments.length, 1, '该段该在队列里，实际 ' + pending.segments.length);
});
