import { BOARD_SCREEN_COLS, BOARD_SCREEN_ROWS, type SignalSample } from '../types/contracts';

export interface ScreenSyncState {
  frontBuffer?: number[];
  lastRawBuffer?: number[];
  dirtyStreak: number;
  commits: number;
}

export interface ScreenSyncOptions {
  enabled: boolean;
  maxHoldCycles: number;
}

export function createScreenSyncState(): ScreenSyncState {
  return {
    frontBuffer: undefined,
    lastRawBuffer: undefined,
    dirtyStreak: 0,
    commits: 0,
  };
}

export function advanceScreenSync(
  state: ScreenSyncState,
  samples: readonly SignalSample[],
  options: ScreenSyncOptions,
): number[] | undefined {
  for (const sample of samples) {
    const raw = sample.screenBuffer;
    if (!raw) continue;

    if (!options.enabled) {
      state.frontBuffer = raw;
      state.lastRawBuffer = raw;
      state.dirtyStreak = 0;
      state.commits += 1;
      continue;
    }

    const screen = sample.extendedOutputs?.screen;
    const cmd = screen?.cmd ?? 0;

    if (cmd === 2 || cmd === 3) {
      state.frontBuffer = raw;
      state.dirtyStreak = 0;
      state.commits += 1;
    } else if (cmd === 0) {
      if (state.dirtyStreak > 0 || !state.frontBuffer) {
        state.frontBuffer = raw;
        state.dirtyStreak = 0;
        state.commits += 1;
      }
    } else {
      const idx = screen ? screen.y * BOARD_SCREEN_COLS + screen.x : -1;
      const unchanged =
        idx >= 0 && state.lastRawBuffer !== undefined && state.lastRawBuffer[idx] === raw[idx];
      const scanWrapped =
        screen?.x === BOARD_SCREEN_COLS - 1 && screen?.y === BOARD_SCREEN_ROWS - 1;

      if (scanWrapped) {
        state.frontBuffer = raw;
        state.dirtyStreak = 0;
        state.commits += 1;
      } else if (unchanged && state.dirtyStreak > 0) {
        state.frontBuffer = raw;
        state.dirtyStreak = 0;
        state.commits += 1;
      } else {
        state.dirtyStreak += 1;
        if (state.dirtyStreak >= options.maxHoldCycles) {
          state.frontBuffer = raw;
          state.dirtyStreak = 0;
          state.commits += 1;
        }
      }
    }

    state.lastRawBuffer = raw;
  }

  return state.frontBuffer;
}
