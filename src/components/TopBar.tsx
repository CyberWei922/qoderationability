import {
  ArrowUp,
  Globe,
  Pause,
  Play,
  Settings2,
  SkipForward,
  Square,
  Zap,
} from 'lucide-react';
import { useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '../services/i18n';
import type { LLMModelOption } from '../types/contracts';
import { CustomModelSelect } from './CustomSelect';

export type ClockSpeed = 'turbo' | 'fast' | 'realtime' | 'slow' | 'step';

export const TURBO_TARGET_HZ = 1000;

export const SPEED_INTERVAL_MS: Record<Exclude<ClockSpeed, 'step' | 'turbo'>, number> = {
  fast: 65,
  realtime: 100,
  slow: 500,
};

export function formatClockFrequency(speed: ClockSpeed): string {
  switch (speed) {
    case 'turbo':
      return '1.0 kHz';
    case 'fast':
      return '15 Hz';
    case 'realtime':
      return '10 Hz';
    case 'slow':
      return '2 Hz';
    case 'step':
      return 'STEP';
  }
}

export function PromptComposer({
  onSend,
  onCancel,
  busy = false,
  compact = false,
  models,
  selectedModel,
  providerLabel,
  quotaNotice,
  onSelectModel,
  onOpenSettings,
  enableWebResearch,
  onToggleWebResearch,
  liveHint,
  draftValue,
  onDraftChange,
  autoSubmitting = false,
  viewTransitionName,
}: {
  onSend: (prompt: string) => void;
  onCancel?: () => void;
  busy?: boolean;
  compact?: boolean;
  models: LLMModelOption[];
  selectedModel: string;
  providerLabel: string;
  quotaNotice?: { remaining?: number; limit?: number };
  onSelectModel: (modelId: string) => void;
  onOpenSettings: () => void;
  enableWebResearch: boolean;
  onToggleWebResearch: () => void;
  liveHint?: string;
  draftValue?: string;
  onDraftChange?: (value: string) => void;
  autoSubmitting?: boolean;
  viewTransitionName?: string;
}) {
  const { L } = useI18n();
  const [internalPrompt, setInternalPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const controlled = draftValue !== undefined;
  const prompt = controlled ? draftValue : internalPrompt;
  const setPrompt = (next: string) => {
    if (controlled) onDraftChange?.(next);
    else setInternalPrompt(next);
  };
  const placeholder = compact
    ? L(
        '继续描述修改需求，例如"把红灯延长到 8 拍"…',
        'Describe your changes, e.g. "extend red light to 8 cycles"…',
      )
    : L(
        '描述你想做的数字电路，例如"做一个带急停按键的十字路口交通灯"…',
        'Describe the digital circuit you want, e.g. "a traffic light with emergency red key"…',
      );

  function submit() {
    const text = prompt.trim();
    if (busy || autoSubmitting || !text) return;
    onSend(text);
    setPrompt('');
  }

  return (
    <form
      className={`composer${compact ? ' composer-compact' : ''}${autoSubmitting ? ' composer-prefilling' : ''}`}
      style={viewTransitionName ? ({ viewTransitionName } as CSSProperties) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={textareaRef}
        aria-label={compact ? L('继续修改当前电路', 'Refine current circuit') : L('电路需求', 'Circuit prompt')}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        maxLength={2000}
        value={prompt}
        readOnly={autoSubmitting}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            submit();
          }
        }}
      />

      <div className="composer-foot">
        <div className="composer-tools">
          {models.length > 1 || Boolean(quotaNotice) ? (
            <CustomModelSelect
              ariaLabel={L('切换对话模型', 'Switch model')}
              variant="inline"
              options={models}
              value={selectedModel}
              onChange={onSelectModel}
              title={L(`当前服务商：${providerLabel} · ${selectedModel}`, `Provider: ${providerLabel} · ${selectedModel}`)}
              quotaNotice={quotaNotice}
              footerAction={{ label: L('管理 API 与模型…', 'Manage API & models…'), onClick: onOpenSettings }}
            />
          ) : (
            <div className="model-select-wrap" title={L(`当前服务商：${providerLabel}`, `Provider: ${providerLabel}`)}>
              <button
                type="button"
                className="inline-model-trigger"
                onClick={onOpenSettings}
              >
                <span className="custom-select-value">{models[0]?.label ?? (selectedModel || providerLabel)}</span>
                <Settings2 size={11} />
              </button>
            </div>
          )}

          <button
            type="button"
            className={`tool-chip${enableWebResearch ? ' active' : ''}`}
            aria-pressed={enableWebResearch}
            title={
              enableWebResearch
                ? L('联网查阅 Verilog 规范已开启', 'Web Verilog spec lookup enabled')
                : L('联网查阅已关闭', 'Web lookup disabled')
            }
            onClick={onToggleWebResearch}
          >
            <Globe size={13} />
            <span>{L('联网', 'Web')}</span>
          </button>
        </div>

        <div className="composer-right">
          {liveHint && <span className="live-hint">{liveHint}</span>}
          {busy ? (
            <button
              className="stop-button"
              type="button"
              aria-label={L('停止生成', 'Stop generation')}
              title={L('停止生成', 'Stop generation')}
              onClick={onCancel}
            >
              <Square size={11} fill="currentColor" />
              <span>{L('停止', 'Stop')}</span>
            </button>
          ) : (
            <button
              className={`send-button${autoSubmitting ? ' sending' : ''}`}
              type="submit"
              aria-label={L('发送需求', 'Send prompt')}
              title={L('发送需求 (Enter)', 'Send prompt (Enter)')}
              disabled={!prompt.trim() && !autoSubmitting}
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

export function ClockControls({
  speed,
  running,
  disabled,
  showFast = false,
  onSpeed,
  onToggle,
  onStep,
}: {
  speed: ClockSpeed;
  running: boolean;
  disabled: boolean;
  showFast?: boolean;
  onSpeed: (speed: ClockSpeed) => void;
  onToggle: () => void;
  onStep: () => void;
}) {
  const { L } = useI18n();
  return (
    <div className="clock-controls" role="group" aria-label={L('时钟控制', 'Clock controls')}>
      <div className="clock-modes">
        {showFast && (
          <>
            <button
              type="button"
              className="clock-turbo-btn"
              disabled={disabled}
              aria-pressed={speed === 'turbo'}
              title={L('高频性能模式（1 kHz · 60fps 批量步进，零拖影）', 'Turbo Performance (1 kHz · 60fps batch stepping)')}
              onClick={() => onSpeed('turbo')}
            >
              <Zap size={11} />
              <span>1 kHz</span>
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={speed === 'fast'}
              title={L('高速（65ms/拍 · 15 Hz）', 'Fast (65ms/cycle · 15 Hz)')}
              onClick={() => onSpeed('fast')}
            >
              {L('高速', '15 Hz')}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={disabled}
          aria-pressed={speed === 'realtime'}
          title={L('实时（100ms/拍 · 10 Hz）', 'Real-time (100ms/cycle · 10 Hz)')}
          onClick={() => onSpeed('realtime')}
        >
          {L('实时', '1×')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={speed === 'slow'}
          title={L('慢动作（500ms/拍 · 2 Hz）', 'Slow-mo (500ms/cycle · 2 Hz)')}
          onClick={() => onSpeed('slow')}
        >
          0.2×
        </button>
      </div>
      <button type="button" className="control-button" disabled={disabled} onClick={onStep}>
        <SkipForward size={13} /> {L('单步', 'Step')}
      </button>
      <button type="button" className="control-button" disabled={disabled} onClick={onToggle}>
        {running && speed !== 'step' ? (
          <>
            <Pause size={13} /> {L('暂停', 'Pause')}
          </>
        ) : (
          <>
            <Play size={13} /> {L('运行', 'Run')}
          </>
        )}
      </button>
    </div>
  );
}
