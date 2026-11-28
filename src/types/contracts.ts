// 冻结契约（V3 · 第三轮冻结版）：字段变更须在群内同步，由队长统一修改本文件。
// V3 全部新增字段、类型与方法均保持可选或超集扩展，100% 向后兼容 V1/V2 代码与既有单测。

// ============================================================
// 1. 虚拟 FPGA 开发板硬件接口与板卡配置（队长 UI <-> 队友 1 仿真器 <-> 队友 2 Agent）
// ============================================================

export type BoardPeripheralId = 'led' | 'traffic' | 'seg' | 'tone' | 'screen';

export type BoardProfileId = 'classic' | 'display' | 'arcade' | 'custom';

export interface BoardProfile {
  id: BoardProfileId;
  name: string;
  description?: string;
  peripherals: BoardPeripheralId[];
  primaryView?: 'netlist' | 'screen'; // 有屏板卡默认在中间主视区优先展示屏幕，仍可切回门级网表
}

export const BOARD_SCREEN_COLS = 16;
export const BOARD_SCREEN_ROWS = 8;
export const BOARD_SCREEN_CELLS = BOARD_SCREEN_COLS * BOARD_SCREEN_ROWS; // 128 格（每格 8x8 像素，等效 128x64 OLED）

export interface BoardInputs {
  rst_n: 0 | 1;        // 1=正常工作, 0=低电平复位
  key: number;         // 4-bit (0..15), bit0=KEY0 .. bit3=KEY3
  sw: number;          // 8-bit (0..255), bit0=SW0 .. bit7=SW7
}

export interface BoardOutputs {
  led: number;         // 8-bit (0..255), bit0=LED0 .. bit7=LED7
  traffic: number;     // 3-bit, bit2=红灯, bit1=黄灯, bit0=绿灯
  seg: number;         // 16-bit, 4个4-bit BCD/Hex数码管（高位在左）
}

// V3 可选 16x8 屏幕单拍写/清指令端口快照（对应 Verilog 可选输出端口 screen_x/y/data/cmd）
// screen_cmd: 2'b00=无操作, 2'b01=写入 (x,y)=data, 2'b10=整屏清屏, 2'b11=整屏清屏并立即写入 (x,y)=data
// screen_data: 0x00=空白, 0x20..0x7E=ASCII 字符, 0x80..0x9F=内置 8x8 像素图块
export interface ScreenPortOutputs {
  x: number;           // 4-bit (0..15), 对应 screen_x
  y: number;           // 3-bit (0..7),  对应 screen_y
  data: number;        // 8-bit (0..255), 对应 screen_data
  cmd: number;         // 2-bit (0..3),  对应 screen_cmd
}

export interface BoardExtendedOutputs {
  tone?: number;              // 4-bit (0..15), 对应 tone：0=静音, 1..15=音阶/提示音编码
  screen?: ScreenPortOutputs; // 16x8 字符/图块 OLED 屏幕指令端口
}

export interface SignalSample {
  cycle: number;
  inputs: BoardInputs;
  outputs: BoardOutputs;
  internals: Record<string, number>; // 关键内部寄存器/状态机当前值（供示波器展示）
  extendedOutputs?: BoardExtendedOutputs; // V3：启用蜂鸣器/屏幕时返回
  screenBuffer?: number[];                // V3：启用屏幕时返回长度 128 的扁平显存快照 (index = y * 16 + x)
}

// ============================================================
// 2. 教学级 RTL-门混合网表（队友 1 生成 -> 队长 GateCanvas 渲染）
// ============================================================

export type GateKind =
  | 'INPUT'
  | 'OUTPUT'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'XOR'
  | 'MUX'
  | 'CMP'
  | 'ADD'
  | 'DFF'
  | 'MEM'
  | 'CONST'
  | 'BUS'
  | 'RTL';

export interface NetlistNode {
  id: string;
  label: string;       // 显示名，如 "KEY0" / "MUX_emergency" / "DFF_state" / "RED_LED"
  kind: GateKind;
  width: number;       // 位宽，如 1 / 4 / 8
  level: number;       // 拓扑层级：0=输入端口，逐级向右递增，用于慢动作逐级发光
  value: number;       // 当前拍数值
  changed: boolean;    // 相比上一拍是否发生跳变（驱动慢动作高光）
  sourceLine?: number; // 对应 Verilog 代码行号（点击门可高亮对应代码）
  operator?: string;
  sampled?: boolean;
}

export interface NetlistEdge {
  id: string;
  from: string;        // 源节点 id
  to: string;          // 目标节点 id
  signalName: string;  // 导线信号名
  width?: number;
  fromPin?: string;
  toPin?: string;
  activeLow?: boolean;
  sampled?: boolean;
  value: number;       // 当前导线逻辑值（>0 视为高电平发光）
  changed: boolean;    // 是否跳变（用于播放电流脉冲动画）
}

export interface NetlistGraph {
  nodes: NetlistNode[];
  edges: NetlistEdge[];
  maxLevel: number;
  narration: string;   // 底部白话信号流播报，例如："KEY0=1 → 选通紧急MUX → 触发RED_LED点亮"
  levelNarrations?: string[]; // 按拓扑层级 0..maxLevel 的逐级播报（慢动作/单步传播使用）
}

// ============================================================
// 3. 静态 Lint 体检与确定性自测（队友 1 引擎 -> 队长 UI & 队友 2 Harness）
// ============================================================

export type LintRuleCode =
  | 'PARSE_ERROR'
  | 'PORT_MISMATCH'
  | 'SEQ_BLOCKING_ASSIGN'
  | 'COMB_NONBLOCKING_ASSIGN'
  | 'INFERRED_LATCH'
  | 'UNDRIVEN_OR_UNASSIGNED'
  | 'MULTI_DRIVER'
  | 'UNSIGNED_ARITH_SHIFT'
  | 'ARRAY_BOUNDS_OR_DIM';

export interface LintIssue {
  code: LintRuleCode;
  severity: 'error' | 'warning';
  line: number;
  column?: number;
  message: string;     // 中文清晰解释
  hint: string;        // 修复建议
}

export interface ScreenCellExpectation {
  x: number;           // 0..15
  y: number;           // 0..7
  code: number;        // 0x00 空白 / 0x20..0x7E ASCII / 0x80..0x9F 内置图块
}

// 自测语义：先 compile + reset，再按数组顺序每条执行一次 step(inputs)（一个上升沿），
// 用该次 step 返回的 outputs（及 V3 可选 tone / screenBuffer）比对断言。cycle 必须等于数组下标（从 0 开始）。
export interface TestVectorStep {
  cycle: number;
  inputs: BoardInputs;
  expect?: Partial<BoardOutputs>;          // 只检查关心的经典板卡输出字段（led / traffic / seg）
  expectTone?: number;                     // V3 可选：蜂鸣器音阶期望值 (0..15)
  expectScreen?: ScreenCellExpectation[];  // V3 可选：16x8 显存指定坐标期望值
  note?: string;                           // 该拍检查意图，如 "按下KEY0后应强制红灯亮"
}

export type SelfTestSignalKey = keyof BoardOutputs | 'tone' | 'screen';

export interface SelfTestFailure {
  cycle: number;
  signal: SelfTestSignalKey;
  expected: number;
  actual: number;
  screenCoord?: { x: number; y: number };  // V3：signal === 'screen' 时指明首个失配格子坐标
  note?: string;
}

export interface SelfTestResult {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  firstFailure?: SelfTestFailure;     // 首个输出失配
  firstUnstableCycle?: number;        // 首个未收敛周期，即使输出碰巧符合断言
  passedCycles: number[];             // 本次带 expect 且全部通过的周期（作为下一轮的 previousPassedCycles）
  regressedCycles: number[];          // 上一版通过、本版失败的周期（无回退警报）
  waveform: SignalSample[];           // 本次自测完整波形
}

// ============================================================
// 4. 仿真引擎统一对外接口（队友 1 在 src/engine/index.ts 导出）
// ============================================================

export interface SignalDescriptor {
  name: string;
  width: number;
}

export interface ArrayDescriptor {
  name: string;
  elementWidth: number;
  dimensions: number[]; // 如 [16] 或 [8, 16]
}

export interface CircuitMetadata {
  moduleName: string;
  usedInputs: Array<'rst_n' | 'key' | 'sw'>;
  usedOutputs: BoardPeripheralId[];    // V3 扩展：支持 'led' | 'traffic' | 'seg' | 'tone' | 'screen'
  internalSignals: SignalDescriptor[]; // 内部关键寄存器/信号及位宽，供波形示波器自动展开
  arrays?: ArrayDescriptor[];          // V3 可选：电路中声明的定长寄存器数组元数据
}

export interface CompileResult {
  ok: boolean;
  issues: LintIssue[];
  netlist?: NetlistGraph;
  metadata?: CircuitMetadata;
}

// compile 成功后 reset，step 的 sample.cycle 从 0 开始递增；reset 后重新从 0 计数。
// runSelfTest 必须使用独立实例，不影响当前板卡上正在运行的电路状态。
export interface RtlEngine {
  compile(code: string): CompileResult;
  reset(): void;
  step(inputs: BoardInputs): {
    sample: SignalSample;
    netlist: NetlistGraph;
  };
  // V3 可选：单帧内连续步进多个周期（仅在末拍重算网表），用于带屏小游戏/高速刷屏提速
  stepBatch?(
    inputs: BoardInputs,
    steps: number
  ): {
    sample: SignalSample;
    netlist: NetlistGraph;
    waveformDelta?: SignalSample[];
  };
  runSelfTest(
    code: string,
    vectors: TestVectorStep[],
    previousPassedCycles?: number[]
  ): SelfTestResult;
  exportTestbench?(code: string, vectors: TestVectorStep[]): string; // 可选：生成标准 tb_top.v 供外部仿真器运行
}

// src/engine/index.ts 必须导出：export const createRtlEngine: RtlEngineFactory
export type RtlEngineFactory = () => RtlEngine;

// ============================================================
// 5. AI 智能体蓝图、闭环步骤与预置案例（队友 2 <-> 队长 UI）
// ============================================================

export interface PinMapping {
  port: string;        // 如 "key[0]" / "traffic[2]" / "seg"
  role: string;        // 中文功能说明，如 "紧急全红制动按钮"
}

export interface AgentBlueprint {
  title: string;
  summary: string;            // 一句话电路说明
  behaviors: string[];        // 编号行为要点列表
  pinMappings: PinMapping[];  // 虚拟板卡引脚映射表
  mermaidFsm: string;         // Mermaid stateDiagram-v2 代码
}

export type HarnessStage =
  | 'idle'
  | 'researching'
  | 'planning'
  | 'coding'
  | 'linting'
  | 'simulating'
  | 'repairing'
  | 'done'
  | 'failed';

export interface HarnessTraceMeta {
  round?: number;
  model?: string;
  checkpoints?: string[];
  sources?: WebReference[];
  reasoning?: string;
  codeLines?: number;
  durationMs?: number;
  highlightLine?: number;
}

export interface HarnessTraceEvent {
  stage: HarnessStage;
  status: 'running' | 'pass' | 'fail';
  title: string;
  detail: string;
  timestamp: number;
  meta?: HarnessTraceMeta;
}

export interface DiagnosisResponse {
  level1Hint: string;         // 第1档：苏格拉底式线索（不直接给答案）
  level2Cause: string;        // 第2档：明确指出错因与对应行/波形拍
  level3PatchCode: string;    // 第3档：可一键应用的完整修复代码
  highlightLine?: number;
  highlightCycle?: number;
}

export interface BugClinicCase {
  id: string;
  title: string;              // 如 "隐蔽故障：时序块混用阻塞赋值"
  pitfallTag: string;         // 对应原项目 rtl-pitfalls 分类
  symptom: string;            // 板卡上观察到的异常现象
  buggyCode: string;          // 注入故障后的代码
  diagnosis: DiagnosisResponse;
}

export interface PresetProject {
  id: string;
  name: string;               // 如 "智能十字路口交通灯"
  prompt: string;             // 对应的自然语言描述
  blueprint: AgentBlueprint;
  verilogCode: string;
  testVectors: TestVectorStep[];
  bugs: BugClinicCase[];      // 该工程自带的故障诊所关卡
  category?: string;          // 案例分类，如 "状态机" / "计数器" / "屏显互动" / "小游戏"
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  boardHint?: 'traffic' | 'lock' | 'counter' | 'general' | 'display' | 'arcade';
  boardProfileId?: BoardProfileId;           // V3 可选：推荐切换的板卡配置方案
  requiredPeripherals?: BoardPeripheralId[]; // V3 可选：该案例实际依赖的板卡外设清单
  recommendedClockSpeed?: 'turbo' | 'fast' | 'realtime' | 'slow';
}

// ============================================================
// 6. 统一大模型调用、服务商预设与模型列表接口（队长封装 -> 队友 2 消费）
// ============================================================

export type LLMProviderId =
  | 'site-default'
  | 'deepseek'
  | 'zhipu-glm'
  | 'dashscope-qwen'
  | 'amd-radeon'
  | 'siliconflow'
  | 'moonshot-kimi'
  | 'local-gateway'
  | 'custom';

export interface LLMProviderPreset {
  id: Exclude<LLMProviderId, 'site-default'>;
  name: string;
  baseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  docsUrl?: string;
  supportsJsonMode: boolean;
  apiKeyOptional?: boolean;
}

export interface LLMModelOption {
  id: string;
  label?: string;
  ownedBy?: string;
  contextWindow?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  action: 'plan' | 'generate' | 'repair' | 'diagnose' | 'inject_bug';
  messages: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;       // 用户取消或超时中断
  model?: string;             // 可选：单次请求覆盖当前模型（供对话内实时切换）
  runId?: string;             // V3 可选：同一次项目生成/修改/诊断闭环共享 ID，云函数按项目扣 1 次额度
  onDelta?: (chunk: string) => void; // 可选：流式文本增量回调
  onReasoningDelta?: (chunk: string) => void; // 可选：推理模型思考过程流式回调
}

export interface LLMClient {
  chat(options: LLMCallOptions): Promise<{
    text: string;
    remainingQuota?: number;  // 剩余免费次数（供前端提示）
    model?: string;           // 实际执行本次请求的模型名
  }>;
  listModels?(options?: { signal?: AbortSignal }): Promise<LLMModelOption[]>;
  testConnection?(options?: { model?: string; signal?: AbortSignal }): Promise<{
    ok: boolean;
    latencyMs: number;
    model?: string;
    message?: string;
  }>;
}

// ============================================================
// 7. 联网检索与网页读取接口（队长/云函数封装 -> 队友 2 Agent 消费）
// ============================================================

export interface WebReference {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface WebPageContent {
  url: string;
  title: string;
  excerpt: string;
}

export interface WebResearchClient {
  search(query: string, options?: { limit?: number; signal?: AbortSignal }): Promise<WebReference[]>;
  fetchPage?(url: string, options?: { maxChars?: number; signal?: AbortSignal }): Promise<WebPageContent>;
}

// ============================================================
// 8. 大模型调用统一错误（LLMClient.chat 只会抛出 LLMError）
// ============================================================

export type LLMErrorCode =
  | 'QUOTA_EXCEEDED'   // 免费额度/单 IP 每日次数用完 -> 提示改用预置案例或 BYOK
  | 'NOT_CONFIGURED'   // 服务端未配置 Key，或 BYOK/Node 模式缺少 Key
  | 'FORBIDDEN'        // 来源校验失败
  | 'TIMEOUT'          // 请求超时
  | 'ABORTED'          // 调用方主动取消
  | 'NETWORK'          // 断网 / 无法连接
  | 'UPSTREAM'         // 大模型服务端报错
  | 'BAD_RESPONSE';    // 返回内容不是预期格式

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly status?: number;

  constructor(code: LLMErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.status = status;
  }
}

export function isLLMError(error: unknown): error is LLMError {
  return error instanceof LLMError;
}

// ============================================================
// 9. 智能体运行时（队友 2 在 src/agent/index.ts 导出 -> 队长 UI 消费）
// ============================================================

export interface HarnessPreviousContext {
  blueprint?: AgentBlueprint;
  verilogCode?: string;
  testVectors?: TestVectorStep[];
  history?: ChatMessage[];
}

export interface HarnessRunOptions {
  onTrace: (event: HarnessTraceEvent) => void;
  onAssistantDelta?: (chunk: string) => void;
  onBlueprint?: (blueprint: AgentBlueprint) => void;
  onCodeDelta?: (code: string, meta?: { stage: 'coding' | 'repairing'; round?: number; final?: boolean }) => void;
  onReasoningDelta?: (stage: HarnessStage, reasoning: string, round?: number) => void;
  signal?: AbortSignal;
  model?: string;                  // 用户在对话中选中的模型
  runId?: string;                  // V3 可选：透传给本轮所有 llm.chat 调用，实现整轮闭环只扣 1 次额度
  boardProfile?: BoardProfile;     // V3 可选：当前板卡配置与启用外设，驱动动态 Prompt 与端口协议
  clockIntervalMs?: number;        // 当前仿真时钟每拍间隔（ms），默认 100ms（10Hz），慢动作 500ms（2Hz）
  previousContext?: HarnessPreviousContext; // 多轮增量修改上下文
  enableWebResearch?: boolean;     // 是否允许在不确定或修复受阻时联网查阅
  locale?: 'zh' | 'en';            // 可选：界面语言，控制智能体提示词与过程文案语言
}

export interface HarnessResult {
  ok: boolean;                     // 最终候选是否通过 Lint + 自测
  blueprint: AgentBlueprint;
  verilogCode: string;             // 无回退择优后的最佳候选
  testVectors: TestVectorStep[];
  issues: LintIssue[];
  selfTest?: SelfTestResult;       // 编译失败时为空
  repairRounds: number;            // 实际修复轮数（0..2）
  assistantSummary?: string;       // 面向左侧对话区的通俗总结
  suggestedFilename?: string;      // 建议的 .v 导出文件名，如 "traffic_light.v"
  remainingQuota?: number;         // 透传最后一次模型调用的剩余额度
  modelUsed?: string;              // 本轮实际使用的模型名
  references?: WebReference[];     // 本轮联网查阅引用来源
}

export interface DiagnoseInput {
  code: string;
  issues: LintIssue[];
  failure?: SelfTestFailure;
  waveformSlice?: SignalSample[];  // 首个反例附近的波形切片
  blueprint?: AgentBlueprint;
}

export interface AgentActionOptions {
  signal?: AbortSignal;
  model?: string;
  runId?: string;              // V3 可选：按次计费去重 ID
  boardProfile?: BoardProfile; // V3 可选：当前启用板卡配置
  locale?: 'zh' | 'en';        // 可选：界面语言
}

export interface AgentRuntime {
  presets: PresetProject[];        // 零 Token 预置案例，离线可用
  runHarness(prompt: string, options: HarnessRunOptions): Promise<HarnessResult>;
  diagnose(input: DiagnoseInput, options?: AgentActionOptions): Promise<DiagnosisResponse>;
  injectBug(code: string, options?: AgentActionOptions): Promise<BugClinicCase>;
}

export interface AgentRuntimeDeps {
  llm: LLMClient;
  engine: RtlEngine;
  research?: WebResearchClient;    // 可选：云端/浏览器联网检索与网页读取能力
}

// src/agent/index.ts 必须导出：export const createAgentRuntime: AgentRuntimeFactory
export type AgentRuntimeFactory = (deps: AgentRuntimeDeps) => AgentRuntime;
