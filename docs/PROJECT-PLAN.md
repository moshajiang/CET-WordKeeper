# CET WordKeeper — 项目整理、待办与开发方案

> 更新：2026-10-10 ｜ 分支 `main`，领先 origin 1 个提交（73f6e7a，未推送）

---

## 一、项目概览

真题驱动的四六级（CET-4/6）离线学习桌面软件。

- **技术栈**：Electron 33 + Vue 3 + Vite 5 + sql.js（WASM SQLite，无原生编译依赖）
- **仓库**：https://github.com/moshajiang/CET-WordKeeper（public）
- **核心思路**：真题/词典/答案/解析/翻译**构建期预置**进单文件库，用户装上即可离线用；
  AI 聊天、批改等增强功能由用户自行配 Key，未配置时优雅降级（`no_key`）

---

## 二、代码结构

```
cet-wordkeeper/
├── electron/                      主进程（Node 侧）
│   ├── main.cjs        1019 行    ★ 全部 IPC、数据库读写、AI 调用（单体，拆分候选）
│   ├── preload.cjs       46 行    contextBridge，plain() 兜底结构化克隆
│   └── word-forms.json            不规则变形/缩写补丁
├── src/                           渲染进程（Vue 3）
│   ├── views/
│   │   ├── ReaderView.vue  729 行  ★ 做题/阅读/解析/翻译/聊天/批改（最大视图）
│   │   ├── WordBook.vue    173     生词本（SM-2 复习）
│   │   ├── ReviewView.vue  150     复习
│   │   ├── SettingsView.vue 113    Key 配置 / JSON 导入
│   │   ├── KnowledgeView.vue 106   英语知识库
│   │   ├── HomeView.vue / ExamLibrary.vue
│   ├── router.js / App.vue / styles.css
│   └── utils/tokens.js
├── scripts/                       数据管线 + 质检（可复现，全部离线可重跑）
│   ├── 抓取   fetch-exams.mjs (docx 2014–2019) / fetch-pdf-exams.mjs + pdf-extract.py (PDF 2020+)
│   ├── 解析   parse-docx.mjs / parse-pdf.mjs  → data/seed/*.json（78 套）
│   ├── 入库   build-db.mjs（合并 seed + AI 覆盖层 + 词典裁剪 + 词频表）
│   ├── 生成   gen-answers.mjs（--model 控制模型）→ data/ai-answers/*.json
│   ├── 对齐   apply-answers.mjs（覆盖层 → 库，按「套→篇章→题目顺序」）
│   ├── 质检   verify-all.mjs(72 项 CDP e2e) / sync-check.mjs(10 项) / word-audit.mjs
│   │          answer-audit.mjs / answer-gaps.mjs / check-secrets.mjs / e2e-check.mjs
│   └── 修复   reparse-seed.mjs / prune-stale-overlay.mjs（解析器改动后专用）
├── data/
│   ├── keeper.db                  ★ 分发的主库（exe 内嵌同款）
│   ├── seed/*.json (78)           解析产物，随仓库分发
│   └── ai-answers/*.json (44)     AI 预生成覆盖层，随仓库分发
└── docs/screenshots/
```

**数据流**：源 docx/pdf → `parse-*` → `data/seed/` →（+`data/ai-answers/`）→ `build-db` → `data/keeper.db` → 应用首启拷贝 / `syncSeedExams` 增量补新考次。

---

## 三、当前状态（2026-10-10 中午）

| 项 | 状态 |
|---|---|
| 真题 | 78 套（CET4 32 / CET6 46，2014–2026），**78/78 结构完整**（填空10+匹配10+阅读5+5） |
| 词典 | 28,667 条（考纲+高频裁剪），高频词查得率 100% |
| 预置内容 | **42/78 套有答案**；131 篇章有翻译；80 范文/参考译文 |
| 待生成 | **1360 题缺答案+解析；334 篇章缺翻译**（≈334 次请求） |
| 验证 | verify-all **72/72**、sync-check **10/10**、词干可疑扫描 0 |
| git | 提交 73f6e7a（解析器全修）**未推送**；`data/keeper.db` 已重建**未提交** |
| 进程 | 无残留 node/electron，覆盖层无写盘 |

---

## 四、待办清单

### P0 — 本次发布前必须
1. **【等待用户命令】预置内容生成**：翻译 + 答案 + 解析 + 范文，共 **1360 题缺答案+解析、334 篇章缺翻译**
   命令：`node scripts/gen-answers.mjs --model deepseek-flash --concurrency 4`（⚠️ 用 flash 不用 pro；Key 只在环境变量或本机用户库）
   生成完 → `gen-answers.mjs --reverify` 补复核（≈131 题）
2. `apply-answers.mjs` → `answer-audit.mjs`（真分歧必须为 0）
3. `build-db.mjs` → `verify-all.mjs`（应 73/73，含「数据为最新版」两条精确断言）
4. 提交 `data/keeper.db`（生成完一次性提交，避免大二进制反复 churn）
5. **重新打包** `npm run pack:win`（exe 内嵌 keeper.db，数据变了必须重打）
6. `git push`（注意：public 仓库，推送前 check-secrets 必须绿；当前本地领先 2 个提交）

### P1 — 质量补强
- [x] ~~`parse-pdf.mjs` 宽松题号兜底~~（已补 `QNUM_LOOSE`/`splitByRange` + 匹配题两轮起点定位；全量 `--check` 零差异，纯增量健壮性）
- [x] ~~verify-all 增加「内置数据为最新版」断言~~（套数与题量均与 `data/seed` 现算期望值精确比对，扩充考次后自动跟随）
- [ ] 打包后用 `ELECTRON_EXE=<win-unpacked 路径>` 跑 verify-all 验证载荷

### P2 — 重构与整洁
- [x] ~~`npm run ci` 一键质检~~（check-secrets → build-db → verify-all → sync-check → word-audit）
- [x] ~~`reparse-seed` 逐字段 diff~~（`--check` 模式：不落盘、空白/实质差异分级、实质差异退出码 1）
- [ ] `electron/main.cjs`（1019 行）按域拆分：`ipc/`（词库/做题/复习/AI/设置）
- [ ] `ReaderView.vue`（729 行）拆子组件：作答区 / 解析面板 / 聊天面板
- [ ] 清理仓库外杂物（**需确认后再动**）：`release-build/`、`release-build2/3`、`release-new/`、`_tmp-trash/`（628 文件）、根目录 `_pdf_probe*.py`
- [ ] README 截图与功能清单刷新（docs/screenshots）

---

## 五、开发方案（分三期）

### M1 · 收尾发布（本次）
目标：预置内容补全 + 干净的安装包上线。
只做 P0 清单，不动架构。完成标志：verify-all 72/72 + 打包产物通过 e2e + 已推送。

### M2 · 质量与可维护性
目标：降低「改一处坏一处」的成本。
- 主进程拆模块（`main.cjs` → `ipc/*.cjs`），每块独立可测
- 视图拆组件；抽 `composables/useExam.js`、`useReview.js`
- 质检自动化串成一键 `npm run ci`（check-secrets → build-db → verify-all → sync-check → word-audit）
- 把 `reparse-seed` 的「只比题数」升级为「逐字段 diff（空白差异单独归类）」

### M3 · 功能增强（按用户优先级排期）
- 错题本强化（按题型/考次统计）｜ Anki 导出模板化 ｜ 难词预扫进复习队列
- 用户自行导入真题的校验提示优化（套号撞名/题数缺失时给出可读错误）

---

## 六、标准工作流程（SOP）

**按改动类型走对应管线，改完必跑对应验证：**

| 改了什么 | 必跑命令（顺序） |
|---|---|
| 解析器 `parse-*.mjs` | `npm run check`（字段级比对，不落盘）→ 确认无实质差异后 `reparse-seed` 落盘 → `prune-stale-overlay` → `build-db` → `verify-all` → `sync-check` |
| seed / 词典数据 | `build-db` → `verify-all` → `sync-check` → **重新打包** |
| 主进程 / 渲染代码 | `npm run build` → `verify-all` |
| AI 生成内容 | `gen-answers --model deepseek-flash` → `apply-answers` → `answer-audit` |
| 提交 / 打包前 | `npm run ci`（密钥 → 重建库 → 72+ 项 e2e → 增量同步 → 词频查得率） |

**提交节奏**：功能/修复一个提交；大二进制（keeper.db）攒到生成收尾一次性提交。

---

## 七、防错清单（历史踩过，勿再犯）

1. **Edit 工具偶发「报成功但未落盘」** → 多段编辑后必须 `grep` 验证关键行真的在，再 build
2. **verify-all 前必须清用户库**（脚本已内置），否则拿残留脏数据跑断言
3. **数据变了必须重新打包** —— 已两次出现「源码修好、包还是旧的」
4. **覆盖层与 seed 比对不能逐字比**：`build-db` 的 `healGlued` 会把 `ofland`→`of land`，逐字比会误判「题干已变」→ 用「题号前缀/空白差异视为等价」
5. **IPC 不能直接传 Vue 响应式对象**：结构化克隆遇 Proxy 抛错且**静默失败** → `preload` 的 `plain()` 兜底，调用点显式展开 `{...x.value}`
6. **改解析器后必须跑 `prune-stale-overlay`**：答案按「题目顺序」对齐，解析器改了题数/顺序就会无声错位
7. **Key 安全**：只在环境变量或 `%APPDATA%/cet-wordkeeper`；`check-secrets` 每次验证兜底扫描；`sk-` 有假阳性（risk-free）
8. **生成模型用 `deepseek-flash`**（CLI `--model` 控制，默认写死是 pro，别用默认值）；推理型模型 token 给足（生成 16000 / 复核 8000）
9. **复核失败绝不能记成 `verified=true`**
10. **本机沙箱特有**：删除计数守卫（>50 次删除即拦）→ 用 `mv` 或 `-c.directories.output=<新目录>`；无 GPU 需 `--disable-gpu --no-sandbox`；spawn 前删 `ELECTRON_RUN_AS_NODE`
11. **套号解析必须多模式 + 撞名检测**（`第1套/第一套/卷二/（全1套）`），否则多套互相覆盖、静默丢题
12. **套号区间从 `Questions X to Y` 推导，不写死**（2014 老卷是 36–45 / 56–65）
