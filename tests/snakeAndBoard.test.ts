import { describe, expect, it } from 'vitest';
import { PRESETS, RGB_CUBE_CODE, SNAKE_CODE, TETRIS_CODE } from '../src/agent/presets';
import { decodeColorQuadrants, resolveGlyphBitmap } from '../src/components/OledScreen';
import { createRtlEngine, decodeScreenCell } from '../src/engine';
import {
  BOARD_PRESETS,
  DEFAULT_BOARD_PROFILE,
  toggleBoardPeripheral,
} from '../src/services/boardProfiles';
import { advanceScreenSync, createScreenSyncState } from '../src/services/screenSync';
import { BOARD_SCREEN_COLS } from '../src/types/contracts';

function readRowAscii(buf: number[], y: number, xStart: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode((buf[y * BOARD_SCREEN_COLS + xStart + i] ?? 0) & 0xff);
  }
  return out;
}

describe('OLED 贪吃蛇完整局内行为验证', () => {
  it('编译 0 错误 0 告警，并检测出 sx/sy 一维数组与 screen/tone 外设', () => {
    const engine = createRtlEngine();
    const compiled = engine.compile(SNAKE_CODE);
    expect(compiled.ok).toBe(true);
    expect(compiled.issues).toEqual([]);
    expect(compiled.metadata?.usedOutputs).toContain('screen');
    expect(compiled.metadata?.usedOutputs).toContain('tone');
    expect(compiled.metadata?.arrays?.map((a) => a.name).sort()).toEqual(['sx', 'sy']);
  });

  it('禁止 180° 直接掉头，撞墙后清屏输出 GAME OVER，且复位可重新开局', () => {
    const engine = createRtlEngine();
    expect(engine.compile(SNAKE_CODE).ok).toBe(true);
    engine.reset();

    // Reset + 4 init cycles
    engine.step({ rst_n: 0, key: 0, sw: 0 });
    for (let i = 0; i < 4; i++) engine.step({ rst_n: 1, key: 0, sw: 0 });

    // Snake is moving RIGHT at (6,3); pressing LEFT (key=4) must be ignored
    const afterReverseAttempt = engine.step({ rst_n: 1, key: 4, sw: 0 }).sample;
    expect(afterReverseAttempt.screenBuffer![3 * 16 + 7] & 0xff).toBe(0x83);

    // Keep moving RIGHT until hitting right wall (x=15) and writing GAME OVER
    let lastSample = afterReverseAttempt;
    for (let i = 0; i < 80; i++) {
      lastSample = engine.step({ rst_n: 1, key: 0, sw: 0 }).sample;
    }

    expect(lastSample.outputs.led & 0x80).toBe(0x80);
    expect(lastSample.outputs.traffic).toBe(0b100);
    expect(readRowAscii(lastSample.screenBuffer!, 3, 3, 9)).toBe('GAME OVER');
    expect(readRowAscii(lastSample.screenBuffer!, 5, 5, 5)).toBe('R:RST');

    // Reset restarts cleanly
    const resetSample = engine.step({ rst_n: 0, key: 0, sw: 0 }).sample;
    expect(resetSample.screenBuffer!.every((v) => v === 0)).toBe(true);
    for (let i = 0; i < 4; i++) {
      lastSample = engine.step({ rst_n: 1, key: 0, sw: 0 }).sample;
    }
    expect(lastSample.outputs.led & 1).toBe(1);
    expect(lastSample.screenBuffer![3 * 16 + 6] & 0xff).toBe(0x83);
    expect(lastSample.screenBuffer![3 * 16 + 10] & 0xff).toBe(0x85);
    // 256 色调色板：蛇头应为绿色索引 8，食物应为红色索引 1
    expect(lastSample.screenBuffer![3 * 16 + 6] >>> 8).toBe(8);
    expect(lastSample.screenBuffer![3 * 16 + 10] >>> 8).toBe(1);
  });

  it('贪吃蛇预设带有 arcade 板卡与 screen 外设元数据', () => {
    const snake = PRESETS.find((p) => p.id === 'snake');
    expect(snake).toBeDefined();
    expect(snake?.boardProfileId).toBe('arcade');
    expect(snake?.requiredPeripherals).toContain('screen');
  });
});

describe('OLED 字模与板卡配置服务', () => {
  it('resolveGlyphBitmap 覆盖 ASCII 字符、0x80..0x8F 图块与 0xA0..0xAF 2×2 实心象限子块', () => {
    expect(resolveGlyphBitmap(0x00)).toBeNull();
    expect(resolveGlyphBitmap(0x47)).toHaveLength(8); // 'G'
    expect(resolveGlyphBitmap(0x30)).toHaveLength(8); // '0'
    for (let code = 0x80; code <= 0x8f; code++) {
      expect(resolveGlyphBitmap(code)).toHaveLength(8);
    }
    expect(resolveGlyphBitmap(0xa0)).toBeNull();
    expect(resolveGlyphBitmap(0xa8)).toEqual([0xf0, 0xf0, 0xf0, 0xf0, 0x00, 0x00, 0x00, 0x00]);
    expect(resolveGlyphBitmap(0xa1)).toEqual([0x00, 0x00, 0x00, 0x00, 0x0f, 0x0f, 0x0f, 0x0f]);
    expect(resolveGlyphBitmap(0xaf)).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    // 0xB0..0xBF 每象限独立 3-bit 颜色解码
    expect(decodeColorQuadrants(0x00b0)).toBeNull();
    expect(decodeColorQuadrants(0x81af)).toBeNull();
    // TL=1(青), TR=3(紫), BL=5(蓝), BR=7(红) => payload = (1<<9)|(3<<6)|(5<<3)|7 = 0x2EF
    // color = 0x2E, code = 0xBF
    expect(decodeColorQuadrants((0x2e << 8) | 0xbf)).toEqual([1, 3, 5, 7]);
  });

  it('toggleBoardPeripheral 正确在预设与自定义板卡间切换且不清空全部外设', () => {
    expect(BOARD_PRESETS.map((b) => b.profile.id)).toEqual(['classic', 'display', 'arcade']);
    const withScreen = toggleBoardPeripheral(DEFAULT_BOARD_PROFILE, 'screen');
    expect(withScreen.id).toBe('custom');
    expect(withScreen.peripherals).toContain('screen');
    expect(withScreen.primaryView).toBe('screen');

    const withoutTraffic = toggleBoardPeripheral(withScreen, 'traffic');
    expect(withoutTraffic.id).toBe('display');
  });
});

describe('256 色俄罗斯方块完整局内行为验证', () => {
  it('编译 0 错误 0 告警，并检测出 board/shown 二维数组与 screen/tone 外设', () => {
    const engine = createRtlEngine();
    const compiled = engine.compile(TETRIS_CODE);
    expect(compiled.ok).toBe(true);
    expect(compiled.issues).toEqual([]);
    expect(compiled.metadata?.usedOutputs).toContain('screen');
    expect(compiled.metadata?.usedOutputs).toContain('tone');
    expect(compiled.metadata?.arrays?.map((a) => a.name).sort()).toEqual(['board', 'shown']);
  });

  it('10×16 小方块井区：紫色 T 方块纯实心出生与触底锁定，且不同颜色相邻子块同格绝不串色', () => {
    const engine = createRtlEngine();
    expect(engine.compile(TETRIS_CODE).ok).toBe(true);

    // 复位 + 2 拍绘制初始紫色 T 方块 (id = 3)
    engine.step({ rst_n: 0, key: 0, sw: 0 });
    engine.step({ rst_n: 1, key: 0, sw: 0 });
    let sample = engine.step({ rst_n: 1, key: 0, sw: 0 }).sample;
    expect(decodeColorQuadrants(sample.screenBuffer![0 * 16 + 3])).toEqual([0, 0, 0, 3]);
    expect(decodeColorQuadrants(sample.screenBuffer![0 * 16 + 4])).toEqual([3, 0, 3, 3]);

    // 持续按住 KEY1 (S / ↓) 触发 1 kHz 软降连发（每 ~50 拍降 1 行，15 步触底锁定）
    for (let batch = 0; batch < 4; batch++) {
      sample = engine.stepBatch!({ rst_n: 1, key: 2, sw: 0 }, 220).sample;
    }
    sample = engine.stepBatch!({ rst_n: 1, key: 0, sw: 0 }, 80).sample;

    // 底部 (row 7) 应保留紫色纯实心象限块（绝不出现 0x86 砖纹）
    expect(decodeColorQuadrants(sample.screenBuffer![7 * 16 + 3])).toEqual([0, 0, 0, 3]);
    expect(decodeColorQuadrants(sample.screenBuffer![7 * 16 + 4])).toEqual([3, 0, 3, 3]);
    expect(sample.screenBuffer!.some((cell) => decodeScreenCell(cell).code === 0x86)).toBe(false);

    // 新生成的青色 I 方块 (id = 1) 应出现在井区中
    const cyanActiveCells = sample.screenBuffer!.filter((cell) => {
      const quads = decodeColorQuadrants(cell);
      return quads !== null && quads.includes(1);
    });
    expect(cyanActiveCells.length).toBeGreaterThanOrEqual(2);

    // 关键回归测试：将青色 I 方块 (id=1) 软降压在紫色 T 方块 (id=3) 正上方
    // T 方块顶在 y=14 (x=4)，青色 I 方块落在 y=13 (x=3..6)，二者在 (col=3, row=6/7) 或相邻格共享同一 8×8 字符格
    // 先把青色 I 方块顺时针旋转为竖条（x=3, y=0..3）再落到 (x=3, y=11..14) 与紫色 T 的 (x=3,y=15) 共享 (col=3, row=7)！
    sample = engine.step({ rst_n: 1, key: 1, sw: 0 }).sample; // KEY0 旋转 I 方块为竖条
    for (let batch = 0; batch < 4; batch++) {
      sample = engine.stepBatch!({ rst_n: 1, key: 2, sw: 0 }, 220).sample;
    }
    sample = engine.stepBatch!({ rst_n: 1, key: 0, sw: 0 }, 80).sample;
    // 在屏幕格 (col=3, row=7) 中：TR=(3,14) 是青色 I (id=1)，BR=(3,15) 是紫色 T (id=3)，必须各自保持独立颜色不串色！
    expect(decodeColorQuadrants(sample.screenBuffer![7 * 16 + 3])).toEqual([0, 1, 0, 3]);
    // 旁边的 (col=4, row=7) 仍保持完整紫色 T ([3, 0, 3, 3])
    expect(decodeColorQuadrants(sample.screenBuffer![7 * 16 + 4])).toEqual([3, 0, 3, 3]);

    // 左右窄墙体 (x=1 0x94, x=7 0x93, color = 240) 与右侧 HUD 文字
    expect(decodeScreenCell(sample.screenBuffer![0 * 16 + 1])).toEqual({ code: 0x94, color: 240 });
    expect(decodeScreenCell(sample.screenBuffer![0 * 16 + 7])).toEqual({ code: 0x93, color: 240 });
    expect(readRowAscii(sample.screenBuffer!, 0, 10, 4)).toBe('NEXT');
    expect(readRowAscii(sample.screenBuffer!, 3, 10, 4)).toBe('LINE');
    expect(readRowAscii(sample.screenBuffer!, 6, 10, 4)).toBe('PLAY');
  });

  it('俄罗斯方块与渐变秀预设带有 1 kHz 推荐时钟与完整外设元数据', () => {
    const tetris = PRESETS.find((p) => p.id === 'tetris');
    const rgbCube = PRESETS.find((p) => p.id === 'rgb-cube');
    const snake = PRESETS.find((p) => p.id === 'snake');
    expect(tetris?.boardProfileId).toBe('arcade');
    expect(tetris?.requiredPeripherals).toEqual(expect.arrayContaining(['screen', 'tone', 'seg']));
    expect(tetris?.recommendedClockSpeed).toBe('turbo');
    expect(rgbCube?.recommendedClockSpeed).toBe('turbo');
    expect(snake?.recommendedClockSpeed).toBe('fast');
  });

  it('OLED VSync 双缓冲在俄罗斯方块/贪吃蛇/渐变秀上均实现原子翻页、无半帧拖影', () => {
    // 1. 俄罗斯方块：脏格突发写入期间暂存后台，写完进入 cmd=0 时一次性上屏
    const tetrisEngine = createRtlEngine();
    expect(tetrisEngine.compile(TETRIS_CODE).ok).toBe(true);
    const sync = createScreenSyncState();
    const rst = tetrisEngine.step({ rst_n: 0, key: 0, sw: 0 }).sample;
    const afterReset = advanceScreenSync(sync, [rst], { enabled: true, maxHoldCycles: 128 });
    expect(afterReset?.every((v) => v === 0)).toBe(true);

    // 前 2 拍处于脏格写入中（cmd=1），frontBuffer 不应提前露出半截画面
    const partial = tetrisEngine.stepBatch!({ rst_n: 1, key: 0, sw: 0 }, 2).waveformDelta!;
    const duringBurst = advanceScreenSync(sync, partial, { enabled: true, maxHoldCycles: 128 });
    expect(duringBurst?.every((v) => v === 0)).toBe(true);

    // 跑满剩余脏格直至 cmd=0，完整棋盘与 HUD 一次性翻页呈现
    const finish = tetrisEngine.stepBatch!({ rst_n: 1, key: 0, sw: 0 }, 60).waveformDelta!;
    const committed = advanceScreenSync(sync, finish, { enabled: true, maxHoldCycles: 128 })!;
    expect(decodeColorQuadrants(committed[0 * 16 + 3])).toEqual([0, 0, 0, 3]);
    expect(readRowAscii(committed, 0, 10, 4)).toBe('NEXT');

    // 2. 256 色 RGB 立方渐变秀：扫到 (15,7) 整帧结束时一次性翻页
    const cubeEngine = createRtlEngine();
    expect(cubeEngine.compile(RGB_CUBE_CODE).ok).toBe(true);
    const cubeSync = createScreenSyncState();
    advanceScreenSync(cubeSync, [cubeEngine.step({ rst_n: 0, key: 0, sw: 0 }).sample], {
      enabled: true,
      maxHoldCycles: 128,
    });
    const halfScan = cubeEngine.stepBatch!({ rst_n: 1, key: 0, sw: 0 }, 64).waveformDelta!;
    const midFrame = advanceScreenSync(cubeSync, halfScan, { enabled: true, maxHoldCycles: 128 })!;
    expect(midFrame.every((v) => v === 0)).toBe(true);
    const restScan = cubeEngine.stepBatch!({ rst_n: 1, key: 0, sw: 0 }, 64).waveformDelta!;
    const fullFrame = advanceScreenSync(cubeSync, restScan, { enabled: true, maxHoldCycles: 128 })!;
    expect(fullFrame.every((v) => decodeScreenCell(v).code === 0x80)).toBe(true);
  });
});

describe('256 色 RGB 立方渐变秀与 Linter 校验', () => {
  it('编译 0 错误 0 告警，4 种视觉模式均输出真实 256 色', () => {
    const engine = createRtlEngine();
    const compiled = engine.compile(RGB_CUBE_CODE);
    expect(compiled.ok).toBe(true);
    expect(compiled.issues).toEqual([]);
    expect(compiled.metadata?.usedOutputs).toContain('screen');

    // Mode 0: RGB 立方渐变流（128 拍扫完一帧，覆盖大量 16..231 色立方颜色）
    engine.step({ rst_n: 0, key: 0, sw: 0 });
    const mode0 = engine.stepBatch!({ rst_n: 1, key: 0, sw: 0 }, 128).sample;
    const cubeColors = new Set(
      mode0.screenBuffer!.map((cell) => decodeScreenCell(cell).color),
    );
    expect(cubeColors.size).toBeGreaterThanOrEqual(24);
    for (const c of cubeColors) {
      expect(c).toBeGreaterThanOrEqual(16);
      expect(c).toBeLessThanOrEqual(231);
    }

    // Mode 1: 彩虹频谱柱（含亮白波峰帽 0x91 / color 231）
    const mode1 = engine.stepBatch!({ rst_n: 1, key: 0, sw: 1 }, 128).sample;
    const capCells = mode1.screenBuffer!.filter((cell) => {
      const { code, color } = decodeScreenCell(cell);
      return code === 0x91 && color === 231;
    });
    expect(capCells.length).toBeGreaterThanOrEqual(12);

    // Mode 2: 霓虹等离子涟漪（同时包含实心块 0x80 与网格块 0x90）
    const mode2 = engine.stepBatch!({ rst_n: 1, key: 0, sw: 2 }, 128).sample;
    expect(mode2.screenBuffer!.some((c) => decodeScreenCell(c).code === 0x80)).toBe(true);
    expect(mode2.screenBuffer!.some((c) => decodeScreenCell(c).code === 0x90)).toBe(true);

    // Mode 3: 全 256 色板巡检（Page 0: 0..127，Page 1: 128..255）
    engine.step({ rst_n: 0, key: 0, sw: 3 });
    const page0 = engine.stepBatch!({ rst_n: 1, key: 0, sw: 3 }, 128).sample;
    for (let i = 0; i < 128; i++) {
      expect(decodeScreenCell(page0.screenBuffer![i])).toEqual({ code: 0x80, color: i });
    }
    const page1 = engine.stepBatch!({ rst_n: 1, key: 0, sw: 7 }, 128).sample;
    for (let i = 0; i < 128; i++) {
      expect(decodeScreenCell(page1.screenBuffer![i])).toEqual({ code: 0x80, color: 128 + i });
    }
  });

  it('只声明 screen_color 而缺少 screen_x/y/data/cmd 时触发 PORT_MISMATCH', () => {
    const engine = createRtlEngine();
    const broken = `module top (
      input clk, input rst_n, input [3:0] key, input [7:0] sw,
      output [7:0] led, output [2:0] traffic, output [15:0] seg,
      output [7:0] screen_color
    );
      assign led = 8'd0;
      assign traffic = 3'd0;
      assign seg = 16'd0;
      assign screen_color = 8'd1;
    endmodule`;
    const res = engine.compile(broken);
    expect(res.ok).toBe(false);
    expect(res.issues.some((issue) => issue.code === 'PORT_MISMATCH')).toBe(true);
  });
});
