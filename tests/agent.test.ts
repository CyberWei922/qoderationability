// 队友 2：AgentRuntime 单元测试。全部使用 Mock LLM 与 RtlEngine 替身，不依赖队友 1 的真实引擎。
import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from '../src/agent';
import { createRtlEngine } from '../src/engine';
import {
  ACTION_SYSTEM_PROMPTS,
  buildGenerateMessages,
  buildPlanMessages,
  buildRepairMessages,
  parseCodeResponse,
  parseDiagnosisResponse,
  parsePlanResponse,
} from '../src/agent/prompts';
import { LLMError } from '../src/types/contracts';
import type {
  HarnessTraceEvent,
  LLMCallOptions,
  LLMClient,
  LintIssue,
  RtlEngine,
  SelfTestResult,
  SignalSample,
  TestVectorStep,
  WebPageContent,
  WebReference,
  WebResearchClient,
} from '../src/types/contracts';

// ============================================================
// 测试替身
// ============================================================

type Action = LLMCallOptions['action'];

type LLMReply = string | { text: string; model?: string; remainingQuota?: number };

function createStubLLM(handlers: Partial<Record<Action, (options: LLMCallOptions) => LLMReply | Promise<LLMReply>>>) {
  const calls: LLMCallOptions[] = [];
  const llm: LLMClient = {
    async chat(options: LLMCallOptions) {
      calls.push(options);
      const handler = handlers[options.action];
      if (!handler) throw new Error(`测试未提供 ${options.action} 的响应`);
      const reply = await handler(options);
      return typeof reply === 'string' ? { text: reply } : reply;
    },
  };
  return { llm, calls };
}

function createStubResearch(config: {
  results?: WebReference[];
  page?: WebPageContent;
  searchError?: Error;
  fetchError?: Error;
} = {}) {
  const searchCalls: Array<{ query: string; limit?: number }> = [];
  const fetchCalls: string[] = [];
  const research: WebResearchClient = {
    async search(query, options) {
      searchCalls.push({ query, limit: options?.limit });
      if (config.searchError) throw config.searchError;
      return config.results ?? [];
    },
  };
  if (config.page || config.fetchError) {
    research.fetchPage = async (url) => {
      fetchCalls.push(url);
      if (config.fetchError) throw config.fetchError;
      return config.page as WebPageContent;
    };
  }
  return { research, searchCalls, fetchCalls };
}

interface EngineScript {
  compileOk?: (code: string) => boolean;
  issues?: (code: string) => LintIssue[];
  selfTest?: (code: string, vectors: TestVectorStep[], previous?: number[]) => Partial<SelfTestResult>;
}

function createStubEngine(script: EngineScript): RtlEngine {
  return {
    compile(code: string) {
      const issues = script.issues?.(code) ?? [];
      const ok = script.compileOk ? script.compileOk(code) : true;
      return { ok, issues };
    },
    reset() {
      // 测试替身无需复位
    },
    step() {
      throw new Error('测试引擎不负责单步仿真');
    },
    runSelfTest(code, vectors, previousPassedCycles) {
      const expectCount = vectors.filter((v) => v.expect).length;
      const partial = script.selfTest?.(code, vectors, previousPassedCycles) ?? { passed: true };
      const passedCycles =
        partial.passedCycles ?? (partial.passed ? vectors.filter((v) => v.expect).map((v) => v.cycle) : []);
      return {
        passed: partial.passed ?? false,
        totalChecks: partial.totalChecks ?? expectCount,
        passedChecks: partial.passedChecks ?? (partial.passed ? expectCount : 0),
        firstFailure: partial.firstFailure,
        firstUnstableCycle: partial.firstUnstableCycle,
        passedCycles,
        regressedCycles: partial.regressedCycles ?? [],
        waveform: partial.waveform ?? [],
      };
    },
  };
}

// ============================================================
// 固定数据
// ============================================================

const BLUEPRINT = {
  title: '测试电路',
  summary: '用于单元测试的蓝图',
  behaviors: ['复位后输出清零', '按下 KEY0 后 LED0 点亮'],
  pinMappings: [{ port: 'key[0]', role: '测试按键' }],
  mermaidFsm: 'stateDiagram-v2\n    [*] --> IDLE\n    IDLE --> RUN: KEY0',
};

const VECTORS: TestVectorStep[] = [
  { cycle: 0, inputs: { rst_n: 0, key: 0, sw: 0 }, expect: { led: 0 }, note: '复位' },
  { cycle: 1, inputs: { rst_n: 1, key: 1, sw: 0 }, expect: { led: 1 }, note: '按键' },
];

const PLAN_JSON = JSON.stringify({ blueprint: BLUEPRINT, testVectors: VECTORS });
const PLAN_FENCED = `好的，规划如下：\n\`\`\`json\n${PLAN_JSON}\n\`\`\``;

const CODE_A = 'module top();\n  // candidate A\nendmodule';
const CODE_B = 'module top();\n  // candidate B\nendmodule';
const CODE_BAD_1 = 'module top();\n  // BAD1\nendmodule';
const CODE_BAD_2 = 'module top();\n  // BAD2\nendmodule';
const CODE_BAD_3 = 'module top();\n  // BAD3\nendmodule';
const badCode = (code: string) => /BAD/.test(code);

const LINT_ERROR: LintIssue = {
  code: 'SEQ_BLOCKING_ASSIGN',
  severity: 'error',
  line: 12,
  message: '时序块使用了阻塞赋值',
  hint: '改为非阻塞赋值 <=',
};

function sample(cycle: number): SignalSample {
  return {
    cycle,
    inputs: { rst_n: 1, key: 0, sw: 0 },
    outputs: { led: 0, traffic: 0, seg: 0 },
    internals: {},
  };
}

function failingSelfTest(failureCycle: number, passedCycles: number[], regressedCycles: number[] = []) {
  return {
    passed: false,
    totalChecks: 2,
    passedChecks: passedCycles.length,
    passedCycles,
    regressedCycles,
    firstFailure: { cycle: failureCycle, signal: 'led' as const, expected: 1, actual: 0 },
    waveform: Array.from({ length: 12 }, (_, index) => sample(index)),
  };
}

function expectBadResponse(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LLMError);
    expect((error as LLMError).code).toBe('BAD_RESPONSE');
    return;
  }
  throw new Error('预期抛出 LLMError(BAD_RESPONSE)，但没有抛出');
}

// ============================================================
// 预置案例
// ============================================================

describe('预置案例', () => {
  const runtime = createAgentRuntime({ llm: createStubLLM({}).llm, engine: createStubEngine({}) });

  it('提供 7 个零 Token 案例，字段完整且互不重复', () => {
    expect(runtime.presets).toHaveLength(7);
    expect(new Set(runtime.presets.map((p) => p.id)).size).toBe(7);
    expect(runtime.presets.some((p) => p.id === 'password-lock')).toBe(false);
    expect(runtime.presets.some((p) => p.id === 'tetris')).toBe(true);
    expect(runtime.presets.some((p) => p.id === 'rgb-cube')).toBe(true);
    for (const preset of runtime.presets) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.prompt.length).toBeGreaterThan(0);
      expect(preset.verilogCode).toMatch(/module\s+top\b/);
      expect(preset.blueprint.mermaidFsm).toMatch(/^stateDiagram-v2/);
      expect(preset.blueprint.behaviors.length).toBeGreaterThan(0);
      expect(preset.blueprint.pinMappings.length).toBeGreaterThan(0);
      expect(preset.testVectors.length).toBeGreaterThanOrEqual(6);
      preset.testVectors.forEach((vector, index) => {
        expect(vector.cycle).toBe(index);
        expect([0, 1]).toContain(vector.inputs.rst_n);
        expect(vector.inputs.key).toBeGreaterThanOrEqual(0);
        expect(vector.inputs.key).toBeLessThanOrEqual(15);
        expect(vector.inputs.sw).toBeGreaterThanOrEqual(0);
        expect(vector.inputs.sw).toBeLessThanOrEqual(255);
      });
      expect(preset.testVectors[0].inputs.rst_n).toBe(0);
    }
  });

  it('每个案例都有 1-2 个故障关卡，修复代码等于标准代码', () => {
    const allBugs = runtime.presets.flatMap((p) => p.bugs);
    expect(allBugs.length).toBeGreaterThanOrEqual(6);
    expect(allBugs.length).toBeLessThanOrEqual(10);
    expect(new Set(allBugs.map((b) => b.id)).size).toBe(allBugs.length);
    for (const preset of runtime.presets) {
      expect(preset.bugs.length).toBeGreaterThanOrEqual(1);
      for (const bug of preset.bugs) {
        expect(bug.title.length).toBeGreaterThan(0);
        expect(bug.pitfallTag.length).toBeGreaterThan(0);
        expect(bug.symptom.length).toBeGreaterThan(0);
        expect(bug.buggyCode).toMatch(/module\s+top\b/);
        expect(bug.buggyCode).not.toBe(preset.verilogCode);
        expect(bug.diagnosis.level1Hint.length).toBeGreaterThan(0);
        expect(bug.diagnosis.level2Cause.length).toBeGreaterThan(0);
        expect(bug.diagnosis.level3PatchCode).toMatch(/module\s+top\b/);
        if (bug.diagnosis.highlightLine !== undefined) {
          expect(bug.diagnosis.highlightLine).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

// ============================================================
// JSON 解析与容错
// ============================================================

describe('提示词与 JSON 解析', () => {
  it('五个动作都有 System Prompt', () => {
    expect(Object.keys(ACTION_SYSTEM_PROMPTS).sort()).toEqual([
      'diagnose',
      'generate',
      'inject_bug',
      'plan',
      'repair',
    ]);
  });

  it('plan / generate 提示词包含板卡接口与 Verilog 子集约束', () => {
    const planMessages = buildPlanMessages('做个交通灯');
    expect(planMessages[0].content).toContain('testVectors');
    expect(planMessages[0].content).toContain('module top');
    expect(planMessages[1].content).toContain('做个交通灯');
    expect(planMessages[1].content).toContain('100ms');
    expect(planMessages[1].content).toContain('10 Hz');
    expect(planMessages[1].content).toContain('未涉及现实时间');

    const generateMessages = buildGenerateMessages(BLUEPRINT, VECTORS);
    expect(generateMessages[0].content).toContain('非阻塞');
    expect(generateMessages[1].content).toContain('测试电路');
    expect(generateMessages[1].content).toContain('100ms');
  });

  it('时钟档位（100ms / 500ms）会透传到 plan / generate / repair 提示词', async () => {
    const slowPlan = buildPlanMessages('做一个每秒闪一次的灯', { clockIntervalMs: 500 });
    expect(slowPlan[1].content).toContain('500ms');
    expect(slowPlan[1].content).toContain('2 Hz');
    expect(slowPlan[1].content).toContain('慢动作档');

    const slowGen = buildGenerateMessages(BLUEPRINT, VECTORS, { clockIntervalMs: 500 });
    expect(slowGen[1].content).toContain('500ms');

    const slowRepair = buildRepairMessages({
      code: CODE_A,
      issues: [],
      blueprint: BLUEPRINT,
      testVectors: VECTORS,
      clockIntervalMs: 500,
    });
    expect(slowRepair[1].content).toContain('500ms');

    const { llm, calls } = createStubLLM({
      plan: () => JSON.stringify({ blueprint: BLUEPRINT, testVectors: VECTORS }),
      generate: () => JSON.stringify({ code: CODE_A }),
    });
    const runtime = createAgentRuntime({ llm, engine: createStubEngine({}) });
    await runtime.runHarness('做一个每秒闪一次的灯', {
      onTrace: () => {},
      clockIntervalMs: 500,
    });
    expect(calls[0].messages[1].content).toContain('500ms');
    expect(calls[1].messages[1].content).toContain('500ms');
  });

  it('解析带 Markdown 围栏和解释文字的规划 JSON', () => {
    const parsed = parsePlanResponse(PLAN_FENCED);
    expect(parsed.blueprint.title).toBe('测试电路');
    expect(parsed.testVectors).toHaveLength(2);
    expect(parsed.testVectors[1].cycle).toBe(1);
  });

  it('规划结果允许直接返回 blueprint 字段（无外层包装）', () => {
    const parsed = parsePlanResponse(JSON.stringify({ ...BLUEPRINT, testVectors: VECTORS }));
    expect(parsed.blueprint.behaviors).toHaveLength(2);
  });

  it('自测向量 cycle 归一化为数组下标，输入范围被裁剪', () => {
    const parsed = parsePlanResponse(
      JSON.stringify({
        blueprint: BLUEPRINT,
        testVectors: [
          { cycle: 99, inputs: { rst_n: 0, key: 99, sw: 300 }, expect: { led: 999 } },
          { cycle: 7, inputs: {}, expect: { traffic: 9 } },
        ],
      }),
    );
    expect(parsed.testVectors[0].cycle).toBe(0);
    expect(parsed.testVectors[0].inputs.key).toBe(15);
    expect(parsed.testVectors[0].inputs.sw).toBe(255);
    expect(parsed.testVectors[0].expect?.led).toBe(255);
    expect(parsed.testVectors[1].inputs.rst_n).toBe(1);
    expect(parsed.testVectors[1].expect?.traffic).toBe(7);
  });

  it('首拍强制复位，非数字 expect 被忽略而不是折算成 0', () => {
    const parsed = parsePlanResponse(
      JSON.stringify({
        blueprint: BLUEPRINT,
        testVectors: [
          { inputs: { rst_n: 1, key: 0, sw: 0 }, expect: { led: '1', traffic: 3 } },
          { inputs: { rst_n: 1 }, expect: { seg: 'abc' } },
        ],
      }),
    );
    expect(parsed.testVectors[0].inputs.rst_n).toBe(0);
    expect(parsed.testVectors[0].expect).toEqual({ traffic: 3 });
    expect(parsed.testVectors[1].expect).toBeUndefined();
  });

  it('生成结果可解析 JSON、围栏与纯 Verilog 文本', () => {
    expect(parseCodeResponse(JSON.stringify({ code: CODE_A })).code).toBe(CODE_A);
    expect(parseCodeResponse(`\`\`\`verilog\n${CODE_B}\n\`\`\``).code).toBe(CODE_B);
    expect(parseCodeResponse(CODE_BAD_1).code).toBe(CODE_BAD_1);
  });

  it('生成结果没有 module 声明时抛出 BAD_RESPONSE', () => {
    expectBadResponse(() => parseCodeResponse(JSON.stringify({ code: '这不是 Verilog' })));
  });

  it('规划输出无法解析时抛出 BAD_RESPONSE', () => {
    expectBadResponse(() => parsePlanResponse('抱歉，我无法完成这个需求。'));
  });

  it('诊断结果缺少三档字段时抛出 BAD_RESPONSE', () => {
    expectBadResponse(() => parseDiagnosisResponse(JSON.stringify({ level1Hint: '再看一眼' })));
  });

  it('repair 提示词携带首个反例与波形切片', () => {
    const messages = buildRepairMessages({
      code: CODE_A,
      issues: [LINT_ERROR],
      selfTest: failingSelfTest(1, [0]),
      blueprint: BLUEPRINT,
      testVectors: VECTORS,
    });
    expect(messages[1].content).toContain('"firstFailure"');
    expect(messages[1].content).toContain('"cycle": 1');
    expect(messages[1].content).toContain('candidate A');
  });

  it('repair 提示词携带组合逻辑未收敛周期', () => {
    const messages = buildRepairMessages({
      code: CODE_A,
      issues: [],
      selfTest: { ...failingSelfTest(1, [0]), firstUnstableCycle: 2 },
      blueprint: BLUEPRINT,
      testVectors: VECTORS,
    });
    expect(messages[1].content).toContain('"firstUnstableCycle": 2');
  });
});

// ============================================================
// Harness 闭环
// ============================================================

describe('Harness 闭环', () => {
  it('规划→生成→体检→自测一次通过，不触发修复', async () => {
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_FENCED,
      generate: () => JSON.stringify({ code: CODE_A }),
    });
    const engine = createStubEngine({ selfTest: () => ({ passed: true }) });
    const events: HarnessTraceEvent[] = [];

    const result = await createAgentRuntime({ llm, engine }).runHarness('做个 LED 测试电路', {
      onTrace: (event) => events.push(event),
    });

    expect(result.ok).toBe(true);
    expect(result.repairRounds).toBe(0);
    expect(result.verilogCode).toBe(CODE_A);
    expect(calls.map((call) => call.action)).toEqual(['plan', 'generate']);
    expect(calls.every((call) => call.jsonMode === true)).toBe(true);
    expect(result.blueprint.title).toBe('测试电路');
    expect(result.selfTest?.passed).toBe(true);

    const stages = events.map((event) => event.stage);
    expect(stages[0]).toBe('planning');
    expect(stages).toContain('coding');
    expect(stages).toContain('linting');
    expect(stages).toContain('simulating');
    expect(stages.at(-1)).toBe('done');
    for (const event of events) {
      expect(typeof event.title).toBe('string');
      expect(typeof event.detail).toBe('string');
      expect(typeof event.timestamp).toBe('number');
    }
  });

  it('Lint 失败后修复一轮并通过', async () => {
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_BAD_1 }),
      repair: () => JSON.stringify({ code: CODE_A, explanation: '改成了非阻塞赋值' }),
    });
    const engine = createStubEngine({ compileOk: (code) => !badCode(code), issues: () => [LINT_ERROR] });
    const events: HarnessTraceEvent[] = [];

    const result = await createAgentRuntime({ llm, engine }).runHarness('做个测试电路', {
      onTrace: (event) => events.push(event),
    });

    expect(result.ok).toBe(true);
    expect(result.repairRounds).toBe(1);
    expect(result.verilogCode).toBe(CODE_A);
    expect(calls.map((call) => call.action)).toEqual(['plan', 'generate', 'repair']);
    expect(calls[2].temperature).toBe(0.2);
    expect(events.some((event) => event.stage === 'repairing' && event.status === 'pass')).toBe(true);
  });

  it('连续失败时最多修复 2 轮，返回无回退的最佳候选', async () => {
    const repairs = [CODE_BAD_2, CODE_BAD_3];
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_BAD_1 }),
      repair: () => JSON.stringify({ code: repairs.shift() ?? CODE_BAD_3 }),
    });
    const engine = createStubEngine({ compileOk: (code) => !badCode(code), issues: () => [LINT_ERROR] });
    const events: HarnessTraceEvent[] = [];

    const result = await createAgentRuntime({ llm, engine }).runHarness('做个测试电路', {
      onTrace: (event) => events.push(event),
    });

    expect(result.ok).toBe(false);
    expect(result.repairRounds).toBe(2);
    expect(result.verilogCode).toBe(CODE_BAD_1);
    expect(result.issues).toHaveLength(1);
    expect(result.selfTest).toBeUndefined();
    expect(calls.filter((call) => call.action === 'repair')).toHaveLength(2);
    expect(events.at(-1)?.stage).toBe('failed');
  });

  it('无回退择优：保留先前通过周期更多的候选，并把 passedCycles 传给下一轮', async () => {
    const previousValues: (number[] | undefined)[] = [];
    const { llm } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_A }),
      repair: () => JSON.stringify({ code: CODE_B }),
    });
    const engine = createStubEngine({
      selfTest: (code, _vectors, previous) => {
        previousValues.push(previous);
        return code.includes('candidate A') ? failingSelfTest(1, [0]) : failingSelfTest(0, [1], [0]);
      },
    });

    const result = await createAgentRuntime({ llm, engine }).runHarness('做个测试电路', {
      onTrace: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.repairRounds).toBe(2);
    expect(result.verilogCode).toBe(CODE_A);
    expect(result.selfTest?.passedCycles).toEqual([0]);
    expect(previousValues[0]).toBeUndefined();
    expect(previousValues[1]).toEqual([0]);
    expect(previousValues[2]).toEqual([0]);
  });

  it('组合逻辑未收敛时按未收敛周期触发修复', async () => {
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_A }),
      repair: () => JSON.stringify({ code: CODE_B }),
    });
    const engine = createStubEngine({
      selfTest: (code) =>
        code.includes('candidate A')
          ? { passed: false, firstUnstableCycle: 2, waveform: Array.from({ length: 6 }, (_, index) => sample(index)) }
          : { passed: true },
    });
    const events: HarnessTraceEvent[] = [];

    const result = await createAgentRuntime({ llm, engine }).runHarness('做个测试电路', {
      onTrace: (event) => events.push(event),
    });

    expect(result.ok).toBe(true);
    expect(result.verilogCode).toBe(CODE_B);
    expect(calls.map((call) => call.action)).toEqual(['plan', 'generate', 'repair']);
    expect(calls[2].messages[1].content).toContain('"firstUnstableCycle": 2');
    expect(events).toContainEqual(
      expect.objectContaining({ stage: 'repairing', status: 'running', detail: expect.stringContaining('未收敛') }),
    );
  });

  it('代码类动作使用低温，诊断类允许较高温度', async () => {
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_A }),
      diagnose: () =>
        JSON.stringify({ level1Hint: '先看复位拍', level2Cause: '寄存器未复位', level3PatchCode: CODE_A }),
      inject_bug: () =>
        JSON.stringify({
          title: '隐蔽故障：测试',
          pitfallTag: 'test-pitfall',
          symptom: '输出异常',
          buggyCode: CODE_BAD_1,
          diagnosis: { level1Hint: '看这里', level2Cause: '因为这里', level3PatchCode: CODE_A },
        }),
    });
    const runtime = createAgentRuntime({ llm, engine: createStubEngine({}) });

    await runtime.runHarness('做个测试电路', { onTrace: () => {} });
    await runtime.diagnose({
      code: CODE_A,
      issues: [],
      failure: { cycle: 1, signal: 'led', expected: 1, actual: 0 },
    });
    await runtime.injectBug(CODE_A);

    const temps = Object.fromEntries(calls.map((call) => [call.action, call.temperature]));
    expect(temps).toMatchObject({ plan: 0.3, generate: 0.2, diagnose: 0.5, inject_bug: 0.5 });
  });

  it('修复额度耗尽时保留候选和反例供用户检查', async () => {
    const { llm } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_A }),
      repair: () => { throw new LLMError('QUOTA_EXCEEDED', '今日免费额度已用完'); },
    });
    const events: HarnessTraceEvent[] = [];
    const engine = createStubEngine({ selfTest: () => failingSelfTest(1, [0]) });
    const result = await createAgentRuntime({ llm, engine }).runHarness('做个测试电路', { onTrace: (event) => events.push(event) });

    expect(result).toMatchObject({ ok: false, verilogCode: CODE_A, selfTest: { firstFailure: { cycle: 1 } } });
    expect(events).toContainEqual(expect.objectContaining({ stage: 'repairing', status: 'fail', detail: '今日免费额度已用完' }));
  });

  it('开始前已取消：抛出 ABORTED 且不调用模型', async () => {
    const { llm, calls } = createStubLLM({});
    const controller = new AbortController();
    controller.abort();

    await expect(
      createAgentRuntime({ llm, engine: createStubEngine({}) }).runHarness('做个测试电路', {
        onTrace: () => {},
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(calls).toHaveLength(0);
  });

  it('规划阶段被取消：停止后续生成', async () => {
    const controller = new AbortController();
    const { llm, calls } = createStubLLM({
      plan: () => {
        controller.abort();
        return PLAN_JSON;
      },
    });

    await expect(
      createAgentRuntime({ llm, engine: createStubEngine({}) }).runHarness('做个测试电路', {
        onTrace: () => {},
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(calls.map((call) => call.action)).toEqual(['plan']);
  });
});

// ============================================================
// 教学诊断与故障注入
// ============================================================

describe('诊断与故障注入', () => {
  it('diagnose 解析三档苏格拉底提示', async () => {
    const { llm, calls } = createStubLLM({
      diagnose: () =>
        `\`\`\`json\n${JSON.stringify({
          level1Hint: '这个寄存器在复位时是什么值？',
          level2Cause: '第 12 行的时序块用了阻塞赋值。',
          level3PatchCode: CODE_A,
          highlightLine: 12,
          highlightCycle: 3,
        })}\n\`\`\``,
    });

    const diagnosis = await createAgentRuntime({ llm, engine: createStubEngine({}) }).diagnose({
      code: CODE_BAD_1,
      issues: [LINT_ERROR],
      failure: { cycle: 3, signal: 'led', expected: 1, actual: 0 },
    });

    expect(diagnosis.level1Hint).toContain('复位');
    expect(diagnosis.level3PatchCode).toBe(CODE_A);
    expect(diagnosis.highlightLine).toBe(12);
    expect(diagnosis.highlightCycle).toBe(3);
    expect(calls[0].action).toBe('diagnose');
    expect(calls[0].jsonMode).toBe(true);
  });

  it('injectBug 生成故障关卡，缺失的修复代码回退为原始代码', async () => {
    const { llm, calls } = createStubLLM({
      inject_bug: () =>
        JSON.stringify({
          title: '隐蔽故障：时序块混用阻塞赋值',
          pitfallTag: 'blocking-in-sequential',
          symptom: '倒计时偶发错拍',
          buggyCode: CODE_BAD_2,
          diagnosis: {
            level1Hint: '时序块里的赋值符号对吗？',
            level2Cause: '误用 = 破坏了并发语义。',
            highlightLine: 33,
            highlightCycle: 3,
          },
        }),
    });

    const bug = await createAgentRuntime({ llm, engine: createStubEngine({}) }).injectBug(CODE_A);

    expect(bug.id).toMatch(/^bug-/);
    expect(bug.buggyCode).toBe(CODE_BAD_2);
    expect(bug.diagnosis.level3PatchCode).toBe(CODE_A);
    expect(bug.diagnosis.highlightLine).toBe(33);
    expect(bug.diagnosis.highlightCycle).toBe(3);
    expect(calls.map((call) => call.action)).toEqual(['inject_bug']);
  });
});

// ============================================================
// V2：多模型、多轮上下文与联网检索
// ============================================================

describe('V2 多模型与多轮上下文', () => {
  it('把选中模型透传到每次调用，并回传实际模型和剩余额度', async () => {
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => ({ text: JSON.stringify({ code: CODE_BAD_1 }), model: 'qwen-plus', remainingQuota: 6 }),
      repair: () => JSON.stringify({ code: CODE_A }),
    });
    const engine = createStubEngine({ compileOk: (code) => !badCode(code), issues: () => [LINT_ERROR] });
    const events: HarnessTraceEvent[] = [];

    const result = await createAgentRuntime({ llm, engine }).runHarness('做个测试电路', {
      onTrace: (event) => events.push(event),
      model: 'deepseek-chat',
    });

    expect(calls.map((call) => call.model)).toEqual(['deepseek-chat', 'deepseek-chat', 'qwen-plus']);
    expect(result.modelUsed).toBe('qwen-plus');
    expect(result.remainingQuota).toBe(6);
    expect(events.some((event) => event.meta?.model === 'qwen-plus')).toBe(true);
  });

  it('剥离 think 思考段与围栏，规划、代码和诊断均可解析', () => {
    const plan = `<think>先拆解需求。\n再输出 JSON。</think>\n\`\`\`json\n${PLAN_JSON}\n\`\`\``;
    expect(parsePlanResponse(plan).blueprint.title).toBe('测试电路');

    const code = `<think>先想代码。</think>{"code": ${JSON.stringify(CODE_B)}}`;
    expect(parseCodeResponse(code).code).toBe(CODE_B);

    const diagnosis = `<think>分析一下。</think>\`\`\`json\n${JSON.stringify({
      level1Hint: '线索',
      level2Cause: '原因',
      level3PatchCode: CODE_A,
    })}\n\`\`\``;
    expect(parseDiagnosisResponse(diagnosis).level3PatchCode).toBe(CODE_A);
  });

  it('多轮上下文注入规划与生成提示词，并输出摘要、文件名和流式回调', async () => {
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_A }),
    });
    const deltas: string[] = [];
    const previousContext = {
      blueprint: BLUEPRINT,
      verilogCode: CODE_A,
      testVectors: VECTORS,
      history: [{ role: 'user' as const, content: '先做一个测试电路' }],
    };

    const result = await createAgentRuntime({ llm, engine: createStubEngine({ selfTest: () => ({ passed: true }) }) })
      .runHarness('请加一个黄闪模式', {
        onTrace: () => {},
        previousContext,
        onAssistantDelta: (chunk) => deltas.push(chunk),
      });

    expect(calls[0].messages[1].content).toContain('多轮修改上下文');
    expect(calls[0].messages[1].content).toContain('candidate A');
    expect(calls[1].messages[1].content).toContain('上一版可运行代码');
    expect(result.assistantSummary).toContain('测试电路');
    expect(result.suggestedFilename).toBe('circuit.v');
    expect(deltas.join('')).toBe(result.assistantSummary);
  });

  it('5 个案例都带 category / difficulty / boardHint 分类元数据', () => {
    const runtime = createAgentRuntime({ llm: createStubLLM({}).llm, engine: createStubEngine({}) });
    const hints = new Set(['traffic', 'lock', 'counter', 'general']);
    for (const preset of runtime.presets) {
      expect(preset.category?.length ?? 0).toBeGreaterThan(0);
      expect(['beginner', 'intermediate', 'advanced']).toContain(preset.difficulty);
      expect(hints.has(preset.boardHint ?? '')).toBe(true);
    }
  });

  it('diagnose / injectBug 透传模型与取消信号', async () => {
    const { llm, calls } = createStubLLM({
      diagnose: () => JSON.stringify({ level1Hint: '线索', level2Cause: '原因', level3PatchCode: CODE_A }),
      inject_bug: () =>
        JSON.stringify({
          title: '故障',
          pitfallTag: 'tag',
          symptom: '现象',
          buggyCode: CODE_B,
          diagnosis: { level1Hint: '线索', level2Cause: '原因', level3PatchCode: CODE_A },
        }),
    });
    const runtime = createAgentRuntime({ llm, engine: createStubEngine({}) });
    const controller = new AbortController();

    await runtime.diagnose({ code: CODE_A, issues: [] }, { model: 'glm-4', signal: controller.signal });
    await runtime.injectBug(CODE_A, { model: 'kimi-k2', signal: controller.signal });

    expect(calls.map((call) => call.model)).toEqual(['glm-4', 'kimi-k2']);
    expect(calls.every((call) => call.signal === controller.signal)).toBe(true);
  });
});

describe('预置案例 × 真实引擎', () => {
  it('5 个案例自测通过，全部故障可观察且修复代码回到通过', () => {
    const runtime = createAgentRuntime({ llm: createStubLLM({}).llm, engine: createRtlEngine() });

    for (const preset of runtime.presets) {
      const baseEngine = createRtlEngine();
      expect(baseEngine.compile(preset.verilogCode).ok, `${preset.id} 编译`).toBe(true);
      expect(baseEngine.runSelfTest(preset.verilogCode, preset.testVectors).passed, `${preset.id} 自测`).toBe(true);

      for (const bug of preset.bugs) {
        const bugEngine = createRtlEngine();
        const bugCompiled = bugEngine.compile(bug.buggyCode);
        const observable = !bugCompiled.ok || !bugEngine.runSelfTest(bug.buggyCode, preset.testVectors).passed;
        expect(observable, `${preset.id}/${bug.id} 故障可观察`).toBe(true);

        const fixEngine = createRtlEngine();
        expect(fixEngine.compile(bug.diagnosis.level3PatchCode).ok, `${bug.id} 修复编译`).toBe(true);
        expect(
          fixEngine.runSelfTest(bug.diagnosis.level3PatchCode, preset.testVectors).passed,
          `${bug.id} 修复自测`,
        ).toBe(true);
      }
    }
  });
});

describe('V2 联网检索', () => {
  it('开启联网时按需检索、读取网页，并把引用注入规划提示词', async () => {
    const stub = createStubResearch({
      results: [
        { title: 'Verilog 规范', url: 'https://example.com/verilog', snippet: '组合 always 块应完整赋值', source: 'example' },
      ],
      page: { url: 'https://example.com/verilog', title: 'Verilog 规范', excerpt: '时序块使用非阻塞赋值。' },
    });
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_A }),
    });
    const events: HarnessTraceEvent[] = [];

    const result = await createAgentRuntime({
      llm,
      engine: createStubEngine({ selfTest: () => ({ passed: true }) }),
      research: stub.research,
    }).runHarness('请查一下 AXI 协议的 Verilog 规范实现', {
      onTrace: (event) => events.push(event),
      enableWebResearch: true,
    });

    expect(stub.searchCalls).toHaveLength(1);
    expect(stub.searchCalls[0].query).toContain('AXI');
    expect(stub.fetchCalls).toEqual(['https://example.com/verilog']);
    expect(result.references?.map((reference) => reference.url)).toEqual(['https://example.com/verilog']);
    expect(calls[0].messages[1].content).toContain('联网检索参考');
    expect(
      events.some((event) => event.stage === 'researching' && event.status === 'pass' && event.meta?.sources?.length === 1),
    ).toBe(true);
  });

  it('未显式开启联网时不触发检索', async () => {
    const stub = createStubResearch({ results: [] });
    const { llm } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_A }),
    });
    const events: HarnessTraceEvent[] = [];

    await createAgentRuntime({
      llm,
      engine: createStubEngine({ selfTest: () => ({ passed: true }) }),
      research: stub.research,
    }).runHarness('请查一下 SPI 协议规范', { onTrace: (event) => events.push(event) });

    expect(stub.searchCalls).toHaveLength(0);
    expect(events.some((event) => event.stage === 'researching')).toBe(false);
  });

  it('联网检索异常时优雅降级，主流程继续完成', async () => {
    const stub = createStubResearch({ searchError: new Error('network down') });
    const { llm } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_A }),
    });
    const events: HarnessTraceEvent[] = [];

    const result = await createAgentRuntime({
      llm,
      engine: createStubEngine({ selfTest: () => ({ passed: true }) }),
      research: stub.research,
    }).runHarness('请查阅 UART 协议规范', {
      onTrace: (event) => events.push(event),
      enableWebResearch: true,
    });

    expect(result.ok).toBe(true);
    expect(result.references).toBeUndefined();
    expect(
      events.some(
        (event) => event.stage === 'researching' && event.status === 'fail' && event.detail.includes('降级'),
      ),
    ).toBe(true);
  });

  it('首轮修复受阻后自动联网，引用进入第二轮修复提示词', async () => {
    const stub = createStubResearch({
      results: [{ title: '复位规范', url: 'https://example.com/reset', snippet: '异步复位应覆盖全部寄存器', source: 'example' }],
    });
    const repairs = [CODE_BAD_2, CODE_A];
    const { llm, calls } = createStubLLM({
      plan: () => PLAN_JSON,
      generate: () => JSON.stringify({ code: CODE_BAD_1 }),
      repair: () => JSON.stringify({ code: repairs.shift() ?? CODE_A }),
    });
    const engine = createStubEngine({ compileOk: (code) => !badCode(code), issues: () => [LINT_ERROR] });
    const events: HarnessTraceEvent[] = [];

    const result = await createAgentRuntime({ llm, engine, research: stub.research }).runHarness('做个测试电路', {
      onTrace: (event) => events.push(event),
      enableWebResearch: true,
    });

    const repairCalls = calls.filter((call) => call.action === 'repair');
    expect(result.ok).toBe(true);
    expect(stub.searchCalls).toHaveLength(1);
    expect(repairCalls).toHaveLength(2);
    expect(repairCalls[0].messages[1].content).not.toContain('联网检索参考');
    expect(repairCalls[1].messages[1].content).toContain('联网检索参考');
    expect(events.some((event) => event.stage === 'researching' && event.status === 'pass')).toBe(true);
  });
});