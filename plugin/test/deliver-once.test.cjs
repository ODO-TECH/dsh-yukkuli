const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

process.env.YUKKURI_CFG_PATH = path.join(os.tmpdir(), 'yukkuri-once-' + process.pid + '.json');
process.env.YUKKURI_INTERVAL_MS = '40';
// 万一路由判成 TUI，也别在用户扬声器里念出来
process.env.YUKKURI_MUTE = '1';

// 同一段音频只能被投递一次。
//
// 靠客户端选主是不可靠的：多个标签页 / 多个脚本实例 / 心跳过期，
// 任何一种都会让同一段被拉好几次，听感就是「一句话念了好几遍」，
// 而且各自持有自己的 audio，按暂停只停得住其中一个。
//
// 所以在服务端做一次性投递：谁先拉走，别人就拿不到了。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mount() {
  // 这些状态是进程级的（见 lib/index.js 的 claimTurn / store），
  // 多个 test 共用同一个进程时必须先清掉，否则前一个 test 的
  // 「这一轮已经处理过」会把后一个 test 的触发挡掉。
  delete globalThis.__yukkuriSeenTurns;
  delete globalThis.__yukkuriStats;
  delete globalThis.__yukkuriStore;

  const url = 'file://' + path.resolve(__dirname, '..', 'lib', 'index.js').replace(/\\/g, '/');
  const mod = await import(url + '?v=' + Math.random());

  const events = [
    { seq: 1, type: 'assistant/message', data: { turn: 1, message: { id: 'm1', content: [{ type: 'text', text: '第一轮。' }] } } },
    { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  let seq = 2;
  let turn = 1;
  const session = {
    id: 'sess-once',
    get seq() { return seq; },
    snapshotEvents: (from) => events.filter((e) => e.seq > from),
    deriveMessages: () => events,
    push(text) {
      turn += 1;
      events.push({ seq: ++seq, type: 'assistant/message', data: { turn, message: { id: 'm' + turn, content: [{ type: 'text', text }] } } });
      events.push({ seq: ++seq, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
    },
  };

  const routes = new Map();
  const disposers = [];
  const ctx = {
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => {}; } },
    sessions: { list: () => [session], get: () => session },
    sessionTitle: { get: () => ({ title: 't' }) },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d; },
    inject(deps, fn) {
      const scope = {};
      if (deps.includes('webServer')) scope.webServer = ctx.webServer;
      if (deps.includes('sessionTitle')) scope.sessionTitle = ctx.sessionTitle;
      if (deps.includes('commands')) scope.commands = { register: () => {} };
      fn(scope);
    },
  };
  mod.apply(ctx);

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const h = routes.get(u.pathname);
    if (!h) { res.writeHead(404); return res.end('no route'); }
    await h(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  return {
    base, session,
    post: async (p, b) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(),
    get: async (p) => (await fetch(base + p)).json(),
    close: () => { for (const d of disposers) { try { d(); } catch {} } server.close(); },
  };
}

test('同一段只投递一次（第二个客户端拉不到）', async () => {
  const m = await mount();
  try {
    // 模拟浏览器接上：插件靠「有没有人轮询 /pending」区分 TUI 和 Web。
    // 不先拉一次的话，这一轮会被当成 TUI，音频交给本机 mpv，队列里就是空的。
    await m.get('/dsh-yukkuri/pending?after=0');

    await sleep(120);
    await m.post('/dsh-yukkuri/config', { watch: ['sess-once'] });
    await sleep(120);
    m.session.push('这段只该响一次。');
    await sleep(500);

    // 两个客户端（两个标签页）同时拉
    const a = await m.get('/dsh-yukkuri/pending?after=0');
    const b = await m.get('/dsh-yukkuri/pending?after=0');
    const c = await m.get('/dsh-yukkuri/pending?after=0');

    const total = a.segments.length + b.segments.length + c.segments.length;
    assert.strictEqual(total, 1, '三段拉取加起来只该有 1 段，实际 ' + total);
    assert.strictEqual(a.segments.length, 1, '第一个客户端应拿到');
    assert.strictEqual(b.segments.length, 0, '第二个客户端应拿不到');
  } finally {
    m.close();
  }
});

test('多段长文本也只投递一次', async () => {
  const m = await mount();
  try {
    // 模拟浏览器接上：插件靠「有没有人轮询 /pending」区分 TUI 和 Web。
    // 不先拉一次的话，这一轮会被当成 TUI，音频交给本机 mpv，队列里就是空的。
    await m.get('/dsh-yukkuri/pending?after=0');

    await sleep(120);
    await m.post('/dsh-yukkuri/config', { watch: ['sess-once'] });
    await sleep(120);

    // 造一段会切成多段的长文本
    const long = '第一句话在这里。第二句话也在这里。第三句话还是在这里。第四句。第五句。';
    m.session.push(long);
    await sleep(800);

    const first = await m.get('/dsh-yukkuri/pending?after=0');
    const again = await m.get('/dsh-yukkuri/pending?after=0');

    assert.ok(first.segments.length > 0, '第一次应拿到段');
    assert.strictEqual(again.segments.length, 0, '第二次不该再拿到');
  } finally {
    m.close();
  }
});

test('没被拉走的段会累积，不会丢', async () => {
  const m = await mount();
  try {
    // 模拟浏览器接上：插件靠「有没有人轮询 /pending」区分 TUI 和 Web。
    // 不先拉一次的话，这一轮会被当成 TUI，音频交给本机 mpv，队列里就是空的。
    await m.get('/dsh-yukkuri/pending?after=0');

    await sleep(120);
    await m.post('/dsh-yukkuri/config', { watch: ['sess-once'] });
    await sleep(120);
    m.session.push('第一轮。');
    await sleep(500);
    m.session.push('第二轮。');
    await sleep(500);

    const r = await m.get('/dsh-yukkuri/pending?after=0');
    assert.strictEqual(r.segments.length, 2, '两轮都该在，实际 ' + r.segments.length);
  } finally {
    m.close();
  }
});
