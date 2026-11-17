const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

process.env.YUKKURI_CFG_PATH = path.join(os.tmpdir(), 'yukkuri-hand-' + process.pid + '.json');
// 插件用自己的 setInterval 轮询，这里把间隔调到很短，让测试能等出结果
process.env.YUKKURI_INTERVAL_MS = '40';
process.env.YUKKURI_MUTE = '1';

// 手动朗读（/speak、/say）的音频不能进自动朗读的广播队列，
// 否则浏览器轮询 /pending 时会把它再播一遍 —— 表现为「同一句话播两遍、
// 而且按暂停停了以后又被拉回来」。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mount() {
  const url = 'file://' + path.resolve(__dirname, '..', 'lib', 'index.js').replace(/\\/g, '/');
  const mod = await import(url);

  const events = [
    { seq: 1, type: 'assistant/message', data: { turn: 1, message: { id: 'msg-1', content: [{ type: 'text', text: '第一轮。' }] } } },
    { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  let seq = 2;
  let turn = 1;
  const session = {
    id: 'sess-auto',
    get seq() { return seq; },
    snapshotEvents: (from) => events.filter((e) => e.seq > from),
    deriveMessages: () => events,
    push(text) {
      turn += 1;
      events.push({ seq: ++seq, type: 'assistant/message', data: { turn, message: { id: 'msg-' + turn, content: [{ type: 'text', text }] } } });
      events.push({ seq: ++seq, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
    },
  };

  const routes = new Map();
  const disposers = [];
  const ctx = {
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => {}; } },
    sessions: { list: () => [session], get: () => session },
    sessionTitle: { get: () => ({ title: 't' }) },
    effect(fn) {
      const d = fn();
      if (typeof d === 'function') disposers.push(d);
      return d;
    },
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
    base,
    session,
    post: async (p, b) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(),
    get: async (p) => (await fetch(base + p)).json(),
    close: () => {
      for (const d of disposers) { try { d(); } catch {} }
      server.close();
    },
  };
}

test('试听（/say）的段不进 /pending 广播队列', async () => {
  const m = await mount();
  try {
    await sleep(120); // 让轮询先跑起来
    const said = await m.post('/dsh-yukkuri/say', { text: '试听一句' });
    assert.ok(said.ok, '试听应成功');

    await sleep(150); // 给轮询足够时间把它捞走（如果不该被捞，就永远是 0）
    const pend = await m.get('/dsh-yukkuri/pending?after=0');
    assert.strictEqual(pend.segments.length, 0, '试听的段不该出现在待播队列: ' + JSON.stringify(pend.segments.map((s) => s.id)));
  } finally {
    m.close();
  }
});

test('点小喇叭（/speak）的段也不进广播队列', async () => {
  const m = await mount();
  try {
    await sleep(120);
    const r = await m.post('/dsh-yukkuri/speak', { sessionId: 'sess-auto', messageId: 'msg-1' });
    assert.ok(r.ok, '应成功');
    assert.ok(r.segments.length > 0, '应有段');

    await sleep(150);
    const pend = await m.get('/dsh-yukkuri/pending?after=0');
    assert.strictEqual(pend.segments.length, 0, '手动朗读的段不该进待播队列: ' + JSON.stringify(pend.segments.map((s) => s.id)));
  } finally {
    m.close();
  }
});

test('自动朗读的段仍会进广播队列', async () => {
  const m = await mount();
  try {
    // 模拟浏览器接上（插件靠 /pending 轮询区分 TUI 和 Web）
    await m.get('/dsh-yukkuri/pending?after=0');
    // 让轮询建立基线
    await sleep(120);
    await m.post('/dsh-yukkuri/config', { watch: ['sess-auto'] });
    await sleep(120);

    // 推进一轮新对话
    m.session.push('自动朗读的内容。');
    await sleep(400);

    const pend = await m.get('/dsh-yukkuri/pending?after=0');
    assert.ok(pend.segments.length > 0, '自动朗读的段应出现，实际 ' + pend.segments.length);
  } finally {
    m.close();
  }
});

test('手动朗读的段仍能通过 /audio 取到', async () => {
  const m = await mount();
  try {
    const said = await m.post('/dsh-yukkuri/say', { text: '取得到吗' });
    const r = await fetch(m.base + said.url);
    assert.strictEqual(r.status, 200, '手动段要能从 /audio 取到');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.strictEqual(buf.slice(0, 4).toString(), 'RIFF');
  } finally {
    m.close();
  }
});
