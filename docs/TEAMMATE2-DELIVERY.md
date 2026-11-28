# 队友 2 交付说明：AI 闭环、故障题库与参赛文案素材

> 分支：`feat/agent`（只推分支，不建 PR）
> 依赖契约：[src/types/contracts.ts](../src/types/contracts.ts)
> 模块验收：`npm run test:agent`（36 个用例，全部使用替身 LLM / 引擎，不消耗 Token）
> 真实模型评测：见 [REAL_MODEL_EVAL.md](REAL_MODEL_EVAL.md)（需要 `.env.local` 测试 Key）
> 状态说明：本文记录 V2 交付内容；V3 已在此基础上升级，当前全量测试为 **284 通过 / 3 跳过**，支持 1D/2D 定长数组、OLED 与蜂鸣器。

## 1. 交付物清单

| 文件 | 作用 | 验收证据 |
| --- | --- | --- |
| [src/agent/prompts.ts](../src/agent/prompts.ts) | 五个动作的 System Prompt（规划/生成/修复/诊断/故障注入）、板卡接口、可综合 Verilog 子集、严格 JSON Schema 与鲁棒解析 | 围栏/夹带文字/纯文本三种输出均可解析；非法字段抛 `BAD_RESPONSE` |
| [src/agent/harness.ts](../src/agent/harness.ts) | 规划→（可选联网查阅）→生成→Lint→确定性自测→最多 2 轮修复→无回退择优；多模型透传、多轮上下文、`onTrace`/`onAssistantDelta`、取消与 temperature | 35 个测试覆盖通过路径、修复、未收敛、额度中断、取消、模型透传、think 容错、多轮、联网降级 |
| [src/agent/presets.ts](../src/agent/presets.ts) | 5 个零 Token 预置案例：交通灯、四位密码锁、1011 序列检测器、数字秒表、四人抢答器 | 已用 `feat/engine` 真实引擎逐案验证：20/20、19/19、6/6、15/15、9/9 断言全部通过 |
| [src/agent/bugClinic.ts](../src/agent/bugClinic.ts) | 7 个算法注入故障（漏复位、状态机转移、标志不清零、BCD 进位、锁存缺失、位宽截断、时序块阻塞赋值）+ LLM 故障注入入口 | 7 个故障均可被自测或 Lint 观测；修复代码全部编译并自测通过；`highlightLine` 已逐行核对 |
| [src/agent/index.ts](../src/agent/index.ts) | 对前端暴露 `createAgentRuntime({ llm, engine })`，不引用任何具体模型/引擎实现 | 前端零改动接入（[src/App.tsx](../src/App.tsx)） |
| [tests/agent.test.ts](../tests/agent.test.ts) | 35 个单元测试（零 Token，替身 LLM/引擎） | `npm run test:agent` 35/35 |
| [tests/realModel.eval.test.ts](../tests/realModel.eval.test.ts) | 3 个新电路 + 追改的真实模型评测用例，`EVAL_REAL=1` 才执行 | 无 Key 时整组跳过；执行方式见 [REAL_MODEL_EVAL.md](REAL_MODEL_EVAL.md) |
| 本文档 | 故障诊所交互规范 + 参赛文案草稿 + 交接事项 | — |

## 2. 本轮打磨内容（feat/agent `5134c0f`，V2）

- **多模型透传**：`runHarness` / `diagnose` / `injectBug` 接受 `model` 与 `signal`；结果回传 `modelUsed`、`remainingQuota`，trace `meta` 携带模型与联网来源。
- **推理模型容错**：新增 `stripReasoning` 剥离 `think` 思考段，围栏 JSON 与夹带说明文字均可解析。
- **多轮增量修改**：消费 `previousContext`（蓝图 / 代码 / 自测向量 / 历史），生成 `assistantSummary`、`suggestedFilename` 与分片 `onAssistantDelta`。
- **联网查阅闭环**：命中规范类需求或修复受阻时进入 `researching` 阶段，引用写入 `references` 与 `meta.sources`；检索失败自动降级为纯模型闭环。
- **预置案例元数据**：5 个案例补齐 `category / difficulty / boardHint`；交通灯故障替换为真实引擎可复现的「黄灯多一拍」（第 9 拍 `seg` 期望 1 实际 2）。
- **测试扩充**：25 → 35 个用例，覆盖模型透传、think 容错、多轮提示词注入、查阅触发与降级、预置案例真实引擎回归。

上一轮已有的 Schema 归一化（首拍强制 `rst_n=0`、非法 `expect` 忽略）、按动作 temperature（0.2 / 0.3 / 0.5）、组合逻辑未收敛路径继续保留。

## 3. 故障诊所交互规范（交给队长的最小 UI 方案）

数据全部来自 `runtime.presets[].bugs`，**不消耗 Token**；LLM 注入（`runtime.injectBug`）作为"随机加练"可选。

1. **入口**：工作台"电路资料"侧栏新增第 4 个页签「故障诊所」；或预置案例卡片右下角「挑战故障」。
2. **选关**：列出当前案例的 1–2 个故障关卡（`title` + `pitfallTag`），显示"未通过/已通过"状态（本地内存即可）。
3. **现象**：点开显示 `symptom`，提供"载入故障电路"按钮——把 `buggyCode` 装进现有编辑器并编译（Lint 告警会自然出现）；自测失败时高亮 `highlightCycle`，Lint 告警时高亮 `highlightLine`。
4. **三档提示**：依次解锁 `diagnosis.level1Hint` → `level2Cause` → `level3PatchCode`；第 3 档提供"载入修复代码"按钮。
5. **验收**：修复代码编译 + 自测通过后标记关卡完成；展示 `pitfallTag` 对应的知识点小结。

建议 API（无需改契约）：
- 选关：`preset.bugs[i]`
- 判分：`engine.compile(bug.diagnosis.level3PatchCode)` + `engine.runSelfTest(...)`（或直接载入）
- 可选加练：`runtime.injectBug(currentCode)`

## 4. 参赛文案草稿（天池帖子素材）

**一句话介绍**：FPGAgent 是一个浏览器里的 AI 硬件助教——用中文说出想做的电路，它给出蓝图、可综合 Verilog、逐拍自测与门级波形，学生改代码就能立刻看到 Lint 与波形反例。

**5 步上手指南**（无需登录、无需填 Key）：
1. 打开站点，在输入框描述需求，或点「做一个智能交通灯」预设。
2. 等待规划/生成/自测三段进度完成，左侧栏查看蓝图、行为要点与引脚映射。
3. 中间门级画布看信号逐层传播，支持拖动缩放、0.2× 慢动作、单步执行。
4. 右侧实时波形 + 虚拟板卡：拨 SW、按 KEY、点 RST，观察 LED/数码管/交通灯变化。
5. 在「Verilog」页签改代码点「编译并自测」；失败时看 Lint 告警与首个反例拍，再迭代（自动修复最多 2 轮）。

**团队分工**：
- 队长：前端工作台、板卡/网表动画、云函数代理、Qoder Sites 部署
- 队友 1：Verilog 解析、周期仿真、教学网表、静态 Lint、确定性自测引擎
- 队友 2：Prompt 与 JSON 契约、规划生成修复闭环、预置案例与故障题库、参赛文案

**Known Limitations**（如实声明）：
- 支持教学级可综合 Verilog 子集（含 1D/2D 定长数组与有界 for 初始化；不支持模块实例化、除法等），复杂设计仍可能触发 Lint 或修复失败
- 自测向量由模型生成，覆盖不全时"通过"不代表功能完全正确
- 免 Key 体验按浏览器/IP 每日 6 次，并按项目 `runId` 扣次
- 故障题库保留在代码中，当前主工作台未提供独立入口；LLM 随机注入需要模型额度
- BYOK 要求接口支持浏览器跨域调用；状态图已用内置 FSM 渲染器展示

**Qoder 过程截图清单**（M4 补齐）：
- 三线并行开发：契约冻结、`npm test` 全绿、合并冲突解决
- 真实引擎联调：5 个预置案例亮灯、波形容差、Lint 反例
- AI 闭环：一次完整 runHarness 的 trace、修复前后对比
- 故障诊所：三档提示逐级解锁
- 部署：公网链接、无痕模式 5 步跑通

## 5. 交接事项（阻塞项）

| 事项 | 负责方 | 状态 |
| --- | --- | --- |
| 真实模型评测（3 个新电路 + 追改） | 队友 2 | 用例与清单已就绪；阻塞于 `.env.local` 测试 Key 与云端 Secret |
| 故障诊所 UI 入口（按第 3 节规范） | 队长 | 待接入 |
| 模型选择器 / 联网开关 / `modelUsed`、额度、trace 来源展示 / Mermaid 渲染 | 队长 | 待接入（V2 新增） |
| `llmClient` 未把单次 `options.model` 透传给上游 | 队长 | 待修；否则 UI 模型切换不生效，评测暂用 `LLM_MODEL` 环境变量 |
| 云函数部署、Secret、ALLOWED_ORIGINS、公网链接 | 队长 | 待部署 |
| `mockPresets.ts` 迁移（`tests/engine.test.ts` 仍直接引用） | 队友 2 + 队友 1 | 待统一引用方式 |
| 重复失败 trace / `repairRounds` 展示细节 | 队长 | 建议项，不影响验收 |

## 6. 真实模型评测

清单、命令与记录模板见 [REAL_MODEL_EVAL.md](REAL_MODEL_EVAL.md)。要点：

- 3 个新电路（PWM 调光灯、长短按检测器、两位 BCD 加减计数器），每条再跟一次追改，验证多轮上下文
- 用例在 [tests/realModel.eval.test.ts](../tests/realModel.eval.test.ts)，`EVAL_REAL=1` 且配置 `LLM_API_KEY` 才执行，普通 `npm test` 自动跳过
- 通过后回填本文第 5 节状态，并保留 verbose 输出截图作为 M4 素材

## 7. 本地复现

```bash
npm run test:agent      # 36 个 Agent 单元测试
npm run typecheck       # 严格类型检查
npm test                # 当前全量 284 通过 / 3 跳过（无 Key 时真实模型评测自动跳过）
npm run build           # 生产构建
```