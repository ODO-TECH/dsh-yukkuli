const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

process.env.YUKKURI_CFG_PATH = path.join(os.tmpdir(), 'yukkuri-turn-once-' + process.pid + '.json');
process.env.YUKKURI_INTERVAL_MS = '40';

// 「同一句话念好几遍」的根治：轮次级幂等。
//
// 一次性投递只保证「同一段不会被拉两次」，挡不住「同一轮被触发多次」——
// 触发两次就合成出两套 id 不同的段，每套各投递一次，于是全都播出来。
// 幂等表挂在 globalThis 上，插件被重复 apply 时各实例共享它。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshModule() {
  const url = 'file://' + path.resolve(__dirname, '..', 'lib', 'index.js').replace(/\\/g, '/');
  return import(url + '?v=' + Math.random());
}

function resetGlobals() {
  delete globalThis.__yukkuriSeenTurns;
  delete globalThis.__yukkuriStats;
  delete globalThis.__yukkuriStore;
}

function makeSession() {
  const events = [];
  let seq = 0;
  let turn = 0;
  return {
    id: 'sess-1',
    get seq() { return seq; },
    snapshotEvents: (from) => events.filter((e) => e.seq > from),
    deriveMessages: () => events,
    push(text) {
      turn += 1;
      events.push({ seq: ++seq, type: 'assistant/message', data: { turn, message: { id: 'm' + turn, content: [{ type: 'text', text }] } } });
      events.push({ seq: ++seq, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
      return turn;
    },
  };
}

function makeCtx(state) {
  const routes = new Map();
  const disposers = [];
  const ctx = {
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => {}; } },
    sessions: { list: () => [state.session], get: () => state.session },
    sessionTitle: { get: () => ({ title: 't' }) },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d; },
    inject(deps, fn) {
      const s = {};
      if (deps.includes('webServer')) s.webServer = ctx.webServer;
      if (deps.includes('sessionTitle')) s.sessionTitle = ctx.sessionTitle;
      if (deps.includes('commands')) s.commands = { register: () => {} };
      fn(s);
    },
  };
  return { ctx, routes, disposers };
}

async function serve(routes) {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const h = routes.get(u.pathname);
    if (!h) { res.writeHead(404); return res.end('x'); }
    await h(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}

const getJson = (base, p) => fetch(base + p).then((r) => r.json());

/** 等到条件成立，最多等 timeout 毫秒。比睡固定时间稳。 */
async function waitFor(fn, timeout = 3000, step = 25) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error('waitFor 超时');
    await sleep(step);
  }
}
const postJson = (base, p, body) => fetch(base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then((r) => r.json());

test('插件被 apply 两次时，旧实例的轮询会被停掉（只触发一次）', async () => {
  resetGlobals();
  delete process.env.YUKKURI_KEEP_INSTANCES;
  const state = { session: makeSession() };
  const a = makeCtx(state);
  const b = makeCtx(state);

  const m1 = await freshModule();
  m1.apply(a.ctx);
  const m2 = await freshModule();
  m2.apply(b.ctx);

  const A = await serve(a.routes);
  const B = await serve(b.routes);

  try {
    await sleep(120);
    // 两个实例各有一份配置：装上插件后都改成了「听 sess-1」
    await postJson(A.base, '/dsh-yukkuri/config', { watch: ['sess-1'] });
    await postJson(B.base, '/dsh-yukkuri/config', { watch: ['sess-1'] });

    // 改名单会重置游标，要等「活着的那个实例」再轮询一次才重新立好基线。
    // 这里等 polls 确实涨了，而不是睡固定时间 —— 机器忙的时候睡不够。
    // 只等 B：A 的轮询已经被 B 停掉了，它的 polls 不会再涨。
    await waitFor(async () => (await getJson(B.base, '/dsh-yukkuri/stats')).polls >= 1, 3000);
    state.session.push('这是第一句。这是第二句。');
    await sleep(900);

    const sa = await getJson(A.base, '/dsh-yukkuri/stats');
    const sb = await getJson(B.base, '/dsh-yukkuri/stats');

    assert.strictEqual(sa.applies, 2, '两次 apply 都该被记到，实际 ' + sa.applies);
    assert.strictEqual(sa.triggers, 1, '旧实例的轮询被停掉了，只该触发一次，实际 ' + sa.triggers);
    assert.strictEqual(sa.dups, 0, '根本轮不到幂等闸门，实际挡了 ' + sa.dups);
    // 队列是进程级共享的（见 lib/index.js 的 store），两个实例报的是同一条队列。
    // 两个实例加起来看到 4 段才是 bug —— 那说明各自合成了一套。
    assert.strictEqual(sa.segments, 2, '只该有 2 段（两句），实际 ' + sa.segments);
    assert.strictEqual(sb.segments, 2, '第二个实例看到的是同一条共享队列，实际 ' + sb.segments);
  } finally {
    for (const d of a.disposers) { try { d(); } catch {} }
    for (const d of b.disposers) { try { d(); } catch {} }
    A.server.close();
    B.server.close();
  }
});

test('同一轮被反复触发也只合成一次，轮询多次不重复', async () => {
  resetGlobals();
  const state = { session: makeSession() };
  const a = makeCtx(state);
  const m = await freshModule();
  m.apply(a.ctx);
  const A = await serve(a.routes);

  try {
    await sleep(120);
    await postJson(A.base, '/dsh-yukkuri/config', { watch: ['sess-1'] });
    await waitFor(async () => (await getJson(A.base, '/dsh-yukkuri/stats')).polls >= 1, 3000);
    state.session.push('一句话。');
    await sleep(600);

    const s1 = await getJson(A.base, '/dsh-yukkuri/stats');
    assert.strictEqual(s1.triggers, 1, '触发一次，实际 ' + s1.triggers);
    assert.strictEqual(s1.seenTurns, 1);

    await sleep(400);
    const s2 = await getJson(A.base, '/dsh-yukkuri/stats');
    assert.strictEqual(s2.triggers, 1, '轮询多次也只该触发一次，实际 ' + s2.triggers);
    assert.strictEqual(s2.segments, 1, '段数应当还是 1，实际 ' + s2.segments);
  } finally {
    for (const d of a.disposers) { try { d(); } catch {} }
    A.server.close();
  }
});

test('两份实例同时跑时，轮次幂等兜底（触发两次只合成一次）', async () => {
  resetGlobals();
  process.env.YUKKURI_KEEP_INSTANCES = '1'; // 故意不许停旧实例

  const state = { session: makeSession() };
  const a = makeCtx(state);
  const b = makeCtx(state);

  const m1 = await freshModule();
  m1.apply(a.ctx);
  const m2 = await freshModule();
  m2.apply(b.ctx);

  const A = await serve(a.routes);
  const B = await serve(b.routes);

  try {
    await sleep(120);
    await postJson(A.base, '/dsh-yukkuri/config', { watch: ['sess-1'] });
    await postJson(B.base, '/dsh-yukkuri/config', { watch: ['sess-1'] });
    await waitFor(async () => (await getJson(A.base, '/dsh-yukkuri/stats')).polls >= 1, 3000);
    await waitFor(async () => (await getJson(B.base, '/dsh-yukkuri/stats')).polls >= 1, 3000);

    state.session.push('这是第一句。这是第二句。');
    await sleep(900);

    const sa = await getJson(A.base, '/dsh-yukkuri/stats');
    const sb = await getJson(B.base, '/dsh-yukkuri/stats');

    assert.strictEqual(sa.triggers, 2, '两个实例各触发一次，实际 ' + sa.triggers);
    assert.strictEqual(sa.dups, 1, '第二个实例应被幂等挡住，实际挡了 ' + sa.dups);
    assert.strictEqual(sa.segments, 2, '只该有 2 段（两句），实际 ' + sa.segments);
    assert.strictEqual(sb.segments, 2, '共享同一条队列，实际 ' + sb.segments);
  } finally {
    for (const d of a.disposers) { try { d(); } catch {} }
    for (const d of b.disposers) { try { d(); } catch {} }
    A.server.close();
    B.server.close();
    delete process.env.YUKKURI_KEEP_INSTANCES;
  }
});
