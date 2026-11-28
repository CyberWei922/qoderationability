# FPGAgent 统一数据契约（V3 · 第三轮冻结版）

冻结版以 [`src/types/contracts.ts`](../src/types/contracts.ts) 为准。三位成员直接从该文件导入类型。**V3 全部新增字段、类型与方法均保持可选或超集扩展，100% 向后兼容 V1/V2 代码与全部既有测试（当前全量 284 条通过）。** 字段或语义有变动时，在群内同步后由队长统一修改。

| 接口 | 协作方 | 用途 |
| --- | --- | --- |
| `BoardProfile`、`BoardPeripheralId`、`BoardInputs`、`BoardOutputs`、`BoardExtendedOutputs`、`SignalSample` | 队长、队友 1、队友 2 | 板卡外设配置、输入/输出采样、可选蜂鸣器与 16×8 屏幕显存快照。每次 `step`/`stepBatch` 执行时钟上升沿并返回采样与网表。 |
| `NetlistGraph`（含 `levelNarrations` 与 `MEM` 节点） | 队友 1 → 队长 | 绘制节点、导线、数组存储块折叠节点、逐层慢动作传播与分层中文信号说明。 |
| `RtlEngine`、`CompileResult`、`CircuitMetadata`、`SelfTestResult`、`ScreenCellExpectation` | 队友 1 → 队长、队友 2 | 编译、寄存器数组元数据、Lint、确定性自测（含蜂鸣器与屏幕显存格断言）、高速批量步进 `stepBatch` 及 `tb_top.v` 导出。 |
| `LLMProviderPreset`、`LLMModelOption`、`LLMClient`（含 `runId`）、`LLMError` | 队长 → 队友 2 | 多服务商预设、自动拉取 `/models`、按次切模型、SSE 流式回调、双渠道容灾与按项目 `runId` 扣次。 |
| `WebResearchClient`、`WebReference`、`WebPageContent` | 队长/云函数 → 队友 2 | 可选联网检索与网页正文提取接口，供智能体查阅 Verilog 规范或参考实例。 |
| `AgentRuntime`、`HarnessRunOptions`（含 `boardProfile`/`runId`）、`HarnessPreviousContext`、`HarnessResult`、`HarnessTraceEvent` | 队友 2 → 队长 | 启动生成/多轮修改闭环、按当前板卡动态注入外设协议、透传 `model`/`runId`、接收流式与步骤回调、载入案例、诊断及故障注入。 |

---

## 1. 仿真、元数据、数组与高速步进（队长 ↔ 队友 1）

- `src/engine/index.ts` 导出 `createRtlEngine: RtlEngineFactory`。板卡与 Harness 各使用一个实例。`runSelfTest` 必须使用独立仿真状态，调用结束后板卡继续原来的周期。
- `step` 从周期 0 开始计数，`reset()` 后重新计数。测试向量的 `cycle` 等于数组下标。时序电路的用例应显式拉低 `rst_n` 完成电路复位。
- `passedCycles` 记录至少有一个断言（经典 `expect`、`expectTone` 或 `expectScreen`）且全部通过的周期。Harness 将上一候选的 `passedCycles` 传给新一轮自测，`regressedCycles` 指出先前通过、现在失败的周期。
- 组合逻辑未在迭代上限内收敛时，自测失败并通过 `firstUnstableCycle` 报告首个未收敛周期，即使该拍输出碰巧吻合断言。`firstFailure` 用于稳定输出的首个失配；当屏幕显存格失配时，`firstFailure.signal === 'screen'` 且必须填写 `firstFailure.screenCoord = { x, y }`。
- 经典输出编码保持不变：`traffic` 位 2、1、0 分别对应红、黄、绿灯；`seg` 由高到低分为四组 4 位数字，最高组在显示器左边。
- **V3 新增引擎能力**：
  - **定长寄存器数组**：支持 1D/2D `reg` 数组（如 `reg [7:0] buf [0:15]`、`reg [7:0] grid [0:7][0:15]`）的声明、常量/变量索引读写、元素位选与有界 `for` 循环初始化；`CompileResult.metadata.arrays` 透出数组元数据，`NetlistGraph` 将数组折叠为 `kind: 'MEM'` 的存储块节点，避免原理图爆炸。
  - **高速批量步进 `RtlEngine.stepBatch?(inputs, steps)`**：单帧内连续执行 `steps` 个上升沿，**仅在末拍重算门级网表**，供带屏文字刷屏与小游戏模式使用，确保低配电脑与移动端同样流畅不卡顿。
  - **端口向后兼容规则**：`top` 模块声明 V3 可选端口（`tone`、`screen_x/y/data/cmd`）时需符合下方位宽与方向规范；未声明这些可选端口的 V1/V2 模块不得报 `PORT_MISMATCH`。

---

## 2. V3 扩展外设统一硬件协议（三端严格对齐）

### 2.1 板卡配置模型（`BoardProfile`）

板卡配置支持 3 个内置预设 + 自定义开关，控制「板卡配置」面板展示、中间主视区默认视图以及 Agent 动态 Prompt：

| 预设 ID (`BoardProfileId`) | 推荐名称 | 默认启用外设 (`peripherals`) | 默认主视区 (`primaryView`) | 适用场景 |
| --- | --- | --- | --- | --- |
| `classic` | 经典教学板 | `['led', 'traffic', 'seg']` | `netlist` | 交通灯、密码锁、计数器、状态机、门级慢动作教学 |
| `display` | 屏显终端板 | `['led', 'seg', 'screen', 'tone']` | `screen` | 文字看板、仪表盘、倒计时终端、带提示音交互面板 |
| `arcade` | 游戏创客板 | `['led', 'seg', 'screen', 'tone']` | `screen` | 贪吃蛇、躲避障碍跑酷、打砖块、接金币、电子琴 |
| `custom` | 自定义板卡 | 用户在左侧「板卡配置」勾选组合 | 含 `screen` 时为 `screen`，否则 `netlist` | 自由组合外设 |

### 2.2 16×8 字符/图块混合屏幕（`screen`，等效 128×64 宽屏 OLED）

- **空间规格**：16 列（`x: 0..15`）× 8 行（`y: 0..7`），共 **128 格**；前端 Canvas 每格绘制 8×8 像素，视觉等效经典 128×64 像素宽屏 OLED。
- **可选 Verilog 输出端口**（4 个端口须同时声明，或在启用屏幕时完整声明）：
  ```verilog
  output [3:0] screen_x,     // 列坐标 0..15
  output [2:0] screen_y,     // 行坐标 0..7
  output [7:0] screen_data,  // 格编码：0x00 空白 / 0x20..0x7E ASCII / 0x80..0x9F 内置图块
  output [1:0] screen_cmd    // 2'b00 无操作, 2'b01 写入(x,y), 2'b10 整屏清屏, 2'b11 清屏并写入(x,y)
  ```
- **显存状态机确定性语义**：
  - `reset()` 时 128 字节 `screenBuffer` 全部清零（`0x00`）。
  - 每个时钟上升沿（所有时序/组合逻辑稳定收敛后）按 `screen_cmd` 更新显存：
    - `2'b00`：保持显存不变；
    - `2'b01`：`screenBuffer[screen_y * 16 + screen_x] = screen_data`；
    - `2'b10`：将全部 128 格清为 `0x00`；
    - `2'b11`：先将全部 128 格清为 `0x00`，再写入 `screenBuffer[screen_y * 16 + screen_x] = screen_data`。
  - 仅当电路使用 `screen` 时，`SignalSample.screenBuffer` 返回长度为 128 的数组副本，`CompileResult.metadata.usedOutputs` 包含 `'screen'`。
- **内置 8×8 图块编码表（`0x80..0x8F`，队长渲染与队友 2 Prompt 严格一致）**：

| 编码 | 语义 | 典型用途 | 编码 | 语义 | 典型用途 |
| --- | --- | --- | --- | --- | --- |
| `0x80` | 实心方块 | 墙体、进度条、实心像素 | `0x88` | 障碍物 / 敌人 | 跑酷仙人掌、敌机、尖刺 |
| `0x81` | 空心方框 | 边框、光标、格子 | `0x89` | 小车 / 飞船 | 赛车、飞机大战主角 |
| `0x82` | 实心圆球 | 弹球、子弹、圆点 | `0x8A` | 爱心 | 生命值 HP |
| `0x83` | 主角 / 蛇头 | 贪吃蛇头、玩家角色 | `0x8B` | 星星 / 奖杯 | 得分道具、胜利标识 |
| `0x84` | 蛇身 / 柔角块 | 贪吃蛇身、连块 | `0x8C` | 向上箭头 `↑` | 方向提示 |
| `0x85` | 金币 / 苹果 | 食物、收集物 | `0x8D` | 向下箭头 `↓` | 方向提示 |
| `0x86` | 砖块纹理 | 打砖块目标砖 | `0x8E` | 向左箭头 `←` | 方向提示 |
| `0x87` | 横向挡板 | 打砖块/接球挡板 | `0x8F` | 向右箭头 `→` | 方向提示 |

  > `0x90..0x9F` 保留扩展（前端可渲染为半高/棋盘/波形辅助块），`0x20..0x7E` 统一按标准 ASCII 渲染。

### 2.3 板载蜂鸣器（`tone`）

- **可选 Verilog 输出端口**：`output [3:0] tone`（4-bit，`0..15`）。
- **编码与频率映射**（前端 Web Audio API 统一按此表发声，带静音开关）：
  - `4'd0`：静音（Mute）
  - `4'd1..4'd8`：C4 (262Hz), D4 (294Hz), E4 (330Hz), F4 (349Hz), G4 (392Hz), A4 (440Hz), B4 (494Hz), C5 (523Hz)
  - `4'd9..4'd12`：D5 (587Hz), E5 (659Hz), F5 (698Hz), G5 (784Hz)
  - `4'd13`：按键确认短音（880Hz）
  - `4'd14`：得分/通关高音（1047Hz）
  - `4'd15`：碰撞/报错低沉警报音（196Hz）

---

## 3. 大模型、服务商预设与按项目扣次限流（队长 → 队友 2）

- `LLMProviderPreset` 定义内置服务商预设（DeepSeek、智谱 GLM、通义千问 DashScope、AMD Radeon Cloud、硅基流动 SiliconFlow、月之暗面 Kimi、本地网关、自定义 OpenAI 兼容），站点默认模式支持主备双渠道自动容灾切换。
- `LLMClient.chat(options)` 支持 `options.model`、`options.onDelta`、`options.onReasoningDelta` 以及 **V3 新增 `options.runId`**。
- **V3 按项目扣次规则（每 IP / 每浏览器每日 6 次）**：
  - 每次用户发起「生成新电路 / 追问修改 / 诊断 / 故障注入」任务时，由前端生成唯一 `runId` 传入 `HarnessRunOptions.runId`（或 `AgentActionOptions.runId`），Agent 将同一 `runId` 透传给该轮内全部 `llm.chat` 调用（规划 + 编码 + 自动修复）。
  - 云函数 `/agent` 对相同 `(主体 Key, 北京时间当日, runId)` 的后续子调用免重复扣次（同时保留单 `runId` 最大子请求上限如 8 次防止滥用），确保**用户每做一个项目只扣 1 次额度**；默认限额统一调整为 `DAILY_LIMIT_PER_IP=6`、`DAILY_LIMIT_PER_BROWSER=6`。

---

## 4. 联网检索与网页读取（队长/云函数 → 队友 2）

- `WebResearchClient` 通过 `createAgentRuntime({ llm, engine, research })` 可选注入，不要求 `src/agent/` 依赖任何浏览器或网络库。
- 优雅降级铁律不变：未注入 `research`、用户关闭联网、或搜索/网页读取超时报错时，不得中断主流程，应记录提示后自动回退到纯模型闭环。

---

## 5. 智能体运行时、板卡感知 Prompt 与新案例（队友 2 → 队长）

- `src/agent/index.ts` 保留 `createAgentRuntime: AgentRuntimeFactory`。
- `runHarness(prompt, options)` 新增消费：
  - `options.boardProfile`：根据启用外设动态拼接端口表与协议说明（未启用 `screen`/`tone` 时保持原精简端口表，避免干扰经典电路一次通过率）；
  - `options.runId`：原样透传给本轮所有 `llm.chat({ ..., runId })`；
  - `options.previousContext`、`options.model`、`options.enableWebResearch` 及全部流式回调保持不变。
- `PresetProject` 新增可选 `boardProfileId` 与 `requiredPeripherals`，便于前端载入带屏/带蜂鸣器案例时自动切换到对应板卡配置与屏幕主视区。
