import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AgentBlueprint,
  LintIssue,
  LLMErrorCode,
  LLMProviderId,
  PresetProject,
} from '../types/contracts';
import type { AccentPresetId } from './theme';

export type Locale = 'zh' | 'en';

const LOCALE_STORAGE_KEY = 'fpgagent.locale';

export function loadLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === 'en' || raw === 'zh') return raw;
  } catch {
    // Ignore storage read failures in restricted environments.
  }
  return 'zh';
}

export function saveLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage write failures.
  }
}

export function applyLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.locale = locale;
}

export interface I18nContextValue {
  locale: Locale;
  isEn: boolean;
  setLocale: (next: Locale) => void;
  toggleLocale: () => void;
  L: (zh: string, en: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  isEn: false,
  setLocale: () => {},
  toggleLocale: () => {},
  L: (zh) => zh,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(loadLocale);

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    saveLocale(next);
    applyLocale(next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: Locale = prev === 'zh' ? 'en' : 'zh';
      saveLocale(next);
      applyLocale(next);
      return next;
    });
  }, []);

  const L = useCallback(
    (zh: string, en: string) => (locale === 'en' ? en : zh),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, isEn: locale === 'en', setLocale, toggleLocale, L }),
    [locale, setLocale, toggleLocale, L],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export const LLM_ERROR_TEXT_EN: Record<LLMErrorCode, string> = {
  QUOTA_EXCEEDED:
    'Daily free quota reached. Try a built-in demo or configure your own API key (DeepSeek / GLM / Qwen) in Settings.',
  NOT_CONFIGURED:
    'Model service is not configured or API key authentication failed. Open Settings to verify your API config.',
  FORBIDDEN:
    'Model service rejected the request. Check site access permissions or switch to a custom API.',
  TIMEOUT: 'Model request timed out. Please retry or switch to a faster model.',
  NETWORK: 'Connection failed. Check your network or verify the endpoint allows browser CORS requests.',
  UPSTREAM: 'Model service is temporarily unavailable. Please try again shortly.',
  BAD_RESPONSE: 'Model returned an unparseable response. Please retry or switch models.',
  ABORTED: 'Generation stopped.',
};

export const LLM_ERROR_TEXT_ZH: Record<LLMErrorCode, string> = {
  QUOTA_EXCEEDED: '今日免费次数已用完。可体验预置案例，或在设置中切换 DeepSeek / GLM / 通义千问等自有 Key。',
  NOT_CONFIGURED: '模型服务尚未配置或 Key 鉴权失败，请点击下方打开设置检查 API 配置。',
  FORBIDDEN: '模型服务拒绝了请求，请检查站点权限或切换自定义 API。',
  TIMEOUT: '模型响应超时，请稍后重试或切换更快的模型。',
  NETWORK: '连接失败，请检查网络或确认所选接口支持浏览器跨域访问。',
  UPSTREAM: '模型服务暂时不可用，请稍后重试。',
  BAD_RESPONSE: '模型返回了无法解析的内容，建议重试或更换模型。',
  ABORTED: '已停止本次生成。',
};

export function getLlmErrorText(code: LLMErrorCode, locale: Locale): string {
  return locale === 'en' ? LLM_ERROR_TEXT_EN[code] : LLM_ERROR_TEXT_ZH[code];
}

const PROVIDER_NAMES_EN: Partial<Record<LLMProviderId, string>> = {
  'site-default': 'Site Default',
  deepseek: 'DeepSeek',
  'zhipu-glm': 'Zhipu GLM',
  'dashscope-qwen': 'Qwen (DashScope)',
  'amd-radeon': 'AMD Radeon Cloud',
  siliconflow: 'SiliconFlow',
  'moonshot-kimi': 'Moonshot Kimi',
  'local-gateway': 'Local / LAN Gateway',
  custom: 'Custom OpenAI-Compatible',
};

export function localizeProviderName(
  id: LLMProviderId | undefined,
  fallback: string,
  locale: Locale,
): string {
  if (locale !== 'en' || !id) return fallback;
  return PROVIDER_NAMES_EN[id] ?? fallback;
}

export function localizeModelOwnedBy(ownedBy: string | undefined, locale: Locale): string | undefined {
  if (!ownedBy || locale !== 'en') return ownedBy;
  if (ownedBy === '站点默认 · 推荐') return 'Site Default · Recommended';
  if (ownedBy === '站点默认') return 'Site Default';
  return ownedBy;
}

const ACCENT_NAMES_EN: Record<Exclude<AccentPresetId, 'custom'>, string> = {
  nvidia: 'NVIDIA Green',
  teal: 'Celadon Teal',
  cobalt: 'Cobalt Blue',
  emerald: 'Emerald',
  amber: 'Amber',
  indigo: 'Indigo',
  crimson: 'Crimson',
};

export function localizeAccentName(
  id: Exclude<AccentPresetId, 'custom'>,
  fallback: string,
  locale: Locale,
): string {
  if (locale !== 'en') return fallback;
  return ACCENT_NAMES_EN[id] ?? fallback;
}

interface PresetOverlay {
  name: string;
  prompt: string;
  category: string;
  blueprint: AgentBlueprint;
  vectorNotes?: Record<number, string>;
}

const PRESET_EN_OVERLAYS: Record<string, PresetOverlay> = {
  'traffic-light': {
    name: 'Smart Intersection Traffic Light',
    prompt: 'Build a traffic light (Red 5, Green 4, Yellow 1 cycles) with KEY0 emergency all-red override and 7-segment countdown',
    category: 'FSM & Timing',
    blueprint: {
      title: 'Smart Intersection Traffic Light',
      summary: 'Cycles Red 5 → Green 4 → Yellow 1 ticks with KEY0 emergency all-red override and countdown on 7-seg.',
      behaviors: [
        'Enters RED state after reset with countdown initialized to 5',
        'Decrements countdown every rising clock edge and advances to next state at 1',
        'Pressing KEY0 immediately forces RED and resets countdown to 5',
        'Lowest 7-segment digit displays the remaining ticks',
        'LED7 blinks as a heartbeat while LED6..0 mirror switches SW6..0',
      ],
      pinMappings: [
        { port: 'key[0]', role: 'Emergency all-red override button' },
        { port: 'rst_n', role: 'Active-low reset' },
        { port: 'traffic[2]', role: 'Red light' },
        { port: 'traffic[1]', role: 'Yellow light' },
        { port: 'traffic[0]', role: 'Green light' },
        { port: 'seg[3:0]', role: 'Countdown 7-segment digit' },
        { port: 'led[7]', role: 'Heartbeat LED' },
      ],
      mermaidFsm: `stateDiagram-v2
    [*] --> RED
    RED --> GREEN: timer==1
    GREEN --> YELLOW: timer==1
    YELLOW --> RED: timer==1
    GREEN --> RED: KEY0
    YELLOW --> RED: KEY0`,
    },
    vectorNotes: {
      0: 'Reset lights up RED',
      1: 'RED after reset, countdown starts at 5',
      5: 'Switch to GREEN after 5 RED cycles',
      9: 'Switch to YELLOW after 4 GREEN cycles',
      10: 'Return to RED after 1 YELLOW cycle',
      16: 'Pressing KEY0 forces emergency RED and resets timer',
      17: 'Releasing KEY0 continues RED countdown',
    },
  },
  'sequence-detector': {
    name: '1011 Sequence Detector',
    prompt: 'Use KEY0 as serial input to detect sequence 1011 with overlap support, pulsing LED0 high for 1 cycle on match',
    category: 'Serial Detection',
    blueprint: {
      title: '1011 Sequence Detector',
      summary: 'Samples KEY0 serially to detect 1011; pulses LED0 high for 1 cycle on match with overlap detection.',
      behaviors: [
        'Returns FSM to S0 on reset',
        'Samples key[0] as serial data bit on every rising clock edge',
        'Pulses hit=1 for one cycle upon matching 1011 while preserving overlap prefix',
        'LED0 indicates whether a match occurred in the current cycle',
        'Lowest 7-segment digit shows the current FSM state index',
      ],
      pinMappings: [
        { port: 'key[0]', role: 'Serial data input' },
        { port: 'led[0]', role: 'Match pulse indicator' },
        { port: 'seg[3:0]', role: 'Current state index' },
      ],
      mermaidFsm: `stateDiagram-v2
    [*] --> S0
    S0 --> S0: din=0
    S0 --> S1: din=1
    S1 --> S1: din=1
    S1 --> S2: din=0
    S2 --> S3: din=1
    S2 --> S0: din=0
    S3 --> S1: din=1 / hit
    S3 --> S2: din=0`,
    },
    vectorNotes: {
      0: 'Reset returns to S0, hit LED off',
      1: 'Input 1',
      2: 'Input 1 (overlapping prefix)',
      3: 'Input 0',
      4: 'Input 1, matched 101',
      5: 'Input 1, matched 1011',
      6: 'Match pulses for 1 cycle only',
      7: 'Input 1, accumulate again',
      8: 'Overlapping second 1011 match',
      9: 'LED returns low',
    },
  },
  stopwatch: {
    name: 'Digital Stopwatch',
    prompt: 'Build a 4-digit BCD digital stopwatch with KEY0 start/pause, KEY1 clear, displaying 0000 to 9999 on 7-segment',
    category: 'Counters',
    blueprint: {
      title: '4-Digit BCD Digital Stopwatch',
      summary: 'KEY0 toggles run/pause and KEY1 clears; 7-segment displays 0000 to 9999 in BCD format.',
      behaviors: [
        'Resets display to 0000 in paused state',
        'Rising edge of KEY0 toggles running / paused',
        'Rising edge of KEY1 clears all four BCD digits to zero',
        'Increments units digit every cycle while running with BCD carry from 9 to 0',
        'LED0 indicates whether the stopwatch is currently running',
      ],
      pinMappings: [
        { port: 'key[0]', role: 'Start / Pause' },
        { port: 'key[1]', role: 'Clear to zero' },
        { port: 'seg', role: '4-digit BCD display' },
        { port: 'led[0]', role: 'Running indicator' },
      ],
      mermaidFsm: `stateDiagram-v2
    [*] --> PAUSED
    PAUSED --> RUNNING: KEY0
    RUNNING --> PAUSED: KEY0
    RUNNING --> RUNNING: KEY1 clear
    PAUSED --> PAUSED: KEY1 clear`,
    },
    vectorNotes: {
      0: 'Reset clears counter and pauses',
      1: 'Remains paused after reset release',
      2: 'KEY0 starts counting',
      3: 'Counted 1 cycle, units = 1',
      11: 'Units digit reaches 9',
      12: 'BCD carry displays 0010',
      13: 'KEY0 pauses and holds display',
      14: 'Holds value while paused',
      15: 'KEY1 clears to 0000',
      16: 'Remains paused after clear',
    },
  },
  buzzer: {
    name: '4-Player Quiz Buzzer',
    prompt: 'Build a 4-player quiz buzzer using KEY0-KEY3: latch the first player, show winner on LED0-3 and 7-segment, reset via rst_n',
    category: 'Arbitration & Latch',
    blueprint: {
      title: '4-Player Quiz Buzzer',
      summary: 'Each player presses a key; first responder locks out others and lights LED0-3 until reset.',
      behaviors: [
        'Clears lock state and winner on reset',
        'Monitors KEY0-KEY3 while unlocked and latches immediately on first press',
        'Higher-numbered player wins on simultaneous button press',
        'Ignores subsequent presses after locking until reset',
        'LED0-3 lights the winner and 7-segment shows winner index',
      ],
      pinMappings: [
        { port: 'key[3:0]', role: '4-player buzzer buttons' },
        { port: 'led[3:0]', role: 'Winner indicator LEDs' },
        { port: 'seg[3:0]', role: 'Winner index' },
        { port: 'rst_n', role: 'Reset for next round' },
      ],
      mermaidFsm: `stateDiagram-v2
    [*] --> IDLE
    IDLE --> LOCKED: any player pressed
    LOCKED --> IDLE: rst_n=0`,
    },
    vectorNotes: {
      0: 'No winner after reset',
      1: 'Player 1 presses first, LED1 turns on',
      2: 'Player 3 ignored after lock',
      3: 'Multiple presses ignored while locked',
      4: 'Reset for next round',
      5: 'Players 2 & 3 press together, higher index wins',
      6: 'Latch remains locked',
      7: 'Reset again',
      8: 'Players 0 & 2 press together, higher index wins',
    },
  },
  snake: {
    name: 'Color OLED Snake',
    prompt: 'Build a color Snake game on the 16×8 256-color OLED controlled by KEY0-KEY3 (WASD / Arrow keys), growing and scoring on food, with GAME OVER on collision',
    category: '256-Color Game',
    blueprint: {
      title: '16×8 Color OLED Snake',
      summary: 'Playable 256-color Snake on the 16×8 OLED: green head, cyan body, red food, KEY0–KEY3 (WASD / Arrows) steering and BCD score.',
      behaviors: [
        'Clears OLED on reset, spawns a 3-segment snake at (6,3) moving right, and places red food at (10,3)',
        'Samples KEY0(Up/W), KEY1(Down/S), KEY2(Left/A), KEY3(Right/D) every cycle while blocking 180-degree reversal',
        'Uses flicker-free delta rendering with screen_color[7:0] (green head, cyan body, red food, amber text)',
        'Eating food increments snake length and 7-segment BCD score, then spawns new food off the snake body via LFSR',
        'Wall or self collision clears the OLED to display GAME OVER until reset via RST (R)',
      ],
      pinMappings: [
        { port: 'key[0]', role: 'Steer Up (W / ↑)' },
        { port: 'key[1]', role: 'Steer Down (S / ↓)' },
        { port: 'key[2]', role: 'Steer Left (A / ←)' },
        { port: 'key[3]', role: 'Steer Right (D / →)' },
        { port: 'rst_n', role: 'Hardware reset / restart (R)' },
        { port: 'screen_x/y/data/cmd/color', role: '16×8 256-color OLED write, color & clear ports' },
        { port: 'seg[7:0]', role: '2-digit BCD score' },
        { port: 'tone[3:0]', role: 'Turn, eat, and collision tones' },
      ],
      mermaidFsm: `stateDiagram-v2
    [*] --> ST_INIT
    ST_INIT --> ST_PLAY: Initial draw done
    ST_PLAY --> ST_PLAY: Move / Turn / Eat
    ST_PLAY --> ST_OVER: Wall or self hit
    ST_OVER --> ST_INIT: rst_n=0 restart`,
    },
    vectorNotes: {
      0: 'Reset clears OLED and initializes snake and food',
      1: 'Draw initial food at (10,3)',
      4: 'Draw initial snake head at (6,3) and enter ST_PLAY',
      5: 'Move right to (7,3)',
      7: 'Erase old tail at (4,3)',
      17: 'Eat food at (10,3): score +1 and chime tone',
      20: 'Press KEY1 (Down / S) to latch downward turn',
      21: 'Turn downward to (10,4)',
    },
  },
  tetris: {
    name: 'Color Tetris',
    prompt: 'Build a Color Tetris game on the 16×8 256-color OLED with 7 classic colored tetrominoes, WASD/arrow controls for move/rotate/drop, line clear, NEXT preview, and 7-seg score',
    category: '256-Color Game',
    blueprint: {
      title: '16×8 Color Tetris',
      summary: 'Complete Color Tetris on the 16×8 256-color OLED: 7 classic colored tetrominoes, wall-kick rotation, line clearing, live colored NEXT preview, and BCD scoring.',
      behaviors: [
        '8×8 playfield bordered by dark gray walls plus right-side HUD showing colored NEXT preview, LINE count, and PLAY/OVER status',
        '7 classic tetrominoes each use distinct 256-color palette hues (I cyan, O yellow, T purple, L orange, J blue, S green, Z red)',
        'KEY2(A/←) Left, KEY3(D/→) Right, KEY0(W/↑) Rotate with wall-kick, KEY1(S/↓) Soft Drop, SW0 doubles gravity speed',
        'Flicker-free delta renderer refreshes only changed cells; locking full rows clears lines, drops upper blocks, and increments BCD score & buzzer chime',
        'Spawn collision triggers GAME OVER (red light & red OVER label) until reset via RST (R)',
      ],
      pinMappings: [
        { port: 'key[0]', role: 'Rotate clockwise (W / ↑, with wall-kick)' },
        { port: 'key[1]', role: 'Soft drop (S / ↓)' },
        { port: 'key[2]', role: 'Move left (A / ←)' },
        { port: 'key[3]', role: 'Move right (D / →)' },
        { port: 'sw[0]', role: 'Fast gravity switch' },
        { port: 'rst_n', role: 'Hardware reset / restart (R)' },
        { port: 'screen_x/y/data/cmd/color', role: '16×8 256-color OLED display & color ports' },
        { port: 'seg[15:0]', role: 'Score (upper 2 digits) & lines (lower 2 digits)' },
        { port: 'tone[3:0]', role: 'Move, rotate, lock, line-clear, and game-over tones' },
      ],
      mermaidFsm: `stateDiagram-v2
    [*] --> ST_PLAY
    ST_PLAY --> ST_PLAY: Move / Rotate / Drop
    ST_PLAY --> ST_CLEAR: Piece locks
    ST_CLEAR --> ST_CLEAR: Clear full row & score
    ST_CLEAR --> ST_PLAY: Spawn next piece
    ST_CLEAR --> ST_OVER: Spawn blocked
    ST_OVER --> ST_PLAY: rst_n=0 restart`,
    },
    vectorNotes: {
      0: 'Reset clears OLED and spawns purple T-piece at top',
      1: 'Draw T-piece top cell (4,0)',
      4: 'Complete initial 4-cell T-piece',
      5: 'Press KEY3 (D / →) to shift right with move tone',
      8: 'Press KEY0 (W / ↑) to rotate clockwise 90°',
      10: 'Press KEY1 (S / ↓) for soft drop',
    },
  },
  'rgb-cube': {
    name: '256-Color RGB Cube Showcase',
    prompt: 'Build a 256-color RGB cube gradient visual demo on the 16×8 OLED with SW[1:0] switching between RGB Cube Flow, Rainbow Spectrum, Neon Plasma, and Full 256-Color Grid',
    category: '256-Color Visual',
    blueprint: {
      title: '256-Color RGB Cube Showcase',
      summary: 'Showcases the 6×6×6 RGB color cube (indices 16–231) and full 256-color palette on the 16×8 OLED across 4 switchable live visual modes.',
      behaviors: [
        'Mode 0 (SW[1:0]=00): 6×6×6 RGB Cube Flow computing 16 + 36r + 6g + b via seamless 16-step triangle waves',
        'Mode 1 (SW[1:0]=01): 16-column Rainbow Spectrum Bars with bright white peak caps',
        'Mode 2 (SW[1:0]=10): 2D diagonal Neon Plasma interference combining solid and checkerboard tiles',
        'Mode 3 (SW[1:0]=11): Full 256-Color Swatch Grid (SW2 toggles pages 0–127 and 128–255)',
        'KEY0 pauses/resumes phase, KEY1 shifts hue, KEY2/KEY3 step phase manually; 7-seg displays mode, phase, and live hex color index',
      ],
      pinMappings: [
        { port: 'sw[1:0]', role: 'Visual mode (00 Cube Flow / 01 Spectrum / 10 Plasma / 11 256-Color Grid)' },
        { port: 'sw[2]', role: 'Swatch grid page (0 = 0–127, 1 = 128–255)' },
        { port: 'key[0]', role: 'Pause / Resume animation (W / ↑)' },
        { port: 'key[1]', role: 'Shift hue palette (S / ↓)' },
        { port: 'key[2]', role: 'Step phase backward (A / ←)' },
        { port: 'key[3]', role: 'Step phase forward (D / →)' },
        { port: 'screen_x/y/data/cmd/color', role: '16×8 256-color OLED scan & RGB cube color ports' },
        { port: 'seg[15:0]', role: 'Mode + phase + current hex color index' },
      ],
      mermaidFsm: `stateDiagram-v2
    [*] --> MODE_CUBE
    MODE_CUBE --> MODE_SPECTRUM: sw[1:0]=01
    MODE_SPECTRUM --> MODE_PLASMA: sw[1:0]=10
    MODE_PLASMA --> MODE_SWATCH: sw[1:0]=11
    MODE_SWATCH --> MODE_CUBE: sw[1:0]=00`,
    },
    vectorNotes: {
      0: 'Reset clears OLED into Mode 0 (RGB Cube Flow)',
      1: 'Write RGB cube pixel at (0,0)',
      4: 'Switch to Mode 3 (Full 256-Color Grid), LED3 on',
      5: 'Press KEY0 to pause animation, traffic turns yellow',
      6: 'Switch to Mode 1 (Rainbow Spectrum) while paused',
      7: 'Press KEY0 again to resume in Mode 2 (Neon Plasma)',
    },
  },
};

export function localizePreset(preset: PresetProject, locale: Locale): PresetProject {
  if (locale !== 'en') return preset;
  const overlay = PRESET_EN_OVERLAYS[preset.id];
  if (!overlay) return preset;
  return {
    ...preset,
    name: overlay.name,
    prompt: overlay.prompt,
    category: overlay.category,
    blueprint: overlay.blueprint,
    testVectors: overlay.vectorNotes
      ? preset.testVectors.map((step) => ({
          ...step,
          note: overlay.vectorNotes?.[step.cycle] ?? step.note,
        }))
      : preset.testVectors,
  };
}

export function localizeNetlistNarration(narration: string, locale: Locale): string {
  if (locale !== 'en' || !narration) return narration;
  return narration
    .replace(/^\[组合环路保护\]\s*/, '[Comb-loop guard] ')
    .replace('等待编译有效 Verilog 代码', 'Waiting for valid Verilog compilation')
    .replace('尚未编译有效模块', 'No compiled module yet')
    .replace('当前拍信号保持稳态，无逻辑跳变', 'Signals stable this cycle — no logic transitions')
    .replace('当前拍内部信号有变化', 'Internal signals updated this cycle')
    .replace(/第 (\d+) 层（输入激励）：输入端口保持稳定/g, 'Layer $1 (Inputs): input ports stable')
    .replace(/第 (\d+) 层（输出端）：输出保持稳态/g, 'Layer $1 (Outputs): outputs steady')
    .replace(/第 (\d+) 层（触发器）：寄存器保持原值/g, 'Layer $1 (Registers): flip-flops holding state')
    .replace(/第 (\d+) 层（逻辑传播）：本层信号无跳变/g, 'Layer $1 (Logic): no transitions in this layer')
    .replace(/第 (\d+) 层（输入激励）：/g, 'Layer $1 (Inputs): ')
    .replace(/第 (\d+) 层（输出响应）：/g, 'Layer $1 (Outputs): ')
    .replace(/第 (\d+) 层（触发器\/状态更新）：/g, 'Layer $1 (Registers/FSM): ')
    .replace(/第 (\d+) 层（逻辑与输出响应）：/g, 'Layer $1 (Logic & Outputs): ')
    .replace(/第 (\d+) 层（逻辑门传播）：/g, 'Layer $1 (Gate Propagation): ')
    .replace(/\(红灯\)/g, '(RED)')
    .replace(/\(黄灯\)/g, '(YELLOW)')
    .replace(/\(绿灯\)/g, '(GREEN)')
    .replace(/\(全灭\)/g, '(OFF)')
    .replace(/红灯/g, 'RED')
    .replace(/黄灯/g, 'YELLOW')
    .replace(/绿灯/g, 'GREEN');
}

export function localizeLintIssue(issue: LintIssue, locale: Locale): LintIssue {
  if (locale !== 'en') return issue;
  const line = issue.line;
  switch (issue.code) {
    case 'SEQ_BLOCKING_ASSIGN':
      return {
        ...issue,
        message: `Line ${line}: blocking assignment "=" used inside sequential always block`,
        hint: 'Use non-blocking assignment "<=" for registers in clocked always blocks to match synthesis.',
      };
    case 'COMB_NONBLOCKING_ASSIGN':
      return {
        ...issue,
        message: `Line ${line}: non-blocking assignment "<=" used inside combinational always block`,
        hint: 'Use blocking assignment "=" in always @(*) / always_comb blocks.',
      };
    case 'INFERRED_LATCH':
      return {
        ...issue,
        message: `Line ${line}: incomplete branch in combinational block may infer a latch`,
        hint: 'Add a default/else branch or assign default values at the top of the combinational block.',
      };
    case 'UNSIGNED_ARITH_SHIFT':
      return {
        ...issue,
        message: `Line ${line}: arithmetic right shift ">>>" used on unsigned operand`,
        hint: 'Declare as signed / wrap with $signed(...) for sign extension, or use ">>" for zero-fill.',
      };
    case 'PORT_MISMATCH':
      return {
        ...issue,
        message: `Line ${line}: top-level port does not match standard virtual board interface`,
        hint: 'Use the standard board ports: clk, rst_n, key[3:0], sw[7:0], led[7:0], traffic[2:0], seg[15:0].',
      };
    case 'UNDRIVEN_OR_UNASSIGNED':
      return {
        ...issue,
        message: `Line ${line}: signal is undriven or unassigned and will remain constant 0`,
        hint: 'Drive the signal with an assign statement or inside an always block.',
      };
    case 'MULTI_DRIVER':
      return {
        ...issue,
        message: `Line ${line}: signal has multiple drivers across assign or always blocks`,
        hint: 'Assign each register or wire from a single always block or continuous assignment.',
      };
    case 'ARRAY_BOUNDS_OR_DIM':
      return {
        ...issue,
        message: `Line ${line}: array index out of bounds or unsupported multi-dimensional array`,
        hint: 'Use flat bit vectors within declared range in the synthesizable Verilog subset.',
      };
    case 'PARSE_ERROR':
      return {
        ...issue,
        message: issue.message.replace(/^编译异常：/, 'Compile error: '),
        hint: 'Check Verilog syntax and signal bit-width declarations.',
      };
    default:
      return issue;
  }
}

export function localizeGateText(text: string | undefined, locale: Locale): string {
  if (!text || locale !== 'en') return text ?? '';
  return text
    .replace(/\s*分线$/, ' split')
    .replace(/^分线$/, 'SPLIT')
    .replace(/^拼接$/, 'CONCAT')
    .replace(/^选择$/, 'sel')
    .replace(/^非零检测$/, 'nonzero')
    .replace(/^位赋值$/, 'assign')
    .replace(/^复制$/, 'REP')
    .replace(/^取位$/, 'SLICE')
    .replace(/^总线取位$/, 'slice')
    .replace(/^总线$/, 'bus')
    .replace(/^和$/, 'sum');
}
