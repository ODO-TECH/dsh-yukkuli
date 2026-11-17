# 上架物料（marketplace）

这个目录放的是「把插件挂到社区索引里」要交的东西。它不参与运行，只是待提交的材料。

| 文件 | 交给谁 | 怎么交 |
|---|---|---|
| `ODO-TECH__dsh-yukkuli.yml` | [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（唯一需要人工提 PR 的目录） | fork → 把本文件**原名**放到 `data/plugins/ODO-TECH__dsh-yukkuli.yml`（owner 与 repo 之间是**两个**下划线）→ 开 PR。**别改它的 README**，那是脚本从数据生成的 |
| `dsh-plugin.org-issue.md` | https://dsh-plugin.org/zh/submit | 复制 Issue 模板正文，补截图，提交 |
| `badge.md` | 自己仓库的 `README.md` | **收录通过之后**再把徽章贴到标题下 |

## 其它自动索引，不用交东西

这几处靠「仓库上有没有 `dsh-plugin` topic」和「仓库根的 `package.json` 里有没有 `dsh.bundle`」自动发现，
前提是这两样都在：

- 仓库设置里加 topic：`dsh-plugin`
- 仓库根 `package.json` 里有 `dsh.bundle.patch`（本仓库有）

对上了，`dsh.so` / `dsh.works` / `dsh-plugin-radar` / `dshmarket` 就会各自抓取；`dshmarket` 只吃 awesome 目录，
所以那份 PR 是唯一的「必须人工」动作。

## 提交前必须为真的几件事

这些是硬门槛，写错了会被拒，不是文风问题：

1. 仓库**公开**，且已打 `dsh-plugin` topic；
2. 仓库根有 `package.json`，并且它声明了 `dsh.bundle.patch`（只写 `dsh.client` 是不够的 ——
   这是最常见的被拒原因，因为那样根本装不上）；
3. 插件**导出 `apply(ctx)`**；
4. README 里的安装命令能照着跑通（我们写了四条途径，任意一条都行）；
5. 描述只说事实，不要「最好用 / 革命性」这类营销词 —— 描述会被当作对代码的声明核对，
   写了某个命令或某个数字，代码里就得真有；
6. **仓库创建满 1 天**（awesome 的 CI 自动查，用来过滤「PR 前几分钟才建仓」）；
7. `category` 选贴合实际做的事 —— 本插件是 `voice`，不是 `tools`。

**npm 不是前置条件**：没发 npm 也能被 dsh.so / dsh.works / awesome 收录，安装命令写
`github:ODO-TECH/dsh-yukkuli` 即可。`dshmarket` 只吃 awesome 的 catalog，所以进了 awesome
就等于进了市场。

## 现在差什么（2026-11-17 push 之后复查）

| 项 | 现状 | 还要做的 |
|---|---|---|
| 仓库内容 | ✅ **已 push**：`main` @ `0ac3255`（93 文件）+ 标签 `v0.3.0`，`pushed_at 2026-11-17T12:54:38Z` | 无 |
| topics | `[]` | 仓库设置里加 `dsh-plugin`（或下面那条 API 命令） |
| description | 仍是营销腔英文（"Hakurei-shrine-tier … heavily based"） | 换成下面的事实描述 |
| license | API 报 **`NOASSERTION`** —— MIT 正文是标准的，但 `LICENSE` 末尾用 `---` 追加了 SDK/东方免责段，识别器因此不认 | 把那段挪走（README「许可」里已有副本）后重新识别成 MIT |
| 创建时间 | `2026-11-17T10:38:10Z` | awesome 的 PR 要等 **11-18 10:38 之后**再提 |

一条命令把 topic 与 description 一起设掉（需要一个 `repo` 权限的令牌，Desktop 侧不允许程序读取 git 凭据）：

```bash
curl -X PATCH https://api.github.com/repos/ODO-TECH/dsh-yukkuli \
  -H "Authorization: Bearer <你的 PAT>" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d '{"description":"Yukkuri voice for DeepSeek Harness: reads assistant replies aloud locally through AquesTalk, with no network calls.","topics":["dsh-plugin","tts","aquestalk","touhou","cordis"]}'
```

建议的仓库 description（与 `ODO-TECH__dsh-yukkuli.yml` 的 `en` 同口径）：

```
Yukkuri voice for DeepSeek Harness: reads assistant replies aloud locally through AquesTalk, with no network calls.
```

## 一条命令自检

```bash
node -e "const p=require('./package.json');console.log(p.name,p.version,'bundle=',p.dsh&&p.dsh.bundle&&p.dsh.bundle.patch,'client=',!!(p.dsh&&p.dsh.client))"
```

应当输出 `dsh-yukkuri-tts 0.3.0 bundle= ./plugin/cordis.patch.yml client= true`。
