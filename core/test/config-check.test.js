const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * SDK 定位的自检。
 *
 * 背景（真实故障）：默认根从「写死的 D:\Documents\yukkuri-sdk」改成
 * ~/yukkuri-sdk（为了换机器不用改代码），本机没设 YUKKURI_SDK_ROOT，
 * 于是所有合成失败，而报错只有 koffi 一句「找不到指定的模块」——
 * 不提路径、不提 SDK，现场表现为「突然不响了」。
 *
 * 所以这里锁两件事：
 *   ① 默认值必须来自 homedir（不是任何人的盘符）；
 *   ② check() 必须把「缺什么、在哪个路径」说清楚。
 */

const CONFIG_PATH = require.resolve('../src/config');

/** 换一套环境变量重新加载 config（SDK_ROOT 是 require 那一刻算的） */
function loadConfig(env) {
  const saved = process.env.YUKKURI_SDK_ROOT;
  if (env.YUKKURI_SDK_ROOT === undefined) delete process.env.YUKKURI_SDK_ROOT;
  else process.env.YUKKURI_SDK_ROOT = env.YUKKURI_SDK_ROOT;

  delete require.cache[CONFIG_PATH];
  const mod = require(CONFIG_PATH);

  delete require.cache[CONFIG_PATH];
  if (saved === undefined) delete process.env.YUKKURI_SDK_ROOT;
  else process.env.YUKKURI_SDK_ROOT = saved;
  return mod;
}

/** 造一个「看起来像 SDK」的目录：check() 只验存在性，不加载 DLL */
function fakeSdk(root) {
  fs.mkdirSync(path.join(root, 'aqtk10_win', 'lib64'), { recursive: true });
  fs.mkdirSync(path.join(root, 'aqk2k_win', 'lib64'), { recursive: true });
  fs.writeFileSync(path.join(root, 'aqtk10_win', 'lib64', 'AquesTalk.dll'), '');
  fs.writeFileSync(path.join(root, 'aqk2k_win', 'lib64', 'AqKanji2Koe.dll'), '');
  return root;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-cfg-'));

test('默认根在用户主目录下，不写死任何一台机器的盘符', () => {
  const mod = loadConfig({});
  assert.strictEqual(mod.SDK_ROOT, path.join(os.homedir(), 'yukkuri-sdk'));

  const d = mod.describe();
  assert.strictEqual(d.sdkRootSource, 'default', '没设 env 时必须标成 default');
  assert.strictEqual(d.sdkRootFromEnv, false);
  assert.ok(Array.isArray(d.candidates) && d.candidates.length >= 1, 'candidates 应可用');
});

test('YUKKURI_SDK_ROOT 覆盖默认值，并把来源标成 env', () => {
  const mod = loadConfig({ YUKKURI_SDK_ROOT: 'D:\\sdk-a' });
  assert.strictEqual(mod.SDK_ROOT, 'D:\\sdk-a');
  assert.strictEqual(mod.describe().sdkRootSource, 'env');
  assert.strictEqual(mod.describe().candidates.length, 2, 'env 与默认值不同时应列两个候选');
});

test('check(): 目录齐了就是 ok', () => {
  const sdk = fakeSdk(path.join(TMP, 'ok'));
  const mod = loadConfig({ YUKKURI_SDK_ROOT: sdk });
  const c = mod.check();
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.code, 'ok');
  assert.strictEqual(c.sdkRoot, sdk);
});

test('check(): 目录不在就是 sdk-missing，而且说得出缺什么', () => {
  const missing = path.join(TMP, 'nope');
  const mod = loadConfig({ YUKKURI_SDK_ROOT: missing });
  const c = mod.check();
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.code, 'sdk-missing');
  assert.ok(c.message.includes(missing), '提示里必须带路径: ' + c.message);
  assert.ok(c.message.includes('AquesTalk.dll'), '提示里必须说缺哪个文件: ' + c.message);
});

test('check(): 中文路径单独报 sdk-not-ascii（不是「找不到」）', () => {
  const mod = loadConfig({ YUKKURI_SDK_ROOT: path.join(TMP, '中文路径') });
  const c = mod.check();
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.code, 'sdk-not-ascii');
  assert.ok(c.message.includes('ASCII'), c.message);
});

test('check(): 路径存在但缺 DLL 时 hint 指回默认位置', () => {
  const empty = path.join(TMP, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const mod = loadConfig({ YUKKURI_SDK_ROOT: empty });
  const c = mod.check();
  assert.strictEqual(c.code, 'sdk-missing');
  assert.ok(c.message.includes(path.join(os.homedir(), 'yukkuri-sdk')), c.message);
});

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});
