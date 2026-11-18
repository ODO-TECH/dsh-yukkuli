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
6. **仓库创建满 1 天**（awesome 的 CI 自动查，用来过滤「PR 前几分钟才建仓」）——
   这条检查**会自己重跑**，所以 PR 可以先提，门槛到点自动变绿，不必干等；
7. `category` 选贴合实际做的事 —— 本插件是 `voice`，不是 `tools`。

**npm 不是前置条件**：没发 npm 也能被 dsh.so / dsh.works / awesome 的**列表**收录，安装命令写
`github:ODO-TECH/dsh-yukkuli` 即可。

但有一处例外，2026-11-18 读他们源码实测：awesome 生成 **DSH 市场索引**的脚本
（`scripts/lib/market-index.mjs`）只把**有 npm 包**的条目写进去 ——
`if (!record?.npm) { skipped.noNpm++; continue; }`，注释写着「The GitHub-only half of the list
cannot be expressed yet」，因为他们不记录 commit SHA。那是他们的数据缺字段，**不是 DSH 格式的限制**。
所以「进了 awesome 就等于进了 DSH 市场」这句话对不发 npm 的插件**不成立**。
不发 npm 又要进 DSH 市场，走下面这节自建索引。

## DSH 自带的「发现」页：自建索引（本仓库已备好，不需要 npm）

DSH **不内置任何索引源**。「发现」页读的是使用者自己添加的一个 `index.json` 网址。
本仓库的 `market/index.json` 就是这份索引（format 1），已用 DSH 自带的
`@deepseek-ai/dsh-plugin-market-index`（0.2.2-rc.3，与本机 dsh 同版本）`parseMarketIndex` 校验通过：

- 版本 `0.3.0`，`source` 是 **git**：`{url, commit: 0f05314…}`（40 位小写 SHA）
- 点「安装」时 DSH 实际执行的 spec = `git+https://github.com/ODO-TECH/dsh-yukkuli.git#0f0531490bff2d2cf25ba850e0ae049cd85f5379`
- 托管：仓库开 GitHub Pages（Source = Deploy from a branch / main / `/(root)`），
  网址 `https://odo-tech.github.io/dsh-yukkuli/market/index.json`；
  根目录的 `.nojekyll` 让 Pages 原样直出，不走 Jekyll

索引的硬规则（违反会被 DSH 整份拒绝）：UTF-8 JSON、**2xx 直接返回且不经重定向**、
URL 不含用户名密码与 `#`、默认 ≤128 MiB；图标可内联 `data:`（≤32 KiB）或与 `icons/` 并排用相对路径。

使用者那边两步：插件页 → 实验性插件 → 打开**自定义插件索引** → 出现「发现」标签页 →
**添加索引源**填上面那个网址。索引源**属于当前 profile**，每个 profile 各加一次。

awesome 条目里的 `tarball:` 字段是另一条免 npm 的路（让卡片展示预构建包而不是源码构建）：
必须指向 **GitHub Release 资产**、`.tgz` / `.tar.gz` 结尾。本仓库的
`dist/tarballs/dsh-yukkuri-tts-0.3.0.tgz` 就是它，只差建一个 Release 挂上去。

## 现在差什么（2026-11-18 复查）

| 项 | 现状 | 还要做的 |
|---|---|---|
| 仓库内容 | `main` 已含 `market/index.json` 与 `.nojekyll`（**95 文件**）；标签 `v0.3.0` 仍停在 `0ac3255`（其后都是文档/索引提交，代码相同） | 推送后核对远端 `main` 与 `pushed_at` |
| topics | ✅ `["aquestalk","cordis","dsh-plugin","touhou","tts"]`（`PUT /repos/…/topics` 200） | 无 |
| description | ✅ 事实描述（`PATCH /repos/…` 200） | 无 |
| license | 三份 `LICENSE`（根 / plugin / core）的 `---` 追加段**已删**，只留标准 MIT；免责声明副本在根 README「许可」 | 推送后复查 API `license.spdx_id` 应为 `MIT` |
| 创建时间 | `2026-11-17T10:38:10Z` | 门槛在 **11-18 10:38Z** 到点；检查会自己重跑，PR 可先提 |
| GitHub Pages | ✅ `has_pages: true`；索引网址 **200 / 零重定向**，返回字节与仓库文件逐字节一致 | 无 |
| Release | ✅ `v0.3.0`（id 449466221）+ 资产 `dsh-yukkuri-tts-0.3.0.tgz`（**74052 B**，state uploaded；LICENSE 删段后重 pack 并替换过资产，现 id 761643017），下载回来逐字节一致 | 无 |
| awesome PR | ✅ [#16451](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16451)（open，fork `ODO-TECH/awesome-dsh-plugin`） | 等维护者合并；年龄门槛到点自动变绿 |

**2026-11-18 已执行完毕**（用会话环境里的 `GITHUB_PERSONAL_ACCESS_TOKEN`，命令文本只出现变量名）。
实测一个坑：**`PATCH /repos/…` 不接受 `topics`** —— 返回 200、description 生效，但 topics 仍是 `[]`。
topic 必须走专用端点 `PUT /repos/<owner>/<repo>/topics`，正文 `{"names":[…]}`。
下面这条 PATCH 只用来改 description（留着当模板）：

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
