# CET WordKeeper 开发交接文档

> 面向接手本项目的 AI/开发者。目标：不依赖前一个开发者的记忆，就能安全地继续开发与发布。
> 最后更新：2026-10-30。当前发布分支 release/v0.3.4；新增桌面功能及自动更新随 v0.3.4 打包，详见 [发行记录](RELEASE-0.3.4.md)。v0.3.3 原标签和附件不变。下文早期快照按历史保留，最新状态见文末逐日记录。
> 后续开发按 [LEARNING-ROADMAP.md](LEARNING-ROADMAP.md)；P1、P2 调度/负担控制与可选 FSRS 新卡试用工程、P3 短语/语境义/拼写填空/含出处导出已完成；实际学习效果继续观察，已补充待确认的 AI 释义候选，P4 方案、协议与独立移动演示/实际本地存储已完成，下一批 A2 接设备身份、签名文件与联合事务。

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


## 2026-10-22 v0.3.3 安装包

已在 release/v0.3.3 分支生成 Windows x64 安装版、便携版与自动更新配套文件。实际成品的 AI 助手 29 项、知识库 16 项界面检查通过，17 个运行文件与源码一致，分发库无个人数据，更新元数据摘要一致。本轮未运行无关功能测试。尚未上传线上 Releases，未替换真实安装目录，详见 [RELEASE-0.3.3.md](RELEASE-0.3.3.md)。


## 2026-10-22 v0.3.3 双仓库发布

GitHub 与码云的 release/v0.3.3 分支及 v0.3.3 标签已同步，标签固定于安装包源码提交 0820a08450d15c27f47ed4c1b072eb410f38b276。两个发行版均为正式版本，包含 setup.exe、portable.exe、setup.exe.blockmap 与 latest.yml。GitHub 服务端四个附件的大小及 SHA-256 与本地一致；码云四个公开附件经完整下载计算，大小及 SHA-256 均一致。使用项目实际 GiteeProvider 读取线上版本与清单，确认识别 0.3.3 且安装包大小及 SHA-512 正确；GitHub latest 接口和公开 latest.yml 同样通过核对。未改动真实安装目录或用户数据库。发布详情见 [RELEASE-0.3.3.md](RELEASE-0.3.3.md)。


## 2026-10-22 内置知识库内容扩充

从 12 篇扩充到 36 篇，新增长难句、否定指代、阅读证据判断、词汇搭配、写作展开、翻译数字文化表达及学习方法等 24 篇原创教学条目，带例句、易错提醒和答案自测。修正旧资料的丝绸误译、倍数歧义和绝对化口诀，保留原有标题及 key。主题标签支持语法、阅读、词汇、写作、翻译、学习方法，旧“题型方法”标签兼容。知识库数据 13 项、真实界面 19 项和构建通过，仅相关功能；未改真实用户数据，未重建种子或重新制作安装包，线上 v0.3.3 维持原包。内容目录、核对来源和维护规则见 [KNOWLEDGE-CONTENT.md](KNOWLEDGE-CONTENT.md)。


## 2026-10-23 学习体验与功能联动

加入首页真实续学与草稿入口、练题/精读/复盘模式、AI 流式文字及页面操作撤销、带颜色与备注的永久批注、参考来源卡片和当前资料/作文上下文、知识点自测与独立复习队列、错因与关联练习、作文翻译逐处修改及撤销、个人笔记回收站。修正作文字符数误标词数，主观题不再显示空题目栏。增量建表/补列，旧备份兼容；批注和复习等写盘失败回滚，评分重试幂等。构建、76 项相关数据/状态检查与 123 项相关真实界面检查通过，全部隔离测试与本地模拟服务。当前为源码改动，尚未重新制作安装包，线上 v0.3.3 包和标签保持不变。完整说明、边界和验证命令见 [STUDY-EXPERIENCE.md](STUDY-EXPERIENCE.md)。


## 2026-10-25 开发方案与独立练习卡 P1

开发方案落盘于 [LEARNING-ROADMAP.md](LEARNING-ROADMAP.md)，按独立练习卡、学习负担/调度、短语语境义、移动复习同步四阶段推进。P1 已完成：从知识资料手动制作、整理内置自测或 AI 生成候选；逐张编辑选择后保存；按标签/题型/来源/状态筛选；独立复习、作答历史、来源快照、暂停归档及恢复。原知识点队列保留。

新增 `electron/practice-cards.cjs` 和三张增量表 practice_card / practice_card_batch / practice_attempt，基础 SCHEMA 不变；批次和评分幂等、过期版本拒绝、整批写盘失败回滚、来源版本校验、取消与迟到结果防护。编辑测试内容重学并保留历史，客观题对照与主观自评区分。入口及实现见 [PRACTICE-CARDS.md](PRACTICE-CARDS.md)。

构建通过；本轮练习卡 18 项数据+31 项界面、知识库 13+19 项、首页和学习流程 14+27 项，合计 122 项相关检查通过。隔离数据库、本地模拟服务，无真实用户数据修改或付费模型调用。运行 `npm run test:cards` 可复现新增专项。

当前为源码交付，版本字段仍为 0.3.3，未重建种子、未覆盖安装目录、未制作或上传新安装包。已发布 v0.3.3 的标签和附件不改动；后续正式发布应使用新的版本。下一批先实施 P2 的每日学习量与积压管理，FSRS 需另行核对官方实现后再评估迁移。


## 2026-10-25 P2 学习量与短轮次复习

新增设置页“复习节奏”、首页工作量和积压概况、生词及卡片每轮计划、暂缓新内容与提前结束。每日新词/新卡分别计额度，每轮受数量上限和目标时长约束。已学到期优先，未安排内容不改到期时间；忘词不立即追加本轮。刚收藏的新词仍可立即学习。

新增 `electron/review-budget.cjs` 和增量表 review_introduction，偏好存原 settings；旧日志回填首次学习时间，旧词有进度但无日志时标记已引入且日期留空。首次身份与评分同事务落盘，失败回滚、重放幂等、后端拦截超额，按本地午夜统计，单次评分共用时间快照。修复旧词多次复习但零间隔导致成功评分后立即到期的问题。

新增专项 20 项数据、19 项真实界面通过；相关专项合计 109 项数据/状态与 113 项真实界面通过。构建通过，独立临时数据库和本地模拟服务，未运行全量 CI。使用 `npm run test:review-budget` 复现新增专项。详见 [REVIEW-PACING.md](REVIEW-PACING.md) 与 [LEARNING-ROADMAP.md](LEARNING-ROADMAP.md)。

P2 本批完成学习负担控制，FSRS 尚未接入，下一批再审计调度日志、官方实现与迁移策略。仍为源码交付，不重建种子、不覆盖安装目录、不修改真实学习数据、不重新打包发布；v0.3.3 原标签与资产不动。


## 2026-10-25 P2 调度接口与 FSRS 本地对照

新增纯调度接口 `electron/review-scheduler.cjs`，词汇与练习卡评分共用既有策略，翻面后显示各评分对应预计间隔。增量表 review_schedule_event 保存真实评分的引擎/版本、日志身份、时间、前后状态和卡片内容摘要，与评分、日志、每日额度同事务保存，失败回滚、重试不重复。

设置页新增默认折叠的本地调度评估，明确点击后才运行。使用官方稳定包 ts-fsrs 5.4.2（FSRS 6、MIT），精确版本与 lockfile 完整性固定；实际 Electron Node 20.18.3 可运行，许可证保留于 `electron/TS-FSRS-LICENSE.txt`。只读回放最近最多 20 项、每项最多 200 条，0 映射 Again、2 映射 Good；含旧“模糊”评分或不完整/异常/改题历史均跳过，不虚构 Hard 或训练参数。没有应用结果的 IPC，不更改真实到期或学习数据。

新增 16 项数据、18 项真实界面通过，相关回归合计 94 项数据/状态、104 项真实界面通过，构建通过。使用 `npm run test:scheduler` 运行新增专项。全部隔离测试，无付费模型或真实用户数据修改，未运行全量 CI。细节、官方来源和后续设计见 [SCHEDULER-EVALUATION.md](SCHEDULER-EVALUATION.md)。

下一批明确四档评分语义，再推进新卡可选 FSRS、按项目/参数版本保存状态及保留全部作答的回退。当前实际调度仍为原策略，P2 尚未整体完成。仍为源码更新，不重建种子、不覆盖安装目录、不制作安装包；v0.3.3 原标签和资产不动。


## 2026-10-25 P2 新卡可选 FSRS 与保留记录回退

新增逐卡可选试用（从未作答新卡、最多 10 张），在管理页先预览、再自动备份并提交。四档没想起/费力想起/正常想起/很轻松保存语义版本 fsrs-4-v1，客观题错误只能没想起，主观题仍自评。沿用精确锁版 ts-fsrs 5.4.2；参数、版本、记忆、原调度同步状态及改题轮次逐卡保存。退出先备份，再用试用期实际评分同步计算的原调度状态接续，保留全部原始四档历史与 FSRS 状态，不能用旧备份覆盖新作答。

新增 electron/practice-fsrs.cjs、electron/scheduler-backup.cjs、PracticeScheduler.vue，以及增量表 practice_fsrs / practice_fsrs_operation / practice_fsrs_review / practice_fsrs_event。评分、状态、历史、每日额度同事务落盘；方案带版本和摘要，切换/评分幂等，备份失败不切换。改题重建当前轮次、保留旧题；暂停归档/未入队/重新入队保留安排。修复未入队先启用、再入队未评分即退出丢失入队身份的问题。参数或记忆损坏拒绝继续评分，但完整原调度仍可用于退出。历史对照跳过参加过试用者，避免混入四档映射日志。

新增专项 23 项数据、19 项真实界面通过；加上练习卡、复习量和原调度对照，合计 77 项数据/状态、87 项界面检查与构建通过。真实备份文件逐字节与摘要核对，切换失败/评分失败回滚、备份重命名故障、幂等、重学、恢复及真实重启均覆盖。全部隔离数据，无真实用户修改或付费模型调用；未运行全量 CI。运行 npm run test:fsrs-trial，完整说明见 [FSRS-TRIAL.md](FSRS-TRIAL.md)。

本批仍是源码交付，不重建分发库、不覆盖安装目录、不打包或发布新安装包。v0.3.3 发行标签/附件不变。P2 新卡可选试用工程完成，实际效果和负担留待使用观察，不自动迁移旧词卡或训练个人参数。下一批按 [LEARNING-ROADMAP.md](LEARNING-ROADMAP.md) 推进 P3 有出处的短语收藏与独立复习。


## 2026-10-25 P3 原文短语收藏与独立复习

新增阅读器“收藏短语”划选入口与“短语收藏”管理页。完整划选 2 至 12 个英文单词，填写此处释义、备注和标签后保存；核对真实篇章、重复引文序号和原文摘要，保存上下文快照与出处。重复收藏同一版本同一位置返回原条目且不覆盖释义，不同出现位置分别保存。搜索筛选、版本校验编辑、回收恢复、离页保护、窗口焦点和迟到响应防护已接通。

来源定位复用 DOM Range，返回准确出现位置；正文变化或退休后保留收藏内容、停止自动定位。新增 electron/phrases.cjs、PhraseCapture.vue、PhrasesView.vue，以及增量表 phrase_item / phrase_operation。保存幂等，编辑/回收 CAS，落盘失败整体回滚；旧备份必需结构不变。列表批量核对篇章，避免逐条查正文。

短语来源以 phrase:<uuid> 接入练习卡统一来源适配器，不复制成独立知识正文。先审阅候选再保存/入队；可手动制卡或明确调用已有 AI 候选。收藏修改/回收不删除旧卡或历史，来源变化有提示。手动释义与 AI 讲解来源区分，离线收藏不调用模型，不消耗新卡额度。

新增专项 17 项数据、25 项真实界面通过；加上练习卡、阅读知识联动和页面助手，共 61 项数据/状态、112 项真实界面检查与构建通过。覆盖重复引文、精确定位、去重/幂等、写盘回滚、过期版本、回收恢复、来源变化、候选审阅、独立评分及真实重启。运行 npm run test:phrases；说明见 [PHRASES.md](PHRASES.md)，计划见 [LEARNING-ROADMAP.md](LEARNING-ROADMAP.md)。全部隔离数据，本地模拟服务，无付费模型或真实数据修改，未运行全量 CI。

仍为源码交付，不重建分发库、不覆盖安装目录、不打包上传新版本，已发布 v0.3.3 标签/附件不动。P3 第一批完成，后续依次推进多个语境义、拼写/原句填空和含出处导出；P4 同步与移动端仍待独立设计。


## 2026-10-26 P3 熟词生义与多个语境义

新增“语境义”页面、阅读器点词/划选保存此处词义、生词本全部/当前词入口。同词按现有 resolveWord 关联，但每处保留原文词形、解释、出处和独立学习目标；未知词不采用猜测截词结果强行归并。支持同词其他语境、搜索筛选、编辑回收、返回原文和逐处审阅制卡。词典、生词统计、掌握状态、旧日志与原词调度不变，收藏本身不占学习额度。

复用 electron/phrases.cjs 与收藏组件，phrase_item 增量加 kind / lemma / context_offset；旧项默认 phrase，旧 ID/回收/保存操作哈希兼容。新增 SensesView.vue 作为独立路由入口，实践卡来源为 sense:<uuid>，同词不同语境分别保存答案和历史。原文上下文原样保存，目标单独记录并生成【】标记；来源变动不会覆盖旧卡。仅原文摘要和窗口仍匹配时为旧记录只读推导位置，陈旧记录不猜测。手动词义与 AI 讲解的来源区分，无后台释义请求。

修复原划选最多匹配 100 次后误指首处的问题，改为一次 DOM 映射确认真实选区；第 121 处实际划选通过。修复重复词候选题目标不明，以及 12 用户标签加系统标签造成制卡超限。保存幂等、版本校验、事务落盘回滚及旧库迁移均验证。

新增 19 项数据、25 项真实界面通过；相关原短语、练习卡、AI 助手、查词与词形专项共 102 项数据/状态、125 项真实界面和生产构建通过。全部隔离数据库、本地模拟服务，无真实数据修改或付费模型调用，未跑无关全量 CI。运行 npm run test:senses；详细使用与边界见 [CONTEXTUAL-SENSES.md](CONTEXTUAL-SENSES.md)，进度见 [LEARNING-ROADMAP.md](LEARNING-ROADMAP.md)。

本批为源码交付，不重建分发库、不覆盖安装目录、不打包上传新版本，v0.3.3 发行标签/附件不变。下一批继续 P3 拼写/原句填空，随后完善含出处导出；P4 同步与移动端仍待单独设计。


## 2026-10-26 P3 拼写与原句填空

新增 spelling / cloze 两类独立练习卡。短语和语境义详情选择练习方式，先审阅编辑候选再保存/入队；编辑器也支持手动编题。填空按原偏移挖唯一目标，重复表达和确认的词形线索一并遮挡；拼写按此处释义提示原文表达。作答前隐藏答案、解析、快照和泄露词形的来源标题，先输入再核对；没想起可明确查看答案，随后评分。

新增 electron/practice-exercises.cjs、practice:exerciseDraft / practice:check 与增量表 practice_answer_check。typed-answer:v1 统一兼容字符、撇号、大小写和空白后精确比较，不做同义/词形/模糊替换。核对只读，实际评分由后端重算；错误原三档只能不会、FSRS 只能没想起。核对规则和规范化值与评分、作答、调度、额度同事务保存，故障整体回滚，重放保留原回执。原始输入保留大小写和内部空白，首尾沿用原保存规则去除。旧题型/历史/备份不转换，修改题目答案重学且旧记录保留。

新增 17 项数据、23 项真实界面通过；相关练习卡、FSRS、复习额度、语境义和短语共 114 项数据/状态、142 项真实界面与构建通过。检查覆盖只读字节、提示遮挡、唯一/重叠目标、错误评分、伪造结果、落盘/SQL 回滚、幂等、编辑重学、FSRS 四档和重启。兼容检查发现并修复本批新按钮打断旧翻面条件的问题，旧四类翻面验证均通过。运行 npm run test:typed-practice，完整说明见 [TYPED-PRACTICE.md](TYPED-PRACTICE.md)。

全部隔离数据，本地模拟服务，无真实数据修改或付费模型调用，未跑无关全量 CI。当前为源码交付，不重建分发库、不覆盖安装目录、不打包上传新版本，v0.3.3 原标签/附件不变。下一批带出处导出，随后再评估 AI 释义建议；P4 另行设计。


## 2026-10-26 P3 带出处导出与数据可携带性

短语、语境义和练习卡页面新增当前筛选导出，支持 JSON 资料档案及 Anki 导入文本。先核对数量/样例/历史数再选择保存位置；回收、暂停及归档范围明确。默认只含已保存内容，练习卡可选全部历史与当前调度，保留每次原题/原输入、typed-answer:v1、FSRS 原始四档、参数/记忆及原调度同步状态。白名单序列化排除设置、密钥、备份绝对路径和操作回执；JSON 没有导入/恢复能力，数据库备份仍为完整恢复路径。

新增 electron/learning-export.cjs、electron/source-provenance.cjs、LearningExport.vue、learningExport:preview/save/cancel 及对应 preload 接口。practice_card 增量添加 source_anchor，从可信来源保存原文锚点；卡片/历史快照保留原出处，旧卡仅在来源摘要匹配时只读补充。Anki 四列 ID/Front/Back/Tags，使用自定义稳定首字段；六题型为普通正反面，无自动输入核对或学习进度迁移。已做格式解析，未实际运行 Anki 导入。

预览字节冻结、摘要校验、窗口令牌与十分钟有效期，离页/切换筛选取消旧结果；原生取消可重试。限制条数/历史/正文/总字节，超限拒绝而非截断。路径校验保护应用/数据目录，允许用户数据下专用 exports；原子临时写入、刷盘、改名及最终摘要校验，失败不动已有目标。保存成功重放不重复写入；外部文件变化须重建预览。没有更改原生词 Anki 导出。

新增专项 20 项数据、22 项真实 Electron 界面/文件检查通过；相关回归共 114 项数据/状态、145 项真实界面检查与生产构建通过。测试包含 60 条历史绕过详情页 50 条显示限制、故障注入、取消/迟到、旧库/备份兼容和真实重启。原生对话框仅在自有隔离测试进程中替换，没有产品测试开关。全部隔离数据，无模型或真实学习记录修改，未跑无关全量 CI。运行 npm run test:learning-export；完整说明见 [LEARNING-EXPORT.md](LEARNING-EXPORT.md)。

P3 核心源码功能完成，下一批可推进用户审阅的 AI 释义候选，P4 仍单独设计。当前不重建分发库、不覆盖安装目录、不制作或上传安装包，已发布 v0.3.3 标签/附件保持原样；提交后同步 GitHub 和码云开发分支。


## 2026-10-26 AI 此处释义候选与人工确认

新增 PhraseSuggestion.vue、electron/phrase-suggestions.cjs 与 phrase:suggest，接入划选收藏及短语/语境义详情。主动请求使用已有 AI 配置，只发送后端校验的目标、归一词形、保存上下文/偏移及出处，不携带正在编辑的释义、备注、聊天或其他资料。严格限制 1 至 3 个候选及字段长度，原文依据需覆盖正确出现位置；模型内容只作文本展示。候选不写 AI 缓存、聊天或收藏，不自动填入和建卡；明确采用后可编辑，手动保存才入库。

复用 AI 请求取消与组件任务身份；停止、切换收藏和离页隔离旧结果。生成前后与采用时核对原文/版本，旧收藏来源变化时明确使用保存上下文，不能定位的旧项不猜测。随机候选令牌绑定窗口/目标/版本/序号，十分钟失效，单窗八批/全局六十四批内存上限。错误、无 Key、网络故障保留手动草稿；采用建议可保留文字改为手动编辑。

phrase_item 增量加 meaning_provenance，保存同事务记录实际所选候选的模型、时间、原候选、解释、真实依据与人工修改标记。普通备注/标签编辑保留来源，之后直接手写改义清旧标记；旧操作哈希兼容、保存重试幂等、落盘失败回滚。JSON 收藏导出保留来源，Anki 与新卡正文标注 AI 辅助，已有卡片和作答保持原快照。

新增 20 项数据与 21 项真实界面；受影响的短语、语境义、练习卡、拼写/填空、导出与原 AI 取消专项共 126 项数据/状态、147 项界面及生产构建通过。界面实测发现并修复响应式采用信息不能通过 IPC 克隆的问题。所有模型请求仅本地模拟，无真实学习数据修改或付费请求，未跑无关全量 CI，未验证实际模型释义质量。运行 npm run test:phrase-ai；说明见 [AI-CONTEXT-MEANING.md](AI-CONTEXT-MEANING.md)。

P3 核心及可选 AI 候选已完成；下一批先提交 P4 移动复习与同步设计，明确离线评分、配对与解绑、幂等和冲突，不直接开放本地数据库服务。仍为源码交付，不重建分发库、不覆盖安装目录、不打包上传，v0.3.3 原标签/附件不变。提交后同步 GitHub、码云分支。


## 2026-10-27 P4 A0 移动复习协议与开发方案

新增 [MOBILE-REVIEW-DESIGN.md](MOBILE-REVIEW-DESIGN.md)，明确轻量 Web/PWA、第一版只带已学到期练习卡、桌面单一调度写入、主动文件往返，再接自动传输。包括用户步骤、30 卡/24 小时批次、200 条待确认上限、原输入/手机时间审计、接收时间调度、冲突副本、配对/撤销、公钥签名、库恢复新轮次和阶段验收。PWA/HTTPS 部署、实机验证及生产认证均未交付。

新增 shared/mobile-review-contract.mjs，纯 ES 模块，无生产 IPC 或页面引用。严格校验 operation/ticket/receipt/outbox；固定规范化身份，三档/四档及参数轮次分离，只读 base-match/conflict/duplicate，队列/回执转换保留原数据。base-match 不是认证授权，可信 device/ticket/receipt 必须由未来验签适配层提供，不能透传客户端数据。恢复/撤销优先于历史回执重放，批次清理不影响已有回执查询。

后续 A2 要新增 mobile ledger 并为客户端操作映射独立 localAttemptId，避免与原桌面 attempt UUID 碰撞。评分与移动回执必须同事务落库；现有 practice.rate 自己开事务，不能外层再次 BEGIN 或先评分后补回执。需要内部评分服务重构后再接适配，当前没有改变生产评分/迁移/导出。

新增 28 项协议/队列与隔离真实评分演练、13 项真实 Chromium 技术验证通过。浏览器实际断网仍可保存 IndexedDB，事务中止不改原队列，两个写事务不丢作答，关闭重启恢复；WebCrypto 不可导出私钥签名与 Node P1363 验证互通。全部临时隔离数据，无真实用户库、模型或生产服务访问，未运行无关全量回归。运行 npm run test:mobile-contract。技术演练不代表移动页面、认证或完整同步已经可用。

下一批 A1 是独立移动页面、六类卡和可复用 IndexedDB 适配器，先以明确演示包验证；A2 实现设备/签名文件/联合事务，A3 再 HTTPS/PWA 和实机验证。当前只提交源码与方案，不重建分发库、不覆盖安装目录、不打包上传，v0.3.3 标签/附件不变；继续同步 GitHub、码云开发分支。


## 2026-10-30 P4 A1 移动演示页面与真实本地记录

新增独立 mobile/ 入口与 vite.mobile.config.mjs，构建 dist-mobile/，不影响桌面 dist/。Vue 页面支持问答、翻译、判断、选择、拼写、填空的先答后核对，原三/四档评分限制和输入题隐藏来源标题。内置六张原创演示卡，不调用 Electron IPC、模型或真实用户库；页面明确演示范围，不提供正式包/回执导入或配对。

mobile/lib/store.mjs 复用 shared/mobile-review-contract.mjs，实现演示作用域的实际 IndexedDB：事务内读取最新状态、序号、作答与快照原子保存；等待 complete 后报告成功。支持原身份重试、跨页变化通知、批次过期、新轮次、回执状态模拟、演示副本下载与明确清理。未知/损坏状态拒绝读取及覆盖，浏览器存储不可用/空间不足保留输入与原记录。durability 提示不兼容时回退普通事务，不承诺突发断电不丢失。

原输入完整保留，录入失败不消费序号或部分写入；清理确认示例不删除待确认/冲突，不倒退序号。已打开页面断网可记录，正常关闭重启恢复；未评分草稿仅在内存，离线重开页面/PWA 壳与手机实机仍留在 A3。demo archive 不能导入桌面，模拟确认不是授权；A2 必须接验签和评分/回执联合事务。

新增 scripts/regression-mobile-model.mjs 12 项、scripts/mobile-review-check.mjs 39 项真实移动页面/存储检查；加上 A0 28+13 项共 92 项相关检查及桌面/移动构建通过。覆盖实际事务中止/重试、并发、未知字段保护、重启、断网、下载、清理、跨页草稿保护和 320/390/768 像素布局，实际渲染截图已审阅。测试只用专用临时目录和隐藏浏览器，结束清理，没有产品测试开关、真实数据或模型请求，未跑无关全量 CI。

运行 npm run dev:mobile 本机预览、npm run build:mobile 独立构建、npm run test:mobile-review 专项。详细说明见 [MOBILE-REVIEW-PROTOTYPE.md](MOBILE-REVIEW-PROTOTYPE.md)。当前只交付源码，不修改正式数据/迁移、不重建分发库、不覆盖安装目录、不打包上传，v0.3.3 原标签/附件不动。提交后同步 GitHub、码云；下一批 A2 先设备配对与签名，再实际文件往返和联合事务。


## 2026-10-30 自动检查更新与提醒

新增 electron/automatic-updates.cjs、UpdateNotice.vue、AutomaticUpdateSettings.vue。默认开启，打包环境启动约 15 秒后及每 6 小时自动元数据检查，重启保留节流；首选源失败尝试另一来源，失败退避 30 分钟至 6 小时。全局非模态提醒跨页面显示，可稍后 24 小时或跳过当前版；新版本不受旧版延后影响，手动检查仍可发现被跳过版。开发态不自动联网。

原更新模块增加 metadata-only 选项、显式下载、切源在途锁；自动检查不下载/重启，安装仅显式调用。关闭 autoInstallOnAppQuit，普通退出不再自动安装已下载附件。手动安装版“检查并下载更新”保持检查后下载行为，便携版只检查并打开固定发布页。新增 update:download/preferences/dismiss IPC、统一递增状态，启动、系统恢复、恢复数据库和退出生命周期已接通。

独立 update-preferences.json 原子保存开关、首选、时间、失败次数与提醒元数据，不进学习 DB/备份、不含 AI 设置。首次迁移旧 localStorage 来源；损坏文件暂停自动检查且不自动覆盖，明确保存后可恢复。关闭设置防护在途迟到提醒，下载/待安装锁阻止切源；时间回退重新安排。

原更新 25 项、新自动状态 20 项、原设置界面 7 项、新提醒界面 19 项共 71 项及构建通过。真实 UI 只在隔离启动脚本替换更新器/安装器/时钟，无产品测试开关、真实附件下载或安装、外部网页或真实用户数据修改。未跑无关全量 CI。运行 npm run test:updates，说明见 [AUTOMATIC-UPDATES.md](AUTOMATIC-UPDATES.md)。

当前只交付源码，不更改版本号、不重建分发库、不覆盖安装目录、不打包上传新版本，v0.3.3 标签/附件不变；新机制需随新安装包发布后生效。同步 GitHub、码云后，继续原 P4 A2 设备与签名文件计划。


## 2026-10-30 v0.3.4 打包与指南

新增桌面功能随新安装版/便携版发行，README 已逐项说明操作方式。完整回归、268 项开发态界面、实际成品 150 项端到端和 92 项专项通过；种子未重建，原安装和用户库未改动。使用独立输出 release-v034-20261030；四个配套文件及校验见 RELEASE-0.3.4.md。P4 正式同步仍待后续开发。

### v0.3.4 发布收尾

GitHub/码云四个发行附件已上传，main 与发布分支同步；两仓库默认均为 main，README 含各功能入口和使用步骤。发行标签固定 267a961a365dcdb8e23ddb51b14f0ef17dcddf5e。码云四文件公开下载哈希通过；GitHub 服务器摘要及小附件字节通过，本机大文件回下载超时，详细边界见 RELEASE-0.3.4.md。未覆盖现有安装或用户库。
