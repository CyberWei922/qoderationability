// 队友 2：AI 智能体的提示词、严格 JSON Schema 与鲁棒解析。
// 只依赖冻结契约 src/types/contracts.ts，不依赖 React / LLMClient 具体实现。
import type {
  AgentBlueprint,
  BugClinicCase,
  ChatMessage,
  DiagnoseInput,
  DiagnosisResponse,
  HarnessPreviousContext,
  LLMCallOptions,
  LintIssue,
  PinMapping,
  SelfTestResult,
  SignalSample,
  TestVectorStep,
} from '../types/contracts';
import { LLMError } from '../types/contracts';

type AgentAction = LLMCallOptions['action'];

// ============================================================
// 公共规范：板卡接口、自测向量语义、可综合 Verilog 子集
// 与 docs/PROJECT_PLAN.md 2.2 / 2.3 保持一致，改动需全体同步。
// ============================================================

export const BOARD_PORT_SPEC = `虚拟 FPGA 开发板顶层接口（模块名必须为 top，端口名/方向/位宽必须逐字一致）：
module top (
    input         clk,      // 板载时钟，每个上升沿前进一拍
    input         rst_n,    // 低有效复位：0=复位，1=正常工作
    input  [3:0]  key,      // bit0=KEY0(上/W) ... bit3=KEY3(右/D)，按下为 1，松开为 0
    input  [7:0]  sw,       // 8 个拨码开关，bit0=SW0 ... bit7=SW7
    output [7:0]  led,      // bit0=LED0 ... bit7=LED7
    output [2:0]  traffic,  // bit2=红灯，bit1=黄灯，bit0=绿灯
    output [15:0] seg       // 4 个 4 位数字，高位组在左边
);
可选扩展外设端口（仅当需求涉及蜂鸣器或 16×8 屏幕时追加声明，普通电路不要画蛇添足）：
- 蜂鸣器：output [3:0] tone（0=静音，1..15=音阶/提示音）
- 16×8 屏幕（启用屏幕时必须完整声明前 4 个端口）：
  output [3:0] screen_x,    // 列 0..15
  output [2:0] screen_y,    // 行 0..7
  output [7:0] screen_data, // 0x00=空，0x20..0x7E=ASCII，0x80=实心块 0x81=空心框 0x82=圆球 0x83=蛇头 0x84=蛇身 0x85=食物 0x86=砖块 0x87=挡板 0x88=障碍 0x89=飞船 0x8A=爱心 0x8B=星星 0x8C..0x8F=上下左右箭头 0x90..0x94=网格/半高块 0xA1..0xAF=2×2实心4×4子块(低4位TL/TR/BL/BR)
  output [1:0] screen_cmd,  // 2'b00=保持，2'b01=写入(x,y)，2'b10=清屏，2'b11=清屏并写入
  output [7:0] screen_color // （可选）256 色调色板索引：0=默认单色荧光，1红 2琥珀 3青 4品红 5白 6蓝 7紫 8绿 9橙 10蒂芙尼 11粉 12黄 13天蓝 14灰 15暗绿，16..231=6×6×6 RGB色立方(16+36*r+6*g+b，r/g/b∈0..5)，232..255=灰阶`;

export const TEST_VECTOR_SPEC = `自测向量 TestVectorStep 规则：
- cycle 必须等于数组下标（从 0 开始），每个向量执行一个时钟上升沿；
- 时序电路的第一个向量必须 rst_n=0 完成复位，其后 rst_n=1；
- inputs 必须同时给出 rst_n(0/1)、key(0..15)、sw(0..255)；
- expect 只填写需要检查的字段（led / traffic / seg），值为十进制整数；
- traffic 编码：4=红灯(3'b100)，2=黄灯(3'b010)，1=绿灯(3'b001)，0=全灭；
- seg 编码：16 位整数，每 4 位一组代表一个数字，最高 4 位在显示器最左边；
- 至少 6 拍，必须覆盖：复位、正常流转、至少一个按键交互；
- expect 宁可少而准，不要写无法验证或不稳定的字段。`;

export const VERILOG_SUBSET_SPEC = `只允许可综合 Verilog 教学子集：
- module 声明与 input/output；wire/reg（可带 [hi:lo] 位宽）；parameter/localparam；
- assign 连续赋值；
- always @(*) 或 always_comb 组合块：必须全部使用阻塞赋值 =，每个分支都要给块内所有输出赋值，禁止推断 latch；
- always @(posedge clk) 或 always @(posedge clk or negedge rst_n) 时序块：必须全部使用非阻塞赋值 <=，所有寄存器都要在复位分支中赋确定值；
- 语句：if / else if / else、case / default、静态界限 for 循环（循环次数 <= 256）以及 1D/2D reg 数组（如 reg [7:0] mem [0:15]）；
- 运算符：算术 + - *；按位 & | ^ ~；逻辑 && || !；比较 == != < <= > >=；移位 << >> >>>；三目 ? :；位拼接 {} 与位切片 sig[hi:lo]；
- 字面量：4'b1010、8'hFF、3'd5、十进制整数；
- 禁止：initial、forever、#延迟、task/function、while、除法/取模、generate、include、宏定义、模块实例化；
- 需要十进制进位时用 BCD 计数（每位 0..9 单独寄存），不要用除法/取模。`;

const JSON_ONLY = '只输出一个 JSON 对象，不要输出 Markdown 代码围栏、注释或额外解释。JSON 字符串内的 Verilog 代码用 \\n 换行。';

// ============================================================
// 各动作的 System Prompt
// ============================================================

export const ACTION_SYSTEM_PROMPTS: Record<AgentAction, string> = {
  plan: `你是 VibeFPGA Lab 的硬件规划智能体，负责把中文电路需求拆解为可验证的设计蓝图与自测向量。

${BOARD_PORT_SPEC}

${TEST_VECTOR_SPEC}

输出 JSON Schema（字段必须齐全）：
${'```'}json
${'{'}
  "blueprint": {
    "title": "电路名称（中文）",
    "summary": "一句话电路说明（中文）",
    "behaviors": ["编号的行为要点，每条都可被自测验证"],
    "pinMappings": [{ "port": "如 key[0]", "role": "中文功能说明" }],
    "mermaidFsm": "stateDiagram-v2\\n    [*] --> IDLE\\n    IDLE --> RUN: KEY0"
  },
  "testVectors": [
    { "cycle": 0, "inputs": { "rst_n": 0, "key": 0, "sw": 0 }, "expect": { "led": 0 }, "note": "复位后所有输出清零" }
  ]
}
${'```'}

${JSON_ONLY}
额外要求：
- 蓝图必须与虚拟板卡接口一致，不要发明新端口或新外设；
- 时序逻辑至少包含一个状态或计数器，并在蓝图行为中写清复位值；
- testVectors 的 expect 只使用 led/traffic/seg 三个字段；
- 若提供已有电路与多轮修改上下文，必须在保留既有行为与已通过断言的前提下增量演进，不要推翻重写。`,
  generate: `你是 VibeFPGA Lab 的 Verilog 生成智能体，负责根据设计蓝图和自测向量写出可综合代码。

${BOARD_PORT_SPEC}

${VERILOG_SUBSET_SPEC}

输出 JSON Schema：
{"code": "完整 Verilog 源码（含 module top ... endmodule）"}

${JSON_ONLY}
额外要求：
- 代码必须逐字使用上面的顶层端口声明，模块名必须是 top；
- 必须满足给定 testVectors 的每一拍 expect（自测会在浏览器内执行）；
- 代码保持精简可读（一般 30-80 行），关键寄存器命名使用英文小写下划线；
- 不要引用未定义的信号，不要留下悬空输出；
- 若提供上一版代码，请在其基础上做最小改动；若提供联网参考资料，只采纳与可综合教学子集兼容的要点。`,
  repair: `你是 VibeFPGA Lab 的 Verilog 修复智能体。你会收到当前代码、Lint 告警或仿真首个反例波形，请做最小改动修复问题。

${BOARD_PORT_SPEC}

${VERILOG_SUBSET_SPEC}

修复原则：
- 优先解决 Lint 告警和首个反例，不要重写整体架构；
- 不要破坏已经通过的自测周期（无回退）；
- 输出 JSON Schema：{"code": "修复后的完整 Verilog 源码", "explanation": "一句话说明改了什么、为什么"}
- 保持顶层端口与模块名不变，行号尽量稳定。

${JSON_ONLY}`,
  diagnose: `你是 VibeFPGA Lab 的硬件助教，负责用苏格拉底式三档提示引导学生排查问题，不要直接抛出答案。

你会收到：当前 Verilog 代码、Lint 告警、仿真首个反例（周期/信号/期望/实际）、反例附近的波形切片、可选蓝图。

输出 JSON Schema：
{
  "level1Hint": "第 1 档：只给方向性线索，用提问引导学生自己观察，不要给答案",
  "level2Cause": "第 2 档：明确指出错因，引用具体行号或波形拍号",
  "level3PatchCode": "第 3 档：可直接上板的完整修复代码（必须包含 module top ... endmodule）",
  "highlightLine": 12,
  "highlightCycle": 3
}
${JSON_ONLY}

${VERILOG_SUBSET_SPEC}`,
  inject_bug: `你是 VibeFPGA Lab 的故障注入智能体，负责向正常电路注入一个隐蔽、可复现、只影响部分行为的真实硬件 Bug。

从下列真实踩坑类型中选择一种：
- 时序块混用阻塞赋值 =；
- 组合块混用非阻塞赋值 <=，或 if/case 缺分支导致推断锁存器；
- 寄存器忘记复位；
- 位宽不足导致截断；
- 同一信号多驱动；
- 无符号数使用 >>>；
- 状态机转移条件写错（漏检/多检）；
- BCD 进位链缺失；
- 检测标志只置位不清零。

输出 JSON Schema（id 可省略，由调用方生成）：
{
  "title": "隐蔽故障：一句话描述",
  "pitfallTag": "英文短标签，如 blocking-in-sequential",
  "symptom": "学生在板卡上能观察到的异常现象（中文）",
  "buggyCode": "注入故障后的完整 Verilog 代码",
  "diagnosis": {
    "level1Hint": "第 1 档线索",
    "level2Cause": "第 2 档错因，引用行号",
    "level3PatchCode": "修复后的完整代码（通常是原始正确代码）",
    "highlightLine": 10
  }
}

${JSON_ONLY}
额外要求：buggyCode 只改一处关键逻辑，保证其余端口与结构不变；symptom 必须能被波形或板卡观察到。`,
};

// ============================================================
// 各动作的 User Message 构造
// ============================================================

const EN_OUTPUT_DIRECTIVE =
  '\n\nLANGUAGE REQUIREMENT: The user interface is currently set to English. Write ALL human-readable JSON fields (blueprint.title, blueprint.summary, blueprint.behaviors, blueprint.pinMappings[].role, testVectors[].note, explanation, and FSM transition labels) in clear, natural English. Keep Verilog code, module name "top", and standard port names unchanged.';

function systemPromptFor(action: AgentAction, locale?: 'zh' | 'en'): string {
  const base = ACTION_SYSTEM_PROMPTS[action];
  return locale === 'en' ? `${base}${EN_OUTPUT_DIRECTIVE}` : base;
}

export const DEFAULT_CLOCK_INTERVAL_MS = 100;

export function formatClockTimingNote(clockIntervalMs: number = DEFAULT_CLOCK_INTERVAL_MS): string {
  const ms =
    Number.isFinite(clockIntervalMs) && clockIntervalMs > 0
      ? Math.round(clockIntervalMs)
      : DEFAULT_CLOCK_INTERVAL_MS;
  const cyclesPerSec = Number((1000 / ms).toFixed(2));
  const modeLabel = ms >= 500 ? '慢动作档' : '实时默认档';
  return `当前仿真时钟档位：${modeLabel}，每个时钟上升沿（1 拍）= ${ms}ms（约 ${cyclesPerSec} Hz，即 ${cyclesPerSec} 拍 = 1 秒）。
- 仅当用户需求涉及现实时间（如“每秒跳一次”“1 秒倒计时”“秒表”“每隔 N 秒切换”）时，请按每拍 ${ms}ms 换算分频或显示精度（例如 100ms/拍时 10 拍 = 1 秒、秒表个位可代表 0.1 秒；500ms/拍时 2 拍 = 1 秒），并确保自测向量的周期数与分频逻辑严格一致。
- 若用户需求未涉及现实时间（或已直接按“拍”描述节奏），无需强行增加时间分频，按逻辑拍数实现即可。`;
}

export interface PlanMessageOptions {
  previousContext?: HarnessPreviousContext;
  researchNotes?: string;
  clockIntervalMs?: number;
  locale?: 'zh' | 'en';
}

export function buildPlanMessages(prompt: string, options: PlanMessageOptions = {}): ChatMessage[] {
  const blocks: string[] = [formatClockTimingNote(options.clockIntervalMs)];
  const context = options.previousContext;
  if (context) {
    const history = (context.history ?? []).slice(-8);
    blocks.push(
      `多轮修改上下文（保留既有行为与已通过断言，只做增量演进）：\n${JSON.stringify(
        {
          blueprint: context.blueprint,
          verilogCode: context.verilogCode,
          testVectors: context.testVectors,
          history,
        },
        null,
        2,
      )}`,
    );
  }
  if (options.researchNotes) blocks.push(options.researchNotes);
  const extra = blocks.length > 0 ? `\n\n${blocks.join('\n\n')}` : '';
  return [
    { role: 'system', content: systemPromptFor('plan', options.locale) },
    {
      role: 'user',
      content: `硬件需求：\n${prompt.trim()}${extra}\n\n请按 Schema 输出严格 JSON（不要 Markdown 代码围栏）。`,
    },
  ];
}

export interface GenerateMessageExtras {
  previousCode?: string;
  researchNotes?: string;
  clockIntervalMs?: number;
  locale?: 'zh' | 'en';
}

export function buildGenerateMessages(
  blueprint: AgentBlueprint,
  testVectors: TestVectorStep[],
  extras: GenerateMessageExtras = {},
): ChatMessage[] {
  const blocks: string[] = [formatClockTimingNote(extras.clockIntervalMs)];
  if (extras.previousCode) {
    blocks.push(`上一版可运行代码（在其基础上增量修改）：\n\`\`\`verilog\n${extras.previousCode}\n\`\`\``);
  }
  if (extras.researchNotes) blocks.push(extras.researchNotes);
  const extra = blocks.length > 0 ? `\n\n${blocks.join('\n\n')}` : '';
  return [
    { role: 'system', content: systemPromptFor('generate', extras.locale) },
    {
      role: 'user',
      content: `设计蓝图与自测向量：\n${JSON.stringify({ blueprint, testVectors }, null, 2)}${extra}\n\n请输出 {"code": "..."}。`,
    },
  ];
}

export interface RepairContext {
  code: string;
  issues: LintIssue[];
  selfTest?: SelfTestResult;
  blueprint: AgentBlueprint;
  testVectors: TestVectorStep[];
  waveformSlice?: SignalSample[];
  researchNotes?: string;
  clockIntervalMs?: number;
  locale?: 'zh' | 'en';
}

export function buildRepairMessages(ctx: RepairContext): ChatMessage[] {
  const { selfTest } = ctx;
  const payload = {
    clockTimingNote: formatClockTimingNote(ctx.clockIntervalMs),
    blueprint: ctx.blueprint,
    testVectors: ctx.testVectors,
    currentCode: ctx.code,
    lintIssues: ctx.issues,
    selfTest: selfTest
      ? {
          passed: selfTest.passed,
          passedChecks: selfTest.passedChecks,
          totalChecks: selfTest.totalChecks,
          firstFailure: selfTest.firstFailure,
          firstUnstableCycle: selfTest.firstUnstableCycle,
          passedCycles: selfTest.passedCycles,
          regressedCycles: selfTest.regressedCycles,
        }
      : undefined,
    failureWaveform: ctx.waveformSlice,
    researchNotes: ctx.researchNotes,
  };
  return [
    { role: 'system', content: systemPromptFor('repair', ctx.locale) },
    {
      role: 'user',
      content: `请修复下面的电路：\n${JSON.stringify(payload, null, 2)}\n\n请输出 {"code": "...", "explanation": "..."}。`,
    },
  ];
}

export function buildDiagnoseMessages(input: DiagnoseInput): ChatMessage[] {
  return [
    { role: 'system', content: ACTION_SYSTEM_PROMPTS.diagnose },
    {
      role: 'user',
      content: `请按三档苏格拉底提示诊断：\n${JSON.stringify(input, null, 2)}`,
    },
  ];
}

export function buildInjectBugMessages(code: string): ChatMessage[] {
  return [
    { role: 'system', content: ACTION_SYSTEM_PROMPTS.inject_bug },
    {
      role: 'user',
      content: `原始正常代码：\n${code}\n\n请注入一个隐蔽故障并按 Schema 输出 JSON。`,
    },
  ];
}

// ============================================================
// 鲁棒 JSON 解析与结构校验
// ============================================================

function badResponse(message: string, raw?: string): LLMError {
  const snippet = raw && raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  return new LLMError('BAD_RESPONSE', snippet ? `${message}（原始输出片段：${snippet}）` : message);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter((v): v is string => v !== undefined) : [];
}

/** 剥离推理模型（DeepSeek-R1 等）输出的  thinking... 思考段。 */
export function stripReasoning(text: string): string {
  return text
    .replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '')
    .replace(/<\s*think\s*>[\s\S]*$/i, '')
    .replace(/<\s*\/?\s*think\s*>/gi, '')
    .trim();
}

/**
 * 兼容三种模型输出：纯 JSON、```json 围栏、前后夹带解释文字的 JSON。
 */
export function extractJson(text: string): unknown {
  const trimmed = stripReasoning(text);
  const attempts: string[] = [trimmed];
  for (const match of trimmed.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    attempts.push(match[1].trim());
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(trimmed.slice(first, last + 1));
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // 尝试下一种候选
    }
  }
  throw badResponse('模型输出不是合法 JSON，无法解析', trimmed);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 非数字的期望值直接忽略，避免把 "1"、true 之类的字段静默折算成 0 造成假断言。 */
function clampOptional(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function ensureMermaid(code: string | undefined): string {
  const body = (code ?? '')
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  if (!body) return 'stateDiagram-v2\n    [*] --> IDLE';
  return body.startsWith('stateDiagram-v2') ? body : `stateDiagram-v2\n${body}`;
}

function normalizePinMappings(value: unknown): PinMapping[] {
  if (!Array.isArray(value)) return [];
  const pins: PinMapping[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const port = asString(record?.port);
    if (!port) continue;
    pins.push({ port, role: asString(record?.role) ?? '未说明' });
  }
  return pins;
}

export function normalizeBlueprint(value: unknown): AgentBlueprint {
  const record = asRecord(value);
  if (!record) throw badResponse('蓝图字段缺失或不是对象');
  const blueprint: AgentBlueprint = {
    title: asString(record.title) ?? '未命名电路',
    summary: asString(record.summary) ?? '',
    behaviors: asStringList(record.behaviors),
    pinMappings: normalizePinMappings(record.pinMappings),
    mermaidFsm: ensureMermaid(asString(record.mermaidFsm)),
  };
  if (blueprint.behaviors.length === 0) throw badResponse('蓝图缺少 behaviors 行为要点');
  return blueprint;
}

export function normalizeTestVectors(value: unknown): TestVectorStep[] {
  if (!Array.isArray(value) || value.length === 0) throw badResponse('缺少 testVectors 自测向量');
  const vectors: TestVectorStep[] = value.map((item, index) => {
    const record = asRecord(item) ?? {};
    const inputs = asRecord(record.inputs) ?? {};
    const expectRaw = asRecord(record.expect);
    const expect: Partial<{ led: number; traffic: number; seg: number }> = {};
    if (expectRaw) {
      const led = clampOptional(expectRaw.led, 0, 0xff);
      const traffic = clampOptional(expectRaw.traffic, 0, 0b111);
      const seg = clampOptional(expectRaw.seg, 0, 0xffff);
      if (led !== undefined) expect.led = led;
      if (traffic !== undefined) expect.traffic = traffic;
      if (seg !== undefined) expect.seg = seg;
    }
    const note = asString(record.note);
    return {
      cycle: index,
      inputs: {
        rst_n: index === 0 ? 0 : inputs.rst_n === 0 ? 0 : 1,
        key: clampInt(inputs.key, 0, 0, 0b1111),
        sw: clampInt(inputs.sw, 0, 0, 0xff),
      },
      expect: Object.keys(expect).length > 0 ? expect : undefined,
      note,
    };
  });
  if (!vectors.some((v) => v.expect)) throw badResponse('自测向量没有任何 expect 断言');
  return vectors;
}

export interface PlanResponse {
  blueprint: AgentBlueprint;
  testVectors: TestVectorStep[];
}

export function parsePlanResponse(text: string): PlanResponse {
  const parsed = extractJson(text);
  const record = asRecord(parsed);
  if (!record) throw badResponse('规划结果不是 JSON 对象', text);
  const blueprintRaw = record.blueprint ?? (record.title || record.behaviors ? record : undefined);
  if (!blueprintRaw) throw badResponse('规划结果缺少 blueprint 字段', text);
  const vectorsRaw = record.testVectors ?? record.vectors;
  if (!vectorsRaw) throw badResponse('规划结果缺少 testVectors 字段', text);
  return {
    blueprint: normalizeBlueprint(blueprintRaw),
    testVectors: normalizeTestVectors(vectorsRaw),
  };
}

function stripCodeFences(text: string): string {
  const clean = stripReasoning(text);
  const fenced = [...clean.matchAll(/```(?:verilog|v|systemverilog|sv)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim());
  const candidate = fenced.find((block) => /module\s+/i.test(block)) ?? fenced[0];
  if (candidate) return candidate;
  return clean
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

export interface CodeResponse {
  code: string;
  explanation?: string;
}

export function parseCodeResponse(text: string): CodeResponse {
  let code: string | undefined;
  let explanation: string | undefined;
  try {
    const record = asRecord(extractJson(text));
    code = asString(record?.code) ?? asString(record?.verilog) ?? asString(record?.verilogCode);
    explanation = asString(record?.explanation);
  } catch {
    // 某些模型忽略 jsonMode 直接返回 Verilog 源码，走下面的纯文本兜底
  }
  code = stripCodeFences(code ?? text);
  if (!/module\s+\w+/.test(code)) throw badResponse('模型没有返回包含 module 声明的 Verilog 代码', text);
  return { code, explanation };
}

export function parseDiagnosisResponse(text: string): DiagnosisResponse {
  const record = asRecord(extractJson(text));
  if (!record) throw badResponse('诊断结果不是 JSON 对象', text);
  const level1Hint = asString(record.level1Hint);
  const level2Cause = asString(record.level2Cause);
  const level3PatchCode = asString(record.level3PatchCode);
  if (!level1Hint || !level2Cause || !level3PatchCode) {
    throw badResponse('诊断结果缺少 level1Hint / level2Cause / level3PatchCode', text);
  }
  const highlightLine = typeof record.highlightLine === 'number' ? Math.trunc(record.highlightLine) : undefined;
  const highlightCycle = typeof record.highlightCycle === 'number' ? Math.trunc(record.highlightCycle) : undefined;
  return {
    level1Hint,
    level2Cause,
    level3PatchCode: stripCodeFences(level3PatchCode),
    highlightLine,
    highlightCycle,
  };
}

export function parseBugCaseResponse(text: string, fallbackFixedCode: string): BugClinicCase {
  const record = asRecord(extractJson(text));
  if (!record) throw badResponse('故障注入结果不是 JSON 对象', text);
  const title = asString(record.title);
  const pitfallTag = asString(record.pitfallTag);
  const symptom = asString(record.symptom);
  const buggyCode = asString(record.buggyCode);
  if (!title || !pitfallTag || !symptom || !buggyCode) {
    throw badResponse('故障注入结果缺少 title / pitfallTag / symptom / buggyCode', text);
  }
  const diagnosisRecord = asRecord(record.diagnosis);
  const diagnosis: DiagnosisResponse = {
    level1Hint: asString(diagnosisRecord?.level1Hint) ?? '先比较正常与异常波形，哪一拍开始出现分歧？',
    level2Cause: asString(diagnosisRecord?.level2Cause) ?? '注入的故障改变了关键寄存器的更新语义。',
    level3PatchCode:
      asString(diagnosisRecord?.level3PatchCode) !== undefined
        ? stripCodeFences(String(diagnosisRecord?.level3PatchCode))
        : fallbackFixedCode,
    highlightLine:
      typeof diagnosisRecord?.highlightLine === 'number' ? Math.trunc(diagnosisRecord.highlightLine as number) : undefined,
    highlightCycle:
      typeof diagnosisRecord?.highlightCycle === 'number'
        ? Math.trunc(diagnosisRecord.highlightCycle as number)
        : undefined,
  };
  return {
    id: asString(record.id) ?? `bug-${Date.now()}`,
    title,
    pitfallTag,
    symptom,
    buggyCode: stripCodeFences(buggyCode),
    diagnosis,
  };
}