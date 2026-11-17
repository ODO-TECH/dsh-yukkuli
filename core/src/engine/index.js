'use strict';

/**
 * 引擎 seam。
 *
 * 两个真实适配器（local / remote）满足同一个接口，
 * 所以这是个值得存在的 seam，而不是"只有一个实现"的假想抽象。
 *
 * 接口：
 *   open({kind, ...opts}) -> { kind, synthe(text, opts) -> Promise<Buffer>, close() }
 *
 * 约定：
 *   - 未配置就报错，绝不静默降级到另一个引擎
 *   - close() 幂等
 */

const ADAPTERS = {
  local: () => require('./local'),
  remote: () => require('./remote'),
};

function available() {
  return Object.keys(ADAPTERS);
}

/**
 * @param {{kind?: string}} [opts]
 * @returns {Promise<{kind: string, synthe: Function, close: Function}>}
 */
async function open(opts = {}) {
  const kind = opts.kind || 'local';
  const factory = ADAPTERS[kind];

  if (!factory) {
    throw new Error(
      'unknown engine: ' + JSON.stringify(kind) + '（可用: ' + available().join(', ') + '）'
    );
  }

  return factory().open(opts);
}

module.exports = { open, available };
