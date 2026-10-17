# Code / Meter 代码计量台初版

版本：0.1.0。交付日期：2026 年 10 月 14 日。

## 快速运行

推荐 Node.js 24.21.0、pnpm 12.11.2。源码包是独立 Vue 应用，解压后进入 code-meter-web 目录执行：

~~~powershell
pnpm install --frozen-lockfile
pnpm run dev --port 5173 --strictPort
~~~

打开终端显示的本地地址。停止服务器按 Ctrl+C。首次安装需要下载依赖；安装失败时先查看网络错误，不要删除源代码。若 pnpm 提示原生依赖构建未获批准，核对对应依赖后按其提示批准所需构建。

## 接入已有 school-web 仓库

1. 停止代码统计应用的开发服务器。
2. 备份当前 apps/code-meter-web 目录。
3. 将压缩包中 code-meter-web 的内容复制到 D:\Projects\school-web\apps\code-meter-web，覆盖同名源码和应用配置。
4. 不覆盖 school-web 根目录、其他应用或 .git。独立源码包中的 pnpm-lock.yaml 用于单独运行；接入 workspace 时继续使用根目录锁文件，不必复制这一个应用级锁文件。
5. 在 school-web 根目录执行 pnpm install，再运行 pnpm --filter code-meter-web run dev --port 5173 --strictPort。
6. 检查 git diff 后，在功能分支提交修改，不要把 node_modules、.cache 或 dist 提交。

本次 D 盘自动同步遇到权限刷新故障，仓库可能保留较早版本。完整修复版本以交付压缩包为准，请先覆盖再使用。

## 功能

- 多文件、支持浏览器的文件夹选择、拖放及粘贴代码。
- C、C++、Python 的有效代码行、纯注释行、空行及混合行统计。
- 项目汇总、语言饼图及文件明细；未知语言和失败文件单列原因。
- 真实扫描快照、活动方块、7/30/365 天与自定义范围、兼容快照净变化。
- 黑白界面及青绿/蓝色活动方块主题，顶部缓慢移动的文字条。
- JSON 与 CSV 导出、历史查看与删除。
- 文件表先显示 50 行，按需继续显示，避免一次渲染大量文件。

没有账号和后端，不执行源代码，不上传或持久保存代码正文。每次统计需要用户重新选择文件或粘贴文本。历史仅保存元数据和统计结果。

## 统计定义

总物理行 = 空行 + 纯注释行 + 有效代码行。混合行属于有效代码行的子集。

空文件为 0 行，末尾换行不额外产生一行。多行注释内部空白行属于注释；多行字符串内部空白行属于代码。Python 三引号字符串和文档字符串均计入代码。字符串中的注释符保留。

活动方块表示成功扫描次数，不代表实际开发产出。语言饼图对应当前展示快照。重复扫描不把代码总量累加；净变化只比较同一项目与兼容规则，缺少基线时显示不可比较。

.h 默认按 C 处理；可复制到文本输入并选择 C++ 进行单独扫描。首版不支持 Java、Go、JavaScript 等语言，未识别文件明确跳过，不返回伪造统计。

## 模块目录

- src/core/index.ts：纯 TypeScript 类型、分析器、注册接口、汇总、日期聚合和快照比较。
- src/platform/files.ts：文件读取、UTF-8、排除目录和限制。
- src/platform/scanner.ts 与 src/workers/scan.worker.ts：后台任务及取消。
- src/platform/storage.ts：IndexedDB、CSV、JSON 和下载。
- src/components/LanguagePie.vue、ActivityGrid.vue：图表组件。
- src/App.vue：页面与交互协调。
- src/assets/meter.css：主题、排版、响应布局与减少动态效果设置。

核心不依赖 Vue、DOM、文件系统或数据库。分析器通过公开 registerAnalyzer 接口扩展。初版使用应用内独立目录，后续可以抽取成 packages/code-core，调用接口保持不变。

## 数据保存

浏览器 IndexedDB 数据库名称为 school-code-meter-v1。项目轻量设置和主题位于 localStorage。项目设置写入失败时可以从快照恢复项目。历史目前长期保留，可手动删除；关闭网页后不执行定时清理。

存储按浏览器和网站来源隔离。改变域名或端口、使用其他浏览器，不会自动共享历史。清除浏览器数据会删除记录，请通过 JSON 导出保存结果。本版 JSON 是统计报告，尚未提供历史导入。

## 检查命令

~~~powershell
pnpm run type-check
pnpm run test:unit --run
pnpm run build
~~~

构建输出在 dist。可以执行 pnpm run preview 查看生产构建。本次验证使用已有依赖，尚未在完全空白机器上重新下载安装。

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
