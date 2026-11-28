import type { BoardPeripheralId, BoardProfile, BoardProfileId } from '../types/contracts';

const BOARD_PROFILE_STORAGE_KEY = 'fpgagent.boardProfile';

export interface BoardPeripheralMeta {
  id: BoardPeripheralId;
  labelZh: string;
  labelEn: string;
  portHint: string;
  descZh: string;
  descEn: string;
}

export const BOARD_PERIPHERAL_LIST: BoardPeripheralMeta[] = [
  {
    id: 'led',
    labelZh: '8 位 LED',
    labelEn: '8-bit LEDs',
    portHint: 'led[7:0]',
    descZh: '基础状态指示灯',
    descEn: 'Status indicator LEDs',
  },
  {
    id: 'traffic',
    labelZh: '交通信号灯',
    labelEn: 'Traffic Lights',
    portHint: 'traffic[2:0]',
    descZh: '红 / 黄 / 绿三色灯组',
    descEn: 'Red / Yellow / Green lamps',
  },
  {
    id: 'seg',
    labelZh: '4 位数码管',
    labelEn: '4-Digit 7-Seg',
    portHint: 'seg[15:0]',
    descZh: '4 组 4-bit BCD / Hex 数码显示',
    descEn: 'Four 4-bit BCD / Hex digits',
  },
  {
    id: 'screen',
    labelZh: '16×8 彩色 OLED',
    labelEn: '16×8 Color OLED',
    portHint: 'screen_x/y/data/cmd/color',
    descZh: '等效 128×64 像素 256 色字符/图块屏（兼容单色）',
    descEn: '128×64 256-color char & tile OLED (mono compatible)',
  },
  {
    id: 'tone',
    labelZh: '板载蜂鸣器',
    labelEn: 'Buzzer (Tone)',
    portHint: 'tone[3:0]',
    descZh: '4-bit 音阶与提示音编码输出',
    descEn: '4-bit musical note & alert tone',
  },
];

export interface BoardPresetInfo {
  profile: BoardProfile;
  nameEn: string;
  descriptionEn: string;
  badgeZh: string;
  badgeEn: string;
}

export const BOARD_PRESETS: BoardPresetInfo[] = [
  {
    profile: {
      id: 'classic',
      name: '经典教学板',
      description: '配备 8 位 LED、红黄绿交通灯、4 位数码管与 4 按键 8 拨码，适合状态机、计数器与门级慢动作教学。',
      peripherals: ['led', 'traffic', 'seg'],
      primaryView: 'netlist',
    },
    nameEn: 'Classic Teaching Board',
    descriptionEn: '8 LEDs, traffic lamps, 4-digit 7-seg, 4 keys & 8 switches. Built for FSMs, counters, and gate-level inspection.',
    badgeZh: '默认教学',
    badgeEn: 'Default',
  },
  {
    profile: {
      id: 'display',
      name: '屏显终端板',
      description: '在基础 I/O 上挂载 16×8（128×64 像素）256 色 OLED 屏，适合彩虹频谱、彩色仪表界面与字符终端。',
      peripherals: ['led', 'seg', 'screen'],
      primaryView: 'screen',
    },
    nameEn: 'OLED Terminal Board',
    descriptionEn: 'Adds a 16×8 (128×64 px) 256-color OLED screen alongside LEDs and 7-seg for spectrums, gauges, and terminals.',
    badgeZh: '256 色 OLED',
    badgeEn: '256-Color OLED',
  },
  {
    profile: {
      id: 'arcade',
      name: '互动游戏板',
      description: '集成 16×8 256 色 OLED、十字方向键（WASD 映射）、蜂鸣器与数码管计分，专为俄罗斯方块、贪吃蛇等游戏电路打造。',
      peripherals: ['led', 'seg', 'screen', 'tone'],
      primaryView: 'screen',
    },
    nameEn: 'Interactive Arcade Board',
    descriptionEn: 'Combines 16×8 256-color OLED, WASD D-Pad controls, buzzer tone, and 7-seg score for Tetris, Snake, and arcade games.',
    badgeZh: '游戏开发',
    badgeEn: 'Arcade',
  },
];

export const DEFAULT_BOARD_PROFILE: BoardProfile = BOARD_PRESETS[0].profile;

const VALID_PERIPHERALS = new Set<BoardPeripheralId>(['led', 'traffic', 'seg', 'tone', 'screen']);

export function getBoardPresetById(id: BoardProfileId): BoardProfile | undefined {
  return BOARD_PRESETS.find((item) => item.profile.id === id)?.profile;
}

export function boardHasPeripheral(profile: BoardProfile, peripheral: BoardPeripheralId): boolean {
  return profile.peripherals.includes(peripheral);
}

export function toggleBoardPeripheral(profile: BoardProfile, peripheral: BoardPeripheralId): BoardProfile {
  const exists = profile.peripherals.includes(peripheral);
  const nextPeripherals = exists
    ? profile.peripherals.filter((p) => p !== peripheral)
    : [...profile.peripherals, peripheral];

  // Keep at least one peripheral enabled so the board never becomes empty.
  if (nextPeripherals.length === 0) return profile;

  const matched = BOARD_PRESETS.find(
    (item) =>
      item.profile.peripherals.length === nextPeripherals.length &&
      item.profile.peripherals.every((p) => nextPeripherals.includes(p)),
  );
  if (matched) return matched.profile;

  return {
    id: 'custom',
    name: '自定义开发板',
    description: '按需组合板载外设配置。',
    peripherals: nextPeripherals,
    primaryView: nextPeripherals.includes('screen') ? 'screen' : 'netlist',
  };
}

export function loadBoardProfile(): BoardProfile {
  if (typeof window === 'undefined') return DEFAULT_BOARD_PROFILE;
  try {
    const raw = window.localStorage.getItem(BOARD_PROFILE_STORAGE_KEY);
    if (!raw) return DEFAULT_BOARD_PROFILE;
    const parsed = JSON.parse(raw) as Partial<BoardProfile> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_BOARD_PROFILE;
    if (parsed.id && parsed.id !== 'custom') {
      const preset = getBoardPresetById(parsed.id);
      if (preset) return preset;
    }
    if (Array.isArray(parsed.peripherals)) {
      const cleaned = parsed.peripherals.filter(
        (p): p is BoardPeripheralId => typeof p === 'string' && VALID_PERIPHERALS.has(p as BoardPeripheralId),
      );
      if (cleaned.length > 0) {
        return {
          id: 'custom',
          name: '自定义开发板',
          description: '按需组合板载外设配置。',
          peripherals: Array.from(new Set(cleaned)),
          primaryView: cleaned.includes('screen') ? 'screen' : 'netlist',
        };
      }
    }
  } catch {
    // Ignore storage read errors.
  }
  return DEFAULT_BOARD_PROFILE;
}

export function saveBoardProfile(profile: BoardProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BOARD_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage write errors.
  }
}
