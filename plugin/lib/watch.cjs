'use strict';

/**
 * 会话监听：轮询 session 快照，把「说完一整轮」的话交出去。
 *
 * 逻辑照抄 dsh-tts-bridge 的 turn-scanner（那是同一套 DSH 上验证过的）：
 *   - 只在 turn/end 且 reason.kind === 'completed' 时触发
 *   - 只取 block.type === 'text' 的内容
 *   - 首次见到会话不回放历史（否则一装上插件就把之前所有对话念一遍）
 *
 * 这里刻意不碰 DSH API —— 传进来的 session 只要有 {id, seq, snapshotEvents} 就能测。
 */

function createWatcher(opts = {}) {
  const onTurn = opts.onTurn || (() => {});
  const onError = opts.onError || (() => {});

  /** sessionId → { seq, turns: Map<turn, string[]> } */
  const tracked = new Map();
  /** 要听哪些会话；null = 全部 */
  let watching = null;

  function shouldWatch(id) {
    return watching === null || watching.includes(String(id));
  }

  function poll(sessions) {
    const alive = new Set();

    for (const session of sessions || []) {
      const id = String(session.id);
      alive.add(id);

      const seq = Number(session.seq);
      let state = tracked.get(id);

      // 首次见到，或 seq 倒退了（会话被重建）→ 建立基线，不回放
      if (!state || seq < state.seq) {
        tracked.set(id, { seq, turns: new Map() });
        continue;
      }

      if (seq <= state.seq) continue;

      // 不在监听名单里：只推进游标，不读事件。
      // 关键：必须把基线更新到最新，否则以后重新选中这个会话时，
      // 会把「没在听的那段时间」攒下的话一次性全念出来。
      if (!shouldWatch(id)) {
        state.seq = seq;
        continue;
      }

      let events;
      try {
        events = session.snapshotEvents(state.seq);
      } catch (err) {
        // 推进游标再报错：否则同一个坏点每轮都会重复报，
        // 而且真正的恢复只能靠重启插件。
        state.seq = seq;
        onError(err, id);
        continue;
      }

      state.seq = seq;

      for (const event of events || []) {
        if (!event) continue;
        const data = event.data || {};
        if (data.turn === undefined || data.turn === null) continue;

        if (event.type === 'assistant/message') {
          const buf = state.turns.get(data.turn) || [];
          const blocks = data.message && data.message.content;
          if (Array.isArray(blocks)) {
            for (const block of blocks) {
              if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                buf.push(block.text.trim());
              }
            }
          }
          state.turns.set(data.turn, buf);
          continue;
        }

        if (event.type === 'turn/end') {
          const buf = state.turns.get(data.turn);
          // 无论成功失败都要释放缓冲，否则内存会涨
          state.turns.delete(data.turn);

          const done = data.reason && data.reason.kind === 'completed';
          if (done && buf && buf.length) {
            onTurn({
              sessionId: id,
              turn: data.turn,
              text: buf.join('\n\n'),
            });
          }
        }
      }
    }

    // 会话消失（归档/卸载）就丢弃状态，下次选中当作新会话
    for (const id of Array.from(tracked.keys())) {
      if (!alive.has(id)) tracked.delete(id);
    }
  }

  return {
    poll,
    /** 设置要听哪些会话；传 null 表示全部 */
    setWatching(ids) {
      watching = Array.isArray(ids) ? ids.map(String) : null;
    },
    getWatching() {
      return watching === null ? null : Array.from(watching);
    },
    /** 已跟踪的会话数（调试用） */
    trackedCount() {
      return tracked.size;
    },
    /** 忘掉某个会话的游标（比如重新开始监听） */
    reset(id) {
      if (id === undefined) tracked.clear();
      else tracked.delete(String(id));
    },
  };
}

module.exports = { createWatcher };
