# 逐篇对齐质量审查报告（v0.3.1，逐锚点口径）

- 审计对象：入库的 passage.rows（写死绑定结果），311 篇带译文篇章
- 风险分级：**A（可信）289 篇 · B（待观察）19 篇 · C（需复核）3 篇**
- 锚点按数值与单位完整匹配：千分位、万/亿与 million/billion、百分比、世纪/年代表达归一化；Directions 与本篇裸空号不计。命中数与分母均为逐个锚点计数
- 评级为证据分级：字母错位/漂移≥2/覆盖<90%/归一化后命中<20%/同值单位差异≥2 → C；漂移1/命中<45%/覆盖<97% → B；其余 → A

## C 级（建议人工复核）
- **CET6 2015.6 set2 cloze** — 锚点命中 0%（归一化后）
  - #1 锚点[number:26]｜EN: “That which does not kill us makes us stronger.” But parents can’t han…
    ZH: “杀不死我们的，会使我们更强大。”但当青少年把这一理念付诸实践时，父母却无法接受。…
  - #4 锚点[number:27,number:28]｜EN: What they do online often __27__ what they might otherwise do if their…
    ZH: 在“直升机式育儿”时代，他们的行动自由受到严重限制；他们在网上做的事，往往反映了他们原本在现实世界可能会做的事。…
  - #6 锚点[number:29,number:30]｜EN: They want the freedom to __29__ their identity and the world around th…
    ZH: 他们想要自由地探索自己的身份和周围的世界。他们不是偷偷溜出去，而是跳进网络世界。…
- **CET6 2023.12 set1 match** — 原文/译文同值单位差异 5 处
  - #2 锚点[number:40]｜EN: B) Although there are huge uncertainties as to the precise impacts of …
    ZH: B) 尽管气候变化的确切影响存在巨大不确定性，但已有足够认识可以说明，全球变暖是非洲繁荣面临的主要威胁之一。该大陆部分地区升…
  - #3 锚点[number:70]｜EN: C) Africa is particularly vulnerable, in part because it is already st…
    ZH: C) 非洲尤其脆弱，部分原因是它已经在为养活自己而苦苦挣扎；即使没有气候变化，它也必须大幅提高产量和生产率，才能让快速增长的…
  - #5 锚点[number:15]｜EN: E) The low productivity of African farmers is reflected in national ec…
    ZH: E) 非洲农民的低生产率也反映在各国经济统计数据中——尽管农业吸收了如此多的劳动力，却仅占GDP的15%。“他们甚至养不活自…
- **CET6 2023.12 set1 reading 2** — 原文/译文同值单位差异 3 处 / 锚点命中 0%
  - #5 锚点[number:60]｜EN: Men were found to account for 60of the editors of psychology journals.…
    ZH: 研究发现，男性占心理学期刊编辑的60%。…
  - #8 锚点[number:70,number:88]｜EN: The differences were even starker in the neuroscience journals: 70of e…
    ZH: 神经科学期刊中的差异更为明显：70%的编辑是男性，在88%的期刊中男性占据了大多数编辑职位。…

## B 级（待观察）
- CET4 2023.6 set2 cloze — 漂移 1 次
- CET4 2023.6 set3 cloze — 原文/译文同值单位差异 1 处
- CET4 2024.6 set3 reading — 锚点命中 33%
- CET6 2014.6 set1 reading — 锚点命中 33%
- CET6 2015.12 set3 match — 原文/译文同值单位差异 1 处
- CET6 2016.12 set2 match — 漂移 1 次
- CET6 2016.12 set3 reading — 漂移 1 次
- CET6 2017.12 set1 cloze — 漂移 1 次
- CET6 2017.12 set1 reading — 漂移 1 次
- CET6 2017.12 set1 reading 2 — 漂移 1 次
- CET6 2020.9 set1 reading 2 — 锚点命中 40%
- CET6 2020.9 set2 reading 2 — 原文/译文同值单位差异 1 处
- CET6 2020.12 set2 cloze — 原文/译文同值单位差异 1 处
- CET6 2021.6 set1 reading 2 — 锚点命中 33%
- CET6 2021.6 set2 reading — 锚点命中 25%
- CET6 2021.6 set2 reading 2 — 锚点命中 0%
- CET6 2021.6 set3 reading 2 — 锚点命中 33%
- CET6 2023.12 set3 reading 2 — 原文/译文同值单位差异 1 处
- CET6 2026.6 set1 reading 2 — 漂移 1 次

## A 级明细

| 篇章 | 锚点命中 | 备注 |
|---|---|---|
| CET4 2014.6 set1 cloze | 91% | 命中 91% |
| CET4 2014.6 set1 match | 67% | 命中 67% |
| CET4 2014.6 set1 reading | 100% | 命中 100% |
| CET4 2014.6 set1 reading 2 | 无锚点 | 无锚点 |
| CET4 2015.12 set1 cloze | 无锚点 | 无锚点 |
| CET4 2015.12 set1 match | 50% | 命中 50% |
| CET4 2015.12 set1 reading | 100% | 命中 100% |
| CET4 2015.12 set1 reading 2 | 100% | 命中 100% |
| CET4 2015.12 set2 cloze | 100% | 命中 100% |
| CET4 2015.12 set2 match | 92% | 命中 92% |
| CET4 2015.12 set2 reading | 无锚点 | 无锚点 |
| CET4 2015.12 set2 reading 2 | 67% | 命中 67% |
| CET4 2015.12 set3 cloze | 0% | 命中 0% |
| CET4 2015.12 set3 match | 100% | 命中 100% |
| CET4 2015.12 set3 reading | 100% | 命中 100% |
| CET4 2015.12 set3 reading 2 | 无锚点 | 无锚点 |
| CET4 2016.12 set2 cloze | 86% | 命中 86% |
| CET4 2016.12 set2 match | 80% | 命中 80% |
| CET4 2016.12 set2 reading | 100% | 命中 100% |
| CET4 2016.12 set2 reading 2 | 100% | 命中 100% |
| CET4 2016.12 set3 cloze | 100% | 命中 100% |
| CET4 2016.12 set3 match | 80% | 命中 80% |
| CET4 2016.12 set3 reading | 100% | 命中 100% |
| CET4 2016.12 set3 reading 2 | 100% | 命中 100% |
| CET4 2017.6 set1 cloze | 100% | 命中 100% |
| CET4 2017.6 set1 match | 100% | 命中 100% |
| CET4 2017.6 set1 reading | 94% | 命中 94% |
| CET4 2017.6 set1 reading 2 | 100% | 命中 100% |
| CET4 2017.6 set2 cloze | 100% | 命中 100% |
| CET4 2017.6 set2 match | 100% | 命中 100% |
| CET4 2017.6 set2 reading | 94% | 命中 94% |
| CET4 2017.6 set2 reading 2 | 100% | 命中 100% |
| CET4 2017.6 set3 cloze | 75% | 命中 75% |
| CET4 2017.6 set3 match | 无锚点 | 无锚点 |
| CET4 2017.6 set3 reading | 88% | 命中 88% |
| CET4 2017.6 set3 reading 2 | 无锚点 | 无锚点 |
| CET4 2017.12 set1 cloze | 100% | 命中 100% |
| CET4 2017.12 set1 match | 100% | 命中 100% |
| CET4 2017.12 set1 reading | 100% | 命中 100% |
| CET4 2017.12 set1 reading 2 | 100% | 命中 100% |
| CET4 2017.12 set3 cloze | 100% | 命中 100% |
| CET4 2017.12 set3 match | 100% | 命中 100% |
| CET4 2017.12 set3 reading | 100% | 命中 100% |
| CET4 2017.12 set3 reading 2 | 100% | 命中 100% |
| CET4 2018.12 set1 cloze | 75% | 命中 75% |
| CET4 2018.12 set1 match | 100% | 命中 100% |
| CET4 2018.12 set1 reading | 100% | 命中 100% |
| CET4 2018.12 set1 reading 2 | 100% | 命中 100% |
| CET4 2018.12 set2 cloze | 无锚点 | 无锚点 |
| CET4 2018.12 set2 match | 83% | 命中 83% |
| CET4 2018.12 set2 reading | 100% | 命中 100% |
| CET4 2018.12 set2 reading 2 | 100% | 命中 100% |
| CET4 2018.12 set3 cloze | 无锚点 | 无锚点 |
| CET4 2018.12 set3 match | 100% | 命中 100% |
| CET4 2018.12 set3 reading | 100% | 命中 100% |
| CET4 2018.12 set3 reading 2 | 100% | 命中 100% |
| CET4 2019.6 set1 cloze | 无锚点 | 无锚点 |
| CET4 2019.6 set1 match | 100% | 命中 100% |
| CET4 2019.6 set1 reading | 100% | 命中 100% |
| CET4 2019.6 set1 reading 2 | 100% | 命中 100% |
| CET4 2019.6 set2 cloze | 无锚点 | 无锚点 |
| CET4 2019.6 set2 match | 100% | 命中 100% |
| CET4 2019.6 set2 reading | 100% | 命中 100% |
| CET4 2019.6 set2 reading 2 | 100% | 命中 100% |
| CET4 2019.6 set3 cloze | 100% | 命中 100% |
| CET4 2019.6 set3 match | 100% | 命中 100% |
| CET4 2019.6 set3 reading | 100% | 命中 100% |
| CET4 2019.6 set3 reading 2 | 100% | 命中 100% |
| CET4 2019.12 set1 cloze | 100% | 命中 100% |
| CET4 2019.12 set1 match | 100% | 命中 100% |
| CET4 2019.12 set1 reading | 100% | 命中 100% |
| CET4 2019.12 set1 reading 2 | 100% | 命中 100% |
| CET4 2019.12 set2 cloze | 100% | 命中 100% |
| CET4 2019.12 set2 match | 100% | 命中 100% |
| CET4 2019.12 set2 reading | 86% | 命中 86% |
| CET4 2019.12 set2 reading 2 | 无锚点 | 无锚点 |
| CET4 2019.12 set3 cloze | 100% | 命中 100% |
| CET4 2019.12 set3 match | 71% | 命中 71% |
| CET4 2019.12 set3 reading | 100% | 命中 100% |
| CET4 2019.12 set3 reading 2 | 100% | 命中 100% |
| CET4 2023.6 set2 match | 100% | 命中 100% |
| CET4 2023.6 set2 reading | 100% | 命中 100% |
| CET4 2023.6 set2 reading 2 | 100% | 命中 100% |
| CET4 2023.6 set3 match | 95% | 命中 95% |
| CET4 2023.6 set3 reading | 无锚点 | 无锚点 |
| CET4 2023.6 set3 reading 2 | 100% | 命中 100% |
| CET4 2023.12 set1 cloze | 100% | 命中 100% |
| CET4 2023.12 set1 match | 89% | 命中 89% |
| CET4 2023.12 set1 reading | 100% | 命中 100% |
| CET4 2023.12 set1 reading 2 | 100% | 命中 100% |
| CET4 2023.12 set2 cloze | 100% | 命中 100% |
| CET4 2023.12 set2 match | 100% | 命中 100% |
| CET4 2023.12 set2 reading | 无锚点 | 无锚点 |
| CET4 2023.12 set2 reading 2 | 无锚点 | 无锚点 |
| CET4 2023.12 set3 cloze | 无锚点 | 无锚点 |
| CET4 2023.12 set3 match | 78% | 命中 78% |
| CET4 2023.12 set3 reading | 100% | 命中 100% |
| CET4 2023.12 set3 reading 2 | 无锚点 | 无锚点 |
| CET4 2024.6 set1 cloze | 100% | 命中 100% |
| CET4 2024.6 set1 match | 100% | 命中 100% |
| CET4 2024.6 set1 reading | 无锚点 | 无锚点 |
| CET4 2024.6 set1 reading 2 | 100% | 命中 100% |
| CET4 2024.6 set2 cloze | 67% | 命中 67% |
| CET4 2024.6 set2 match | 100% | 命中 100% |
| CET4 2024.6 set2 reading | 无锚点 | 无锚点 |
| CET4 2024.6 set2 reading 2 | 100% | 命中 100% |
| CET4 2024.6 set3 cloze | 100% | 命中 100% |
| CET4 2024.6 set3 match | 100% | 命中 100% |
| CET4 2024.6 set3 reading 2 | 无锚点 | 无锚点 |
| CET4 2024.12 set1 cloze | 100% | 命中 100% |
| CET4 2024.12 set1 match | 100% | 命中 100% |
| CET4 2024.12 set1 reading | 100% | 命中 100% |
| CET4 2024.12 set1 reading 2 | 100% | 命中 100% |
| CET4 2025.6 set1 cloze | 无锚点 | 无锚点 |
| CET4 2025.6 set1 match | 100% | 命中 100% |
| CET4 2025.6 set1 reading | 100% | 命中 100% |
| CET4 2025.6 set1 reading 2 | 无锚点 | 无锚点 |
| CET4 2025.12 set1 cloze | 无锚点 | 无锚点 |
| CET4 2025.12 set1 match | 100% | 命中 100% |
| CET4 2025.12 set1 reading | 100% | 命中 100% |
| CET4 2025.12 set1 reading 2 | 100% | 命中 100% |
| CET4 2026.6 set1 cloze | 无锚点 | 无锚点 |
| CET4 2026.6 set1 match | 89% | 命中 89% |
| CET4 2026.6 set1 reading | 100% | 命中 100% |
| CET4 2026.6 set1 reading 2 | 100% | 命中 100% |
| CET6 2014.6 set1 cloze | 无锚点 | 无锚点 |
| CET6 2014.6 set1 match | 100% | 命中 100% |
| CET6 2014.6 set1 reading 2 | 无锚点 | 无锚点 |
| CET6 2014.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2014.6 set2 match | 69% | 命中 69% |
| CET6 2014.6 set2 reading | 无锚点 | 无锚点 |
| CET6 2014.6 set2 reading 2 | 100% | 命中 100% |
| CET6 2015.6 set1 cloze | 50% | 命中 50% |
| CET6 2015.6 set1 match | 100% | 命中 100% |
| CET6 2015.6 set1 reading | 100% | 命中 100% |
| CET6 2015.6 set1 reading 2 | 无锚点 | 无锚点 |
| CET6 2015.6 set2 match | 92% | 命中 92% |
| CET6 2015.6 set2 reading | 无锚点 | 无锚点 |
| CET6 2015.6 set2 reading 2 | 无锚点 | 无锚点 |
| CET6 2015.6 set3 cloze | 100% | 命中 100% |
| CET6 2015.6 set3 match | 90% | 命中 90% |
| CET6 2015.6 set3 reading | 100% | 命中 100% |
| CET6 2015.6 set3 reading 2 | 100% | 命中 100% |
| CET6 2015.12 set1 cloze | 100% | 命中 100% |
| CET6 2015.12 set1 match | 100% | 命中 100% |
| CET6 2015.12 set1 reading | 100% | 命中 100% |
| CET6 2015.12 set1 reading 2 | 100% | 命中 100% |
| CET6 2015.12 set2 cloze | 100% | 命中 100% |
| CET6 2015.12 set2 match | 100% | 命中 100% |
| CET6 2015.12 set2 reading | 100% | 命中 100% |
| CET6 2015.12 set2 reading 2 | 100% | 命中 100% |
| CET6 2015.12 set3 cloze | 100% | 命中 100% |
| CET6 2015.12 set3 reading | 无锚点 | 无锚点 |
| CET6 2015.12 set3 reading 2 | 100% | 命中 100% |
| CET6 2016.12 set1 cloze | 100% | 命中 100% |
| CET6 2016.12 set1 match | 100% | 命中 100% |
| CET6 2016.12 set1 reading | 100% | 命中 100% |
| CET6 2016.12 set1 reading 2 | 100% | 命中 100% |
| CET6 2016.12 set2 cloze | 100% | 命中 100% |
| CET6 2016.12 set2 reading | 100% | 命中 100% |
| CET6 2016.12 set2 reading 2 | 100% | 命中 100% |
| CET6 2016.12 set3 cloze | 无锚点 | 无锚点 |
| CET6 2016.12 set3 match | 96% | 命中 96% |
| CET6 2016.12 set3 reading 2 | 83% | 命中 83% |
| CET6 2017.6 set1 cloze | 100% | 命中 100% |
| CET6 2017.6 set1 match | 100% | 命中 100% |
| CET6 2017.6 set1 reading | 100% | 命中 100% |
| CET6 2017.6 set1 reading 2 | 100% | 命中 100% |
| CET6 2017.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2017.6 set2 match | 100% | 命中 100% |
| CET6 2017.6 set2 reading | 0% | 命中 0% |
| CET6 2017.6 set2 reading 2 | 100% | 命中 100% |
| CET6 2017.6 set3 cloze | 无锚点 | 无锚点 |
| CET6 2017.6 set3 match | 100% | 命中 100% |
| CET6 2017.6 set3 reading | 100% | 命中 100% |
| CET6 2017.6 set3 reading 2 | 100% | 命中 100% |
| CET6 2017.12 set1 match | 100% | 命中 100% |
| CET6 2017.12 set2 cloze | 100% | 命中 100% |
| CET6 2017.12 set2 match | 100% | 命中 100% |
| CET6 2017.12 set2 reading | 100% | 命中 100% |
| CET6 2017.12 set2 reading 2 | 100% | 命中 100% |
| CET6 2017.12 set3 cloze | 100% | 命中 100% |
| CET6 2017.12 set3 match | 100% | 命中 100% |
| CET6 2017.12 set3 reading | 100% | 命中 100% |
| CET6 2017.12 set3 reading 2 | 100% | 命中 100% |
| CET6 2019.6 set1 cloze | 100% | 命中 100% |
| CET6 2019.6 set1 match | 94% | 命中 94% |
| CET6 2019.6 set1 reading | 100% | 命中 100% |
| CET6 2019.6 set1 reading 2 | 100% | 命中 100% |
| CET6 2019.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2019.6 set2 match | 100% | 命中 100% |
| CET6 2019.6 set2 reading | 92% | 命中 92% |
| CET6 2019.6 set2 reading 2 | 100% | 命中 100% |
| CET6 2019.6 set3 cloze | 100% | 命中 100% |
| CET6 2019.6 set3 match | 90% | 命中 90% |
| CET6 2019.6 set3 reading | 无锚点 | 无锚点 |
| CET6 2019.6 set3 reading 2 | 100% | 命中 100% |
| CET6 2019.12 set1 cloze | 无锚点 | 无锚点 |
| CET6 2019.12 set1 match | 100% | 命中 100% |
| CET6 2019.12 set1 reading | 100% | 命中 100% |
| CET6 2019.12 set1 reading 2 | 100% | 命中 100% |
| CET6 2019.12 set2 cloze | 100% | 命中 100% |
| CET6 2019.12 set2 match | 100% | 命中 100% |
| CET6 2019.12 set2 reading | 无锚点 | 无锚点 |
| CET6 2019.12 set2 reading 2 | 100% | 命中 100% |
| CET6 2019.12 set3 match | 100% | 命中 100% |
| CET6 2019.12 set3 reading | 100% | 命中 100% |
| CET6 2019.12 set3 reading 2 | 100% | 命中 100% |
| CET6 2020.7 set1 cloze | 无锚点 | 无锚点 |
| CET6 2020.7 set1 match | 100% | 命中 100% |
| CET6 2020.7 set1 reading | 100% | 命中 100% |
| CET6 2020.7 set1 reading 2 | 100% | 命中 100% |
| CET6 2020.9 set1 cloze | 无锚点 | 无锚点 |
| CET6 2020.9 set1 match | 100% | 命中 100% |
| CET6 2020.9 set1 reading | 100% | 命中 100% |
| CET6 2020.9 set2 cloze | 无锚点 | 无锚点 |
| CET6 2020.9 set2 match | 92% | 命中 92% |
| CET6 2020.9 set2 reading | 100% | 命中 100% |
| CET6 2020.12 set1 cloze | 100% | 命中 100% |
| CET6 2020.12 set1 match | 100% | 命中 100% |
| CET6 2020.12 set1 reading | 无锚点 | 无锚点 |
| CET6 2020.12 set1 reading 2 | 100% | 命中 100% |
| CET6 2020.12 set2 match | 94% | 命中 94% |
| CET6 2020.12 set2 reading | 100% | 命中 100% |
| CET6 2020.12 set2 reading 2 | 100% | 命中 100% |
| CET6 2020.12 set3 cloze | 无锚点 | 无锚点 |
| CET6 2020.12 set3 match | 83% | 命中 83% |
| CET6 2020.12 set3 reading | 无锚点 | 无锚点 |
| CET6 2020.12 set3 reading 2 | 100% | 命中 100% |
| CET6 2021.6 set1 cloze | 100% | 命中 100% |
| CET6 2021.6 set1 match | 83% | 命中 83% |
| CET6 2021.6 set1 reading | 0% | 命中 0% |
| CET6 2021.6 set2 cloze | 67% | 命中 67% |
| CET6 2021.6 set2 match | 80% | 命中 80% |
| CET6 2021.6 set3 cloze | 60% | 命中 60% |
| CET6 2021.6 set3 match | 63% | 命中 63% |
| CET6 2021.6 set3 reading | 50% | 命中 50% |
| CET6 2022.6 set1 cloze | 100% | 命中 100% |
| CET6 2022.6 set1 match | 100% | 命中 100% |
| CET6 2022.6 set1 reading | 无锚点 | 无锚点 |
| CET6 2022.6 set1 reading 2 | 100% | 命中 100% |
| CET6 2022.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2022.6 set2 match | 88% | 命中 88% |
| CET6 2022.6 set2 reading | 100% | 命中 100% |
| CET6 2022.6 set2 reading 2 | 无锚点 | 无锚点 |
| CET6 2022.9 set3 cloze | 83% | 命中 83% |
| CET6 2022.9 set3 match | 100% | 命中 100% |
| CET6 2022.9 set3 reading | 100% | 命中 100% |
| CET6 2022.9 set3 reading 2 | 100% | 命中 100% |
| CET6 2023.12 set1 cloze | 100% | 命中 100% |
| CET6 2023.12 set1 reading | 100% | 命中 100% |
| CET6 2023.12 set2 cloze | 无锚点 | 无锚点 |
| CET6 2023.12 set2 match | 94% | 命中 94% |
| CET6 2023.12 set2 reading | 100% | 命中 100% |
| CET6 2023.12 set2 reading 2 | 100% | 命中 100% |
| CET6 2023.12 set3 cloze | 无锚点 | 无锚点 |
| CET6 2023.12 set3 match | 100% | 命中 100% |
| CET6 2023.12 set3 reading | 无锚点 | 无锚点 |
| CET6 2024.6 set1 cloze | 无锚点 | 无锚点 |
| CET6 2024.6 set1 match | 96% | 命中 96% |
| CET6 2024.6 set1 reading | 无锚点 | 无锚点 |
| CET6 2024.6 set1 reading 2 | 100% | 命中 100% |
| CET6 2024.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2024.6 set2 match | 100% | 命中 100% |
| CET6 2024.6 set2 reading | 100% | 命中 100% |
| CET6 2024.6 set2 reading 2 | 无锚点 | 无锚点 |
| CET6 2024.6 set3 cloze | 无锚点 | 无锚点 |
| CET6 2024.6 set3 match | 100% | 命中 100% |
| CET6 2024.6 set3 reading | 无锚点 | 无锚点 |
| CET6 2024.6 set3 reading 2 | 100% | 命中 100% |
| CET6 2024.12 set1 cloze | 无锚点 | 无锚点 |
| CET6 2024.12 set1 match | 100% | 命中 100% |
| CET6 2024.12 set1 reading | 无锚点 | 无锚点 |
| CET6 2024.12 set1 reading 2 | 100% | 命中 100% |
| CET6 2024.12 set2 cloze | 无锚点 | 无锚点 |
| CET6 2024.12 set2 match | 100% | 命中 100% |
| CET6 2024.12 set2 reading | 无锚点 | 无锚点 |
| CET6 2024.12 set2 reading 2 | 无锚点 | 无锚点 |
| CET6 2024.12 set3 cloze | 100% | 命中 100% |
| CET6 2024.12 set3 match | 100% | 命中 100% |
| CET6 2024.12 set3 reading | 无锚点 | 无锚点 |
| CET6 2024.12 set3 reading 2 | 100% | 命中 100% |
| CET6 2025.12 set1 cloze | 100% | 命中 100% |
| CET6 2025.12 set1 match | 100% | 命中 100% |
| CET6 2025.12 set1 reading | 无锚点 | 无锚点 |
| CET6 2025.12 set1 reading 2 | 75% | 命中 75% |
| CET6 2026.6 set1 cloze | 100% | 命中 100% |
| CET6 2026.6 set1 match | 100% | 命中 100% |
| CET6 2026.6 set1 reading | 100% | 命中 100% |

## 判定方法说明

- 锚点：原文句中的年份/百分比/金额等数字（译文中通常原样保留）；命中率按锚点逐个统计
- 邻行候选：未命中锚点仅在 ±3 行内某一行出现才计提示，多处出现单独列为歧义；提示须人工复核，不是语义结论。覆盖率：各行中文字数合计 / 译文总字数
- 仅排除本篇题号的裸数字，35 percent 等明确百分比仍计入；Directions 行不计入锚点
