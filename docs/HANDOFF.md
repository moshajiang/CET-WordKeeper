# CET WordKeeper 开发交接文档

> 面向接手本项目的 AI/开发者。目标：不依赖前一个开发者的记忆，就能安全地继续开发与发布。
> 最后更新：2026-10-19（对应 v0.3.1，分支 release/v0.3.1）

---

## 1. 项目是什么

**CET WordKeeper**：Windows 桌面四六级学习软件。核心链路 = 做真题 → 点词查词/标注 → 生词本（带真题语境）→ SM-2 复习。附加：对照背诵、错题本、Anki 导出、难词预扫、知识库 + AI 问答/作文批改（用户自配 API）。

- 技术栈：**Electron 33 + Vue 3 + Vite 5 + sql.js（WASM SQLite，无原生编译）**
- 仓库：https://github.com/moshajiang/CET-WordKeeper（public）
- 本地路径：`D:\2026-10-09-16-27-21\cet-wordkeeper`
- 当前版本：**v0.3.1**（分支 `release/v0.3.1`，**未合并 main**；main 停在 v0.3.0）
- 仓库不含 node_modules/release*/dist；`data/keeper.db` 与 `data/seed/` 随仓库分发

## 2. 当前状态快照

| 项 | 状态 |
|---|---|
| 功能 | 全部 139 项 e2e 断言双态（开发态+发布载荷）通过 |
| 数据 | 78 套真题（CET4 32 / CET6 46，2014–2026）、词典 28,667 词、词频 7,894 |
| 对齐 | 311 篇译文篇章的 rows 已写死入库；审计 A 234 / B 64 / C 9 |
| 发布 | Release v0.3.1（分支上，资产已更新）；v0.3.0 及以前在 main |
| 用户 | 有真实用户（应用内自动更新链路已运转多版）；作者「默砂」在做抖音/TapTap 推广 |

## 3. 目录与模块地图

```
cet-wordkeeper/
├─ electron/main.cjs      主进程：39+ IPC 通道、migrate、syncSeedExams（增量同步）、
│                          update:check/install（electron-updater）、dict_lex 迁移、备份
├─ electron/preload.cjs   contextBridge（plain() 兜底，见 §9 坑1）
├─ electron/word-forms.json  ECDICT 没有的不规则变形/缩写兜底（主进程与 build-db 共用）
├─ src/views/             ExamLibrary/Home/Reader/Recite/Review/WordBook/Settings/Knowledge
├─ src/components/QuestionPanel.vue   四种题型渲染（cloze 下拉/match 字母/reading 选项/解析）
├─ src/utils/bilingual.js ★ 对齐引擎（v0.3 DP+锚点+词典评分）+ splitEn/splitZh/paragraphLetters
├─ src/utils/md.js        零依赖 Markdown（先转义再渲染，防注入）
├─ scripts/
│  ├─ build-db.mjs ★      ECDICT 裁剪 → dict 表 + lexMap → seed 解析 → healPassage →
│  │                      覆盖层合并 → rows 生成（写死绑定）→ keeper.db
│  ├─ verify-all.mjs ★    编排：清用户库 → 启动载荷/开发态 → 轮询 CDP → e2e-check → 清理
│  ├─ e2e-check.mjs ★     139 项断言（含大量界面级断言，走真实 UI 路径）
│  ├─ align-quality.mjs   对齐硬门（字母错位即失败）+ 锚点命中率
│  ├─ align-audit-report.mjs  逐篇审查（证据分级 A/B/C）→ docs/align-audit-report.md
│  ├─ check-secrets.mjs   密钥泄漏闸门（git 直调，不走 cmd.exe）
│  ├─ gen-answers.mjs     AI 预生成答案/解析/翻译（需 KEEPER_AI_KEY，独立复核+仲裁）
│  ├─ fetch-exams.mjs / parse-docx.mjs    docx 支线（2014–2019）
│  ├─ fetch-pdf-exams.mjs / pdf-extract.py / parse-pdf.mjs / scan-pdf-quality.mjs
│  │                      PDF 支线（2020 起，质量门禁 readLen<2000 拒收）
│  ├─ sync-check.mjs      老用户增量同步测试
│  └─ word-audit.mjs      词典查得率审计（应 100%）
├─ data/seed/             每套一个 JSON（content/questions），题目与正文在此修
├─ data/ai-answers/       每套一个覆盖层 JSON（AI 预生成的 translation/reference/analysis）
├─ data/keeper.db         分发库（含预置 rows/答案/解析/翻译）
└─ docs/                  align-upgrade-plan.md（对齐方案）、align-audit-report.md、本文件
```

## 4. 架构要点

### 4.1 数据流（用户侧）
安装/首启 → 复制 `data/keeper.db` 到 `%APPDATA%\cet-wordkeeper` → migrate（补列/建 dict_lex）→ syncSeedExams（按级别+年+月+套号**只新增不覆盖**）→ 正常运行。

### 4.2 对齐引擎（v0.3.1 写死绑定架构，本项目核心特性）
- **构建期**：build-db 对每篇带译文篇章调 `alignBilingual(content, translation, lexMap, {blankNums})`，结果审计后存 `passage.rows`（JSON：[{en,zh,para}]）
- **运行时**：ReaderView/ReciteView **优先直读 `p.rows`**（零计算）；仅用户 JSON 自导入（无预置行）回退运行时 `alignBilingual(..., lexCache)`（词典映射经 IPC `dict:lex` 加载）
- 引擎：单调 DP（Gale-Church 概率模型 + 罚分表 {11:0,12:230,21:230,22:440,10:450,01:450}）+ 数字锚点 Dice（W_NUM=6）+ ECDICT 词典评分（W_LEX=5）；校准常量 C_RATIO=1.58、S2_RATIO=0.47（579 个锚点 1-1 行实测）
- markerAligned（长篇阅读字母配对）：认 `A)` **和 `[A]`** 两种形态；缺字母软退化（留空并入邻行）；**内容无损门**（译文覆盖 <97% 回退句级 DP，防止整段译文被丢——曾踩坑覆盖率最低 44%）
- 理论参考：Gale & Church 1993；Champollion（LDC）；multi-align（github tanyaqiong31029/multi-align，MIT，DP 骨架出处）

### 4.3 预置内容哲学
答案/解析/范文/参考译文/对齐行**全部构建期预置**——用户无需 API Key 即可做题/交卷/看解析/背诵。AI 只在 gen-answers（构建期）与用户聊天/批改（运行时，需自配 Key）出现。改对齐/内容 = 改数据，不是改运行时行为。

## 5. 验证体系（改任何东西前后都要跑）

```bash
cd D:\2026-10-09-16-27-21\cet-wordkeeper
node scripts/build-db.mjs        # 改了 seed/ai-answers/build-db 后
node scripts/verify-all.mjs      # 139 项，必须全绿才能提交/发布
node scripts/align-quality.mjs   # 对齐硬门（verify-all 已含）
node scripts/align-audit-report.mjs  # 逐篇 A/B/C 报告 → docs/align-audit-report.md
node scripts/word-audit.mjs      # 改词典/词形后，查得率应 100%
```

- verify-all 流程：清隔离用户库 → 启动（开发态或 `ELECTRON_EXE` 指定的载荷）→ **CDP 轮询就绪（最长 45s，勿改回固定 sleep）** → e2e-check.mjs → 清理
- 环境变量：`ELECTRON_EXE`（验证发布载荷）、`SKIP_AUX_GATE=1`（沙箱进程派生故障时，先在 shell 手跑 check-secrets + align-quality 再跳过内置执行）
- **verify-all 必须清用户库**：应用只在用户库不存在时从种子初始化，残留会拿脏数据跑断言
- e2e 断言必须含**界面级**验证（驱动真实 UI：填值派发 input、点按钮、读回 DOM）——只测 `window.keeper.*` IPC 层测不出「页面调不通」（本项目踩过 3 次，每次都废掉用户核心功能）

## 6. 发布流程（标准作业程序）

1. `package.json` bump version
2. `node node_modules/vite/bin/vite.js build`（**不要用 npx/npm 直跑**，见 §9）
3. `node scripts/verify-all.mjs` 全绿
4. `node node_modules/electron-builder/out/cli/cli.js --win --config electron-builder.json -c.directories.output=release-vNN`（**每次换全新输出目录**，见 §9 删除守卫）
5. git 提交（当前模式：发布走 `release/vX.Y.Z` 分支，不直接动 main）
6. **先 push 分支**，再用 REST API 建 Release（`target_commitish=<分支>`）并上传 **4 个资产**：两个 exe（**ASCII 名**）+ `latest.yml` + `blockmap`（缺 latest.yml 更新器 404）
7. 载荷验证：`SKIP_AUX_GATE=1 ELECTRON_EXE=<win-unpacked 路径> node scripts/verify-all.mjs`
8. 脚本参考：`_tmp-trash/gh-release-031.mjs`（REST API 全流程，支持 GH_TOKEN 环境变量）

## 7. 数据修复操作手册

- **修单篇对齐/内容**：改 `data/seed/<套>.json`（正文/题目）或 `data/ai-answers/<套>.json`（译文/解析/参考译文）→ `node scripts/build-db.mjs` → `node scripts/align-audit-report.mjs` 复查该篇 → verify-all → 走发布流程
- **2019.12 六级第 3 套**是手工修复样例（原 match 挂的是选词填空正文、选词填空整篇缺失、翻译篇错为荷花）——修复脚本在 `_tmp-trash/restore-set3.mjs` 可作参考
- **新增真题**：docx 走 fetch-exams（注意 §9 套号坑），PDF 走 fetch-pdf 支线；seed JSON 落盘后 build-db；syncSeedExams 会把新套推给老用户
- **页眉页脚**：build-db `isExamJunkLine`（compact 通配：去空格/符号后含年份+四级/六级+真题/考试 ≤70 字）+ `cleanHeaderLine`（行首页眉粘连正文时只剥前缀）；e2e 有全库 0 残留闸门

## 8. 已知限制与待办

| 项 | 说明 |
|---|---|
| 9 篇 C 级篇章 | 漂移 2 次或归一化后锚点命中 <20%（清单见 align-audit-report.md）；逐篇取证显示无内容丢失，疑似局部对齐待精修；rows 写死架构下可逐篇修数据 |
| 老用户 dict_lex 不落盘 | migrate 的修改在 sql.js 内存态，每次启动重建（约 2s，功能无碍）；可优化为启动时保存 |
| ~17 个考次未纳入 | 源仓库纯扫描件无文字层，需 OCR（Tesseract 中文效果差，未做） |
| NSIS 安装器 GUI 流程 | 沙箱无法实测（禁止 GUI 进程）；win-unpacked 载荷等价验证已覆盖 |
| B 级 64 篇 | 锚点命中 45% 以下但无错位证据（多为译文数字改写）；可考虑 AI 语义校对（需 Key） |
| 用户自导入真题 | 无预置 rows，运行时对齐（引擎可用）；导入时也可考虑构建期生成 |

## 9. 沙箱与环境坑（血泪清单，按踩坑频率排序）

1. **node -e 内联脚本带反引号必炸**——任何稍复杂的补丁一律写成 `.mjs` 文件再 `node xxx.mjs`（本项目踩了 5+ 次）
2. **Write 工具文件首行别写 `#` 注释**（Markdown 习惯混入 .mjs 会 SyntaxError；已犯 3 次）
3. **进程派生 EBUSY**：沙箱宿主偶发大面积拦截 spawnSync（git/cmd.exe/node），症状 `spawnSync xxx EBUSY`。对策：verify-all/check-secrets 已内置 spawnRetry 自动重试；check-secrets 改 git 直调不走 cmd.exe；发布脚本优先 `GH_TOKEN` 环境变量（Bash 里 `git credential fill` 取，勿打印）
4. **`ELECTRON_RUN_AS_NODE=1`**：宿主注入会让 electron 变纯 node（`app` undefined）。spawn 前必须 delete；手动启动验证也要 `unset ELECTRON_RUN_AS_NODE`
5. **electron 启动参数**：`--no-sandbox --disable-gpu` 必带；无显示器下 CDP 截图前先 `Emulation.setDeviceMetricsOverride` 强制重绘
6. **npx/npm 间接拉 wsl 被拦**：直调入口——`node node_modules/vite/bin/vite.js build`、`node node_modules/electron-builder/out/cli/cli.js ...`
7. **累积删除守卫（>50 次删除/轮拦截）**：electron-builder 重建已有输出目录必撞 → 每次用**全新输出目录**（release-v25、v26…已用到 v25）；`release*/` 已 gitignore
8. **输出目录被句柄占用**：EBUSY/EPERM 删不掉 → 新产物逐个 `mv` 进去，冲不掉的 `app.asar` 用 `cp` 覆盖（md5 校验）
9. **bash PATH 偶尔被 shim 破坏**（`dirname: command not found`）→ 命令前显式 `export PATH="/usr/bin:/bin:/c/Windows/System32:<node>/bin:$PATH"`
10. **GitHub 资产名剥非 ASCII**（中文文件名 422 already_exists）→ 资产名必须 ASCII；**latest.yml + blockmap 必传**否则更新器 404
11. **新建 .exe 无法执行（EACCES）**：沙箱 ACL → 用读文件/读源码方式取证；NSIS 安装器无法实测

## 10. 代码级坑（改代码前必读）

1. **IPC 不能传 Vue 响应式对象**：结构化克隆抛 "An object could not be cloned." 且**静默失败**（页面永远空白/按钮无反应）。preload 有 `plain()` 兜底 + 调用点显式展开 `{...x.value}`
2. **`question.options` 在 DB 是 JSON 字符串**：前端必须 `parseOpts()`/`JSON.parse` 后再用；直接 `.map`/`.find` 会 TypeError 且整块渲染中止
3. **空号标记形态多样**：`26`、`26stress`（紧贴）、`__37__`、`32 _reduces`、甚至 36–45 编号——替换/排除用「前后非数字」边界，勿用 `\b`；排除集用**本篇 cloze 题干号**而非硬编码 26–35
4. **match 段落标记两形态**：`A)` 与 `[A]`（2019.12 set3 修复数据是方括号）——markerAligned 已两者都认；内容无损门（覆盖 <97% 回退句级）防整段译文丢失
5. **ECDICT `exchange` 字段**：`0:` 是原形指针，p/d/i/3/s 是变形列表；词形还原用「变形优先」
6. **套号解析多模式**：源命名有 `第1套/第一套/卷二/（全1套）/真题1/（第三套)`，需撞名检测（曾静默丢 10 套）
7. **PDF 支线坑**：`Part III`→`Part in`、罗马数字 `Ⅱ` 无 `\b`、选项两栏、词库排进 Section B 中间、续行 `47 hours…` 误判题号（题号须带小数点且在区间内）
8. **NSIS LogicLib 的比较全是字符串比较**（`==` 即 StrCmp）：`"1" != "0x0001"` 恒假——勾选框状态判断用 `${BST_CHECKED}`；include 被前置，页面函数必须放进 `customPageAfterChangeDir` 宏
9. **文案承诺的交互必须有 UI 级断言**（复习卡整卡点击、桌面快捷方式勾选两个 bug 都是「绑定目标错位」）
10. **源文本瑕疵在数据管线修**：healSpacing（标点后空格）、healGlued（of/the/their 粘连，仅词典词）、healPassage 分 section；补丁后必须立刻跑一次验证防 ReferenceError

## 11. 用户产品约定（长期有效，勿违背）

1. **AI 必须由用户自行配置**，绝不内置任何 Key；未配置时相关功能优雅降级（返回 no_key，绝不静默失败）
2. 软件正式名：**CET WordKeeper**（GitHub 资产名 ASCII）
3. 真题**软件预置**且支持用户 **JSON 自导入**扩展（设置页）
4. **不要**听力对照功能、**不要**统计看板
5. 附加功能范围：错题本、Anki 导出、难词预扫
6. 生成答案/解析用 `deepseek-flash`（不要 deepseek-v4-pro，更贵更慢）；推理型模型 token 预算给足（生成 16000 / 复核 8000）
7. Key 来源：环境变量 `KEEPER_AI_KEY`/`KEEPER_AI_BASE`，否则读本机遗留用户库 settings；**Key 绝不能进仓库**（check-secrets 闸门兜底）
8. 推广渠道策略：抖音端只给**搜索词**（GitHub 搜 CET WordKeeper，外链有限流风险），可点链接放 TapTap；视频介绍文档在用户 Obsidian `taptap聚光灯\CET WordKeeper\`

## 12. 历史脉络（版本线）

0.1.0 首发开源（48 套）→ 0.1.x 快捷方式/更新/复习卡修复 → 0.2.0 夜间模式+进度记忆+筛选（正式版）→ 0.2.1–0.2.3 数据净化/对齐器/回跳 → 0.2.4–0.2.6 内联对照/审计闸门/预扫 → 0.2.7 对照背诵对齐体检 → 0.2.8 DP 动态规划 → 0.2.9 数据修复（2019.12 set3）→ 0.2.10 页眉规则 v2 → **0.3.0 对齐引擎换代（DP+锚点+词典）** → **0.3.1 写死绑定 + 方括号标记 + 无损门（当前，分支）**

完整逐日记录见 `.workbuddy/memory/2026-10-*.md`（917 行，含每个 bug 的根因分析）。


## 2026-10-22 AI 页面助手开发

已把阅读器小聊天框抽成全局可展开面板，增加真实原文高亮、附近讲解、多处标注浏览、篇章/题目定位和阅读展示操作。实现与验证入口见 [AI-PAGE-ASSISTANT.md](AI-PAGE-ASSISTANT.md)。基于已发布 v0.3.2 的开发改动，尚未制作新发行包；原有发行标签不变。


## 2026-10-22 知识库改进

新增全文阅读、检索分类、个人笔记编辑与内置条目复制；原文讲解可先审阅为草稿，再保存来源并返回对应篇章高亮。旧资料增量迁移，保存/删除失败回滚，旧备份兼容。实现与专项测试见 [KNOWLEDGE-LIBRARY.md](KNOWLEDGE-LIBRARY.md)，运行 `npm run test:knowledge`。本轮通过 11 项数据回归与 16 项真实界面检查，仅检查知识库相关功能。开发分支尚未打包发布。
