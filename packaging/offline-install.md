# 离线安装（没网的机器看这个）

解压后只有一个目录 `dsh-yukkuri-tts/`，里面是：

- 插件与合成核心的**运行文件**（`plugin/lib`、`core/src`，不含测试与开发文档）
- **已经装好的 `node_modules/`** —— 所以这一步不需要联网
- 本说明（`安装.md`）

## 0. 先确认这台机器有 Node.js ≥ 22

```powershell
node -v      # 要 v22 以上
```

Node 运行时本身不在包里，得先装好。

> ⚠️ 包里的 `node_modules/` 是 **Windows x64** 的预编译二进制（`@koromix/koffi-win32-x64`）。
> 换平台（Linux / macOS / ARM）不能直接用，要在有网的机器上重新 `npm install --ignore-scripts`。

## 1. 装进 DSH

```powershell
dsh plugin --profile web add "file:<解压目录绝对路径>\dsh-yukkuri-tts"
```

然后在 profile 的 `package.json`（默认 `%USERPROFILE%\.dsh\profiles\web\package.json`，
`DSH_HOME` 指到别处时跟着走）里确认 `dsh.profile.bundles` 数组包含 `dsh-yukkuri-tts`，**重启 DSH**。

验证层真的生效了：

```powershell
dsh --profile web --dump-config | Select-String yukkuri -Context 0,1
```

应当看到 `- id: yukkuri-tts` / `name: dsh-yukkuri-tts`。看不到就是没装进去，不是插件的问题。

### 如果 `dsh plugin add` 自己就报错

受限环境里 pnpm 10+ 的全局操作锁可能写不进去（`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`），
这与包本身无关。手工装等价：

1. 把 `dsh-yukkuri-tts/` 整个拷到 `<profile>/node_modules/dsh-yukkuri-tts/`；
2. 在 profile 的 `package.json` 里补 `"dependencies": { "dsh-yukkuri-tts": "0.3.0" }`
   与 `"dsh": { "profile": { "bundles": ["dsh-yukkuri-tts"] } }`；
3. 跑上面那条 `--dump-config` 确认。

## 2. 别忘了 AquesTalk SDK

本包**不附带** SDK 二进制（许可证原因）。需要你自己从 [yukumo.net](https://www.yukumo.net/)
取得 AquesTalk10 与 AqKanji2Koe，**两个就够**，放成这个结构：

```
%USERPROFILE%\yukkuri-sdk\
├── aqk2k_win\lib64\AqKanji2Koe.dll  +  aq_dic\aqdic.bin
└── aqtk10_win\lib64\AquesTalk.dll
```

天子 / 帕秋莉 / 低音炮帕秋莉走 AquesTalk1 —— 那个引擎由包内的 `aquestalk.js`（v86 模拟）
在本地跑，**不用你另外下 SDK**。

装在别处就设 `YUKKURI_SDK_ROOT` 指过去。

> ⚠️ SDK 路径**不能含中文**：AqKanji2Koe 用 ANSI 读词典路径，中文会让它 Create 失败，
> 报「システム辞書(aqdic.bin)が不正」—— 看着像词典坏了，其实是路径编码问题。

## 3. 出声检查

DSH 里：设置页 → 「油库里」→ 勾「自动朗读」→ 选声线 → 勾选要听的会话 → 点「试听」。

没声音按这个顺序查：

1. 包根的 `package.json` 有没有 BOM（带 BOM 会让 DSH **静默跳过**整个插件）；
2. 装完有没有**重启** DSH；
3. SDK 路径是不是纯 ASCII、文件是不是齐；
4. `watch` 列表里有没有你的会话（默认一个都不听，这是刻意的）。

TUI 端还需要 `mpv` 在 PATH 里（或设 `YUKKURI_MPV`）；Web 端不需要。