# 任务：为 code-meter-web 恢复并扩展函数统计

## 0. 边界

- 只改 `apps/code-meter-web`，不动另外两个网页应用、不发布、不部署。
- 不重算已有历史快照（D8）。旧快照缺新字段时按「无数据」处理，不迁移、不回填。
- UI 只用现有原色与暗色两套主题，不引入新配色。
- 目标是 PC 浏览器。

## 1. 已定口径（实现时不要再改，也不要再问）

| 项 | 结论 |
|---|---|
| 语言范围 | C、C++、Python、Java 统计；**JavaScript / TypeScript 不统计**，`functionCount` 保持 `null`，不产生任何函数相关警告 |
| 计入对象 | 有函数体的具名函数／方法／构造器／析构函数；C++ 运算符重载计入 |
| 不计入 | 只有声明没有函数体（`abstract` 方法、接口方法、纯原型声明）、函数调用、宏定义 |
| 匿名函数 | **lambda 不计入函数个数，其代码行并入外层函数体**；JS/TS 不统计故不涉及 |
| Java 匿名内部类 | 里面的方法**计入**（方法本身有名字，遵循「只看函数自己有没有名字，不看它所在的类有没有名字」） |
| 解析不完整 | **能数就数**，结果照常给出，另加「不完整」标记与提示；不再把整文件置 null |
| 合计汇总 | 只汇总有函数数据的语言，并注明覆盖了几种语言；不把缺失当 0，也不让整行留空 |
| 派生指标 | 最大值、最小值、均值、中位数，按文件与按函数两套，页面切换查看；总列数不变 |
| lambda 附注列 | 不加 |

## 2. 数据模型

### `src/core/index.ts`

`FileStat` 增加（全部可选，保证旧数据可读）：

```ts
functionCount?: number | null        // 已存在：具名函数个数
functionRuleVersion?: string         // 已存在
functionLineSizes?: number[]         // 每个函数的有效代码行数；用于按函数视图中位数
functionIncomplete?: boolean         // 解析存在未识别内容，count 可能偏少
```

不保存逐行分类数组（体积大）。

### 行归属的实现方式

函数尺寸 = **函数体内部**的有效代码行数：

- 起算点为 `Block` / `ConstructorBody` 节点的 `from`，终止点为 `to`。
- 只统计该范围内的 `code` 行（已含 mixed 行），不统计空行与纯注释行。
- lambda 的范围不单独出数，其行自然落在外层函数体内，无需额外合并逻辑。
- 类外定义的函数（如 `void A::g(){}`）按 `FunctionDefinition` 节点本身判断，与定义位置无关。

逐行 code 标记的来源：

- `analyzeBuiltin`（C/C++/Python）在现有行循环里顺带产出 `lineKinds: ('code' | 'comment' | 'blank')[]`，作为**内部返回值**，不进 `FileStat`。
- `analyzeModern`（Java）已有 `javaSpans` 与 `sourceOffset`，用同一套映射产出 `lineKinds`，行号必须是**原文件行号**，不是预处理后文本的行号。
- `analyzeText` 把 `lineKinds` 传给 `countFunctions`。

字符偏移转行号：一次性建立行首偏移表，二分查找，不要逐字符扫。

## 3. 分阶段实现

### V1 — 重新定义 `src/core/functions.ts`

- `FUNCTION_RULE_VERSION` 改为 `'function-definitions-2.0'`。
- 返回值改为结构化：

```ts
{ count: number; sizes: number[]; incomplete: boolean; warning?: string }
```

- 按语言给规则，不要再写三元判断链：

| 语言 | 计入 | 不计入 |
|---|---|---|
| c / cpp | `FunctionDefinition` | `LambdaExpression`、`Declaration`、`CallExpression` |
| python | `FunctionDefinition` | `LambdaExpression`（`.pyi` 仍返回 `undefined` 字段，保持现状） |
| java | `MethodDeclaration` 且含 `Block` 子节点；`ConstructorDeclaration` 且含 `ConstructorBody` | `LambdaExpression`、无 `Block` 的方法 |

- Java 需要新依赖 `@lezer/java`（最新 1.2.1）。用 `pnpm add @lezer/java`（`npm.ps1` 在本机被策略拦截，不要用 `npm`）。
- **删掉「任一 error 节点即返回 null」的逻辑。** 改为：统计过程中任何 `isError` 节点只置 `incomplete = true`，继续数完。
  - 实测依据：`@lezer/java@1.2.1` 遇到 `Map<String, List<Integer>>` 这类嵌套泛型会产生 1–3 个零宽错误节点，但**之后的方法全部仍能正确识别**（3/3）。按旧规则，大量真实 Java 文件会永久为 null。
  - C/C++/Python 同理改为「照数 + 标记」，这会改变现有三语言的行为（原来出错即 null），属于本次预期变更。
- 提示文案（`incomplete` 时追加一条，不进隐藏名单）：

```
函数个数在可识别范围内统计，解析存在 N 处未识别内容，实际数量可能更多；行统计不受影响。
```

`N` 用实际错误节点数。Java 的嵌套泛型会稳定触发这条，措辞不要写成「源码有错」。

### V2 — 挂载与汇总

- `src/core/index.ts:253` 的调用条件从 `['c','cpp','python']` 扩展为 `['c','cpp','python','java']`；JS/TS 不进入该分支，`functionCount` 保持 `null`、不加警告。
- 把 `sizes` 与 `incomplete` 写入 `FileStat`。
- `src/core/report.ts`：
  - `ReportRow` 增加 `maxFunctionLines / minFunctionLines / meanFunctionLines / medianFunctionLines`。
  - 新增 `REPORT_COLUMNS_FUNCTIONS`，键用上面四个，标签为「最大值／最小值／均值／中位数」（与按文件同名，由切换控件与表下说明区分）。
  - `functionCount` 汇总改为：只要该组内有任意文件带数字就求和，同时给出覆盖信息：

```ts
functionCount: number | null
functionLanguageCoverage?: { counted: number; total: number }
```

  - 按函数的四个指标：所有 `sizes` 合并后求 max / min / mean / median。`sizes` 全缺（旧快照或 JS/TS）时四个值为 `null`。
  - 旧的按文件四列逻辑保持不变。
  - 空文件的 `0` 参与按文件分布，不参与按函数分布（没有函数就没有尺寸）。

### V3 — 页面

`src/components/ReportSummary.vue`：

- 删掉第 6 行 `REPORT_COLUMNS.filter((column) => column.key !== 'functionCount')`。
- 前 6 列固定：语言、源文件数、代码行数、空行数、注释行数、函数个数。
- 后 4 列由切换控件决定用 `REPORT_COLUMNS`（按文件）还是 `REPORT_COLUMNS_FUNCTIONS`（按函数）。总列数恒为 10，宽度不变。
- 切换控件放在表格上方右侧，用现有主题色的分段按钮，`aria-pressed` 标注当前项，默认「按文件」。
- 表下说明随模式变化：
  - 按文件：保留现有文案。
  - 按函数：`最大值、最小值、均值和中位数按各函数的有效代码行计算，不含空行与纯注释行。`
- 「项目合计」行的函数个数后加覆盖标注，例如 `1,234（基于 3/7 种语言）`；覆盖不足全部语言时才显示括注。JS/TS 两行的函数列显示 `—`。
- 快照结果页（2026-11-07 那套固定结果页）若复用同一组件则自动生效；若单独渲染 FILES，检查其是否也展示了函数列，保持一致。

`src/utils/visibleWarnings.ts`：

- 三条旧函数警告已不再产生，从 `hiddenWarnings` 中删除。
- 新警告**不加入**隐藏名单（用户已授权展示诊断）。
- 同步 `src/utils/__tests__/visibleWarnings.spec.ts`。

### V4 — 导出

`src/platform/reports.ts`：

- `REPORT_DEFINITIONS.functions` 重写为：

```
C/C++/Python(.py/.pyw)/Java 按源文本中的具名函数定义计数：含方法、嵌套函数、匿名内部类中的方法，以及有函数体的构造/析构函数和运算符重载；不计只有声明没有函数体的方法、函数调用、宏定义与 lambda（lambda 的代码行并入外层函数）。函数行数为函数体内的有效代码行，不含空行与纯注释行。解析存在未识别内容时仍按可识别范围计数并标注不完整，可能偏少。Python 类型声明（.pyi）、JavaScript/TypeScript 不提供函数统计；未支持或旧快照未记录时为 null。
```

- `definitions.distribution` 增加一句区分两套分布。
- `summaryRows(snapshot, mode)` 支持两种模式；CSV 与 Excel 的「语言汇总」区**同时输出两个块**，标题分别为 `语言汇总（按文件）` 与 `语言汇总（按函数）`，保证导出不依赖页面当前视图。
- JSON：`snapshot.files` 里的 `functionLineSizes` **导出前剔除**（体积大且可重建），`summary` 保留已算好的四个函数指标。其余字段不变。
- 文件明细列不变（仍为函数个数）；`—` 表示缺失、不写 0 的规则不变。
- `schemaVersion` 升到 `3`，并在「统计说明」里加一行说明本次变更。

### V5 — 项目介绍（设计思路）

`src/content/introduction.ts` 的 `design` 段落，在「各语言共享分类原则…」之后插入以下四段，并把最后一段（解析相关）替换为第五段：

1. `函数统计只对 C、C++、Python 和 Java 提供，JavaScript 与 TypeScript 不提供，显示为「—」。原因是这两种语言的函数体大量以回调形式写在参数位置，同一种写法在不同场合意思不同；只统计有名字的函数会得到接近 0 的结果，全部计入又会拆出许多只有一两行的条目，两种结果都不能说明代码结构。C、C++、Python 和 Java 的函数结构与「一个名字对应一段逻辑」的直觉基本一致，按语言分别给出规则，比强行统一口径更接近事实。`

2. `匿名函数（lambda、箭头函数体和匿名内部类）中的 lambda 不计入函数个数，其代码行并入外层函数；Java 匿名内部类里的方法本身有名字，仍然计入。匿名函数通常只在一处使用、没有固定名字，单独计入会把均值拉低，并出现大量「函数体只有一行」的失真结果。并入外层后，函数个数表示有名字的逻辑单元，长度指标也仍然可读；代价是它在数字里不可见，需要看源码才知道有多少逻辑被写成了回调。`

3. `函数个数在语法解析不完整时仍按可识别范围给出，并标注不完整，而不是留空。嵌套泛型、宏展开等写法可能超出当前解析器的识别范围，但这类问题通常只影响局部；把整个文件判为未知，会让一整类语言长期没有数据，也无法做语言间比较。因此函数个数是可识别范围内的数量，出现不完整提示时应结合源码判断是否偏少。`

4. `函数的规模用最大值、最小值、均值和中位数描述，与按文件的代码行分布共用同一组列，通过切换查看；合计行只汇总有函数数据的语言，并注明覆盖了其中几种，不把缺失当作 0。中位数比均值更能反映典型规模，但它需要保留每个函数的尺寸才能计算，因此只在扫描时算出并随快照保存，不从各文件的合计反推。`

5. 替换原最后一段为：`解析服务于行数与函数计数，不替代编译器或完整的语法检查。合法但当前解析器不能完整识别的写法也会出现提示；提示位置用于辅助核查，不能据此断定源码有错。行分类是否受影响、函数个数是否偏少，都需结合具体代码复核。`

同步检查 `introduction` 的 `summary` 是否需要微调（当前为「以清晰的统计口径组织流程，用可解释的结果描述代码规模」，可保留）。

### V6 — 文档

- `apps/code-meter-web/CHANGELOG.md`：新增版本条目，列出口径变更、规则版本 `function-definitions-2.0`、导出 schema 升到 3、旧快照不重算。
- `apps/code-meter-web/QUALITY.md`：记录本次类型检查、单元测试、生产构建的**实际**输出与耗时；附 Java 嵌套泛型探测结论（错误节点数、方法识别率）。
- `docs/PROJECT.md`：把阶段 4「函数统计恢复」标记为完成，链接到 CHANGELOG，不重复贴细节。
- `docs/hesitate.md`：H001（函数口径未确认）标记为已决议并写结论摘要；H002 补充「改为不完整标注后已缓解，不再阻断」。

### V7 — 测试

新增 `src/core/__tests__/functions.spec.ts`，逐条覆盖：

| 用例 | 期望 |
|---|---|
| `class A { int add(int a,int b){return a+b;} }` | Java count=1, sizes=[1] |
| `interface I { void f(); default void g(){ } }` | Java count=1（无 Block 的不计） |
| `abstract class B { abstract void f(); void g(){ } }` | Java count=1 |
| `class A { A(){ } A(int x){ this(); } }` | Java count=2（构造器计入） |
| `xs.forEach(x -> a(x)); Runnable r = () -> {};` | lambda 不计，count 只含外层方法 |
| `new Runnable(){ public void run(){ int y=1; } }` | Java count 含 run（匿名内部类方法计入） |
| `record Point(int x,int y){ int sum(){ return x+y; } }` | Java count=1 |
| `class A { Map<String,List<Integer>> f; void a(){} void b(){} void c(){} }` | Java count=3，`incomplete=true`，不返回 null |
| C++ `[](){ }` | 不计；`auto f = [](){return 1;};` 也不计 |
| C++ `void A::g(){}`、类内 `void h(){}`、`~A(){}`、`operator+` | 均计入 |
| Python `lambda` 与 `def` 混写 | 只计 `def` |
| 空文件 | count=0, sizes=[] |
| 截断文件（未闭合字符串） | 不抛异常，返回可识别数量 + `incomplete=true` |

`report.spec.ts` 补充：

- C 有数据 + JS 无数据 → `functionCount` 为 C 的值，`functionLanguageCoverage = { counted: 1, total: 2 }`。
- 按函数的 max/min/mean/median 用两个文件、共 5 个函数的已知尺寸手算校对。
- 只有 1 个函数时 median 等于该值；偶数个时取中间两值平均。
- 旧快照（文件无 `functionLineSizes`）→ 按函数四列为 `null`，按文件四列照旧。

`reports.spec.ts` 补充：

- CSV 同时含「语言汇总（按文件）」与「语言汇总（按函数）」两段。
- JSON 里不含 `functionLineSizes`，但 `summary` 有四个函数指标。
- 缺失函数个数仍是 `—`，不写成 0。
- Excel「语言汇总」工作表含两个块。

`src/__tests__/App.spec.ts` 修改：

- 删掉 `521`、`544`、`547` 行「页面不包含『函数』」的断言。
- 新增：页面表头含「函数个数」；JS/TS 行显示 `—`；切换后表头第四组变为按函数说明；介绍区含「lambda」与「可识别范围」。
- `493`、`504`、`519` 行涉及函数断言需按新口径更新：原断言「`functionCount` 为 null」「warnings 含『函数个数暂不可用』」在 C/C++/Python 上已不成立，改为断言具体数值与新的不完整提示。

## 4. 验证命令

```
pnpm --filter code-meter-web type-check
pnpm --filter code-meter-web test:unit -- --run
pnpm --filter code-meter-web build
```

三条都跑，记录真实输出。不要用历史结果充当本次验证。若 `pnpm` 也不可用，改用 `npx --no-install` 或直接调用 `node_modules/.bin` 下的可执行文件。

## 5. 完成标准

- 四种语言在页面上显示具体函数个数，JS/TS 显示 `—`，合计行带覆盖标注。
- 切换「按文件／按函数」时列数与页面宽度不变，表下说明随切换变化。
- 导出（CSV/JSON/Excel）口径与页面一致，两套分布都完整。
- 设计思路里能读到：为什么 JS/TS 不做、为什么 lambda 不计入、为什么允许不完整、为什么中位数需要随快照保存、合计为什么只算部分语言。
- 旧快照打开不报错，缺数据的列显示 `—`。


我核对了交接时会出问题的地方，原 prompt 有 6 处需要补，否则另一个 agent 只能靠猜，其中两处会直接导致结果出错。
## 结论
可以交出去，但请把下面的补充一起贴给它。原 prompt 的方向和口径都没问题，缺的是「代码怎么接」。

## 补丁 1：`countFunctions` 现在拿不到逐行数据

真实签名是 `countFunctions(text, language)`，只有文本，没有语法树也没有逐行分类。而 V2 要算函数行数，必须有逐行 code 标记。请把这段写进 prompt：

- `analyzeBuiltin`（`index.ts:66`）和 `analyzeModern`（`modern-languages.ts:117`）保持现有签名和返回类型不变，各自新增一个兄弟函数 `analyzeBuiltinWithKinds` / `analyzeModernWithKinds`，返回 `{ stat: FileStat; kinds: LineKind[] }`，原函数改为一行包装。
- `LineKind = 'code' | 'comment' | 'blank'`，混合行归 `code`（保持 `mixed ⊂ code` 的既有语义）。
- `analyzeText` 对四种语言改用 WithKinds 版本，一次调用同时拿到 stat 和 kinds。
- **不要改动 `Analyzer` 类型和 `registerAnalyzer`**，它们是公开扩展点。
- 验收标准：新增一个 fixture（含混合行、块注释、Python 三引号、C++ raw string），断言 `analyzeBuiltin` 的 `counts` 与改造前逐字段相等。

## 补丁 2：行号对齐（这处不写清必出错）

- 逐行分类和行表必须来自同一份字符串：`source.text.replace(/\r\n?/g, '\n')`。
- C/C++/Python 现在是把 `source.text` 直接喂给 lezer（`index.ts:253`），CRLF 文件里偏移和行号会错位，必须改成喂规范化后的文本。
- Java 要用 `javaInput` 产出的 `input` 去解析（不是原文），节点偏移先过 `sourceOffset()`，再换算成规范化文本里的行号。
- 行号 = 该偏移之前的 `\n` 个数，一次性建行首偏移表 + 二分，0 基，与 `kinds` 下标一致。
- 节点 `to` 是排他偏移，末行取 `lineIndexAt(sourceOffset(to) - 1)`。

## 补丁 3：列定义的类型

`REPORT_COLUMNS` 是 `as const`，`summaryRows` 靠 `row[column.key]` 取值。加第二套列数组后要给出联合键类型：

```ts
export type ReportColumnKey =
  | (typeof REPORT_COLUMNS)[number]['key']
  | (typeof FUNCTION_COLUMNS)[number]['key']
```

`ReportRow` 补齐两组键，`summaryRows(snapshot, mode: 'file' | 'function')` 的签名写清，否则另一个 agent 会在这个类型错误上反复试。

## 补丁 4：导出里的三个漏点

- `snapshotReport` 的 `files.map` 除了补 `functionCount`，还要剔除 `functionLineSizes`（`reports.ts:25` 那个 `...file` 展开会把它带出去）。
- `schemaVersion: 2` 和 `metadataRows` 里硬编码的 `['报表版本', 2]` 要一起改成 3。
- Excel 里 `index >= 8` 的 `0.00` 格式，确认两个块下仍只落在均值和中位数列。

## 补丁 5：测试不要按行号改

`App.spec.ts` 现在那些断言（493/504/519–521/541/544/547）行号会漂移，让它按文本内容匹配改，不要按行号定位。

## 补丁 6：装依赖的正确命令

是 pnpm workspace，在仓库根目录执行：

```
pnpm --filter code-meter-web add @lezer/java@1.2.1
```

不要用 `npm`（本机 `npm.ps1` 被策略拦截）。`@lezer/lr`、`@lezer/common`、`@lezer/highlight` 已在 store 里可直接复用。装不上就停下报告，不要自己手写 Java 解析。

## 交出去之前，让它先跑这 30 秒

C++ 类内定义、构造/析构、运算符重载的节点名我没实测过，prompt 里标的是「实施时先验证」。把一个 `.probe-cpp.mjs` 放在 `apps/code-meter-web` 下跑，跑完删除：

```js
import { parser } from '@lezer/cpp'

const samples = {
  free: 'int f(){return 1;}',
  inClass: 'class A { public: void g(){} };',
  ctor: 'class A { public: A(){} ~A(){} };',
  op: 'struct V { V operator+(const V& o){ return o; } };',
  outside: 'void A::g(){}',
  lambda: 'auto f = [](int x){ return x; };',
}

for (const [name, src] of Object.entries(samples)) {
  const names = new Set()
  parser.parse(src).iterate({
    enter: (n) => {
      if (/Function|Declaration|Lambda|Constructor|Destructor/.test(n.type.name)) names.add(n.type.name)
    },
  })
  console.log(name.padEnd(9), [...names].join(' ') || '(none)')
}
```

结果直接决定 V1 里 C++ 那条规则表怎么写。让它把输出贴回来，别自己推断。
