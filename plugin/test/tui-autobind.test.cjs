const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

/**
 * TUI 兜底：watch 为空、或者指向的是别的进程里的会话时，
 * 应该退化成「念当前进程里的会话」。
 *
 * 真实场景：用户在 Web 端勾过会话，切到 TUI 后 watch 里还是那个旧 id。
 * 结果是插件加载正常、开关开着、却一句都不念。
 */

const CFG = path.join(os.tmpdir(), 'yk-autobind-' + process.pid + '.json');

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

async function mount(watch, sessions) {
  delete globalThis.__yukkuriSeenTurns;
  delete globalThis.__yukkuriStats;
  delete globalThis.__yukkuriStore;
  delete globalThis.__yukkuriHost;

  fs.writeFileSync(CFG, JSON.stringify({
    enabled: true, watch, voice: 'f1', emotion: 'neutral',
    maxKana: 100, intervalMs: 60, keepSegments: 40,
  }));
  process.env.YUKKURI_CFG_PATH = CFG;
  process.env.YUKKURI_INTERVAL_MS = '60';
  // 测试会加载真 core 真插件，不静音就会在用户扬声器里念出来
  process.env.YUKKURI_MUTE = '1';

  const ctx = {
    sessions: { list: () => sessions, get: (id) => sessions.find((s) => s.id === id) },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    inject() {}, // 没有 webServer、没有 commands —— 这就是 TUI
  };

  const url = 'file://' + path.resolve(__dirname, '../lib/index.js').replace(/\\/g, '/');
  process.env.NODE_NO_WARNINGS = '1';
  const mod = await import(url + '?v=' + Math.random());
  mod.apply(ctx);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('watch 指向不存在的会话时，TUI 端退化成念当前会话', async () => {
  const s = makeSession('live-sess');
  await mount(['ghost-sess-from-web'], [s]);

  await sleep(600);            // 等够 4 轮轮询（60ms 一轮）
  s.push('第一句。第二句。', 1);
  await sleep(500);

  const st = globalThis.__yukkuriStats || {};
  assert.strictEqual(st.triggers, 1, '应触发一次，实际 ' + st.triggers);
  assert.strictEqual(globalThis.__yukkuriStore.segments.size, 2,
    '应合成 2 段，实际 ' + globalThis.__yukkuriStore.segments.size);
  assert.strictEqual(st.plays, 2, '2 段应各播一次，实际播了 ' + st.plays);
});

test('watch 为空时也一样（TUI 默认不绑任何会话）', async () => {
  const s = makeSession('live-sess-2');
  await mount([], [s]);

  await sleep(600);
  s.push('只有一句。', 1);
  await sleep(500);

  const st = globalThis.__yukkuriStats || {};
  assert.strictEqual(st.triggers, 1, '应触发一次，实际 ' + st.triggers);
});

test('名单里就是在线的会话时，不会扩大范围', async () => {
  const a = makeSession('live-a');
  const b = makeSession('live-b');
  await mount(['live-a'], [a, b]);

  await sleep(600);
  a.push('念我。', 1);
  b.push('别念我。', 1);
  await sleep(500);

  const st = globalThis.__yukkuriStats || {};
  assert.strictEqual(st.triggers, 1, '只该触发 a 那一次，实际 ' + st.triggers);
});
