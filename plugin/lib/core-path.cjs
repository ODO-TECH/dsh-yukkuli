'use strict';

/**
 * 定位 yukkuri-core。
 *
 * 插件自己是壳，真正合成的是 core。core 可能出现在三种地方，顺序不能乱：
 *
 *   1. 环境变量 YUKKURI_CORE_PATH —— 唯一能覆盖判断的开关
 *   2. 同仓库兄弟目录 <repo>/core/src  —— 开发期最常见的形态，也是发布包的形态
 *      （core 随 dsh-yukkuri-tts 一起分发，不单独发 npm）
 *   3. node_modules/yukkuri-core/src   —— 兜底：谁要是单独放了一份 core 进来
 *
 * 三条都不通就抛错，把「已经找过哪些路径」原样写进错误里。
 *
 * 以前这里还有一条写死的兜底路径，指向作者机器上的仓库目录：在作者机器上它让
 * 一切看起来都正常，在别人机器上它指向一个不存在的目录，报错还报得语焉不详。
 * 可移植性就是从删掉那一行开始的 —— 现在源码里不许再出现任何盘符路径
 * （由 test/no-hardcoded-paths.test.cjs 长期锁住）。
 */

const { existsSync } = require('node:fs');
const path = require('node:path');

const ENV_NAME = 'YUKKURI_CORE_PATH';
const PKG_NAME = 'yukkuri-core';

/**
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   existsSync?: (p: string) => boolean,
 *   resolveModule?: (id: string) => string,
 *   siblingBase?: string|null,
 * }} [opts]
 * @returns {{path: string, source: 'env'|'sibling'|'npm'}}
 */
function resolveCorePath(opts = {}) {
  const env = opts.env || process.env;
  const exists = opts.existsSync || existsSync;
  const resolveModule = opts.resolveModule || null;
  const siblingBase = opts.siblingBase || null;

  const tried = [];

  // 1. 环境变量：给了就只认它。
  //    给了却不存在必须当场失败 —— 否则会静默回落到别的地方，
  //    让人以为在跑自己指定的那份 core，其实不是。
  const fromEnv = env[ENV_NAME];
  if (fromEnv) {
    if (!exists(fromEnv)) {
      const err = new Error(ENV_NAME + ' 指向的目录不存在: ' + fromEnv);
      err.tried = [{ source: 'env', path: fromEnv }];
      throw err;
    }
    return { path: fromEnv, source: 'env' };
  }

  // 2. 同仓库：plugin/lib/../../core/src
  if (siblingBase) {
    const p = path.resolve(siblingBase);
    tried.push({ source: 'sibling', path: p });
    if (exists(p)) return { path: p, source: 'sibling' };
  }

  // 3. npm：require.resolve('yukkuri-core') → <pkg>/src/index.js，取目录
  if (typeof resolveModule === 'function') {
    try {
      const main = resolveModule(PKG_NAME);
      const p = path.dirname(main);
      tried.push({ source: 'npm', path: p });
      if (exists(p)) return { path: p, source: 'npm' };
    } catch {
      tried.push({ source: 'npm', path: PKG_NAME + '（未安装）' });
    }
  }

  const lines = tried.map((t) => '  - [' + t.source + '] ' + t.path).join('\n');
  const err = new Error(
    '找不到 ' + PKG_NAME + '，插件没法合成语音。已经找过：\n' +
      (lines || '  （没有任何候选路径）') +
      '\n怎么办：\n' +
      '  重装 dsh-yukkuri-tts（core 随包分发，正常不该缺）\n' +
      '  或者设 ' + ENV_NAME + ' 指向 core 的 src 目录',
  );
  err.tried = tried;
  throw err;
}

module.exports = { resolveCorePath, ENV_NAME, PKG_NAME };
