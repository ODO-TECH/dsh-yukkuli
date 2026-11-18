# dsh-yukkuri-tts

DSH 油库里朗读。把会话里的话，用本地 AquesTalk10 念出来。

**不依赖浏览器、不依赖任何网页端。** 声音直接从 [`../core/`](../core) 合成出来。

> **第一次接手这个仓库？先读根目录的 [`../README.md`](../README.md)。**
> 那里有安装前提（尤其是 AquesTalk SDK 怎么放）、快速开始和常见问题。
> 这一份讲的是插件自己的接口、路由、命令，以及踩过的坑。

**运行前提**：插件本身只是壳，真正合成靠 [`../core/`](../core) 和本机的 AquesTalk SDK。
两者缺一个都出不了声 —— 详见下面的[依赖](#依赖)。
**core 随 `dsh-yukkuri-tts` 一起分发**（不单独发 npm），装完就在包内 `core/src`。

---

## 它做什么

```
DSH 会话结束一轮
      ↓
  文本筛选（只留自然语言，代码/表格/URL 不念）
      ↓
  分段（按假名长度切，避免合成失败）
      ↓
  AQTK10 逐段合成（带内存缓存）
      ↓
  HTTP 路由 → 前端 / TUI 播放
```

## 三个部件

| 文件 | 职责 | 测什么 |
|---|---|---|
| `lib/watch.cjs` | 从会话事件里挑出「说完一整轮」的话 | 轮次完成判定、首次不回放、游标推进 |
| `lib/pipeline.cjs` | 文本 → 提取 → 分段 → 合成 | 顺序、失败隔离、逐段回调 |
| `lib/poller.cjs` | 定时轮询会话事件（自带 `setInterval`） | 启动即 tick、`.unref()`、可在运行中改间隔 |
| `lib/core-path.cjs` | 定位 core：环境变量 → 同仓库 → `node_modules` | 三层顺序、env 指错就失败、错误里带候选清单 |
| `lib/player-tui.cjs` | TUI 侧：临时 WAV → spawn mpv → 播完删 | 队列顺序、失败隔离、清理临时文件 |
| `lib/index.js` | DSH 插件主体：路由 + 命令 + 轮询 | 路由注册、命令响应、生命周期 |
| `lib/client.js` | Web 界面：回复按钮 + 设置页 | 插槽注册、组件渲染 |

`.cjs` 与 `.js` 混用不是笔误：`package.json` 是 `"type": "module"`，宿主入口
`lib/index.js` 必须是 ESM，而几个纯逻辑模块用 CommonJS 写（`require` 直读，测试
不需要转译）。**改文件时别顺手把 `.cjs` 改名成 `.js`** —— 那会让它们被当成 ESM 解析而报错。

除了 spawn mpv 的那一个，其余全是纯逻辑，能脱离 DSH 测 —— **23 个文件、111 项测试，不碰 DLL**。

---

## 安装

插件以一个 profile 的依赖身份存在，装进去要**两步**：进 profile 的依赖表，再进 `bundles` 列表。

### 1. 装进 profile

```powershell
# 从本仓库源码装（开发期最常用：改完源码重跑这一条 + 重启就生效）
dsh plugin --profile web add "file:<仓库绝对路径>"
```

装的是**仓库根**，不是 `/plugin`：运行依赖（koffi / pinyin-pro / aquestalk.js /
pinyin-to-kana）声明在根清单里，`plugin/package.json` 只是 `private` 的开发清单。

**npm 没发**（2026-11-18 决定），所以 `add dsh-yukkuri-tts` 这种包名写法装不到。
免 npm 的另外两条路（core 都随包在内，只装这一个包）：

```powershell
dsh plugin --profile web add github:ODO-TECH/dsh-yukkuli
```

或在 DSH「发现」页添加索引源 `https://odo-tech.github.io/dsh-yukkuli/market/index.json`
（插件页先开实验性「自定义插件索引」），卡片点安装，走的是 git 源。

`dsh plugin` 只是把参数**原样转发给 pnpm**（在 profile 目录下执行），所以
`add` / `remove` / `why` 这些 pnpm 子命令都能用。

### 2. 加进 bundles

装完还得让 profile **加载**它 —— 编辑 `%DSH_HOME%\profiles\<profile>\package.json`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [ "…", "dsh-yukkuri-tts" ]
    }
  }
}
```

漏了这一步的症状：`node_modules` 里明明有、`/yukkuri` 却不存在。

### 3. 重启 DSH

`bundles` 在启动时读取，改完要重启进程。

> ⚠ **profile 里装的是快照副本，不是软链接。**
> 实测 `profiles\web\node_modules\dsh-yukkuri-tts` 是一个**实体目录**（`LinkType` 为空），
> 里面 lib/ 与 test/ 的 SHA256 与源目录逐文件相同。所以**改源码不会自动生效**，
> 改完必须重跑第 1 步重新装一次，再重启 DSH。觉得自己改了没反应，先查这里。

### 卸载

```powershell
dsh plugin --profile web remove dsh-yukkuri-tts
```

再把名字从 `bundles` 数组里删掉。

---

## 打包

打包统一走仓库根的 [`packaging/pack.cjs`](../packaging/pack.cjs)，它按分发通道把**必要文件**
暂存到 `dist/` 下（不压缩、不发布）：

```bash
node packaging/pack.cjs          # 在仓库根跑
```

发布包对应 `dist/npm/dsh-yukkuri-tts/`：**35 个文件**（`npm pack --dry-run` 实测，解包约 194 kB）。
它是**仓库根**那份清单打出来的：`plugin/lib` + `cordis.patch.yml` + `core/src` +
`core/package.json` + 各级 README / LICENSE。`test/`、`docs/`、`demo*.cjs`、lockfile 都不进包。

要真出 tarball，在暂存目录里跑 `npm pack`（受限环境的三个注意事项见下）：

```powershell
$env:npm_config_cache = "<仓库根>\.npm-cache"
node "<npm 安装目录>\node_modules\npm\bin\npm-cli.js" pack --pack-destination "<绝对路径>"
```

> 用 `npm-cli.js` 而不是 `npm`：受限环境里 `npm.cmd` 会被当成外部命令再 spawn 一层。
> `--pack-destination` 也**必须给绝对路径**，且那个目录**必须先存在**（见下面的坑 2）。
>
> **别把体积当判据。** 这份 README 自己就在包里 —— 改一次文档，包就大一点；
> 所以这里的数字只能写"约"。真正的判据是 `npm pack --dry-run` 打出的**文件清单**，
> 以及 `dist/manifests/npm.txt`（逐文件明细）。

**三个实测撞过的坑：**

1. **默认 npm cache 在受限沙箱下会 `EPERM`。**
   `C:\Users\<你>\AppData\Local\npm-cache\_cacache\tmp\...` 打不开。
   必须把 `npm_config_cache` 指到工作区内。
2. **`--pack-destination` 的目标目录必须先存在。**
   不先建 `dist\` 会直接 `ENOENT: ...\dist\dsh-yukkuri-tts-0.3.0.tgz`（退出码 -4058）。
3. **`npm pack --dry-run` 在 npm 11 下退出码是 1，但清单是正常的。**
   别拿退出码判成功 —— 看 stdout 里有没有 `filename:` 那一行。

**白名单在仓库根那份 `package.json` 的 `files` 里**：`plugin/lib`、`plugin/cordis.patch.yml`、
`core/package.json`、`core/src`、`README.md`、`LICENSE`。所以 `test/`、`docs/`、`demo*.cjs`、
lockfile 都不进包；回归测试留在仓库里，clone 下来就有。

两条别踩：

- **`core/package.json` 不能从白名单里删。** 它声明 `type: commonjs`，而根包是 `type: module`；
  Node 按最近的 `package.json` 判模块类型，少了它 core 的 `.js` 会被当 ESM，装完直接
  `ReferenceError: require is not defined in ES module scope`。仓库里的测试碰不到这条路径。
- **README / LICENSE 删不掉。** npm 把它们当「always included」，连 `!plugin/README.md`
  这种否定写法也压不住（实测）—— 所以是 **35** 文件而不是 31。

---

## 测试

```powershell
# 逐个文件直跑 —— 唯一可靠的入口
Get-ChildItem test\*.test.cjs | ForEach-Object { node $_.FullName }
```

或者直接 `npm test` —— **但在受限沙箱里会整批失败**，见下。

### 为什么不能信 `npm test`

`npm test` = `node --test --test-concurrency=1`。`node --test` 的 runner 会
**spawn 子进程**跑每个文件，而受限环境下 spawn 是被禁止的：

```
Error: spawn EPERM
  errno: -4048, code: 'EPERM', syscall: 'spawn'
```

根因不在测试里 —— 连 `child_process.execFileSync(process.execPath, ['-e','console.log(1)'])`
都报 `spawn FAILED: EPERM`。**这是环境限制，不是测试失败。**

`node --test --test-isolation=none` 能绕过 spawn，但会让 4 个用例互相污染
（它们都在改 `globalThis` 上的共享状态，同进程跑就串味）：

- `release.test.cjs` — 播不出来的段可以还回队列
- `host.test.cjs` — 插件被 apply 两次时旧实例的轮询被停掉
- `turn-once.test.cjs` — 同一轮只合成一次（2 例）

所以：**逐文件直跑是唯一能与 CI 对得上号的跑法**。加一个 `test:run` 脚本把这件事固化，
是接手后值得做的第一件事。

---

## 接口

### HTTP 路由

| 路径 | 方法 | 作用 |
|---|---|---|
| `/dsh-yukkuri/state` | GET | 当前配置、队列长度 |
| `/dsh-yukkuri/config` | POST | 改配置（watch / voice / emotion / enabled） |
| `/dsh-yukkuri/sessions` | GET | 会话列表（给设置页勾选） |
| `/dsh-yukkuri/pending?after=<id>` | GET | 取待播段（**一次性投递**，拉走即消耗） |
| `/dsh-yukkuri/release` | POST | 把没播成的段还回队列 |
| `/dsh-yukkuri/audio?id=<id>` | GET | 取某段 WAV |
| `/dsh-yukkuri/speak` | POST | 念指定的一条回复（{sessionId, messageId}） |
| `/dsh-yukkuri/say` | POST | 立刻念一句（试听） |
| `/dsh-yukkuri/clear` | POST | 清空队列 |
| `/dsh-yukkuri/stats` | GET | 诊断：apply 次数 / 触发次数 / 挡住重复次数 / 队列段数 |

### 命令（Web 与 TUI 共用）

| 命令 | 作用 |
|---|---|
| `/yukkuri` / `status` | 状态（开关、监听、声源情绪、模式、上限、队列） |
| `/yukkuri help` | 全部用法 |
| `/yukkuri on` / `off` | 开关（**on 只绑定当前会话**） |
| `/yukkuri mode [auto\|tui\|web]` | 声音往哪送 |
| `/yukkuri watch` | 看监听名单 |
| `/yukkuri watch <id\|all\|none\|current>` | 改监听名单 |
| `/yukkuri voice [id]` | 不带参数列出全部声源；带参数切换（`reimu` / `marisa` / `f1` …） |
| `/yukkuri emotion [id]` | 不带参数列出全部情绪；带参数切换 |
| `/yukkuri maxkana [n]` | 每段假名上限（10-500，默认 100） |
| `/yukkuri interval [ms]` | 轮询间隔（300-10000，**立即重启定时器**） |
| `/yukkuri keep [n]` | 内存保留段数（5-500，改小会立刻裁掉旧的） |
| `/yukkuri say <文本>` | 立刻念一句（TUI 下直接播放） |
| `/yukkuri stop` | 停掉 TUI 播放队列 |

改完就写进配置（`yukkuri-tts.json`），重启后还在。
声源 / 情绪打错不会静默失败：会回一句「没有这个声源」并把可选项列出来。


---

## Web 界面

装好后有两处：

### 每条助手回复下面

两个小图标：**▶ 用油库里念这一条** / **⏸ 停止**。

点 ▶ 会调 `/speak`，宿主找到那条消息的文字 → 分段合成 → 前端按顺序播。

### 设置页「油库里」

| 区块 | 能做什么 |
|---|---|
| 自动朗读 | 总开关 |
| 声音 | 声源（6 个角色 + 7 个预设）、情绪、试听 |
| 听哪些会话 | 勾选框列表 |
| 播放 | 继续 / 清空队列 |

---

## 两端的差异

| | Web | TUI |
|---|---|---|
| 选会话 | 设置页勾选，可多选 | `/yukkuri watch <id>` |
| 开关 | 设置页开关 | `/yukkuri on` / `off` |
| `/yukkuri on` | 开总开关 | 开总开关 **+ 只看当前会话** |
| 声源 / 情绪 | 下拉框 | `/yukkuri voice` / `emotion`（不带参数即列表） |
| 分段上限 / 轮询间隔 / 保留段数 | 只在 web 侧改 JSON 或设置页没有的项 | `maxkana` / `interval` / `keep` |
| 播放 | 浏览器 `<audio>` | 通过 HTTP 路由（可用 mpv 播） |
| 手动念一条 | 点 ▶ | `/yukkuri say <文本>` |
---

## 配置

存在 `~/.dsh/yukkuri-tts.json`：

```json
{
  "enabled": true,
  "watch": [],
  "voice": "reimu",
  "emotion": "neutral",
  "maxKana": 100,
  "intervalMs": 1500,
  "keepSegments": 40
}
```

`watch` 为空 = 一个都不听（与 dsh-tts-bridge 一致，不主动出声）。

---

## 缓存策略

**纯内存 LRU，不落盘。** 理由：

- 合成一段只要 ~8ms，重算成本几乎为零，落盘收益抵不过管理成本
- 语音内容不留在硬盘上
- 不用管目录清理

代价是进程重启后缓存清空 —— 对 8ms/段 的速度来说可以忽略。

实测加速比：**598 倍**（36ms → 0.06ms）。

---

## 依赖

插件**自己几乎不依赖什么**（`devDependencies` 只有 react/react-dom，且只为跑测试），
真正的重量都在它调用的那个 core 上。

### 1. `core/` —— 必须存在（随包分发）

路径按这个顺序找（`lib/core-path.cjs`，有测试锁住这个顺序）：

1. `YUKKURI_CORE_PATH` 环境变量 —— 给了就只认它；指错目录会**当场报错**，不静默回落
2. `<插件目录>/lib/../../core/src` —— 源码仓库形态，**也是发布包的形态**（core 在包内）
3. `require.resolve('yukkuri-core')` 拿到的 `src` 目录 —— 兜底：谁单独放了一份 core 进来

三条都不通会抛一个把候选路径全列出来的错误。**源码里没有任何写死的绝对路径**
（`test/no-hardcoded-paths.test.cjs` 长期盯着这件事）。

找不到 core 的症状是插件加载时报错、所有朗读路由 404。

### 2. AquesTalk SDK —— 路径不能含非 ASCII

默认在 `~/yukkuri-sdk`（即 `%USERPROFILE%\yukkuri-sdk`），可用 `YUKKURI_SDK_ROOT` 覆盖。

> ⚠ **路径必须是纯 ASCII。** AqKanji2Koe 用 ANSI 读词典路径，中文路径会让
> `AqKanji2Koe_Create` 返回 NULL，报「システム辞書(aqdic.bin)が不正、または
> 辞書パスの文字コード不正」。这条是实测撞出来的，不是推测。

SDK 里要有什么、许可证密钥怎么给，见 [`../core/README.md`](../core/README.md)。

### 3. `core/node_modules` —— 已装好

core 的运行时依赖（实测版本）：

| 包 | 版本 | 干什么 |
|---|---|---|
| `koffi` | 3.3.8 | 调 DLL（FFI） |
| `pinyin-pro` | 3.29.5 | 汉字 → 拼音 |
| `pinyin-to-kana` | 1.0.1 | 拼音 → 假名 |
| `aquestalk.js` | 1.0.7 | AQTK1 的 WASM 后端 |
| `v86` | 0.5.473 | 跑 AQTK1 的 x86 模拟器 |

### 4. mpv —— 只有 TUI 需要

默认从 `PATH` 里找 `mpv`，可用 `YUKKURI_MPV` 覆盖，或调用时传 `mpvPath`。
Web 端不用它（走浏览器 `<audio>`）。

### 5. Node / DSH 版本

实测通过的环境：Node **v24.13.0**（`package.json` 声明 `>=22`）、DSH **0.2.2-rc.1**。


---

## 两个踩过的坑（都在真机上撞过）

### 1. `webServer` 不能写进 `inject`

TUI 端没有 `webServer`。把它声明成硬依赖，插件在 TUI 里**整个拒绝加载**。
现在 `export const inject = ['sessions']`，`webServer` / `sessionTitle` 全走 `ctx.inject`。

测试里有一条专门锁这个：`assert.ok(!mod.inject.includes('webServer'))`。

### 2. `ctx.interval` 需要 `timer` 服务

Cordis 的 `ctx` 是代理对象，没 inject `timer` 就读 `ctx.interval` 会抛：

```
cannot get property "timer" without inject
```

**症状很阴**：插件日志显示「已加载」，但轮询根本没启动 —— 界面上一切正常，就是不朗读。
现在改成自带 `setInterval`（`.unref()` 不拖进程），两端都稳。

---

## TUI 怎么出声

TUI 里没有人在听 `/audio?id=`，所以 TUI 走另一条：

```
WAV → 临时文件 → spawn mpv --no-video → 播完删文件
```

> **别拿「有没有 webServer」当 TUI 的判据。** TUI profile 里也有一行
> `dsh-tui-webserver`（`@deepseek-ai/dsh-host-webserver`，为 OAuth 挂在
> `127.0.0.1` 的随机端口，实测 11240）。0.2.4 就栽在这上面：插件以为前端在听，
> 把音频全塞进 `/pending`，而 TUI 没有浏览器来取 —— 加载正常、开关开着、一句不响。
> 0.2.5 起改看「有没有人轮询 `/pending`」。

- mpv 从 `PATH` 里找，可用 `YUKKURI_MPV` 覆盖
- 临时文件播完即删（语音内容不留硬盘）
- 队列播放：一段接一段，中间不留空隙

### TUI 里必做的一件事：重启

**重启 DSH** 才认新代码 —— profile 里是快照副本，不是软链（见「安装」一节）。

理论上还要 `/yukkuri on`（把当前会话写进 `watch`），但 0.2.3 起**不用了**：

TUI 没有勾选界面，`watch` 里常常留着别的会话 id（在 Web 端选过、或者干脆是上一个
工作区的会话）。这时插件加载正常、开关也开着，却一句都不念，而且毫无提示。

现在的兜底：轮询满 4 轮后，如果 `watch` 里没有任何一个 id 在当前进程的会话列表里，
就**退化成「念当前进程里的会话」**，并打一行警告说明自己换了名单。
想固定下来（写进配置、重启后还在）就 `/yukkuri on`。

三个前提缺一不可，都是为了不误伤 Web 端：

| 前提 | 为什么 |
|---|---|
| 从来没被浏览器轮询过 `/pending` | Web 端客户端 1.5s 就拉一次；TUI 里没人拉（有 `webServer` 不算数） |
| 已经轮询过 4 轮 | 给 webServer 注册留时间，也避开启动瞬间 |
| 名单为空或全不在线 | 名单里只要有一个在线，就说明用户选过了，不许扩大范围 |

### 声音往哪送：`mode` 与自动判断

一条合成出来的音频只有两个去处：

- 进广播队列，等浏览器轮询 `/pending` 来取（Web）
- 直接 spawn mpv（TUI）

判据是一个**粘性**标志 `clientPolls`：只要 `/pending` 被拉过一次，这个进程就永远算 Web。
不做「最近 N 秒还活着吗」的新鲜度判断 —— 浏览器切到后台会把定时器节流到一分钟一次，
按新鲜度算的话，用户切个标签页，下一轮就突然从服务器音箱里冒出来了。

配置里可以强制：`"mode": "auto" | "tui" | "web"`（默认 `auto`）。
TUI 里也能改：`/yukkuri mode tui`。判断结果在两处可见：

| 位置 | 字段 |
|---|---|
| `GET /dsh-yukkuri/state` | `deliver`（现在走 `tui` 还是 `web`）、`mode`（配置值） |
| `GET /dsh-yukkuri/stats` | `clientPolls`（浏览器拉过几次）、`hasWebServer` |

只有交给浏览器的段才标 `broadcast`。TUI 放过的段不进待播队列 ——
否则以后有浏览器接上，会把之前听过的东西再念一遍。

### 播放层去重（第四道防线）

`claimTurn` 只管到**合成**。段进了共享队列之后，理论上任何拿到队列的实例都能把它
交给播放器，所以播放前还有一道 `playedIds`（`globalThis.__yukkuriPlayed`）：
同一个段 id 在这个进程里最多播一次，超过 1000 条按插入顺序裁掉一半。

`/dsh-yukkuri/stats` 里的 `plays` 是**真正交给播放器**的段数（`/state` 的 `diag.plays` 同值）。
它比 `segments` 小，就说明这一环在挡。

### 改完 package.json 检查 BOM

DSH 用 `JSON.parse` 读本包的 `package.json`，开头带 UTF-8 BOM 时会打印
`skipping profile bundle "dsh-yukkuri-tts"` 并**整包跳过** —— 插件不加载、没有路由、
没有任何日志，重启多少次都不响。PowerShell 的 `Set-Content -Encoding utf8` 会写 BOM，
别用它改这个文件。`test/package-json.test.cjs` 有断言。

### 跑测试时别叫醒扬声器

`YUKKURI_MUTE=1` 让 TUI 播放器只记账、不落盘、不 spawn mpv。

`test/tui-autobind.test.cjs` 会加载**真 core、真插件**（因为它要验证的正是配置 +
轮询 + 合成的整条链路），不静音的话跑一次单测就在用户扬声器里念一遍 ——
2026-11-17 就撞过：用户在 TUI 里听见朗读「重复了好几遍」，其实那是我跑测试的声音。
测试里的断言是 `stats.plays === 段数`，静音后照样成立。

### 命令 handler 的签名（踩过，症状很隐蔽）

DSH 的命令 handler 只收到**一个对象**：

```js
{ commandId, agent, rawInput, attachments, signal }
```

早先按 `handler(args, meta)` 写，于是 `args` 变成这个对象本身，
`String(args).trim()` 得到 `'[object Object]'` —— **任何子命令都匹配不上**，
`/yukkuri on` 永远回「未知子命令」，当前会话也就永远绑不进 `watch`，
最终表现是「TUI 下自动朗读一句都不响」。会话 id 在 `invocation.agent.session.id`。

**返回值也必须是 `CommandResult`，不能是字符串。** 返回 `'已开启'` 这类裸字符串时，
DSH 会把整个命令判失败：

```
! /yukkuri
    command "yukkuri" handler must return a CommandResult
```

形状只有两种：

```js
{ kind: 'success', text?: string }
{ kind: 'error',   text:  string }
```

本插件的做法：具体逻辑写在 `runCommand()` 里，成功返回字符串、失败返回
`fail(msg)`（即 `{kind:'error', text}`），注册的 handler 只做一层包装。
加子命令时不用到处包对象，但**别忘了失败时用 `fail()`**，否则错误会被显示成普通结果。

回归测试：`test/command-invocation.test.cjs`（两种调用约定 + `CommandResult` 形状都锁住了）。
所有测试通过 `test/result-text.cjs` 的 `wrap()` 调 handler —— 它先校验形状再取 `text`。

---

## 环境变量

| 变量 | 作用 |
|---|---|
| `YUKKURI_CORE_PATH` | core 的 `src` 目录（core 随包分发，正常**不用设**；指错会当场报错） |
| `YUKKURI_CFG_PATH` | 配置文件的完整路径（测试用；默认 `<DSH_HOME>/yukkuri-tts.json`） |
| `YUKKURI_INTERVAL_MS` | 轮询间隔，默认 1500 |
| `YUKKURI_MPV` | mpv 可执行文件路径 |
| `YUKKURI_KEEP_INSTANCES` | 设为 `1` 时，新实例**不**停掉旧实例的轮询（只为测幂等闸门，平时别设） |
| `YUKKURI_MUTE` | 设为 `1` 时 TUI 播放器只记账不 spawn mpv（跑测试用，免得扬声器突然出声） |

下面这些是 **core 的**，不是插件的，但要出声同样得对：

| 变量 | 作用 |
|---|---|
| `YUKKURI_SDK_ROOT` | AquesTalk SDK 根目录（**必须纯 ASCII 路径**） |
| `YUKKURI_ENGINE` | `local`（默认）或 `remote` |
| `YUKKURI_ENDPOINT` | `YUKKURI_ENGINE=remote` 时的 HTTP 端点 |
| `YUKKURI_CACHE_SIZE` | core 内存缓存容量，默认 500 |
| `YUKKURI_AQTK10_DEV_KEY` / `YUKKURI_AQTK10_USR_KEY` / `YUKKURI_AQK2K_DEV_KEY` | 许可证密钥；不给则每次启动现算 |

---

## 已知限制

| 限制 | 原因 |
|---|---|
| 段落只保留最近 40 个 | 内存上限，长会话翻历史取不到旧音频 |
| 音频不落盘 | 刷新页面后旧段取不回来（但会重新合成，很快） |
| TUI 的 `on` 只读当前会话 | 按需求设计，TUI 没有「听谁」的界面 |
---

## 手动朗读 vs 自动朗读（两条独立的路）

| | 触发 | 音频送到哪 |
|---|---|---|
| **自动朗读** | 被监听的会话说完一轮 | 进广播队列（`/pending`），浏览器轮询取走 |
| **手动朗读** | 点小喇叭 ▶ / `/yukkuri say` | 直接返回给调用方，**不进广播队列** |

这个区分是必须的。早期两者共用一条队列，结果是：

- 点一次小喇叭念**两遍**（自己播一次 + 轮询又拉一次）
- 按暂停后又被轮询拉回来，感觉「停不掉」

现在手动朗读的段带 `broadcast: false` 标记，`/pending` 会跳过它们。

## 一次性投递：真正让「一句只响一遍」

重复播放这件事试过三版修法，前两版都不够，值得记下来。

**第一版：只让一个标签页出声。** 用 `localStorage` 选主，抢到
`yukkuri-tts-leader` 的标签页才轮询，心跳 3 秒、6 秒过期接管。
→ 仍然会重复。原因有两个：脚本被加载多次时窗口内有多个实例；
以及主标签页的心跳只在抢锁那一刻写过，之后就停了，6 秒后别的标签页
认为它已经死了，纷纷接管，最后每个都以为自己是主。

**第二版：客户端单例。** 把 `player` / `leader` / `autoplay` 挂到
`window.__dshYukkuri`，后来者复用。→ 缓解了同窗口内的多实例，
但跨标签页仍然要靠选主，选主一旦判断失误就重现。

**第三版（现在）：把裁决权交回服务端。** `/pending` 是**一次性投递**——
一段被谁拉走，那一刻就打上 `delivered`，后面任何请求都拿不到。
不管客户端有几个实例、开了几个标签页、心跳算得准不准，
一个段只可能被投递一次，因此只可能响一次。

代价是：拉走它的那个客户端如果没能播（浏览器拦截自动播放），这段就没人播了。
所以配一个发还机制 —— `play()` 被拒绝时客户端调 `POST /release` 把 id 还回去，
下一轮还能被取走：

```
POST /dsh-yukkuri/release   { "ids": ["12", "13"] }
→ { ok: true, released: 2 }
```

这是刻意的取舍：**漏播一次可以点小喇叭补，叠加播五遍却必须停下来**。
两种情况都能被用户发现，但后者的体验是灾难。

选主逻辑仍然保留（少一些无谓轮询），但不再承担「不重复」这个职责 ——
那个职责现在在服务端。

**第四版（也是真正的根因）：同一个轮次被合成多次。**
一次性投递只保证「同一段不被拉两次」，它挡不住「同一轮被做了 N 次」。
插件被重复 `apply`（热重载、多次注入）时，每个实例都有一套自己的
watcher + poller + 队列闭包，同一轮 `onTurn` 跑 N 次，合成出 N 套
**id 各不相同**的段，每套各被投递一次 —— 于是同一句话依次响 N 遍，
按暂停只能停住当前那个。这解释了「长文本触发 5 次、停掉 4 个还剩 1 个」。

三处改动，都在 `plugin/lib/index.js`：

1. **轮次幂等**：处理前先 `claimTurn(sessionId, turn)`，抢不到就跳过。
   幂等表挂在 `globalThis.__yukkuriSeenTurns`，因为闭包不共享，挂实例上
   等于每个实例各记各的、谁都挡不住谁。
2. **共享队列**：段表和 id 计数器也挂 `globalThis.__yukkuriStore`。
   各持一份的话，路由被后注册实例覆盖、合成却发生在先注册实例上，
   结果是「听不到」—— 比念两遍更糟。
3. **停掉旧实例**：新实例启动时把上一份的 poller 停掉。多个 poller 本身
   没有意义，幂等只是兜底。`YUKKURI_KEEP_INSTANCES=1` 可关掉这个行为，
   测试用它来验证幂等闸门本身。

还有一处客户端的：`play()` 的失败回调原先对所有错误都 `POST /release`，
但 Chrome 在 `play()` 尚未落地时换 `src` 会抛 `AbortError`（自己打断自己），
那段其实已经播了，还回队列下一轮又取到 —— 又变成念两遍。现在只对
`NotAllowedError`（真正被自动播放策略拒绝）发还。

设置页的「诊断」块直接显示这三个数：**插件加载 N 次 · 触发 N 次 ·
挡住重复 N 次**。`加载次数 > 1` 说明旧实例还在，重启 DSH 清掉。

## 会话列表里为什么会看到「未加载」

`ctx.sessions.list()` 只返回**当前进程加载过的会话**（源码注释：All live sessions）。
磁盘上的其它会话要等你切过去打开一次才会进来。

所以列表里可能出现：

- 正常行：当前可监听的
- **（未加载）**：你勾选了，但它现在不在进程里 —— 暂时监听不到，切过去打开一次就恢复

没加载的会话直接不显示会让「我明明勾了三个，这里只显示两个」变成谜。
---

## 客户端为什么必须是单例

DSH 有时会把客户端脚本加载多次（HMR、多次注入）。每加载一次就执行一遍脚本，
如果各建一份播放器和轮询，后果是：

- 同一段音频被播**好几遍**（每个实例各自轮询 `/pending`，各拉一次）
- 多个 `<audio>` 同时响，暂停只停得住当前这个

而手动点小喇叭只响一次 —— 因为按钮组件绑定的是**第一个**实例的播放器，
只有自动轮询这条路会因为多实例而重复。

所以 `player` / `leader` / `autoplay` 全部挂在 `window.__dshYukkuri` 上，
后来者直接复用：

```js
const G = (window.__dshYukkuri = window.__dshYukkuri || {});
const player = G.player || (G.player = { /* ... */ });
```

脚本被重复加载时，控制台会打印累计次数（不影响使用）：

```
[油库里] 客户端脚本被重复加载，累计 3 次（播放器与轮询仍只有一份）
```

看到这句不用管 —— 它是在告诉你「又一次加载被安全地并入了」。
