const assert = require('node:assert');

/**
 * DSH 的命令 handler 必须返回 CommandResult：
 *   { kind: 'success', text? } | { kind: 'error', text }
 * 来源：dsh-commands 的 lib/index.js:185，返回裸字符串会直接抛
 *   Command handler "yukkuri" must return a CommandResult
 * 线上症状（2026-11-17，TUI）：每次敲 /yukkuri 都只得到这一行报错，命令一条都没执行。
 *
 * 测试大多断言文本，所以统一包一层：先校验形状，再把 text 取出来。
 */
function wrap(handler) {
  return async (...args) => {
    const r = await handler(...args);
    assert.ok(
      r && typeof r === 'object' && typeof r.kind === 'string',
      '命令 handler 必须返回 CommandResult（{kind, text}），实际: ' + JSON.stringify(r)
    );
    return r.text;
  };
}

module.exports = { wrap };
