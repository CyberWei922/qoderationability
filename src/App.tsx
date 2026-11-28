import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircuitBoard,
  ClipboardCheck,
  Copy,
  Download,
  FileCode2,
  FileText,
  Gamepad2,
  LayoutGrid,
  MessageSquare,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createAgentRuntime } from './agent';
import { ApiSettings, type SettingsSection } from './components/ApiSettings';
import { BrandWordmark } from './components/BrandWordmark';
import { ChatPane, stepKeyForTrace, type ChatTurn } from './components/ChatPane';
import { GateCanvas } from './components/GateCanvas';
import { NavRail, type RailTab } from './components/NavRail';
import { ProductShowcase } from './components/ProductShowcase';
import { ScreenView, type ScreenKeyLayout } from './components/ScreenView';
import { BoardPanel, HistoryPanel, PresetsPanel } from './components/SidePanels';
import {
  ClockControls,
  PromptComposer,
  SPEED_INTERVAL_MS,
  TURBO_TARGET_HZ,
  formatClockFrequency,
  type ClockSpeed,
} from './components/TopBar';
import { VirtualBoard } from './components/VirtualBoard';
import { Waveform } from './components/Waveform';
import { BlueprintView, VerifyView, VerilogView, type CodeStreamState } from './components/WorkbenchViews';
import { createRtlEngine } from './engine';
import {
  getBoardPresetById,
  loadBoardProfile,
  saveBoardProfile,
} from './services/boardProfiles';
import {
  buildFallbackTestbench,
  deriveVerilogFilename,
  downloadTextFile,
} from './services/exportVerilog';
import {
  advanceScreenSync,
  createScreenSyncState,
  type ScreenSyncState,
} from './services/screenSync';
import {
  getLlmErrorText,
  localizePreset,
  localizeProviderName,
  useI18n,
} from './services/i18n';
import {
  createLiveCodeStreamer,
  sleepAbortable,
  startSpatialTransition,
  streamTextSmoothly,
  streamVerilogTokens,
  type LiveCodeStreamer,
} from './services/streamPlayback';
import {
  createBrowserLLMClient,
  fetchQuotaStatus,
  fetchSiteModels,
  getProviderPreset,
  getSuggestedModelOptions,
  loadAppPreferences,
  loadByokConfig,
  loadSiteModel,
  saveAppPreferences,
  saveByokConfig,
  saveSiteModel,
  SITE_DEFAULT_MODELS,
  type AppPreferences,
  type ByokConfig,
} from './services/llmClient';
import {
  clearHistoryEntries,
  deleteHistoryEntry,
  loadHistoryEntries,
  saveHistoryEntry,
  type HistoryEntry,
} from './services/sessionHistory';
import {
  applyThemePreferences,
  loadThemePreferences,
  saveThemePreferences,
  subscribeSystemTheme,
  type ThemePreferences,
} from './services/theme';
import {
  isLLMError,
  type AgentBlueprint,
  type BoardInputs,
  type BoardProfile,
  type HarnessTraceEvent,
  type LintIssue,
  type LLMModelOption,
  type NetlistGraph,
  type PresetProject,
  type RtlEngine,
  type SelfTestResult,
  type SignalSample,
  type TestVectorStep,
} from './types/contracts';

const IDLE_INPUTS: BoardInputs = { rst_n: 1, key: 0, sw: 0 };
const HISTORY_LIMIT = 48;
const LEFT_PANE_STORAGE_KEY = 'fpgagent.leftPaneWidth';
const LEFT_PANE_MIN = 260;
const LEFT_PANE_MAX = 640;
const WORKBENCH_MIN = 420;

function defaultLeftPaneWidth(): number {
  if (typeof window === 'undefined') return 384;
  return window.innerWidth <= 1240 ? 320 : 384;
}

function clampLeftPaneWidth(
  width: number,
  viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth,
): number {
  const rail = viewportWidth <= 1240 ? 52 : 56;
  const maxAllowed = Math.max(LEFT_PANE_MIN, Math.min(LEFT_PANE_MAX, viewportWidth - rail - WORKBENCH_MIN));
  return Math.round(Math.max(LEFT_PANE_MIN, Math.min(maxAllowed, width)));
}

function loadLeftPaneWidth(): number {
  if (typeof window === 'undefined') return 384;
  try {
    const raw = window.localStorage.getItem(LEFT_PANE_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return clampLeftPaneWidth(parsed);
  } catch {
    // Ignore storage read failures in restricted environments.
  }
  return clampLeftPaneWidth(defaultLeftPaneWidth());
}

const QUICK_PROMPTS = [
  {
    id: 'traffic-light',
    prompt: '做一个智能交通灯',
    promptEn: 'Build a smart traffic light',
    desc: '红绿黄倒计时 + KEY0 紧急全红',
    descEn: 'R/G/Y timer + KEY0 emergency red',
    Icon: Radio,
  },
  {
    id: 'snake',
    prompt: '做一个彩色 OLED 贪吃蛇游戏',
    promptEn: 'Build a color OLED Snake game',
    desc: '16×8 256 色 OLED + WASD / 方向键控制',
    descEn: '16×8 256-color OLED + WASD / arrow keys',
    Icon: Gamepad2,
  },
];

type AppView = 'home' | 'workbench' | 'showcase';
type WorkbenchTab = 'canvas' | 'screen' | 'blueprint' | 'verilog' | 'verify';
type Outcome = 'busy' | 'ready' | 'cancelled' | 'failed';

interface RouteState {
  view: AppView;
  railTab: RailTab;
  wbTab: WorkbenchTab;
}

function parseRouteFromHash(hash: string): RouteState {
  const clean = hash.replace(/^#\/?/, '').trim();
  if (!clean) return { view: 'home', railTab: 'chat', wbTab: 'canvas' };
  const [pathPart, queryPart] = clean.split('?');
  const params = new URLSearchParams(queryPart ?? '');
  const segs = pathPart.split('/').filter(Boolean);
  if (segs[0] === 'intro' || segs[0] === 'showcase' || segs[0] === 'about') {
    return { view: 'showcase', railTab: 'chat', wbTab: 'canvas' };
  }
  if (segs[0] === 'board' || segs[0] === 'presets' || segs[0] === 'history') {
    const wb = params.get('tab');
    const wbTab: WorkbenchTab =
      wb === 'screen' || wb === 'blueprint' || wb === 'verilog' || wb === 'verify' ? wb : 'canvas';
    return { view: 'workbench', railTab: segs[0], wbTab };
  }
  if (segs[0] === 'workbench') {
    const wb = segs[1];
    const wbTab: WorkbenchTab =
      wb === 'screen' || wb === 'blueprint' || wb === 'verilog' || wb === 'verify' ? wb : 'canvas';
    const panel = params.get('panel');
    const railTab: RailTab =
      panel === 'board' || panel === 'presets' || panel === 'history' ? panel : 'chat';
    return { view: 'workbench', railTab, wbTab };
  }
  return { view: 'home', railTab: 'chat', wbTab: 'canvas' };
}

function formatHashFromRoute(route: RouteState): string {
  if (route.view === 'showcase') return '#/intro';
  if (route.view === 'home') return '#/';
  if (route.railTab !== 'chat') {
    return route.wbTab !== 'canvas' ? `#/${route.railTab}?tab=${route.wbTab}` : `#/${route.railTab}`;
  }
  return `#/workbench/${route.wbTab}`;
}

function isSameRoute(a: RouteState, b: RouteState): boolean {
  return a.view === b.view && a.railTab === b.railTab && a.wbTab === b.wbTab;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function App() {
  const { locale, L } = useI18n();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const engineFactory = useMemo(() => createRtlEngine, []);
  const runtime = useMemo(
    () => createAgentRuntime({ llm: createBrowserLLMClient(), engine: engineFactory() }),
    [engineFactory],
  );

  // Settings, Theme & Preferences
  const [api, setApi] = useState<ByokConfig | null>(loadByokConfig);
  const [prefs, setPrefs] = useState<AppPreferences>(loadAppPreferences);
  const [theme, setTheme] = useState<ThemePreferences>(loadThemePreferences);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    applyThemePreferences(loadThemePreferences()),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('api');
  const [siteModels, setSiteModels] = useState<LLMModelOption[]>(SITE_DEFAULT_MODELS);
  const [siteModel, setSiteModel] = useState<string>(loadSiteModel);
  const [remainingQuota, setRemainingQuota] = useState<number | undefined>();
  const [dailyQuotaLimit, setDailyQuotaLimit] = useState<number | undefined>();

  // Navigation & Browser History State
  const initialRoute = useMemo<RouteState>(() => {
    const parsed = parseRouteFromHash(window.location.hash);
    if (parsed.view === 'workbench' && parsed.railTab === 'chat') {
      return { view: 'home', railTab: 'chat', wbTab: 'canvas' };
    }
    return parsed;
  }, []);
  const [view, setView] = useState<AppView>(initialRoute.view);
  const [railTab, setRailTab] = useState<RailTab>(initialRoute.railTab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileChatSheetOpen, setMobileChatSheetOpen] = useState(false);
  const [wbTab, setWbTab] = useState<WorkbenchTab>(initialRoute.wbTab);
  const routeRef = useRef<RouteState>(initialRoute);

  const navigateTo = useCallback(
    (patch: Partial<RouteState>, options: { replace?: boolean; skipTransition?: boolean } = {}) => {
      const prev = routeRef.current;
      const next: RouteState = { ...prev, ...patch };
      if (isSameRoute(prev, next)) return;

      const crossingHomeAndWorkbench =
        (prev.view === 'home' && next.view === 'workbench') ||
        (prev.view === 'workbench' && next.view === 'home');

      const commit = () => {
        routeRef.current = next;
        setView(next.view);
        setRailTab(next.railTab);
        setWbTab(next.wbTab);
        const hash = formatHashFromRoute(next);
        if (options.replace) {
          window.history.replaceState(next, '', hash);
        } else {
          window.history.pushState(next, '', hash);
        }
      };

      const isMobileViewport = window.matchMedia('(max-width: 780px)').matches;
      if (!options.skipTransition && crossingHomeAndWorkbench && !isMobileViewport) {
        startSpatialTransition(commit, next.view === 'workbench' ? 'enter-workbench' : 'return-home');
      } else {
        commit();
      }
    },
    [],
  );

  useEffect(() => {
    if (!mobileChatSheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !settingsOpen) {
        setMobileChatSheetOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileChatSheetOpen, settingsOpen]);

  useEffect(() => {
    window.history.replaceState(routeRef.current, '', formatHashFromRoute(routeRef.current));
    const onPopState = (event: PopStateEvent) => {
      const candidate = event.state as Partial<RouteState> | null;
      const next: RouteState =
        candidate &&
        (candidate.view === 'home' || candidate.view === 'workbench' || candidate.view === 'showcase') &&
        (candidate.railTab === 'chat' ||
          candidate.railTab === 'board' ||
          candidate.railTab === 'presets' ||
          candidate.railTab === 'history') &&
        (candidate.wbTab === 'canvas' ||
          candidate.wbTab === 'screen' ||
          candidate.wbTab === 'blueprint' ||
          candidate.wbTab === 'verilog' ||
          candidate.wbTab === 'verify')
          ? { view: candidate.view, railTab: candidate.railTab, wbTab: candidate.wbTab }
          : parseRouteFromHash(window.location.hash);
      routeRef.current = next;
      setView(next.view);
      setRailTab(next.railTab);
      setWbTab(next.wbTab);
      setSidebarCollapsed(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Chat & Session State
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [outcome, setOutcome] = useState<Outcome>('ready');
  const [version, setVersion] = useState(0);
  const [activePresetId, setActivePresetId] = useState<string>();
  const [blueprint, setBlueprint] = useState<AgentBlueprint>();
  const [code, setCode] = useState('');
  const [vectors, setVectors] = useState<TestVectorStep[]>([]);
  const [issues, setIssues] = useState<LintIssue[]>([]);
  const [selfTest, setSelfTest] = useState<SelfTestResult>();
  const [traces, setTraces] = useState<HarnessTraceEvent[]>([]);
  const [highlightLine, setHighlightLine] = useState<number>();
  const [copiedHeader, setCopiedHeader] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(loadHistoryEntries);
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(loadLeftPaneWidth);
  const [resizingPane, setResizingPane] = useState(false);
  const leftPaneWidthRef = useRef(leftPaneWidth);
  leftPaneWidthRef.current = leftPaneWidth;
  const resizeDragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  // Streaming, Auto-follow & Home Prefill State
  const [homeDraft, setHomeDraft] = useState('');
  const [autoSubmittingPreset, setAutoSubmittingPreset] = useState(false);
  const [planningBlueprint, setPlanningBlueprint] = useState(false);
  const [codeStreamState, setCodeStreamState] = useState<CodeStreamState | undefined>();
  const [recommendedTab, setRecommendedTab] = useState<WorkbenchTab | null>(null);
  const userOverrodeTabRef = useRef(false);
  const liveCodeStreamerRef = useRef<LiveCodeStreamer | null>(null);
  const prefillAbortRef = useRef<AbortController | null>(null);

  // Simulation State
  const [boardProfile, setBoardProfile] = useState<BoardProfile>(loadBoardProfile);
  const [screenKeyLayout, setScreenKeyLayout] = useState<ScreenKeyLayout>('dpad');
  const [screenVsync, setScreenVsync] = useState(true);
  const [displayScreenBuffer, setDisplayScreenBuffer] = useState<number[] | undefined>(undefined);
  const [circuitUsesScreen, setCircuitUsesScreen] = useState(false);
  const [netlist, setNetlist] = useState<NetlistGraph>();
  const [history, setHistory] = useState<SignalSample[]>([]);
  const [inputs, setInputs] = useState<BoardInputs>(IDLE_INPUTS);
  const [speed, setSpeed] = useState<ClockSpeed>(() => loadAppPreferences().defaultClockSpeed);
  const [running, setRunning] = useState(true);
  const [compiled, setCompiled] = useState(false);

  function handleSelectBoardProfile(next: BoardProfile) {
    setBoardProfile(next);
    saveBoardProfile(next);
  }

  const simulation = useRef<{
    step: RtlEngine['step'];
    stepBatch: NonNullable<RtlEngine['stepBatch']>;
  } | null>(null);
  const inputsRef = useRef(IDLE_INPUTS);
  const pendingKeys = useRef<{ pressed: number; inputs: BoardInputs }[]>([]);
  const pendingReset = useRef(false);
  const sampledKeys = useRef(0);
  const clockTimerRef = useRef<number | null>(null);
  const clockRafRef = useRef<number | null>(null);
  const lastRunSpeedRef = useRef<Exclude<ClockSpeed, 'step'>>(loadAppPreferences().defaultClockSpeed);
  const screenSyncRef = useRef<ScreenSyncState>(createScreenSyncState());
  const screenVsyncRef = useRef(true);
  screenVsyncRef.current = screenVsync;
  const clockStateRef = useRef({ compiled: false, running: true, speed: 'realtime' as ClockSpeed });
  clockStateRef.current = { compiled, running, speed };
  if (speed !== 'step') {
    lastRunSpeedRef.current = speed;
  }
  const abortRef = useRef<AbortController | null>(null);
  const applied = useRef<{ source: string; title?: string; version: number } | undefined>(undefined);

  // Apply & persist theme
  const handleThemeChange = useCallback((next: ThemePreferences) => {
    setTheme(next);
    saveThemePreferences(next);
    setResolvedTheme(applyThemePreferences(next));
  }, []);

  useEffect(() => {
    if (theme.mode !== 'system') return;
    return subscribeSystemTheme(() => {
      setResolvedTheme(applyThemePreferences(theme));
    });
  }, [theme]);

  useEffect(() => {
    if (api) return;
    let active = true;
    void fetchQuotaStatus().then((status) => {
      if (!active || !status) return;
      setRemainingQuota(status.remainingQuota);
      setDailyQuotaLimit(status.dailyLimit);
    });
    void fetchSiteModels().then((models) => {
      if (!active || models.length === 0) return;
      setSiteModels(models);
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    function handleWindowResize() {
      setLeftPaneWidth((prev) => clampLeftPaneWidth(prev));
    }
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const persistLeftPaneWidth = useCallback((width: number) => {
    try {
      window.localStorage.setItem(LEFT_PANE_STORAGE_KEY, String(width));
    } catch {
      // Ignore storage write failures.
    }
  }, []);

  function beginPaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests may not have an active browser pointer.
    }
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: leftPaneWidthRef.current,
    };
    setResizingPane(true);
  }

  function movePaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampLeftPaneWidth(drag.startWidth + (event.clientX - drag.startX));
    leftPaneWidthRef.current = next;
    setLeftPaneWidth(next);
  }

  function endPaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeDragRef.current = null;
    setResizingPane(false);
    persistLeftPaneWidth(leftPaneWidthRef.current);
  }

  function resetLeftPaneWidth() {
    const next = clampLeftPaneWidth(defaultLeftPaneWidth());
    leftPaneWidthRef.current = next;
    setLeftPaneWidth(next);
    persistLeftPaneWidth(next);
  }

  function keyboardPaneResize(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Home') {
      event.preventDefault();
      resetLeftPaneWidth();
      return;
    }
    const step = event.shiftKey ? 40 : 16;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? step : -step;
      const next = clampLeftPaneWidth(leftPaneWidthRef.current + delta);
      leftPaneWidthRef.current = next;
      setLeftPaneWidth(next);
      persistLeftPaneWidth(next);
    }
  }

  const toggleLightDark = useCallback(() => {
    const nextMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    handleThemeChange({ ...theme, mode: nextMode });
  }, [resolvedTheme, theme, handleThemeChange]);

  function openSettings(section: SettingsSection = 'api') {
    setSettingsSection(section);
    setSettingsOpen(true);
  }

  // Model selector state derived from BYOK config or site-default model list
  const availableModels: LLMModelOption[] = useMemo(() => {
    if (!api) return siteModels;
    const base = api.cachedModels?.length
      ? api.cachedModels
      : getSuggestedModelOptions(api.providerId, api.model);
    if (!base.some((m) => m.id === api.model)) {
      return [{ id: api.model }, ...base];
    }
    return base;
  }, [api, siteModels]);

  const selectedModel = api
    ? api.model
    : siteModels.some((m) => m.id === siteModel)
      ? siteModel
      : siteModels[0]?.id ?? 'qwen3.8-flash';
  const providerLabel = api
    ? localizeProviderName(api.providerId, getProviderPreset(api.providerId)?.name ?? L('自定义 API', 'Custom API'), locale)
    : L('站点默认', 'Site Default');
  const siteQuotaNotice = !api ? { remaining: remainingQuota, limit: dailyQuotaLimit } : undefined;

  function handleSelectModel(modelId: string) {
    if (!api) {
      if (modelId === selectedModel) return;
      setSiteModel(modelId);
      saveSiteModel(modelId);
      return;
    }
    if (modelId === api.model) return;
    const next: ByokConfig = { ...api, model: modelId };
    setApi(next);
    try {
      saveByokConfig(next);
    } catch {
      // Ignore storage errors.
    }
  }

  function handleToggleWebResearch() {
    const next = { ...prefs, enableWebResearch: !prefs.enableWebResearch };
    setPrefs(next);
    saveAppPreferences(next);
  }

  const stepCycles = useCallback(
    (requestedCycles: number, options?: { forceImmediateDisplay?: boolean }) => {
      const sim = simulation.current;
      if (!sim) return;
      const targetCount = Math.max(1, Math.min(64, Math.floor(requestedCycles)));
      const current = inputsRef.current;
      const batchSamples: SignalSample[] = [];
      let lastResult: { sample: SignalSample; netlist: NetlistGraph } | null = null;
      let remaining = targetCount;

      const nextEdgeInput = (): BoardInputs | null => {
        const pending = pendingKeys.current[0];
        if (pendingReset.current || current.rst_n === 0) {
          const sampled: BoardInputs = { ...current, key: 0, rst_n: 0 };
          pendingReset.current = false;
          sampledKeys.current = sampled.key;
          return sampled;
        }
        if (pending) {
          let sampled: BoardInputs;
          if (sampledKeys.current & pending.pressed) {
            sampled = { ...pending.inputs, key: pending.inputs.key & ~pending.pressed, rst_n: 1 };
          } else {
            sampled = { ...pending.inputs, rst_n: 1 };
            pendingKeys.current.shift();
          }
          sampledKeys.current = sampled.key;
          return sampled;
        }
        return null;
      };

      while (remaining > 0) {
        const edgeInput = nextEdgeInput();
        if (!edgeInput) break;
        const res = sim.step(edgeInput);
        batchSamples.push(res.sample);
        lastResult = res;
        remaining -= 1;
      }

      if (remaining > 0) {
        sampledKeys.current = current.key;
        if (remaining === 1) {
          const res = sim.step(current);
          batchSamples.push(res.sample);
          lastResult = res;
        } else {
          const res = sim.stepBatch(current, remaining);
          if (res.waveformDelta && res.waveformDelta.length > 0) {
            batchSamples.push(...res.waveformDelta);
          } else {
            batchSamples.push(res.sample);
          }
          lastResult = { sample: res.sample, netlist: res.netlist };
        }
      }

      if (!lastResult) return;

      const currentSpeed = clockStateRef.current.speed;
      const syncEnabled =
        !options?.forceImmediateDisplay && screenVsyncRef.current && currentSpeed !== 'step';
      const maxHoldCycles = currentSpeed === 'turbo' ? 128 : 12;
      const syncedBuffer = advanceScreenSync(screenSyncRef.current, batchSamples, {
        enabled: syncEnabled,
        maxHoldCycles,
      });

      setNetlist(lastResult.netlist);
      setHistory((samples) => [...samples.slice(-(HISTORY_LIMIT - 1)), lastResult.sample]);
      setDisplayScreenBuffer(syncedBuffer ?? lastResult.sample.screenBuffer);
    },
    [],
  );

  const tick = useCallback(() => {
    stepCycles(1);
  }, [stepCycles]);

  const stopClockLoop = useCallback(() => {
    if (clockTimerRef.current !== null) {
      window.clearInterval(clockTimerRef.current);
      clockTimerRef.current = null;
    }
    if (clockRafRef.current !== null) {
      window.cancelAnimationFrame(clockRafRef.current);
      clockRafRef.current = null;
    }
  }, []);

  const restartClockTimer = useCallback(() => {
    stopClockLoop();
    const { compiled: isCompiled, running: isRunning, speed: currentSpeed } = clockStateRef.current;
    if (!isCompiled || !isRunning || currentSpeed === 'step') return;
    if (currentSpeed === 'turbo') {
      let lastTime = performance.now();
      let carryCycles = 0;
      const frame = (now: number) => {
        if (
          !clockStateRef.current.compiled ||
          !clockStateRef.current.running ||
          clockStateRef.current.speed !== 'turbo'
        ) {
          clockRafRef.current = null;
          return;
        }
        const dt = Math.min(50, Math.max(0, now - lastTime));
        lastTime = now;
        carryCycles += (dt * TURBO_TARGET_HZ) / 1000;
        const steps = Math.floor(carryCycles);
        if (steps >= 1) {
          carryCycles -= steps;
          stepCycles(Math.min(steps, 64));
        }
        clockRafRef.current = window.requestAnimationFrame(frame);
      };
      clockRafRef.current = window.requestAnimationFrame(frame);
      return;
    }
    clockTimerRef.current = window.setInterval(tick, SPEED_INTERVAL_MS[currentSpeed]);
  }, [stepCycles, stopClockLoop, tick]);

  // Board inputs & simulation loop
  function changeInputs(next: BoardInputs) {
    const resetPressed = next.rst_n === 0 && inputsRef.current.rst_n === 1;
    if (resetPressed) {
      pendingKeys.current = [];
      pendingReset.current = true;
    }
    const pressed = next.key & ~inputsRef.current.key;
    if (pressed) pendingKeys.current.push({ pressed, inputs: next });
    inputsRef.current = next;
    setInputs(next);

    const { compiled: isCompiled, running: isRunning, speed: currentSpeed } = clockStateRef.current;
    if (isCompiled && isRunning && currentSpeed !== 'step' && (resetPressed || pressed !== 0)) {
      if (currentSpeed === 'turbo') {
        stepCycles(16);
      } else {
        if (pressed !== 0 && (sampledKeys.current & pressed)) {
          tick();
        }
        tick();
        restartClockTimer();
      }
    }
  }

  function resetInputs() {
    pendingKeys.current = [];
    pendingReset.current = false;
    sampledKeys.current = 0;
    inputsRef.current = IDLE_INPUTS;
    setInputs(IDLE_INPUTS);
  }

  function clearCircuit() {
    simulation.current = null;
    applied.current = undefined;
    screenSyncRef.current = createScreenSyncState();
    setDisplayScreenBuffer(undefined);
    setCompiled(false);
    setCircuitUsesScreen(false);
    setBlueprint(undefined);
    setCode('');
    setVectors([]);
    setIssues([]);
    setSelfTest(undefined);
    setNetlist(undefined);
    setHistory([]);
    setHighlightLine(undefined);
    resetInputs();
  }

  function loadCircuit(
    source: string,
    checks: TestVectorStep[],
    title?: string,
    presetId?: string,
    verified?: SelfTestResult,
    options: { allowFailedSelfTest?: boolean; nextVersion?: number } = {},
  ) {
    const engine = engineFactory();
    const result = engine.compile(source);
    setIssues(result.issues);
    const verification = result.ok && checks.length ? verified ?? engine.runSelfTest(source, checks) : undefined;
    setSelfTest(verification);

    if (!result.ok) return { ok: false, verification, usesScreen: false };
    if (verification?.passed === false && !options.allowFailedSelfTest) {
      return { ok: false, verification, usesScreen: false };
    }

    const usesScreen = Boolean(result.metadata?.usedOutputs.includes('screen'));
    engine.reset();
    const initial = engine.step({ ...IDLE_INPUTS, rst_n: 0 });
    simulation.current = {
      step: (current) => engine.step(current),
      stepBatch: (current, steps) =>
        engine.stepBatch ? engine.stepBatch(current, steps) : { ...engine.step(current) },
    };
    const syncState = createScreenSyncState();
    advanceScreenSync(syncState, [initial.sample], { enabled: true, maxHoldCycles: 128 });
    screenSyncRef.current = syncState;
    setDisplayScreenBuffer(syncState.frontBuffer ?? initial.sample.screenBuffer);

    const ver = options.nextVersion ?? Math.max(1, version);
    applied.current = { source, title, version: ver };
    setActivePresetId(presetId);
    setCircuitUsesScreen(usesScreen);
    const preset = presetId ? runtime.presets.find((item) => item.id === presetId) : undefined;
    setSpeed((prev) => {
      if (preset?.recommendedClockSpeed) return preset.recommendedClockSpeed;
      if (usesScreen) return prev === 'turbo' ? 'turbo' : 'fast';
      return prev === 'fast' || prev === 'turbo' ? prefs.defaultClockSpeed : prev;
    });
    setRunning(true);
    resetInputs();
    setHistory([initial.sample]);
    setNetlist(initial.netlist);
    setCompiled(true);
    return { ok: true, verification, usesScreen };
  }

  useEffect(() => {
    restartClockTimer();
    return stopClockLoop;
  }, [compiled, running, speed, restartClockTimer, stopClockLoop]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      prefillAbortRef.current?.abort();
      liveCodeStreamerRef.current?.stop();
    },
    [],
  );

  function newChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    prefillAbortRef.current?.abort();
    prefillAbortRef.current = null;
    liveCodeStreamerRef.current?.stop();
    liveCodeStreamerRef.current = null;
    setAutoSubmittingPreset(false);
    setHomeDraft('');
    setPlanningBlueprint(false);
    setCodeStreamState(undefined);
    setRecommendedTab(null);
    userOverrodeTabRef.current = false;
    setTurns([]);
    setOutcome('ready');
    setTraces([]);
    setVersion(0);
    setActivePresetId(undefined);
    setSidebarCollapsed(false);
    setMobileChatSheetOpen(false);
    setSpeed(prefs.defaultClockSpeed);
    setRunning(true);
    clearCircuit();
    navigateTo({ view: 'home', railTab: 'chat', wbTab: 'canvas' });
  }

  function openShowcase() {
    setSidebarCollapsed(false);
    setMobileChatSheetOpen(false);
    navigateTo({ view: 'showcase', railTab: 'chat' });
  }

  function updateAssistantTurn(turnId: string, updater: (prev: ChatTurn) => ChatTurn) {
    setTurns((prev) => prev.map((t) => (t.id === turnId ? updater(t) : t)));
  }

  function autoSwitchTab(target: WorkbenchTab) {
    setRecommendedTab(target);
    if (!userOverrodeTabRef.current) {
      navigateTo({ view: 'workbench', wbTab: target }, { replace: true, skipTransition: true });
    }
  }

  function handleManualTabClick(tab: WorkbenchTab) {
    if (outcome === 'busy') {
      userOverrodeTabRef.current = true;
    }
    navigateTo({ view: 'workbench', wbTab: tab });
  }

  async function triggerHomeQuickPrompt(promptText: string, preset: PresetProject) {
    if (autoSubmittingPreset || outcome === 'busy') return;
    prefillAbortRef.current?.abort();
    const ctrl = new AbortController();
    prefillAbortRef.current = ctrl;

    setAutoSubmittingPreset(true);
    setHomeDraft('');

    const filled = await streamTextSmoothly(
      promptText,
      Math.min(280, Math.max(160, promptText.length * 26)),
      (partial) => setHomeDraft(partial),
      ctrl.signal,
    );
    if (!filled || ctrl.signal.aborted) {
      setAutoSubmittingPreset(false);
      return;
    }

    const waited = await sleepAbortable(200, ctrl.signal);
    if (!waited || ctrl.signal.aborted) {
      setAutoSubmittingPreset(false);
      return;
    }

    setHomeDraft('');
    setAutoSubmittingPreset(false);
    void run(promptText, preset);
  }

  function compileEditedCode() {
    const { ok } = loadCircuit(code, vectors, blueprint?.title, activePresetId, undefined, {
      nextVersion: Math.max(1, version),
    });
    if (ok) {
      setOutcome('ready');
      setHighlightLine(undefined);
    } else {
      setOutcome('failed');
      navigateTo({ view: 'workbench', wbTab: 'verify' });
    }
  }

  async function run(prompt: string, preset?: PresetProject) {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    liveCodeStreamerRef.current?.stop();
    liveCodeStreamerRef.current = null;

    const previous = applied.current;
    const nextVer = (previous?.version ?? 0) + 1;
    const userTurnId = nextId('user');
    const aiTurnId = nextId('ai');
    const startedAt = Date.now();
    const crossingFromHome = routeRef.current.view === 'home' && routeRef.current.railTab === 'chat';

    userOverrodeTabRef.current = false;

    const enterRunState = () => {
      navigateTo({ view: 'workbench', railTab: 'chat', wbTab: 'blueprint' }, { skipTransition: true });
      setRecommendedTab('blueprint');
      setSidebarCollapsed(false);
      setMobileChatSheetOpen(true);
      setHighlightLine(undefined);
      setOutcome('busy');
      setTraces([]);
      setPlanningBlueprint(true);
      setCodeStreamState(undefined);
      if (!previous) setBlueprint(undefined);

      setTurns((prev) => [
        ...prev,
        { id: userTurnId, role: 'user', text: prompt },
        {
          id: aiTurnId,
          role: 'assistant',
          text: '',
          status: 'running',
          traces: [],
          liveReasoning: {},
          startedAt,
          version: nextVer,
        },
      ]);
    };

    const isMobileViewport = window.matchMedia('(max-width: 780px)').matches;
    if (crossingFromHome && !isMobileViewport) {
      await startSpatialTransition(enterRunState, 'enter-workbench');
      if (abortRef.current !== controller || controller.signal.aborted) return;
    } else {
      enterRunState();
    }

    const active = () => abortRef.current === controller && !controller.signal.aborted;

    function pushTrace(event: HarnessTraceEvent) {
      if (!active()) return;
      setTraces((events) => [...events, event]);
      updateAssistantTurn(aiTurnId, (t) => ({
        ...t,
        traces: [...(t.traces ?? []), event],
      }));
    }

    function updateStepReasoning(stage: HarnessTraceEvent['stage'], reasoning: string, round?: number) {
      if (!active()) return;
      const key = stepKeyForTrace(stage, round);
      updateAssistantTurn(aiTurnId, (t) => ({
        ...t,
        liveReasoning: { ...(t.liveReasoning ?? {}), [key]: reasoning },
      }));
    }

    function updateCodingLines(lines: number) {
      if (!active() || lines <= 0) return;
      updateAssistantTurn(aiTurnId, (t) => {
        const list = t.traces ?? [];
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].stage === 'coding' || list[i].stage === 'repairing') {
            const next = [...list];
            next[i] = {
              ...next[i],
              meta: { ...(next[i].meta ?? {}), codeLines: lines },
            };
            return { ...t, traces: next };
          }
        }
        return t;
      });
    }

    try {
      const runLocale = localeRef.current;
      const tRun = (zh: string, en: string) => (runLocale === 'en' ? en : zh);

      if (preset) {
        if (preset.boardProfileId) {
          const targetBoard = getBoardPresetById(preset.boardProfileId);
          if (targetBoard) handleSelectBoardProfile(targetBoard);
        }
        const lp = localizePreset(preset, runLocale);
        const planReasoning = [
          tRun(`拆解目标：${lp.blueprint.summary}`, `Goal: ${lp.blueprint.summary}`),
          tRun(
            `对齐顶层接口：${lp.blueprint.pinMappings.map((p) => p.port).join('、')}`,
            `Align top-level ports: ${lp.blueprint.pinMappings.map((p) => p.port).join(', ')}`,
          ),
          tRun(
            `设计 ${lp.testVectors.length} 拍确定性验证序列，覆盖低电平复位与关键交互分支。`,
            `Design ${lp.testVectors.length}-cycle deterministic test sequence covering active-low reset and key interactions.`,
          ),
        ].join('\n');

        pushTrace({
          stage: 'planning',
          status: 'running',
          title: tRun('规划电路蓝图', 'Plan Circuit Blueprint'),
          detail: tRun(
            `分析需求「${prompt}」并拆解端口、状态机与自测向量`,
            `Analyzing "${prompt}" into ports, FSM states, and test vectors`,
          ),
          timestamp: Date.now(),
        });

        const reasoned = await streamTextSmoothly(
          planReasoning,
          560,
          (partial) => updateStepReasoning('planning', partial),
          controller.signal,
        );
        if (!reasoned || !active()) return;
        if (!(await sleepAbortable(160, controller.signal)) || !active()) return;

        setBlueprint(lp.blueprint);
        setPlanningBlueprint(false);
        const planCheckpoints = [
          ...lp.blueprint.behaviors.slice(0, 4).map((b, i) => `${i + 1}. ${b}`),
          tRun(
            `端口映射：${lp.blueprint.pinMappings.map((p) => p.port).slice(0, 5).join(' / ')}`,
            `Pin map: ${lp.blueprint.pinMappings.map((p) => p.port).slice(0, 5).join(' / ')}`,
          ),
        ];
        pushTrace({
          stage: 'planning',
          status: 'pass',
          title: tRun('规划电路蓝图', 'Plan Circuit Blueprint'),
          detail: tRun(
            `${lp.blueprint.behaviors.length} 条行为要点 · ${lp.blueprint.pinMappings.length} 个引脚映射 · ${lp.testVectors.length} 拍自测向量`,
            `${lp.blueprint.behaviors.length} behaviors · ${lp.blueprint.pinMappings.length} pin mappings · ${lp.testVectors.length} test cycles`,
          ),
          timestamp: Date.now(),
          meta: { checkpoints: planCheckpoints, reasoning: planReasoning },
        });

        if (!(await sleepAbortable(280, controller.signal)) || !active()) return;

        // Stage 2: Coding — auto switch to Verilog view and stream by complete lexical tokens.
        autoSwitchTab('verilog');
        setCode('');
        setCodeStreamState({
          active: true,
          stage: 'coding',
          statusText: tRun('正在编写可综合 Verilog 源码…', 'Streaming synthesizable Verilog RTL…'),
        });
        pushTrace({
          stage: 'coding',
          status: 'running',
          title: tRun('编写 Verilog 源码', 'Generate Verilog RTL'),
          detail: tRun(
            '按蓝图规格与端口约束生成可综合 top 模块',
            'Generating synthesizable top module aligned to board ports',
          ),
          timestamp: Date.now(),
        });

        const totalLines = lp.verilogCode.split('\n').length;
        const codingDurationMs = Math.min(2550, Math.max(2050, totalLines * 26));
        let lastReportedLine = 0;
        const streamed = await streamVerilogTokens(
          lp.verilogCode,
          codingDurationMs,
          (partial, lines) => {
            if (!active()) return;
            setCode(partial);
            if (lines - lastReportedLine >= 4 || lines === totalLines) {
              lastReportedLine = lines;
              updateCodingLines(lines);
            }
          },
          controller.signal,
        );
        if (!streamed || !active()) return;

        setCode(lp.verilogCode);
        setVectors(lp.testVectors);
        pushTrace({
          stage: 'coding',
          status: 'pass',
          title: tRun('编写 Verilog 源码', 'Generate Verilog RTL'),
          detail: tRun(
            `${totalLines} 行可综合 Verilog · 顶层端口与时序逻辑已生成`,
            `${totalLines} lines of synthesizable Verilog · top ports & sequential logic ready`,
          ),
          timestamp: Date.now(),
          meta: {
            codeLines: totalLines,
            checkpoints: [
              tRun(
                `模块 top 已对齐 clk / rst_n / key / sw / led / traffic / seg 端口规范`,
                `Module top aligned with clk / rst_n / key / sw / led / traffic / seg`,
              ),
            ],
          },
        });

        // Stage 3: Lint — stay on Verilog view, run real engine lint.
        setCodeStreamState({
          active: true,
          stage: 'linting',
          statusText: tRun('Lint 静态语法与可综合规则体检中…', 'Running static Verilog lint & synthesis checks…'),
        });
        pushTrace({
          stage: 'linting',
          status: 'running',
          title: tRun('Lint 静态体检', 'Static Lint Check'),
          detail: tRun(
            `检查第 1 版代码（${totalLines} 行）的语法与可综合规则`,
            `Checking v1 RTL (${totalLines} lines) against synthesizable rules`,
          ),
          timestamp: Date.now(),
          meta: { round: 0 },
        });

        if (!(await sleepAbortable(340, controller.signal)) || !active()) return;
        const lintEngine = engineFactory();
        const compiledCheck = lintEngine.compile(lp.verilogCode);
        const errorCount = compiledCheck.issues.filter((i) => i.severity === 'error').length;
        pushTrace({
          stage: 'linting',
          status: compiledCheck.ok ? 'pass' : 'fail',
          title: tRun('Lint 静态体检', 'Static Lint Check'),
          detail:
            compiledCheck.issues.length === 0
              ? tRun('0 错误 · 0 告警', '0 errors · 0 warnings')
              : tRun(
                  `${compiledCheck.issues.length} 条告警（${errorCount} 条 error）`,
                  `${compiledCheck.issues.length} issues (${errorCount} errors)`,
                ),
          timestamp: Date.now(),
          meta: {
            round: 0,
            checkpoints:
              compiledCheck.issues.length === 0
                ? [
                    tRun('端口声明与位宽对齐通过', 'Port declarations & bit-widths verified'),
                    tRun(
                      '0 阻塞/非阻塞混用错误 · 0 推断锁存器告警',
                      '0 blocking/non-blocking mix-ups · 0 inferred latches',
                    ),
                  ]
                : compiledCheck.issues.slice(0, 4).map((i) => `L${i.line} [${i.code}] ${i.message}`),
          },
        });

        // Stage 4: Deterministic simulation — stay on Verilog view, run real self-test.
        setCodeStreamState({
          active: true,
          stage: 'simulating',
          statusText: tRun(
            `正在执行 ${lp.testVectors.length} 拍确定性仿真向量…`,
            `Running ${lp.testVectors.length}-cycle deterministic simulation…`,
          ),
        });
        pushTrace({
          stage: 'simulating',
          status: 'running',
          title: tRun('确定性仿真自测', 'Deterministic Self-Test'),
          detail: tRun(
            `运行 ${lp.testVectors.length} 拍测试向量并校验板卡输出`,
            `Executing ${lp.testVectors.length} test vectors and checking board outputs`,
          ),
          timestamp: Date.now(),
          meta: { round: 0 },
        });

        if (!(await sleepAbortable(480, controller.signal)) || !active()) return;

        const { ok, verification, usesScreen } = loadCircuit(
          lp.verilogCode,
          lp.testVectors,
          lp.blueprint.title,
          lp.id,
          undefined,
          { nextVersion: nextVer },
        );

        if (!ok) {
          setCodeStreamState(undefined);
          setRecommendedTab(null);
          setOutcome('failed');
          pushTrace({
            stage: 'simulating',
            status: 'fail',
            title: tRun('确定性仿真自测', 'Deterministic Self-Test'),
            detail: tRun('部分测试向量未通过，请查看自测详情', 'Some test vectors failed — inspect Self-Test tab'),
            timestamp: Date.now(),
            meta: { round: 0 },
          });
          updateAssistantTurn(aiTurnId, (t) => ({
            ...t,
            status: 'failed',
            finishedAt: Date.now(),
            text: tRun(
              '生成的电路验证未通过，可在右侧「自测」页签查看失配周期与波形细节。',
              'Verification failed. Check the Self-Test tab for mismatched cycles and waveforms.',
            ),
          }));
          autoSwitchTab('verify');
          return;
        }

        const simCheckpoints = lp.testVectors
          .filter((v) => v.note)
          .slice(0, 4)
          .map((v) => tRun(`✓ 第 ${v.cycle} 拍 · ${v.note}`, `✓ Cycle ${v.cycle} · ${v.note}`));
        pushTrace({
          stage: 'simulating',
          status: 'pass',
          title: tRun('确定性仿真自测', 'Deterministic Self-Test'),
          detail: tRun(
            `${verification?.passedChecks ?? lp.testVectors.length}/${verification?.totalChecks ?? lp.testVectors.length} 项断言全部通过`,
            `All ${verification?.passedChecks ?? lp.testVectors.length}/${verification?.totalChecks ?? lp.testVectors.length} assertions passed`,
          ),
          timestamp: Date.now(),
          meta: { round: 0, checkpoints: simCheckpoints },
        });

        // Stage 5: Verified feedback pause (~450ms) then smoothly switch to Canvas!
        setCodeStreamState({
          active: true,
          stage: 'verified',
          statusText: tRun(
            `全部 ${verification?.passedChecks ?? lp.testVectors.length}/${verification?.totalChecks ?? lp.testVectors.length} 项断言通过 · 正在上板加载仿真画布…`,
            `All ${verification?.passedChecks ?? lp.testVectors.length}/${verification?.totalChecks ?? lp.testVectors.length} checks passed · Loading live simulation canvas…`,
          ),
        });
        if (!(await sleepAbortable(450, controller.signal)) || !active()) return;

        const filename = deriveVerilogFilename(lp.verilogCode, lp.id);
        setCodeStreamState(undefined);
        setVersion(nextVer);
        setRecommendedTab(null);
        autoSwitchTab(usesScreen ? 'screen' : 'canvas');
        pushTrace({
          stage: 'done',
          status: 'pass',
          title: tRun('验证通过，已上板仿真', 'Verified & Loaded on Board'),
          detail: tRun(
            `全部 ${verification?.totalChecks ?? lp.testVectors.length} 项断言通过`,
            `All ${verification?.totalChecks ?? lp.testVectors.length} assertions passed`,
          ),
          timestamp: Date.now(),
        });

        const finalSummary = tRun(
          `已完成「${lp.blueprint.title}」的蓝图规划、Verilog 编码与 ${verification?.totalChecks ?? lp.testVectors.length} 拍自测验证。${lp.blueprint.summary} 右侧已加载 V${nextVer} 门级原理图与虚拟开发板，可直接操作按键或拨码观察实时信号变化。`,
          `Completed blueprint planning, Verilog RTL generation, and ${verification?.totalChecks ?? lp.testVectors.length}-cycle verification for "${lp.blueprint.title}". ${lp.blueprint.summary} V${nextVer} gate schematic and virtual board are live on the right — press keys or toggle switches to observe real-time signals.`,
        );
        const finishedAt = Date.now();
        updateAssistantTurn(aiTurnId, (t) => ({
          ...t,
          finishedAt,
          filename,
          code: lp.verilogCode,
          passedChecks: verification?.passedChecks,
          totalChecks: verification?.totalChecks,
        }));

        await streamTextSmoothly(
          finalSummary,
          420,
          (partial) => {
            if (!active()) return;
            updateAssistantTurn(aiTurnId, (t) => ({ ...t, text: partial }));
          },
          controller.signal,
        );
        if (!active()) return;

        setOutcome('ready');
        setMobileChatSheetOpen(false);
        updateAssistantTurn(aiTurnId, (t) => ({
          ...t,
          status: 'done',
          text: finalSummary,
        }));

        const saved = saveHistoryEntry({
          id: nextId('hist'),
          title: lp.blueprint.title,
          prompt,
          filename,
          version: nextVer,
          code: lp.verilogCode,
          vectors: lp.testVectors,
          blueprint: lp.blueprint,
          presetId: lp.id,
          passedChecks: verification?.passedChecks,
          totalChecks: verification?.totalChecks,
          timestamp: Date.now(),
        });
        setHistoryEntries(saved);
      } else {
        const recentHistory = turns
          .filter((t) => t.text.trim())
          .slice(-6)
          .map((t) => ({ role: t.role, content: t.text }));

        let lastLiveLines = 0;
        const codeStreamer = createLiveCodeStreamer((partial, lines) => {
          if (!active()) return;
          setCode(partial);
          if (lines - lastLiveLines >= 3) {
            lastLiveLines = lines;
            updateCodingLines(lines);
          }
        });
        liveCodeStreamerRef.current = codeStreamer;

        let lastReasoningUpdate = 0;
        const handleHarnessTrace = (event: HarnessTraceEvent) => {
          pushTrace(event);
          if (!active()) return;

          if (event.stage === 'planning' && event.status === 'running') {
            setPlanningBlueprint(true);
            autoSwitchTab('blueprint');
          } else if (event.stage === 'planning' && event.status === 'pass') {
            setPlanningBlueprint(false);
          } else if (event.stage === 'coding' && event.status === 'running') {
            setPlanningBlueprint(false);
            lastLiveLines = 0;
            codeStreamer.reset();
            setCode('');
            autoSwitchTab('verilog');
            setCodeStreamState({
              active: true,
              stage: 'coding',
              statusText: tRun('正在实时编写可综合 Verilog 源码…', 'Streaming synthesizable Verilog RTL…'),
            });
          } else if (event.stage === 'linting' && event.status === 'running') {
            setCodeStreamState({
              active: true,
              stage: 'linting',
              statusText: event.detail || tRun('Lint 静态体检中…', 'Running static lint checks…'),
            });
          } else if (event.stage === 'simulating' && event.status === 'running') {
            setCodeStreamState({
              active: true,
              stage: 'simulating',
              statusText: event.detail || tRun('确定性仿真自测中…', 'Running deterministic self-test…'),
            });
          } else if (event.stage === 'repairing' && event.status === 'running') {
            lastLiveLines = 0;
            codeStreamer.reset();
            if (event.meta?.highlightLine) setHighlightLine(event.meta.highlightLine);
            autoSwitchTab('verilog');
            setCodeStreamState({
              active: true,
              stage: 'repairing',
              statusText: `${event.title} · ${event.detail}`,
            });
          }
        };

        const activeClockIntervalMs =
          speed === 'realtime' || speed === 'slow'
            ? SPEED_INTERVAL_MS[speed]
            : SPEED_INTERVAL_MS[prefs.defaultClockSpeed];

        const result = await runtime.runHarness(prompt, {
          signal: controller.signal,
          locale: runLocale,
          boardProfile,
          clockIntervalMs: activeClockIntervalMs,
          onTrace: handleHarnessTrace,
          onBlueprint: (bp) => {
            if (!active()) return;
            setBlueprint(bp);
            setPlanningBlueprint(false);
          },
          onCodeDelta: (partialCode, meta) => {
            if (!active()) return;
            codeStreamer.push(partialCode, Boolean(meta?.final));
          },
          onReasoningDelta: (stage, reasoning, round) => {
            if (!active()) return;
            const nowTs = performance.now();
            if (nowTs - lastReasoningUpdate < 75) return;
            lastReasoningUpdate = nowTs;
            updateStepReasoning(stage, reasoning, round);
          },
          model: selectedModel,
          enableWebResearch: prefs.enableWebResearch,
          previousContext: previous
            ? {
                blueprint,
                verilogCode: previous.source,
                testVectors: vectors,
                history: recentHistory,
              }
            : undefined,
        });

        codeStreamer.flush(result.verilogCode);
        if (liveCodeStreamerRef.current === codeStreamer) liveCodeStreamerRef.current = null;
        if (!active()) return;
        if (result.remainingQuota !== undefined) setRemainingQuota(result.remainingQuota);

        setPlanningBlueprint(false);
        setBlueprint(result.blueprint);
        setCode(result.verilogCode);
        setVectors(result.testVectors);

        if (!result.ok) {
          setCodeStreamState(undefined);
          setRecommendedTab(null);
          setIssues(result.issues);
          setSelfTest(result.selfTest);
          setOutcome('failed');
          updateAssistantTurn(aiTurnId, (t) => ({
            ...t,
            status: 'failed',
            finishedAt: Date.now(),
            text:
              result.assistantSummary ??
              (previous
                ? tRun(
                    '新候选验证未通过，右侧板卡仍保持上一版本运行。可在「自测」或「Verilog」页签排查。',
                    'New candidate failed verification; previous version stays active on board. Inspect Self-Test or Verilog tab.',
                  )
                : tRun(
                    '生成的候选代码未通过编译或自测，可在右侧「自测」页签查看具体失配拍与 Lint 提示。',
                    'Generated RTL failed compile or self-test. Inspect mismatched cycles and lint hints in Self-Test.',
                  )),
            passedChecks: result.selfTest?.passedChecks,
            totalChecks: result.selfTest?.totalChecks,
            modelUsed: result.modelUsed ?? (api ? selectedModel : undefined),
            references: result.references,
          }));
          autoSwitchTab('verify');
          return;
        }

        const { ok, verification, usesScreen } = loadCircuit(
          result.verilogCode,
          result.testVectors,
          result.blueprint.title,
          undefined,
          result.selfTest,
          { nextVersion: nextVer },
        );

        if (!ok) {
          setCodeStreamState(undefined);
          setRecommendedTab(null);
          setOutcome('failed');
          updateAssistantTurn(aiTurnId, (t) => ({
            ...t,
            status: 'failed',
            finishedAt: Date.now(),
            text: tRun(
              '上板验证未通过，请在右侧「自测」页签查看原因。',
              'Board verification failed. Check the Self-Test tab for details.',
            ),
          }));
          autoSwitchTab('verify');
          return;
        }

        setCodeStreamState({
          active: true,
          stage: 'verified',
          statusText: tRun(
            `全部 ${verification?.passedChecks ?? 0}/${verification?.totalChecks ?? 0} 项断言通过 · 正在上板加载仿真画布…`,
            `All ${verification?.passedChecks ?? 0}/${verification?.totalChecks ?? 0} checks passed · Loading simulation canvas…`,
          ),
        });
        if (!(await sleepAbortable(450, controller.signal)) || !active()) return;

        const filename = deriveVerilogFilename(
          result.verilogCode,
          result.blueprint.title,
          result.suggestedFilename,
        );
        const usedModel = result.modelUsed ?? (api ? selectedModel : undefined);
        const finalSummary =
          result.assistantSummary ??
          tRun(
            `已完成「${result.blueprint.title}」并全部通过自测，右侧已刷新为 V${nextVer} 仿真视图。`,
            `Completed "${result.blueprint.title}" with all self-tests passing. Live V${nextVer} simulation is ready on the right.`,
          );

        setCodeStreamState(undefined);
        setVersion(nextVer);
        setRecommendedTab(null);
        autoSwitchTab(usesScreen ? 'screen' : 'canvas');

        updateAssistantTurn(aiTurnId, (t) => ({
          ...t,
          finishedAt: Date.now(),
          filename,
          code: result.verilogCode,
          passedChecks: verification?.passedChecks,
          totalChecks: verification?.totalChecks,
          modelUsed: usedModel,
          references: result.references,
        }));

        await streamTextSmoothly(
          finalSummary,
          420,
          (partial) => {
            if (!active()) return;
            updateAssistantTurn(aiTurnId, (t) => ({ ...t, text: partial }));
          },
          controller.signal,
        );
        if (!active()) return;

        setOutcome('ready');
        setMobileChatSheetOpen(false);
        updateAssistantTurn(aiTurnId, (t) => ({
          ...t,
          status: 'done',
          text: finalSummary,
        }));

        const saved = saveHistoryEntry({
          id: nextId('hist'),
          title: result.blueprint.title,
          prompt,
          filename,
          version: nextVer,
          code: result.verilogCode,
          vectors: result.testVectors,
          blueprint: result.blueprint,
          passedChecks: verification?.passedChecks,
          totalChecks: verification?.totalChecks,
          modelUsed: usedModel,
          timestamp: Date.now(),
        });
        setHistoryEntries(saved);
      }
    } catch (error) {
      liveCodeStreamerRef.current?.stop();
      liveCodeStreamerRef.current = null;
      if (!active()) return;
      setPlanningBlueprint(false);
      setCodeStreamState(undefined);
      setRecommendedTab(null);
      const errCode = isLLMError(error) ? error.code : undefined;
      if (errCode === 'QUOTA_EXCEEDED' && !api) {
        setRemainingQuota(0);
      }
      const rawMessage = isLLMError(error) ? error.message.trim() : '';
      const runLocale = localeRef.current;
      const baseText = errCode
        ? getLlmErrorText(errCode, runLocale)
        : runLocale === 'en'
          ? 'Generation failed. Please retry.'
          : '生成未完成，请重试。';
      const detail =
        rawMessage && errCode !== 'ABORTED' && !baseText.includes(rawMessage)
          ? runLocale === 'en'
            ? `${baseText} (${rawMessage})`
            : `${baseText}（${rawMessage}）`
          : baseText;
      setOutcome('failed');
      pushTrace({
        stage: 'failed',
        status: 'fail',
        title: runLocale === 'en' ? 'Execution Failed' : '执行失败',
        detail,
        timestamp: Date.now(),
      });
      updateAssistantTurn(aiTurnId, (t) => ({
        ...t,
        status: 'failed',
        finishedAt: Date.now(),
        text: detail,
        errorCode: errCode,
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    liveCodeStreamerRef.current?.stop();
    liveCodeStreamerRef.current = null;
    setPlanningBlueprint(false);
    setCodeStreamState(undefined);
    setRecommendedTab(null);
    setOutcome('cancelled');
    setTurns((prev) =>
      prev.map((t) =>
        t.status === 'running'
          ? {
              ...t,
              status: 'cancelled',
              finishedAt: Date.now(),
              text: L('已停止本轮生成，可继续输入新需求。', 'Generation stopped. Enter a new prompt to continue.'),
            }
          : t,
      ),
    );
  }

  function restoreHistoryEntry(entry: HistoryEntry) {
    setHighlightLine(undefined);
    setBlueprint(entry.blueprint);
    setCode(entry.code);
    setVectors(entry.vectors);
    setVersion(entry.version);
    const restored = loadCircuit(entry.code, entry.vectors, entry.blueprint.title, entry.presetId, undefined, {
      nextVersion: entry.version,
    });
    setTurns([
      { id: nextId('user'), role: 'user', text: entry.prompt },
      {
        id: nextId('ai'),
        role: 'assistant',
        status: 'done',
        text: L(
          `已从本地历史恢复「${entry.title}」（V${entry.version}），右侧板卡与门级图已同步上板。`,
          `Restored "${entry.title}" (V${entry.version}) from local history. Board and gate schematic are live.`,
        ),
        version: entry.version,
        filename: entry.filename,
        code: entry.code,
        passedChecks: entry.passedChecks,
        totalChecks: entry.totalChecks,
        modelUsed: entry.modelUsed,
      },
    ]);
    setMobileChatSheetOpen(false);
    navigateTo({ view: 'workbench', railTab: 'chat', wbTab: restored.usesScreen ? 'screen' : 'canvas' });
  }

  // Export & Copy helpers
  const activeFilename = deriveVerilogFilename(code, activePresetId ?? blueprint?.title);

  async function copyHeaderCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedHeader(true);
      window.setTimeout(() => setCopiedHeader(false), 1600);
    } catch {
      // Ignore clipboard failures.
    }
  }

  function handleExportVerilog(filename = activeFilename, source = code) {
    if (!source) return;
    downloadTextFile(filename, source);
  }

  function handleExportTestbench() {
    if (!code) return;
    const engine = engineFactory();
    const tb = engine.exportTestbench
      ? engine.exportTestbench(code, vectors)
      : buildFallbackTestbench(code, vectors);
    downloadTextFile('tb_top.v', tb);
  }

  function stepOnce() {
    setSpeed('step');
    setRunning(false);
    stepCycles(1, { forceImmediateDisplay: true });
  }

  function toggleRun() {
    if (speed === 'step') {
      setSpeed(lastRunSpeedRef.current);
      setRunning(true);
    } else {
      setRunning((value) => !value);
    }
  }

  function handleToggleScreenVsync() {
    setScreenVsync((prev) => {
      const next = !prev;
      if (!next && history.at(-1)?.screenBuffer) {
        const raw = history.at(-1)!.screenBuffer!;
        screenSyncRef.current.frontBuffer = raw;
        screenSyncRef.current.dirtyStreak = 0;
        setDisplayScreenBuffer(raw);
      }
      return next;
    });
  }

  function jumpToVerilogLine(line?: number) {
    setHighlightLine(line);
    setMobileChatSheetOpen(false);
    navigateTo({ view: 'workbench', railTab: 'chat', wbTab: 'verilog' });
  }

  const busy = outcome === 'busy';
  const latest = history.at(-1);
  const hasSession = view === 'workbench';

  const statusBadge = useMemo(() => {
    if (!latest) return undefined;
    const traffic = latest.outputs.traffic;
    if (traffic & 4) return L('红灯亮', 'RED ON');
    if (traffic & 2) return L('黄灯亮', 'YELLOW ON');
    if (traffic & 1) return L('绿灯亮', 'GREEN ON');
    if (latest.outputs.led) return `LED 0x${latest.outputs.led.toString(16).toUpperCase().padStart(2, '0')}`;
    return running ? L('仿真中', 'Running') : L('已暂停', 'Paused');
  }, [latest, running, L]);

  const leftHeaderTitle =
    railTab === 'board'
      ? L('开发板配置', 'Board Profile')
      : railTab === 'presets'
        ? L('预置电路案例', 'Built-in Circuit Demos')
        : railTab === 'history'
          ? L('本地版本历史', 'Local Version History')
          : blueprint?.title ?? L('新电路对话', 'New Circuit Chat');

  const homeQuotaText = api
    ? L(`自定义 API · ${providerLabel}`, `Custom API · ${providerLabel}`)
    : remainingQuota !== undefined && dailyQuotaLimit !== undefined
      ? L(`站点免费额度 · ${remainingQuota}/${dailyQuotaLimit}`, `Free Quota · ${remainingQuota}/${dailyQuotaLimit}`)
      : remainingQuota !== undefined
        ? L(`站点免费额度 · 剩 ${remainingQuota} 次`, `Free Quota · ${remainingQuota} left`)
        : L('站点免费额度', 'Free Site Quota');

  const wbTitleVersion = applied.current?.version ?? version;

  return (
    <div
      className="app-frame"
      data-view={view}
      data-rail-tab={railTab}
      data-has-session={hasSession}
      data-sidebar-collapsed={sidebarCollapsed}
      data-mobile-chat-open={mobileChatSheetOpen}
      data-resizing={resizingPane}
      style={{ '--left-pane-width': `${leftPaneWidth}px` } as CSSProperties}
    >
      {view !== 'showcase' && (
        <header className="mobile-topbar">
          <button
            type="button"
            className="mobile-logo-btn"
            onClick={openShowcase}
            title={L('FPGAgent · 产品介绍', 'FPGAgent · Product Overview')}
            aria-label={L('FPGAgent · 点击进入产品介绍页', 'FPGAgent · Open product overview')}
          >
            <BrandWordmark className="mobile-topbar-logo" />
          </button>
        </header>
      )}

      <NavRail
        activeTab={railTab}
        isShowcase={view === 'showcase'}
        onSelectTab={(tab) => {
          setSidebarCollapsed(false);
          setMobileChatSheetOpen(false);
          if (tab === 'chat') {
            if (turns.length > 0 || compiled) {
              navigateTo({ view: 'workbench', railTab: 'chat' });
            } else {
              navigateTo({ view: 'home', railTab: 'chat' });
            }
          } else {
            navigateTo({ view: 'workbench', railTab: tab });
          }
        }}
        onOpenShowcase={openShowcase}
        onNewChat={newChat}
        onOpenSettings={() => openSettings('api')}
        resolvedTheme={resolvedTheme}
        onToggleTheme={toggleLightDark}
        hasCustomApi={Boolean(api)}
      />

      {settingsOpen && (
        <ApiSettings
          config={api}
          theme={theme}
          prefs={prefs}
          remainingQuota={remainingQuota}
          dailyQuotaLimit={dailyQuotaLimit}
          initialSection={settingsSection}
          onSaveApi={setApi}
          onThemeChange={handleThemeChange}
          onPrefsChange={(next) => {
            if (next.defaultClockSpeed !== prefs.defaultClockSpeed) {
              setSpeed(next.defaultClockSpeed);
            }
            setPrefs(next);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {view === 'showcase' ? (
        <ProductShowcase
          presets={runtime.presets}
          hasActiveSession={turns.length > 0 || compiled}
          onStartDesigning={() => {
            setSidebarCollapsed(false);
            navigateTo({ view: 'home', railTab: 'chat' });
          }}
          onReturnWorkbench={() => {
            setSidebarCollapsed(false);
            navigateTo({ view: 'workbench', railTab: 'chat' });
          }}
          onTryPreset={(preset) => void run(localizePreset(preset, locale).prompt, preset)}
          onOpenPresets={() => {
            setSidebarCollapsed(false);
            navigateTo({ view: 'workbench', railTab: 'presets' });
          }}
        />
      ) : !hasSession ? (
        <main className="home-stage">
          <header className="home-topbar">
            <div className="home-brand">
              <BrandWordmark className="home-brand-wordmark" />
              <span>{L('专注于 FPGA 的 AI Agent', 'The AI Agent Built for FPGA')}</span>
            </div>
            <div className="home-topbar-actions">
              <button
                type="button"
                className="home-quota-link mono"
                onClick={() => openSettings('api')}
                title={L(`${homeQuotaText} · 点击管理模型与 API 配置`, `${homeQuotaText} · Click to manage models & API`)}
              >
                <span className="status-dot" />
                <span>{homeQuotaText}</span>
              </button>
            </div>
          </header>

          <div className="home-center">
            <div className="home-hero">
              <h1 className="home-hero-heading">
                {L('用自然语言编写并仿真数字电路', 'Design & Simulate Digital Circuits in Natural Language')}
              </h1>

              <PromptComposer
                onSend={(prompt) => void run(prompt)}
                models={availableModels}
                selectedModel={selectedModel}
                providerLabel={providerLabel}
                quotaNotice={siteQuotaNotice}
                onSelectModel={handleSelectModel}
                onOpenSettings={() => openSettings('api')}
                enableWebResearch={prefs.enableWebResearch}
                onToggleWebResearch={handleToggleWebResearch}
                draftValue={homeDraft}
                onDraftChange={setHomeDraft}
                autoSubmitting={autoSubmittingPreset}
                viewTransitionName="main-composer"
              />

              <section className="quick-prompts" aria-labelledby="quick-prompts-label">
                <div className="quick-prompts-head">
                  <h2 id="quick-prompts-label">{L('试试快捷示例', 'Try a Quick Demo')}</h2>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setSidebarCollapsed(false);
                      navigateTo({ view: 'workbench', railTab: 'presets' });
                    }}
                  >
                    <LayoutGrid size={13} />{' '}
                    {L(`全部 ${runtime.presets.length} 个示例`, `All ${runtime.presets.length} Demos`)}
                  </button>
                </div>

                <div className="quick-grid">
                  {QUICK_PROMPTS.map(({ id, prompt, promptEn, desc, descEn, Icon }) => {
                    const preset = runtime.presets.find((item) => item.id === id);
                    const displayPrompt = L(prompt, promptEn);
                    const displayDesc = L(desc, descEn);
                    return (
                      <button
                        key={id}
                        type="button"
                        className="quick-card"
                        disabled={!preset || autoSubmittingPreset}
                        onClick={() => preset && void triggerHomeQuickPrompt(displayPrompt, preset)}
                      >
                        <span className="quick-card-icon">
                          <Icon size={17} />
                        </span>
                        <span className="quick-card-text">
                          <strong>{displayPrompt}</strong>
                          <small>{displayDesc}</small>
                        </span>
                        <ChevronRight size={15} className="quick-card-arrow" />
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </main>
      ) : (
        <>
          {railTab === 'chat' && mobileChatSheetOpen && (
            <div
              className="mobile-sheet-backdrop"
              aria-hidden="true"
              onClick={() => setMobileChatSheetOpen(false)}
            />
          )}

          <section
            className="left-pane"
            aria-label={leftHeaderTitle}
            aria-hidden={sidebarCollapsed || undefined}
          >
              {railTab === 'chat' && <div className="mobile-sheet-handle" aria-hidden="true" />}
              <header className="pane-header">
                <div className="pane-title-wrap">
                  <h1 className="pane-title" title={leftHeaderTitle}>
                    {leftHeaderTitle}
                  </h1>
                </div>
                <div className="pane-header-right">
                  <button
                    type="button"
                    className="icon-button desktop-collapse-btn"
                    title={L('收起左侧栏', 'Collapse sidebar')}
                    aria-label={L('收起左侧栏', 'Collapse sidebar')}
                    onClick={() => setSidebarCollapsed(true)}
                  >
                    <PanelLeftClose size={16} />
                  </button>
                  {railTab === 'chat' && (
                    <button
                      type="button"
                      className="icon-button mobile-sheet-close"
                      title={L('关闭对话', 'Close chat')}
                      aria-label={L('关闭对话', 'Close chat')}
                      onClick={() => setMobileChatSheetOpen(false)}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </header>

              {railTab === 'chat' && (
                <>
                  <ChatPane
                    turns={turns}
                    onOpenCode={(src) => {
                      if (src) setCode(src);
                      setMobileChatSheetOpen(false);
                      handleManualTabClick('verilog');
                    }}
                    onDownloadCode={(filename, src) => handleExportVerilog(filename, src)}
                    onOpenVerify={() => {
                      setMobileChatSheetOpen(false);
                      handleManualTabClick('verify');
                    }}
                    onOpenSettings={() => {
                      setMobileChatSheetOpen(false);
                      openSettings('api');
                    }}
                    onJumpToLine={jumpToVerilogLine}
                  />
                  <div className="composer-dock">
                    <PromptComposer
                      compact
                      busy={busy}
                      onCancel={cancel}
                      onSend={(prompt) => void run(prompt)}
                      models={availableModels}
                      selectedModel={selectedModel}
                      providerLabel={providerLabel}
                      quotaNotice={siteQuotaNotice}
                      onSelectModel={handleSelectModel}
                      onOpenSettings={() => openSettings('api')}
                      enableWebResearch={prefs.enableWebResearch}
                      onToggleWebResearch={handleToggleWebResearch}
                      liveHint={
                        busy && compiled
                          ? L(`V${wbTitleVersion} 仿真可继续操作`, `V${wbTitleVersion} board stays interactive`)
                          : undefined
                      }
                      viewTransitionName={sidebarCollapsed ? undefined : 'main-composer'}
                    />
                  </div>
                </>
              )}

              {railTab === 'board' && (
                <BoardPanel
                  profile={boardProfile}
                  onSelectProfile={handleSelectBoardProfile}
                  onOpenScreenTab={() => {
                    setMobileChatSheetOpen(false);
                    navigateTo({ view: 'workbench', railTab: 'chat', wbTab: 'screen' });
                  }}
                />
              )}

              {railTab === 'presets' && (
                <PresetsPanel
                  presets={runtime.presets}
                  activePresetId={activePresetId}
                  busy={busy}
                  onSelectPreset={(preset) => void run(localizePreset(preset, locale).prompt, preset)}
                />
              )}

              {railTab === 'history' && (
                <HistoryPanel
                  entries={historyEntries}
                  onRestore={restoreHistoryEntry}
                  onDownload={(entry) => handleExportVerilog(entry.filename, entry.code)}
                  onDelete={(id) => setHistoryEntries(deleteHistoryEntry(id))}
                  onClear={() => {
                    clearHistoryEntries();
                    setHistoryEntries([]);
                  }}
                  onNewChat={newChat}
                  resolvedTheme={resolvedTheme}
                  onToggleTheme={toggleLightDark}
                  onOpenSettings={() => openSettings('api')}
                  hasCustomApi={Boolean(api)}
                />
              )}
          </section>

          {railTab === 'chat' && !mobileChatSheetOpen && (
            <button
              type="button"
              className={`mobile-chat-fab${busy ? ' busy' : ''}`}
              aria-label={L('展开对话与追问', 'Open chat drawer')}
              aria-expanded={false}
              onClick={() => setMobileChatSheetOpen(true)}
            >
              <MessageSquare size={20} strokeWidth={2.1} />
              {busy ? (
                <span className="mobile-fab-dot" aria-hidden="true" />
              ) : wbTitleVersion > 0 ? (
                <span className="mobile-fab-badge mono">V{wbTitleVersion}</span>
              ) : null}
            </button>
          )}

          <div
            className="pane-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-hidden={sidebarCollapsed || undefined}
            aria-label={L('拖动调整左右面板宽度', 'Drag to resize sidebar width')}
            aria-valuemin={LEFT_PANE_MIN}
            aria-valuemax={clampLeftPaneWidth(LEFT_PANE_MAX)}
            aria-valuenow={leftPaneWidth}
            title={L('左右拖动调整面板宽度（双击恢复默认）', 'Drag to resize (double-click to reset)')}
            tabIndex={sidebarCollapsed ? -1 : 0}
            onPointerDown={beginPaneResize}
            onPointerMove={movePaneResize}
            onPointerUp={endPaneResize}
            onPointerCancel={endPaneResize}
            onLostPointerCapture={endPaneResize}
            onDoubleClick={resetLeftPaneWidth}
            onKeyDown={keyboardPaneResize}
          />

          <main className="workbench-pane" aria-label={L('FPGA 可视化工作台', 'FPGA Visual Workbench')}>
            <header className="wb-header">
              <div className="wb-header-left">
                {sidebarCollapsed && (
                  <button
                    type="button"
                    className="icon-button wb-expand-btn"
                    title={L('展开左侧栏', 'Expand sidebar')}
                    aria-label={L('展开左侧栏', 'Expand sidebar')}
                    onClick={() => setSidebarCollapsed(false)}
                  >
                    <PanelLeftOpen size={16} />
                  </button>
                )}

                <div className="wb-tabs" role="tablist" aria-label={L('工作台视图', 'Workbench views')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wbTab === 'canvas'}
                    className={wbTab === 'canvas' ? 'active' : undefined}
                    onClick={() => handleManualTabClick('canvas')}
                  >
                    <CircuitBoard size={13.5} className="wb-tab-icon" aria-hidden="true" />
                    <span>{L('仿真画布', 'Simulation')}</span>
                    {busy && recommendedTab === 'canvas' && wbTab !== 'canvas' && (
                      <span className="tab-activity-dot" aria-label={L('后台就绪', 'Ready in background')} />
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wbTab === 'screen'}
                    className={wbTab === 'screen' ? 'active' : undefined}
                    onClick={() => handleManualTabClick('screen')}
                  >
                    <Monitor size={13.5} className="wb-tab-icon" aria-hidden="true" />
                    <span>{L('屏幕', 'Screen')}</span>
                    {((busy && recommendedTab === 'screen') || (circuitUsesScreen && compiled)) && wbTab !== 'screen' && (
                      <span className="tab-activity-dot" aria-label={L('OLED 活跃', 'OLED active')} />
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wbTab === 'blueprint'}
                    className={wbTab === 'blueprint' ? 'active' : undefined}
                    onClick={() => handleManualTabClick('blueprint')}
                  >
                    <FileText size={13.5} className="wb-tab-icon" aria-hidden="true" />
                    <span>{L('蓝图', 'Blueprint')}</span>
                    {busy && recommendedTab === 'blueprint' && wbTab !== 'blueprint' && (
                      <span className="tab-activity-dot" aria-label={L('规划中', 'Planning')} />
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wbTab === 'verilog'}
                    className={wbTab === 'verilog' ? 'active' : undefined}
                    onClick={() => handleManualTabClick('verilog')}
                  >
                    <FileCode2 size={13.5} className="wb-tab-icon" aria-hidden="true" />
                    <span>Verilog</span>
                    {busy && recommendedTab === 'verilog' && wbTab !== 'verilog' && (
                      <span className="tab-activity-dot" aria-label={L('编码与验证中', 'Coding & verifying')} />
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wbTab === 'verify'}
                    className={`wb-tab-verify${wbTab === 'verify' ? ' active' : ''}`}
                    onClick={() => handleManualTabClick('verify')}
                  >
                    <ClipboardCheck size={13.5} className="wb-tab-icon" aria-hidden="true" />
                    <span>{L('自测', 'Self-Test')}</span>
                    {selfTest && (
                      <span className={`tab-count ${selfTest.passed ? 'ok' : 'fail'}`}>
                        {selfTest.passedChecks}/{selfTest.totalChecks}
                      </span>
                    )}
                    {busy && recommendedTab === 'verify' && wbTab !== 'verify' && (
                      <span className="tab-activity-dot" aria-label={L('后台更新中', 'Updating')} />
                    )}
                  </button>
                </div>

                <div className="wb-status-pills">
                  {compiled && wbTitleVersion > 0 && (
                    <span className="version-pill live">
                      <i />
                      {running
                        ? L(`V${wbTitleVersion} 运行中`, `V${wbTitleVersion} Live`)
                        : L(`V${wbTitleVersion} 已暂停`, `V${wbTitleVersion} Paused`)}
                    </span>
                  )}
                  {busy && (
                    <span className="version-pill testing">
                      <i />
                      {L(`V${wbTitleVersion + 1} 自测中`, `V${wbTitleVersion + 1} Testing`)}
                    </span>
                  )}
                </div>
              </div>

              <div className="wb-header-right">
                <button
                  type="button"
                  className="outline-button icon-only-btn"
                  disabled={!code}
                  title={L('复制 Verilog 代码', 'Copy Verilog code')}
                  aria-label={L('复制 Verilog 代码', 'Copy Verilog code')}
                  onClick={() => void copyHeaderCode()}
                >
                  {copiedHeader ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  className="outline-button compact-btn"
                  disabled={!code}
                  title={L('导出 .v', 'Export .v')}
                  aria-label={L('导出 Verilog 文件', 'Export Verilog file')}
                  onClick={() => handleExportVerilog()}
                >
                  <Download size={14} /> {L('导出 .v', 'Export .v')}
                </button>
              </div>
            </header>

            <div key={wbTab} className="wb-tab-panel">
              {wbTab === 'canvas' && (
                <div className="wb-canvas-layout">
                  <section className="schematic-column" aria-label={L('门级原理图', 'Gate-Level Schematic')}>
                    <div className="schematic-subheader">
                      <div className="schematic-title">
                        <h2>{L('门级原理图', 'Gate-Level Schematic')}</h2>
                        {code && <span className="file-chip mono">{activeFilename}</span>}
                      </div>
                      <ClockControls
                        speed={speed}
                        running={running}
                        disabled={!compiled}
                        showFast={circuitUsesScreen}
                        onSpeed={(mode) => {
                          setSpeed(mode);
                          setRunning(true);
                        }}
                        onToggle={toggleRun}
                        onStep={stepOnce}
                      />
                    </div>
                    <GateCanvas netlist={netlist} pending={busy} statusBadge={statusBadge} />
                  </section>

                  <aside className="instruments-column" aria-label={L('实时波形与虚拟板卡', 'Live Waveforms & Virtual Board')}>
                    <Waveform title={L('实时波形', 'Live Waveform')} samples={history} autoFollow showCycleMeta={false} />

                    <section className="instrument-section">
                      <div className="section-heading">
                        <h2>{L('虚拟板卡', 'Virtual Board')}</h2>
                        {latest && (
                          <span className="instrument-meta mono">
                            {formatClockFrequency(speed)} · CLK ↑ {latest.cycle}
                          </span>
                        )}
                      </div>
                      <VirtualBoard
                        inputs={inputs}
                        outputs={latest?.outputs}
                        onInputsChange={changeInputs}
                        disabled={!compiled}
                      />
                    </section>

                    {selfTest && (
                      <details className="self-test-wave" open={!selfTest.passed}>
                        <summary>
                          <span>{L('自测波形', 'Self-Test Waveform')}</span>
                          <span className={`mono ${selfTest.passed ? '' : 'fail-text'}`}>
                            {wbTitleVersion > 0 ? `V${wbTitleVersion} · ` : ''}
                            {selfTest.passedChecks}/{selfTest.totalChecks}
                          </span>
                        </summary>
                        <Waveform
                          title={L('自测采样', 'Test Samples')}
                          samples={selfTest.waveform}
                          failureCycle={selfTest.firstUnstableCycle ?? selfTest.firstFailure?.cycle}
                          ledFocus={selfTest.firstFailure?.signal === 'led'}
                        />
                      </details>
                    )}
                  </aside>
                </div>
              )}

              {wbTab === 'screen' && (
                <ScreenView
                  screenBuffer={displayScreenBuffer ?? latest?.screenBuffer}
                  hasScreenOutput={circuitUsesScreen || Boolean(latest?.screenBuffer)}
                  compiled={compiled}
                  filename={code ? activeFilename : undefined}
                  cycle={latest?.cycle}
                  inputs={inputs}
                  outputs={latest?.outputs}
                  onInputsChange={changeInputs}
                  speed={speed}
                  running={running}
                  onSpeed={(mode) => {
                    setSpeed(mode);
                    setRunning(true);
                  }}
                  onToggle={toggleRun}
                  onStep={stepOnce}
                  keyLayout={screenKeyLayout}
                  onKeyLayoutChange={setScreenKeyLayout}
                  vsync={screenVsync}
                  onToggleVsync={handleToggleScreenVsync}
                />
              )}

              {wbTab === 'blueprint' && (
                <BlueprintView
                  blueprint={blueprint}
                  planning={planningBlueprint}
                  selfTest={selfTest}
                  onOpenVerify={() => handleManualTabClick('verify')}
                />
              )}

              {wbTab === 'verilog' && (
                <VerilogView
                  code={code}
                  filename={activeFilename}
                  canCompile={!busy}
                  highlightLine={highlightLine}
                  issues={issues}
                  streamState={codeStreamState}
                  onCodeChange={setCode}
                  onCompile={compileEditedCode}
                  onExportVerilog={() => handleExportVerilog()}
                  onExportTestbench={handleExportTestbench}
                />
              )}

              {wbTab === 'verify' && (
                <div className="wb-verify-wrap">
                  <div className="mobile-verify-back-bar">
                    <button
                      type="button"
                      className="outline-button compact-btn"
                      onClick={() => handleManualTabClick(circuitUsesScreen ? 'screen' : 'canvas')}
                    >
                      <ArrowLeft size={14} />
                      <span>{L('返回仿真视图', 'Back to Simulation')}</span>
                    </button>
                    {selfTest && (
                      <span className={`mono-meta ${selfTest.passed ? 'ok' : ''}`}>
                        {L(
                          `自测 ${selfTest.passedChecks}/${selfTest.totalChecks}`,
                          `Self-Test ${selfTest.passedChecks}/${selfTest.totalChecks}`,
                        )}
                      </span>
                    )}
                  </div>
                  <VerifyView
                    selfTest={selfTest}
                    issues={issues}
                    traces={traces}
                    ledFocus={false}
                    onJumpToLine={jumpToVerilogLine}
                  />
                </div>
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
