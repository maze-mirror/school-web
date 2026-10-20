# 三个网页项目 模块接口与首轮开发约定

版本：V0.1  
日期：2026 年 10 月 14 日  
适用仓库：school-web  
阶段：初版接口约定与首轮任务规划

本文保留 2026-10-14 的首轮规划背景，不是当前功能清单。代码统计当前状态以 `PROJECT.md`、设计说明 V0.2 和源码为准；例如本文曾规划的 HTML 统计目前未实现。2026-10-20 按用户确认删除移动布局验收要求，其他历史规划未转为新的开发任务。

本文衔接需求规格说明书和设计说明书，明确模块职责、交换数据、异常及首轮验收。接口名称是待实现的开发约定，不代表代码已经完成。仅整理接口与任务，不包含产品源代码。

## 1 当前基础与目录边界

已检查的本地仓库位于 `D:\Projects\school-web`，包含三个应用，当前分支为 main，检查时没有未提交的修改。根配置记录 pnpm 12.11.2，三个应用均已有 Vue、TypeScript、Router、Pinia 和 Vitest 配置。已安装不等于构建或业务功能通过；本文不提供未经执行的测试结论。

| 目录 | 职责 | 允许依赖 |
|---|---|---|
| apps/code-meter-web | 导入页面、统计结果、历史、图表和交互 | 统计核心、浏览器适配、共享界面 |
| apps/arithmetic-web | 练习设置、作答、评改展示和历史分析 | 练习核心、浏览器适配、共享界面 |
| apps/portfolio-web | 双人成长内容、作品介绍与项目访问 | 共享界面及静态内容 |
| packages/code-core | 文本分析、文件筛选规则、汇总与快照比较 | 通用类型及必要的纯分析依赖 |
| packages/arithmetic-core | 题型配额、生成、求值、评改与统计 | 通用类型及必要的纯计算依赖 |
| packages/platform-browser | 文件导入、IndexedDB、下载和任务调度 | 核心模块公开的类型与接口 |
| packages/ui | 主题、按钮、表单、图例及空状态 | Vue 及界面依赖 |
| docs | 需求、设计、接口、分工和运行说明 | 不适用 |

这些共享包是规划目录，当前不用先创建一批空实现。一个模块开始实现时，再创建它的 package.json、公开入口和检查配置。

依赖方向为应用调用核心与适配器。核心不能反向导入应用、Vue 组件、DOM、浏览器 File、IndexedDB、插件 API 或桌面 API。平台适配器负责将外部文件转换成核心需要的文本输入。核心通过公开入口暴露能力，应用不能直接引用包内的私有实现路径。

## 2 通用交换规则

- ID 使用字符串，生成后不随名称修改。文件使用项目内相对路径，不保存用户电脑的绝对路径。
- 时间统一保存带时区信息的 ISO 8601 时间或等价时间戳；展示和日历聚合使用用户选定的时区。时间范围采用开始包含、结束不包含的边界。
- 数据持久化记录 schemaVersion；分析和生成记录 ruleVersion。二者分别表示数据结构和业务规则，不能相互代替。
- 正常的用户输入问题以结构化结果返回，包含成功状态、数据或错误。错误至少有 code、message 和必要 details，不把堆栈作为用户提示。
- 未知语言、不可用的语法统计、没有基线和空记录显式表示，不用数字零替代。
- 持久化、导入和导出应复查字段类型及范围；TypeScript 类型不能替代运行时校验。
- 相同 ID 的重试不能重复计入统计；取消中的任务不能写成成功完成的记录。

## 3 代码统计接口

### 3.1 主要数据

| 数据 | 必需字段 | 约定 |
|---|---|---|
| TextSource | relativePath、text、languageHint | 平台已完成读取和解码；提示语言可选 |
| ScanConfig | ruleVersion、exclusions、mode、docstringPolicy | 初版 mode 为基础行统计；Python 文档字符串默认包含 |
| LineCounts | total、blank、commentOnly、code、mixed | 前四项为非负整数；mixed 是 code 的子集 |
| FileStat | relativePath、language、status、lineCounts、reason | status 区分成功、跳过和失败；失败不伪造统计值 |
| LanguageStat | language、fileCount、lineCounts | 按归属语言聚合成功文件 |
| ScanSnapshot | id、projectId、scannedAt、timezone、ruleVersion、configHash、totals、languageStats | 只保存统计及配置，不保存代码正文 |
| SnapshotComparison | status、baselineId、endId、netCodeChange、reason | status 区分可比、缺基线和配置不兼容；不可比时差值为空 |

约束：total = blank + commentOnly + code，mixed 不大于 code。成功文件之和必须等于项目总计。跳过和失败单独显示数量与原因。

### 3.2 操作接口

| 操作名 | 输入 | 输出与职责 |
|---|---|---|
| detectLanguage | relativePath、可选文本特征 | 支持的语言标识或 unknown；人工指定优先于自动识别 |
| analyzeText | TextSource、ScanConfig | FileStat；正确处理字符串、注释与跨行状态 |
| summarizeFiles | FileStat 集合 | 项目总计、语言汇总、跳过与失败清单 |
| compareSnapshots | 两个快照 | 比较项目 ID 和规则配置，返回可解释净变化 |
| buildActivity | 快照集合、时间范围、时区、日或周粒度 | 每个时间格的成功扫描次数；只负责聚合，不负责颜色 |
| buildLanguageShares | 期末快照 | 语言行数、占比及总分母；空总量返回空状态 |

初版按整个 HTML 文件归属 HTML，必须在页面说明包含内嵌 JavaScript 和 CSS；暂不混入分数行当量。未来分段统计使用新模式及相应规则版本。

每种语言的分析器实现相同的 analyzeText 输入输出。不能把字符串中的注释符号删掉后计数；Python 三引号文本不能一律算注释。跨行字符串的内部空白行归属须在语言样例中明确，再固化为规则，不能由不同成员自行解释。

### 3.3 历史指标

当前代码总量等于最新成功快照，不是扫描结果累加。活动方块按成功扫描次数分档；不称为实际代码产出。语言饼图使用期末快照。净变化为可比期末快照减期初基线，允许负数；没有基线时不显示差值。

一周、一月、一年分别为最近 7、30、365 天，另外提供自定义日期。期末取结束边界前的最近成功快照；期初基线取开始边界前的最近兼容快照。没有区间内扫描时，区分无新活动与仍有历史快照可显示。

## 4 四则练习接口

### 4.1 主要数据

| 数据 | 必需字段 | 约定 |
|---|---|---|
| PracticeConfig | count、types、numberRange、carryPolicy、borrowPolicy、parentheses、allowDuplicates、ruleVersion | count 为 5 至 50 且是 5 的倍数；至少一类题型 |
| Question | id、type、expression、displayText、correctAnswer、ruleVersion | expression 是受控结构；显示文本不用于任意代码执行 |
| AnswerRecord | questionId、rawInput、normalizedAnswer、result | 区分 correct、wrong、unanswered；非法输入在提交前处理 |
| PracticeSession | id、config、questions、answers、status、startedAt、submittedAt、activeDuration | draft、inProgress、completed 状态清楚；进度可以恢复 |
| TypeSummary | type、total、correct、wrong、unanswered | total = correct + wrong + unanswered |
| PracticeSummary | sessionId、submittedAt、activeDuration、totals、countsByType、detailAvailable | 明细到期后保留；按实际题数加权聚合 |
| FavoriteQuestion | id、originSessionId、question、savedAt | 保留独立题目副本，不依赖到期明细 |

types 使用 addition、subtraction、multiplication、division、mixed 五种标识。加减与混合范围限制见需求说明书，默认只生成非负整数并避免零除。未选择的配置使用明确默认值，不依赖 undefined 的隐式行为。

### 4.2 操作接口

| 操作名 | 输入 | 输出与职责 |
|---|---|---|
| validatePracticeConfig | PracticeConfig | 合法配置或字段级错误 |
| allocateQuestions | count、types、可复现随机输入 | 每类配额；总和等于 count，各类最多相差一道 |
| generateQuestions | 合法配置、随机源或 seed | 全部合法题目，或题库不足的结构化错误 |
| evaluateExpression | 受控表达式 | 正确整数答案，或非法表达式错误 |
| gradeAnswers | 固定题目、作答集合 | 每题结果及 PracticeSummary；不修改原题 |
| aggregatePractices | 摘要集合、单次或累计或最近 N 次范围 | 总体及题型统计；无数据时比例为空 |
| selectRetryQuestions | 原题或收藏、再练方式 | 再练材料；开始后创建新会话，不覆盖原记录 |

随机源可替换，测试时使用固定输入或 seed 复现失败题目；正常练习采用随机种子。题目生成有尝试上限，候选不足返回 INSUFFICIENT_QUESTIONS，不无限循环或偷偷允许重复。

正确率 = 正确数 / 总题数；错误率 = 已答错数 / 总题数；未答率单独计算。累计正确率不是各次正确率的简单平均。只对已提交练习聚合，草稿不计入。mixed 独立统计，不根据最终答案猜测具体错误原因。

## 5 平台存储和任务接口

| 接口 | 操作 | 平台职责 |
|---|---|---|
| FileSourceAdapter | 选择输入、读取文本、取消 | 文件夹、多文件和 ZIP 转为 TextSource，校验路径与体积 |
| SnapshotRepository | save、list、get、delete、import、export | 项目标识与快照保存、版本校验及去重 |
| PracticeRepository | saveDraft、loadDraft、submit、listSummaries、getDetails | submit 在事务中完成评改记录、摘要与状态保存 |
| FavoriteRepository | add、list、remove | 收藏独立保存，同题收藏避免意外重复 |
| RetentionService | cleanExpired | 删除到期明细，保留摘要和收藏；返回清理数量 |
| ExportAdapter | download | 生成 JSON 或 CSV 下载，文本安全转义 |
| TaskRunner | run、cancel、onProgress | 浏览器 Worker 调度；向页面提供阶段、已处理数量和总量 |

纯网页版在应用启动、历史页进入等时机检查到期记录，不承诺关闭网页后仍按时间自动执行。保存失败必须向界面返回错误，不能显示已经保存。

未来增加桌面、浏览器插件或编辑器插件时，实现对应适配器，保留核心接口。浏览器存储不与桌面数据库假定兼容，应经导入导出与迁移流程转换。

## 6 个人主页内容接口

| 数据 | 必需内容 |
|---|---|
| Member | 稳定 ID、姓名、简介、图片信息、当前目标 |
| GrowthEvent | 成员 ID、日期或阶段、标题、实际行动、困难、收获 |
| PortfolioItem | 项目 ID、名称、用途、实际功能特点、截图、状态、访问地址 |
| ProjectDetail | 背景、用户、功能、设计选择、实际分工、收获、文档入口 |

先使用结构化静态内容，不建设后台。未知信息使用明确占位或隐藏。未部署的工具状态为建设中，访问按钮禁用；不要把 localhost 地址用于公开作品访问。两名成员分别提供真实内容，互相检查最终公开版本。

## 7 首轮任务与验收

建议按功能分工，成员名称可在协商后替换。共享模块的负责人负责维护接口，但修改接口仍需双方沟通。

| 顺序 | 任务 | 建议负责人 | 验收 |
|---|---|---|---|
| 1 | 确定语言样例和行分类边界 | 统计负责人 | 空文件、换行、字符串内注释符、多行注释、Python 字符串逐项标注 |
| 2 | 实现 code-core 基础接口 | 统计负责人 | 首先 C 类规则与 Python 通过人工样例，再逐语言扩展 |
| 3 | 实现 arithmetic-core 配额、生成、求值和评改 | 练习负责人 | 5 与 50 边界、余数配额、非负、整除、去重终止与空答案通过 |
| 4 | 接入各自应用的最小流程 | 各模块负责人 | 统计可导入文本并显示分类；练习可设置、作答并统一评改 |
| 5 | 实现本地仓库与草稿、摘要保存 | 双方明确存储分工 | 刷新可恢复；重复提交不重复统计；失败有提示 |
| 6 | 加入图表、时间范围与主题 | 各模块负责人 | 图表与表格一致；重复扫描不累加总量；主题不改变数据 |
| 7 | 补全双人成长内容和作品介绍 | 两人共同 | 内容真实；未就绪链接禁用 |

首轮先完成任务 1 至 4，不同时铺开所有页面。统计页先用数字表验证结果，练习页先完成正确的题目与评改；再做历史、活动方块和主题细节。

## 8 接口变更与 Git 协作

- main 保留经过检查的内容，功能分支按 feat/code-core、feat/arithmetic-core 等任务命名。
- 每次开始新任务先在工作区干净时更新 main，然后创建新分支。未提交修改先保存，不用强制操作覆盖。
- 先完成各自核心接口，页面只调用公开入口。字段新增、删除或含义变化时，先更新本文并通知另一人。
- 提交范围只包含本次任务；依赖变化同时提交 pnpm-lock.yaml，不提交 node_modules、dist、缓存和真实环境密钥。
- 完成后发起 Pull Request，说明输入、输出、行为变化和验证方式，由另一人检查后合并。
- 当前脚手架 lint 命令带 --fix，会修改文件；检查与修复应分开理解。不要在不清楚影响时对全仓库执行自动格式化。
- 单元测试用于统计规则、生成器和聚合不变量；每次检查使用非监听模式。运行成功不等于全部业务测试完成。

各应用可以沿用现有命令：`pnpm --filter 应用名 run build`；有测试时使用 `pnpm --filter 应用名 run test:unit --run`。共享包建立后需补上自己的类型检查、构建或直接源码消费规则，不能只靠应用页面启动来验证。

## 9 下一次开发前的准备

1. 两人确认统计和练习的负责人；主页素材各自整理。
2. 统计负责人准备一组短文件和逐行预期分类；练习负责人准备边界配置及预期结果。
3. 对本文接口提出必要修改，确认后再创建对应包和实现。
4. 首次功能 PR 只覆盖一个可验收模块；不同时改三个应用与全部公共配置。

此后以接口约定作为共同边界，需求变化同步回写需求和设计说明书，再补充实际测试记录。
