const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 这条是长期护栏：源码里不许出现写死的盘符路径。
//
// 曾经有三处：插件的 core 路径、TUI 的 mpv 路径、core 的 SDK 路径。
// 它们都有一个共同的性质 —— 在作者机器上「刚好能用」，所以永远不会在开发时暴露；
// 一旦别人 clone 下来，症状从「DLL 找不到」到「辞書パスの文字コード不正」都有，
// 而报错信息里根本不提这是一条写死的路径。
//
// 允许的写法：环境变量、~/ 开头的主目录、相对路径、以及装完去 PATH 里找的命令名。

const CODE_DIRS = [
  path.resolve(__dirname, '../lib'),
  path.resolve(__dirname, '../../core/src'),
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(?:js|cjs|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 盘符路径：C:\ 或 D:/ 之类。
// 前面允许出现的只有「不是字母数字下划线」的字符 —— 这样 http:// 里的 p:/ 不算。
const DRIVE = /(^|[^A-Za-z0-9_])[A-Za-z]:[\\/]/;

/**
 * 在指定的环境变量下重新加载 core 的 config。
 * config 在 require 的那一刻就把 SDK_ROOT 算好了，所以要换环境就得换一份模块。
 */
function withEnv(env) {
  const keys = ['YUKKURI_SDK_ROOT'];
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  const cfgPath = require.resolve('../../core/src/config.js');
  delete require.cache[cfgPath];
  try {
    return require('../../core/src/config.js');
  } finally {
    delete require.cache[cfgPath];
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('plugin/lib 与 core/src 里没有任何写死的盘符路径', () => {
  const bad = [];
  for (const dir of CODE_DIRS) {
    for (const file of walk(dir)) {
      const text = fs.readFileSync(file, 'utf8');
      text.split(/\r?\n/).forEach((line, i) => {
        if (DRIVE.test(line)) {
          bad.push(path.relative(path.resolve(__dirname, '../..'), file) + ':' + (i + 1) + '  ' + line.trim());
        }
      });
    }
  }
  assert.deepStrictEqual(bad, [], '发现写死的本机路径，改成环境变量或相对解析:\n' + bad.join('\n'));
});

test('mpv 的默认值是个命令名（装完去 PATH 里找），不是某台机器上的绝对路径', () => {
  const { DEFAULT_MPV } = require('../lib/player-tui.cjs');
  assert.ok(!/[/\\]/.test(DEFAULT_MPV), 'DEFAULT_MPV 含路径分隔符，说明它是个绝对路径: ' + DEFAULT_MPV);
});

test('SDK 默认值来自用户主目录，环境变量能覆盖它', () => {
  // 不能直接断言「SDK_ROOT 不含盘符」—— Windows 上 ~/yukkuri-sdk 展开后
  // 本来就是 C:\Users\xxx\yukkuri-sdk，盘符是 homedir() 带来的，不是写死的。
  // 所以这里断言的是「它等于 homedir 拼出来的那个值」。
  assert.strictEqual(withEnv({}).SDK_ROOT, path.join(os.homedir(), 'yukkuri-sdk'));

  // 给了环境变量就听环境变量的（这是唯一能在装到别处时救场的开关）
  assert.strictEqual(withEnv({ YUKKURI_SDK_ROOT: 'X:/somewhere/sdk' }).SDK_ROOT, 'X:/somewhere/sdk');
});
