const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { resolveCorePath } = require('../lib/core-path.cjs');

// core 定位的三条路，对应三种装法：
//   1. YUKKURI_CORE_PATH    —— 我自己指定了路径
//   2. 同仓库 ../core/src   —— 源码仓库里开发
//   3. node_modules         —— 从 npm 装进来
//
// 这三条以前只实现了前两条的一半：第二条后面还挂着一个写死的本机绝对路径，
// 于是「源码仓库」永远能跑，「npm 装」永远跑不起来，而写死的那条在别人机器上
// 指向一个不存在的目录。这组测试锁住的就是这件事。

const samePath = (a, b) => path.resolve(a) === path.resolve(b);
const fsHas = (dirs) => (p) => dirs.some((d) => samePath(d, p));

test('环境变量优先：给了就直接用，连兄弟目录都不看', () => {
  const envPath = '/somewhere/else/core/src';
  const r = resolveCorePath({
    env: { YUKKURI_CORE_PATH: envPath },
    existsSync: fsHas([envPath, '/repo/core/src']),
    siblingBase: '/repo/core/src',
  });
  assert.strictEqual(r.source, 'env');
  assert.strictEqual(r.path, envPath);
});

test('环境变量指了不存在的目录 —— 当场报错，绝不静默回落到别的 core', () => {
  assert.throws(
    () =>
      resolveCorePath({
        env: { YUKKURI_CORE_PATH: '/nope/core/src' },
        existsSync: fsHas(['/repo/core/src']),
        siblingBase: '/repo/core/src',
      }),
    /YUKKURI_CORE_PATH 指向的目录不存在/,
  );
});

test('没有环境变量时用同仓库的兄弟目录', () => {
  const r = resolveCorePath({
    env: {},
    existsSync: fsHas(['/repo/core/src']),
    siblingBase: '/repo/core/src',
  });
  assert.strictEqual(r.source, 'sibling');
  assert.ok(samePath(r.path, '/repo/core/src'));
});

test('装进 node_modules 时按 require.resolve("yukkuri-core") 找（main 是 src/index.js）', () => {
  const main = '/profile/node_modules/yukkuri-core/src/index.js';
  const r = resolveCorePath({
    env: {},
    existsSync: fsHas(['/profile/node_modules/yukkuri-core/src']),
    siblingBase: '/profile/node_modules/core/src', // npm 布局下这条不存在
    resolveModule: (id) => {
      assert.strictEqual(id, 'yukkuri-core');
      return main;
    },
  });
  assert.strictEqual(r.source, 'npm');
  assert.ok(samePath(r.path, '/profile/node_modules/yukkuri-core/src'));
});

test('三条都不通 —— 错误里要列出找过哪些路径和怎么装', () => {
  let err = null;
  try {
    resolveCorePath({
      env: {},
      existsSync: () => false,
      siblingBase: '/profile/node_modules/core/src',
      resolveModule: () => {
        throw new Error('MODULE_NOT_FOUND');
      },
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err, '应该抛错');
  assert.match(err.message, /找不到 yukkuri-core/);
  assert.match(err.message, /sibling/);
  assert.match(err.message, /npm/);
  assert.match(err.message, /重装 dsh-yukkuri-tts/);
  assert.match(err.message, /YUKKURI_CORE_PATH/);
  assert.strictEqual(err.tried.length, 2, '两条候选都该记在 tried 里');
});
