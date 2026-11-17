'use strict';

/**
 * 按分发通道暂存「极简」产物 —— 只复制必要文件，不压缩、不发布、不联网。
 *
 * 三份暂存树，都在 dist/ 下（dist/ 已被 .gitignore 忽略）：
 *
 *   dist/npm/dsh-yukkuri-tts/      npm 通道：一个包，core 随包分发
 *   dist/github/repo/              github 通道：要 push 的干净仓库树
 *   dist/offline/dsh-yukkuri-tts/  离线通道：同一棵运行树 + 预装 node_modules + 安装.md
 *
 * npm 与 github: 两条通道装的是**同一个包**（仓库根那份 package.json），所以运行树只有一份。
 * 第四条通道「本地目录」（dsh plugin add "file:<仓库根>"）不产任何产物 ——
 * 它直接用工作树，files 白名单对软链接不生效。
 *
 * 为什么白名单写死在这里，而不是读 package.json 的 files：
 *   npm 的 files 删不掉 README / LICENSE —— 实测连 '!plugin/README.md' 这种否定
 *   写法也压不住它的「always included」规则。所以这里按「实际会被装进
 *   node_modules 的东西」显式列一遍；要核对真实清单，跑 npm pack --dry-run。
 *
 * 用法：
 *   node packaging/pack.cjs                    全部通道
 *   node packaging/pack.cjs --only npm,github  只做指定通道（前缀匹配 id）
 *   node packaging/pack.cjs --no-deps          离线树不拷 node_modules
 *
 * 压缩成 zip / tgz 是独立的一步，等 README 定稿后再做，本脚本不含压缩逻辑。
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const DIST = path.join(REPO, 'dist');

/** github: / 离线通道真正装进 node_modules 的那棵树（= 根包 files 白名单 + npm 强制塞的 4 个文档）。 */
const RUNTIME_ROOT = [
  'package.json',
  'README.md',
  'LICENSE',
  'plugin/cordis.patch.yml',
  'plugin/lib',
  'plugin/README.md', // npm 强制包含，files 删不掉
  'plugin/LICENSE', // 同上
  'core/package.json', // 必须在：它声明 type=commonjs，少了 core 的 .js 会被当 ESM
  'core/src',
  'core/README.md', // npm 强制包含
  'core/LICENSE', // 同上
];

/** 要 push 到 GitHub 的仓库树：源码 + 测试 + 文档 + 上架物料，不含任何本机垃圾。 */
const REPO_TREE = [
  'package.json',
  'README.md',
  'LICENSE',
  '.gitignore',
  'AGENTS.md',
  'HANDOFF.md',
  'WORKLOG.md',
  'plugin/package.json',
  'plugin/cordis.patch.yml',
  'plugin/README.md',
  'plugin/LICENSE',
  'plugin/lib',
  'plugin/test',
  'core/package.json',
  'core/README.md',
  'core/LICENSE',
  'core/demo.cjs',
  'core/demo-chars.cjs',
  'core/src',
  'core/test',
  'core/docs',
  'marketplace',
  'packaging',
  'output-chars', // README 引用的试听样本（6 个 wav，532 kB）
];

const CHANNELS = [
  {
    id: 'npm',
    title: 'npm · dsh-yukkuri-tts（core 随包分发）',
    dir: 'npm/dsh-yukkuri-tts',
    base: '.',
    entries: RUNTIME_ROOT,
    install: 'dsh plugin --profile web add dsh-yukkuri-tts',
  },
  {
    id: 'github-repo',
    title: 'github · 要 push 的仓库树',
    dir: 'github/repo',
    base: '.',
    entries: REPO_TREE,
    install: 'dsh plugin --profile web add github:ODO-TECH/dsh-yukkuli',
  },
  {
    id: 'offline',
    title: '离线 · 运行树 + 预装依赖',
    dir: 'offline/dsh-yukkuri-tts',
    base: '.',
    entries: RUNTIME_ROOT,
    deps: 'core/node_modules',
    installDoc: { from: 'packaging/offline-install.md', as: '安装.md' },
    install: 'dsh plugin --profile web add "file:<解压目录>/dsh-yukkuri-tts"',
  },
];

/** 暂存树里绝不该出现的东西（离线树的 node_modules 是唯一例外）。 */
const FORBIDDEN = [
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])dist([/\\]|$)/,
  /(^|[/\\])sdk([/\\]|$)/,
  /(^|[/\\])_src([/\\]|$)/,
  /(^|[/\\])\.e2e-tmp([/\\]|$)/,
  /(^|[/\\])\.tmp-/,
  /(^|[/\\])package-lock\.json$/,
  /\.(lnk|zip|tgz|log)$/i,
  /(^|[/\\])_[^/\\]*([/\\]|$)/, // 任何下划线开头的临时文件/目录（_src / _t / _*.wav …）
  /(^|[/\\])output(-core|-num)?([/\\]|\.wav)/,
];

function parseArgs(argv) {
  const out = { only: null, deps: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--no-deps') out.deps = false;
    else if (a === '--only') out.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--only=')) out.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error('不认识的参数: ' + a + '（可用：--only <id前缀,...> / --no-deps）');
  }
  return out;
}

/**
 * 手写递归删除，不用 fs.rmSync。
 * 本机环境里 rmSync(recursive) 会**静默失败**：不抛错、也不删（实测目录原样留着）。
 * 用它清理暂存目录会让上一次的旧文件混进新清单，所以逐文件 unlink + 自底向上 rmdir。
 */
function removeDir(abs) {
  if (!fs.existsSync(abs)) return;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, ent.name);
    if (ent.isDirectory()) removeDir(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(abs);
}

/** 只允许删 dist/ 里自己的暂存目录，别的一律不碰。 */
function resetDir(abs) {
  const rel = path.relative(DIST, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('拒绝清理 dist/ 之外的路径: ' + abs);
  }
  removeDir(abs);
  fs.mkdirSync(abs, { recursive: true });
}

function walk(abs, base, out) {
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, ent.name);
    if (ent.isDirectory()) walk(p, base, out);
    else if (ent.isFile()) out.push({ rel: path.relative(base, p).split(path.sep).join('/'), abs: p });
  }
  return out;
}

/**
 * 手写递归复制，不用 fs.cpSync。
 * 本机环境里 cpSync(recursive) 会让 node 进程被静默杀掉（退出码 127、无任何输出），
 * 与 AGENTS.md 记的 spawn EPERM 是同一类环境限制 —— 不是代码问题。
 * readdirSync + mkdirSync + copyFileSync 逐文件走，实测正常。
 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, ent.name);
    const b = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(a, b);
    else if (ent.isFile()) fs.copyFileSync(a, b);
  }
}

function copyEntries(channel, dest) {
  const base = path.resolve(REPO, channel.base);
  const files = [];
  for (const entry of channel.entries) {
    const src = path.resolve(base, entry);
    if (!fs.existsSync(src)) throw new Error(channel.id + ': 缺少 ' + entry);
    const target = path.join(dest, entry);
    if (fs.statSync(src).isDirectory()) {
      copyDir(src, target);
      walk(target, dest, files);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(src, target);
      files.push({ rel: entry.split(path.sep).join('/'), abs: target });
    }
  }
  return files;
}

function audit(channel, files) {
  const allowDeps = channel.id === 'offline';
  const bad = [];
  for (const f of files) {
    const isDeps = f.rel.startsWith('node_modules/');
    if (isDeps && allowDeps) continue;
    if (FORBIDDEN.some((re) => re.test(f.rel))) bad.push(f.rel);
    if (f.rel.endsWith('.wav') && !f.rel.startsWith('output-chars/')) bad.push(f.rel);
  }
  if (bad.length) {
    throw new Error(channel.id + ': 暂存树里混进了不该分发的文件\n  ' + bad.slice(0, 20).join('\n  '));
  }
}

function bytesOf(files) {
  return files.reduce((n, f) => n + fs.statSync(f.abs).size, 0);
}

function kb(n) {
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const picked = CHANNELS.filter((c) => !args.only || args.only.some((p) => c.id.startsWith(p)));
  if (!picked.length) throw new Error('--only 没匹配到任何通道: ' + args.only.join(','));

  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(path.join(DIST, 'manifests'), { recursive: true });

  const rows = [];
  for (const channel of picked) {
    const dest = path.join(DIST, channel.dir);
    resetDir(dest);
    const files = copyEntries(channel, dest);

    if (channel.deps && args.deps) {
      const src = path.resolve(REPO, channel.deps);
      if (!fs.existsSync(src)) {
        throw new Error(channel.id + ': 找不到预装依赖 ' + channel.deps + '（先在 core/ 跑 npm install --ignore-scripts，或加 --no-deps）');
      }
      copyDir(src, path.join(dest, 'node_modules'));
      walk(path.join(dest, 'node_modules'), dest, files);
    }

    if (channel.installDoc) {
      const src = path.resolve(REPO, channel.installDoc.from);
      fs.copyFileSync(src, path.join(dest, channel.installDoc.as));
      files.push({ rel: channel.installDoc.as, abs: path.join(dest, channel.installDoc.as) });
    }

    audit(channel, files);
    files.sort((a, b) => a.rel.localeCompare(b.rel));

    const total = bytesOf(files);
    const manifest = files.map((f) => kb(fs.statSync(f.abs).size).padStart(9) + '  ' + f.rel).join('\n');
    fs.writeFileSync(
      path.join(DIST, 'manifests', channel.id + '.txt'),
      '# ' + channel.title + '\n# ' + files.length + ' 文件 / ' + kb(total) + '\n\n' + manifest + '\n',
    );
    rows.push({ channel, count: files.length, total });
    console.log('✓ ' + channel.id.padEnd(12) + String(files.length).padStart(5) + ' 文件  ' + kb(total).padStart(9) + '  dist/' + channel.dir);
  }

  const lines = [
    '# 极简打包清单（暂存，未压缩）',
    '# 生成: node packaging/pack.cjs' + (args.deps ? '' : ' --no-deps'),
    '# 逐文件明细见 manifests/<通道>.txt',
    '',
  ];
  for (const r of rows) {
    lines.push(r.channel.title);
    lines.push('  位置   dist/' + r.channel.dir);
    lines.push('  内容   ' + r.count + ' 文件 / ' + kb(r.total));
    lines.push('  装法   ' + r.channel.install);
    lines.push('');
  }
  lines.push('本地目录通道不产产物：dsh plugin --profile web add "file:<仓库根>"');
  lines.push('');
  lines.push('压缩（zip / tgz）与发布是后续独立步骤，本清单只代表暂存内容。');
  fs.writeFileSync(path.join(DIST, 'MANIFEST.txt'), lines.join('\n') + '\n');
  console.log('\n清单: dist/MANIFEST.txt（明细 dist/manifests/*.txt）');
}

main();