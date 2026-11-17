const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

process.env.YUKKURI_CFG_PATH = path.join(os.tmpdir(), 'yukkuri-release-' + process.pid + '.json');
process.env.YUKKURI_INTERVAL_MS = '40';
process.env.YUKKURI_MUTE = '1';

// 一次性投递的代价：浏览器拒绝自动播放时，段已经消耗掉了。
// 客户端必须能把它还回来，否则是「静默吞掉朗读」。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mount() {
  const url = 'file://' + path.resolve(__dirname, '..', 'lib', 'index.js').replace(/\\/g, '/');
  const mod = await import(url);

  const events = [];
  let seq = 0;
  let turn = 0;
  const session = {
    id: 'sess-rel',
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

test('播不出来的段可以还回队列，下一轮还能取到', async () => {
  const m = await mount();
  try {
    // 模拟浏览器接上：插件靠「有没有人轮询 /pending」区分 TUI 和 Web。
    // 不先拉一次的话，这一轮会被当成 TUI，音频交给本机 mpv，队列里就是空的。
    await m.get('/dsh-yukkuri/pending?after=0');

    await sleep(120);
    await m.post('/dsh-yukkuri/config', { watch: ['sess-rel'] });
    await sleep(120);
    m.session.push('这段会被还回来。');
    await sleep(500);

    const first = await m.get('/dsh-yukkuri/pending?after=0');
    assert.strictEqual(first.segments.length, 1, '先取到');
    const id = first.segments[0].id;

    const empty = await m.get('/dsh-yukkuri/pending?after=0');
    assert.strictEqual(empty.segments.length, 0, '还没还之前取不到（一次性投递）');

    const rel = await m.post('/dsh-yukkuri/release', { ids: [id] });
    assert.strictEqual(rel.released, 1, '应该还回 1 段');

    const again = await m.get('/dsh-yukkuri/pending?after=0');
    assert.strictEqual(again.segments.length, 1, '还回来之后能再取到');
    assert.strictEqual(again.segments[0].id, id, '还是同一段');
  } finally {
    m.close();
  }
});

test('还回不存在的 id 不报错，也不影响队列', async () => {
  const m = await mount();
  try {
    const r = await m.post('/dsh-yukkuri/release', { ids: ['99999', 'abc'] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.released, 0);
  } finally {
    m.close();
  }
});

test('还回手动朗读的段不生效（它本来就不该进广播流）', async () => {
  const m = await mount();
  try {
    const say = await m.post('/dsh-yukkuri/say', { text: '手动念一句。' });
    assert.strictEqual(say.ok, true, '试听应成功');

    const rel = await m.post('/dsh-yukkuri/release', { ids: [say.id] });
    assert.strictEqual(rel.released, 0, '手动段不该被还回广播流');

    const p = await m.get('/dsh-yukkuri/pending?after=0');
    assert.strictEqual(p.segments.length, 0, '广播流里不该出现手动段');
  } finally {
    m.close();
  }
});
