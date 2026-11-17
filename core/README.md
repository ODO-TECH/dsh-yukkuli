# 合成核心 · core/

油库里语音合成核心。纯本地，不联网。

**不单独发 npm。** 它随 `dsh-yukkuri-tts` 一起分发 —— 装完就在包内 `core/src`，
插件按 `<包>/core/src` 找到它。这份文档讲核心自己的接口，供改代码或单独调用时看。

```js
const { synthe } = require('./src');        // 在 core/ 目录里
// 装进 profile 后：<profile>/node_modules/dsh-yukkuri-tts/core/src
```

## 接口

```js
const { synthe } = require('./src');

const wav = await synthe('你好，我是油库里', {
  voice: 'reimu',       // 角色 id（reimu/marisa/cirno/...）或预设（f1/f2/m1/...）
  emotion: 'happy',     // neutral happy angry sad surprised shy sleepy
  params: { pit: 130 }  // 直接覆盖任意声质参数（优先级最高）
});
// → Buffer，16kHz / 单声道 / 16bit WAV
```

| 导出 | 作用 |
|---|---|
| `synthe(text, opts)` | 主接口：文本 → WAV（async） |
| `toKoe(text)` | 只到音素这一步，用于调试 |
| `zh2jp(text)` | 中文 → 假名 |
| `hasChinese(text)` | 该走中文拼音路线吗 |
| `configure({engine, endpoint})` | 切换引擎 |
| `warmup()` | 预加载引擎 |
| `presets` | 预设声库与情绪表 |
| `presets.listAll()` | 全部声源（7 预设 + 6 角色） |
| `close()` | 释放 DLL |

## 东方角色音色

6 个东方角色按对照表各走各的引擎（AQTK10 原生 DLL / AQTK1 走 v86 模拟）：

```js
await synthe('我可是最强的！', { voice: 'cirno' });
await synthe('这种事情，用魔法一口气解决吧！', { voice: 'marisa', emotion: 'happy' });
```

| id | 角色 | 引擎 | 声库 |
|---|---|---|---|
| cirno | 琪露诺 | AQTK10 | F3 |
| tenshi | 比那名居天子 | AQTK1 | f1 |
| patchouli | 帕秋莉·诺蕾姬 | AQTK1 | f1（speed 92、pitch 1.04） |
| marisa | 雾雨魔理沙 | AQTK10 | F2 |
| reimu | 博丽灵梦 | AQTK10 | F1 |
| patchouli_bass | 低音炮帕秋莉 | AQTK1 | r1 |

> 蕾米莉亚 / 十六夜咲夜 / 伊吹萃香 已停用（试听后判定不对），所以 **AQTK2 没有角色在用** ——
> 引擎代码还在 `codec/aqtk2.js`，但用户不需要为它准备 SDK。

细节见 [core/docs/角色音色对照.md](https://github.com/ODO-TECH/dsh-yukkuli/blob/main/core/docs/角色音色对照.md)
（这份对照表只留在仓库里，**不随 npm 包分发** —— 包里只有运行文件）。

## 引擎

两个适配器满足同一个接口，所以这里是个真实的 seam：

```js
const { open, available } = require('./src/engine');
const e = await open({ kind: 'local' });   // 或 'remote'
await e.synthe(text, opts);                // → WAV Buffer
e.close();
```

| 引擎 | 状态 | 说明 |
|---|---|---|
| `local` | 可用 | AQTK10 + AqKanji2Koe 原生 DLL，六参数全开 |
| `remote` | 可用（需端点） | yukumo 风格 HTTP 端点，`{endpoint}/aqtk10/koe.mp3?...` |

切换方式：

```js
configure({ engine: 'remote', endpoint: 'https://your-proxy/' });
// 或环境变量 YUKKURI_ENGINE=remote YUKKURI_ENDPOINT=https://...
```

**未配置就报错，绝不静默降级** —— 这是刻意的：静默回落会让"我以为在用官网音质"变成一句谎言。

## 依赖的 SDK

放在 `~/yukkuri-sdk`（即 `%USERPROFILE%\yukkuri-sdk`；**必须是纯 ASCII 路径**，原因见下）：

```
aqtk10_win/lib64/AquesTalk.dll        合成引擎（六参数）
aqk2k_win/lib64/AqKanji2Koe.dll       汉字 → 音素
aqk2k_win/aq_dic/aqdic.bin            词典 9.8MB
```

用环境变量 `YUKKURI_SDK_ROOT` 可以改位置。

## 两个坑（都实测过）

### 1. SDK 路径不能含非 ASCII 字符

`AqKanji2Koe` 用 **ANSI 编码**读取词典路径。路径里有中文（比如把 SDK 放在
`<某个中文目录>\sdk`）时，`AqKanji2Koe_Create`
直接返回 NULL，错误码 200（「系统词典不正」），看起来像词典坏了，
其实是路径编码问题。

`describe()` 会同时报 `sdkRootIsAscii` 和一个 `hint`，先看那个。

**所以 SDK 必须放在纯 ASCII 路径下。**

### 2. 两个引擎要各自解锁

`AquesTalk` 和 `AqKanji2Koe` 各有一把独立的 `SetDevKey`。
只解一个不够：k2k 没解锁时会把 `なにぬねの` 转成 `ヌヌヌ'ヌヌ`，
后面合成再怎么调都救不回来。

## 许可证密钥

默认用 `src/kg.js` 现算（算法移植自 AquesPy 的 kg.py，已验证与 Python 输出逐字符一致），
**不落盘**。

接入正版 SDK 后，设环境变量即可切过去，代码不用改：

```
YUKKURI_AQTK10_DEV_KEY=xxxx-xxxx-xxxx-xxxx
YUKKURI_AQTK10_USR_KEY=xxxx-xxxx-xxxx-xxxx
YUKKURI_AQK2K_DEV_KEY=xxxx-xxxx-xxxx-xxxx
```

## 声质参数

| 参数 | 范围 | 默认 | 说明 |
|---|---|---|---|
| bas | 0/1/2 | 0 | 基础音素片 F1E/F2E/M1E |
| spd | 50–300 | 100 | 话速 |
| vol | 0–300 | 100 | 音量 |
| pit | 20–200 | 100 | 音高 |
| acc | 0–200 | 100 | 重音强度 |
| lmd | 0–200 | 100 | 声质1 |
| fsc | 50–200 | 100 | 声质2（改采样率） |

情绪是这些参数的**叠加偏移**，不是替换。所以三者的语气能听出差别而音色不乱。


## 数字读法

中文文本里的阿拉伯数字会先转成中文读法，再走拼音 → 假名。

**为什么必须转**：AqKanji2Koe 遇到阿拉伯数字会输出 `<NUMK VAL="8080">` 这样的标签，
而 AQTK10 按**日语**规则读数字 —— 中文回复里的 8080 会被念成「はっせんはちじゅう」。

| 原文 | 转成 | 说明 |
|---|---|---|
| `123` | 一百二十三 | 自然读法 |
| `10000` | 一万 | 整数末尾多个零，按自然读 |
| `2026 年` | 二零二六 年 | 年份逐位读 |
| `端口 8080` | 端口 八零八零 | 端口/编号/密码按位读 |
| `1.3.3` | 一点三点三 | 小数点每个都读 |
| `50%` | 百分之五十 | 百分号 |
| `-5` | 负五 | 负数 |

**日文文本不受影响** —— `わたしは 3 回` 里的 3 仍按日语读（サン），
因为日语读数字本来就是对的。

实现在 `src/text/numbers.js`，由 `prepareText()` 统一入口调用（中文才转）。
## 语言判断

判据是「**有没有假名**」而不是「有没有汉字」：

- 含假名 → 日文，直通 AqKanji2Koe
- 纯汉字 → 中文，先走 zh2jp 转假名

反例：`虐待` 是汉字但是日文词。只看汉字会把它读成拼音 `nü`，实际应读 `ギャク`。

## 测试

```powershell
# 逐个文件直跑 —— 别用 npm test（见下）
Get-ChildItem test\*.test.js | ForEach-Object { node $_.FullName }
```

**14 个文件、84 例**，覆盖：WAV 格式、情绪差异、参数钳制、中文转换、数字读法、
语言判断、分段、提取清洗、缓存、引擎接口、remote URL 形态、远端错误页识别、403 处理。

其中 7 个文件不碰 DLL（`cache` / `extract` / `numbers` / `pitch` / `remote-contract` /
`segment` / `zh2jp`），换机器时先用它们验环境。

> 为什么不用 `npm test`：它等于 `node --test`，runner 需要 spawn 子进程，
> 在受限沙箱里会整批 `Error: spawn EPERM / errno: -4048`。那是环境限制，不是代码坏了。

## 演示

```bash
node demo.cjs   # 生成 8 个样本到 ../output-core/
```