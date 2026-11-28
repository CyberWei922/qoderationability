import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Gamepad2,
  Grid2x2,
  Layers,
  Palette,
  RotateCcw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SCREEN_PALETTE } from '../engine';
import { useI18n } from '../services/i18n';
import {
  clearAllPaletteOverrides,
  clearPaletteOverride,
  loadPaletteOverrides,
  paletteSnapshot,
  setPaletteOverride,
  subscribePaletteChange,
} from '../services/screenPalette';
import type { BoardInputs, BoardOutputs } from '../types/contracts';
import { OLED_TINT_CONFIG, OledScreen, type OledTint } from './OledScreen';
import { ClockControls, formatClockFrequency, type ClockSpeed } from './TopBar';
import { VirtualBoard } from './VirtualBoard';

export type ScreenKeyLayout = 'dpad' | 'classic';

type KeyTarget = { kind: 'key'; index: number } | { kind: 'rst' };

const COMMON_KEY_CODES: Record<string, KeyTarget> = {
  Digit1: { kind: 'key', index: 0 },
  Numpad1: { kind: 'key', index: 0 },
  Digit2: { kind: 'key', index: 1 },
  Numpad2: { kind: 'key', index: 1 },
  Digit3: { kind: 'key', index: 2 },
  Numpad3: { kind: 'key', index: 2 },
  Digit4: { kind: 'key', index: 3 },
  Numpad4: { kind: 'key', index: 3 },
  KeyR: { kind: 'rst' },
};

const DPAD_KEY_CODES: Record<string, KeyTarget> = {
  KeyW: { kind: 'key', index: 0 },
  ArrowUp: { kind: 'key', index: 0 },
  KeyS: { kind: 'key', index: 1 },
  ArrowDown: { kind: 'key', index: 1 },
  KeyA: { kind: 'key', index: 2 },
  ArrowLeft: { kind: 'key', index: 2 },
  KeyD: { kind: 'key', index: 3 },
  ArrowRight: { kind: 'key', index: 3 },
};

const DPAD_ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function isEditableTarget(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(node.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], dialog[open]'));
}

function resolveScreenKey(
  event: globalThis.KeyboardEvent,
  layout: ScreenKeyLayout,
): { id: string; target: KeyTarget } | null {
  if (layout === 'dpad' && event.code && DPAD_KEY_CODES[event.code]) {
    return { id: event.code, target: DPAD_KEY_CODES[event.code] };
  }
  if (event.code && COMMON_KEY_CODES[event.code]) {
    return { id: event.code, target: COMMON_KEY_CODES[event.code] };
  }
  const lower = event.key.toLowerCase();
  if (layout === 'dpad') {
    if (lower === 'w' || event.key === 'ArrowUp') return { id: `k:${event.key}`, target: { kind: 'key', index: 0 } };
    if (lower === 's' || event.key === 'ArrowDown') return { id: `k:${event.key}`, target: { kind: 'key', index: 1 } };
    if (lower === 'a' || event.key === 'ArrowLeft') return { id: `k:${event.key}`, target: { kind: 'key', index: 2 } };
    if (lower === 'd' || event.key === 'ArrowRight') return { id: `k:${event.key}`, target: { kind: 'key', index: 3 } };
  }
  if (lower === '1') return { id: 'k:1', target: { kind: 'key', index: 0 } };
  if (lower === '2') return { id: 'k:2', target: { kind: 'key', index: 1 } };
  if (lower === '3') return { id: 'k:3', target: { kind: 'key', index: 2 } };
  if (lower === '4') return { id: 'k:4', target: { kind: 'key', index: 3 } };
  if (lower === 'r') return { id: 'k:r', target: { kind: 'rst' } };
  return null;
}

const bit = (value: number, index: number) => Boolean(value & (1 << index));

function KeyButton({
  className,
  ariaLabel,
  title,
  pressed,
  disabled,
  onPress,
  children,
}: {
  className?: string;
  ariaLabel: string;
  title: string;
  pressed: boolean;
  disabled: boolean;
  onPress: (down: boolean) => void;
  children: ReactNode;
}) {
  function onKey(event: KeyboardEvent<HTMLButtonElement>, down: boolean) {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) onPress(down);
  }

  return (
    <button
      type="button"
      className={className ? `screen-key-btn ${className}` : 'screen-key-btn'}
      aria-label={ariaLabel}
      title={title}
      data-pressed={pressed}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress(true);
      }}
      onPointerUp={() => onPress(false)}
      onPointerCancel={() => onPress(false)}
      onKeyDown={(event) => onKey(event, true)}
      onKeyUp={(event) => onKey(event, false)}
      onClick={(event) => {
        if (event.detail !== 0) return;
        onPress(true);
        onPress(false);
      }}
      onBlur={() => {
        if (pressed) onPress(false);
      }}
    >
      {children}
    </button>
  );
}

const TINT_ORDER: OledTint[] = ['white', 'green', 'ice'];

const BASE_COLOR_NAMES: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: '默认荧光', en: 'Default' },
  { zh: '红', en: 'Red' },
  { zh: '琥珀', en: 'Amber' },
  { zh: '青', en: 'Cyan' },
  { zh: '品红', en: 'Magenta' },
  { zh: '白', en: 'White' },
  { zh: '蓝', en: 'Blue' },
  { zh: '紫', en: 'Purple' },
  { zh: '绿', en: 'Green' },
  { zh: '橙', en: 'Orange' },
  { zh: '蒂芙尼', en: 'Teal' },
  { zh: '粉', en: 'Pink' },
  { zh: '黄', en: 'Yellow' },
  { zh: '天蓝', en: 'Sky' },
  { zh: '灰', en: 'Gray' },
  { zh: '暗绿', en: 'Dark Green' },
];

function ScreenPaletteDialog({ onClose }: { onClose: () => void }) {
  const { L } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(1);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, []);

  useEffect(() => subscribePaletteChange(() => setVersion((v) => v + 1)), []);

  const { colors, overrides } = useMemo(
    () => ({
      colors: paletteSnapshot(),
      overrides: loadPaletteOverrides(),
    }),
    [version],
  );

  const overrideCount = Object.keys(overrides).length;
  const activeHex = colors[selected] ?? SCREEN_PALETTE[0];
  const defaultHex = SCREEN_PALETTE[selected] ?? SCREEN_PALETTE[0];
  const isOverridden = overrides[selected] !== undefined;

  const selectedDesc =
    selected < 16
      ? L(BASE_COLOR_NAMES[selected].zh, BASE_COLOR_NAMES[selected].en)
      : selected < 232
        ? (() => {
            const idx = selected - 16;
            const r = Math.floor(idx / 36);
            const g = Math.floor((idx % 36) / 6);
            const b = idx % 6;
            return `RGB(${r},${g},${b})`;
          })()
        : L(`灰阶 #${selected - 232}`, `Gray #${selected - 232}`);

  return (
    <dialog
      ref={dialogRef}
      className="palette-dialog"
      aria-labelledby="screen-palette-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="dialog-heading">
        <div className="dialog-title-group">
          <Palette size={17} />
          <h2 id="screen-palette-title">{L('256 色屏幕调色板', '256-Color Screen Palette')}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={L('关闭调色板', 'Close palette')}
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} />
        </button>
      </div>

      <div className="palette-dialog-body">
        <div className="palette-inspector">
          <div className="palette-inspector-swatch" style={{ background: activeHex }} />
          <div className="palette-inspector-info">
            <div className="palette-inspector-title">
              <strong className="mono">#{selected}</strong>
              <span className="mono">8&apos;d{selected}</span>
              <span className="mono">8&apos;h{selected.toString(16).toUpperCase().padStart(2, '0')}</span>
              <span className="palette-inspector-tag">{selectedDesc}</span>
            </div>
            <p className="field-help">
              {L(
                `当前色值 ${activeHex.toUpperCase()}${isOverridden ? `（已自定义，默认 ${defaultHex.toUpperCase()}）` : '（默认色板）'}`,
                `Color ${activeHex.toUpperCase()}${isOverridden ? ` (customized, default ${defaultHex.toUpperCase()})` : ' (default)'}`,
              )}
            </p>
          </div>
          <div className="palette-inspector-actions">
            <label className="outline-button compact-btn palette-color-picker">
              <input
                type="color"
                aria-label={L(`自定义色号 #${selected}`, `Customize color #${selected}`)}
                value={activeHex}
                onChange={(event) => setPaletteOverride(selected, event.target.value)}
              />
              <span>{L('微调颜色', 'Edit Color')}</span>
            </label>
            {isOverridden && (
              <button
                type="button"
                className="outline-button compact-btn"
                onClick={() => clearPaletteOverride(selected)}
              >
                {L('恢复默认', 'Reset')}
              </button>
            )}
          </div>
        </div>

        <section className="palette-group">
          <div className="palette-group-head">
            <h3>{L('基础 16 色（0–15 · 0 为默认单色）', 'Base 16 (0–15 · 0 = Mono Default)')}</h3>
          </div>
          <div className="palette-grid base-grid">
            {colors.slice(0, 16).map((hex, i) => (
              <button
                key={i}
                type="button"
                className={`palette-swatch${selected === i ? ' selected' : ''}${overrides[i] ? ' customized' : ''}`}
                style={{ background: hex }}
                title={`#${i} ${L(BASE_COLOR_NAMES[i].zh, BASE_COLOR_NAMES[i].en)} (${hex})`}
                aria-label={`#${i} ${hex}`}
                onClick={() => setSelected(i)}
              />
            ))}
          </div>
        </section>

        <section className="palette-group">
          <div className="palette-group-head">
            <h3>{L('6×6×6 RGB 色立方（16–231 · 16 + 36r + 6g + b）', '6×6×6 RGB Cube (16–231 · 16 + 36r + 6g + b)')}</h3>
          </div>
          <div className="palette-grid cube-grid">
            {colors.slice(16, 232).map((hex, offset) => {
              const i = 16 + offset;
              return (
                <button
                  key={i}
                  type="button"
                  className={`palette-swatch${selected === i ? ' selected' : ''}${overrides[i] ? ' customized' : ''}`}
                  style={{ background: hex }}
                  title={`#${i} (${hex})`}
                  aria-label={`#${i} ${hex}`}
                  onClick={() => setSelected(i)}
                />
              );
            })}
          </div>
        </section>

        <section className="palette-group">
          <div className="palette-group-head">
            <h3>{L('24 级灰阶（232–255）', '24-Step Grayscale (232–255)')}</h3>
          </div>
          <div className="palette-grid gray-grid">
            {colors.slice(232, 256).map((hex, offset) => {
              const i = 232 + offset;
              return (
                <button
                  key={i}
                  type="button"
                  className={`palette-swatch${selected === i ? ' selected' : ''}${overrides[i] ? ' customized' : ''}`}
                  style={{ background: hex }}
                  title={`#${i} (${hex})`}
                  aria-label={`#${i} ${hex}`}
                  onClick={() => setSelected(i)}
                />
              );
            })}
          </div>
        </section>
      </div>

      <footer className="dialog-actions">
        {overrideCount > 0 && (
          <button
            type="button"
            className="outline-button"
            onClick={() => clearAllPaletteOverrides()}
          >
            {L(`全部恢复默认 (${overrideCount})`, `Reset All (${overrideCount})`)}
          </button>
        )}
        <button type="button" className="primary-button" onClick={() => dialogRef.current?.close()}>
          {L('完成', 'Done')}
        </button>
      </footer>
    </dialog>
  );
}

export function ScreenView({
  screenBuffer,
  hasScreenOutput,
  compiled,
  filename,
  cycle,
  inputs,
  outputs,
  onInputsChange,
  speed,
  running,
  onSpeed,
  onToggle,
  onStep,
  keyLayout,
  onKeyLayoutChange,
  vsync = true,
  onToggleVsync,
}: {
  screenBuffer?: number[];
  hasScreenOutput: boolean;
  compiled: boolean;
  filename?: string;
  cycle?: number;
  inputs: BoardInputs;
  outputs?: BoardOutputs;
  onInputsChange: (inputs: BoardInputs) => void;
  speed: ClockSpeed;
  running: boolean;
  onSpeed: (speed: ClockSpeed) => void;
  onToggle: () => void;
  onStep: () => void;
  keyLayout: ScreenKeyLayout;
  onKeyLayoutChange: (layout: ScreenKeyLayout) => void;
  vsync?: boolean;
  onToggleVsync?: () => void;
}) {
  const { locale, L } = useI18n();
  const [tint, setTint] = useState<OledTint>('white');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overrideCount, setOverrideCount] = useState(() => Object.keys(loadPaletteOverrides()).length);

  useEffect(
    () => subscribePaletteChange(() => setOverrideCount(Object.keys(loadPaletteOverrides()).length)),
    [],
  );

  const isColorActive = useMemo(
    () =>
      Boolean(
        hasScreenOutput &&
          screenBuffer?.some(
            (cell) => (cell >>> 8) > 0 || ((cell & 0xf0) === 0xb0 && (cell & 0x0f) > 0),
          ),
      ),
    [hasScreenOutput, screenBuffer],
  );

  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const onInputsChangeRef = useRef(onInputsChange);
  onInputsChangeRef.current = onInputsChange;

  const keyboardHeldRef = useRef(new Map<string, KeyTarget>());
  const pointerHeldRef = useRef({ keyMask: 0, rst: false });

  const syncPressedInputs = useCallback(() => {
    let keyMask = pointerHeldRef.current.keyMask;
    let rstPressed = pointerHeldRef.current.rst;
    for (const target of keyboardHeldRef.current.values()) {
      if (target.kind === 'key') keyMask |= 1 << target.index;
      else rstPressed = true;
    }
    const nextRstN: 0 | 1 = rstPressed ? 0 : 1;
    const prev = inputsRef.current;
    if (prev.key === keyMask && prev.rst_n === nextRstN) return;
    onInputsChangeRef.current({ ...prev, key: keyMask, rst_n: nextRstN });
  }, []);

  const releaseAllKeyboard = useCallback(() => {
    if (keyboardHeldRef.current.size === 0) return;
    keyboardHeldRef.current.clear();
    syncPressedInputs();
  }, [syncPressedInputs]);

  useEffect(() => {
    if (!compiled) {
      keyboardHeldRef.current.clear();
      pointerHeldRef.current = { keyMask: 0, rst: false };
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      const resolved = resolveScreenKey(event, keyLayout);
      if (!resolved) return;
      if (keyLayout === 'dpad' && DPAD_ARROW_KEYS.has(event.key)) {
        event.preventDefault();
      }
      if (event.repeat || keyboardHeldRef.current.has(resolved.id)) return;
      keyboardHeldRef.current.set(resolved.id, resolved.target);
      syncPressedInputs();
    };

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      const resolved = resolveScreenKey(event, keyLayout);
      if (!resolved) return;
      if (!keyboardHeldRef.current.delete(resolved.id)) return;
      syncPressedInputs();
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isEditableTarget(event.target)) releaseAllKeyboard();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) releaseAllKeyboard();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseAllKeyboard);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseAllKeyboard);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseAllKeyboard();
    };
  }, [compiled, keyLayout, releaseAllKeyboard, syncPressedInputs]);

  function setPointerKey(index: number, down: boolean) {
    pointerHeldRef.current.keyMask = down
      ? pointerHeldRef.current.keyMask | (1 << index)
      : pointerHeldRef.current.keyMask & ~(1 << index);
    syncPressedInputs();
  }

  function setPointerRst(down: boolean) {
    pointerHeldRef.current.rst = down;
    syncPressedInputs();
  }

  const disabled = !compiled;

  return (
    <div className="wb-screen-view">
      <div className="schematic-subheader">
        <div className="schematic-title">
          <h2>{L('256 色 OLED 屏幕', '256-Color OLED')}</h2>
          <span className="file-chip mono">16×8 · 128×64</span>
          {hasScreenOutput && (
            <span className={`color-mode-pill${isColorActive ? ' active' : ''}`}>
              <span className="color-mode-dot" aria-hidden="true" />
              {isColorActive ? L('256 色激活', '256-Color') : L('单色兼容', 'Mono')}
            </span>
          )}
          {filename && <span className="file-chip mono">{filename}</span>}
          {cycle !== undefined && (
            <span className="instrument-meta mono">
              {formatClockFrequency(speed)} · CLK ↑ {cycle}
            </span>
          )}
        </div>

        <div className="screen-subheader-right">
          <div className="oled-tint-picker" role="group" aria-label={L('默认单色底色（色号 0）', 'Default tint (color 0)')}>
            {TINT_ORDER.map((id) => {
              const cfg = OLED_TINT_CONFIG[id];
              const active = tint === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`oled-tint-dot${active ? ' active' : ''}`}
                  aria-pressed={active}
                  title={L(`色号 0 默认底色：${cfg.labelZh}`, `Color 0 default tint: ${cfg.labelEn}`)}
                  aria-label={L(`色号 0 默认底色：${cfg.labelZh}`, `Color 0 default tint: ${cfg.labelEn}`)}
                  onClick={() => setTint(id)}
                >
                  <span style={{ background: cfg.lit }} />
                </button>
              );
            })}
          </div>

          {onToggleVsync && (
            <button
              type="button"
              className={`vsync-toggle-btn${vsync ? ' active' : ''}`}
              aria-pressed={vsync}
              onClick={onToggleVsync}
              title={L(
                '双缓冲帧同步：等待一帧脏格写完再一次性上屏，消除半帧拖影',
                'VSync double buffering: holds partial cell writes and flips atomically to eliminate ghosting',
              )}
            >
              <Layers size={13} />
              <span>{L('双缓冲', 'VSync')}</span>
            </button>
          )}

          <button
            type="button"
            className={`palette-trigger-btn${overrideCount > 0 ? ' has-overrides' : ''}`}
            onClick={() => setPaletteOpen(true)}
            title={L('查看或自定义 256 色调色板', 'Inspect or customize the 256-color palette')}
          >
            <Palette size={13} />
            <span>{L('调色板', 'Palette')}</span>
            {overrideCount > 0 && <span className="palette-badge mono">{overrideCount}</span>}
          </button>

          <ClockControls
            speed={speed}
            running={running}
            disabled={disabled}
            showFast
            onSpeed={onSpeed}
            onToggle={onToggle}
            onStep={onStep}
          />
        </div>
      </div>

      <div className="screen-stage">
        <div className="screen-stage-inner">
          <div className="oled-chassis">
            <OledScreen
              buffer={hasScreenOutput ? screenBuffer : undefined}
              tint={tint}
              ariaLabel={L('16×8 256 色 OLED 屏幕 (128×64 像素)', '16×8 256-Color OLED Screen (128×64 px)')}
            />
          </div>

          {!compiled ? (
            <p className="screen-idle-note">
              {L(
                '当前尚未载入电路。可从左侧「案例」运行俄罗斯方块、贪吃蛇或 256 色渐变秀，或直接对话生成彩色屏幕电路。',
                'No circuit loaded yet. Run Tetris, Snake, or the 256-Color RGB Cube demo from Demos, or prompt AI to generate one.',
              )}
            </p>
          ) : !hasScreenOutput ? (
            <p className="screen-idle-note">
              {L(
                '当前电路未驱动 screen_x/y/data/cmd（及可选 screen_color）端口，屏幕保持待机黑屏。',
                'The active circuit does not drive screen_x/y/data/cmd (and optional screen_color) ports; OLED remains idle.',
              )}
            </p>
          ) : null}

          <section className="screen-controls-dock" aria-label={L('屏幕按键控制区', 'Screen Key Controls')}>
            <div className="screen-controls-head">
              <span className="screen-controls-title">
                {keyLayout === 'dpad'
                  ? L('方向键控制（KEY0–KEY3）', 'D-Pad Controls (KEY0–KEY3)')
                  : L('经典四按键（KEY0–KEY3）', 'Classic Keys (KEY0–KEY3)')}
              </span>
              <div className="screen-layout-switch" role="group" aria-label={L('按键排布切换', 'Key layout switch')}>
                <button
                  type="button"
                  aria-pressed={keyLayout === 'dpad'}
                  onClick={() => onKeyLayoutChange('dpad')}
                >
                  <Gamepad2 size={12} />
                  <span>{L('方向键', 'D-Pad')}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={keyLayout === 'classic'}
                  onClick={() => onKeyLayoutChange('classic')}
                >
                  <Grid2x2 size={12} />
                  <span>{L('经典排布', 'Classic')}</span>
                </button>
              </div>
            </div>

            {keyLayout === 'dpad' ? (
              <div className="screen-dpad-row">
                <div className="dpad-cluster" role="group" aria-label={L('上下左右方向键', 'Directional pad')}>
                  <div className="dpad-spacer" aria-hidden="true" />
                  <KeyButton
                    className="dpad-btn"
                    ariaLabel={L('上 · KEY0（快捷键 W / ↑）', 'Up · KEY0 (W / Up)')}
                    title={L('上 · KEY0（键盘 W / ↑ / 1）', 'Up · KEY0 (W / ArrowUp / 1)')}
                    pressed={bit(inputs.key, 0)}
                    disabled={disabled}
                    onPress={(down) => setPointerKey(0, down)}
                  >
                    <ArrowUp size={16} strokeWidth={2.3} />
                    <span className="dpad-meta">
                      <kbd>W</kbd>
                      <small>K0</small>
                    </span>
                  </KeyButton>
                  <div className="dpad-spacer" aria-hidden="true" />

                  <KeyButton
                    className="dpad-btn"
                    ariaLabel={L('左 · KEY2（快捷键 A / ←）', 'Left · KEY2 (A / Left)')}
                    title={L('左 · KEY2（键盘 A / ← / 3）', 'Left · KEY2 (A / ArrowLeft / 3)')}
                    pressed={bit(inputs.key, 2)}
                    disabled={disabled}
                    onPress={(down) => setPointerKey(2, down)}
                  >
                    <ArrowLeft size={16} strokeWidth={2.3} />
                    <span className="dpad-meta">
                      <kbd>A</kbd>
                      <small>K2</small>
                    </span>
                  </KeyButton>
                  <KeyButton
                    className="dpad-btn"
                    ariaLabel={L('下 · KEY1（快捷键 S / ↓）', 'Down · KEY1 (S / Down)')}
                    title={L('下 · KEY1（键盘 S / ↓ / 2）', 'Down · KEY1 (S / ArrowDown / 2)')}
                    pressed={bit(inputs.key, 1)}
                    disabled={disabled}
                    onPress={(down) => setPointerKey(1, down)}
                  >
                    <ArrowDown size={16} strokeWidth={2.3} />
                    <span className="dpad-meta">
                      <kbd>S</kbd>
                      <small>K1</small>
                    </span>
                  </KeyButton>
                  <KeyButton
                    className="dpad-btn"
                    ariaLabel={L('右 · KEY3（快捷键 D / →）', 'Right · KEY3 (D / Right)')}
                    title={L('右 · KEY3（键盘 D / → / 4）', 'Right · KEY3 (D / ArrowRight / 4)')}
                    pressed={bit(inputs.key, 3)}
                    disabled={disabled}
                    onPress={(down) => setPointerKey(3, down)}
                  >
                    <ArrowRight size={16} strokeWidth={2.3} />
                    <span className="dpad-meta">
                      <kbd>D</kbd>
                      <small>K3</small>
                    </span>
                  </KeyButton>
                </div>

                <div className="dpad-side-actions">
                  <KeyButton
                    className="rst-btn"
                    ariaLabel={L('硬件复位 RST（快捷键 R）', 'Reset RST (shortcut R)')}
                    title={L('低电平复位 rst_n=0（键盘 R）', 'Active-low reset rst_n=0 (key R)')}
                    pressed={inputs.rst_n === 0}
                    disabled={disabled}
                    onPress={setPointerRst}
                  >
                    <RotateCcw size={15} strokeWidth={2.1} />
                    <span>RST</span>
                    <kbd>R</kbd>
                  </KeyButton>
                </div>
              </div>
            ) : (
              <div className="screen-classic-keys" role="group" aria-label={L('经典四按键', 'Classic board keys')}>
                {[0, 1, 2, 3].map((index) => (
                  <KeyButton
                    key={index}
                    className="classic-key-btn"
                    ariaLabel={L(`KEY${index}（快捷键 ${index + 1}）`, `KEY${index} (key ${index + 1})`)}
                    title={L(`KEY${index}（键盘 ${index + 1}）`, `KEY${index} (key ${index + 1})`)}
                    pressed={bit(inputs.key, index)}
                    disabled={disabled}
                    onPress={(down) => setPointerKey(index, down)}
                  >
                    <span>KEY{index}</span>
                    <kbd>{index + 1}</kbd>
                  </KeyButton>
                ))}
                <KeyButton
                  className="classic-key-btn"
                  ariaLabel={L('硬件复位 RST（快捷键 R）', 'Reset RST (key R)')}
                  title={L('硬件复位 RST（键盘 R）', 'Reset RST (key R)')}
                  pressed={inputs.rst_n === 0}
                  disabled={disabled}
                  onPress={setPointerRst}
                >
                  <span>RST</span>
                  <kbd>R</kbd>
                </KeyButton>
              </div>
            )}

            <p className="screen-key-hint">
              {keyLayout === 'dpad' ? (
                locale === 'en' ? (
                  <>
                    Keyboard: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> → KEY0–KEY3 · <kbd>R</kbd> Reset
                  </>
                ) : (
                  <>
                    键盘映射：<kbd>W</kbd><kbd>S</kbd><kbd>A</kbd><kbd>D</kbd> 或 <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 对应 KEY0–KEY3 · <kbd>R</kbd> 复位
                  </>
                )
              ) : locale === 'en' ? (
                <>
                  Keyboard: <kbd>1</kbd>–<kbd>4</kbd> → KEY0–KEY3 · <kbd>R</kbd> Reset
                </>
              ) : (
                <>
                  键盘映射：<kbd>1</kbd>–<kbd>4</kbd> 对应 KEY0–KEY3 · <kbd>R</kbd> 复位
                </>
              )}
            </p>
          </section>

          <section className="screen-board-dock" aria-label={L('板载 I/O 外设', 'Board I/O Peripherals')}>
            <div className="screen-board-dock-head">
              <h2>{L('板载 I/O 外设（数码管 / 指示灯 / 拨码开关）', 'Board I/O (7-Seg / LEDs / Switches)')}</h2>
              {cycle !== undefined && <span className="instrument-meta mono">CLK ↑ {cycle}</span>}
            </div>
            <VirtualBoard
              inputs={inputs}
              outputs={outputs}
              onInputsChange={onInputsChange}
              disabled={!compiled}
              hideKeys
            />
          </section>
        </div>
      </div>

      {paletteOpen && <ScreenPaletteDialog onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
