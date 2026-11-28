import {
  Check,
  Clock,
  Cpu,
  Download,
  Languages,
  Monitor,
  Moon,
  Play,
  Plus,
  SlidersHorizontal,
  Sun,
  Trash2,
} from 'lucide-react';
import {
  BOARD_PERIPHERAL_LIST,
  BOARD_PRESETS,
  toggleBoardPeripheral,
} from '../services/boardProfiles';
import { localizePreset, useI18n } from '../services/i18n';
import type { HistoryEntry } from '../services/sessionHistory';
import type { BoardPeripheralId, BoardProfile, PresetProject } from '../types/contracts';

const PRESET_META: Record<string, { category: string; categoryEn: string; difficulty: string; difficultyEn: string }> = {
  'traffic-light': { category: '状态机', categoryEn: 'FSM', difficulty: '入门', difficultyEn: 'Beginner' },
  'sequence-detector': { category: '串行检测', categoryEn: 'Serial', difficulty: '进阶', difficultyEn: 'Intermediate' },
  stopwatch: { category: '计数器', categoryEn: 'Counter', difficulty: '入门', difficultyEn: 'Beginner' },
  buzzer: { category: '仲裁锁存', categoryEn: 'Arbitration', difficulty: '入门', difficultyEn: 'Beginner' },
  snake: { category: '256 色游戏', categoryEn: '256-Color Game', difficulty: '进阶', difficultyEn: 'Intermediate' },
  tetris: { category: '256 色游戏', categoryEn: '256-Color Game', difficulty: '挑战', difficultyEn: 'Advanced' },
  'rgb-cube': { category: '256 色视觉', categoryEn: '256-Color Visual', difficulty: '入门', difficultyEn: 'Beginner' },
};

const PERIPHERAL_SHORT: Record<BoardPeripheralId, { zh: string; en: string }> = {
  led: { zh: 'LED', en: 'LED' },
  traffic: { zh: '交通灯', en: 'Traffic' },
  seg: { zh: '数码管', en: '7-Seg' },
  screen: { zh: '16×8 OLED', en: '16×8 OLED' },
  tone: { zh: '蜂鸣器', en: 'Buzzer' },
};

export function BoardPanel({
  profile,
  onSelectProfile,
  onOpenScreenTab,
}: {
  profile: BoardProfile;
  onSelectProfile: (profile: BoardProfile) => void;
  onOpenScreenTab: () => void;
}) {
  const { locale, L } = useI18n();
  const hasScreen = profile.peripherals.includes('screen');

  return (
    <div className="drawer-scroll">
      <div className="drawer-intro">
        <p>
          {L(
            '选择虚拟 FPGA 开发板配置：决定可用外设（含 16×8 256 色 OLED 屏）以及 AI 生成电路时的硬件端口约定。',
            'Select a virtual FPGA board profile to configure available peripherals (including 16×8 256-color OLED) and AI hardware port prompts.',
          )}
        </p>
      </div>

      <div className="board-profile-list">
        {BOARD_PRESETS.map((item) => {
          const active = profile.id === item.profile.id;
          return (
            <article
              key={item.profile.id}
              className={`preset-card board-profile-card${active ? ' active' : ''}`}
            >
              <div className="preset-card-top">
                <div className="preset-tags">
                  <span className="tag-pill">{L(item.badgeZh, item.badgeEn)}</span>
                  <span className="tag-pill subtle">
                    {item.profile.primaryView === 'screen'
                      ? L('屏幕优先', 'OLED First')
                      : L('网表优先', 'Netlist First')}
                  </span>
                </div>
                {active && (
                  <span className="board-active-badge">
                    <Check size={11} strokeWidth={2.5} /> {L('当前使用', 'Active')}
                  </span>
                )}
              </div>

              <h3>{locale === 'en' ? item.nameEn : item.profile.name}</h3>
              <p>{locale === 'en' ? item.descriptionEn : item.profile.description}</p>

              <div className="board-peripheral-tags">
                {item.profile.peripherals.map((pid) => (
                  <span key={pid} className={`mono-chip${pid === 'screen' ? ' accent' : ''}`}>
                    {L(PERIPHERAL_SHORT[pid].zh, PERIPHERAL_SHORT[pid].en)}
                  </span>
                ))}
              </div>

              <div className="preset-card-foot">
                <span className="mono-meta">
                  {L('4 按键 · 8 拨码', '4 Keys · 8 Switches')}
                </span>
                <button
                  type="button"
                  className={active ? 'outline-button compact-btn' : 'primary-button compact-btn'}
                  aria-pressed={active}
                  onClick={() => onSelectProfile(item.profile)}
                >
                  {active ? (
                    <>
                      <Check size={12} /> {L('已启用', 'Selected')}
                    </>
                  ) : (
                    <>
                      <Cpu size={12} /> {L('切换板卡', 'Select')}
                    </>
                  )}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <section className="board-custom-section" aria-label={L('外设开关定制', 'Custom peripheral toggles')}>
        <div className="board-custom-head">
          <h4>{L('自定义外设开关', 'Custom Peripherals')}</h4>
          {profile.id === 'custom' && (
            <span className="tag-pill">{L('自定义模式', 'Custom')}</span>
          )}
        </div>
        <div className="board-toggle-list">
          {BOARD_PERIPHERAL_LIST.map((item) => {
            const enabled = profile.peripherals.includes(item.id);
            const isOnlyOne = enabled && profile.peripherals.length === 1;
            return (
              <button
                key={item.id}
                type="button"
                className={`board-toggle-row${enabled ? ' enabled' : ''}`}
                role="switch"
                aria-checked={enabled}
                disabled={isOnlyOne}
                onClick={() => onSelectProfile(toggleBoardPeripheral(profile, item.id))}
              >
                <span className="board-toggle-info">
                  <strong>{L(item.labelZh, item.labelEn)}</strong>
                  <small className="mono">{item.portHint}</small>
                </span>
                <span className="board-toggle-pill" aria-hidden="true">
                  <span className="board-toggle-thumb" />
                </span>
              </button>
            );
          })}
        </div>

        {hasScreen && (
          <button
            type="button"
            className="outline-button compact-btn board-open-screen-btn"
            onClick={onOpenScreenTab}
          >
            <Monitor size={13} />
            <span>{L('打开 16×8 OLED 屏幕视图', 'Open 16×8 OLED Screen View')}</span>
          </button>
        )}
      </section>
    </div>
  );
}

const DIFFICULTY_TEXT: Record<NonNullable<PresetProject['difficulty']>, { zh: string; en: string }> = {
  beginner: { zh: '入门', en: 'Beginner' },
  intermediate: { zh: '进阶', en: 'Intermediate' },
  advanced: { zh: '挑战', en: 'Advanced' },
};

export function PresetsPanel({
  presets,
  activePresetId,
  busy,
  onSelectPreset,
}: {
  presets: PresetProject[];
  activePresetId?: string;
  busy: boolean;
  onSelectPreset: (preset: PresetProject) => void;
}) {
  const { locale, L } = useI18n();
  return (
    <div className="drawer-scroll">
      <div className="drawer-intro">
        <p>
          {L(
            '所有预置案例均由浏览器内真实 RTL 引擎实时编译、自测与仿真，零 Token 消耗。',
            'Every built-in demo compiles, self-tests, and simulates live in the browser RTL engine with zero token usage.',
          )}
        </p>
      </div>
      <div className="preset-cards">
        {presets.map((preset) => {
          const localized = localizePreset(preset, locale);
          const fallback = PRESET_META[preset.id] ?? {
            category: '数字逻辑',
            categoryEn: 'Digital Logic',
            difficulty: '入门',
            difficultyEn: 'Beginner',
          };
          const category = localized.category ?? L(fallback.category, fallback.categoryEn);
          const difficulty = preset.difficulty
            ? L(DIFFICULTY_TEXT[preset.difficulty].zh, DIFFICULTY_TEXT[preset.difficulty].en)
            : L(fallback.difficulty, fallback.difficultyEn);
          const active = preset.id === activePresetId;

          return (
            <article key={preset.id} className={`preset-card${active ? ' active' : ''}`}>
              <div className="preset-card-top">
                <div className="preset-tags">
                  <span className="tag-pill">{category}</span>
                  <span className="tag-pill subtle">{difficulty}</span>
                  {preset.requiredPeripherals?.includes('screen') && (
                    <span className="tag-pill accent-soft">OLED</span>
                  )}
                </div>
                <span className="mono-meta">
                  {L(`${preset.testVectors.length} 拍自测`, `${preset.testVectors.length} test cycles`)}
                </span>
              </div>
              <h3>{localized.name}</h3>
              <p>{localized.blueprint.summary}</p>
              <div className="preset-card-foot">
                <span className="mono-meta">{L('零 Token 实时仿真', 'Zero-token live sim')}</span>
                <button
                  type="button"
                  className={active ? 'outline-button compact-btn' : 'primary-button compact-btn'}
                  disabled={busy}
                  onClick={() => onSelectPreset(preset)}
                >
                  <Play size={12} /> {active ? L('重新载入', 'Reload') : L('上板运行', 'Run Live')}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function HistoryPanel({
  entries,
  onRestore,
  onDownload,
  onDelete,
  onClear,
  onNewChat,
  resolvedTheme,
  onToggleTheme,
  onOpenSettings,
  hasCustomApi,
}: {
  entries: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  onDownload: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onNewChat?: () => void;
  resolvedTheme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  hasCustomApi?: boolean;
}) {
  const { locale, toggleLocale, L } = useI18n();

  const mobileUtilityBar = (
    <div className="mobile-utility-bar" aria-label={L('快捷操作与偏好设置', 'Quick actions & preferences')}>
      {onNewChat && (
        <button type="button" className="primary-button compact-btn mobile-util-new" onClick={onNewChat}>
          <Plus size={14} />
          <span>{L('新建对话', 'New Chat')}</span>
        </button>
      )}
      <div className="mobile-util-group">
        {onToggleTheme && resolvedTheme && (
          <button
            type="button"
            className="outline-button compact-btn"
            aria-label={resolvedTheme === 'dark' ? L('切换浅色模式', 'Switch to light mode') : L('切换深色模式', 'Switch to dark mode')}
            onClick={onToggleTheme}
          >
            {resolvedTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span>{resolvedTheme === 'dark' ? L('浅色', 'Light') : L('深色', 'Dark')}</span>
          </button>
        )}
        <button
          type="button"
          className="outline-button compact-btn"
          aria-label={locale === 'zh' ? 'Switch to English' : '切换为中文'}
          onClick={toggleLocale}
        >
          <Languages size={14} />
          <span>{locale === 'zh' ? 'EN' : '中文'}</span>
        </button>
        {onOpenSettings && (
          <button
            type="button"
            className="outline-button compact-btn mobile-util-settings"
            aria-label={L('打开设置', 'Open settings')}
            onClick={onOpenSettings}
          >
            <SlidersHorizontal size={14} />
            <span>{L('设置', 'Settings')}</span>
            {hasCustomApi && <span className="rail-badge-dot" aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );

  if (entries.length === 0) {
    return (
      <div className="drawer-scroll">
        {mobileUtilityBar}
        <div className="empty-box">
          <Clock size={22} />
          <p>{L('尚无本地电路记录', 'No local circuit history yet')}</p>
          <small>
            {L(
              '运行预设演示或生成通过验证的电路后，版本快照会自动保存在这里。',
              'Snapshots are saved here automatically after running a demo or verifying a generated circuit.',
            )}
          </small>
        </div>
      </div>
    );
  }

  return (
    <div className="drawer-scroll">
      {mobileUtilityBar}
      <div className="history-top-bar">
        <span>{L(`共 ${entries.length} 条本地快照`, `${entries.length} local snapshots`)}</span>
        <button type="button" className="text-link danger" onClick={onClear}>
          {L('清空记录', 'Clear all')}
        </button>
      </div>
      <div className="history-list">
        {entries.map((entry) => (
          <article key={entry.id} className="history-card">
            <div className="history-card-head">
              <strong>{entry.title}</strong>
              <span className="tag-pill subtle">V{entry.version}</span>
            </div>
            <p className="history-prompt">{entry.prompt}</p>
            <div className="history-meta">
              <span className="mono-meta">{entry.filename}</span>
              {entry.totalChecks !== undefined && (
                <span className="mono-meta ok">
                  {entry.passedChecks}/{entry.totalChecks}
                </span>
              )}
              <span className="mono-meta">
                {new Date(entry.timestamp).toLocaleTimeString(locale === 'en' ? 'en-US' : 'zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className="history-actions">
              <button type="button" className="outline-button compact-btn" onClick={() => onRestore(entry)}>
                <Play size={12} /> {L('载入', 'Load')}
              </button>
              <button
                type="button"
                className="outline-button compact-btn"
                title={L(`下载 ${entry.filename}`, `Download ${entry.filename}`)}
                onClick={() => onDownload(entry)}
              >
                <Download size={12} /> {L('下载', 'Download')}
              </button>
              <button
                type="button"
                className="outline-button compact-btn danger-btn"
                title={L('删除记录', 'Delete snapshot')}
                onClick={() => onDelete(entry.id)}
              >
                <Trash2 size={12} /> {L('删除', 'Delete')}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
