'use strict';

/**
 * 轮询调度。
 *
 * 职责只有一件：隔一会儿问一次「现在有哪些会话」，把结果交给 onPoll。
 * 真正的「哪些话该念」在 watch.js 里。分开是为了两边都能单独测。
 */

function createPoller(opts = {}) {
  const list = opts.list || (() => []);
  const onPoll = opts.onPoll || (() => {});
  const onError = opts.onError || (() => {});

  let timer = null;
  let intervalMs = 0;

  function tick() {
    let sessions;
    try {
      sessions = list();
    } catch (err) {
      onError(err);
      return;
    }
    try {
      onPoll(sessions);
    } catch (err) {
      onError(err);
    }
  }

  return {
    tick,
    /** 立刻 tick 一次（建立基线），然后按间隔轮询 */
    start(ms = 1000) {
      intervalMs = ms;
      tick();
      // 重复 start 先清掉旧的，避免叠加定时器
      if (timer) clearInterval(timer);
      timer = setInterval(tick, ms);
      if (timer.unref) timer.unref(); // 别拖住进程退出
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    isRunning() {
      return timer !== null;
    },
    getInterval() {
      return intervalMs;
    },
  };
}

module.exports = { createPoller };
