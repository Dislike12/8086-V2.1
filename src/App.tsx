import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Bug, Code2, FileCode, Terminal, Cpu, 
  ChevronRight, Zap, Layers, BookOpen,
  RotateCcw, StepForward, ArrowLeft, Sparkles,
  Check, X, SlidersHorizontal, Microscope, ChartColumn, GraduationCap, Camera, Link2, FlaskConical, MonitorCog
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { CodeEditor } from '@/components/CodeEditor';
import { RegisterDisplay } from '@/components/RegisterDisplay';
import { InstructionPipeline } from '@/components/lab/InstructionPipeline';
import { PerformanceMonitor } from '@/components/lab/PerformanceMonitor';
import { TraceLog } from '@/components/lab/TraceLog';
import { DemoLibrary } from '@/components/lab/DemoLibrary';
import { TimeTravelTimeline } from '@/components/lab/TimeTravelTimeline';
import { SnapshotManager } from '@/components/lab/SnapshotManager';
import { InstructionInspector } from '@/components/lab/InstructionInspector';
import { ExecutionAnalyticsDashboard } from '@/components/lab/ExecutionAnalyticsDashboard';
import { GuidedLearningPanel } from '@/components/lab/GuidedLearningPanel';
import { WatchPanel } from '@/components/lab/WatchPanel';
import { WatchpointPanel } from '@/components/lab/WatchpointPanel';
import { BranchPredictorPanel } from '@/components/lab/BranchPredictorPanel';
import { CacheSimulatorPanel } from '@/components/lab/CacheSimulatorPanel';
import { HazardPanel } from '@/components/lab/HazardPanel';
import { SourceRuntimeMapPanel } from '@/components/lab/SourceRuntimeMapPanel';
import { ReplayPanel } from '@/components/lab/ReplayPanel';
import { ChallengePanel } from '@/components/lab/ChallengePanel';
import { TestbenchPanel } from '@/components/lab/TestbenchPanel';
import { StackFramePanel } from '@/components/lab/StackFramePanel';
import { InterruptIOPanel } from '@/components/lab/InterruptIOPanel';

import { compile, SAMPLE_PROGRAMS, CompilationResult } from '@/compiler/compiler';
import { runProgram, createInitialState, ProgramOutput } from '@/emulator/cpu';
import { assemble } from '@/emulator/assembler';
import { AssembledProgram, CPUState, Instruction } from '@/types/cpu';
import { executeStepWithDiagnostics } from '@/lab/debugger';
import { ASSEMBLY_DEMOS } from '@/lab/demos';
import { createInitialPerformanceMetrics, updatePerformanceMetrics } from '@/lab/performance';
import {
  BranchPredictorMode,
  BranchPredictorStats,
  CacheConfig,
  CacheStats,
  ExecutionAnalytics,
  GuidedLearningContent,
  HazardStats,
  InstructionInspectorData,
  MemoryWatchpoint,
  PerformanceMetrics,
  PipelineState,
  ReplaySession,
  SavedSnapshot,
  SourceMapEntry,
  SnapshotComparison,
  TraceEntry,
  WatchExpression,
  WatchValue,
} from '@/lab/types';
import { buildInstructionInspectorData } from '@/lab/instruction-inspector';
import { buildExecutionAnalytics } from '@/lab/analytics';
import { buildGuidedLearningContent } from '@/lab/guided-learning';
import { evaluateWatchExpressions } from '@/lab/watch';
import { analyzeBranchPrediction } from '@/lab/branch-predictor';
import { simulateCache } from '@/lab/cache-simulator';
import { analyzePipelineHazards } from '@/lab/hazards';
import { buildSourceMapEntries, findInstructionForSourceLine, findSourceLineForInstruction } from '@/lab/source-map';
import { buildSymbolicHints } from '@/lab/symbolic-hints';
import { CHALLENGES, getChallengeById } from '@/lab/challenges';
import { AssertionResult, runTestbenchAssertions } from '@/lab/testbench';
import { createReplaySession, parseReplaySession, serializeReplaySession } from '@/lab/replay';
import {
  compareCPUStates,
  createExecutionSnapshot,
  createSavedSnapshot,
  restoreExecutionSnapshot,
} from '@/lab/snapshots';
import { cn } from '@/utils/cn';

type ViewMode = 'home' | 'editor' | 'asm-editor' | 'debug';
type EditorTab = 'source' | 'assembly' | 'output';
type DebugOrigin = 'editor' | 'asm-editor';
type DebugPanelTab = 'observe' | 'inspector' | 'snapshots' | 'analytics' | 'learn' | 'tools';

const PIPELINE_STAGE_DELAY_MS = 120;
const MAX_DEBUG_STEPS = 10000;
const MAX_TRACE_FOR_REPLAY = 5000;
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  policy: 'direct_mapped',
  lineCount: 16,
  lineSizeBytes: 2,
};
const DEFAULT_TESTBENCH_SCRIPT = `# Example assertions
REG AX = 0
HALTED true`;
const DEFAULT_PIPELINE_STATE: PipelineState = {
  stage: 'idle',
  instructionIndex: null,
  tick: 0,
};

function normalizeSource(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

function resolveDemoIdFromSource(source: string): string | null {
  const normalized = normalizeSource(source);
  const match = ASSEMBLY_DEMOS.find((demo) => normalizeSource(demo.source) === normalized);
  return match?.id ?? null;
}

function overlapsWordRange(wordAddress: number, watchAddress: number, watchSize: number): boolean {
  const wordStart = wordAddress;
  const wordEnd = wordAddress + 2;
  const rangeStart = watchAddress;
  const rangeEnd = watchAddress + Math.max(1, watchSize);
  return wordStart < rangeEnd && wordEnd > rangeStart;
}

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [sourceCode, setSourceCode] = useState(SAMPLE_PROGRAMS.countdown);
  const [asmCode, setAsmCode] = useState('');
  const [compilationResult, setCompilationResult] = useState<CompilationResult | null>(null);
  const [debugProgram, setDebugProgram] = useState<AssembledProgram | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>('source');
  const [runOutput, setRunOutput] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [debugOrigin, setDebugOrigin] = useState<DebugOrigin>('editor');

  // Debug state
  const [debugState, setDebugState] = useState<CPUState>(createInitialState);
  const [debugOutput, setDebugOutput] = useState<ProgramOutput[]>([]);
  const [debugSnapshots, setDebugSnapshots] = useState<Array<ReturnType<typeof createExecutionSnapshot>>>([]);
  const [timelineCursor, setTimelineCursor] = useState(0);
  const [traceLog, setTraceLog] = useState<TraceEntry[]>([]);
  const [previousDebugState, setPreviousDebugState] = useState<CPUState | null>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState>(DEFAULT_PIPELINE_STATE);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>(createInitialPerformanceMetrics);
  const [changedMemoryWords, setChangedMemoryWords] = useState<number[]>([]);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [savedSnapshots, setSavedSnapshots] = useState<SavedSnapshot[]>([]);
  const [snapshotCompareAId, setSnapshotCompareAId] = useState<string | null>(null);
  const [snapshotCompareBId, setSnapshotCompareBId] = useState<string | null>(null);
  const [selectedInstructionIndex, setSelectedInstructionIndex] = useState<number | null>(null);
  const [guidedModeEnabled, setGuidedModeEnabled] = useState(true);
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);
  const [debugPanelTab, setDebugPanelTab] = useState<DebugPanelTab>('observe');
  const [debugStatus, setDebugStatus] = useState<string>('Ready');
  const [isStepping, setIsStepping] = useState(false);
  const [watchExpressions, setWatchExpressions] = useState<WatchExpression[]>([]);
  const [watchpoints, setWatchpoints] = useState<MemoryWatchpoint[]>([]);
  const [branchPredictorMode, setBranchPredictorMode] = useState<BranchPredictorMode>('two_bit');
  const [cacheConfig, setCacheConfig] = useState<CacheConfig>(DEFAULT_CACHE_CONFIG);
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [challengeResultMessage, setChallengeResultMessage] = useState<string | null>(null);
  const [testbenchScript, setTestbenchScript] = useState(DEFAULT_TESTBENCH_SCRIPT);
  const [lastReplaySession, setLastReplaySession] = useState<ReplaySession | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewMode !== 'home') {
        setViewMode('home');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode]);

  const formatOutput = (output: ProgramOutput[]): string => {
    let result = '';
    let currentLine = '';
    
    for (const item of output) {
      if (item.type === 'char') {
        if (item.value === 10) { // newline
          result += currentLine + '\n';
          currentLine = '';
        } else {
          currentLine += String.fromCharCode(item.value);
        }
      } else {
        if (currentLine) {
          result += currentLine;
          currentLine = '';
        }
        result += item.value + '\n';
      }
    }
    
    if (currentLine) {
      result += currentLine;
    }
    
    return result;
  };

  const pause = useCallback((ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  }), []);

  const animatePipeline = useCallback(async (instructionIndex: number) => {
    setPipelineState((prev) => ({ stage: 'fetch', instructionIndex, tick: prev.tick + 1 }));
    await pause(PIPELINE_STAGE_DELAY_MS);
    setPipelineState((prev) => ({ ...prev, stage: 'decode' }));
    await pause(PIPELINE_STAGE_DELAY_MS);
    setPipelineState((prev) => ({ ...prev, stage: 'execute' }));
    await pause(Math.floor(PIPELINE_STAGE_DELAY_MS * 0.7));
    setPipelineState((prev) => ({ ...prev, stage: 'idle' }));
  }, [pause]);

  const addWatchExpression = useCallback((expression: string) => {
    const cleaned = expression.trim();
    if (!cleaned) {
      return;
    }
    setWatchExpressions((current) => [
      ...current,
      { id: `watch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, expression: cleaned },
    ]);
  }, []);

  const removeWatchExpression = useCallback((id: string) => {
    setWatchExpressions((current) => current.filter((watch) => watch.id !== id));
  }, []);

  const addWatchpoint = useCallback((payload: { label: string; address: number; size: number; type: MemoryWatchpoint['type'] }) => {
    setWatchpoints((current) => [
      ...current,
      {
        id: `watchpoint-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        label: payload.label.trim() || `WP_${formatHex(payload.address)}`,
        address: payload.address & 0xFFFF,
        size: Math.max(1, payload.size),
        type: payload.type,
        enabled: true,
      },
    ]);
  }, []);

  const removeWatchpoint = useCallback((id: string) => {
    setWatchpoints((current) => current.filter((watchpoint) => watchpoint.id !== id));
  }, []);

  const toggleWatchpoint = useCallback((id: string) => {
    setWatchpoints((current) => current.map((watchpoint) => (
      watchpoint.id === id
        ? { ...watchpoint, enabled: !watchpoint.enabled }
        : watchpoint
    )));
  }, []);

  const getTriggeredWatchpoint = useCallback((
    memoryReads: number[],
    memoryWrites: number[],
    changedWords: number[]
  ): MemoryWatchpoint | null => {
    const enabledWatchpoints = watchpoints.filter((watchpoint) => watchpoint.enabled);
    for (const watchpoint of enabledWatchpoints) {
      const addressesToCheck = watchpoint.type === 'read'
        ? memoryReads
        : watchpoint.type === 'write'
          ? memoryWrites
          : changedWords;
      const hit = addressesToCheck.some((address) => overlapsWordRange(address, watchpoint.address, watchpoint.size));
      if (hit) {
        return watchpoint;
      }
    }
    return null;
  }, [watchpoints]);

  const initializeDebugSession = useCallback((program: AssembledProgram, origin: DebugOrigin, demoId: string | null = null) => {
    const initialState = createInitialState();
    const initialPerf = createInitialPerformanceMetrics();
    const initialSnapshot = createExecutionSnapshot(initialState, [], 0, initialPerf);

    setDebugProgram(program);
    setDebugOrigin(origin);
    setActiveDemoId(demoId);
    setDebugState(initialState);
    setPreviousDebugState(null);
    setDebugOutput([]);
    setTraceLog([]);
    setPipelineState({ ...DEFAULT_PIPELINE_STATE, instructionIndex: 0 });
    setPerformanceMetrics(initialPerf);
    setChangedMemoryWords([]);
    setBreakpoints(new Set());
    setSavedSnapshots([]);
    setSnapshotCompareAId(null);
    setSnapshotCompareBId(null);
    setSelectedInstructionIndex(0);
    setTimelineCursor(0);
    setDebugPanelTab('observe');
    setDebugSnapshots([initialSnapshot]);
    setWatchpoints([]);
    setChallengeResultMessage(null);
    setLastReplaySession(null);
    setDebugStatus('Ready to step through the program.');
    setViewMode('debug');
  }, []);

  const seekTimelineToIndex = useCallback((targetIndex: number) => {
    if (debugSnapshots.length === 0) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(targetIndex, debugSnapshots.length - 1));
    const restoredSnapshot = restoreExecutionSnapshot(debugSnapshots[safeIndex]);
    const previousSnapshot = safeIndex > 0
      ? restoreExecutionSnapshot(debugSnapshots[safeIndex - 1])
      : null;
    const visibleTrace = traceLog.slice(0, restoredSnapshot.traceLength);
    const lastTraceEntry = visibleTrace[visibleTrace.length - 1];

    setTimelineCursor(safeIndex);
    setDebugState(restoredSnapshot.state);
    setPreviousDebugState(previousSnapshot?.state ?? null);
    setDebugOutput(restoredSnapshot.output);
    setPerformanceMetrics(restoredSnapshot.perf);
    setChangedMemoryWords(lastTraceEntry?.changedMemoryWords ?? []);
    setPipelineState((prev) => ({
      ...prev,
      stage: 'idle',
      instructionIndex: restoredSnapshot.state.registers.IP,
      tick: prev.tick + 1,
    }));
    setSelectedInstructionIndex(restoredSnapshot.state.registers.IP);
    setDebugStatus(`Time-travel restored to step ${safeIndex}.`);
  }, [debugSnapshots, traceLog]);

  const executeCurrentInstruction = useCallback((stepLabel: 'Step Into' | 'Step Over'): boolean => {
    if (!debugProgram || debugState.halted || debugSnapshots.length === 0) {
      return false;
    }

    const safeTimelineIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const activeSnapshot = restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex]);
    const branchSnapshots = debugSnapshots.slice(0, safeTimelineIndex + 1);
    const branchTrace = traceLog.slice(0, activeSnapshot.traceLength);
    const currentState = activeSnapshot.state;
    const currentOutput = activeSnapshot.output;
    const currentPerf = activeSnapshot.perf;

    const ip = currentState.registers.IP;
    if (ip < 0 || ip >= debugProgram.instructions.length) {
      setDebugState((state) => ({ ...state, halted: true, error: 'IP out of bounds' }));
      setDebugStatus('Execution halted: IP out of bounds.');
      return false;
    }

    const instruction = debugProgram.instructions[ip];
    const diagnostics = executeStepWithDiagnostics({
      state: currentState,
      instruction,
      labels: debugProgram.labels,
      stepNumber: branchTrace.length + 1,
      stepStartedAtMs: performance.now(),
    });

    const changedSignalCount = diagnostics.changedRegisters.length
      + diagnostics.changedFlags.length
      + diagnostics.changedMemoryWords.length;

    const nextPerf = updatePerformanceMetrics(
      currentPerf,
      diagnostics.cycles,
      changedSignalCount,
      diagnostics.traceEntry.timestampMs
    );
    const nextTrace = [...branchTrace, diagnostics.traceEntry];
    const nextOutput = diagnostics.output.length > 0
      ? [...currentOutput, ...diagnostics.output]
      : [...currentOutput];
    const nextSnapshots = [
      ...branchSnapshots,
      createExecutionSnapshot(diagnostics.nextState, nextOutput, nextTrace.length, nextPerf),
    ];
    const triggeredWatchpoint = getTriggeredWatchpoint(
      diagnostics.memoryReads,
      diagnostics.memoryWrites,
      diagnostics.changedMemoryWords
    );
    const watchpointSuffix = triggeredWatchpoint
      ? ` | Watchpoint hit: ${triggeredWatchpoint.label}`
      : '';

    setPreviousDebugState(currentState);
    setDebugState(diagnostics.nextState);
    setDebugOutput(nextOutput);
    setTraceLog(nextTrace);
    setPerformanceMetrics(nextPerf);
    setChangedMemoryWords(diagnostics.changedMemoryWords);
    setDebugSnapshots(nextSnapshots);
    setTimelineCursor(nextSnapshots.length - 1);
    setSelectedInstructionIndex(diagnostics.nextState.registers.IP);
    setDebugStatus(`${stepLabel}: ${diagnostics.traceEntry.instructionText}${watchpointSuffix}`);

    return true;
  }, [
    debugProgram,
    debugState,
    getTriggeredWatchpoint,
    traceLog,
    debugSnapshots,
    timelineCursor,
  ]);

  const runDebugStep = useCallback(async (stepLabel: 'Step Into' | 'Step Over') => {
    if (isStepping || !debugProgram || debugState.halted) {
      return;
    }

    const ip = debugState.registers.IP;
    setIsStepping(true);
    try {
      setDebugStatus(`${stepLabel} running...`);
      if (ip >= 0 && ip < debugProgram.instructions.length) {
        await animatePipeline(ip);
      }
      executeCurrentInstruction(stepLabel);
    } finally {
      setIsStepping(false);
    }
  }, [animatePipeline, debugProgram, debugState.halted, debugState.registers.IP, executeCurrentInstruction, isStepping]);

  const debugStepInto = useCallback(() => {
    void runDebugStep('Step Into');
  }, [runDebugStep]);

  const debugStepOver = useCallback(() => {
    const runStepOver = async () => {
      if (isStepping || !debugProgram || debugState.halted || debugSnapshots.length === 0) {
        return;
      }

      const safeTimelineIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
      const activeSnapshot = restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex]);
      let currentState = activeSnapshot.state;
      const currentIp = currentState.registers.IP;
      const instruction = debugProgram.instructions[currentIp];

      if (!instruction || instruction.opcode.toUpperCase() !== 'CALL') {
        await runDebugStep('Step Over');
        return;
      }

      setIsStepping(true);
      try {
        setDebugStatus('Step Over running...');
        await animatePipeline(currentIp);

        const returnAddress = currentIp + 1;
        let previousState = safeTimelineIndex > 0
          ? restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex - 1]).state
          : null;
        let currentOutput = [...activeSnapshot.output];
        let currentTrace = traceLog.slice(0, activeSnapshot.traceLength);
        let currentPerf = activeSnapshot.perf;
        const currentSnapshots = debugSnapshots.slice(0, safeTimelineIndex + 1);
        let lastMemoryChanges: number[] = [];
        let steps = 0;
        let callDepth = 0;
        let watchpointStatus: string | null = null;

        while (!currentState.halted && steps < MAX_DEBUG_STEPS) {
          const ip = currentState.registers.IP;
          if (ip < 0 || ip >= debugProgram.instructions.length) {
            currentState = { ...currentState, halted: true, error: 'IP out of bounds' };
            break;
          }

          if (steps > 0 && breakpoints.has(ip)) {
            setDebugStatus(`Paused at breakpoint ${formatHex(ip)} during step-over.`);
            break;
          }

          const currentInstruction = debugProgram.instructions[ip];
          const diagnostics = executeStepWithDiagnostics({
            state: currentState,
            instruction: currentInstruction,
            labels: debugProgram.labels,
            stepNumber: currentTrace.length + 1,
            stepStartedAtMs: performance.now(),
          });
          const changedSignalCount = diagnostics.changedRegisters.length
            + diagnostics.changedFlags.length
            + diagnostics.changedMemoryWords.length;
          currentPerf = updatePerformanceMetrics(
            currentPerf,
            diagnostics.cycles,
            changedSignalCount,
            diagnostics.traceEntry.timestampMs
          );
          currentTrace.push(diagnostics.traceEntry);
          if (diagnostics.output.length > 0) {
            currentOutput = [...currentOutput, ...diagnostics.output];
          }
          previousState = currentState;
          currentState = diagnostics.nextState;
          lastMemoryChanges = diagnostics.changedMemoryWords;
          currentSnapshots.push(createExecutionSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
          steps++;

          const opcode = currentInstruction.opcode.toUpperCase();
          if (opcode === 'CALL') {
            callDepth++;
          } else if (opcode === 'RET') {
            callDepth = Math.max(0, callDepth - 1);
          }

          const triggeredWatchpoint = getTriggeredWatchpoint(
            diagnostics.memoryReads,
            diagnostics.memoryWrites,
            diagnostics.changedMemoryWords
          );
          if (triggeredWatchpoint) {
            watchpointStatus = `Paused on watchpoint ${triggeredWatchpoint.label} during step-over.`;
            break;
          }

          if (callDepth === 0 && currentState.registers.IP === returnAddress) {
            break;
          }
        }

        if (steps >= MAX_DEBUG_STEPS && !currentState.halted) {
          currentState = { ...currentState, halted: true, error: 'Maximum steps exceeded (infinite loop?)' };
        }

        const lastSnapshotState = currentSnapshots[currentSnapshots.length - 1]?.state;
        if (lastSnapshotState !== currentState) {
          currentSnapshots.push(createExecutionSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
        }

        setPreviousDebugState(previousState);
        setDebugState(currentState);
        setDebugOutput(currentOutput);
        setTraceLog(currentTrace);
        setPerformanceMetrics(currentPerf);
        setChangedMemoryWords(lastMemoryChanges);
        setDebugSnapshots(currentSnapshots);
        setTimelineCursor(currentSnapshots.length - 1);
        setSelectedInstructionIndex(currentState.registers.IP);
        setPipelineState((prev) => ({ ...prev, stage: 'idle', instructionIndex: currentState.registers.IP, tick: prev.tick + 1 }));

        if (currentState.halted) {
          setDebugStatus(currentState.error ? `Execution halted: ${currentState.error}` : 'Program halted during step-over.');
        } else if (watchpointStatus) {
          setDebugStatus(watchpointStatus);
        } else if (breakpoints.has(currentState.registers.IP)) {
          setDebugStatus(`Paused at breakpoint ${formatHex(currentState.registers.IP)} after step-over.`);
        } else if (!breakpoints.has(currentState.registers.IP)) {
          setDebugStatus(`Step Over completed ${steps} nested step(s).`);
        }
      } finally {
        setIsStepping(false);
      }
    };

    void runStepOver();
  }, [
    animatePipeline,
    breakpoints,
    debugProgram,
    debugSnapshots,
    debugState.halted,
    getTriggeredWatchpoint,
    isStepping,
    runDebugStep,
    timelineCursor,
    traceLog,
  ]);

  const debugStepBack = useCallback(() => {
    if (timelineCursor <= 0) {
      return;
    }
    seekTimelineToIndex(timelineCursor - 1);
  }, [seekTimelineToIndex, timelineCursor]);

  const debugReset = useCallback(() => {
    const initialState = createInitialState();
    const initialPerf = createInitialPerformanceMetrics();
    const initialSnapshot = createExecutionSnapshot(initialState, [], 0, initialPerf);
    setDebugState(initialState);
    setPreviousDebugState(null);
    setDebugOutput([]);
    setTraceLog([]);
    setPerformanceMetrics(initialPerf);
    setChangedMemoryWords([]);
    setPipelineState({ ...DEFAULT_PIPELINE_STATE, instructionIndex: 0 });
    setDebugSnapshots([initialSnapshot]);
    setTimelineCursor(0);
    setSelectedInstructionIndex(0);
    setSavedSnapshots([]);
    setSnapshotCompareAId(null);
    setSnapshotCompareBId(null);
    setChallengeResultMessage(null);
    setDebugStatus('CPU state reset.');
  }, []);

  const debugRunToEnd = useCallback(() => {
    if (!debugProgram || debugState.halted || isStepping || debugSnapshots.length === 0) {
      return;
    }

    const safeTimelineIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const activeSnapshot = restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex]);
    let currentState = activeSnapshot.state;
    let previousState = safeTimelineIndex > 0
      ? restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex - 1]).state
      : null;
    let currentOutput = [...activeSnapshot.output];
    let currentTrace = traceLog.slice(0, activeSnapshot.traceLength);
    let currentPerf = activeSnapshot.perf;
    const currentSnapshots = debugSnapshots.slice(0, safeTimelineIndex + 1);
    let lastMemoryChanges: number[] = [];
    let watchpointStatus: string | null = null;
    let steps = 0;

    while (!currentState.halted && steps < MAX_DEBUG_STEPS) {
      const ip = currentState.registers.IP;

      if (ip < 0 || ip >= debugProgram.instructions.length) {
        currentState = { ...currentState, halted: true, error: 'IP out of bounds' };
        break;
      }

      if (breakpoints.has(ip)) {
        if (steps === 0) {
          setDebugStatus(`Paused at breakpoint ${formatHex(ip)}.`);
        }
        break;
      }

      const instruction = debugProgram.instructions[ip];
      const diagnostics = executeStepWithDiagnostics({
        state: currentState,
        instruction,
        labels: debugProgram.labels,
        stepNumber: currentTrace.length + 1,
        stepStartedAtMs: performance.now(),
      });
      const changedSignalCount = diagnostics.changedRegisters.length
        + diagnostics.changedFlags.length
        + diagnostics.changedMemoryWords.length;

      currentPerf = updatePerformanceMetrics(
        currentPerf,
        diagnostics.cycles,
        changedSignalCount,
        diagnostics.traceEntry.timestampMs
      );
      currentTrace.push(diagnostics.traceEntry);
      if (diagnostics.output.length > 0) {
        currentOutput = [...currentOutput, ...diagnostics.output];
      }
      previousState = currentState;
      currentState = diagnostics.nextState;
      lastMemoryChanges = diagnostics.changedMemoryWords;
      currentSnapshots.push(createExecutionSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
      steps++;

      const triggeredWatchpoint = getTriggeredWatchpoint(
        diagnostics.memoryReads,
        diagnostics.memoryWrites,
        diagnostics.changedMemoryWords
      );
      if (triggeredWatchpoint) {
        watchpointStatus = `Paused on watchpoint ${triggeredWatchpoint.label} after ${steps} step(s).`;
        break;
      }

      if (breakpoints.has(currentState.registers.IP)) {
        setDebugStatus(`Paused at breakpoint ${formatHex(currentState.registers.IP)} after ${steps} step(s).`);
        break;
      }
    }

    if (steps >= MAX_DEBUG_STEPS && !currentState.halted) {
      currentState = { ...currentState, halted: true, error: 'Maximum steps exceeded (infinite loop?)' };
    }

    const lastSnapshotState = currentSnapshots[currentSnapshots.length - 1]?.state;
    if (lastSnapshotState !== currentState) {
      currentSnapshots.push(createExecutionSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
    }

    setPreviousDebugState(previousState);
    setDebugState(currentState);
    setDebugOutput(currentOutput);
    setTraceLog(currentTrace);
    setPerformanceMetrics(currentPerf);
    setChangedMemoryWords(lastMemoryChanges);
    setDebugSnapshots(currentSnapshots);
    setTimelineCursor(currentSnapshots.length - 1);
    setSelectedInstructionIndex(currentState.registers.IP);
    setPipelineState((prev) => ({ ...prev, stage: 'idle', instructionIndex: currentState.registers.IP, tick: prev.tick + 1 }));

    if (currentState.halted) {
      setDebugStatus(currentState.error ? `Execution halted: ${currentState.error}` : `Program halted after ${steps} step(s).`);
    } else if (watchpointStatus) {
      setDebugStatus(watchpointStatus);
    } else if (!breakpoints.has(currentState.registers.IP)) {
      setDebugStatus(`Run completed ${steps} step(s).`);
    }
  }, [
    breakpoints,
    debugProgram,
    debugSnapshots,
    debugState,
    getTriggeredWatchpoint,
    isStepping,
    traceLog,
    timelineCursor,
  ]);

  const toggleBreakpoint = useCallback((address: number) => {
    setBreakpoints((current) => {
      const next = new Set(current);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  }, []);

  const saveNamedSnapshot = useCallback(() => {
    if (debugSnapshots.length === 0) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const baseSnapshot = restoreExecutionSnapshot(debugSnapshots[safeIndex]);
    const label = `Step ${safeIndex} @ IP ${formatHex(baseSnapshot.state.registers.IP)}`;
    const namedSnapshot = createSavedSnapshot(label, safeIndex, baseSnapshot);

    setSavedSnapshots((current) => [namedSnapshot, ...current].slice(0, 32));
    setSnapshotCompareAId((current) => current ?? namedSnapshot.id);
    setSnapshotCompareBId((current) => {
      if (current) {
        return current;
      }
      if (snapshotCompareAId && snapshotCompareAId !== namedSnapshot.id) {
        return namedSnapshot.id;
      }
      return null;
    });
    setDebugStatus(`Saved snapshot "${namedSnapshot.label}".`);
  }, [debugSnapshots, timelineCursor, snapshotCompareAId]);

  const restoreNamedSnapshot = useCallback((snapshotId: string) => {
    const namedSnapshot = savedSnapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!namedSnapshot) {
      return;
    }

    const restored = createExecutionSnapshot(
      namedSnapshot.state,
      namedSnapshot.output,
      namedSnapshot.traceLength,
      namedSnapshot.perf
    );
    const safeIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const branchSnapshots = debugSnapshots.slice(0, safeIndex + 1);
    const previousState = branchSnapshots.length > 0
      ? restoreExecutionSnapshot(branchSnapshots[branchSnapshots.length - 1]).state
      : null;
    const nextSnapshots = [...branchSnapshots, restored];
    const nextTrace = traceLog.slice(0, Math.min(traceLog.length, namedSnapshot.traceLength));

    setDebugSnapshots(nextSnapshots);
    setTraceLog(nextTrace);
    setTimelineCursor(nextSnapshots.length - 1);
    setDebugState(restored.state);
    setPreviousDebugState(previousState);
    setDebugOutput(restored.output);
    setPerformanceMetrics(restored.perf);
    setChangedMemoryWords([]);
    setSelectedInstructionIndex(restored.state.registers.IP);
    setPipelineState((prev) => ({
      ...prev,
      stage: 'idle',
      instructionIndex: restored.state.registers.IP,
      tick: prev.tick + 1,
    }));
    setDebugStatus(`Restored snapshot "${namedSnapshot.label}".`);
  }, [debugSnapshots, savedSnapshots, timelineCursor, traceLog]);

  const visibleTrace = useMemo(() => {
    return traceLog.slice(0, Math.min(timelineCursor, traceLog.length));
  }, [timelineCursor, traceLog]);

  const executionAnalytics = useMemo<ExecutionAnalytics>(() => {
    return buildExecutionAnalytics(visibleTrace);
  }, [visibleTrace]);

  const selectedInstructionAddress = selectedInstructionIndex ?? debugState.registers.IP;
  const selectedInstruction = useMemo(() => {
    if (!debugProgram) {
      return null;
    }
    if (selectedInstructionAddress < 0 || selectedInstructionAddress >= debugProgram.instructions.length) {
      return null;
    }
    return debugProgram.instructions[selectedInstructionAddress];
  }, [debugProgram, selectedInstructionAddress]);

  const selectedInstructionLastTrace = useMemo(() => {
    for (let i = visibleTrace.length - 1; i >= 0; i--) {
      const entry = visibleTrace[i];
      if (entry.instructionAddress === selectedInstructionAddress) {
        return entry;
      }
    }
    return null;
  }, [selectedInstructionAddress, visibleTrace]);

  const inspectorData = useMemo<InstructionInspectorData | null>(() => {
    return buildInstructionInspectorData(selectedInstruction, selectedInstructionLastTrace);
  }, [selectedInstruction, selectedInstructionLastTrace]);

  const guidedLearningContent = useMemo<GuidedLearningContent>(() => {
    const baseContent = buildGuidedLearningContent(
      selectedInstruction,
      inspectorData,
      timelineCursor,
      activeDemoId
    );
    return {
      ...baseContent,
      symbolicHints: buildSymbolicHints(selectedInstruction, debugState),
    };
  }, [activeDemoId, debugState, inspectorData, selectedInstruction, timelineCursor]);

  const snapshotComparison = useMemo<SnapshotComparison | null>(() => {
    if (!snapshotCompareAId || !snapshotCompareBId || snapshotCompareAId === snapshotCompareBId) {
      return null;
    }
    const snapshotA = savedSnapshots.find((item) => item.id === snapshotCompareAId);
    const snapshotB = savedSnapshots.find((item) => item.id === snapshotCompareBId);
    if (!snapshotA || !snapshotB) {
      return null;
    }
    return compareCPUStates(snapshotA.state, snapshotB.state);
  }, [savedSnapshots, snapshotCompareAId, snapshotCompareBId]);

  const watchValues = useMemo<WatchValue[]>(() => {
    return evaluateWatchExpressions(watchExpressions, debugState, previousDebugState);
  }, [debugState, previousDebugState, watchExpressions]);

  const branchPredictorStats = useMemo<BranchPredictorStats>(() => {
    return analyzeBranchPrediction(visibleTrace, branchPredictorMode);
  }, [branchPredictorMode, visibleTrace]);

  const cacheStats = useMemo<CacheStats>(() => {
    return simulateCache(visibleTrace, cacheConfig);
  }, [cacheConfig, visibleTrace]);

  const hazardStats = useMemo<HazardStats>(() => {
    return analyzePipelineHazards(visibleTrace);
  }, [visibleTrace]);

  const sourceMapEntries = useMemo<SourceMapEntry[]>(() => {
    if (!debugProgram) {
      return [];
    }
    return buildSourceMapEntries(debugProgram);
  }, [debugProgram]);

  const debugSourceCodeForMap = useMemo(() => {
    return debugOrigin === 'editor'
      ? sourceCode
      : (asmCode || DEFAULT_ASM);
  }, [asmCode, debugOrigin, sourceCode]);

  const activeSourceLine = useMemo<number | null>(() => {
    return findSourceLineForInstruction(sourceMapEntries, selectedInstructionAddress);
  }, [selectedInstructionAddress, sourceMapEntries]);

  const runTestbench = useCallback((): AssertionResult[] => {
    return runTestbenchAssertions(testbenchScript, debugState, debugOutput);
  }, [debugOutput, debugState, testbenchScript]);

  const selectSourceLine = useCallback((line: number) => {
    const instructionAddress = findInstructionForSourceLine(sourceMapEntries, line);
    if (instructionAddress === null) {
      return;
    }
    setSelectedInstructionIndex(instructionAddress);
    setDebugPanelTab('inspector');
    setDebugStatus(`Mapped source line ${line} to instruction ${formatHex(instructionAddress)}.`);
  }, [sourceMapEntries]);

  const exportReplaySession = useCallback((): string => {
    const traceForReplay = traceLog.slice(-MAX_TRACE_FOR_REPLAY);
    const replayWindowLength = traceForReplay.length + 1;
    const snapshotsForReplay = debugSnapshots.length > replayWindowLength
      ? debugSnapshots.slice(debugSnapshots.length - replayWindowLength)
      : debugSnapshots;
    const session = createReplaySession({
      trace: traceForReplay,
      snapshots: snapshotsForReplay,
      savedSnapshots,
      breakpoints: Array.from(breakpoints).sort((a, b) => a - b),
      sourceCode,
      asmCode: asmCode || compilationResult?.assembly || '',
    });
    setLastReplaySession(session);
    setDebugStatus(`Replay exported (${traceForReplay.length} steps).`);
    return serializeReplaySession(session);
  }, [asmCode, breakpoints, compilationResult?.assembly, debugSnapshots, savedSnapshots, sourceCode, traceLog]);

  const importReplaySession = useCallback((json: string): string | null => {
    try {
      const session = parseReplaySession(json);
      let restoredProgram: AssembledProgram | null = null;
      let restoredOrigin: DebugOrigin = 'asm-editor';
      let nextCompilationResult: CompilationResult | null = null;

      if (session.asmCode.trim()) {
        const assembled = assemble(session.asmCode);
        const hardErrors = assembled.errors.filter((error) => error.type === 'error');
        if (hardErrors.length === 0) {
          restoredProgram = assembled;
        }
      }

      if (!restoredProgram && session.sourceCode.trim()) {
        const compiled = compile(session.sourceCode);
        nextCompilationResult = compiled;
        if (compiled.success && compiled.program) {
          restoredProgram = compiled.program;
          restoredOrigin = 'editor';
        } else {
          const errorMsg = compiled.errors.map((error) => `Line ${error.line}: ${error.message}`).join('; ');
          return `Cannot rebuild replay program from source. ${errorMsg}`;
        }
      }

      if (!restoredProgram) {
        return 'Replay payload does not include a runnable source/assembly program.';
      }

      const importedSnapshots = session.snapshots.length > 0
        ? session.snapshots
        : [createExecutionSnapshot(createInitialState(), [], 0, createInitialPerformanceMetrics(), session.createdAtMs)];
      const safeTimelineIndex = importedSnapshots.length - 1;
      const restoredSnapshot = restoreExecutionSnapshot(importedSnapshots[safeTimelineIndex]);
      const previousSnapshot = safeTimelineIndex > 0
        ? restoreExecutionSnapshot(importedSnapshots[safeTimelineIndex - 1])
        : null;
      const restoredTrace = session.trace.slice(0, Math.min(session.trace.length, restoredSnapshot.traceLength));
      const lastTraceEntry = restoredTrace[restoredTrace.length - 1];

      setSourceCode(session.sourceCode || sourceCode);
      setAsmCode(session.asmCode || asmCode);
      if (nextCompilationResult) {
        setCompilationResult(nextCompilationResult);
      }
      setDebugProgram(restoredProgram);
      setDebugOrigin(restoredOrigin);
      setActiveDemoId(session.asmCode ? resolveDemoIdFromSource(session.asmCode) : null);
      setTraceLog(restoredTrace);
      setDebugSnapshots(importedSnapshots);
      setSavedSnapshots(session.savedSnapshots);
      setBreakpoints(new Set(session.breakpoints));
      setTimelineCursor(safeTimelineIndex);
      setDebugState(restoredSnapshot.state);
      setPreviousDebugState(previousSnapshot?.state ?? null);
      setDebugOutput(restoredSnapshot.output);
      setPerformanceMetrics(restoredSnapshot.perf);
      setChangedMemoryWords(lastTraceEntry?.changedMemoryWords ?? []);
      setSelectedInstructionIndex(restoredSnapshot.state.registers.IP);
      setPipelineState((prev) => ({
        ...prev,
        stage: 'idle',
        instructionIndex: restoredSnapshot.state.registers.IP,
        tick: prev.tick + 1,
      }));
      setLastReplaySession(session);
      setDebugPanelTab('tools');
      setDebugStatus(`Replay imported (${session.trace.length} trace steps).`);
      setViewMode('debug');
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Unknown replay import error';
    }
  }, [asmCode, sourceCode]);

  const triggerSoftwareInterrupt = useCallback((vector: number) => {
    if (!debugProgram || debugState.halted || isStepping || debugSnapshots.length === 0) {
      return;
    }

    const safeTimelineIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const activeSnapshot = restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex]);
    const branchSnapshots = debugSnapshots.slice(0, safeTimelineIndex + 1);
    const branchTrace = traceLog.slice(0, activeSnapshot.traceLength);
    const currentState = activeSnapshot.state;
    const currentOutput = activeSnapshot.output;
    const currentPerf = activeSnapshot.perf;

    const instruction: Instruction = {
      opcode: 'INT',
      operands: [String(vector & 0xFF)],
      address: currentState.registers.IP,
      raw: `INT ${vector & 0xFF}`,
    };
    const diagnostics = executeStepWithDiagnostics({
      state: currentState,
      instruction,
      labels: debugProgram.labels,
      stepNumber: branchTrace.length + 1,
      stepStartedAtMs: performance.now(),
    });
    const changedSignalCount = diagnostics.changedRegisters.length
      + diagnostics.changedFlags.length
      + diagnostics.changedMemoryWords.length;
    const nextPerf = updatePerformanceMetrics(
      currentPerf,
      diagnostics.cycles,
      changedSignalCount,
      diagnostics.traceEntry.timestampMs
    );
    const nextTrace = [...branchTrace, diagnostics.traceEntry];
    const nextOutput = diagnostics.output.length > 0
      ? [...currentOutput, ...diagnostics.output]
      : [...currentOutput];
    const nextSnapshots = [
      ...branchSnapshots,
      createExecutionSnapshot(diagnostics.nextState, nextOutput, nextTrace.length, nextPerf),
    ];
    const triggeredWatchpoint = getTriggeredWatchpoint(
      diagnostics.memoryReads,
      diagnostics.memoryWrites,
      diagnostics.changedMemoryWords
    );
    const watchpointSuffix = triggeredWatchpoint ? ` | Watchpoint hit: ${triggeredWatchpoint.label}` : '';

    setPreviousDebugState(currentState);
    setDebugState(diagnostics.nextState);
    setDebugOutput(nextOutput);
    setTraceLog(nextTrace);
    setPerformanceMetrics(nextPerf);
    setChangedMemoryWords(diagnostics.changedMemoryWords);
    setDebugSnapshots(nextSnapshots);
    setTimelineCursor(nextSnapshots.length - 1);
    setSelectedInstructionIndex(diagnostics.nextState.registers.IP);
    setDebugStatus(`Manual INT ${vector & 0xFF} triggered${watchpointSuffix}.`);
  }, [
    debugProgram,
    debugSnapshots,
    debugState.halted,
    getTriggeredWatchpoint,
    isStepping,
    timelineCursor,
    traceLog,
  ]);

  const loadSelectedChallenge = useCallback(() => {
    if (!selectedChallengeId) {
      setChallengeResultMessage('Select a challenge first.');
      return;
    }
    const challenge = getChallengeById(selectedChallengeId);
    if (!challenge) {
      setChallengeResultMessage('Selected challenge could not be loaded.');
      return;
    }

    setAsmCode(challenge.starter);
    setActiveDemoId(null);
    const program = assemble(challenge.starter);
    const hardErrors = program.errors.filter((error) => error.type === 'error');
    if (hardErrors.length > 0) {
      setChallengeResultMessage(`Challenge starter has errors: ${hardErrors[0].message}`);
      return;
    }

    initializeDebugSession(program, 'asm-editor', null);
    setChallengeResultMessage(`Loaded challenge: ${challenge.title}`);
  }, [initializeDebugSession, selectedChallengeId]);

  const checkChallenge = useCallback(() => {
    if (!selectedChallengeId) {
      setChallengeResultMessage('Select a challenge first.');
      return;
    }
    const challenge = getChallengeById(selectedChallengeId);
    if (!challenge) {
      setChallengeResultMessage('Selected challenge could not be found.');
      return;
    }

    const candidateSource = asmCode.trim() ? asmCode : challenge.starter;
    const program = assemble(candidateSource);
    const hardErrors = program.errors.filter((error) => error.type === 'error');
    if (hardErrors.length > 0) {
      setChallengeResultMessage(`Assembly error: ${hardErrors[0].message}`);
      return;
    }

    const { finalState, output } = runProgram(program);
    const validationError = challenge.validator({ finalState, output, program });
    setChallengeResultMessage(validationError ? `Not passed: ${validationError}` : `Passed: ${challenge.title}`);
  }, [asmCode, selectedChallengeId]);

  const runAssemblySource = useCallback((source: string): string => {
    const program = assemble(source);
    const hardErrors = program.errors.filter((error) => error.type === 'error');
    if (hardErrors.length > 0) {
      return `Error:\n${hardErrors.map((error) => `Line ${error.line}: ${error.message}`).join('\n')}`;
    }

    const { finalState, output } = runProgram(program);
    let outputText = formatOutput(output);
    outputText += finalState.error
      ? `\n\nError: ${finalState.error}`
      : '\n\nProgram completed successfully';
    return outputText;
  }, []);

  const outputIsError = runOutput.includes('Error:') || runOutput.includes('Compilation failed');

  const handleCompile = useCallback(() => {
    setIsCompiling(true);
    setTimeout(() => {
      const result = compile(sourceCode);
      setCompilationResult(result);
      if (result.success && result.assembly) {
        setAsmCode(result.assembly);
      }
      setEditorTab('assembly');
      setIsCompiling(false);
    }, 300);
  }, [sourceCode]);

  const handleRun = useCallback(() => {
    const result = compile(sourceCode);
    setCompilationResult(result);
    
    if (result.success && result.program) {
      const { finalState, output } = runProgram(result.program);
      let outputStr = formatOutput(output);
      
      if (finalState.error) {
        outputStr += `\n\nError: ${finalState.error}`;
      } else {
        outputStr += '\n\nProgram completed successfully';
      }
      
      setRunOutput(outputStr);
      setEditorTab('output');
    } else {
      // Show compilation errors
      const errorStr = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
      setRunOutput(`Compilation failed:\n\n${errorStr}`);
      setEditorTab('output');
    }
  }, [sourceCode]);

  const handleDebug = useCallback(() => {
    const result = compile(sourceCode);
    setCompilationResult(result);
    
    if (result.success && result.program) {
      initializeDebugSession(result.program, 'editor', null);
    }
  }, [initializeDebugSession, sourceCode]);

  // Home View
  if (viewMode === 'home') {
    return (
      <div className="app-shell min-h-screen bg-grid relative overflow-hidden">
        <div className="noise-overlay" />
        
        {/* Background Effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#45d1a3]/20 rounded-full blur-3xl animate-pulse-slow" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#e0b56a]/20 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
        </div>

        <div className="relative z-10 container mx-auto px-6 py-12">
          {/* Header */}
          <motion.header 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between mb-16"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#45d1a3] to-[#e0b56a] flex items-center justify-center">
                <Cpu className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-white">x86 Studio</span>
            </div>
            <Badge variant="info" dot>v2.1</Badge>
          </motion.header>

          {/* Hero Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-center mb-16"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#45d1a3]/10 border border-[#45d1a3]/20 text-[#7adfb1] text-sm mb-6"
            >
              <Sparkles className="w-4 h-4" />
              <span>Powered by Virtual Intel 8086 CPU</span>
            </motion.div>
            <h1 className="text-5xl md:text-7xl font-bold mb-6">
              <span className="gradient-text">Virtual 8086</span>
              <br />
              <span className="text-white">Programming IDE</span>
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
              A complete compiler, assembler, and virtual CPU environment. 
              Write high-level code and watch it execute on a simulated Intel 8086.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button 
                size="lg" 
                onClick={() => setViewMode('editor')}
                icon={<Sparkles className="w-5 h-5" />}
              >
                Start Coding
              </Button>
              <Button 
                variant="secondary" 
                size="lg"
                onClick={() => setViewMode('asm-editor')}
                icon={<Code2 className="w-5 h-5" />}
              >
                Assembly Mode
              </Button>
            </div>
          </motion.div>

          {/* Feature Cards */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16"
          >
            <FeatureCard
              icon={<Layers className="w-6 h-6" />}
              title="Full Compiler Pipeline"
              description="Lexer, Parser, Code Generator, and Assembler working in harmony."
            />
            <FeatureCard
              icon={<Cpu className="w-6 h-6" />}
              title="Virtual 8086 CPU"
              description="Accurate registers, flags, memory addressing, and core instructions."
            />
            <FeatureCard
              icon={<Bug className="w-6 h-6" />}
              title="Step Debugger"
              description="Step through execution, inspect registers, and track program flow."
            />
          </motion.div>

          {/* Sample Programs */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Sample Programs</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Object.entries(SAMPLE_PROGRAMS).map(([name, code]) => (
                <motion.button
                  key={name}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setSourceCode(code);
                    setViewMode('editor');
                  }}
                  className="panel-glass p-4 rounded-xl border border-[#32486f]/55 hover:border-[#6edfd2]/50 transition-all text-left"
                >
                  <FileCode className="w-5 h-5 text-[#45d1a3] mb-2" />
                  <span className="text-sm font-medium text-white capitalize">{name}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // Editor View
  if (viewMode === 'editor') {
    return (
      <div className="app-shell min-h-screen flex flex-col">
        {/* Top Bar */}
        <div className="topbar-glass h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode('home')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#31486d]" />
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-[#45d1a3]" />
              <span className="font-semibold text-white">High-Level Editor</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleCompile}
              loading={isCompiling}
              icon={<Code2 className="w-4 h-4" />}
            >
              Compile
            </Button>
            <Button 
              variant="success" 
              size="sm" 
              onClick={handleRun}
              icon={<Play className="w-4 h-4" />}
            >
              Run
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleDebug}
              icon={<Bug className="w-4 h-4" />}
            >
              Debug
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Editor Panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <Tabs
              tabs={[
                { id: 'source', label: 'Source', icon: <FileCode className="w-4 h-4" /> },
                { id: 'assembly', label: 'Assembly', icon: <Code2 className="w-4 h-4" /> },
                { id: 'output', label: 'Output', icon: <Terminal className="w-4 h-4" /> },
              ]}
              activeTab={editorTab}
              onTabChange={(id) => setEditorTab(id as EditorTab)}
              className="m-2"
            />
            
            <div className="flex-1 p-2 pt-0">
              <AnimatePresence mode="wait">
                {editorTab === 'source' && (
                  <motion.div
                    key="source"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full"
                  >
                    <CodeEditor
                      value={sourceCode}
                      onChange={setSourceCode}
                      language="high-level"
                      className="h-full"
                    />
                  </motion.div>
                )}
                {editorTab === 'assembly' && (
                  <motion.div
                    key="assembly"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full"
                  >
                    <CodeEditor
                      value={compilationResult?.assembly || '; Compile your code to see generated assembly'}
                      onChange={() => {}}
                      language="assembly"
                      readOnly
                      className="h-full"
                    />
                  </motion.div>
                )}
                {editorTab === 'output' && (
                  <motion.div
                    key="output"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full panel-glass rounded-2xl border border-[#2a3d61]/60 p-4 font-mono text-sm"
                  >
                    {runOutput ? (
                      <pre className={cn('whitespace-pre-wrap', outputIsError ? 'text-[#f38b8b]' : 'text-[#5de6a0]')}>
                        {runOutput}
                      </pre>
                    ) : (
                      <span className="text-gray-500">Run your program to see output</span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Side Panel */}
          <div className="side-panel-modern w-80 p-4 overflow-y-auto">
            {/* Compilation Status */}
            {compilationResult && (
              <Card className="mb-4">
                <CardHeader 
                  title="Compilation" 
                  icon={compilationResult.success ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                />
                <CardContent>
                  <div className="space-y-2">
                    {compilationResult.stages.map((stage, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{stage.name}</span>
                        <Badge variant={stage.success ? 'success' : 'error'} size="sm">
                          {stage.success ? 'Pass' : 'Fail'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quick Reference */}
            <Card>
              <CardHeader title="Quick Reference" icon={<BookOpen className="w-4 h-4" />} />
              <CardContent>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-gray-500 block mb-1">Simple & Easy Syntax:</span>
                    <pre className="text-[#7adfb1] font-mono bg-[#0b1110] p-2 rounded">{`# No program declaration needed!
x = 10
y = x + 5

if x < y
  print x
end

while x > 0
  x = x - 1
end

print "Hello!"`}</pre>
                  </div>
                  <div>
                    <span className="text-gray-500 block mb-1">Operators:</span>
                    <code className="text-[#e0b56a]">+ - * / % {'<'} {'>'} {'<='} {'>='} == !=</code>
                  </div>
                  <div>
                    <span className="text-gray-500 block mb-1">Keywords:</span>
                    <code className="text-[#e0b56a]">if else end while for print</code>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Assembly Editor View
  if (viewMode === 'asm-editor') {
    const activeAsmCode = asmCode || DEFAULT_ASM;

    const handleAsmRun = () => {
      setActiveDemoId(resolveDemoIdFromSource(activeAsmCode));
      setRunOutput(runAssemblySource(activeAsmCode));
    };

    const handleAsmDebug = () => {
      const program = assemble(activeAsmCode);
      const hardErrors = program.errors.filter((error) => error.type === 'error');
      if (hardErrors.length > 0) {
        setRunOutput(`Error:\n${hardErrors.map((error) => `Line ${error.line}: ${error.message}`).join('\n')}`);
        return;
      }
      initializeDebugSession(program, 'asm-editor', resolveDemoIdFromSource(activeAsmCode));
    };

    const loadDemo = (source: string, demoId: string | null) => {
      setAsmCode(source);
      setActiveDemoId(demoId);
    };

    const loadAndRunDemo = (source: string, demoId: string | null) => {
      setAsmCode(source);
      setActiveDemoId(demoId);
      setRunOutput(runAssemblySource(source));
    };

    const loadAndDebugDemo = (source: string, demoId: string | null) => {
      setAsmCode(source);
      setActiveDemoId(demoId);
      const program = assemble(source);
      const hardErrors = program.errors.filter((error) => error.type === 'error');
      if (hardErrors.length > 0) {
        setRunOutput(`Error:\n${hardErrors.map((error) => `Line ${error.line}: ${error.message}`).join('\n')}`);
        return;
      }
      initializeDebugSession(program, 'asm-editor', demoId);
    };

    return (
      <div className="app-shell min-h-screen flex flex-col">
        {/* Top Bar */}
        <div className="topbar-glass h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode('home')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#31486d]" />
            <div className="flex items-center gap-2">
              <Code2 className="w-5 h-5 text-[#e0b56a]" />
              <span className="font-semibold text-white">Assembly Editor</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="success" 
              size="sm" 
              onClick={handleAsmRun}
              icon={<Play className="w-4 h-4" />}
            >
              Run
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAsmDebug}
              icon={<Bug className="w-4 h-4" />}
            >
              Debug
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-4">
            <CodeEditor
              value={asmCode || DEFAULT_ASM}
              onChange={(value) => {
                setAsmCode(value);
                setActiveDemoId(null);
              }}
              language="assembly"
              className="h-full"
            />
          </div>
          
          <div className="side-panel-modern w-80 p-4 overflow-y-auto">
            <Card className="mb-4">
              <CardHeader title="Output" icon={<Terminal className="w-4 h-4" />} />
              <CardContent>
                <pre className={cn(
                  'text-xs font-mono whitespace-pre-wrap',
                  outputIsError ? 'text-[#f38b8b]' : 'text-[#5de6a0]'
                )}>
                  {runOutput || 'Run your program to see output'}
                </pre>
              </CardContent>
            </Card>

            <Card className="mb-4">
              <CardHeader title="Demo Program Library" icon={<BookOpen className="w-4 h-4" />} />
              <CardContent>
                <DemoLibrary
                  demos={ASSEMBLY_DEMOS}
                  onLoad={(demo) => loadDemo(demo.source, demo.id)}
                  onLoadAndRun={(demo) => loadAndRunDemo(demo.source, demo.id)}
                  onLoadAndDebug={(demo) => loadAndDebugDemo(demo.source, demo.id)}
                />
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader title="Instructions" icon={<BookOpen className="w-4 h-4" />} />
              <CardContent>
                <div className="space-y-2 text-xs font-mono">
                  <div className="text-gray-500">Data Movement:</div>
                  <div className="text-[#7ab6ff]">MOV, PUSH, POP (supports [addr])</div>
                  <div className="text-gray-500 mt-2">Arithmetic:</div>
                  <div className="text-[#7ab6ff]">ADD, ADC, SUB, SBB, MUL, DIV, MOD, INC, DEC, NEG</div>
                  <div className="text-gray-500 mt-2">Logic:</div>
                  <div className="text-[#7ab6ff]">AND, OR, XOR, NOT, SHL, SAL, SHR, SAR</div>
                  <div className="text-gray-500 mt-2">Compare & Jump:</div>
                  <div className="text-[#7ab6ff]">CMP, JMP, JE/JZ, JNE/JNZ, JL/JG, JLE/JGE, JC/JNC, JS/JNS, JO/JNO</div>
                  <div className="text-gray-500 mt-2">Control:</div>
                  <div className="text-[#7ab6ff]">CALL, RET, INT, IRET, HLT, NOP</div>
                  <div className="text-gray-500 mt-2">I/O:</div>
                  <div className="text-[#7ab6ff]">OUT, OUTC, IN, OUTP</div>
                  <div className="text-gray-500 mt-2">Flags:</div>
                  <div className="text-[#7ab6ff]">CLC, STC, CMC</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Debug View
  if (viewMode === 'debug' && debugProgram) {
    const currentIp = debugState.registers.IP;
    const currentInstruction = debugProgram.instructions[currentIp];
    const currentInstructionText = currentInstruction
      ? `${currentInstruction.opcode} ${currentInstruction.operands.join(', ')}`.trim()
      : 'End of program';
    const timelineMax = Math.max(0, debugSnapshots.length - 1);
    const isRewound = timelineCursor < timelineMax;
    const traceForDisplay = visibleTrace;
    const sortedBreakpoints = Array.from(breakpoints).sort((a, b) => a - b);
    const canStep = !debugState.halted && !isStepping;
    
    return (
      <div className="app-shell min-h-screen flex flex-col">
        {/* Top Bar */}
        <div className="topbar-glass h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode(debugOrigin)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#31486d]" />
            <div className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-[#f0b45b]" />
              <span className="font-semibold text-white">Debugger</span>
            </div>
            <Badge variant={debugState.halted ? 'error' : isStepping ? 'info' : 'success'} dot>
              {debugState.halted ? 'Halted' : isStepping ? 'Stepping' : isRewound ? 'Time-Travel' : 'Ready'}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={saveNamedSnapshot}
              icon={<Camera className="w-4 h-4" />}
            >
              Snapshot
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={debugReset}
              icon={<RotateCcw className="w-4 h-4" />}
            >
              Reset
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={debugStepBack}
              disabled={timelineCursor <= 0 || isStepping}
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              Back
            </Button>
            <Button 
              variant="primary" 
              size="sm" 
              onClick={debugStepInto}
              disabled={!canStep}
              icon={<StepForward className="w-4 h-4" />}
            >
              Step Into
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={debugStepOver}
              disabled={!canStep}
              icon={<ChevronRight className="w-4 h-4" />}
            >
              Step Over
            </Button>
            <Button 
              variant="success" 
              size="sm" 
              onClick={debugRunToEnd}
              disabled={debugState.halted || isStepping}
              icon={<Play className="w-4 h-4" />}
            >
              Continue
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Instructions */}
          <div className="flex-1 p-4 overflow-hidden flex flex-col gap-4">
            {guidedModeEnabled && (
              <Card className="border-[#45d1a3]/30 bg-[#11312a]">
                <CardContent>
                  <div className="text-xs text-[#7adfb1] uppercase tracking-wider mb-1">Step Explanation Overlay</div>
                  <div className="text-sm text-white mb-1">{guidedLearningContent.title}</div>
                  <div className="text-xs text-gray-300">{guidedLearningContent.explanation}</div>
                  {guidedLearningContent.symbolicHints && guidedLearningContent.symbolicHints.length > 0 && (
                    <div className="text-[11px] text-[#e0b56a] mt-2">
                      Symbolic hint: {guidedLearningContent.symbolicHints[0]}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="flex-1 min-h-0">
              <CardHeader title="Instructions" icon={<Code2 className="w-4 h-4" />} />
              <CardContent noPadding className="overflow-auto h-full">
                <div className="font-mono text-sm">
                  {debugProgram.instructions.map((instr, i) => {
                    const isCurrent = i === debugState.registers.IP;
                    const hasBreakpoint = breakpoints.has(i);
                    const isSelected = i === selectedInstructionAddress;
                    return (
                      <motion.div
                        key={i}
                        initial={false}
                        onClick={() => setSelectedInstructionIndex(i)}
                        animate={isCurrent ? { backgroundColor: 'rgba(240, 180, 91, 0.12)' } : { backgroundColor: 'transparent' }}
                        className={cn(
                          'flex items-center px-3 py-1 border-l-2 transition-all cursor-pointer',
                          isCurrent
                            ? 'border-[#f0b45b]'
                            : hasBreakpoint
                              ? 'border-[#e05d5d]/55'
                              : isSelected
                                ? 'border-[#45d1a3]/50 bg-[#45d1a3]/5'
                              : 'border-transparent'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleBreakpoint(i)}
                          title={hasBreakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
                          className={cn(
                            'w-5 text-center text-xs mr-2 transition-colors',
                            hasBreakpoint ? 'text-[#f38b8b]' : 'text-[#33413e] hover:text-[#f38b8b]'
                          )}
                        >
                          {hasBreakpoint ? '*' : '.'}
                        </button>
                        <span className="w-8 text-gray-600 text-xs">{i.toString().padStart(3, '0')}</span>
                        {isCurrent && <ChevronRight className="w-4 h-4 text-[#f0b45b] mr-2" />}
                        <span className={cn('text-[#e0b56a] font-semibold w-12', !isCurrent && 'ml-6')}>{instr.opcode}</span>
                        <span className="text-gray-300">{instr.operands.join(', ')}</span>
                      </motion.div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="h-[38%] min-h-[220px]">
              <CardHeader title="Time Travel + Trace" icon={<SlidersHorizontal className="w-4 h-4" />} />
              <CardContent className="h-[calc(100%-56px)] space-y-3">
                <TimeTravelTimeline
                  snapshots={debugSnapshots}
                  trace={traceLog}
                  activeIndex={timelineCursor}
                  onSeek={seekTimelineToIndex}
                />
                <TraceLog entries={traceForDisplay} maxEntries={40} />
              </CardContent>
            </Card>
          </div>

          {/* Side Panel */}
          <div className="side-panel-modern w-96 p-4 overflow-y-auto space-y-4">
            <Tabs
              tabs={[
                { id: 'observe', label: 'Observe', icon: <Cpu className="w-4 h-4" /> },
                { id: 'inspector', label: 'Inspector', icon: <Microscope className="w-4 h-4" /> },
                { id: 'snapshots', label: 'Snapshots', icon: <Camera className="w-4 h-4" /> },
                { id: 'analytics', label: 'Analytics', icon: <ChartColumn className="w-4 h-4" /> },
                { id: 'learn', label: 'Learn', icon: <GraduationCap className="w-4 h-4" /> },
                { id: 'tools', label: 'Tools', icon: <MonitorCog className="w-4 h-4" /> },
              ]}
              activeTab={debugPanelTab}
              onTabChange={(tab) => setDebugPanelTab(tab as DebugPanelTab)}
            />

            {debugPanelTab === 'observe' && (
              <>
                <Card>
                  <CardHeader title="Current Instruction" icon={<Zap className="w-4 h-4" />} />
                  <CardContent>
                    {currentInstruction ? (
                      <div className="font-mono space-y-2">
                        <div>
                          <span className="text-2xl font-bold text-[#f0b45b]">{currentInstruction.opcode}</span>
                          <span className="text-lg text-gray-300 ml-3">{currentInstruction.operands.join(', ')}</span>
                        </div>
                        <p className="text-xs text-gray-500">IP: {formatHex(currentIp)}</p>
                      </div>
                    ) : (
                      <span className="text-gray-500">End of program</span>
                    )}
                    <p className="text-xs text-[#7adfb1] mt-3">{debugStatus}</p>
                    {sortedBreakpoints.length > 0 && (
                      <div className="mt-3">
                        <span className="text-xs text-gray-500 uppercase tracking-wider">Breakpoints</span>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {sortedBreakpoints.map((bp) => (
                            <span key={bp} className="rounded border border-[#e05d5d]/35 bg-[#e05d5d]/10 px-2 py-0.5 font-mono text-xs text-[#f38b8b]">
                              {formatHex(bp)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Instruction Pipeline" icon={<Layers className="w-4 h-4" />} />
                  <CardContent>
                    <InstructionPipeline pipeline={pipelineState} instructionText={currentInstructionText} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Live CPU Visualization" icon={<Cpu className="w-4 h-4" />} />
                  <CardContent>
                    <RegisterDisplay
                      registers={debugState.registers}
                      previousRegisters={previousDebugState?.registers}
                      showAllRegisters={true}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Performance Monitor" icon={<Cpu className="w-4 h-4" />} />
                  <CardContent>
                    <PerformanceMonitor metrics={performanceMetrics} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Memory" icon={<Layers className="w-4 h-4" />} />
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wider">Stack (SP)</span>
                        <div className="mt-2">
                          <MemoryView
                            memory={debugState.memory}
                            start={(Math.max(0, debugState.registers.SP - 10) & ~1)}
                            words={6}
                            highlightAddress={debugState.registers.SP}
                            changedAddresses={changedMemoryWords}
                          />
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wider">Data Segment (0100h)</span>
                        <div className="mt-2">
                          <MemoryView
                            memory={debugState.memory}
                            start={0x0100}
                            words={8}
                            changedAddresses={changedMemoryWords}
                          />
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wider">Recent Writes</span>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {changedMemoryWords.length > 0 ? (
                            changedMemoryWords.map((address) => (
                              <span key={address} className="rounded border border-[#45d1a3]/30 bg-[#45d1a3]/10 px-2 py-0.5 font-mono text-xs text-[#7adfb1]">
                                {formatHex(address)}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-gray-500">No memory updates in last step.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Program Output" icon={<Terminal className="w-4 h-4" />} />
                  <CardContent>
                    <div className="font-mono text-sm">
                      {debugOutput.length > 0 ? (
                        <pre className="text-[#5de6a0] whitespace-pre-wrap">
                          {formatOutput(debugOutput)}
                        </pre>
                      ) : (
                        <span className="text-gray-500">No output yet</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {debugPanelTab === 'inspector' && (
              <Card>
                <CardHeader title="Instruction Inspector Mode" icon={<Microscope className="w-4 h-4" />} />
                <CardContent>
                  <InstructionInspector
                    data={inspectorData}
                    instructionAddress={selectedInstructionAddress}
                  />
                </CardContent>
              </Card>
            )}

            {debugPanelTab === 'snapshots' && (
              <Card>
                <CardHeader title="CPU Snapshot System" icon={<Camera className="w-4 h-4" />} />
                <CardContent>
                  <SnapshotManager
                    snapshots={savedSnapshots}
                    compareAId={snapshotCompareAId}
                    compareBId={snapshotCompareBId}
                    comparison={snapshotComparison}
                    onSaveCurrent={saveNamedSnapshot}
                    onRestoreSnapshot={restoreNamedSnapshot}
                    onCompareAChange={setSnapshotCompareAId}
                    onCompareBChange={setSnapshotCompareBId}
                  />
                </CardContent>
              </Card>
            )}

            {debugPanelTab === 'analytics' && (
              <Card>
                <CardHeader title="Execution Analytics Dashboard" icon={<ChartColumn className="w-4 h-4" />} />
                <CardContent>
                  <ExecutionAnalyticsDashboard
                    analytics={executionAnalytics}
                    activeStep={timelineCursor}
                    onSeekStep={seekTimelineToIndex}
                  />
                </CardContent>
              </Card>
            )}

            {debugPanelTab === 'learn' && (
              <Card>
                <CardHeader title="Guided Learning Mode" icon={<GraduationCap className="w-4 h-4" />} />
                <CardContent>
                  <GuidedLearningPanel
                    enabled={guidedModeEnabled}
                    content={guidedLearningContent}
                    onToggle={setGuidedModeEnabled}
                  />
                </CardContent>
              </Card>
            )}

            {debugPanelTab === 'tools' && (
              <>
                <Card>
                  <CardHeader title="Watch Expressions" icon={<MonitorCog className="w-4 h-4" />} />
                  <CardContent>
                    <WatchPanel
                      watchValues={watchValues}
                      onAddWatch={addWatchExpression}
                      onRemoveWatch={removeWatchExpression}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Memory Watchpoints" icon={<Bug className="w-4 h-4" />} />
                  <CardContent>
                    <WatchpointPanel
                      watchpoints={watchpoints}
                      onAddWatchpoint={addWatchpoint}
                      onRemoveWatchpoint={removeWatchpoint}
                      onToggleWatchpoint={toggleWatchpoint}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Branch Predictor Lab" icon={<Zap className="w-4 h-4" />} />
                  <CardContent>
                    <BranchPredictorPanel
                      mode={branchPredictorMode}
                      stats={branchPredictorStats}
                      onModeChange={setBranchPredictorMode}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Cache Simulator" icon={<Layers className="w-4 h-4" />} />
                  <CardContent>
                    <CacheSimulatorPanel
                      config={cacheConfig}
                      stats={cacheStats}
                      onConfigChange={setCacheConfig}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Pipeline Hazards" icon={<SlidersHorizontal className="w-4 h-4" />} />
                  <CardContent>
                    <HazardPanel stats={hazardStats} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Source Runtime Map" icon={<Link2 className="w-4 h-4" />} />
                  <CardContent>
                    <SourceRuntimeMapPanel
                      sourceCode={debugSourceCodeForMap}
                      sourceMap={sourceMapEntries}
                      activeSourceLine={activeSourceLine}
                      onSelectSourceLine={selectSourceLine}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Replay Session" icon={<RotateCcw className="w-4 h-4" />} />
                  <CardContent>
                    <ReplayPanel
                      onExport={exportReplaySession}
                      onImport={importReplaySession}
                    />
                    {lastReplaySession && (
                      <div className="mt-2 text-[11px] text-gray-500">
                        Last export/import: {new Date(lastReplaySession.createdAtMs).toLocaleString()}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Challenge Mode" icon={<FlaskConical className="w-4 h-4" />} />
                  <CardContent>
                    <ChallengePanel
                      challenges={CHALLENGES}
                      selectedChallengeId={selectedChallengeId}
                      onSelectChallenge={setSelectedChallengeId}
                      onLoadChallenge={loadSelectedChallenge}
                      onCheckChallenge={checkChallenge}
                      resultMessage={challengeResultMessage}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="CPU Testbench" icon={<Check className="w-4 h-4" />} />
                  <CardContent>
                    <TestbenchPanel
                      script={testbenchScript}
                      onScriptChange={setTestbenchScript}
                      onRun={runTestbench}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Call Stack View" icon={<Terminal className="w-4 h-4" />} />
                  <CardContent>
                    <StackFramePanel
                      state={debugState}
                      programLength={debugProgram.instructions.length}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Interrupt + I/O Console" icon={<MonitorCog className="w-4 h-4" />} />
                  <CardContent>
                    <InterruptIOPanel
                      state={debugState}
                      onTriggerInterrupt={triggerSoftwareInterrupt}
                    />
                  </CardContent>
                </Card>
              </>
            )}

            {debugState.error && (
              <Card className="border-[#e05d5d]/40">
                <CardContent>
                  <div className="flex items-center gap-2 text-[#f38b8b]">
                    <X className="w-4 h-4" />
                    <span className="text-sm">{debugState.error}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Timeline Position</span>
                  <span className="font-mono text-white">{timelineCursor}/{timelineMax}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-gray-500">Named Snapshots</span>
                  <span className="font-mono text-white">{savedSnapshots.length}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function formatHex(value: number, width: number = 4) {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function MemoryView({
  memory,
  start,
  words,
  highlightAddress,
  changedAddresses = [],
}: {
  memory: Uint8Array;
  start: number;
  words: number;
  highlightAddress?: number;
  changedAddresses?: number[];
}) {
  const changedSet = new Set(changedAddresses);
  const rows = Array.from({ length: words }, (_, i) => {
    const addr = start + i * 2;
    const valid = addr >= 0 && addr + 1 < memory.length;
    const value = valid ? memory[addr] | (memory[addr + 1] << 8) : null;
    return {
      addr,
      value,
      valid,
      highlight: highlightAddress === addr,
      changed: changedSet.has(addr),
    };
  });

  return (
    <div className="grid grid-cols-2 gap-2 font-mono text-xs">
      {rows.map((row) => (
        <div
          key={row.addr}
          className={cn(
            'flex items-center justify-between rounded-md border px-2 py-1',
            row.highlight
              ? 'border-[#f0b45b]/60 bg-[#f0b45b]/10 text-[#f0b45b]'
              : row.changed
                ? 'border-[#45d1a3]/60 bg-[#45d1a3]/10 text-[#7adfb1]'
              : 'border-[#30496d]/55 bg-[rgba(12,20,33,0.82)] text-[#96abc9]'
          )}
        >
          <span>{formatHex(row.addr)}</span>
          <span className={cn(
            'text-gray-200',
            row.highlight && 'text-[#f0b45b]',
            row.changed && !row.highlight && 'text-[#7adfb1]'
          )}>
            {row.value !== null ? formatHex(row.value) : '----'}
          </span>
        </div>
      ))}
    </div>
  );
}

// Feature Card Component
function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      className="panel-glass p-6 rounded-2xl border border-[#2f476f]/60 hover:border-[#6adfd1]/45 transition-all shadow-[0_20px_45px_rgba(5,10,22,0.3)]"
    >
      <div className="w-12 h-12 rounded-xl border border-[#3d5a8b]/45 bg-gradient-to-br from-[#4ed8c9]/25 via-[#75b2ff]/15 to-[#f4b65f]/20 flex items-center justify-center text-[#6de0d3] mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-[#9db1d1] text-sm">{description}</p>
    </motion.div>
  );
}

const DEFAULT_ASM = `; 8086 Assembly Program
; Simple counter example

    MOV AX, 10    ; Initialize counter
    MOV BX, 0     ; Initialize sum

LOOP:
    ADD BX, AX    ; Add counter to sum
    DEC AX        ; Decrement counter
    CMP AX, 0     ; Check if zero
    JNE LOOP      ; Continue if not

    OUT BX        ; Output the sum
    HLT           ; Halt execution
`;

