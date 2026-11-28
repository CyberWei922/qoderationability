# FPGAgent 项目总规划书

> 适用赛事：**2026 Qoder 高校创造力大赛**（天池地址：`https://tianchi.aliyun.com/competition/entrance/532536`）  
> 参赛赛道：**StudyHack 学习科研**  
> 协作仓库：`https://github.com/CyberWei922/FPGAgent`

---

## 1. 项目定位、核心痛点与最终整体预期

### 1.1 我们解决什么真实问题？
微电子、集成电路、电子信息、自动化及计算机专业学生在学习《数字逻辑》《FPGA 与 Verilog 设计》时，普遍卡在四个现实痛点：
1. **硬件与环境门槛极高**：FPGA 开发板价格贵、实验室排期紧，Vivado 安装包动辄 50GB+，macOS 学生甚至无法原生安装。
2. **“能编译但波形不对”的黑盒挫败感**：初学者最难掌握的不是语法，而是时序逻辑、阻塞/非阻塞赋值、Latch 隐患以及 Testbench 编写。
3. **传统聊天 AI 教硬件会胡说八道**：通用大模型看不到代码实际运行出的波形与寄存器状态，容易在改 Bug 时“修好一处、改坏另一处”。
4. **外行与入门者难以建立电路直觉**：面对几十行 Verilog 代码，初学者看不到“按下开发板按键后，电信号究竟如何一步步流过逻辑门并点亮 LED”。

### 1.2 产品形态与最终整体预期
我们打造一个**打开即用、免登录、免填 API Key** 的浏览器端 **「AI 虚拟 FPGA 实验室（FPGAgent）」**，核心差异化在于将往届验证有效的 **Harness 可验证智能体闭环** 与 **慢动作门级信号流可视化** 融合到同一张网页工作台：

1. **一句话造硬件（Spec-to-Board）**：用户输入一句自然语言（如“做一个红 5 绿 4 黄 1 的交通灯，按 KEY0 紧急全红，数码管倒计时”），页面透明展示智能体如何先拆解**设计蓝图 + 引脚表 + 状态转移图**，再生成 Verilog，并在浏览器内自动跑完 **Lint 体检 + 确定性自测 + 失败自动修复**，验证通过后直接“烧录”到虚拟板卡上运行。
2. **慢动作看信号穿过逻辑门（视觉核心杀手锏）**：浏览器实时将代码映射为 20–40 个可读节点的**教学级门电路结构图**。用户可切换 **`实时` / `0.2x 慢动作` / `单步传播`**，按下按键后，高电平发光脉冲会沿着导线逐级穿过非门、与门、选择器、触发器并点亮红灯，底部同步用白话播报信号路径——让完全不懂 Verilog 的评委 10 秒内看懂电路原理。
3. **真仿真、真外设、真体检**：右侧虚拟 FPGA 开发板配备可点击按键、可拨动开关、LED、交通灯、4 位七段数码管和实时波形示波器；所有代码修改毫秒级触发静态 Lint 体检、首个出错周期红框标注和无回退验证。
4. **AI 硬件故障诊所（Bug Clinic）**：把原项目“变异体负对照（Mutation Testing）”思维反向用于教学——一键向当前正常电路注入典型真实硬件 Bug（阻塞赋值错用、忘写复位、锁存器、位宽截断等），板卡立刻出现异常现象，由“会看示波器的 AI 助教”按三档提示引导学生排错。

### 1.3 面向评委的 30 秒黄金体验路径
- **0 秒（开箱即亮）**：首页默认加载“智能交通灯”预置案例（零 Token 秒开），右侧板卡红绿灯与数码管已在运行，评委点一下 `KEY0` 立刻触发紧急全红。
- **10 秒（慢动作顿悟）**：拨动速度滑块到 `0.2x 慢动作` 或点击 `单步传播`，再次按下 `KEY0`，中间画布逐级亮起发光脉冲并播报信号流向。
- **20 秒（实时 AI 创造）**：在顶部输入一句新需求，观看左栏透明智能体完成“蓝图 → 代码 → 本地自测修复 → 上板亮灯 + 重绘门级图”。
- **30 秒（教学深度）**：点击 `故障诊所`，体验“故障注入 → 波形首个出错周期标红 → 苏格拉底引导修复 → 无回退绿灯通过”。

### 1.4 最终验收质量目标
- 浏览器仿真 + Lint 引擎通过 **≥ 120 条自动化单元测试**（覆盖 10+ 类经典与 AI 常见全新电路、组合/时序/FSM/位宽边界、6 类 Lint、语法容错、反例定位与无回退检测），测试结果写入参赛帖作为工程可信度证据。
- 内置 **7 个零 Token 经典预置案例**（交通灯、1011 序列检测器、数字秒表、四人抢答器、彩色 OLED 贪吃蛇、彩色俄罗斯方块、256 色 RGB 立方），断网或额度耗尽时全部核心仿真与板卡交互依然 100% 可用。
- 支持**站点默认免费体验 + 国内常用 API 服务商一键预设（DeepSeek / 智谱 GLM / 通义千问 / 硅基流动 / Kimi 等）+ 自动拉取模型列表 + 对话内实时切换模型 + 可选联网查阅 Verilog 规范/实例**。
- 公网部署至 **Qoder Sites**，无痕浏览器与移动端核验无报错、免填 Key 即可直接触发实时 AI 生成与诊断。
- 页面与帖子清晰声明 **Known Limitations（明确支持的可综合 Verilog 教学子集，不做布局布线与门级物理延迟）**。

---

## 2. 整体系统架构与具体实现方案

### 2.1 三栏工作台界面布局

```text
┌───────────────────────────────────────────────────────────────────────────────────┐
│ [输入框] 用一句话描述想做的硬件电路（如：带紧急制动按钮的交通灯）      [AI 生成]   │
│ 预置案例：[交通灯][密码锁][序列检测器][秒表]  速度：[实时|0.2x|单步] [故障诊所][设置]│
├───────────────────────┬───────────────────────────────┬───────────────────────────┤
│ 左栏：透明智能体与代码 │ 中栏（主舞台）：动态门级信号图  │ 右栏：虚拟 FPGA 开发板     │
│ [Tab1 蓝图]           │                               │  LED[7:0] / 交通灯组       │
│  • 行为要点与引脚表   │  输入端口 ──► 组合逻辑门 ──►  │  4 位七段数码管            │
│  • Mermaid 状态转移图 │  DFF 触发器 ──► 输出外设      │  KEY[3:0] / SW[7:0] / CLK  │
│ [Tab2 自测与AI诊断]   │                               ├───────────────────────────┤
│  • Lint/自测绿灯流水线│  • ELK 从左到右正交布线       │ 迷你波形示波器             │
│  • 苏格拉底三档引导   │  • SVG 高电平发光脉冲逐级传播 │  • 实时时钟/输入/输出波形  │
│ [Tab3 Verilog 代码]   │  • 底部白话信号流播报条       │  • 红框标出首个出错周期    │
└───────────────────────┴───────────────────────────────┴───────────────────────────┘
```

### 2.2 统一虚拟开发板顶层硬件接口（强制规范）
为了消除引脚错配并降低解析复杂度，所有预置工程与 AI 生成的 Verilog 统一对接同一套虚拟板卡顶层端口：

```verilog
module top (
    input         clk,      // 板载时钟（前端可控频率 / 暂停 / 单步）
    input         rst_n,    // 低有效同步/异步复位按键
    input  [3:0]  key,      // 4 个板载按键（按下=1，松开=0）
    input  [7:0]  sw,       // 8 个拨码开关
    output [7:0]  led,      // 8 颗板载 LED
    output [2:0]  traffic,  // [2]=红灯, [1]=黄灯, [0]=绿灯
    output [15:0] seg       // 4 位七段数码管，每 4 位对应 1 个十六进制/BCD 数字
);
```

### 2.3 五大核心模块技术实现

#### 模块 1：浏览器纯 TS 可综合 Verilog 子集仿真引擎（`src/engine/parser.ts`, `simulator.ts`）
- **支持子集（明确边界）**：
  - 模块声明与端口、`wire` / `reg`（含向量位宽如 `[7:0]`）、`localparam` / `parameter`；
  - 连续赋值 `assign`；
  - 组合块 `always @(*)` / `always_comb`（支持 `if / else if / else`、`case / default`、阻塞赋值 `=`）；
  - 时序块 `always @(posedge clk)` / `always @(posedge clk or negedge rst_n)`（支持非阻塞赋值 `<=`）；
  - 运算符：算术（`+ - *`）、逻辑/按位（`& | ^ ~ ! && ||`）、比较（`== != < <= > >=`）、移位（`<< >> >>>`）、三目 `? :`、位拼接 `{a, b}` 与位切片 `sig[hi:lo]`；
  - 字面量：`4'b1010`、`8'hFF`、`3'd5`、十进制整数。
- **求值机制**：
  - 每个时钟拍 `step(inputs)` 执行：采样输入 → 计算时序块右值并暂存下一拍值 → 统一提交非阻塞赋值（保证并发语义正确）→ 组合块与 `assign` 迭代收敛（上限 16 轮，超限报组合环警告）→ 输出 `BoardOutputs` 并写入波形环形缓冲。

#### 模块 2：教学级 RTL-门混合网表与慢动作信号流（`src/engine/netlist.ts` + `src/components/GateCanvas.tsx`）
- **为什么不展平为全门级？** 32 位计数器展平成基础门会产生数千节点，评委根本看不懂。
- **教学级混合抽象**：将 AST 节点映射为 **20–40 个可读硬件积木**：
  - 端口节点：`INPUT`（KEY/SW/RST）、`OUTPUT`（LED/TRAFFIC/SEG）
  - 组合逻辑门：`AND`、`OR`、`NOT`、`XOR`、`MUX`、`CMP`、`ADD`
  - 时序积木：`DFF`（寄存器/状态机触发器）
- **拓扑分层与慢动作动画**：
  - `netlist.ts` 对每条连线和节点计算拓扑层级 `level`（`0` 为输入端口，依次向右递增），并输出每个节点当前拍的逻辑值 `value` 及是否发生跳变 `changed`。
  - `GateCanvas.tsx` 使用浏览器 Worker 中的 `elkjs` 做从左到右的正交布线，SVG 绘制原理图符号、导线并标记分叉。画布支持拖拽、缩放和边界回弹；拓扑变动时重排，仿真逐拍更新信号值和高亮。

#### 模块 3：前端静态 Lint 体检 & 确定性自测（`src/engine/linter.ts`, `selftest.ts`）
- **静态 Lint（直接移植原项目 `rtl-lint-rules` 与 `rtl-interface-check` 精华）**：
  1. `PORT_MISMATCH`：顶层模块端口与虚拟板卡定义不一致（名/方向/位宽）；
  2. `SEQ_BLOCKING_ASSIGN`：时序 `always @(posedge clk)` 块中误用阻塞赋值 `=`；
  3. `COMB_NONBLOCKING_ASSIGN`：组合 `always @(*)` 块中误用非阻塞赋值 `<=`；
  4. `INFERRED_LATCH`：组合块 `if` 缺 `else` 或 `case` 缺 `default`；
  5. `UNDRIVEN_OR_UNASSIGNED`：输出端口未驱动或状态变量读取但从未赋值；
  6. `MULTI_DRIVER_OR_SHIFT`：同一变量被多个过程块驱动，或无符号数误用算术右移 `>>>`。
- **确定性自测与无回退**：
  - 输入标准 JSON 测试用例（每拍激励 + 期望输出掩码），由纯 TS 仿真内核独立执行；
  - 精准捕获**首个失配周期 `firstFailure.cycle`** 及期望/实际差异信号，回传给示波器画红框；
  - 对比上一版通过的检查点集合，若出现“旧通过点变失败”则标记 `regressedCycles`，防止改坏已有功能。

#### 模块 4：前端 Harness 智能体闭环 + 联网查阅 + 案例/故障库（`src/agent/`）
- 复用原项目 [REPORT.md](../reference/fpga2026/代码-可验证RTL闭环设计智能体/44959_rtlagent/REPORT.md) 的核心思想，并在第二轮升级为支持**多模型切换、多轮增量修改与可选联网检索**的可视化状态机：
  1. **阶段 0（按需联网查阅，可选）**：当需求涉及不确定协议/算法、Verilog 语法规范存疑或首次修复受阻，且联网开关开启时，调用注入的 `WebResearchClient` 检索规范/参考实现并读取网页正文摘要，将证据注入提示词并输出可核验参考链接；检索不可用或超时时平滑降级；
  2. **阶段 1（规划）**：调用当前所选模型（透传 `options.model`）生成结构化蓝图（行为要点、引脚映射、Mermaid 状态转移图、自测向量 JSON），多轮追问时结合 `previousContext` 保持已有功能不回退；
  3. **阶段 2（编码）**：携带精简交接蓝图 + 联网规范摘要（如有）+ 原项目 `skill/` 提炼的 Verilog 规范，生成符合 `top` 接口的 Verilog；
  4. **阶段 3（本地确定性验证）**：调用 `linter.ts` + `simulator.ts` + `selftest.ts`；
  5. **阶段 4（最多 2 轮分流自动修复）**：
     - 语法/Lint 错 → 直接带错误行号修复；
     - 功能失配 → 携带**首个反例波形切片**（必要时辅以联网规范查阅）进行诊断修复，并执行无回退校验；
  6. **阶段 5（教学模式）**：在“AI 助教”或“故障诊所”模式下，提供 `只给线索 / 指出错因 / 对比修复` 三档苏格拉底引导。

#### 模块 5：多服务商 API 接入、Qoder Sites 云函数代理与风控（`functions/` + `src/services/`）
- **四层防爆省钱 + 丝滑 BYOK 接入设计**：
  1. **零 Token 预置案例**：7 个经典案例（交通灯、序列检测器、秒表、抢答器、贪吃蛇、俄罗斯方块、RGB 立方）自带完整预生成蓝图、代码、自测断言与故障模板，点击秒开不消耗任何 API；
  2. **服务端 Secret 藏 Key + 云端辅助能力**：站点默认 API Key 只存放在 Qoder Sites 环境变量中，绝不写入前端代码或 Git 仓库；云函数除 `/agent` 对话代理外，还提供 `/models` 模型列表代理（解决部分服务商浏览器跨域问题）及 `/research` 安全联网搜索与网页正文提取接口；
  3. **云函数防刷与免费额度模型**：使用免费/低成本模型作为站点默认，并在云函数中加入 `Origin/Referer` 校验、单 IP 每日次数限制及云平台日消费硬封顶，联网读取端严格做 URL 协议/内网段 SSRF 拦截与响应体积截断；
  4. **国内常用服务商一键预设 + 自动拉模型 + 对话切模型**：在设置面板内置 DeepSeek、智谱 GLM、通义千问（DashScope）、硅基流动（SiliconFlow）、月之暗面（Kimi）及自定义 OpenAI 兼容预设，选定服务商后自动填入接口地址与推荐模型，填入 Key 即可自动拉取 `/models` 模型列表并一键测连；用户可在设置页及**左侧对话栏**随时选择和切换模型。

---

## 3. 第三轮（Round 3 · V3 契约）升级计划与三人团队分工责任书

> **开发基线说明**：第二轮全部三端开发、全链路 SSE 流式体验、NVIDIA 深浅主题、产品宣传页、双渠道容灾与双重额度保护已合入 `main` 最终版（`baf3004`），并已在此基础上完成 V3 升级；当前自动化单测为 **284 条通过 / 3 条真实模型评测默认跳过**，`npm run build` 全绿。第三轮所有开发工作**统一基于当前 `main`（含 V3 冻结契约）** 推进。
>
> **第三轮核心升级目标（V3）**：
> 1. **可扩展虚拟板卡与大屏互动体验**：左侧导航栏原「诊所」升级为「板卡配置」（保留故障诊所入口），新增 **16×8 字符/图块混合屏幕（每格 8×8 像素，视觉等效 128×64 宽屏 OLED）** 与 **4-bit 板载蜂鸣器**；带屏电路自动在**中间最大主视区**渲染高清 Canvas 屏幕（同时保留随时切回「门级网表」Tab），让 FPGAgent 既能展示多行文字终端，又能流畅运行贪吃蛇、跑酷、打砖块等真实 Verilog 小游戏。
> 2. **引擎 V3 硬件能力跃升**：补齐 **1D/2D 定长寄存器数组** 解析与仿真、128 字节确定性显存状态机、`stepBatch` 单帧多拍高速步进（彻底解决刷屏慢与小游戏卡顿）、`MEM` 网表聚合节点，以及 `expectTone`/`expectScreen` 自测断言。
> 3. **站点体验与按项目扣次限流**：默认免费额度调整为 **每 IP / 每浏览器每日 6 次**，按 `runId` 对同一轮项目生成/修改/修复闭环只扣 **1 次**（不再按内部多次 `llm.chat` 重复扣次）。
>
> **零冲突铁律**：保持目录所有权不变——队长负责契约、云函数、服务层与全部前端 UI/大屏/音频；队友 1 专注 `src/engine/` 与 `tests/engine.test.ts`；队友 2（GitHub: `fzd1210-beep`）专注 `src/agent/` 与 `tests/agent.test.ts`，核心 Agent 编排保持稳定不大改，重点聚焦板卡感知提示词、断言清洗、透传与新旗舰案例。

### 3.1 队长（契约与按项目限流 + 左侧板卡配置 + 中间主视区 16×8 屏幕与蜂鸣器 UI + 联调部署，`feat/ui-core`）
- **专属目录**：`src/types/contracts.ts`、`src/services/`、`src/components/`、`src/App.tsx`、`functions/`、`tests/function.test.ts`、`tests/llmClient.test.ts`、`tests/streaming.test.ts`、`vite.config.ts`
- **第三轮工作清单**：
  1. **冻结 V3 契约与按项目扣次限流（`src/types/contracts.ts` + `functions/handler.ts` + `src/services/llmClient.ts`）**：
     - 冻结 V3 向后兼容契约（`BoardProfile`、`BoardExtendedOutputs`、`SignalSample.screenBuffer`、`ScreenCellExpectation`、`RtlEngine.stepBatch`、`GateKind: 'MEM'`、`LLMCallOptions.runId` 等）；
     - 调整站点默认额度为 **每 IP / 每浏览器每日 6 次**（`DAILY_LIMIT_PER_IP=6`、`DAILY_LIMIT_PER_BROWSER=6`）；前端为每轮生成/修改/诊断生成唯一 `runId`，云函数按 `(主体 Key, 北京时间当日, runId)` 去重计费，确保同一次项目闭环内的多次模型调用只扣 1 次额度（同时限制单 `runId` 最多 8 次子请求防滥用），前端下拉框与设置面板同步展示 `今日剩余 X / 6 次`。
  2. **左侧「诊所」重构为「板卡配置」面板（`src/components/` + `src/App.tsx`）**：
     - 替换左侧栏「诊所」主入口为「板卡配置」，提供「经典教学板」「屏显终端板」「游戏创客板」3 套预设及单外设勾选（LED、交通灯、数码管、16×8 屏幕、蜂鸣器），并将当前 `BoardProfile` 透传给 Agent；
     - 保留原有故障诊所功能作为板卡配置内或工具区的二级入口，不丢失教学排错闭环。
  3. **中间主视区 16×8 OLED Canvas 屏幕、蜂鸣器与高速仿真档（`src/components/` + `src/App.tsx`）**：
     - 实现 16×8 字符/图块混合屏幕 Canvas 组件（8×8 点阵 ASCII 字库 + `0x80..0x8F` 全部 16 个内置图块，遵循 [DATA_CONTRACTS.md](DATA_CONTRACTS.md) 第 2.2 节），在桌面端与移动端均可流畅满帧渲染；
     - 当电路使用 `screen` 外设或当前板卡启用屏幕时，中间主视区默认切换到「虚拟屏幕」大视图，保留一键切回「门级网表」Tab；提供键盘方向键/WASD 及触屏方向键直连 `key[3:0]`；
     - 接入 Web Audio API 蜂鸣器发声（严格按契约 0..15 音阶/提示音表），提供静音开关；
     - 时钟控制栏新增高速/游戏档位，优先调用 `engine.stepBatch(inputs, steps)` 批量推进，保障刷屏和小游戏丝滑无卡顿。
  4. **三端联调与 Qoder Sites 公网发布**：
     - 合并 `feat/engine`、`feat/agent` 与 `feat/ui-core` 联调验证，并在确认无误后发布至 Qoder Sites 公网验收。
- **队长验收标准**：`npm run build`、`npm run test:platform` 与全量 `npm test` 全部通过；浏览器实测按项目扣次（同 `runId` 仅扣 1 次）、板卡配置切换、16×8 大屏与门级网表互切、高速档游戏操控及蜂鸣器开关无报错。

### 3.2 队友 1（引擎 V3：1D/2D 寄存器数组 + 16×8 屏幕显存 & 蜂鸣器外设 + 高速批量步进与自测，`feat/engine`）
- **专属目录**：`src/engine/`、`tests/engine.test.ts`
- **接口交付**：保持 `src/engine/index.ts` 导出 `createRtlEngine: RtlEngineFactory`，100% 兼容 V1/V2 既有 129 条单测，补齐 V3 数组、外设显存、`stepBatch` 与自测断言。使用 `npm run test:engine` 独立验收。
- **第三轮工作清单**：
  1. **1D / 2D 定长寄存器数组支持（`ast.ts` / `parser.ts` / `simulator.ts` / `linter.ts` / `netlist.ts` / `index.ts`）**：
     - 支持 `reg [W-1:0] arr [0:N-1]` 与 `reg [W-1:0] grid [0:R-1][0:C-1]` 声明（兼容正反向边界及 `localparam` 常量表达式边界）、动态下标读写、数组元素位选/切片及有界 `for` 循环清零/初始化（将有界 `for` 迭代上限合理放宽至 256，保留防死循环保护）；
     - 适配 `linter.ts` 对数组读写和驱动分析（不误报未驱动/锁存器，越界或非法维度报 `ARRAY_BOUNDS_OR_DIM`）；
     - 适配 `netlist.ts` 将数组折叠为单个 `kind: 'MEM'` 存储块节点并在 `CompileResult.metadata.arrays` 透出元数据。
  2. **16×8 屏幕显存与蜂鸣器外设仿真（`linter.ts` / `simulator.ts` / `index.ts`）**：
     - 在 `BOARD_PORT_SPECS` 登记可选输出端口：`tone[3:0]`、`screen_x[3:0]`、`screen_y[2:0]`、`screen_data[7:0]`、`screen_cmd[1:0]`，老模块不声明时 0 报错；
     - 在 `SimulationSession` 内置 128 字节确定性显存（`reset()` 清零，每拍收敛后按 `screen_cmd` 00/01/10/11 更新显存），启用时在 `SignalSample` 填充 `extendedOutputs` 与 `screenBuffer`，在 `metadata.usedOutputs` 中标记 `'tone'` / `'screen'`。
  3. **高速批量步进与 V3 自测/Testbench 升级（`simulator.ts` / `index.ts` / `selftest.ts`）**：
     - 实现 `RtlEngine.stepBatch(inputs, steps)`：单次推进 1..256 个上升沿，仅在末拍重算网表；
     - 升级 `selftest.ts` 支持 `TestVectorStep.expectTone` 与 `expectScreen`（逐格校验 `screenBuffer[y*16+x]`，失配时准确填充 `SelfTestFailure.signal` 与 `screenCoord: { x, y }`），同步升级 `exportTestbench()` 导出包含 `tone`/`screen_*` 端口的 `tb_top.v`。
  4. **V3 专项与性能回归测试（`tests/engine.test.ts`）**：
     - 扩充单测至 **≥ 160 条**，覆盖 1D/2D 数组、数组越界保护、`MEM` 网表聚合、16×8 屏幕四类指令、蜂鸣器、`stepBatch` 与逐拍一致性、屏幕/蜂鸣器自测定位以及带屏小游戏长周期仿真性能测试。
- **队友 1 验收标准**：`npm run test:engine` 达到 **≥ 160 条全部通过**，原有 129 条零回退，`npm run build` 通过。

### 3.3 队友 2（Agent V3：板卡感知动态 Prompt + V3 断言校验 + `runId` 透传 + 屏显/蜂鸣器旗舰案例，`feat/agent`，GitHub: `fzd1210-beep`）
- **专属目录**：`src/agent/`、`tests/agent.test.ts`、参赛文档素材
- **接口交付**：保持 `src/agent/index.ts` 导出 `createAgentRuntime: AgentRuntimeFactory`，**核心 Harness 闭环流程不大改**，按 V3 契约补齐 `runId`/`boardProfile` 透传、动态外设提示词、新向量解析与旗舰预置案例。使用 `npm run test:agent` 独立验收。
- **第三轮工作清单**：
  1. **轻量透传与屏幕失配诊断（`harness.ts` / `bugClinic.ts`）**：
     - 接收并透传 `options.runId` 至本轮全部 `llm.chat` 调用，配合云函数按项目扣 1 次额度；
     - 接收 `options.boardProfile` 传入 Prompt 构造器；在自测失败描述与修复上下文中展示 `tone` 与 `screen(x,y)`（消费 `SelfTestFailure.screenCoord`）失配详情。
  2. **板卡感知动态 Prompt 与向量清洗升级（`prompts.ts`）**：
     - 按 `boardProfile.peripherals` 动态拼接端口清单：经典板卡保持精简 8 端口模板不干扰一次通过率；启用 `tone` / `screen` 时动态注入 [DATA_CONTRACTS.md](DATA_CONTRACTS.md) 的音阶表、16×8 显存命令协议、`0x80..0x8F` 全部内置图块编码表，以及“善用定长 `reg` 数组 + 增量刷新减少全屏重绘”的编码规范；
     - 升级 `normalizeTestVectors` 放行并严格校验 `expectTone`（0..15）与 `expectScreen`（`x: 0..15`、`y: 0..7`、`code: 0..255`）。
  3. **新增 V3 带屏/蜂鸣器零 Token 旗舰案例（`presets.ts` / `mockPresets.ts` / `bugClinic.ts`）**：
     - 为既有 5 个经典案例补齐 `boardProfileId: 'classic'` 并保持 100% 兼容；
     - 新增至少 2 个带 16×8 屏幕 + 蜂鸣器的零 Token 旗舰演示案例（例如「像素跑酷 / 迷你贪吃蛇小游戏」与「交互式电子琴 / 文字状态终端」），配套完整蓝图、Verilog、V3 自测向量与故障诊所关卡，标注 `boardProfileId` 与 `requiredPeripherals`。
  4. **离线单测、真实模型实测与参赛素材完善（`tests/agent.test.ts` + `docs/REAL_MODEL_EVAL.md`）**：
     - 补充离线单测覆盖 `runId` 全程透传、不同 `boardProfile` 动态 Prompt 差异、`expectTone`/`expectScreen` 校验清洗、`screenCoord` 修复引导及新案例结构校验；
     - 用真实模型实测文字显示与小游戏电路生成并打磨 Prompt，同步更新参赛展示素材。
- **队友 2 验收标准**：`npm run test:agent` 全部离线通过；真实模型对文字看板与小游戏类需求的生成与自测收敛记录完整清晰。

---

## 4. 协作推进阶段（按里程碑，不绑定死天数）

| 里程碑 | 状态 | 核心目标 | 参与人 | 验收出口 |
| --- | --- | --- | --- | --- |
| **R1（M0–M2）· 首版三端联调基线** | 已完成 | 完成骨架、引擎 V1、Agent V1、前端三栏工作台并合并到 `main`（`3433a06`） | 全体成员 | `npm test` 108/108 通过，`npm run build` 通过 |
| **R2（R2-0 ~ R2-2）· 第二轮最终版** | 已完成 | 完成 V2 契约、多服务商与双渠道容灾、全链路 SSE 流式、NVIDIA 深浅主题、产品宣传页、Verilog 语法高亮、129 条引擎单测与联网查阅，合入 `main`（`baf3004`） | 全体成员 | `npm test` 217/217 通过，`npm run build` 通过，本地浏览器全链路验收通过 |
| **R3-0 · V3 契约与第三轮分工冻结** | 当前阶段 | 升级 `src/types/contracts.ts` 至 V3（100% 向后兼容），发布 V3 契约文档、升级计划与第三轮三人分工提示词并推送至 `main` | 队长 | V3 契约零破坏，`npm test` 284 通过 / 3 跳过，`npm run build` 保持全绿 |
| **R3-1 · 第三轮三线并行开发** | 下一阶段 | 队长做每日 6 次按项目扣次限流、左侧板卡配置、中间主视区 16×8 大屏与蜂鸣器；队友 1 做 1D/2D 数组、128B 显存/蜂鸣器外设与 `stepBatch`；队友 2 做 `runId`/板卡动态 Prompt、`expectTone`/`expectScreen` 与带屏旗舰案例 | 三人并行 | 各自基于最新 `main` 在 `feat/ui-core`、`feat/engine`、`feat/agent` 通过独立模块验收 |
| **R3-2 · 第三轮联调与多设备/真模型验收** | 待开始 | 合并三分支到 `main`，验证经典板与带屏/游戏板全链路、桌面/移动端流畅度、真模型生成文字/小游戏与按项目扣次限流 | 全体成员 | 全量单测 ≥ 260 条通过；无痕模式与多设备运行流畅；带屏案例与自由生成小游戏均可玩可听 |
| **R3-3 · Qoder Sites 最终公网发布与参赛交付** | 待开始 | 公网更新部署 Qoder Sites，配置双渠道 Secret 与每日 6 次限流；无痕模式验收并提交天池论坛帖 | 队长主部署 + 队友 2 整文案 | 公网链接秒开、5 步内跑通、免 Key 体验与 BYOK 均稳定、天池参赛帖提交通过 |

---

## 5. 原项目资产（`reference/fpga2026/`）合规复用映射

| 原项目资产位置 | 提取复用内容 | 新项目落地点 |
| --- | --- | --- |
| `skill/sv-combinational`、`sv-sequential`、`sv-fsm`、`sv-width-sign` | 组合/时序/状态机/位宽编码铁律 | `src/agent/prompts.ts`（精简为前端 AI 生成规则） |
| `skill/rtl-lint-rules`、`rtl-interface-check` | 6 类核心数据流告警与端口比对逻辑 | `src/engine/linter.ts`（纯 TS 全新重写） |
| `skill/rtl-pitfalls` | 10 条真实硬件踩坑证据（阻塞赋值、未驱动输出、无符号右移等） | `src/agent/bugClinic.ts`（转化为「故障诊所」题库） |
| `REPORT.md` 第 2/4 节 | Harness 六大部件：交接蓝图、CPU 确定性自测、首个反例、无回退择优 | `src/agent/harness.ts` & `src/engine/selftest.ts` |
| `serve/`、`Dockerfile`、`llama.cpp`、Vivado 后端 | **全部舍弃**（不适用于浏览器与 Qoder Sites） | 无 |

---

## 6. 天池比赛最终提交检查清单

- [ ] 全体队员完成 **天池实名认证** + **阿里云大学生认证**（截止前必须完成，否则取消获奖资格）。
- [ ] 在天池赛题页论坛发帖，标题注明赛道：`【StudyHack】FPGAgent：...`。
- [ ] 帖子包含以下全部必填项：
  1. **Qoder Sites 公网公开访问链接**（无需登录、无需填 Key 即可完整体验）；
  2. **使用的 Qoder 账号 UID** 及 **三人明确分工**；
  3. **作品介绍五件套**：自我介绍、作品是什么（一句话说清谁在什么场景用）、为什么做、怎么用（5 步内上手）、**用 Qoder 开发与部署的全过程（附多张真实截图凭证）**；
  4. **工程可信度补充**：自动化单测通过率（如 `58/58` 项通过）+ 坦诚声明 `Known Limitations`。
- [ ] （可选加分）同步发布至小红书/抖音/X 并填写官方钉钉表单冲刺社交传播奖。
