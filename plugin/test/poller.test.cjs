const test = require('node:test');
const assert = require('node:assert');
const { createPoller } = require('../lib/poller.cjs');

// 轮询调度：把「多久查一次会话」这件事隔离出来，用假时钟测

test('每 tick 调一次 sessions.list', () => {
  let calls = 0;
  const p = createPoller({
    list: () => { calls += 1; return []; },
    onPoll: () => {},
  });
  p.tick();
  p.tick();
  assert.strictEqual(calls, 2);
});

test('list 抛错不影响后续 tick', () => {
  let calls = 0;
  const errs = [];
  const p = createPoller({
    list: () => { calls += 1; if (calls === 1) throw new Error('boom'); return []; },
    onPoll: () => {},
    onError: (e) => errs.push(e),
  });
  p.tick();
  p.tick();
  assert.strictEqual(calls, 2, '第二次应继续');
  assert.strictEqual(errs.length, 1);
});

test('stop 之后不再 tick', () => {
  let calls = 0;
  const p = createPoller({ list: () => { calls += 1; return []; }, onPoll: () => {} });
  p.tick();
  p.stop();
  assert.strictEqual(calls, 1);
});

test('start 会立刻 tick 一次建立基线', () => {
  let calls = 0;
  const p = createPoller({ list: () => { calls += 1; return []; }, onPoll: () => {} });
  p.start(100000);   // 间隔很长，只测首帧
  assert.strictEqual(calls, 1, 'start 应立刻跑一次');
  p.stop();
});

test('重复 start 不会开多个定时器', () => {
  let calls = 0;
  const p = createPoller({ list: () => { calls += 1; return []; }, onPoll: () => {} });
  p.start(100000);
  p.start(100000);
  assert.strictEqual(calls, 2, '两次 start 各跑一次首帧，但不应叠加定时器');
  p.stop();
});

test('onPoll 收到的就是 list 的结果', () => {
  const seen = [];
  const data = [{ id: 'x' }];
  const p = createPoller({ list: () => data, onPoll: (s) => seen.push(s) });
  p.tick();
  assert.deepStrictEqual(seen[0], data);
});
