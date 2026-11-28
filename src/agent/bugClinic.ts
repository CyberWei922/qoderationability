// 队友 2：故障诊所题库（源自 rtl-pitfalls 的真实硬件踩坑）与 LLM 故障注入。
// 每个预置案例挂 1-2 个故障关卡：symptom 可在板卡/波形上观察，三档苏格拉底提示 + 标准修复代码。
import type { AgentActionOptions, BugClinicCase, LLMClient } from '../types/contracts';
import { buildInjectBugMessages, parseBugCaseResponse } from './prompts';

function replaceOnce(code: string, from: string, to: string, label: string): string {
  if (!code.includes(from)) {
    throw new Error(`故障模板失效（${label}）：在固定代码中找不到目标片段，请同步更新 bugClinic.ts`);
  }
  return code.replace(from, to);
}

function lineOf(code: string, needle: string): number {
  const index = code.indexOf(needle);
  return index < 0 ? 1 : code.slice(0, index).split('\n').length;
}

/** 1011 序列检测器：状态机转移写错导致漏检（重叠前缀丢失）。 */
export function makeSequenceDetectorBugs(fixedCode: string): BugClinicCase[] {
  const transitionBuggy = replaceOnce(
    fixedCode,
    'if (din) state <= S1; else state <= S2;',
    'if (din) state <= S0; else state <= S2;',
    'sequence-fsm-transition',
  );
  const stickyBuggy = replaceOnce(
    fixedCode,
    `        end else begin
            hit <= 1'b0;
            case (state)`,
    `        end else begin
            case (state)`,
    'sequence-hit-sticky',
  );
  return [
    {
      id: 'sequence-fsm-transition',
      title: '隐蔽故障：状态机漏掉重叠前缀',
      pitfallTag: 'fsm-transition',
      symptom: '连续输入 1、1 之后，再输入 0、1、1 检测灯不亮；从单个 1 开始的序列才有机会命中',
      buggyCode: transitionBuggy,
      diagnosis: {
        level1Hint: '已经收到一个 1 之后又收到 1，最长的“已匹配后缀”还保留着吗？',
        level2Cause:
          'S1（已收到一个 1）遇到 din=1 时错误回到 S0，而正确做法是保持 S1；否则以 "11" 开头的 1011 重叠序列会被漏检。',
        level3PatchCode: fixedCode,
        highlightLine: lineOf(transitionBuggy, 'if (din) state <= S0;'),
      },
    },
    {
      id: 'sequence-hit-sticky',
      title: '隐蔽故障：命中标志只置位不清零',
      pitfallTag: 'missing-clear',
      symptom: '第一次检测到 1011 后 LED 一直亮着，后续输入任何序列都无法熄灭',
      buggyCode: stickyBuggy,
      diagnosis: {
        level1Hint: '这个 LED 表示“本拍命中”，它每一拍都应该被重新计算吗？',
        level2Cause: '正常分支缺少 hit <= 1\'b0 清零，检测到一次后 hit 恒为 1，指示灯常亮。',
        level3PatchCode: fixedCode,
        highlightLine: lineOf(stickyBuggy, 'case (state)'),
        highlightCycle: 5,
      },
    },
  ];
}

/** 数字秒表：BCD 进位链断裂，十位不增长。 */
export function makeStopwatchBugs(fixedCode: string): BugClinicCase[] {
  const buggyCode = replaceOnce(fixedCode, "end else d1 <= d1 + 4'd1;", 'end else d1 <= d1;', 'stopwatch-bcd-carry');
  return [
    {
      id: 'stopwatch-bcd-carry',
      title: '隐蔽故障：BCD 进位链缺失',
      pitfallTag: 'bcd-carry',
      symptom: '计时从 0009 直接回到 0000，十位数字永远不增长',
      buggyCode,
      diagnosis: {
        level1Hint: '个位从 9 回到 0 的那一拍，应该向哪一位进位？',
        level2Cause: '个位清零时没有让十位加 1，BCD 进位链断裂，计时永远停在个位。',
        level3PatchCode: fixedCode,
        highlightLine: lineOf(buggyCode, 'end else d1 <= d1;'),
        highlightCycle: 12,
      },
    },
  ];
}

/** 四人抢答器：锁存条件被删掉，后按者会覆盖先按者。 */
export function makeBuzzerBugs(fixedCode: string): BugClinicCase[] {
  const buggyCode = replaceOnce(fixedCode, 'end else if (!locked) begin', 'end else begin', 'buzzer-missing-lock');
  return [
    {
      id: 'buzzer-missing-lock',
      title: '隐蔽故障：抢答结果没有锁存',
      pitfallTag: 'missing-lock',
      symptom: '先按下的选手灯会被后按下的选手覆盖，无法裁定第一个按下的人',
      buggyCode,
      diagnosis: {
        level1Hint: '抢答器“先到先得”的语义，依赖哪个条件一直保持？',
        level2Cause: '分支条件删掉了 !locked 判断，锁存后仍继续仲裁，后按下的按键会改写 winner。',
        level3PatchCode: fixedCode,
        highlightLine: lineOf(buggyCode, 'end else begin'),
      },
    },
  ];
}

/** 贪吃蛇：吃食物判定恒为假，导致无法得分与变长。 */
export function makeSnakeBugs(fixedCode: string): BugClinicCase[] {
  const buggyCode = replaceOnce(
    fixedCode,
    'if (will_eat) begin',
    "if (1'b0) begin",
    'snake-no-eat',
  );
  return [
    {
      id: 'snake-no-eat',
      title: '隐蔽故障：吃食物判定恒为假，无法得分与变长',
      pitfallTag: 'condition-stuck',
      symptom: '蛇头经过食物坐标后不会触发得分提示音，数码管分数保持 0000，蛇身长度也不增加',
      buggyCode,
      diagnosis: {
        level1Hint: '当蛇头下一步坐标等于食物坐标时，计分与增长分支真的被执行了吗？',
        level2Cause:
          "判断吃食物的条件被写死为 1'b0，导致 will_eat 无法触发计分、长度自增和重新生成食物。",
        level3PatchCode: fixedCode,
        highlightLine: lineOf(buggyCode, "if (1'b0) begin"),
        highlightCycle: 17,
      },
    },
  ];
}

/** 彩色俄罗斯方块：右移边界检查失效，导致方块越界不响应。 */
export function makeTetrisBugs(fixedCode: string): BugClinicCase[] {
  const buggyCode = replaceOnce(
    fixedCode,
    'else if (key_r) begin',
    "else if (1'b0) begin",
    'tetris-no-right',
  );
  return [
    {
      id: 'tetris-no-right',
      title: '隐蔽故障：右移分支被屏蔽，按 D / → 无法向右移动',
      pitfallTag: 'input-masked',
      symptom: '按下 KEY3（D / →）后方块保持在原列不动，无法横向平移对准空位',
      buggyCode,
      diagnosis: {
        level1Hint: '检查组合逻辑中生成平移候选坐标的分支，右移按键信号真的进入判定了吗？',
        level2Cause: "右移分支条件被误改为 1'b0，导致 KEY3 触发的 key_r 信号始终被忽略。",
        level3PatchCode: fixedCode,
        highlightLine: lineOf(buggyCode, "else if (1'b0) begin"),
      },
    },
  ];
}

/** 256 色 RGB 立方渐变秀：写屏命令恒为 00，屏幕停在黑屏。 */
export function makeRgbCubeBugs(fixedCode: string): BugClinicCase[] {
  const buggyCode = replaceOnce(
    fixedCode,
    "screen_cmd   <= 2'b01;",
    "screen_cmd   <= 2'b00;",
    'rgb-cube-no-write',
  );
  return [
    {
      id: 'rgb-cube-no-write',
      title: '隐蔽故障：screen_cmd 写使能恒为 00，屏幕无彩色输出',
      pitfallTag: 'write-disabled',
      symptom: '数码管色号在持续跳动，但 16×8 彩色 OLED 屏幕始终保持黑屏',
      buggyCode,
      diagnosis: {
        level1Hint: '对比数码管与屏幕端口：坐标与色号在推进，但屏幕收到写命令了吗？',
        level2Cause: "扫描循环中将 screen_cmd 误赋值为 2'b00（保持），改为 2'b01 即可逐格写入彩色显存。",
        level3PatchCode: fixedCode,
        highlightLine: lineOf(buggyCode, "screen_cmd   <= 2'b00;"),
      },
    },
  ];
}

/** 运行时故障注入：交给大模型生成一个隐蔽 Bug（inject_bug 动作）。 */
export async function requestInjectedBug(
  llm: LLMClient,
  code: string,
  options: AgentActionOptions = {},
): Promise<BugClinicCase> {
  const response = await llm.chat({
    action: 'inject_bug',
    messages: buildInjectBugMessages(code),
    temperature: 0.5,
    jsonMode: true,
    model: options.model,
    signal: options.signal,
  });
  return parseBugCaseResponse(response.text, code);
}