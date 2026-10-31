# Code / Meter 代码计量台初版

版本：0.1.0。
初版交付日期：2026 年 10 月 14 日。
结构说明更新：2026 年 10 月 28 日。

## 快速运行

当前应用位于 school-web 工作区，日常使用已包含六种语言的 `main` 分支。推荐 Node.js 24.21.0、pnpm 12.11.2。首次使用或依赖变化时，在仓库根目录执行 `pnpm install --frozen-lockfile`；平时启动只需：

~~~powershell
Set-Location D:\Projects\school-web
pnpm --filter code-meter-web dev --host 127.0.0.1 --port 5173 --strictPort
~~~

打开 http://127.0.0.1:5173/，并保持终端运行；停止服务器按 Ctrl+C。启动命令运行当前检出的源码，不会自动切换版本。个人主页从其独立仓库在另一个终端启动，使用 5177 端口，无需切换 school-web 分支。

首次安装需要下载依赖；安装失败时先查看网络错误，不要删除源代码。若 pnpm 提示原生依赖构建未获批准，核对对应依赖后按其提示批准所需构建。

## 开发约定

每轮修改前先阅读仓库根目录的 AGENTS.md 和 docs/PROJECT.md，完成阶段后更新进度。当前仓库直接维护源码，使用根目录的 pnpm-lock.yaml；不要拿历史交付包覆盖当前开发内容。node_modules、.cache 和 dist 不提交。

## 功能

- 多文件、支持浏览器的文件夹选择、拖放及粘贴代码。
- C、C++、Python、Java、JavaScript、TypeScript 的有效代码行、纯注释行、空行及混合行统计。
- 项目汇总、语言饼图及文件明细；未知语言和失败文件单列原因。
- 真实扫描快照、活动方块、7/30/365 天与自定义范围、兼容快照净变化。
- 原色与暗色主题，顶部缓慢移动的文字条；其他配色方案已舍弃。
- 按语言汇总源文件数、行数，以及各文件有效代码行数的最大值、最小值、均值与中位数。
- JSON、CSV 与 Excel（.xlsx）导出、历史查看与删除。
- 文件表先显示 50 行，按需继续显示，避免一次渲染大量文件。
- 日期方块联动当天累计语言分布；按月分隔的日历带月份和星期标注。
- 项目介绍提供可展开目录：功能介绍、设计思路、统计方式；日历说明链接直达对应文章。

没有账号和后端，不执行源代码，不上传或持久保存代码正文。输入在本次页面会话中保留，可以重复统计；刷新后需要重新选择文件或粘贴文本。历史仅保存元数据和统计结果。

## 统计定义

总物理行 = 空行 + 纯注释行 + 有效代码行。混合行属于有效代码行的子集。

空文件为 0 行，末尾换行不额外产生一行。多行注释内部空白行属于注释；多行字符串内部空白行属于代码。Python 三引号字符串和文档字符串均计入代码。字符串中的注释符保留。

Java 支持文档注释、三引号文本块及转义引号；Unicode 转义先用于识别语法，再映射回原文件物理行，不把转义生成的换行当成新增源文件行。JavaScript / TypeScript 支持字符串、正则表达式、反引号模板及嵌套插值；插值内部的真正注释归注释，类型声明按源代码计数。新支持 `.java`、`.js/.mjs/.cjs`、`.ts/.mts/.cts`，包含 `.d.ts`；本轮不支持 Vue、HTML、CSS、JSX 或 TSX。

行规则版本更新为 `physical-lines-1.1`，因为原先跳过的语言现在会进入总量。旧快照保持原始数据，不自动重新统计，也不与不同规则版本的快照直接比较净变化。现有 C/C++/Python 行统计逻辑保持不变。

方块表示当天每次成功保存扫描的有效代码行之和，重复扫描也累计；以所选区间最高日合计为最深色。例如同一天扫描 100 行再扫描 120 行，当天为 220 行。悬停、聚焦或点击某天后，语言分布使用当天各次扫描的累计量，重复文件标为“文件次”；无扫描日期显示空分布，可返回当前快照。切换档案或日期范围恢复快照分布。总览和报表仍使用单次快照，重复扫描不累加总览规模。方块不是新增代码或开发工作量；净变化只比较同一项目与兼容规则，缺少基线时显示不可比较。

汇总分布以各成功源文件的有效代码行数为样本，空文件以 0 行参与；失败／跳过文件只进入明细。项目合计按全部成功文件重新计算分布。

页面暂不展示函数列、相关说明、函数警告及通用行解析提示；异常筛选同步，其他具体警告保留。底层函数统计、历史与导出不变，新语言函数数仍未知。待讨论规则见 `docs/hesitate.md`。

新建仅建立浏览器中的统计档案，扫描时再选择本地文件／文件夹，不会在硬盘创建项目目录。工作台保留新建，历史只保留项目和时间筛选，项目介绍不显示筛选栏。

.h 默认按 C 处理；可复制到文本输入并选择 C++ 进行单独扫描。其他未支持语言（如 Go、Rust）明确跳过，不返回伪造统计。

## 模块目录

- src/core/index.ts：纯 TypeScript 类型、分析器、注册接口、汇总、日期聚合和快照比较。
- src/core/functions.ts、report.ts：函数语法解析与按语言／项目汇总的文件行数分布。
- src/core/modern-languages.ts：Java 词法区域扫描、JavaScript/TypeScript 语法区域分类与物理行映射；JS/TS 使用 Lezer JavaScript 的对应语言模式。
- src/platform/files.ts：文件读取、UTF-8、排除目录和限制。
- src/platform/scanner.ts 与 src/workers/scan.worker.ts：后台任务及取消。
- src/platform/storage.ts：IndexedDB、CSV、JSON 和下载。
- src/platform/reports.ts：统一报表结构与 CSV/JSON/Excel 导出；ExcelJS 仅在导出时加载。
- src/components/LanguagePie.vue、ActivityGrid.vue：图表组件。
- src/components/ReportSummary.vue：按语言汇总的九列页面统计表；导出仍保留原十列。
- src/components/ProjectToolbar.vue：项目选择、新建与时间筛选，通过模型和事件与入口通信。
- src/pages/WorkspacePage.vue：文件／文本输入、总览、图表、明细筛选与报表导出。
- src/pages/HistoryPage.vue：展示历史，通过事件请求查看或删除快照。
- src/pages/RulesPage.vue：项目介绍目录与文章；内容位于 src/content/introduction.ts，后续可继续增加小节。
- src/composables/useScan.ts：输入状态、读取和扫描调度、取消、当前结果与错误状态。
- src/composables/useHistory.ts：快照读取／保存／删除、时间范围、活动聚合与日期刷新。
- src/composables/useProjects.ts、useTheme.ts：项目和主题的本地设置。
- src/utils/format.ts：时间与错误提示的格式化。
- src/utils/visibleWarnings.ts：页面过滤暂缓展示的函数诊断及通用行解析说明，不修改保存或导出的原始警告。
- src/App.vue：页面导航、共享状态和模块间协调。
- src/assets/meter.css：主题、排版、响应布局与减少动态效果设置。

核心不依赖 Vue、DOM、文件系统或数据库。分析器通过公开 registerAnalyzer 接口扩展。初版使用应用内独立目录，后续可以抽取成 packages/code-core，调用接口保持不变。

扫描和历史状态在应用层创建，不随页面切换销毁。工作台保持挂载，保留输入与明细筛选；规则和历史页面按需显示。应用卸载时取消分析线程并清理日期定时器和事件监听。新增页面内容放在 pages，流程放在 composables，文件和数据库操作继续放在 platform；只有确认有跨应用复用需求时再抽共享包。

新增语言复用现有快照字段与浏览器数据库，已有历史继续沿用；行规则版本变化独立记录，不更改旧快照。

## 数据保存

浏览器 IndexedDB 数据库名称为 school-code-meter-v1。项目轻量设置和主题位于 localStorage。项目设置写入失败时可以从快照恢复项目。历史目前长期保留，可手动删除；关闭网页后不执行定时清理。

存储按浏览器和网站来源隔离。改变域名或端口、使用其他浏览器，不会自动共享历史。清除浏览器数据会删除记录，请通过 JSON 导出保存结果。本版 JSON 是统计报告，尚未提供历史导入。

## 检查命令

~~~powershell
pnpm --filter code-meter-web type-check
pnpm --filter code-meter-web test:unit --run
pnpm --filter code-meter-web build
~~~

以上命令在仓库根目录运行。构建输出在 apps/code-meter-web/dist，可以执行 pnpm --filter code-meter-web preview 查看生产构建。验证使用已有依赖，尚未在完全空白机器上重新下载安装。实际验证结果见 QUALITY.md。

## 输入约束和边界

- UTF-8；单文件或粘贴文本最多 5 MB。
- 排除目录后最多 2000 个候选文件、总量 40 MB。
- 默认排除 .git、node_modules、dist、build、__pycache__、.venv。
- 重复相对路径不会静默覆盖；第二份在明细中显示失败。
- 自定义日期最多 366 天。
- 支持常见引号、转义、C++ 原始字符串与数字分隔符。
- 不是完整编译器；复杂 Python f-string 内嵌表达式、C 预处理条件和全部翻译阶段未完整解析。
- 不包含 ZIP、Git 提交分析、语句/复杂度统计、登录同步或桌面封装。

## 视觉设计

黑白与温和纸面底色，等宽英文字体、清楚的中文正文、细线分隔和方块元素。字体使用电脑本地字体，不依赖外部 CDN。顶部动画通过 CSS 完成，系统开启减少动态效果时停用。
