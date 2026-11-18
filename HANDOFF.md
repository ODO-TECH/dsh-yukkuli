# 交接说明：dsh-yukkuri-tts（油库里朗读插件）

> 写给接手优化的你（人或 agent）。读完这一份就能开始改。
> 配套文档：用法看 [`plugin/README.md`](plugin/README.md)，来历看 [`WORKLOG.md`](WORKLOG.md)，
> 自动执行的硬规矩看 [`AGENTS.md`](AGENTS.md)，合成核心看 [`core/README.md`](core/README.md)。

**版本**：插件 0.3.0 / core 1.1.0 　**快照时间**：2026-11-17 　**验证环境**：Windows 10 19041 / Node v24.13.0 / DSH 0.2.2-rc.1
**许可**：MIT 　**发布形态**：**一个 npm 包** `dsh-yukkuri-tts`（core 随包分发，不单独发）；`github:` 通道装的是同一份仓库根清单
**仓库**：https://github.com/ODO-TECH/dsh-yukkuli（仓库名与 npm 包名**不一致**：仓库叫 dsh-yukkuli，包叫 dsh-yukkuri-tts）

---

## 1. 现在是什么状态

**能跑，测试全绿，路径已可移植；四条安装通道都验过；已合并成单个可发布的 npm 包（但还没真发过）。**

| 项 | 实测结果 |
|---|---|
| 插件测试 | 23 个文件 / **111 例全通过**（逐文件直跑，`YUKKURI_MUTE=1`） |
| core 测试 | 14 个文件 / **84 例全通过** |
| 真实合成 | `synthe('今天天气不错', {voice:'cirno'})` → **70368 字节 WAV**，SDK 正常 |
| 端到端 | 会话结束一轮 → 合成 → `/pending` → 浏览器 `<audio>` 响，已通 |
| 可移植性 | 源码内**零写死盘符路径**（有测试锁）；core 三层解析；SDK 默认 `~/yukkuri-sdk` |
| 安装通道 | 本地目录 / GitHub / npm / 离线包 **四条都验证过**（§8.5） |
| 已知阻塞 | `npm test` 在受限环境不可用（§5.2）；`dsh plugin add` 在受限环境跑不了 pnpm（§8.5 坑 15）；**npm 决定不发**（2026-11-18，免 npm 三路已落地，见 §6）；git push 需内联系统代理 `127.0.0.1:7890`（git 不继承 WinINET） |

一句话：**功能完整，工程化补上了「装得走」这一段。** 下一步的重点是发版流程与 CI，不是加功能。

---

## 2. 目录地图

```
油库里语音/
├── package.json            ← **唯一对外发布的清单**（npm 与 github: 通道都用它）
├── plugin/                 ← DSH 插件（本次交付主体）
│   ├── package.json        0.3.0，ESM，**private**：开发清单，只为跑测试
│   ├── cordis.patch.yml    4 行，把插件挂进 DSH 的 bundle
│   ├── lib/index.js        宿主半边：路由 + 命令 + 轮次幂等 + 段队列
│   ├── lib/client.js       Web 客户端：播放器 + 设置页 + 单例
│   ├── lib/core-path.cjs   定位 core 的三层解析（env → 兄弟目录 → node_modules）
│   ├── lib/watch.cjs       事件游标：从会话事件里挑出「说完一整轮」
│   ├── lib/pipeline.cjs    文本 → extract → segment → synth
│   ├── lib/poller.cjs      自带 setInterval 的轮询器
│   ├── lib/player-tui.cjs  TUI：临时 WAV → spawn mpv（PATH 里找） → 播完删
│   ├── test/               23 个 .test.cjs，111 例
│   └── README.md           用法文档
├── core/                   ← 合成核心 yukkuri-core（CommonJS）
│   ├── package.json        1.1.0，**private**：不单独发 npm，作用是声明 type=commonjs
│   ├── src/index.js        synthe / warmup / configure / 缓存（500 段 LRU）
│   ├── src/config.js       SDK 路径（默认 ~/yukkuri-sdk）+ 许可证密钥解析
│   ├── src/engine/         local.js（直调 DLL） / remote.js
│   ├── src/codec/          aqk2k.js（汉字→假名） / aqtk1.js（WASM） / aqtk2.js
│   ├── src/text/           extract.js（剥 Markdown） / segment.js（按假名切段）
│   ├── src/                numbers.js / zh2jp.js / presets.js / characters.js / cache.js / wav.js
│   ├── test/               14 个 .test.js，84 例
│   └── README.md           接口、角色表、两个大坑
├── output-chars/           6 个角色的试听样音（cirno/tenshi/patchouli/marisa/reimu/patchouli_bass）
│                           ← §4.2 里每个调音决定的**听感证据**；由 `core/demo-chars.cjs` 生成
├── PLAN-tts-plugin.md      当初的方案稿（含合成上限实测）—— 历史材料
├── 报告.md                 为什么不能用官网 API 的调研 —— 历史材料
├── 角色音色对照.md         早期 7 角色草案（含后来停用的蕾米莉亚等）—— 历史材料
├── 工具/                   早期原型（mapping.tsv + yukkuri-tts.cjs），**别动，历史留存**
├── sdk/                    本机的 AquesTalk 副本（**不进交付包**，见 §7）
├── _src/                   上游参考资料（AquesPy、PDF 手册），**别动**
└── zh-yukuuri-main/        社区项目参考实现，**别动**
```

**能改的**：`plugin/`、`core/`、根目录四份 md。
**别动的**：`工具/`、`_src/`、`zh-yukuuri-main/`、`sdk/`，以及根目录三份历史 md
（`PLAN-tts-plugin.md` / `报告.md` / `角色音色对照.md`）—— 都是历史/参考材料，改动只会增加噪音。

---

## 2.5 解包后第一件事：装依赖

交接 zip 里**没有 `node_modules`**（两边合计 33 MB，都能由 lockfile 重建）。所以刚解包时
测试是跑不起来的 —— 会看到：

```
Error: Cannot find module 'react'            ← plugin/test（5 个文件要它渲染组件）
[油库里] 整轮合成失败: Cannot find module 'pinyin-pro'   ← deliver-once.test（它会真跑一次合成）
```

**装完就全绿**（已实测：解包 → 安装 → 插件 23 文件 / 111 例 + core 14 文件 / 84 例全通过，
且真实合成出 70368 字节 WAV）。

```powershell
cd plugin; npm install; cd ..     # react / react-dom（只是测试要）
cd core;   npm install; cd ..     # koffi / pinyin-pro / pinyin-to-kana / aquestalk.js / v86
```

`core` 的依赖较多（420 个包 / 28 MB），它是真正干活的那些。
`plugin` 的 `node_modules` 只有 react + react-dom + 3 个传递依赖（86 文件 / 4.9 MB）。

### 在受限沙箱里 `core` 要加 `--ignore-scripts`

```powershell
cd core; npm install --ignore-scripts; cd ..
```

原因：`koffi` 带一个 `install` 脚本（`node ./cnoke.cjs --prebuild --release`），
它会 **spawn 子进程编译原生模块**，在禁止 spawn 的环境里报 `EPERM / errno -4048 / syscall: spawn`。

**跳过它是安全的**：koffi 的真身二进制来自可选依赖 `@koromix/koffi-win32-x64`
（实测 `koffi.node` 1060352 字节，由 npm 正常下载，跟 build script 无关），
`--ignore-scripts` 之后 `require('koffi')` 正常、真实合成也出得来。
普通机器上没有这个限制，直接 `npm install` 就行。

> 如果你只关心"环境是否就位"，可以先只跑**不需要 SDK 也不需要 react** 的那 7 个 core 测试：
> `cache` / `extract` / `numbers` / `pitch` / `remote-contract` / `segment` / `zh2jp`。
> 但它们仍然要 `core/node_modules`（`extract` 依赖 pinyin 那一族）。

---

## 3. 运行前提（缺一条就跑不起来）

这些**都在项目树之外**，交接时必须重新交代：

| 依赖 | 位置 | 用途 | 缺了会怎样 |
|---|---|---|---|
| AquesTalk SDK | 默认 `~/yukkuri-sdk`，可用 `YUKKURI_SDK_ROOT` 改 | 合成引擎 | 所有朗读失败，报 Create 失败 |
| mpv | `PATH` 里的 `mpv`，可用 `YUKKURI_MPV` 改 | 仅 TUI 播放 | Web 端无影响，TUI 静音 |
| `core/node_modules` | 项目内，已装 28.2 MB | koffi / pinyin-pro / aquestalk.js / v86 | core 直接 require 失败 |
| `plugin/node_modules` | 项目内，已装 4.9 MB | 仅测试用 react/react-dom | 客户端测试跑不了 |

**SDK 路径必须是纯 ASCII。** 这条是硬约束，不是建议 —— AqKanji2Koe 用 ANSI 读词典路径：

```
YUKKURI_SDK_ROOT=D:\Users Data\Desktop\油库里语音\sdk  →  失败
  AqKanji2Koe_Create 失敗: システム辞書(aqdic.bin)が不正、または辞書パスの文字コード不正

YUKKURI_SDK_ROOT=D:\Documents\yukkuri-sdk            →  成功，70368 字节 WAV
```

而这台机器的仓库路径 `D:\Users Data\Desktop\油库里语音` **就是含中文的** ——
所以 `sdk/` 只能当参考副本，真正跑的是 `D:\Documents\yukkuri-sdk`。
迁移到别的机器时，**把 SDK 放在一个纯英文路径下**，别放进项目目录。

> 代码里的默认值已经是 `~/yukkuri-sdk` 了（不再写死某台机器的盘符）。
> 本机现状是 SDK 在 `D:\Documents\yukkuri-sdk`，所以要**显式设一次**：
>
> ```powershell
> setx YUKKURI_SDK_ROOT "D:\Documents\yukkuri-sdk"
> ```
>
> 设完要新开一个终端 / 重启 DSH 才生效。

---

## 4. 数据流

```
DSH 会话事件
   │  （turn/end + reason.kind === 'completed'）
   ▼
watch.cjs ── 维护每个会话的 seq 游标；首次见到的会话只建基线、不回放
   │  取出 block.type === 'text' 的内容
   ▼
pipeline.cjs
   ├─ extract()  剥掉代码块 / 表格 / 行内代码 / 链接 / 路径 / URL / 表情
   ├─ segment()  按假名长度切段（默认 100，上限 80 更安全）
   └─ synth()    逐段调 core（单段失败只跳过，不毁整轮）
   ▼
core.synthe(text, {voice, emotion})   ← 内存 LRU 缓存 500 段
   │  汉字 →（pinyin-pro + pinyin-to-kana）→ 假名 →（AqKanji2Koe）→ 音素 →（AquesTalk）→ WAV
   ▼
globalThis.__yukkuriStore.segments    ← 段表 + id 计数器（**故意挂 globalThis**）
   │
   ├─ Web：GET /dsh-yukkuri/pending?after=<id>  一次性投递 → 浏览器 <audio>
   └─ TUI：player-tui.cjs → 临时 WAV → spawn mpv → 播完 unlink
```

**三条容易被忽略的分支**：

- **手动念一条**（点 ▶ / `/yukkuri say`）带的段是 `broadcast: false`，`/pending` 会跳过它 ——
  否则会和自动轮询撞车，同一句响两遍。
- **播放被浏览器拒绝**（`NotAllowedError`）时客户端 `POST /release` 把 id 还回去。
  但 `AbortError`（自己换 src 打断自己）**不能还** —— 那段其实已经播了，还回去就变念两遍。
- **TUI 没有 webServer**，所以 TUI 下 `/audio?id=` 无意义，走 mpv 那条路。

### 4.2 音色是怎么定下来的（`output-chars/` 里那 6 个 wav 的来历）

角色 → 引擎 / 预设的对照表在 [`core/docs/角色音色对照.md`](core/docs/角色音色对照.md)，
但**这张表是逐轮试听调出来的**，每个格子背后都对应 `output-chars/<id>.wav` 那一次试听。
所以那 6 个样音不是运行产物，是**决策证据** —— 交接包里特意保留了它们（合计 531 kB）：

| 文件 | 定下了什么 |
|---|---|
| `cirno.wav` | AQTK10 的 F3 预设 + `fsc=148`（这组的采样率是 23680Hz，不是 16000） |
| `tenshi.wav` | AQTK1 走 v86 WASM 是可行的 —— 真 AQTK1 音色，不是模拟腔 |
| `patchouli.wav` | 「音高一点点 + 语速一点点」的折算：采样率 ×1.04、speed 92 |
| `marisa.wav` / `reimu.wav` | AQTK10 的 F2 / F1 预设原样使用 |
| `patchouli_bass.wav` | AQTK1 的 r1 预设 |

重新生成：`cd core; node demo-chars.cjs`（**需要 SDK 就位**，否则一条都出不来）。
想再调音色，先听这几个基线，别在没有基线的情况下改参数 —— 耳朵记不住"上一版"。

---

## 5. 七条硬约束（改之前必须先知道）

这几条都是**撞出来的**，不是设计洁癖。踩回去的代价是"看起来正常但完全不工作"。

### 5.1 `export const inject` 里不能出现 `webServer` / `sessionTitle`

```js
export const inject = ['sessions'];   // ← 就这一个，别加
```

TUI 端没有 `webServer` 服务。把它声明成硬依赖，插件在 TUI 里会**整个拒绝加载**
（不是降级，是不加载）。`webServer` / `sessionTitle` 全部走 `ctx.inject([...])` 软获取。
测试里有专门一条锁这个。

### 5.2 不能用 `ctx.interval`

Cordis 的 `ctx` 是代理对象，没 inject `timer` 就读 `ctx.interval` 会抛：

```
cannot get property "timer" without inject
```

**症状很阴**：日志显示"已加载"，但轮询根本没启动 —— 界面一切正常，就是不朗读。
现在 `poller.cjs` 自带 `setInterval` + `.unref()`。

### 5.3 幂等表和段表必须挂 `globalThis`

```js
globalThis.__yukkuriSeenTurns   // 轮次幂等（容量 500）
globalThis.__yukkuriStore       // 段表 + id 计数器
globalThis.__yukkuriStats       // 诊断计数
globalThis.__yukkuriHost        // 旧实例停轮询的把手
```

插件会被**多次 `apply`**（热重载、多次注入）。闭包各持一份的后果是：同一轮 `onTurn`
跑 N 次，合成出 N 套 **id 各不相同**的段，每套各被投递一次 ——
同一句话依次响 N 遍，按暂停只能停住当前那个。

**这不是理论风险**，是真发生过：长文本触发 5 次、停掉 4 个还剩 1 个。
把这三样挪回闭包 = 重新打开那个 bug。详见 `plugin/README.md` 的「一次性投递四版演进」。

### 5.4 客户端必须单例

`player` / `leader` / `autoplay` 全挂 `window.__dshYukkuri`，后来者复用。
脚本被重复加载时各建一份播放器，结果是同一段音频播好几遍、多个 `<audio>` 同时响。

### 5.5 手动朗读的段必须 `broadcast: false`

两者共用广播队列的后果：点一次 ▶ 念两遍（自己播一次 + 轮询又拉一次），
按暂停后又被拉回来，感觉「停不掉」。

### 5.6 `package.json` 不许带 BOM

DSH 用 `JSON.parse` 读插件包的 `package.json`。开头有 UTF-8 BOM 时它会**整包跳过**：

```
dsh: skipping profile bundle "dsh-yukkuri-tts": SyntaxError: Unexpected token '﻿'
```

插件根本没被加载 —— 没有路由、没有轮询、设置页里也找不到「油库里」，
而**所有文件看上去都正常**。2026-11-17 用 PowerShell `Set-Content -Encoding utf8`
改版本号就撞了，用户连着重启两次都没声音。

### 5.7 命令 handler 必须返回 `CommandResult`

`{kind:'success',text?}` 或 `{kind:'error',text}`。返回裸字符串时 TUI 报
`command "yukkuri" handler must return a CommandResult`，**命令体一条都不执行**。
做法：逻辑放 `runCommand()`，成功返回字符串、失败返回 `fail(msg)`，注册的 handler 只做包装。

---

## 6. 优化候选（按优先级，带证据）

> **2026-11-17 更新**：下面标 ✅ 的四项已经在这次交接前做完了，留着是为了说清
> 「当时为什么必须改」。剩下的才是真待办。

### ✅ P0 — 可移植性：三处硬编码绝对路径（已完成）

当年这三条：

| 文件:行 | 内容 |
|---|---|
| `plugin/lib/index.js:168` | `corePath = 'D:/Users Data/Desktop/油库里语音/core/src'` |
| `plugin/lib/player-tui.cjs:18` | `DEFAULT_MPV = 'D:\\Software\\Tools\\MPV Player\\mpv.exe'` |
| `core/src/config.js:9` | `SDK_ROOT = ... \|\| 'D:\\Documents\\yukkuri-sdk'` |

当时的解析链是 `YUKKURI_CORE_PATH` → `../../core/src` → 硬编码兜底。装进 profile 之后，
第二条会从 `node_modules/dsh-yukkuri-tts/lib/` 出发解析到
`<profile>/node_modules/core/src`（**不存在**），于是**运行中实际全靠第三条硬编码撑着**。

**现在**：新增 `plugin/lib/core-path.cjs` 做三层解析（env → 兄弟目录 → `require.resolve('yukkuri-core')`），
第四层兜底换成**带候选清单的报错**；`DEFAULT_MPV = 'mpv'` 走 PATH；
SDK 默认 `~/yukkuri-sdk`。`test/no-hardcoded-paths.test.cjs` 扫 `plugin/lib` 与 `core/src`
锁住这件事（连注释一起扫）。

### P0 — 测试入口不可用（**仍未解决**）

`npm test` = `node --test --test-concurrency=1`，在本环境**整批失败**（23/23 fail）：

```
Error: spawn EPERM
  errno: -4048, code: 'EPERM', syscall: 'spawn'
```

根因是沙箱禁止 spawn 子进程 —— 连 `execFileSync(process.execPath, ['-e','console.log(1)'])`
都报 `spawn FAILED: EPERM`。`--test-isolation=none` 能绕过，但 4 个用例会互相污染
（`release` / `host` / `turn-once` 都在改 `globalThis` 共享状态）。

**建议**：加一个 `test:run` 脚本（`Get-ChildItem test\*.test.cjs | % { node $_.FullName }`
的跨平台等价物），把"逐文件直跑"固化成唯一入口，并让 CI 用它。
别去改测试内容来绕开 spawn —— 那样会掩盖真实的多实例串味问题。

### P1 — `package-lock.json` 版本漂移（**会自己好，但别手改**）

`plugin/` 与 `core/` 两份**开发清单**的 lockfile 根节点版本号会滞后于 `package.json`（这次改到 0.3.0 / 1.1.0 之后又出现了）。它们都不进发布包。

**交接时实测：跑一次 `npm install` 它就完全自愈了。**

所以这一项**不需要手工修**：在干净目录跑一次 `npm install`，把结果提交即可。
**但绝对不要手改 lockfile** —— 手改比留着漂移危险得多。

### ✅ P1 — `pipeline.cjs` 的默认 require 路径（已完成）

原来写的是 `require('../../core/src/text/extract')`，相对 `plugin/lib/` 解析到
`plugin/core/src`（不存在）—— 只在源码仓库里恰好能跑，装进 `node_modules` 就断。

**现在**走 `requireCore('text/extract')`，和插件入口同一套解析。

### ✅ P1 — `core/package.json` 的 `main` 指向不存在的文件（已完成）

原来是 `"main": "index.js"`，但 `core/index.js` **不存在**，真入口是 `core/src/index.js`：

```
require('./')            → MODULE_NOT_FOUND
require('./src')         → OK，导出 12 个成员
```

**现在**是 `"main": "src/index.js"`，所以 `require('yukkuri-core')` 是通的
（npm 布局的解析靠这条）。

### P2 — 工程化缺口

- `lib/client.js` 691 行单文件（内联 CSS + React 组件 + 播放器 + 选主），可拆
- core 的缓存是 500 段**全量 WAV buffer** 的 LRU，内存上限没实测过
- **没有端到端冒烟**：所有测试都用假 ctx，没有一条"起真 DSH → 装插件 → 发一轮 → 取 `/pending`"
- **没有 CI**：`.github/workflows` 空着。测试入口若固化成 `test:run`，接 CI 就一步的事

### P3 — 没有版本控制

整个仓库**没有 `.git`**。`.gitignore` 和 `LICENSE` 这次已经写好了，
但 `git init` 还得你自己来（交接时没动，见 §10）。

### 已决定不发 npm（2026-11-18 用户拍板）——免 npm 分发已落地

**只存在一个可发布包**：仓库根 `package.json`（`dsh-yukkuri-tts` 0.3.0）。core 随包分发，
`plugin/package.json` 与 `core/package.json` 都标了 `private: true`，是开发期清单，
**任何时候别把它们发出去**（plugin 那份与根包同名，发出去会互相覆盖）。

根清单仍是可发布形态（`files` 白名单、`license: MIT`、`main: plugin/lib/index.js`、
`engines.node >= 22`、`repository` / `homepage` / `bugs` 齐备），实测 `npm pack --dry-run` =
**35 文件**。但用户决定不走 npm（「太麻烦了」），改走三条免 npm 的路，**都已落地**：

1. **git 源市场索引**：`market/index.json` + GitHub Pages，
   `https://odo-tech.github.io/dsh-yukkuli/market/index.json`（实测 200 / 零重定向）
2. **Release 资产**：`v0.3.0/dsh-yukkuri-tts-0.3.0.tgz`（74052 B），awesome 条目的 `tarball:` 指它
3. **awesome 收录 PR**：[#16451](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16451)

tarball 与离线 zip 留作免 npm / 离线安装用；装法见 `packaging/offline-install.md` 与根 README。

---

## 7. 本机已安装状态（必读）

接手时最容易踩的误解：**"我改了源码为什么没生效"**。

`D:\Documents\.dsh\profiles\web\package.json`：

```json
"dependencies": {
  "dsh-yukkuri-tts": "file:D:/Users Data/Desktop/油库里语音/plugin"
},
"dsh": { "profile": { "bundles": [ "…", "dsh-yukkuri-tts" ] } }
```

`profiles\web\node_modules\dsh-yukkuri-tts` 是一个**实体目录**（`LinkType` 为空，不是 junction）。

**注意：这台机器上 profile 里装的还是 2026-11-14 那版快照（0.2.2）**，本次交付的
0.3.0 还没装进去 —— 所以现在运行中的插件仍是带硬编码路径的旧版本。
要让新版生效，跑下面那条命令再重启（新版 23 个测试文件，旧快照只有 17 个，
可以拿来判断装没装新）。

**结论：改源码不会自动生效，必须重装 + 重启 DSH。**

```powershell
dsh plugin --profile web add "file:D:/Users Data/Desktop/油库里语音"
# 然后重启 dsh web
```

> 装**仓库根**，不是 `/plugin`：合并成单包后，运行依赖（koffi / pinyin-pro / …）声明在
> 根清单里，`plugin/package.json` 只是开发清单。上面那份 profile 快照是合并前从
> `/plugin` 装的，重装时换成根路径。

运行时配置在 `D:\Documents\.dsh\yukkuri-tts.json`
（当前 `enabled: true`、`voice: "cirno"`、`emotion: "neutral"`、`maxKana: 100`、
`intervalMs: 1500`、`keepSegments: 40`、监听 2 个会话）。

> 本次**没有**重装 profile —— 重装会重启插件、打断正在运行的会话。
> 你改完代码自己跑上面那条即可。

---

## 8. 复现命令

```powershell
# 进项目
cd "D:\Users Data\Desktop\油库里语音"

# 插件测试（唯一可靠入口：逐文件）
cd plugin; Get-ChildItem test\*.test.cjs | ForEach-Object { node $_.FullName }; cd ..

# core 测试
cd core; Get-ChildItem test\*.test.js | ForEach-Object { node $_.FullName }; cd ..

# 真实合成冒烟（需要 SDK，且 SDK 路径是纯 ASCII）
cd core; node -e "require('./src').synthe('今天天气不错',{voice:'cirno'}).then(b=>console.log('WAV',b.length))"; cd ..

# 出样本音频（8 个）
cd core; node demo.cjs; cd ..

# 检查 SDK 是否就位
cd core; node -e "console.log(JSON.stringify(require('./src/config').describe(),null,2))"; cd ..

# 打包（注意三处：dist 必须先建、cache 必须改到盘内、要用 npm-cli.js 而不是 npm.cmd）
New-Item -ItemType Directory -Force dist | Out-Null
$env:npm_config_cache = "D:\Users Data\Desktop\油库里语音\.npm-cache"
cd plugin
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" pack --pack-destination "D:\Users Data\Desktop\油库里语音\dist"
cd ..
```

> `synthe()` 返回 **Promise**（`core.README` 里写作同步返回，是文档滞后了 ——
> 实际 `isPromise: true`，`await` 后得到 `Buffer`）。改文档或改实现，二选一但别两头都不动。

---

## 8.5 分发通道（四条，各自怎么装、怎么验）

包不是只有一种装法。四条通道装的是同一个东西，区别在「包从哪来、依赖谁装」：

| 通道 | 命令 | 包从哪来 | 依赖谁装 | 验证方式 |
|---|---|---|---|---|
| 本地目录 | `dsh plugin --profile web add "file:<仓库根>"` | 磁盘上的仓库 | pnpm | 软链接，`files` 不生效 |
| GitHub | `add github:ODO-TECH/dsh-yukkuli` | 仓库根 `package.json` | pnpm | `npm pack` 根包 → 解到 `node_modules/` 再加载 |
| npm | **未发布**（2026-11-18 决策不发）；`add dsh-yukkuri-tts` 只有将来真发了才可用 | registry（仓库根清单） | pnpm | 暂存树 `npm pack --dry-run` + 加载 + 真合成 |
| DSH 市场索引 | 「发现」页添加索引源 `https://odo-tech.github.io/dsh-yukkuli/market/index.json` | `market/index.json`（git 源）→ GitHub Pages | pnpm（git spec） | 官方校验器 parseMarketIndex + 线上 200 / 零重定向 |
| 离线包 | 解压 → `add "file:<解压目录>/dsh-yukkuri-tts"` | 本地 zip（自带 `node_modules`） | 包里已装好 | 清单核对 + 加载 + 真合成 |

**为什么仓库根要有一个 `package.json`**：`github:` 通道和插件索引扫描都从仓库根读清单，
**npm 通道发的也是它**。它声明了 `dsh.bundle.patch`（指向 `plugin/cordis.patch.yml`）、
`dsh.client`、`files` 白名单、`exports`，以及 core 的四个运行依赖 —— 所以
**core 随包分发，用户只装一个包**，`plugin/` 与 `core/` 那两份清单是 `private` 的开发清单。

**合并后的形态已实测**（在 `dist/offline/dsh-yukkuri-tts/` 里跑，等价于装进 `node_modules`）：
`require(core/src)` 12 个成员（CommonJS 边界没被根包的 `type: module` 吃掉）、
core 解析 `source='sibling'`、`inject=["sessions"]`、cirno 70368 字节（koffi）与
tenshi 27076 字节（v86）都出得来、整链 `deliver=web` 且 `/audio` 返回 141368 字节 RIFF。

**装完怎么确认层生效**（这条比「命令没报错」可靠）：

```powershell
dsh --profile web --dump-config | Select-String yukkuri -Context 0,1
# 应当看到：
#   # == dsh-yukkuri-tts
#   - id: yukkuri-tts
#     name: dsh-yukkuri-tts
```

### 坑 15（本轮新增）：`dsh plugin add` 在受限环境跑不了 pnpm

```
Error: ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK
  ╰─▶ Failed to open the store operation lock at "…\pnpm-store-operation-locks\all-stores.lock": 拒绝访问。 (os error 5)
```

pnpm 10+ 的**全局**操作锁目录由真实用户目录决定，`--store-dir` 和 `LOCALAPPDATA` 都改不动它。
受限环境（沙箱）不允许写那里 → 整个 `add` 直接失败，**与包本身无关**。
同理，`github:` 通道在离线沙箱里也跑不了（要真去 clone）。

**绕法**（本轮就是这么验的）：把包手工解到 `<profile>/node_modules/<包名>/`，在 profile 的
`package.json` 里补 `dependencies` 与 `dsh.profile.bundles`，再跑 `--dump-config` —— 验的正是
「DSH 能不能读出并应用我们的 patch」，也就是这一轮真正关心的事。

### 坑 14（本轮新增，只有真装一遍才会暴露）：根包的 `type: "module"` 会吃掉 core 的 CommonJS

`core/src/*.js` 用 `require`，而它们所在包的根 `package.json` 写了 `"type": "module"`（为了让
`plugin/lib/index.js` 的 ESM `import` 能跑）。Node 按**最近的 `package.json`** 决定模块类型 →
core 的 `.js` 全被当成 ESM，加载时直接 `ReferenceError: require is not defined in ES module scope`。

修法：把 `core/package.json`（内含 `"type": "commonjs"`）加进根包的 `files` 白名单。
**改 `files` 时别把它删了** —— 仓库里的测试永远从源码目录跑，碰不到 `node_modules/` 那条路径，
所以只有把产物真装进 profile 才会暴露。

---

## 9. 交接清单与 dist 布局

`dist/` 由 [`packaging/pack.cjs`](packaging/pack.cjs) 生成，按**分发通道**分目录：

```bash
node packaging/pack.cjs                 # 三条通道全出
node packaging/pack.cjs --only npm      # 只出某条（前缀匹配，逗号分隔）
node packaging/pack.cjs --no-deps       # 离线树不带 node_modules（快速看清单）
```

脚本**只暂存、不压缩、不发布、不联网**，并带一道审计：`node_modules`（离线除外）、
`sdk/`、`_src/`、lockfile、`.lnk` / `.zip` / `.tgz`、临时 wav、任何 `_` 开头的路径
混进暂存树就当场报错。zip / tgz 与 `npm publish` 都是独立步骤，要人拍板。

**三个通道目录是暂存树**；tarball / zip 已按用户授权出好，仓库树也已 push（见下面 `git-push/`）：

```
dist/
├── npm/
│   └── dsh-yukkuri-tts/        35 文件 / 189 kB   ← npm pack 的输入（core 在里面）
├── github/
│   └── repo/                   93 文件 / 949 kB   ← 要 push 的干净仓库树
├── offline/
│   └── dsh-yukkuri-tts/       456 文件 / 27.1 MB  ← 运行树 + 预装 node_modules + 安装.md
├── tarballs/
│   └── dsh-yukkuri-tts-0.3.0.tgz       74.1 kB   ← 免 npm 分发 / v0.3.0 Release 资产（人工跑 npm pack 出）
├── zip/
│   └── dsh-yukkuri-tts-offline-0.3.0.zip  7.16 MB ← 离线分发（人工跑 bsdtar 出）
├── git-push/
│   └── dsh-yukkuli/            repo/ 的拷贝 + .git ← **已 push**：main @ 54f43cc + tag v0.3.0（停在 0ac3255）
├── manifests/                 逐文件明细（每通道一份）
└── MANIFEST.txt               汇总：位置 / 文件数 / 体积 / 装法
```

> `pack.cjs` 只生成前三个通道目录。`tarballs/` / `zip/` / `git-push/` 是**人工步骤**：
> `npm pack --pack-destination` 出 tarball；zip 必须用 `/c/Windows/System32/tar.exe -caf`
> （Git Bash 的 GNU tar 1.35 不会做 zip）；`git-push/` 是 `github/repo/` 的**拷贝**再 `git init` ——
> 别在通道目录里放 `.git`，`pack.cjs` 重跑会把通道目录整个清掉。

| 通道 | 产物 | 极简到什么程度 |
|---|---|---|
| npm | `dist/npm/dsh-yukkuri-tts/` | 只有运行文件 + README + LICENSE；`test/`、`docs/`、`demo*.cjs`、lockfile 都不进 |
| GitHub | `dist/github/repo/` | 源码 + 测试 + 文档 + 上架物料 + 样音；`node_modules`、`sdk/`、`_src/`、`工具/`、临时 wav、`.lnk`、lockfile 都不进 |
| 离线 | `dist/offline/dsh-yukkuri-tts/` | 与 `github:` 通道**装进 node_modules 的那 35 文件**一致，外加预装依赖与 `安装.md` |
| 本地目录 | 无产物 | 直接用工作树 |

核对真实清单用 `npm pack --dry-run`（不写 tarball）。合并成单包后实测 **35 文件**（解包 193.9 kB），
与 `dist/npm/dsh-yukkuri-tts/` 暂存树逐一对上（合并前是插件 11 + core 22 两个包）。

> **为什么是 35 而不是 31**：npm 把 README / LICENSE 当「always included」，`files` 白名单
> 删不掉，连 `!plugin/README.md` 这种否定写法也压不住（实测）。多出来的 4 个就是
> `plugin/README.md`、`plugin/LICENSE`、`core/README.md`、`core/LICENSE`。

> 离线包 27 MB 里 19 MB 是 `v86`：天子 / 帕秋莉 / 低音帕秋莉走 AquesTalk1（官方只发 32 位 DLL），
> 靠 `aquestalk.js` 的 v86 WASM 模拟跑，是必需依赖，不能为了瘦身删掉。

> 上一版那种「离线包只带两个 tgz」的形态是**假离线** —— `npm i *.tgz` 仍要去 registry 拉
> koffi / pinyin-pro。所以离线通道现在只出「预装 node_modules」这一种。


- [x] 用法 [`plugin/README.md`](plugin/README.md)
- [x] 本文 [`HANDOFF.md`](HANDOFF.md)
- [x] 来历 [`WORKLOG.md`](WORKLOG.md)
- [x] 守则 [`AGENTS.md`](AGENTS.md)
- [x] 门面 [`README.md`](README.md) + [`LICENSE`](LICENSE) + [`.gitignore`](.gitignore)
- [x] 仓库根清单 [`package.json`](package.json)（**唯一对外发布的清单**：npm 与 `github:` 通道都靠它）
- [x] 上架物料 [`marketplace/`](marketplace/README.md)（awesome YAML + 收录 Issue + 徽章）
- [x] 离线安装说明 [`packaging/offline-install.md`](packaging/offline-install.md)
- [x] 试听样音 `output-chars/`（6 个 wav，§4.2）
- [ ] **重构前先 `git init`** —— 留给你做的第一件事
- [ ] 给仓库打 `dsh-plugin` topic、提 awesome PR、提交 dsh-plugin.org 收录 —— 都是网页操作，留给仓库主人

> 交接包解压后**先装依赖**再跑测试（§2.5）。不装的话 plugin 有 9 个测试文件会
> `Cannot find module 'react'` / `'pinyin-pro'` —— 那是缺依赖，不是代码坏了。


---

## 10. 这次刻意没做的事

说清楚边界，免得你以为漏了：

1. **一行逻辑代码都没改**。本次是"打包 + 文档"的快照交付，`plugin/lib`、`plugin/test`、
   `core/src`、`core/test` 的 SHA256 与勘察开始时完全一致（见 `dist/SHA256SUMS.txt` 的说明）。
   优化本身交给接手方 —— 那是需要设计决策的工作，混在打包里做会让两边都说不清。
2. **没重装 profile**。会打断正在运行的会话。
3. **没动 lockfile**。见 P1。
4. **没把 SDK 打进交付包**。AquesTalk 二进制受许可证约束，且它在源码树外已有真身。
   交付包里只有对它的**要求描述**，没有它的副本。
5. **没改版本号**。快照交付用 SHA256 指纹表达身份比改版本号更准确 ——
   改版本号会让已安装副本与源目录悄悄分叉。
