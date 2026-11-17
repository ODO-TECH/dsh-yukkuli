const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// DSH 用 JSON.parse 读插件包的 package.json。文件开头一旦有 UTF-8 BOM，
// JSON.parse 抛 "Unexpected token '\ufeff'"，DSH 就整包跳过：
//
//   dsh: skipping profile bundle "dsh-yukkuri-tts": SyntaxError: Unexpected token '﻿'
//
// 此时插件根本没被加载 —— 没有日志、没有路由、没有轮询，重启多少次都不响。
// 2026-11-17 就是这么翻车的：用 PowerShell Set-Content 改版本号顺手写进了 BOM，
// 用户连着重启两次都没声音，而源码和 profile 里的文件看上去一切正常。
// 这条锁住：任何打包/改版本号的脚本都不许把 BOM 带回来。
//
// 两份清单都要查：仓库根那份是**对外发布的**（npm / github: 通道装进 node_modules 的
// 就是它），plugin/ 那份是开发期从源码目录装时用的。

const PLUGIN_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(PLUGIN_DIR, '..');

const MANIFESTS = [
  { label: 'package.json（仓库根 · 对外发布）', dir: ROOT_DIR },
  { label: 'plugin/package.json（开发清单）', dir: PLUGIN_DIR },
];

const readPkg = (m) => JSON.parse(fs.readFileSync(path.join(m.dir, 'package.json'), 'utf8'));

test('package.json 不许带 UTF-8 BOM（DSH 会静默跳过整个包）', () => {
  for (const m of MANIFESTS) {
    const buf = fs.readFileSync(path.join(m.dir, 'package.json'));
    const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    assert.strictEqual(hasBom, false, m.label + ' 开头有 BOM，DSH 会 skip 整个 bundle');
  }
});

test('package.json 能被 JSON.parse 解析，且带 DSH bundle 声明', () => {
  for (const m of MANIFESTS) {
    const pkg = readPkg(m);
    assert.strictEqual(pkg.name, 'dsh-yukkuri-tts', m.label + ' 的 name 要与 cordis.patch.yml 一致');
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, m.label + ' 版本号格式');
    assert.strictEqual(pkg.type, 'module', m.label + ' 必须是 ESM（宿主入口 lib/index.js）');
    assert.ok(pkg.dsh && pkg.dsh.bundle, m.label + ' 缺 dsh.bundle，DSH 不会把插件装进配置');
    const patch = path.resolve(m.dir, pkg.dsh.bundle.patch);
    assert.ok(fs.existsSync(patch), m.label + ' 的 bundle patch 文件不存在: ' + patch);
  }

  // 合并成单包之后的两条护栏（都只在「真装进 node_modules」时才暴露）：
  const root = readPkg(MANIFESTS[0]);
  assert.ok(
    root.files.includes('core/package.json'),
    '根包 files 少了 core/package.json —— core 的 .js 会被根包的 type:module 当成 ESM 而崩'
  );
  assert.ok(root.files.includes('core/src'), '根包 files 少了 core/src（core 随包分发）');
  assert.strictEqual(root.private, undefined, '根包是对外发布的那份，不该标 private');
  for (const m of MANIFESTS.slice(1)) {
    assert.strictEqual(readPkg(m).private, true, m.label + ' 是开发清单，必须 private 防误发');
  }
  assert.strictEqual(
    readPkg(MANIFESTS[1]).version, root.version,
    '两份清单的版本号要一致，否则开发期与发布包悄悄分叉'
  );
});