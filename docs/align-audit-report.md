# 逐篇对齐质量审查报告（v0.3.1，最终口径）

- 审计对象：入库的 passage.rows（写死绑定结果），311 篇带译文篇章
- 风险分级：**A（可信）237 篇 · B（待观察）65 篇 · C（真可疑）9 篇**
- 锚点匹配已归一化：千分位逗号（1,000=1000）、万进制（4.4万=44000）、中文数字（二十世纪=20世纪、百分之六十二=62%）；Directions 行与选词填空空号不计
- 评级为证据分级：字母错位/漂移≥2/覆盖<90%/归一化后命中<20% → C；漂移1/命中<45%/覆盖<97% → B；其余 → A

## C 级（真可疑，建议人工复核）
- **CET4 2016.12 set2 cloze** — 漂移 2 次 / 锚点命中 33%
- **CET4 2016.12 set3 match** — 锚点命中 0%（归一化后）
  - #3 锚点[1.65,2015,11.1,2020]｜EN: C)It might mean monitoring employee productivity on a digital leaderbo…
    ZH: [C] 它可能意味着在数字排行榜上监控员工的工作效率并给赢家发奖品，也可能意味着为完成特定任务的员工颁发数字徽章或星星，还可…
  - #4 锚点[100]｜EN: D)The concept of gamification is not entirely new, Werbach says. Compa…
    ZH: [D] 韦尔巴赫说，游戏化的概念并不全新。公司、营销人员和教师长久以来一直在寻找有趣的方式来调动人们寻求奖励或好胜的天性。他…
- **CET4 2019.12 set3 match** — 漂移 2 次 / 锚点命中 40%
  - #29 锚点[90,2005]｜EN: There are mothers pushing baby carriages, old women with walkers—even …
    ZH: 他的大多数客户是韩国人。…
- **CET4 2023.12 set1 match** — 漂移 2 次 / 锚点命中 0%（归一化后）
  - #25 锚点[75,36,1961]｜EN: I） Another potential climate change-induced problem is our dependence …
    ZH: 我们今天全球吃的食物比1961年相似了36%。虽然这对世界上最贫穷的人是好消息（他们现在比过去摄入更多热量、蛋白质和脂肪），…
  - #29 锚点[440]｜EN: "The people at Monsanto who Fve talked to are much more optimistic tha…
    ZH: " K) 在基因工程实现之前，其他策略在某些地方也可能有帮助，包括施用更多肥料、实施更好的灌溉、使用能更快将作物运出田间的机…
- **CET6 2017.12 set3 match** — 漂移 2 次 / 锚点命中 25%
  - #11 锚点[1990]｜EN: I) "A comparison point is in the 1990s battles over encryption," said …
    ZH: [I] 电子前沿基金会（一个隐私监督组织）的总法律顾问库尔特·奥普萨尔说：“一个可对比的点是20世纪90年代围绕加密问题的斗…
- **CET6 2019.12 set1 match** — 锚点命中 18%（归一化后）
  - #2 锚点[1960,2000]｜EN: B) Now a new study has provided another contribution to the debate, un…
    ZH: B) 现在一项新研究为这场争论又提供了一份贡献，它揭示了强有力的证据，表明美国青少年的幸福感确实在下降，并认为最可能的原因是…
  - #3 锚点[10,12,1991,1.1,1990,2000,2012,2016]｜EN: C) To investigate, Twenge and her colleagues dived into the & quote; M…
    ZH: C) 为了调查，特温格和她的同事深入研究了“监测未来”数据集，该数据集基于1991年开始对美国8、10、12年级学生的年度调…
- **CET6 2020.7 set1 reading** — 锚点命中 11%（归一化后）
  - #10 锚点[2006,12.5,2001,15,1996]｜EN: Data gathered by the U. S. Fish & Wildlife Service in 2006 show that o…
    ZH: 美国鱼类与野生动物管理局2006年收集的数据显示，如今只有5%的美国人——约1250万人——认为自己是猎人，低于2001年的…
- **CET6 2022.9 set3 reading** — 漂移 2 次 / 锚点命中 25%
- **CET6 2024.6 set1 reading** — 漂移 2 次 / 锚点命中 42%

## B 级（待观察）
- CET4 2014.6 set1 match — 锚点命中 40%
- CET4 2016.12 set3 reading — 锚点命中 33%
- CET4 2017.6 set1 reading — 锚点命中 20%
- CET4 2017.6 set2 reading — 锚点命中 20%
- CET4 2017.6 set3 cloze — 锚点命中 25%
- CET4 2017.12 set3 cloze — 锚点命中 44%
- CET4 2018.12 set2 reading — 锚点命中 40%
- CET4 2019.6 set1 match — 锚点命中 23%
- CET4 2019.6 set1 reading — 锚点命中 36%
- CET4 2019.6 set2 match — 锚点命中 23%
- CET4 2019.6 set2 reading — 锚点命中 36%
- CET4 2019.6 set3 match — 锚点命中 33%
- CET4 2019.12 set1 cloze — 锚点命中 40%
- CET4 2019.12 set3 reading — 锚点命中 40%
- CET4 2023.6 set2 cloze — 锚点命中 25%
- CET4 2023.6 set2 match — 锚点命中 0%
- CET4 2023.6 set3 match — 漂移 1 次 / 锚点命中 37%
- CET4 2023.12 set1 cloze — 锚点命中 44%
- CET4 2023.12 set2 match — 锚点命中 44%
- CET4 2023.12 set3 match — 锚点命中 33%
- CET4 2024.6 set1 match — 漂移 1 次 / 锚点命中 36%
- CET4 2024.6 set3 match — 漂移 1 次 / 锚点命中 33%
- CET4 2024.12 set1 reading — 锚点命中 40%
- CET4 2024.12 set1 reading — 锚点命中 33%
- CET4 2025.6 set1 match — 锚点命中 28%
- CET4 2025.12 set1 reading — 锚点命中 30%
- CET6 2015.6 set1 match — 锚点命中 40%
- CET6 2015.6 set2 match — 漂移 1 次
- CET6 2015.6 set3 match — 锚点命中 33%
- CET6 2016.12 set1 cloze — 锚点命中 33%
- CET6 2016.12 set2 match — 锚点命中 43%
- CET6 2016.12 set3 match — 锚点命中 29%
- CET6 2016.12 set3 reading — 锚点命中 33%
- CET6 2017.6 set2 match — 漂移 1 次 / 锚点命中 44%
- CET6 2017.6 set3 match — 锚点命中 35%
- CET6 2017.12 set1 cloze — 锚点命中 25%
- CET6 2017.12 set1 reading — 漂移 1 次
- CET6 2017.12 set1 reading — 漂移 1 次
- CET6 2017.12 set2 reading — 锚点命中 33%
- CET6 2019.6 set1 match — 锚点命中 44%
- CET6 2019.6 set2 reading — 漂移 1 次 / 锚点命中 33%
- CET6 2019.6 set3 match — 锚点命中 40%
- CET6 2019.12 set2 cloze — 锚点命中 40%
- CET6 2019.12 set2 match — 漂移 1 次
- CET6 2019.12 set3 match — 锚点命中 27%
- CET6 2019.12 set3 reading — 锚点命中 25%
- CET6 2020.9 set2 match — 锚点命中 22%
- CET6 2020.12 set2 match — 锚点命中 23%
- CET6 2020.12 set2 reading — 锚点命中 20%
- CET6 2021.6 set1 reading — 锚点命中 33%
- CET6 2021.6 set2 cloze — 锚点命中 33%
- CET6 2021.6 set2 match — 锚点命中 31%
- CET6 2021.6 set3 match — 锚点命中 31%
- CET6 2021.6 set3 reading — 锚点命中 25%
- CET6 2021.6 set3 reading — 锚点命中 0%
- CET6 2022.6 set1 match — 锚点命中 44%
- CET6 2022.6 set2 match — 锚点命中 33%
- CET6 2022.9 set3 cloze — 锚点命中 33%
- CET6 2023.12 set1 match — 锚点命中 27%
- CET6 2023.12 set2 match — 漂移 1 次 / 锚点命中 31%
- CET6 2023.12 set3 reading — 锚点命中 40%
- CET6 2024.6 set1 match — 锚点命中 27%
- CET6 2024.12 set1 match — 锚点命中 43%
- CET6 2024.12 set3 cloze — 锚点命中 33%
- CET6 2026.6 set1 reading — 锚点命中 25%

## A 级明细

| 篇章 | 锚点命中 | 备注 |
|---|---|---|
| CET4 2014.6 set1 cloze | 56% | 命中 56% |
| CET4 2014.6 set1 reading | 100% | 命中 100% |
| CET4 2014.6 set1 reading | 无锚点 | 无锚点 |
| CET4 2015.12 set1 cloze | 无锚点 | 无锚点 |
| CET4 2015.12 set1 match | 100% | 命中 100% |
| CET4 2015.12 set1 reading | 100% | 命中 100% |
| CET4 2015.12 set1 reading | 67% | 命中 67% |
| CET4 2015.12 set2 cloze | 100% | 命中 100% |
| CET4 2015.12 set2 match | 60% | 命中 60% |
| CET4 2015.12 set2 reading | 无锚点 | 无锚点 |
| CET4 2015.12 set2 reading | 100% | 命中 100% |
| CET4 2015.12 set3 cloze | 0% | 命中 0% |
| CET4 2015.12 set3 match | 67% | 命中 67% |
| CET4 2015.12 set3 reading | 100% | 命中 100% |
| CET4 2015.12 set3 reading | 无锚点 | 无锚点 |
| CET4 2016.12 set2 match | 67% | 命中 67% |
| CET4 2016.12 set2 reading | 无锚点 | 无锚点 |
| CET4 2016.12 set2 reading | 67% | 命中 67% |
| CET4 2016.12 set3 cloze | 50% | 命中 50% |
| CET4 2016.12 set3 reading | 100% | 命中 100% |
| CET4 2017.6 set1 cloze | 100% | 命中 100% |
| CET4 2017.6 set1 match | 45% | 命中 45% |
| CET4 2017.6 set1 reading | 100% | 命中 100% |
| CET4 2017.6 set2 cloze | 100% | 命中 100% |
| CET4 2017.6 set2 match | 45% | 命中 45% |
| CET4 2017.6 set2 reading | 100% | 命中 100% |
| CET4 2017.6 set3 match | 无锚点 | 无锚点 |
| CET4 2017.6 set3 reading | 88% | 命中 88% |
| CET4 2017.6 set3 reading | 无锚点 | 无锚点 |
| CET4 2017.12 set1 cloze | 50% | 命中 50% |
| CET4 2017.12 set1 match | 50% | 命中 50% |
| CET4 2017.12 set1 reading | 无锚点 | 无锚点 |
| CET4 2017.12 set1 reading | 50% | 命中 50% |
| CET4 2017.12 set3 match | 100% | 命中 100% |
| CET4 2017.12 set3 reading | 100% | 命中 100% |
| CET4 2017.12 set3 reading | 100% | 命中 100% |
| CET4 2018.12 set1 cloze | 50% | 命中 50% |
| CET4 2018.12 set1 match | 100% | 命中 100% |
| CET4 2018.12 set1 reading | 83% | 命中 83% |
| CET4 2018.12 set1 reading | 50% | 命中 50% |
| CET4 2018.12 set2 cloze | 无锚点 | 无锚点 |
| CET4 2018.12 set2 match | 64% | 命中 64% |
| CET4 2018.12 set2 reading | 100% | 命中 100% |
| CET4 2018.12 set3 cloze | 无锚点 | 无锚点 |
| CET4 2018.12 set3 match | 46% | 命中 46% |
| CET4 2018.12 set3 reading | 无锚点 | 无锚点 |
| CET4 2018.12 set3 reading | 50% | 命中 50% |
| CET4 2019.6 set1 cloze | 无锚点 | 无锚点 |
| CET4 2019.6 set1 reading | 67% | 命中 67% |
| CET4 2019.6 set2 cloze | 无锚点 | 无锚点 |
| CET4 2019.6 set2 reading | 67% | 命中 67% |
| CET4 2019.6 set3 cloze | 100% | 命中 100% |
| CET4 2019.6 set3 reading | 100% | 命中 100% |
| CET4 2019.6 set3 reading | 50% | 命中 50% |
| CET4 2019.12 set1 match | 65% | 命中 65% |
| CET4 2019.12 set1 reading | 100% | 命中 100% |
| CET4 2019.12 set1 reading | 75% | 命中 75% |
| CET4 2019.12 set2 cloze | 100% | 命中 100% |
| CET4 2019.12 set2 match | 62% | 命中 62% |
| CET4 2019.12 set2 reading | 75% | 命中 75% |
| CET4 2019.12 set2 reading | 无锚点 | 无锚点 |
| CET4 2019.12 set3 cloze | 50% | 命中 50% |
| CET4 2019.12 set3 reading | 75% | 命中 75% |
| CET4 2023.6 set2 reading | 71% | 命中 71% |
| CET4 2023.6 set2 reading | 67% | 命中 67% |
| CET4 2023.6 set3 cloze | 50% | 命中 50% |
| CET4 2023.6 set3 reading | 无锚点 | 无锚点 |
| CET4 2023.6 set3 reading | 50% | 命中 50% |
| CET4 2023.12 set1 reading | 100% | 命中 100% |
| CET4 2023.12 set1 reading | 100% | 命中 100% |
| CET4 2023.12 set2 cloze | 100% | 命中 100% |
| CET4 2023.12 set2 reading | 无锚点 | 无锚点 |
| CET4 2023.12 set2 reading | 无锚点 | 无锚点 |
| CET4 2023.12 set3 cloze | 无锚点 | 无锚点 |
| CET4 2023.12 set3 reading | 71% | 命中 71% |
| CET4 2023.12 set3 reading | 无锚点 | 无锚点 |
| CET4 2024.6 set1 cloze | 100% | 命中 100% |
| CET4 2024.6 set1 reading | 无锚点 | 无锚点 |
| CET4 2024.6 set1 reading | 67% | 命中 67% |
| CET4 2024.6 set2 cloze | 67% | 命中 67% |
| CET4 2024.6 set2 match | 100% | 命中 100% |
| CET4 2024.6 set2 reading | 无锚点 | 无锚点 |
| CET4 2024.6 set2 reading | 100% | 命中 100% |
| CET4 2024.6 set3 cloze | 50% | 命中 50% |
| CET4 2024.6 set3 reading | 67% | 命中 67% |
| CET4 2024.6 set3 reading | 无锚点 | 无锚点 |
| CET4 2024.12 set1 cloze | 57% | 命中 57% |
| CET4 2024.12 set1 match | 63% | 命中 63% |
| CET4 2025.6 set1 cloze | 无锚点 | 无锚点 |
| CET4 2025.6 set1 reading | 100% | 命中 100% |
| CET4 2025.6 set1 reading | 无锚点 | 无锚点 |
| CET4 2025.12 set1 cloze | 无锚点 | 无锚点 |
| CET4 2025.12 set1 match | 75% | 命中 75% |
| CET4 2025.12 set1 reading | 100% | 命中 100% |
| CET4 2026.6 set1 cloze | 无锚点 | 无锚点 |
| CET4 2026.6 set1 match | 57% | 命中 57% |
| CET4 2026.6 set1 reading | 100% | 命中 100% |
| CET4 2026.6 set1 reading | 100% | 命中 100% |
| CET6 2014.6 set1 cloze | 无锚点 | 无锚点 |
| CET6 2014.6 set1 match | 73% | 命中 73% |
| CET6 2014.6 set1 reading | 67% | 命中 67% |
| CET6 2014.6 set1 reading | 无锚点 | 无锚点 |
| CET6 2014.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2014.6 set2 match | 67% | 命中 67% |
| CET6 2014.6 set2 reading | 无锚点 | 无锚点 |
| CET6 2014.6 set2 reading | 100% | 命中 100% |
| CET6 2015.6 set1 cloze | 100% | 命中 100% |
| CET6 2015.6 set1 reading | 67% | 命中 67% |
| CET6 2015.6 set1 reading | 无锚点 | 无锚点 |
| CET6 2015.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2015.6 set2 reading | 无锚点 | 无锚点 |
| CET6 2015.6 set2 reading | 无锚点 | 无锚点 |
| CET6 2015.6 set3 cloze | 0% | 命中 0% |
| CET6 2015.6 set3 reading | 50% | 命中 50% |
| CET6 2015.6 set3 reading | 50% | 命中 50% |
| CET6 2015.12 set1 cloze | 50% | 命中 50% |
| CET6 2015.12 set1 match | 50% | 命中 50% |
| CET6 2015.12 set1 reading | 83% | 命中 83% |
| CET6 2015.12 set1 reading | 67% | 命中 67% |
| CET6 2015.12 set2 cloze | 60% | 命中 60% |
| CET6 2015.12 set2 match | 80% | 命中 80% |
| CET6 2015.12 set2 reading | 50% | 命中 50% |
| CET6 2015.12 set2 reading | 100% | 命中 100% |
| CET6 2015.12 set3 cloze | 100% | 命中 100% |
| CET6 2015.12 set3 match | 80% | 命中 80% |
| CET6 2015.12 set3 reading | 无锚点 | 无锚点 |
| CET6 2015.12 set3 reading | 80% | 命中 80% |
| CET6 2016.12 set1 match | 50% | 命中 50% |
| CET6 2016.12 set1 reading | 100% | 命中 100% |
| CET6 2016.12 set1 reading | 80% | 命中 80% |
| CET6 2016.12 set2 cloze | 100% | 命中 100% |
| CET6 2016.12 set2 reading | 67% | 命中 67% |
| CET6 2016.12 set2 reading | 100% | 命中 100% |
| CET6 2016.12 set3 cloze | 无锚点 | 无锚点 |
| CET6 2016.12 set3 reading | 50% | 命中 50% |
| CET6 2017.6 set1 cloze | 100% | 命中 100% |
| CET6 2017.6 set1 match | 58% | 命中 58% |
| CET6 2017.6 set1 reading | 50% | 命中 50% |
| CET6 2017.6 set1 reading | 67% | 命中 67% |
| CET6 2017.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2017.6 set2 reading | 0% | 命中 0% |
| CET6 2017.6 set2 reading | 100% | 命中 100% |
| CET6 2017.6 set3 cloze | 无锚点 | 无锚点 |
| CET6 2017.6 set3 reading | 100% | 命中 100% |
| CET6 2017.6 set3 reading | 100% | 命中 100% |
| CET6 2017.12 set1 match | 50% | 命中 50% |
| CET6 2017.12 set2 cloze | 50% | 命中 50% |
| CET6 2017.12 set2 match | 50% | 命中 50% |
| CET6 2017.12 set2 reading | 67% | 命中 67% |
| CET6 2017.12 set3 cloze | 45% | 命中 45% |
| CET6 2017.12 set3 reading | 100% | 命中 100% |
| CET6 2017.12 set3 reading | 100% | 命中 100% |
| CET6 2019.6 set1 cloze | 100% | 命中 100% |
| CET6 2019.6 set1 reading | 100% | 命中 100% |
| CET6 2019.6 set1 reading | 100% | 命中 100% |
| CET6 2019.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2019.6 set2 match | 46% | 命中 46% |
| CET6 2019.6 set2 reading | 57% | 命中 57% |
| CET6 2019.6 set3 cloze | 100% | 命中 100% |
| CET6 2019.6 set3 reading | 无锚点 | 无锚点 |
| CET6 2019.6 set3 reading | 50% | 命中 50% |
| CET6 2019.12 set1 cloze | 无锚点 | 无锚点 |
| CET6 2019.12 set1 reading | 100% | 命中 100% |
| CET6 2019.12 set1 reading | 86% | 命中 86% |
| CET6 2019.12 set2 reading | 无锚点 | 无锚点 |
| CET6 2019.12 set2 reading | 100% | 命中 100% |
| CET6 2019.12 set3 reading | 50% | 命中 50% |
| CET6 2020.7 set1 cloze | 无锚点 | 无锚点 |
| CET6 2020.7 set1 match | 67% | 命中 67% |
| CET6 2020.7 set1 reading | 100% | 命中 100% |
| CET6 2020.9 set1 cloze | 无锚点 | 无锚点 |
| CET6 2020.9 set1 match | 71% | 命中 71% |
| CET6 2020.9 set1 reading | 100% | 命中 100% |
| CET6 2020.9 set1 reading | 80% | 命中 80% |
| CET6 2020.9 set2 cloze | 无锚点 | 无锚点 |
| CET6 2020.9 set2 reading | 71% | 命中 71% |
| CET6 2020.9 set2 reading | 60% | 命中 60% |
| CET6 2020.12 set1 cloze | 无锚点 | 无锚点 |
| CET6 2020.12 set1 match | 100% | 命中 100% |
| CET6 2020.12 set1 reading | 无锚点 | 无锚点 |
| CET6 2020.12 set1 reading | 50% | 命中 50% |
| CET6 2020.12 set2 cloze | 71% | 命中 71% |
| CET6 2020.12 set2 reading | 100% | 命中 100% |
| CET6 2020.12 set3 cloze | 无锚点 | 无锚点 |
| CET6 2020.12 set3 match | 71% | 命中 71% |
| CET6 2020.12 set3 reading | 无锚点 | 无锚点 |
| CET6 2020.12 set3 reading | 100% | 命中 100% |
| CET6 2021.6 set1 cloze | 80% | 命中 80% |
| CET6 2021.6 set1 match | 50% | 命中 50% |
| CET6 2021.6 set1 reading | 0% | 命中 0% |
| CET6 2021.6 set2 reading | 50% | 命中 50% |
| CET6 2021.6 set2 reading | 0% | 命中 0% |
| CET6 2021.6 set3 cloze | 60% | 命中 60% |
| CET6 2022.6 set1 cloze | 67% | 命中 67% |
| CET6 2022.6 set1 reading | 无锚点 | 无锚点 |
| CET6 2022.6 set1 reading | 100% | 命中 100% |
| CET6 2022.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2022.6 set2 reading | 100% | 命中 100% |
| CET6 2022.6 set2 reading | 无锚点 | 无锚点 |
| CET6 2022.9 set3 match | 53% | 命中 53% |
| CET6 2022.9 set3 reading | 0% | 命中 0% |
| CET6 2023.12 set1 cloze | 0% | 命中 0% |
| CET6 2023.12 set1 reading | 100% | 命中 100% |
| CET6 2023.12 set1 reading | 67% | 命中 67% |
| CET6 2023.12 set2 cloze | 无锚点 | 无锚点 |
| CET6 2023.12 set2 reading | 100% | 命中 100% |
| CET6 2023.12 set2 reading | 100% | 命中 100% |
| CET6 2023.12 set3 cloze | 无锚点 | 无锚点 |
| CET6 2023.12 set3 match | 50% | 命中 50% |
| CET6 2023.12 set3 reading | 无锚点 | 无锚点 |
| CET6 2024.6 set1 cloze | 无锚点 | 无锚点 |
| CET6 2024.6 set1 reading | 无锚点 | 无锚点 |
| CET6 2024.6 set2 cloze | 无锚点 | 无锚点 |
| CET6 2024.6 set2 match | 100% | 命中 100% |
| CET6 2024.6 set2 reading | 100% | 命中 100% |
| CET6 2024.6 set2 reading | 无锚点 | 无锚点 |
| CET6 2024.6 set3 cloze | 无锚点 | 无锚点 |
| CET6 2024.6 set3 match | 50% | 命中 50% |
| CET6 2024.6 set3 reading | 无锚点 | 无锚点 |
| CET6 2024.6 set3 reading | 100% | 命中 100% |
| CET6 2024.12 set1 cloze | 无锚点 | 无锚点 |
| CET6 2024.12 set1 reading | 无锚点 | 无锚点 |
| CET6 2024.12 set1 reading | 100% | 命中 100% |
| CET6 2024.12 set2 cloze | 无锚点 | 无锚点 |
| CET6 2024.12 set2 match | 56% | 命中 56% |
| CET6 2024.12 set2 reading | 无锚点 | 无锚点 |
| CET6 2024.12 set2 reading | 无锚点 | 无锚点 |
| CET6 2024.12 set3 match | 100% | 命中 100% |
| CET6 2024.12 set3 reading | 无锚点 | 无锚点 |
| CET6 2024.12 set3 reading | 100% | 命中 100% |
| CET6 2025.12 set1 cloze | 67% | 命中 67% |
| CET6 2025.12 set1 match | 70% | 命中 70% |
| CET6 2025.12 set1 reading | 无锚点 | 无锚点 |
| CET6 2025.12 set1 reading | 50% | 命中 50% |
| CET6 2026.6 set1 cloze | 75% | 命中 75% |
| CET6 2026.6 set1 match | 100% | 命中 100% |
| CET6 2026.6 set1 reading | 100% | 命中 100% |

## 判定方法说明

- 锚点：原文句中的年份/百分比/金额等数字（译文中通常原样保留）；命中率按锚点逐个统计
- 漂移：锚点出现在相邻 ±3 行（对应错位的直接证据）；覆盖率：各行中文字数合计 / 译文总字数
- 选词填空空号（26–35 或本篇题号）与 Directions 行不计入锚点
