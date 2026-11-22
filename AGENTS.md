# AGENTS.md

给在本仓库里工作的 AI agent（codex / claude code / 其它）读的**可执行守则**。
给使用者看的是根 [`README.md`](README.md)，用法在 [`plugin/README.md`](plugin/README.md)，
设计叙述与交接背景在 [`HANDOFF.md`](HANDOFF.md)。
这里只放「做什么之前必须知道什么」和「怎么算做完」。

---

## 仓库是什么

一个 DSH 插件的源码仓库，两个并列部件（**对外只发一个 npm 包**，core 随包分发）：

- `core/` —— 合成核心（**CommonJS**）。文本 → 假名 → 音素 → WAV。包内名 `yukkuri-core`，
  但**不单独发 npm**，它的 `package.json` 是 `private`，作用是声明 `type: commonjs`。
- `plugin/` —— DSH 插件（**ESM** 入口 + 几个 `.cjs` 纯逻辑模块）。它的 `package.json`
  也是 `private` 的开发清单（跑测试用）。

**对外发布的是仓库根那份 `package.json`**（`dsh-yukkuri-tts`），npm 与 `github:` 两条通道共用它。
源码仓库里两边**必须相邻**（插件按 `lib/../../core/src` 找 core）；发布包里 core 也在包内，
同样走这一层 —— 见下面的「core 怎么被找到」。
AquesTalk SDK 的路径**不能含非 ASCII**。许可证是 MIT，见 `LICENSE`。

---

## 跑测试（唯一可靠入口）

**不要用 `npm test`。** 它等于 `node --test`，在本环境整批失败：

```
Error: spawn EPERM
  errno: -4048, code: 'EPERM', syscall: 'spawn'
```

`node --test` 的 runner 要 spawn 子进程，沙箱禁止 spawn（连 `execFileSync` 都 EPERM）。
**这是环境限制，不是代码坏了。** 也不要改用 `--test-isolation=none`：
它会让 4 个用例因共享 `globalThis` 而互相污染（`release` / `host` / `turn-once`）。

逐文件直跑：

```powershell
# plugin —— 24 文件 / 119 例
cd plugin; Get-ChildItem test\*.test.cjs | ForEach-Object { node $_.FullName }; cd ..

# core —— 15 文件 / 90 例
cd core; Get-ChildItem test\*.test.js | ForEach-Object { node $_.FullName }; cd ..
```

判据是**每个文件的退出码为 0**。别只看最后一条命令的退出码。

跑之前先设 `$env:YUKKURI_MUTE = "1"`：有几个测试会加载真插件，不静音就会
在用户旁边真的放出声音。需要验证真实队列/落盘的那个文件（`player-tui.test.cjs`）
自己会把这个变量删掉，所以整体静音不会影响它。

需要 SDK 的 core 测试：`characters` / `chinese` / `emotion` / `engine` / `synthe` /
`synthe-cache` / `wav`。其余 7 个（`cache` / `extract` / `numbers` / `pitch` /
`remote-contract` / `segment` / `zh2jp`）不碰 DLL，换机器时先用它们验环境。

SDK 本机的真身在 **`D:\Documents\yukkuri-sdk`**（纯 ASCII）。默认的 `~/yukkuri-sdk` 原本不存在，
2026-11-18 建了一个目录 junction 指过去（`C:\Users\ZJW\yukkuri-sdk` → 上面那个），默认值现在能用了；
换台机器就重建同样的 junction，或设 `YUKKURI_SDK_ROOT`。仓库里的 `sdk/` 在中文路径下，只能当参考副本。
不响时先跑 `/yukkuri sdk` 看自检（路径 + 来源 + 缺哪个 DLL）。

### 还有两个会静默失败的文件 API（2026-11-17 实测）

- `fs.cpSync(src, dst, { recursive: true })` —— node 进程被**直接杀掉**：退出码 127，
  stdout / stderr 全空，一行报错都没有。
- `fs.rmSync(dir, { recursive: true, force: true })` —— **不抛错也不删**，目录原样留着。

都不是代码问题，与 `spawn EPERM` 同一类环境限制。替代写法：复制用 `readdirSync` +
`mkdirSync` + `copyFileSync` 逐文件走；删除用逐文件 `unlinkSync` 再自底向上 `rmdirSync`。
`packaging/pack.cjs` 里的 `copyDir` / `removeDir` 就是现成实现。

**别拿「脚本没输出」当成功** —— 先看退出码，再看产物是不是真的变了。
用 `rmSync` 清暂存目录会让上一次的旧文件混进新清单，这种错不报任何异常。

---

## 提交前自检

1. plugin 24 个文件逐个退出码 0
2. core 15 个文件逐个退出码 0
3. `cd core; node demo.cjs` 能出 8 个 wav（需要 SDK 就位）
4. 动过 `plugin/lib/client.js` 的话，`ui-style.test.cjs` 必须仍然全绿（它锁配色变量）

---

## 三条禁令

这三条不是风格偏好 —— 每一条都对应一个**已经发生过**的线上故障。

### 1. 别把 `webServer` / `sessionTitle` 加进 `export const inject`

```js
export const inject = ['sessions'];   // 只能是这个
```

TUI 端没有 `webServer`。声明成硬依赖 → 插件在 TUI 里**整个拒绝加载**。
要 webServer 就用 `ctx.inject(['webServer'], cb)` 软获取。
`host.test.cjs` 里有一条断言锁这个。

### 2. 别把幂等表 / 段表从 `globalThis` 挪走

```js
globalThis.__yukkuriSeenTurns   // 轮次幂等
globalThis.__yukkuriStore       // 段表 + id 计数器
globalThis.__yukkuriStats
globalThis.__yukkuriHost
```

插件会被多次 `apply`（热重载）。挪进闭包 = 每个实例各记各的 = 同一轮合成 N 次 =
同一句响 N 遍且停不掉。这个 bug 修了四版才到根上，详见 `WORKLOG.md` 坑 4。

### 3. 别用 `node --test` 的批量模式判定回归

见上面的「跑测试」。它的失败与代码无关，会把你带偏。

---

## 文件约定的两个陷阱

### `.cjs` 不是笔误

`plugin/package.json` 是 `"type": "module"`，所以 `.js` 一律按 ESM 解析。
`watch.cjs` / `pipeline.cjs` / `poller.cjs` / `player-tui.cjs` 用 CommonJS 写（`require` 直读，
测试不需要转译）。**把它们改名成 `.js` 会直接报错。**

### `package.json` 不许有 BOM（会静默毁掉整个插件）

DSH 用 `JSON.parse` 读插件包的 `package.json`。开头带 UTF-8 BOM 时它会整包跳过：

```
dsh: skipping profile bundle "dsh-yukkuri-tts": SyntaxError: Unexpected token '﻿'
```

插件**根本没被加载** —— 没有日志、没有路由、没有轮询，重启多少次都不响，
而且源码和 profile 里的文件看上去一切正常。2026-11-17 就是用 PowerShell
`Set-Content -Encoding utf8` 改版本号带进了 BOM，用户连着重启两次都没声音。

改完 `package.json` 必须验一遍（**两份都验**：仓库根那份是对外发布的，装进
`node_modules` 后 DSH 读的就是它；`plugin/` 那份是从源码目录装时读的）：

```powershell
node -e "for(const f of ['package.json','plugin/package.json']){const b=require('fs').readFileSync(f);console.log(f,b[0]===0xEF?'BOM ✗':'ok',JSON.parse(b.toString('utf8')).version)}"
```

`test/package-json.test.cjs` 锁住了这一条，还顺带锁了：根包 `files` 里必须有
`core/package.json` 与 `core/src`、根包不许 `private`、两份开发清单必须 `private`、
根与 plugin 的版本号一致。

### 命令 handler 必须返回 `CommandResult`，不是字符串

DSH 只接受这两个形状：

```js
{ kind: 'success', text?: string }
{ kind: 'error',   text:  string }
```

返回 `'已开启'` 这类裸字符串，TUI 里每次敲 `/yukkuri` 都只得到：

```
! /yukkuri
    command "yukkuri" handler must return a CommandResult
```

命令体一条都不会执行（2026-11-17 撞过）。做法：逻辑写在 `runCommand()`，
成功返回字符串、失败返回 `fail(msg)`，注册的 handler 只做包装。

### `pipeline.cjs` 的默认依赖走 `core-path.cjs`，别再写相对 require

`opts.extract` / `opts.segment` 没传时，`pipeline.cjs` 用 `requireCore('text/extract')`
去解析 —— 和插件入口同一套规则（见下面「core 怎么被找到」）。
**不要在这里写 `require('../../core/src/...')`**：那在源码仓库里恰好能解析到，
一装进 `node_modules` 就指向不存在的目录。

---

## core 怎么被找到（三层，顺序不能乱）

`plugin/lib/core-path.cjs` 是唯一入口，`index.js` 与 `pipeline.cjs` 都走它：

1. `YUKKURI_CORE_PATH` —— **给了就只认它**；指向不存在的目录会当场抛错，不静默回落
2. `<插件>/lib/../../core/src` —— 源码仓库形态，**也是发布包的形态**（core 随包分发）
3. `require.resolve('yukkuri-core')` 取 `dirname` —— 兜底：谁要是单独放了一份 core 进来

三层全不通才抛错，错误正文里带候选清单。**源码里不许出现写死的盘符路径**：
`test/no-hardcoded-paths.test.cjs` 会扫 `plugin/lib` 与 `core/src`（连注释一起扫）。

---

## 分发形态：一个仓库、一份对外清单

三份 `package.json`，**只有一份对外**：

| 清单文件 | 身份 | 谁在用 |
|---|---|---|
| `package.json`（仓库根） | **`dsh-yukkuri-tts` 0.3.0，唯一对外清单** | `add github:ODO-TECH/dsh-yukkuli`；DSH 市场索引（git 源）；插件索引扫描。**npm 不发**（2026-11-18 决策） |
| `plugin/package.json` | `private: true`，开发清单 | 只为在 `plugin/` 里跑测试（react / react-dom）。**别发** —— 它与根包同名 |
| `core/package.json` | `private: true`，开发清单 | 声明 `type: commonjs` + 在 `core/` 里跑测试。**别发** |

改运行依赖 / `files` 白名单 / 版本号 → 改**根**那份；改测试依赖 → 改 plugin 那份。
`private: true` 是防误发的护栏，别删。

### 仓库根 `package.json` 的三条硬要求

1. **`name` 必须与 `plugin/cordis.patch.yml` 里的 `name` 一致**（都是 `dsh-yukkuri-tts`），
   否则 patch 插进来的节点指向一个不存在的包。
2. **`dsh.bundle.patch` 必须存在**。只声明 `dsh.client` 没有 `dsh.bundle` = 装得上但**不会生效**，
   这是插件市场上最常见的被拒原因。
3. **`files` 里必须有 `core/package.json`**。根包是 `"type": "module"`，而 `core/src/*.js`
   是 CommonJS（`require`）；Node 按最近的 `package.json` 决定模块类型，少了 `core/package.json`
   （`"type": "commonjs"`）就会让 core 的 `.js` 被当 ESM，加载时报
   `ReferenceError: require is not defined in ES module scope`。

**第 3 条只在「真装进 profile」时才暴露** —— 仓库里的测试都从源码目录跑，永远走不到
`node_modules/` 那条路径。改完打包相关的东西，务必做一次装进临时 profile 的加载验证。

---

## 环境变量

| 变量 | 作用 | 备注 |
|---|---|---|
| `YUKKURI_CORE_PATH` | core 的 `src` 目录 | 指错会**当场报错**，不会静默回落 |
| `YUKKURI_SDK_ROOT` | AquesTalk SDK 根目录 | **必须纯 ASCII 路径**；默认 `~/yukkuri-sdk` |
| `YUKKURI_MPV` | mpv 可执行文件 | 仅 TUI 用；默认从 `PATH` 找 `mpv` |
| `YUKKURI_CFG_PATH` | 配置文件完整路径 | 测试用 |
| `YUKKURI_INTERVAL_MS` | 轮询间隔，默认 1500 | |
| `YUKKURI_KEEP_INSTANCES` | 设 `1` 时不停旧实例轮询 | **只为测幂等，平时别设** |
| `YUKKURI_MUTE` | 设 `1` 时 TUI 播放器不真出声 | **跑测试前必须设** |
| `YUKKURI_ENGINE` / `YUKKURI_ENDPOINT` | core 的引擎选择 | `local`（默认）/ `remote` |

> SDK 根也可以不设 env，直接改配置里的 `sdkRoot`（`/yukkuri sdk <路径>` 或设置页会写）。
> 两条路都只在**重启后**生效：core 在 `require` 那一刻就把 `SDK_ROOT` 定死了，
> 换路径必须清模块缓存 —— 插件已经会在 env/配置变化时自己清（`coreModulesFresh`），
> 但那只覆盖插件进程内的重载，最稳的仍是重启。

---

## 当前最该做的事（按优先级）

1. ✅ **仓库已建好并 push** —— 在 `dist/git-push/dsh-yukkuli/`（`dist/github/repo/` 的**拷贝**，
   别把 `.git` 放进通道目录，`pack.cjs` 会清它们）里 `git init -b main` + 提交 + `v0.3.0` 标签；
   远端 `main` @ `0ac3255`（93 文件）、`pushed_at 2026-11-17T12:54:38Z`。
   topic / description / LICENSE 追加段**已于 2026-11-18 处理完**（topics 走 `PUT /repos/…/topics`，
   `PATCH` 不吃 topics；三份 LICENSE 只留标准 MIT）。DSH 市场索引 `market/index.json` 已随
   GitHub Pages 上线并实测 200 / 零重定向。状态明细见 [`marketplace/README.md`](marketplace/README.md)。
2. **`test:run` 脚本** —— 把逐文件直跑固化下来，让 CI 与本地对得上。
3. **npm 不发了**（用户 2026-11-18 拍板：「太麻烦了」）。免 npm 的三条路都已落地：
   git 源市场索引（`market/index.json` + GitHub Pages）、Release 资产
   `v0.3.0/dsh-yukkuri-tts-0.3.0.tgz`（35 文件 / 74352 B，awesome 条目的 `tarball:` 指它）、
   awesome 收录 PR [#16451](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16451)。
   `dist/tarballs/` 里的 tgz 留作离线 / 免 npm 安装用。`plugin/` 与 `core/` 那两份清单是
   `private`，**任何时候都别发**。
4. ✅ **`repository` 字段** —— 三份 `package.json` 都已填（plugin / core 带 `directory`），
   根 README 的 `<这个仓库>` 占位也换成了真 URL。
5. **`plugin/package-lock.json` 与 `core/package-lock.json`** —— 实测仍在漂移
   （core lock `1.0.0` vs 包 `1.1.0`；plugin lock `0.2.0` vs 包 `0.3.0`）。
   **跑一次 `npm install` 会自愈**，别手改。暂存树里**刻意不带 lockfile**：
   带着漂移的 lock 会让 `npm ci` 直接失败。
6. **打包已固化成脚本** —— `node packaging/pack.cjs` 按通道暂存极简产物到 `dist/`，
   **不压缩、不发布、不联网**。压缩成 zip / tgz 与 `npm publish` 都是独立步骤，要人拍板。

完整清单见 [`HANDOFF.md`](HANDOFF.md) §6。

---

## 改完怎么验证「真的生效了」

profile 里装的是**快照拷贝**，不是软链接。改源码不会自动生效：

```powershell
dsh plugin --profile web add "file:<仓库绝对路径>"
# 然后重启 dsh web
```

装**仓库根**（运行依赖在根清单里），不是 `/plugin`。

觉得自己改了没反应，先查 `<DSH_HOME>\profiles\<profile>\node_modules\dsh-yukkuri-tts`
里的文件是不是旧的。

**还有个更阴的**：`package.json` 一旦带上 BOM，插件会**静默不加载**（见上面的陷阱），
表现和「改了没生效」一模一样。先跑那条 BOM 检查，再去怀疑快照。

---

## 文档一致性

- `synthe()` 返回 **Promise**（`await` 得 Buffer）。`core/README.md` 已经改成 async 写法；
  改实现时别退回同步签名。
- 根 `README.md` **只放使用者要的**：是什么 / 装 / 用 / 配置 / 排查 / 许可。
  维护者内容（打包产物、上架门槛、跑测试、通道差异）分别在 `HANDOFF.md` §8.5–§9、
  `marketplace/README.md`、本文、`plugin/README.md` —— **别往根 README 堆**。
- 改了测试数量、默认路径、环境变量，凡有这些数字的文档都要一起改（本文 / `HANDOFF.md` /
  `plugin/README.md` / `core/README.md`；根 README 刻意不带这些数）。
  现在的数是：plugin 24 文件 / 119 例，core 15 文件 / 90 例。
