# 工作日志：油库里朗读插件

> **这份日志怎么来的**：本仓库**没有 git 历史**（从 `_src/` 到 `plugin/` 都没有 `.git`）。
> 下面的时间线由**文件 mtime + 产物体积 + 测试结果**重建，粒度到半天，
> 只写能从磁盘上验证的事。想不起对话细节的地方就标「推断」，不编。
>
> 想要精确的历史，接手后第一件事该是 `git init`。

**时间范围**：2026-11-12 20:25 → 2026-11-14 12:29（主体建造），2026-11-14 23:15 起（打包交接）
**最终版本**：插件 0.2.2 / core 1.0.0

---

## 一、时间线

### 阶段 0：动机 —— 为什么不用官网 API（11-12 20:25–20:41）

拿到社区项目 `zh-yukuuri`（`zh-yukuuri-main.zip`，11-12 20:25），调研后写成 [`报告.md`](报告.md)。

**结论**：官网 yukumo.net 的语音 API 走不通。

| 尝试 | 结果 |
|---|---|
| `curl` 直连 | HTTP 403 |
| headless Chromium | HTTP 403 |
| 带反检测的 Chromium | HTTP 403 |
| `challenges.cloudflare.com` 域名解析 | 被本机 DNS（`dragon.ntu.edu.cn`）**拒绝解析** |

社区项目 `zh-yukuuri` 的原理是「URL 拼接 + pinyin-to-kana 转假名 + 蹭官网
`/api/v2/{aqtk}/koe.mp3`」—— 本质还是在蹭那台被 Cloudflare 挡住的服务器。

**决策：改走本地链路。**
`pinyin-pro + pinyin-to-kana` → 假名；`kanji2koe-openjtalk` → 音素；
`aquestalk.js / v86` → 波形。全部本地，不联网。

> 这个决策定下了后面全部的形态 —— 也就解释了为什么交付物是"你本机才能跑"的样子。

### 阶段 1：原型与 SDK 打通（11-13 17:49–18:03）

- `工具/` 原型（`mapping.tsv` + `yukkuri-tts.cjs`）—— 早期实验，后面被 core 取代但**保留**
- core 骨架：`kg.js`（许可证密钥生成，AquesPy `kg.py` 的移植）、`codec/`、`engine/remote.js`
- 首批测试（`zh2jp.test.js` 17:54、`engine.test.js` 18:03）

**这一步撞到的第一个坑**：AquesTalk 与 AqKanji2Koe 要**各自** `SetDevKey`。
只解一个的症状是把「なにぬねの」转成「ヌヌヌ'ヌヌ」—— 看起来像编码 bug，其实是密钥问题。

### 阶段 2：方案定型（11-13 20:32）

写 [`PLAN-tts-plugin.md`](PLAN-tts-plugin.md)：对照 `dsh-tts-bridge` 1.3.3 定方案。

**实测出来的关键数字**：

| 输入长度 | 结果 |
|---|---|
| 100 假名 | OK，275 KB WAV |
| 300 假名 | **ERR 122**（合成失败） |
| 200 个短语 | **ERR 122** |

→ **决策：每段 ≤ 80 假名**（留余量）。这个数字直接决定了 `segment.js` 的切分策略。

另一个数字：中文转假名**膨胀约 2.3 倍**（「今天天气不错」6 个汉字 → 约 14 假名）。
所以中文场景下「80 假名」约等于 35 个汉字，切段要按假名算、不能按字数算。

四个当时待拍板的决定，最终都按方案 A 落地：
Web 音频走 HTTP 路由 / TUI 用 mpv / 分段 ≤80 假名 / 默认一个都不听。

### 阶段 3：core 补全（11-13 21:10–22:25）

按 mtime 顺序：`presets.js`(21:10) → `text/extract.js`(21:10) → `cache.js`(21:21) →
`text/segment.js`(21:25) → `numbers.js` + `zh2jp.js`(22:24)。

- `extract.js`：剥 Markdown（代码块 / 表格 / 行内代码 / 链接 / 裸 URL / 路径 / 标记 / 表情）
- `cache.js`：纯内存 LRU，500 段
- `numbers.js`：中文数字读法（`123`→一百二十三、`2026 年`→二零二六 年、`8080`→八零八零、
  `1.3.3`→一点三点三、`50%`→百分之五十、`-5`→负五），日文不受影响

同时起步 plugin 宿主半边：`watch.cjs`(21:23) → `poller.cjs`(21:24) → `cordis.patch.yml`(21:27)
→ 首批 pipeline/extract/segment 测试(21:28)。

### 阶段 4：plugin 收口（11-13 22:45–23:14）

- `pipeline.cjs`(22:45)、core `index.js`(22:45)
- core `package.json`(23:01)、`config.js` + `engine/local.js`(23:04)、`README.md`(23:05)
- `characters.js`(23:12)、`wav.js`(23:12)、`codec/aqtk1.js` + `aqtk2.js`(23:13)、`demo-chars.cjs`(23:13)
- `docs/角色音色对照.md`(23:14) —— 7 个角色定稿：
  琪露诺 AQTK10 F3 / 天子 AQTK1 F1 / 帕秋莉 AQTK1 F2 / 魔理沙 AQTK10 F2 /
  灵梦 AQTK10 F1 / 蕾米莉亚 AQTK2 F1C / 低音炮帕秋莉 AQTK1 R1
- plugin：`commands.test`(21:44)、`host.test`(21:47)、`tui.test`(21:48)、
  `player-tui.cjs`(21:49)、`player-tui.test`(21:50)

**这一阶段撞的坑**：`ctx.interval` 需要 `timer` 服务，没 inject 就抛
`cannot get property "timer" without inject`。症状是"插件显示已加载但完全不朗读"。
→ 改成自带 `setInterval` + `.unref()`。

### 阶段 5：Web 客户端（11-13 23:26 → 11-14 00:11）

`autoplay.test`(23:26) → `client.test` + `render.test`(23:27) → `handplay.test`(00:03)
→ `leader.test`(00:05) → `ui-style.test`(00:09) → `package-lock.json`(00:11)。

这一段全在跟「重复播放」缠斗，详见 §二。

### 阶段 6：重复播放排障（11-14 10:28–11:09）

休息了约十小时后继续：`singleton.test`(10:28) → `release.test`(11:09)。
这是「一次性投递」从第三版走到第四版的过程。

### 阶段 7：收口（11-14 12:26–12:29）

`client.js`(12:26) → `deliver-once.test`(12:26) → `index.js`(12:28) → `turn-once.test`(12:28)
→ `README.md` + `package.json` 0.2.2(12:29)。

**同一分钟内四处改动** —— 说明这是同一次修复的四个面（根因 + 测试 + 文档 + 版本号）。

### 阶段 8：打包交接（11-14 23:15 起）

本次工作。产出 tarball、交接 zip、四份文档、SHA256 指纹。

---

## 二、版本沿革（推断，依据是 mtime 与 lockfile 里残留的 0.2.0）

| 版本 | 主题 | 主要交付 |
|---|---|---|
| 0.1.0 | 宿主半边 | watch / poller / pipeline / index + HTTP 路由 + `/yukkuri` 命令 |
| 0.2.0 | Web 客户端 | client.js、设置页、回复按钮、选主（lockfile 里还留着这个版本号） |
| 0.2.1 | 一次性投递 | `/pending` 改成服务端裁决、`/release` 发还 |
| 0.2.2 | 根因修复 | 轮次幂等 + 共享队列挂 `globalThis`、停旧实例、只有 `NotAllowedError` 才发还 |

> 0.1.0 / 0.2.0 / 0.2.1 的版本号是**推断**：磁盘上只剩 `package-lock.json` 里那个
> `"version": "0.2.0"`。四版的**内容**是确凿的（README 里记着、代码里能对上），
> 只是「谁对应哪个版本号」是合理推测。

---

## 三、踩过的坑（症状 / 根因 / 修法）

这是这份日志里最该看的部分 —— 每一条都是**症状很有欺骗性**的那种。

### 坑 1：`webServer` 写进 `inject` → TUI 里整个不加载

- **症状**：TUI 里插件完全不存在，`/yukkuri` 命令都没有。
- **根因**：TUI 端没有 `webServer` 服务。声明成硬依赖后 Cordis 拒绝加载整个插件。
- **修法**：`export const inject = ['sessions']`，`webServer` 走 `ctx.inject` 软获取。
- **防回归**：测试里锁了一条 `assert.ok(!mod.inject.includes('webServer'))`。

### 坑 2：`ctx.interval` → 「已加载但从不朗读」

- **症状**：日志显示插件已加载，设置页正常，界面一切正常 —— 就是不说话。
- **根因**：`ctx` 是代理对象，没 inject `timer` 时读 `ctx.interval` 抛
  `cannot get property "timer" without inject`。异常被吞掉后轮询就没启动。
- **修法**：`poller.cjs` 自带 `setInterval` + `.unref()`（不拖住进程退出）。

### 坑 3：SDK 路径含非 ASCII → 词典读不出来

- **症状**：`AqKanji2Koe_Create 失敗: システム辞書(aqdic.bin)が不正、または辞書パスの文字コード不正`
- **根因**：AqKanji2Koe 的 C 接口用 **ANSI** 读词典路径。本仓库路径
  `D:\Users Data\Desktop\油库里语音` 含中文，传进去就废。
- **修法**：SDK 固定放在纯 ASCII 路径（`D:\Documents\yukkuri-sdk`），可用 `YUKKURI_SDK_ROOT` 覆盖。
- **实测对照**：同一段 `synthe('こんにちは')`，中文路径下报错；ASCII 路径下成功出 70368 字节 WAV。

### 坑 4：同一句响 N 遍，「停掉 4 个还剩 1 个」

这是花时间最多的一个，**试了四版才修到根上**。

| 版本 | 做法 | 为什么不够 |
|---|---|---|
| 一 | `localStorage` 选主，只有一个标签页轮询 | 心跳只在抢锁那一刻写过，6 秒后别人以为它死了，纷纷接管 |
| 二 | 客户端单例挂 `window.__dshYukkuri` | 解决了同窗口多实例，跨标签页还得靠选主，选主一错就重现 |
| 三 | `/pending` 一次性投递（服务端裁决） | 解决了"同一段被拉两次"，**但挡不住"同一轮被做 N 次"** |
| 四 | 轮次幂等 + 共享队列挂 `globalThis` | ← 真正的根因 |

**第四版的根因**：插件被重复 `apply`（热重载、多次注入）时，每个实例各有一套
watcher + poller + 队列闭包。同一轮 `onTurn` 跑 N 次 → 合成出 N 套 **id 各不相同**的段
→ 每套各被投递一次 → 依次响 N 遍，按暂停只能停住当前那个。

**三处改动**：轮次幂等（`claimTurn`）、共享段表（`__yukkuriStore`）、
新实例停掉旧实例的 poller。

**还有一处客户端的**：`play()` 对所有错误都 `POST /release` 是错的 ——
Chrome 在 `play()` 尚未落地时换 `src` 会抛 `AbortError`（自己打断自己），
那段其实已经播了，还回队列下一轮又取到 → 又念两遍。现在只对 `NotAllowedError` 发还。

### 坑 5：设置页下拉框白底浅字

- **症状**：`<select>` 展开后选项是白底白字，看不见。
- **根因**：配色全走 `--dsw-alias-*` 变量，但 `<option>` 在浏览器原生弹出层里
  **拿不到这些 CSS 变量**。
- **修法**：`select` / `option` 显式给实底。`ui-style.test.cjs` 有 7 条锁这一族问题。

### 坑 6：`npm pack` 在受限沙箱下的三个连环坑

- 默认 npm cache 打不开（`EPERM`）→ 必须把 `npm_config_cache` 指到工作区内
- `--pack-destination` 目录不存在 → `ENOENT`（退出码 -4058）
- `npm pack --dry-run` 在 npm 11 下**退出码是 1 但清单正常** → 别拿退出码判成功

### 坑 7：`npm test` 在本沙箱整批失败

- **症状**：17/17 文件全 fail，`Error: spawn EPERM / errno: -4048 / syscall: 'spawn'`
- **根因**：`node --test` 的 runner 要 spawn 子进程跑每个文件，本环境禁止 spawn 任何子进程
  （连 `execFileSync(process.execPath, ['-e','console.log(1)'])` 都 `EPERM`）。
- **这不是测试的问题**。逐文件直跑 83/83 全过。
- **反面教训**：`--test-isolation=none` 能绕过 spawn，但会让 4 个用例串味
  （`release` / `host` / `turn-once` ×2 —— 它们都改 `globalThis`）。别用它替代。

### 坑 8：`core` 的 `npm install` 也会撞 spawn EPERM（交接时新发现）

- **症状**：`npm install` 在 core 下失败，`EPERM / errno -4048 / syscall: spawn`，
  报在 `runScriptPkg`（npm 的 run-script）。
- **根因**：依赖 `koffi` 带 `install` 脚本
  `node ./cnoke.cjs -P . -D src/koffi --prebuild --release`，它要 spawn 子进程。
- **修法**：`npm install --ignore-scripts`。**跳过是安全的** —— koffi 的真身二进制来自
  可选依赖 `@koromix/koffi-win32-x64`（`koffi.node` 1060352 字节，由 npm 正常下载），
  与 build script 无关。实测跳过之后 `require('koffi')` 正常、真实合成出 70368 字节 WAV。

### 坑 9：`core/package.json` 的 `main` 指向不存在的文件（交接时新发现）

- **症状**：`require('./')`（即按包名加载 core）→ `MODULE_NOT_FOUND`。
- **根因**：`"main": "index.js"`，但 `core/index.js` 不存在，真入口是 `core/src/index.js`。
- **为什么一直没暴露**：插件从不按包名加载 core，而是走绝对路径 `.../core/src`
  （`lib/index.js` 里 `require(corePath)`，`corePath` 就是 `core/src`）。
- **修法**：`"main": "src/index.js"`。一行，但它决定了 core 能不能作为包被依赖 ——
  这直接关系到「core 怎么发布」那个 P0 设计决策。

---

## 四、当前状态快照（2026-11-14 实测）

> ⚠ 本节的数字是**第一轮交接当时**的状态。第二轮（2026-11-17）之后：
> 插件测试 **23 文件 / 111 例**、包版本 **0.3.0 / 1.1.0**、产物见 §七与 §九。
> 下面这些数字保留原样，是为了看清「这条线是怎么往前走的」。

| 项 | 结果 |
|---|---|
| 插件测试 | 17 文件 / **83 例全通过** |
| core 测试 | 14 文件 / **84 例全通过** |
| 真实合成 | `synthe('今天天气不错', {voice:'cirno'})` → **70368 字节 WAV** |
| 打包 | `dsh-yukkuri-tts-0.2.2.tgz`，26 文件 / 约 49 kB（判据是文件清单与 SHA256，不是体积） |
| 缓存加速 | **598 倍**（36ms → 0.06ms） |

**插件测试逐文件明细**（合计 83）：
autoplay 3 / client 5 / commands 5 / deliver-once 3 / handplay 4 / host 6 / leader 4 /
pipeline 8 / player-tui 7 / poller 6 / release 3 / render 3 / singleton 2 / tui 4 /
turn-once 3 / ui-style 7 / watch 10

**core 测试逐文件明细**（合计 84）：
cache 8 / characters 10 / chinese 3 / emotion 3 / engine 4 / extract 11 / numbers 11 /
pitch 6 / remote-contract 5 / segment 8 / synthe 1 / synthe-cache 7 / wav 5 / zh2jp 2

**不需要 SDK 就能跑的 7 个 core 测试**（换机器时可以先拿它们验环境）：
cache / extract / numbers / pitch / remote-contract / segment / zh2jp。

---

## 五、未完成 / 已知欠账

> ⚠ 这份欠账清单是 2026-11-14 的。其中 **P0 三处硬编码、P1 `main`、P1 `pipeline.cjs`、
> P3 的 `.gitignore`/`LICENSE` 已经在第二轮做完了**，见 §七；剩下的（`npm test` 入口、
> lockfile、无 e2e、无 CI、git init）还在。

按优先级，详细分析见 [`HANDOFF.md`](HANDOFF.md) §6：

- **P0** 三处硬编码绝对路径（`plugin/lib/index.js:168`、`plugin/lib/player-tui.cjs:18`、
  `core/src/config.js:9`）—— 其中 `index.js` 那条是**当前运行中实际依赖的那条**
- **P0** 测试入口不可用（`npm test` spawn EPERM）
- P1 `plugin/package-lock.json` 版本漂移（写 0.2.0，实际 0.2.2）
- P1 `core/package.json` 的 `main` 指向不存在的 `index.js`（真入口是 `src/index.js`）
- P1 `pipeline.cjs` 默认 require 路径解析不到（目前靠显式传参绕过）
- P2 无 `files` 字段 / `client.js` 691 行单文件 / core 缓存内存上限未测 / 无 e2e
- P3 **无版本控制**（连 `.gitignore` 都没有）

> **关于 lockfile 漂移的一个好消息**：交接时实测发现它在 `npm install` 时会**自动愈合** ——
> 解包出来的副本里 `package-lock.json` 还是 `0.2.0`，跑完 `npm install` 后
> 根节点版本变成 `0.2.2`。所以 P1 那一项其实不需要手工修，
> 只要在干净目录跑一次 `npm install` 并提交结果即可。**但仍然不要手改 lockfile。**

**文档与实现的一处不一致**：`core/README.md` 里 `synthe()` 写作同步返回，
实测返回 **Promise**（`await` 后得到 Buffer）。改文档或改实现，二选一。

---

## 六、这次交接做了什么

> 这是**第一次**交接（2026-11-14，0.2.2）。第二次交接（2026-11-17，0.3.0）在 §七。

| 动作 | 结果 |
|---|---|
| 打包插件 | `dist/dsh-yukkuri-tts-0.2.2.tgz` |
| 打包源码 | `dist/dsh-yukkuri-tts-handoff-0.2.2.zip` |
| 补文档 | `plugin/README.md` 310 → 487 行 |
| 写交接 | `HANDOFF.md`、`WORKLOG.md`、`AGENTS.md` |
| 指纹 | `dist/SHA256SUMS.txt` |
| **未改代码** | `plugin/lib`、`plugin/test`、`core/src`、`core/test` SHA256 与勘察开始时一致 |

---

# 第二轮：2026-11-17（可移植化 + 发布准备）

第一轮把东西「说清楚」，这一轮把它「装得走」。触发点很实际：要把仓库传到 GitHub，
而当时源码里还压着三条写死的本机路径 —— 别人 clone 下来必然跑不起来。

## 七、这一轮做了什么

| 动作 | 结果 |
|---|---|
| 新增 `plugin/lib/core-path.cjs` | core 三层解析（env → 兄弟目录 → `node_modules`），没了写死兜底 |
| 改 `plugin/lib/index.js` | `ensureCore()` 改走 `core-path`，删掉 `'D:/Users Data/Desktop/油库里语音/core/src'` |
| 改 `plugin/lib/player-tui.cjs` | `DEFAULT_MPV` 从 `D:\Software\Tools\MPV Player\mpv.exe` 改成 `'mpv'`（走 PATH） |
| 改 `core/src/config.js` | SDK 默认值改成 `path.join(os.homedir(), 'yukkuri-sdk')`；`describe()` 加 `sdkRootFromEnv` + `hint` |
| 改 `plugin/lib/pipeline.cjs` | 三处默认 `require('../../core/src/…')` 改走 `requireCore(spec)` |
| 改两个 `package.json` | plugin 0.2.8 → **0.3.0**、core 1.0.0 → **1.1.0**；MIT、`files` 白名单、去 `private`、`main` 修正 |
| 新增两个测试 | `core-resolution.test.cjs`（5 例）、`no-hardcoded-paths.test.cjs`（3 例） |
| 新增发布件 | 根 `README.md`、`LICENSE`（×3：根/plugin/core）、`.gitignore` |
| 改文档 | `plugin/README.md`、`core/README.md`、`AGENTS.md`、`HANDOFF.md`、本文件 |
| 打包 | `dist/dsh-yukkuri-tts-0.3.0.tgz`、`dist/yukkuri-core-1.1.0.tgz`、交接 zip、GitHub zip |

**测试数变化**：plugin 21 文件 / 103 例 → **23 文件 / 111 例**（新增 8 例）；core 仍是 14 / 84。

### `core-path.cjs` 的三层顺序（以及为什么必须这个顺序）

```js
// 1. YUKKURI_CORE_PATH —— 唯一能覆盖判断的开关；给了却不存在就当场抛错
// 2. <插件>/lib/../../core/src —— 源码仓库形态
// 3. require.resolve('yukkuri-core') 取 dirname —— 从 npm 装进来时
```

第 1 层「给了却不存在也**不回落**」是刻意的：静默回落会让人以为在跑自己指定的那份 core，
其实跑的是别的 —— 这种错误找人一整天。

第 3 层是这次新加的。加它之前，插件装进 `<profile>/node_modules/` 之后第 2 层会解析到
`<profile>/node_modules/core/src`（不存在），运行中实际全靠那条写死的兜底撑着。
**也就是说：能出声不是因为解析对了，是因为那台机器就是作者本人的机器。**

## 八、这一轮踩的 / 差点踩的坑

### 坑 10：`package.json` 带 BOM → 插件静默不加载（用户实际撞过）

- **症状**：装好了、重启了、`node_modules` 里文件都在，但设置页没有「油库里」，
  `/yukkuri` 也不存在。**没有任何一个地方报错。**
- **根因**：DSH 用 `JSON.parse` 读插件包的 `package.json`。开头一个 UTF-8 BOM 就让它抛
  `SyntaxError: Unexpected token '﻿'`，整个 bundle 被跳过。日志里只有一句
  `dsh: skipping profile bundle "dsh-yukkuri-tts": …`，很容易被当成无关噪音。
- **怎么撞上的**：2026-11-17 用 PowerShell 改版本号，`Set-Content -Encoding utf8`
  **默认会写 BOM**（PS 5.1 没有 `-Encoding utf8NoBOM`）。
- **修法**：改用 `[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`，
  或任何能存「UTF-8 无 BOM」的编辑器。
- **防回归**：`test/package-json.test.cjs` 两条断言（版本号形状 + 无 BOM）。

### 坑 11：命令 handler 返回裸字符串 → 命令体一条都不执行

- **症状**：TUI 里敲 `/yukkuri on`，只得到
  `command "yukkuri" handler must return a CommandResult`。
- **根因**：DSH 的命令 handler 只认 `{kind:'success',text?}` / `{kind:'error',text}`。
  返回 `'已开启'` 这种字符串，它判定为无效返回值，**命令体根本不运行**。
- **修法**：逻辑放 `runCommand()`，成功返回字符串、失败返回 `fail(msg)`，
  注册的 handler 只做包装 —— 这样纯逻辑还能被单测覆盖。
- **防回归**：`test/command-invocation.test.cjs`（9 例）。

### 坑 12（差点踩）：测试里断言「SDK 默认值不含盘符」

写 `no-hardcoded-paths.test.cjs` 时第一条断言直接写成「`SDK_ROOT` 不能匹配盘符正则」——
在 Windows 上必然失败，因为 `path.join(os.homedir(), 'yukkuri-sdk')` 展开后就是
`C:\Users\xxx\yukkuri-sdk`。**盘符是 `homedir()` 带来的，不是写死的。**

改法是断言「它等于 `path.join(os.homedir(),'yukkuri-sdk')`」+「给了环境变量就听环境变量的」。
教训：**测「默认值来自哪里」，别测「默认值长什么样」** —— 后者在 Windows 上永远像硬编码。

### 坑 13（顺手发现）：`plugin/package.json` 的 `description` 是双重乱码

上一轮用 PowerShell 改过 `package.json`，中文 description 被 GBK/UTF-8 来回转了两轮，
文件里存的已经不是原字。试着用 GBK 往返还原，仍有一个字（「用」）早被替换成 `??`，
**不可无损还原** —— 最后是重写的：

```
DSH 油库里朗读：把会话里的话用 AquesTalk10 念出来（本地合成，不依赖浏览器）
```

教训：**PowerShell 5.1 的 `Set-Content` / `Out-File` 不适合改带中文的 UTF-8 文件。**
要么用编辑器，要么走 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`。

## 九、这一轮的验收实证

| 检查 | 结果 |
|---|---|
| plugin 测试 | 23 文件 / **111 例全绿**（`YUKKURI_MUTE=1`，逐文件退出码 0） |
| core 测试 | 14 文件 / **84 例全绿** |
| 真合成 | `synthe('今天天气不错',{voice:'cirno'})` → **70368 字节 WAV**（与第一轮同值） |
| 两包 `package.json` | BOM=false、`JSON.parse` 通过、0.3.0 / 1.1.0 |
| plugin tarball | 11 文件 / 43.0 kB / 解包 114.2 kB，**不含 `test/`** |
| core tarball | 23 文件 / 29.2 kB / 解包 71.3 kB，含 `src/text/mapping.tsv` |
| 写死路径 | `plugin/lib` + `core/src` 零命中（测试锁定） |
| npm 布局 | 临时目录装两个 tgz，`require('yukkuri-core')` 通、插件解析走 `source:'npm'` |

## 十、这一轮**没**做的事

- 没 `git init`（仓库仍然是裸目录，`git init` 留给接手的人）
- 没真发 npm（两个包收拾到可发布形态，`npm publish` 由人拍板）
- 没重装本机 profile、没改系统环境变量（只给出 `setx YUKKURI_SDK_ROOT …` 这条命令）
- 没动 `plugin/lib/client.js`（Web 客户端这一轮零改动）
- 没动 `core/` 的业务逻辑（只有 `config.js` 的默认值 + `describe()`）

---

# 第三轮：2026-11-17 晚（分发通道 + 上架物料）

前两轮把包做成了「可移植」，但只有一种装法（`file:` 指到 `plugin/`）。这一轮按社区的两种
分发做法（`dsh-plugin.org` 的收录要求 + `awesome-dsh-plugin` 的上架指南）补齐了**四条通道**，
并修掉一个只有真装一遍才会暴露的坑。

## 十一、这一轮做了什么

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建仓库根 `package.json` | `package.json` | 让 **`github:` 通道一条命令装整个仓库**：声明 `dsh.bundle.patch`、`dsh.client`、`files`、`exports`，以及 core 的四个运行依赖 |
| 修 `files` 白名单 | `package.json` | 必须把 `core/package.json` 也打进去，否则 core 的 CJS 会被当 ESM（见坑 14） |
| 新建上架物料 | `marketplace/` | awesome 的 YAML、dsh-plugin.org 的 Issue 正文、徽章片段、自检说明 |
| 新建离线安装说明 | `packaging/offline-install.md` | 离线包里以 `安装.md` 落地 |
| 根 README 扩写 | `README.md` | 新增「安装（四条途径）」表 + 「装完怎么确认生效」+ 「分发与上架」+ 更多文档表 |
| dist 按通道重排 | `dist/` | `npm/` `github/` `offline/` `handoff/` `marketplace/` + `_archive-0.2.2/` |

## 十二、四条通道分别验证了什么

| 通道 | 命令 | 验证方式 | 结果 |
|---|---|---|---|
| 本地目录 | `dsh plugin --profile <p> add "file:<仓库根>"` | 本机沙箱不可用（坑 15），改用「把包解到 profile 的 `node_modules/` 再 `--dump-config`」 | ✅ 配置里出现 `# == dsh-yukkuri-tts` / `id: yukkuri-tts` |
| GitHub | `add github:ODO-TECH/dsh-yukkuli` | `npm pack` 根包 → 解到 `node_modules/dsh-yukkuri-tts/` → 跑探针 | ✅ `export name=yukkuri-tts inject=["sessions"]`、`hasApply=true`、core 解析 `source=sibling`、真合成 **95668 字节 WAV** |
| npm | `add yukkuri-core dsh-yukkuri-tts` | 临时目录 `npm i` 两个 tgz | ✅ `require('yukkuri-core')` 12 成员、插件解析 `source='npm'`、合成 70368 字节 |
| 离线包 | 解压 → `npm i .\packages\*.tgz` → `file:` 装 | 结构核对（`packages/` 两个 tgz + `安装.md` + 93 个文件） | ✅ 清单齐、无 `node_modules`、无多余 wav |

## 十三、这一轮踩的坑

### 坑 14：仓库根的 `type: "module"` 会把 core 的 CommonJS 当 ESM

**症状**（只有真装一遍才看得到）：

```
file:///…/node_modules/dsh-yukkuri-tts/core/src/index.js:3
const crypto = require('node:crypto');
               ^
ReferenceError: require is not defined in ES module scope,
you can use import instead
```

**根因**：`core/src/*.js` 是 CommonJS（`require`），而它们所在包的根 `package.json` 写了
`"type": "module"`（为了让 `plugin/lib/index.js` 的 ESM `import` 能跑）。Node 按**最近的
`package.json`** 决定模块类型 —— 于是 core 的 `.js` 全被当成 ESM。

**为什么以前没炸**：前两轮 core 是**独立包**（自己的 `package.json` 里 `type: "commonjs"`），
插件按绝对路径引用它。这一轮把 core 塞进同一个包里，最近的那个 `package.json` 变成了根包。

**修法**：把 `core/package.json`（内含 `"type": "commonjs"`）加进根包的 `files`。
一行 csproj 级的改动，但漏了就是 `github:` 通道装完直接崩。

**教训**：**「打包」和「跑测试」是两件事。** 仓库里的测试都从源码目录跑，永远走不到
`node_modules/` 那条路径 —— 只有把产物真装进一个 profile 再加载，才会暴露包内模块边界的问题。

### 坑 15：`dsh plugin add` 在受限环境里跑不了 pnpm

**症状**：

```
Error: ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK
  × adding a new package
  ╰─▶ Failed to open the store operation lock at
      "C:\Users\…\AppData\Local\pnpm-store-operation-locks\all-stores.lock": 拒绝访问。 (os error 5)
```

**根因**：pnpm 10+ 有一个**全局**操作锁目录，位置由真实用户目录决定；`--store-dir` 和
`LOCALAPPDATA` 都改不动它。受限环境（沙箱）不允许写那里 → 整个 `add` 直接失败，与包本身无关。

**绕法**：把包手工解到 `<profile>/node_modules/<包名>/`，在 profile 的 `package.json` 里
补 `dependencies` 与 `dsh.profile.bundles`，再 `dsh --profile <p> --dump-config` 验证层是否生效。
这个绕法验的是「DSH 能不能读出并应用我们的 patch」，恰好是这一轮真正关心的事。

**教训**：**工具的「装」和框架的「加载」是两层。** 装不进去时，别急着怀疑包 —— 先分清是
包管理器的权限问题，还是包本身的清单问题。这两者的修法完全不同。

### 坑 16：`Compress-Archive` 打出来的 zip，路径分隔符是反斜杠

**症状**：在 Windows 上解压一切正常；拿到 Linux / macOS 上 `unzip`，会得到一批文件名里
带反斜杠的文件（`dsh-yukkuri-tts\plugin\lib\index.js`），目录结构整个塌成一层。

**根因**：PowerShell 5.1 的 `Compress-Archive` 内部走 .NET Framework 的
`ZipFile.CreateFromDirectory`，它用 `Path.DirectorySeparatorChar` 拼条目名 —— 在 Windows 上
就是 `\`。ZIP 规范（APPNOTE 4.4.17.1）要求的是 `/`；.NET Core 之后才改成规范写法，
Framework 一直没修。用 `ZipFile.CreateFromDirectory` 直接打也一样中招。

**修法**：手工建条目，自己把分隔符换成 `/`：

```powershell
$za = New-Object System.IO.Compression.ZipArchive($fs, 'Create')
Get-ChildItem $dir -Recurse -File | ForEach-Object {
  $rel = $base + '/' + $_.FullName.Substring($root.Length+1).Replace('\','/')
  $e = $za.CreateEntry($rel, 'Optimal'); $e.LastWriteTime = $_.LastWriteTime
  $es = $e.Open(); $src = [System.IO.File]::OpenRead($_.FullName)
  $src.CopyTo($es); $src.Dispose(); $es.Dispose()
}
```

（`New-Object …ZipArchive($fs,'Create')` 这里第二个参数走的是 `ZipArchiveMode` 的字符串转换；
写成 `[System.IO.Compression.ZipArchiveMode]::Create` 更稳。）

**验证**：`$entries | Where-Object { $_ -match '\\' }` 必须为空，**而且顶层目录名要单独拼**
（`CreateFromDirectory` 少给 `includeBaseDirectory` 就会把文件摊在 zip 根部）。

**教训**：**自己机器上解压正常，不等于产物正常。** 上传给别人的 zip，要么验分隔符，
要么用 `git archive` 这类跨平台工具出。这条是最后一轮才发现的 —— 前面几版 zip 都有这个问题。

## 十四、这一轮的验收实证

| 检查 | 结果 |
|---|---|
| 仓库树全量测试 | 37 文件 / **195 例全绿**（plugin 23/111 + core 14/84，失败文件 0） |
| GitHub 包解包后测试 | 同上 **37 文件 / 195 例 / 失败 0**（补 `node_modules` 后逐个文件跑） |
| GitHub 包真合成 | `synthe('今天天气不错，ゆっくりしていってね',{voice:'cirno'})` → **101168 字节** |
| 根包 tarball | 36 文件 / 78.1 kB，含 `core/package.json`、`core/src/text/mapping.tsv` |
| 三个 zip | github 97 / offline 100 / handoff 99 文件，**`node_modules` 计数 0**，**反斜杠条目 0**，顶层目录各自独立 |
| 写死路径扫描 | 只剩文档里描述「本机现状」的路径 + 一条合法的测试夹具 |
| `--dump-config` | 出现 `# == dsh-yukkuri-tts` 与 `id: yukkuri-tts` |
| `dist/SHA256SUMS.txt` | 102 条（交付物 13 + 源码基线 89），逐条重算 **ok=102 bad=0** |

## 十五、这一轮**没**做的事

- 没真发 npm（`npm publish` 由人拍板；两个包已就绪）
- 没提 awesome 的 PR、没提交收录 Issue（物料备好了，提交要人来做）
- 没打 `dsh-plugin` topic（那是仓库设置，得在 GitHub 网页上点）
- 没重装本机 profile（本机仍是 0.2.2 快照；新装法只用临时 profile 验过）
- 没改 `plugin/lib/client.js`、没动 core 业务逻辑

---

## 十六、这一轮做了什么（2026-11-17 · 按通道极简打包）

输入是两篇帖子：dsh-plugin.org 的《DSH 插件怎么开发？从最小插件到打包安装》与
Void-LifeStream 的《DSH 插件上架指南》。前者定死了 bundle 的最小形态
（`package.json` 声明 `dsh.bundle.patch` + `cordis.patch.yml` + 入口模块），
后者定死了上架门票（**topic + 一个 YAML，npm 不是前置**）。据此把打包按通道重做。

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建打包脚本 | `packaging/pack.cjs` | 四通道**显式白名单** → `dist/` 暂存树 + 逐文件清单；不压缩、不发布、不联网 |
| 精简根包 `files` | `package.json` | 去掉 `core/README.md`、`core/docs`（运行不需要） |
| 精简 core `files` | `core/package.json` | 去掉 `docs/`；README 里那条链接改指 GitHub |
| 补 `repository` | `plugin/package.json`、`core/package.json` | 带 `directory` 字段；根包本来就有 |
| 重写离线说明 | `packaging/offline-install.md` | 新形态：预装 `node_modules`，不再是 `packages/*.tgz` |
| YAML 改名 | `marketplace/ODO-TECH__dsh-yukkuli.yml` | 与 PR 目标路径 `data/plugins/<owner>__<repo>.yml` 同名，拷过去即可 |
| 文档同步 | README / plugin·core README / HANDOFF §9 / AGENTS / marketplace README | 数字、布局、上架门槛全部对齐 |

## 十七、这一轮踩的坑

### 坑 17：`fs.cpSync(recursive)` 让 node 进程静默退出 127

**症状**：`node packaging/pack.cjs` 退出码 **127**，stdout / stderr **全空**，
重定向到文件也是空的；`node --check` 通过，`node -e "require(...)"` 同样 127。

**定位**：把脚本按 `function main` 切开 —— 前半段正常打印，加上 main 就死。
再逐操作二分，锁定 `fs.cpSync(src, dst, { recursive: true })` 这一行。

**修法**：手写 `copyDir`（`readdirSync` + `mkdirSync` + `copyFileSync`）。实测正常。

**教训**：与 `spawn EPERM` 同一类环境限制。**「没有输出」不等于「跑成功了」** ——
先看退出码，再看产物有没有真的变。

### 坑 18：`fs.rmSync(recursive)` 不抛错、也不删

清理暂存目录用 `rmSync(dir, { recursive: true, force: true })`，调用返回正常，
`existsSync(dir)` 仍是 `true`。后果比报错更坏：**上一次的旧文件混进新清单**。
实测它确实把两个探针垃圾文件带进了 `dist/github/repo/`（95 文件而不是 93）。

**修法**：手写 `removeDir`（逐文件 `unlinkSync` + 自底向上 `rmdirSync`），
并给暂存树加了一道 audit：任何下划线开头的临时文件、`node_modules`（离线树除外）、
lockfile、`.lnk` / `.zip` / `.tgz`、`output*` 音频一律拒绝入树。

### 坑 19：`files` 白名单删不掉 README / LICENSE

根包 `files` 只列了运行文件，`npm pack --dry-run` 却给出 **35** 个而不是 31 个 ——
多出 `plugin/README.md`、`plugin/LICENSE`、`core/README.md`、`core/LICENSE`。
试了否定写法 `!plugin/README.md`，**无效**：npm 的「always included」规则压过白名单。

**结论**：35 就是这个形态的地板，别再试图压。要核对真实清单只认 `npm pack --dry-run`。

### 坑 20：「只带两个 tgz 的离线包」是假离线

上一版离线包带 `packages/*.tgz` + 说明，让用户 `npm i *.tgz`。但 tarball 只含本包文件，
`koffi` / `pinyin-pro` / `aquestalk.js` 仍要去 registry 拉 —— **没网就是装不上**。

**修法**：离线通道只出「运行树 + 预装 `node_modules`」一种形态，27 MB。
其中 19 MB 是 `v86`：天子 / 帕秋莉 / 低音帕秋莉走 AquesTalk1（官方只发 32 位 DLL），
靠 `aquestalk.js` 的 v86 WASM 模拟，是必需依赖，瘦身不能删它。

## 十八、这一轮的验收实证

| 检查 | 结果 |
|---|---|
| `npm pack --dry-run`（不写 tarball） | 插件 **11 文件 / 112 kB**、core **22 / 67 kB**、根包 **35 / 197 kB**，与暂存树逐一对上（**这是合并成单包之前的数**，合并后见 §二十） |
| 暂存树 | npm-plugin 11、npm-core 22、github-repo **93 / 约 950 kB**、offline **456 / 27.1 MB**（同上，合并后 npm 只剩一棵树） |
| 产物里有没有压缩包 | `dist/` 下**零** tgz / zip（node_modules 里 aquestalk.js 自带的声库 zip 除外） |
| core 的 CJS 边界（坑 14） | 从暂存树 `require('./core/src')` → **12 成员**，无 ESM 报错 |
| core-path 解析 | `source=sibling` → `core/src` |
| 插件 ESM 入口 | `name=yukkuri-tts`、`inject=["sessions"]`、`apply=function` |
| 真合成 AQTK10（koffi） | `cirno` → **70368 字节** WAV，RIFF 头正确 |
| 真合成 AQTK1（v86） | `tenshi` → **27076 字节** WAV，RIFF 头正确 |
| 插件全链路 | 10 条路由；先轮询 `/pending` 才认 Web → `deliver=web`、1 段、`/audio` **141368 字节** |
| 全量测试 | plugin **23 文件 / 失败 0**、core **14 文件 / 失败 0**（`YUKKURI_MUTE=1`） |
| BOM | 三份 `package.json` 全部 `BOM ok`，`JSON.parse` 通过 |
| 远端仓库（GitHub API） | **空仓库**（0 commits）、`topics: []`、description 是营销腔、创建于 `2026-11-17T10:38:10Z` |

> 全链路那一步有个容易误判的地方：**必须先有客户端在轮询 `/pending`**，插件才认这是 Web 端。
> 不轮询就发一轮，它会按 TUI 直接播（`deliver=tui`），段不进广播流，随后查 `/pending` 是空的 ——
> 那不是链路坏了，是探针写错了。

## 十九、这一轮**没**做的事

- **没压缩**：按要求只暂存目录，zip / tgz 等 README 定稿后再出
- **没 push**：远端仍是空仓库；`dist/github/repo/` 是待推的干净树
- 没发 npm、没提 awesome PR、没打 topic、没改远端 description（都要人拍板）
- 没动 `plugin/lib`、`core/src` 的任何业务逻辑
- 没修 lockfile 漂移（`npm install` 自愈，暂存树刻意不带 lockfile）

## 二十、合并成单个 npm 包（用户拍板）

**为什么合**：原来对外是两个包（`dsh-yukkuri-tts` + `yukkuri-core`），用户装的时候要写两个名字。
但 core 从来没有独立使用场景 —— 它只被这个插件调用，版本永远跟着插件走。两个包带来的是
**真实的坑**，不是灵活性：

- 用户漏装 core → 第 3 层解析失败，报错正文还得教他 `npm i yukkuri-core`
- 两份清单的版本号要人工对齐，`peerDependencies` 还得标 optional 才能本地开发
- 仓库根**本来就有**一份完整清单（`github:` 通道靠它），已经带着 core 的四个运行依赖 ——
  等于同一件事存在两套发布口径

**决定**：只发仓库根那一份（`dsh-yukkuri-tts` 0.3.0），core 随包分发。

| 改了什么 | 文件 | 内容 |
|---|---|---|
| 根包解除 private | `package.json` | 它现在是唯一发布件 |
| 两份开发清单加 private | `plugin/package.json`、`core/package.json` | 防误发；plugin 那份与根包**同名**，发出去会互相覆盖 |
| 去掉 optional peer | `plugin/package.json` | 删 `peerDependencies` / `peerDependenciesMeta`（yukkuri-core） |
| 报错提示改口径 | `plugin/lib/core-path.cjs` | 不再教用户装一个不存在的包，改成「重装 dsh-yukkuri-tts（core 随包分发）」 |
| 跟着改断言 | `plugin/test/core-resolution.test.cjs` | `/npm i yukkuri-core/` → `/重装 dsh-yukkuri-tts/` |
| 打包脚本收成三通道 | `packaging/pack.cjs` | `npm-plugin` + `npm-core` 合成一个 `npm`，共用同一份运行白名单 |
| 护栏加强 | `plugin/test/package-json.test.cjs` | 两份清单都查 BOM / name / type / bundle；另锁根包 `files` 含 `core/package.json` + `core/src`、根包不 private、开发清单必须 private、根与 plugin 版本一致。**用例数不变（仍 2 例）** |

**合并后的实证**（全部重跑过）：

| 检查 | 结果 |
|---|---|
| `npm pack --dry-run`（在 `dist/npm/dsh-yukkuri-tts/`） | **35 文件**，tarball 74.0 kB / 解包 193.9 kB，一个包 |
| 暂存树 | npm **35 / 189 kB**、github-repo **93 / 949 kB**、offline **456 / 27.1 MB** |
| 离线树加载 + 真合成 | 12 成员、`source=sibling`、`inject=["sessions"]`、cirno **70368** / tenshi **27076** 字节、`deliver=web`、`/audio` **141368** 字节 |
| 全量测试 | plugin **23 文件 / 失败 0**、core **14 文件 / 失败 0** |

> 第 3 层解析（`require.resolve('yukkuri-core')`）**保留**，但降级成兜底：谁要是单独放了一份
> core 进来仍然能用。正常发布形态走第 2 层（core 就在包内）。

## 二十一、README 瘦身（用户要求「写简单一点」）

根 `README.md` **462 行 → 190 行**，只留使用者要的：
是什么 / 安装（SDK + 一条命令 + 三条备选途径）/ 用起来 / 配置 / 没声音怎么查 / 许可 / 文档索引。

搬走的内容都有现成的家，没有丢：

| 从 README 拿掉的 | 现在在哪 |
|---|---|
| 目录结构树、数据流 ASCII 图 | `HANDOFF.md` §2 / §4 |
| 四条通道的长篇差异、pnpm allowBuilds 说明 | `HANDOFF.md` §8.5 |
| 打包（维护者）：命令、通道表、35-not-31、v86 | `HANDOFF.md` §9（补上了 `pack.cjs` 命令、三个 flag、审计规则） |
| 跑测试（逐文件、`npm test` 为什么不能用） | `AGENTS.md`「跑测试」 |
| 分发与上架、硬门槛、awesome PR | `marketplace/README.md` |
| Web / TUI 差异表、环境变量全表 | `plugin/README.md` |

安装命令统一成单包 `dsh plugin --profile web add dsh-yukkuri-tts`；本地源码装改成指**仓库根**
（运行依赖在根清单里），`HANDOFF.md` §7 / `AGENTS.md` / `plugin/README.md` 的对应命令一起改了。

顺手修正的三处口径：

- README 里指向仓库文档的链接全改成 **GitHub 绝对 URL** —— npm 包只带运行文件，
  `HANDOFF.md` / `AGENTS.md` / `marketplace/` / `output-chars/` 都不在包里，相对链接在 npm 页面上是死链。

- 排查 BOM 那条原来写「查 `plugin/package.json`」—— 合并后发布包里**根本没有这个文件**
  （不在白名单里），DSH 读的是包根那份。根 README 与 `packaging/offline-install.md` 都改成
  「包根的 `package.json`」。
- `marketplace/dsh-plugin.org-issue.md` 的自查清单原来把「已打 topic」勾成 `[x]`，
  而远端实测 `topics: []` —— 改回 `[ ]`，并补一条「干净树已 push / description 已换」。

## 二十二、声线口径修正 + 压缩 + 建库提交

### 先修口径（用户指出：蕾米莉亚预设已删，AQTK2 用不上）

起因是上面那个网络探针顺手撞出 `voice: 'remilia'` 合成失败。查 `core/docs/角色音色对照.md`
的定稿表：**只有 6 个角色**，蕾米莉亚 / 十六夜咲夜 / 伊吹萃香 都在「已停用」（试听后判定不对），
而 AQTK2 引擎代码是刻意保留的（`codec/aqtk2.js`，目前没有角色用它）。

于是把散在各处的「七个声线」口径统一成六个，并把 **AquesTalk2 从 SDK 前置要求里删掉**：

| 文件 | 改了什么 |
|---|---|
| 根 `README.md` | 特性行「七个声线」→ 六个；试听括注；SDK 段只留 AquesTalk10 + AqKanji2Koe（并说明 AQTK1 那三个声线由包内 `aquestalk.js` 的 v86 在本地跑，不用另外下 SDK）；声线表删 `remilia` 行 |
| `core/README.md` | `7 预设 + 8 角色` → `7 + 6`；表删 remilia；加「已停用」说明 |
| `packaging/offline-install.md`、`marketplace/dsh-plugin.org-issue.md` | SDK 需求改成两个库 |
| `HANDOFF.md` | 根目录草案标注成「早期 7 角色草案（含后来停用的蕾米莉亚等）」 |

**顺手修的第二个口径错**：帕秋莉的声库到处写着 `AQTK1 f2`，但定稿是 **f1 + speed 92 + pitch 1.04**
（`characters.js` 里 `voice: 'f1'`）。README 与 core/README 的表都改了。

> 用户自己改过根 README（标题、`> !?⑨⑨?!是正宗幻想乡口音！？`、`(ᗜˬᗜ)`、「丢给大肥鱼」那段），
> 明确说过**别动这些整活内容**。所以本轮对 README 只做定点替换，并把「整活文本仍在」写成验收项：
> 逐串检查 `⑨⑨` / `(ᗜˬᗜ)` / `大肥鱼` / `少女写代码中` 都在，且暂存树与工作树逐字节一致。

`presets.js:52` 那个 `characters.voiceOf()` 不存在的报错路径**用户拍板不动**（影响面：只有手工把
配置里的 `voice` 写成不存在的 id 才会碰到；`/yukkuri voice <id>` 有白名单，会干净拒绝）。

### 压缩与打包产物（用户授权「按这个提交，所有平台仓库都上传」）

| 产物 | 怎么出 | 结果 |
|---|---|---|
| npm tarball | 在 `dist/npm/dsh-yukkuri-tts/` 里 `npm pack --pack-destination <绝对路径>` | `dist/tarballs/dsh-yukkuri-tts-0.3.0.tgz`，**74.4 kB / 35 文件** |
| 离线包 zip | `/c/Windows/System32/tar.exe -caf`（**bsdtar** 才能出 zip；Git Bash 自带的是 GNU tar 1.35，只会 `Cannot connect to D:`） | `dist/zip/dsh-yukkuri-tts-offline-0.3.0.zip`，**7.16 MB**，`-tf` 数过 456 个文件条目 |

> bsdtar 的 `-C` 只作用于**输入**，输出名给相对路径会落在当前工作目录 —— 第一次就压到了仓库根，
> 已挪进 `dist/zip/`。压完必须 `-tf` 点条目数，别只看退出码 0。

### 建库与提交

在 `dist/git-push/dsh-yukkuli/`（`dist/github/repo/` 的一份拷贝，**刻意不与暂存树共用目录** ——
`pack.cjs` 会清通道目录，`.git` 放进去会被删）里：

- `git init -b main` → `git add -A` → 提交 → `git tag -a v0.3.0`
- 身份用 `git -c user.name=… -c user.email=…` 传参，**不写任何 git 配置**
- `git ls-files` = **93**，与工作树文件数一致；提交后 `git status --porcelain` 空
- 推上去之前扫过一遍：`api_key|secret|passw|BEGIN .*PRIVATE|npm_…` 正则**零命中**，
  `*.dll` / `aqdic.bin` / `*.node` **零命中**（SDK 二进制没混进仓库）

### 这一轮实测的凭据现状（决定了哪些「上传」我能做、哪些不能）

| 检查 | 结果 | 影响 |
|---|---|---|
| `git --version` | 2.52.0 | git 可用 |
| `npm whoami` | `need auth` | **发不了 npm** |
| `GH_TOKEN` / `GITHUB_TOKEN` / `NPM_TOKEN` | 全空 | 没有 API 令牌 |
| 凭据管理器里的 GitHub 条目 | 无（`cmdkey /list` 不命中） | push 会走交互式登录 |
| `~/.ssh` | 只有 `known_hosts`，无私钥 | 走不了 SSH |
| `github.com/…info/refs?service=git-receive-pack` | **401** | 网络通，缺的是授权 |
| `codeload…/tar.gz/refs/heads/main` | 404 | 仓库确实还没有分支 |
| `api.github.com/zen` / `ghfast.top` | 200 / 200 | 出口正常 |

**踩到的一次卡住**：`GIT_TERMINAL_PROMPT=0 -c credential.interactive=false git push` 三个命令
**一行输出都没有、挂死 3 分钟**。Git Bash 的 curl 同期能通，说明不是网络，是 GCM 仍在等交互。
所以下次判断「push 卡住」先分清：401 = 缺凭据（能立刻报错）；无输出挂住 = 认证器在等 UI。

### push 结果：成功

把上面那次去掉「不许交互」的限制、挂后台重跑，**推上去了**：

```
To https://github.com/ODO-TECH/dsh-yukkuli.git
 * [new branch]      main -> main        （main @ 0ac3255，93 文件）
 * [new tag]         v0.3.0 -> v0.3.0
```

`git ls-remote` 与 `api.github.com/repos/…` 双向核对过：`default_branch: main`、
`pushed_at: 2026-11-17T12:54:38Z`。所以 GCM 里其实是有一次可用凭据的 ——
之前那次挂住是 `credential.interactive=false` 把它逼进了死路，**不是没登录**。

### 剩下要人拍板 / 做不了的

| 项 | 状态 |
|---|---|
| `npm publish` | **做不了**：`npm whoami` = `need auth`，`~/.npmrc` 不存在，没有 `NPM_TOKEN`。tarball 已备好 `dist/tarballs/dsh-yukkuri-tts-0.3.0.tgz` |
| awesome PR | **今天提不了**：CI 查仓库创建满 1 天，`created_at` 是 `2026-11-17T10:38:10Z` → 最早 11-18 10:38Z 之后 |
| dsh-plugin.org 收录 | 网页表单要用户本人账号，`marketplace/dsh-plugin.org-issue.md` 正文已备好 |
| LICENSE 归类 | push 后 API 报 `license: NOASSERTION` —— MIT 正文是标准的，但末尾用 `---` 追加了 SDK/东方免责段，识别器因此不认。那段在 README「许可」里已有副本，删掉即可变 MIT，**属许可文本，等用户点头** |

## 二十三、免 npm 上 DSH 市场 + 上架四件套（2026-11-18，用户「都按照你说的做好」）

### 先纠正一个误判：不发 npm 也能进 DSH 市场

DSH **不内置任何索引源**，「发现」页读的是使用者自己添加的 `index.json` 网址。
format 1 的 `source` 有 `npm` 与 **`git`** 两种，git 只要 `{url, commit:40位小写SHA, path?}`，
安装 spec = `git+<url>.git#<commit>`。之前「进市场必须发 npm」的说法只对 **awesome 那份索引**成立：
他们 `scripts/lib/market-index.mjs` 里 `if (!record?.npm) { skipped.noNpm++; continue; }`，
注释自承「The GitHub-only half of the list cannot be expressed yet」—— 是他们不记 commit SHA，
不是 DSH 格式限制。用户拍板不发 npm 后走自建索引。

### 索引与托管（已实测闭环）

- `market/index.json`（1490 B）：版本 0.3.0，git 源 pin `0f0531490bff2d2cf25ba850e0ae049cd85f5379`
- 用 DSH 自带 `@deepseek-ai/dsh-plugin-market-index` 0.2.2-rc.3 `parseMarketIndex` 校验通过
- 托管 = 仓库 GitHub Pages（用户网页点的 Save：Deploy from a branch / main / `/(root)`），
  根加 `.nojekyll` 防 Jekyll 处理；`pack.cjs` 的 github 通道白名单同步加 `market` 与 `.nojekyll`（95 文件）
- 线上复核：`https://odo-tech.github.io/dsh-yukkuli/market/index.json` **200 / 零重定向 / 0.78 s**，
  返回字节与仓库文件 `Buffer.equals` 为 true，再拿线上字节过一遍校验器仍通过

### push 连失败两次的根因：git 不继承系统代理

症状 `Recv failure: Connection was reset`、curl `info/refs` 000，但 `api.github.com` 直连正常 ——
很容易误判成「GitHub 挂了」或「凭据坏了」。实测注册表
`HKCU\…\Internet Settings`：`ProxyEnable=0x1`、`ProxyServer=127.0.0.1:7890`（浏览器走它所以网页正常）。
git/curl 不读 WinINET。单条命令内联 `-c http.proxy=http://127.0.0.1:7890 -c https.proxy=…` 后 1.4 s 通、
push 一次过（`0f05314..80fc1c5`）。读注册表要 `MSYS_NO_PATHCONV=1`，否则 `/v` 被 MSYS 转义报「无效语法」。
**另一个坑**：后台命令末尾的 `echo PUSH_EXIT=$?` 会让任务整体 exit 0，第一次失败就是这样被掩掉的；
判成功必须看输出里的 `PUSH_EXIT=` 加远端 head sha / `pushed_at`。

### 四件套（REST，token 只以变量名出现在命令里）

| 项 | 结果 |
|---|---|
| description | `PATCH /repos/…` 200，事实描述生效 |
| topics | **PATCH 不吃 topics**（200 但仍是 `[]`）；改 `PUT /repos/…/topics` 200 → 5 个 topic |
| LICENSE | 根 / plugin / core 三份的 `---` 追加段删除，只留标准 MIT；免责声明副本在根 README「许可」 |
| Release | `POST /releases` 201（id 449466221，tag v0.3.0）；资产上传 201，下载回来逐字节一致。**LICENSE 删段后重 pack 替换过资产**：74352 B → **74052 B**（删旧资产 204 + 传新 201，现 id 761643017），离线 zip 也重打（456 文件） |
| awesome PR | fork 202 → 等就绪 → contents API 201 放 `data/plugins/ODO-TECH__dsh-yukkuli.yml`（补了 `tarball:` 指 Release 资产）→ `POST /pulls` 201 = **#16451** open |
| dsh-plugin.org | 提交 = 去 `dshplugin/dsh-plugin-hub` 开 Issue（**没有网站账号体系**，截图栏可选）。用户提供设置面板截图 → 入仓 `marketplace/screenshot-settings.png`（29171 B）→ raw URL 实测 200 且逐字节一致 → `POST /issues` 201 = **#825** open |

年龄门槛（`created_at 2026-11-17T10:38:10Z`）那条检查**会自己重跑**，所以 PR 先提、到点自动变绿，
不必干等 —— 之前「等 11-18 再提」的写法偏保守，已改。

### 复核（都是真实返回，不是推断）

`license.spdx_id = MIT`（删追加段 + push 后 API 复查）；topics 5 个；`pushed_at 2026-11-18T03:01:38Z`、
main @ `54f43cc`；Release 资产下载 200 / 74052 B 与本地新 tgz 逐字节一致；离线 zip 重打后文件数仍 456；
awesome PR #16451 的 `check` 运行中（年龄门槛那条会自己重跑）。

### 还剩的

awesome 维护者合并 #16451；dsh-plugin.org 等刷新收录（#825 已提，初态 unconfirmed 属正常）；
标签 `v0.3.0` 仍停在 `0ac3255`（其后都是文档/索引提交，代码相同；挪标签要 force-push，未做）。
