# 油库里朗读插件 · dsh-yukkuri

> !?⑨⑨?!是正宗幻想乡口音！？

**让DSH里的回复用油库里语音朗读出来(ᗜˬᗜ)**

合成全部在本地完成：文本 → 假名 → 音素 → WAV。不调用任何在线 TTS，不依赖浏览器，
音频不出机器。Web 端在你正在看的那个标签页出声，TUI 端交给 mpv。

- **六个声线**：灵梦 / 魔理沙 / 琪露诺 / 天子 / 帕秋莉 / 低音炮帕秋莉
- **七种情绪**：平静、高兴、生气、难过、惊讶、害羞、困倦
- **只念这一轮说完的话**：不念思考过程、不念工具输出、不念旧消息，同一段只念一遍
- **长回答边合成边播**：按假名长度切段，不用等整段合成完
- **中文也能念**：汉字先转假名，数字按中文读法（`123` → 一百二十三）

试听样本在 [`output-chars/`](https://github.com/ODO-TECH/dsh-yukkuli/tree/main/output-chars)（6 个 wav，六个声线各一条）。

---

## 安装

### 前置条件

- **Windows**（目前只在这上面验证过）
- **Node.js ≥ 22**、**DSH**（`dsh` 命令可用）
- **AquesTalk SDK** —— 需自行取得，本仓库**不包含**它的二进制
- **mpv** —— 只有 TUI 端需要，Web 端不用

### 1. 放好 SDK

从 [yukumo.net](https://www.yukumo.net/) 取得 **AquesTalk10** 与 **AqKanji2Koe** 两个库，
按这个结构放好（默认就找 `~/yukkuri-sdk`）：

```
%USERPROFILE%\yukkuri-sdk\
├── aqk2k_win\
│   ├── lib64\AqKanji2Koe.dll
│   └── aq_dic\aqdic.bin
└── aqtk10_win\
    └── lib64\AquesTalk.dll
```

两个就够了：天子 / 帕秋莉 / 低音炮帕秋莉走 AquesTalk1，那个引擎由依赖里的
`aquestalk.js`（v86 模拟）在本地跑，**不用你另外下 SDK**。

装在别处就设环境变量 `YUKKURI_SDK_ROOT` 指向它。

> ⚠️ **路径必须是纯 ASCII。** AqKanji2Koe 用 ANSI 编码读词典路径，路径里带中文会让它
> Create 失败，报「システム辞書(aqdic.bin)が不正、または辞書パスの文字コード不正」。
> 这个错误看起来像词典坏了，其实是路径编码问题。

### 2. 装插件

```bash
dsh plugin --profile web add github:ODO-TECH/dsh-yukkuli
```

合成核心随包分发，**不用另装第二个包**。装完**重启 DSH**。
本插件**没发 npm**，所以 `add dsh-yukkuri-tts` 这种包名写法装不到，别用。

另外三条途径装的是同一个东西：

| 途径 | 命令 |
|---|---|
| DSH「发现」页 | 插件页打开实验性「自定义插件索引」→ **发现** → 添加索引源 `https://odo-tech.github.io/dsh-yukkuli/market/index.json` → 卡片点安装 |
| 本地源码 | `git clone https://github.com/ODO-TECH/dsh-yukkuli.git` 后 `dsh plugin --profile web add "file:<仓库绝对路径>"` |
| 离线包 | 解压后 `dsh plugin --profile web add "file:<解压目录>\dsh-yukkuri-tts"`，细节见包内 `安装.md` |

离线包自带装好的依赖（Windows x64，约 27 MB），目标机器不用联网。

>其实最简单的就是把本仓库的链接直接丢给大肥鱼，然后一杯茶的功夫就装好了。（少女写代码中...）

### 3. 确认真的装进去了

```bash
dsh --profile web --dump-config | grep -A1 yukkuri-tts
```

应当看到 `- id: yukkuri-tts` / `name: dsh-yukkuri-tts`。看不到就是没装进 profile，
不是插件的问题。

---

## 用起来

打开设置页 →「油库里」：勾上「自动朗读」→ 选声线 → 勾选要听的会话。
之后助手每说完一轮就会念出来。

**默认一个会话都不听** —— 这是刻意的，刚装好就开始念会吓人。

也可以直接用命令：

```
/yukkuri status            看状态
/yukkuri on                开（TUI 下顺便只听当前会话）
/yukkuri off               关
/yukkuri watch all         听所有会话
/yukkuri watch current     只听当前会话
/yukkuri voice cirno       换声线
/yukkuri emotion happy     换情绪
/yukkuri say 那句要念的话    试听
```

---

## 配置

配置文件在 `~/.dsh/yukkuri-tts.json`（`DSH_HOME` 指到别处时跟着走）。设置页改的就是它。

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

| 键 | 作用 |
|---|---|
| `enabled` | 自动朗读总开关 |
| `watch` | 要听的会话 id；空数组 = 一个都不听 |
| `voice` / `emotion` | 声线与情绪（见下） |
| `maxKana` | 每段最长假名数（引擎上限 100） |
| `intervalMs` | 轮询间隔（毫秒） |
| `keepSegments` | 内存里最多保留多少段 |

### 声线

| voice | 角色 | 引擎 |
|---|---|---|
| `reimu` | 博丽灵梦 | AquesTalk10 F1 |
| `marisa` | 雾雨魔理沙 | AquesTalk10 F2 |
| `cirno` | 琪露诺 | AquesTalk10 F3 |
| `tenshi` | 比那名居天子 | AquesTalk1 F1 |
| `patchouli` | 帕秋莉 | AquesTalk1 f1（音高 +4%、语速 92） |
| `patchouli_bass` | 低音帕秋莉 | AquesTalk1 R1 |

> 蕾米莉亚 / 十六夜咲夜 / 伊吹萃香 试过之后**已停用**（音色不对，见对照表），
> 所以配置里没有 `remilia`，也不需要 AquesTalk2 的 SDK。

`emotion`：`neutral` / `happy` / `angry` / `sad` / `surprised` / `shy` / `sleepy`

音色参数与引擎细节见 [core/docs/角色音色对照.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/core/docs/角色音色对照.md)。

---

## 没有声音？按这个顺序查

1. **`watch` 里有没有你的会话。** 默认一个都不听。
2. **SDK 路径是不是含非 ASCII。** 见上面的警告；本机 SDK 不在默认位置时要设 `YUKKURI_SDK_ROOT`。
3. **改完源码有没有重装 + 重启。** 从 tarball 装进 profile 的是快照拷贝，不重装不生效。
4. **TUI 里没声音、Web 里正常** → PATH 里没有 `mpv`，或设 `YUKKURI_MPV` 指向它。
5. **`/yukkuri` 命令没反应** → 多半是插件根本没加载。查插件包根的 `package.json` 有没有
   UTF-8 BOM：DSH 用 `JSON.parse` 读它，带 BOM 会**静默跳过整个包**（日志里只有一句
   `dsh: skipping profile bundle …`）。用编辑器另存为 UTF-8 无 BOM。

开两个标签页不应该听见两遍 —— 只有 leader 标签页播。真听到两份就是选主坏了，
开一个无痕窗口对比一下。

---

## 已知限制

- **只在 Windows 上验证过**（koffi + Windows DLL）。
- **单次合成上限约 100 假名**，所以长回答按段切；中文转假名会膨胀约 2.3 倍，占更多段。
- **缓存是纯内存**，进程重启就没了，上限 500 条。
- 不做语音克隆、不做流式合成。

---

## 许可

代码以 **MIT** 发布，见 [LICENSE](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/LICENSE)。

**不包含 AquesTalk SDK 的任何二进制或词典**。AquesTalk / AqKanji2Koe 的使用条款归
[eBike / 株式会社アクエスト](https://www.aquestalk.com/) 与 yukumo.net 所有，请自行取得并遵守其许可。
东方 Project 及角色的相关权利归上海アリス幻樂団 / ZUN 所有。
本项目是非官方的同人工具，与上述各方无关联。

---

## 更多文档

这些文档都在仓库里（npm 包只带运行文件）：

| 文档 | 内容 |
|---|---|
| [plugin/README.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/plugin/README.md) | 插件接口、HTTP 路由、命令、设置面板、环境变量、Web/TUI 差异 |
| [core/README.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/core/README.md) | 合成核心的接口与声质参数 |
| [HANDOFF.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/HANDOFF.md) | 架构、硬约束、四条分发通道、打包产物布局 |
| [AGENTS.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/AGENTS.md) | 在本仓库干活的规矩：怎么跑测试、三条禁令 |
| [marketplace/README.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/marketplace/README.md) | 上架物料与硬门槛（维护者） |
| [packaging/offline-install.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/packaging/offline-install.md) | 离线包内的 `安装.md` 原文 |
| [WORKLOG.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/WORKLOG.md) | 踩坑史 |