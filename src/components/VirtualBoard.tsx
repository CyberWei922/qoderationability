import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { useI18n } from '../services/i18n';
import type { BoardInputs, BoardOutputs } from '../types/contracts';

const bit = (value: number, index: number) => Boolean(value & (1 << index));
const indexes = (length: number) => Array.from({ length }, (_, index) => length - 1 - index);
const TRAFFIC = [
  { bit: 2, name: '红灯', nameEn: 'Red light', color: 'red' },
  { bit: 1, name: '黄灯', nameEn: 'Yellow light', color: 'yellow' },
  { bit: 0, name: '绿灯', nameEn: 'Green light', color: 'green' },
];
const KEY_SHORTCUTS = ['1', '2', '3', '4'] as const;

type BoardKeyTarget = { kind: 'key'; index: number } | { kind: 'rst' };

const KEY_CODE_MAP: Record<string, BoardKeyTarget> = {
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

const KEY_FALLBACK_MAP: Record<string, BoardKeyTarget> = {
  '1': { kind: 'key', index: 0 },
  '2': { kind: 'key', index: 1 },
  '3': { kind: 'key', index: 2 },
  '4': { kind: 'key', index: 3 },
  r: { kind: 'rst' },
  R: { kind: 'rst' },
};

function resolveBoardKey(event: globalThis.KeyboardEvent): { id: string; target: BoardKeyTarget } | null {
  if (event.code && KEY_CODE_MAP[event.code]) {
    return { id: event.code, target: KEY_CODE_MAP[event.code] };
  }
  if (KEY_FALLBACK_MAP[event.key]) {
    return { id: `key:${event.key.toLowerCase()}`, target: KEY_FALLBACK_MAP[event.key] };
  }
  return null;
}

function isEditableElement(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(node.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], dialog[open]'));
}

function Momentary({ name, shortcut, pressed, disabled, onPress }: {
  name: string;
  shortcut: string;
  pressed: boolean;
  disabled: boolean;
  onPress: (down: boolean) => void;
}) {
  const { L } = useI18n();
  function keyEvent(event: KeyboardEvent<HTMLButtonElement>, down: boolean) {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) onPress(down);
  }

  return <button
    type="button"
    className="board-key"
    aria-label={L(`${name}（快捷键 ${shortcut}）`, `${name} (shortcut ${shortcut})`)}
    title={L(`${name}（键盘 ${shortcut}，支持多键同时按下）`, `${name} (key ${shortcut}, multi-key supported)`)}
    data-pressed={pressed}
    disabled={disabled}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      onPress(true);
    }}
    onPointerUp={() => onPress(false)}
    onPointerCancel={() => onPress(false)}
    onKeyDown={(event) => keyEvent(event, true)}
    onKeyUp={(event) => keyEvent(event, false)}
    onClick={(event) => {
      if (event.detail !== 0) return;
      onPress(true);
      onPress(false);
    }}
    onBlur={() => { if (pressed) onPress(false); }}
  >
    <span>{name}</span>
    <kbd className="board-key-kbd" aria-hidden="true">{shortcut}</kbd>
  </button>;
}

export function VirtualBoard({ inputs, outputs, onInputsChange, disabled = false, hideKeys = false }: {
  inputs: BoardInputs;
  outputs?: BoardOutputs;
  onInputsChange: (inputs: BoardInputs) => void;
  disabled?: boolean;
  hideKeys?: boolean;
}) {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const onInputsChangeRef = useRef(onInputsChange);
  onInputsChangeRef.current = onInputsChange;

  const keyboardHeldRef = useRef(new Map<string, BoardKeyTarget>());
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
    const next: BoardInputs = { ...prev, key: keyMask, rst_n: nextRstN };
    inputsRef.current = next;
    onInputsChangeRef.current(next);
  }, []);

  const releaseAllKeyboard = useCallback(() => {
    if (keyboardHeldRef.current.size === 0) return;
    keyboardHeldRef.current.clear();
    syncPressedInputs();
  }, [syncPressedInputs]);

  useEffect(() => {
    if (disabled || hideKeys) {
      pointerHeldRef.current = { keyMask: 0, rst: false };
      releaseAllKeyboard();
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (
        isEditableElement(event.target) ||
        isEditableElement(document.activeElement) ||
        Boolean(document.querySelector('dialog[open]'))
      ) {
        return;
      }
      const mapped = resolveBoardKey(event);
      if (!mapped) return;
      event.preventDefault();
      if (event.repeat && keyboardHeldRef.current.has(mapped.id)) return;
      keyboardHeldRef.current.set(mapped.id, mapped.target);
      syncPressedInputs();
    }

    function handleKeyUp(event: globalThis.KeyboardEvent) {
      const mapped = resolveBoardKey(event);
      if (!mapped || !keyboardHeldRef.current.has(mapped.id)) return;
      event.preventDefault();
      keyboardHeldRef.current.delete(mapped.id);
      syncPressedInputs();
    }

    function handleFocusIn(event: FocusEvent) {
      if (isEditableElement(event.target)) releaseAllKeyboard();
    }

    function handleVisibilityChange() {
      if (document.hidden) releaseAllKeyboard();
    }

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
  }, [disabled, hideKeys, releaseAllKeyboard, syncPressedInputs]);

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

  const { locale, L } = useI18n();
  const out = outputs ?? { led: 0, traffic: 0, seg: 0 };
  const digits = outputs ? out.seg.toString(16).toUpperCase().padStart(4, '0') : '----';
  return (
    <div className="virtual-board">
      <div className="board-display">
        <div className="traffic-lights" aria-label={L('交通信号灯', 'Traffic lights')}>
          {TRAFFIC.map((light) => (
            <span
              role="img"
              key={light.bit}
              aria-label={
                locale === 'en'
                  ? `${light.nameEn} ${bit(out.traffic, light.bit) ? 'on' : 'off'}`
                  : `${light.name}${bit(out.traffic, light.bit) ? '亮' : '灭'}`
              }
              className={`lamp ${light.color}`}
              data-on={bit(out.traffic, light.bit)}
            />
          ))}
        </div>
        <output className="seven-seg" aria-label={L('数码管读数', '7-segment display')}>{digits}</output>
      </div>
      {!hideKeys && (
        <>
          <div className="board-keybank" role="group" aria-label={L('板卡按键', 'Board keys')}>
            {[0, 1, 2, 3].map((index) => (
              <Momentary
                key={index}
                name={`KEY${index}`}
                shortcut={KEY_SHORTCUTS[index]}
                pressed={bit(inputs.key, index)}
                disabled={disabled}
                onPress={(down) => setPointerKey(index, down)}
              />
            ))}
            <Momentary
              name="RST"
              shortcut="R"
              pressed={inputs.rst_n === 0}
              disabled={disabled}
              onPress={setPointerRst}
            />
          </div>
          <p className="board-shortcut-hint">
            {locale === 'en' ? (
              <>
                Shortcuts: <kbd>1</kbd>–<kbd>4</kbd> for KEY0–KEY3 (multi-key), <kbd>R</kbd> for RST
              </>
            ) : (
              <>
                快捷键：<kbd>1</kbd>–<kbd>4</kbd> 按 KEY0–KEY3（可多键同按），<kbd>R</kbd> 按 RST
              </>
            )}
          </p>
        </>
      )}
      <div className="board-row">
        <span>LED[7:0]</span>
        <div className="led-bank" role="group" aria-label={L('发光二极管', 'LED bank')}>
          {indexes(8).map((index) => (
            <span
              key={index}
              role="img"
              aria-label={
                locale === 'en'
                  ? `LED${index} ${bit(out.led, index) ? 'on' : 'off'}`
                  : `LED${index}${bit(out.led, index) ? '亮' : '灭'}`
              }
              data-on={bit(out.led, index)}
            />
          ))}
        </div>
      </div>
      <div className="board-row switch-row">
        <span>SW[7:0]</span>
        <div className="switch-bank" role="group" aria-label={L('拨码开关', 'DIP switches')}>
          {indexes(8).map((index) => <button key={index} type="button" title={`SW${index}`} aria-label={`SW${index}`} aria-pressed={bit(inputs.sw, index)}
            disabled={disabled} onClick={() => onInputsChange({ ...inputsRef.current, sw: inputsRef.current.sw ^ (1 << index) })}><span /><small>{index}</small></button>)}
        </div>
      </div>
    </div>
  );
}
