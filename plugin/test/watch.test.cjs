const test = require('node:test');
const assert = require('node:assert');
const { createWatcher } = require('../lib/watch.cjs');

// 会话监听的纯逻辑：给定「哪些会话要听」+ 会话快照，产出「这一轮的话」
// 不碰 DSH API，可以独立测

function fakeSession(id, events, seq) {
  return {
    id,
    seq,
    snapshotEvents: (from) => events.filter((e) => e.seq > from),
  };
}

test('首次见到会话时不回放历史', () => {
  const got = [];
  const w = createWatcher({ onTurn: (t) => got.push(t) });
  const s = fakeSession('s1', [
    { seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '历史' }] } } },
    { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ], 2);

  w.poll([s]);
  assert.strictEqual(got.length, 0, '首次不该回放，实际: ' + JSON.stringify(got));
});

test('新事件产生一轮朗读', () => {
  const got = [];
  const w = createWatcher({ onTurn: (t) => got.push(t) });
  let seq = 0;
  const events = [];
  const s = { id: 's1', get seq() { return seq; }, snapshotEvents: (from) => events.filter((e) => e.seq > from) };

  w.poll([s]);  // 建立基线

  // 新增一轮
  events.push({ seq: 1, type: 'assistant/message', data: { turn: 7, message: { content: [{ type: 'text', text: '你好呀' }] } } });
  events.push({ seq: 2, type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } });
  seq = 2;
  w.poll([s]);

  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].sessionId, 's1');
  assert.strictEqual(got[0].turn, 7);
  assert.strictEqual(got[0].text, '你好呀');
});

test('未完成的轮次不触发', () => {
  const got = [];
  const w = createWatcher({ onTurn: (t) => got.push(t) });
  let seq = 0;
  const events = [];
  const s = { id: 's1', get seq() { return seq; }, snapshotEvents: (from) => events.filter((e) => e.seq > from) };
  w.poll([s]);

  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '说了一半' }] } } });
  seq = 1;
  w.poll([s]);
  assert.strictEqual(got.length, 0, '没有 turn/end 不该触发');
});

test('失败/中断的轮次不触发', () => {
  const got = [];
  const w = createWatcher({ onTurn: (t) => got.push(t) });
  let seq = 0;
  const events = [];
  const s = { id: 's1', get seq() { return seq; }, snapshotEvents: (from) => events.filter((e) => e.seq > from) };
  w.poll([s]);

  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '内容' }] } } });
  events.push({ seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'failed' } } });
  seq = 2;
  w.poll([s]);
  assert.strictEqual(got.length, 0, 'failed 不该触发');
});

test('只有非 text block 时不触发', () => {
  const got = [];
  const w = createWatcher({ onTurn: (t) => got.push(t) });
  let seq = 0;
  const events = [];
  const s = { id: 's1', get seq() { return seq; }, snapshotEvents: (from) => events.filter((e) => e.seq > from) };
  w.poll([s]);

  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'tool_use', name: 'bash' }] } } });
  events.push({ seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  seq = 2;
  w.poll([s]);
  assert.strictEqual(got.length, 0, '纯结构化不该触发');
});

test('只监听指定的会话', () => {
  const got = [];
  const w = createWatcher({ onTurn: (t) => got.push(t) });

  // 假会话：seq 必须真的递增，turn 号也要递增 —— 否则第二次 push
  // 产生的会是「同一个 turn 的重复事件」，测不出真实行为。
  const mk = (id) => {
    let seq = 0;
    let turn = 0;
    const events = [];
    return {
      id,
      get seq() { return seq; },
      snapshotEvents: (from) => events.filter((e) => e.seq > from),
      push() {
        turn += 1;
        events.push({
          seq: ++seq,
          type: 'assistant/message',
          data: { turn, message: { content: [{ type: 'text', text: id + '#' + turn }] } },
        });
        events.push({ seq: ++seq, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
      },
    };
  };

  const a = mk('a'), b = mk('b');
  w.poll([a, b]);                 // 基线
  a.push(); b.push();
  w.poll([a, b]);
  assert.strictEqual(got.length, 2, '两个都听了');
  assert.deepStrictEqual(got.map((g) => g.sessionId), ['a', 'b']);

  // 只留 a：b 的新内容不该被念
  w.setWatching(['a']);
  a.push(); b.push();
  w.poll([a, b]);
  assert.strictEqual(got.length, 3, '只该多一条: ' + JSON.stringify(got.map((g) => g.sessionId)));
  assert.strictEqual(got[2].sessionId, 'a', '新增的那条必须来自 a');
  assert.strictEqual(got[2].text, 'a#2', '内容必须来自 a 的第二轮');
});

test('会话消失后重新出现当作新会话', () => {
  const got = [];
  const w = createWatcher({ onTurn: (t) => got.push(t) });
  const s = fakeSession('s1', [], 0);
  w.poll([s]);
  w.poll([]);           // 消失了
  const s2 = fakeSession('s1', [
    { seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '旧' }] } } },
    { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ], 2);
  w.poll([s2]);
  assert.strictEqual(got.length, 0, '重新出现不该回放历史');
});

test('snapshotEvents 抛错不影响其他会话', () => {
  const got = [];
  const errs = [];
  const w = createWatcher({ onTurn: (t) => got.push(t), onError: (e) => errs.push(e) });
  let badSeq = 0;
  const bad = {
    id: 'bad',
    get seq() { return badSeq; },
    snapshotEvents: () => { throw new Error('boom'); },
  };
  let seq = 0;
  const events = [];
  const good = { id: 'good', get seq() { return seq; }, snapshotEvents: (from) => events.filter((e) => e.seq > from) };

  w.poll([bad, good]);          // 建立基线

  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'ok' }] } } });
  events.push({ seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  seq = 2;
  badSeq = 1;                   // 坏会话的 seq 也要前进，才会走到 snapshotEvents
  w.poll([bad, good]);

  assert.strictEqual(got.length, 1, '好会话应正常触发');
  assert.strictEqual(errs.length, 1, '坏会话应报错');
});

test('seq 没前进时不会重复尝试（游标确实推进了）', () => {
  const errs = [];
  const w = createWatcher({ onTurn: () => {}, onError: (e) => errs.push(e) });
  let badSeq = 0;
  const bad = {
    id: 'bad',
    get seq() { return badSeq; },
    snapshotEvents: () => { throw new Error('boom'); },
  };
  w.poll([bad]);          // 基线

  badSeq = 5;
  w.poll([bad]);          // 第一次尝试 → 报错
  w.poll([bad]);          // seq 没动 → 不该再试
  w.poll([bad]);

  assert.strictEqual(errs.length, 1, '同一段没前进的事件只该报一次，实际: ' + errs.length);
});

test('取消监听期间推进的游标会被记住，重新监听不回放', () => {
  const got = [];
  const w = createWatcher({ onTurn: (t) => got.push(t) });
  let seq = 0;
  const events = [];
  const s = { id: 's1', get seq() { return seq; }, snapshotEvents: (from) => events.filter((e) => e.seq > from) };

  w.poll([s]);                       // 基线
  w.setWatching([]);                 // 谁都不听

  events.push({ seq: 1, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '不该念' }] } } });
  events.push({ seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  seq = 2;
  w.poll([s]);                       // 不在监听，只推进游标
  assert.strictEqual(got.length, 0);

  w.setWatching(['s1']);             // 重新选中
  w.poll([s]);
  assert.strictEqual(got.length, 0, '重新选中不该回放没在听时的话');
});
