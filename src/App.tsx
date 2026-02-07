import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Bug, Code2, FileCode, Terminal, Cpu, 
  ChevronRight, Zap, Layers, BookOpen,
  RotateCcw, StepForward, ArrowLeft, Sparkles,
  Check, X
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

import { compile, SAMPLE_PROGRAMS, CompilationResult } from '@/compiler/compiler';
import { runProgram, createInitialState, ProgramOutput } from '@/emulator/cpu';
import { assemble } from '@/emulator/assembler';
import { AssembledProgram, CPUState } from '@/types/cpu';
import { executeStepWithDiagnostics } from '@/lab/debugger';
import { ASSEMBLY_DEMOS } from '@/lab/demos';
import { createInitialPerformanceMetrics, updatePerformanceMetrics } from '@/lab/performance';
import { ExecutionSnapshot, PerformanceMetrics, PipelineState, TraceEntry } from '@/lab/types';
import { cn } from '@/utils/cn';

type ViewMode = 'home' | 'editor' | 'asm-editor' | 'debug';
type EditorTab = 'source' | 'assembly' | 'output';
type DebugOrigin = 'editor' | 'asm-editor';

const PIPELINE_STAGE_DELAY_MS = 120;
const MAX_DEBUG_STEPS = 10000;
const DEFAULT_PIPELINE_STATE: PipelineState = {
  stage: 'idle',
  instructionIndex: null,
  tick: 0,
};

function createSnapshot(
  state: CPUState,
  output: ProgramOutput[],
  traceLength: number,
  perf: PerformanceMetrics
): ExecutionSnapshot {
  return {
    state,
    output: [...output],
    outputAddedCount: 0,
    traceLength,
    perf,
  };
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
  const [debugSnapshots, setDebugSnapshots] = useState<ExecutionSnapshot[]>([]);
  const [traceLog, setTraceLog] = useState<TraceEntry[]>([]);
  const [previousDebugState, setPreviousDebugState] = useState<CPUState | null>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState>(DEFAULT_PIPELINE_STATE);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>(createInitialPerformanceMetrics);
  const [changedMemoryWords, setChangedMemoryWords] = useState<number[]>([]);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [debugStatus, setDebugStatus] = useState<string>('Ready');
  const [isStepping, setIsStepping] = useState(false);

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

  const initializeDebugSession = useCallback((program: AssembledProgram, origin: DebugOrigin) => {
    const initialState = createInitialState();
    const initialPerf = createInitialPerformanceMetrics();

    setDebugProgram(program);
    setDebugOrigin(origin);
    setDebugState(initialState);
    setPreviousDebugState(null);
    setDebugOutput([]);
    setTraceLog([]);
    setPipelineState({ ...DEFAULT_PIPELINE_STATE, instructionIndex: 0 });
    setPerformanceMetrics(initialPerf);
    setChangedMemoryWords([]);
    setBreakpoints(new Set());
    setDebugSnapshots([createSnapshot(initialState, [], 0, initialPerf)]);
    setDebugStatus('Ready to step through the program.');
    setViewMode('debug');
  }, []);

  const executeCurrentInstruction = useCallback((stepLabel: 'Step Into' | 'Step Over'): boolean => {
    if (!debugProgram || debugState.halted) {
      return false;
    }

    const ip = debugState.registers.IP;
    if (ip < 0 || ip >= debugProgram.instructions.length) {
      setDebugState((state) => ({ ...state, halted: true, error: 'IP out of bounds' }));
      setDebugStatus('Execution halted: IP out of bounds.');
      return false;
    }

    const instruction = debugProgram.instructions[ip];
    const diagnostics = executeStepWithDiagnostics({
      state: debugState,
      instruction,
      labels: debugProgram.labels,
      stepNumber: traceLog.length + 1,
      stepStartedAtMs: performance.now(),
    });

    const changedSignalCount = diagnostics.changedRegisters.length
      + diagnostics.changedFlags.length
      + diagnostics.changedMemoryWords.length;

    const nextPerf = updatePerformanceMetrics(
      performanceMetrics,
      diagnostics.cycles,
      changedSignalCount,
      diagnostics.traceEntry.timestampMs
    );
    const nextTrace = [...traceLog, diagnostics.traceEntry];
    const nextOutput = diagnostics.output.length > 0
      ? [...debugOutput, ...diagnostics.output]
      : [...debugOutput];
    const nextSnapshots = [
      ...debugSnapshots,
      createSnapshot(diagnostics.nextState, nextOutput, nextTrace.length, nextPerf),
    ];

    setPreviousDebugState(debugState);
    setDebugState(diagnostics.nextState);
    setDebugOutput(nextOutput);
    setTraceLog(nextTrace);
    setPerformanceMetrics(nextPerf);
    setChangedMemoryWords(diagnostics.changedMemoryWords);
    setDebugSnapshots(nextSnapshots);
    setDebugStatus(`${stepLabel}: ${diagnostics.traceEntry.instructionText}`);

    return true;
  }, [
    debugProgram,
    debugState,
    traceLog,
    performanceMetrics,
    debugOutput,
    debugSnapshots,
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
    // No CALL/RET yet, so step-over behaves like step-into for now.
    void runDebugStep('Step Over');
  }, [runDebugStep]);

  const debugStepBack = useCallback(() => {
    if (debugSnapshots.length <= 1) {
      return;
    }

    const nextSnapshots = [...debugSnapshots];
    nextSnapshots.pop();
    const snapshot = nextSnapshots[nextSnapshots.length - 1];
    const previousSnapshot = nextSnapshots[nextSnapshots.length - 2];
    const nextTrace = traceLog.slice(0, snapshot.traceLength);

    setDebugSnapshots(nextSnapshots);
    setDebugState(snapshot.state);
    setPreviousDebugState(previousSnapshot?.state ?? null);
    setDebugOutput(snapshot.output);
    setTraceLog(nextTrace);
    setPerformanceMetrics(snapshot.perf);
    setChangedMemoryWords([]);
    setPipelineState((prev) => ({ ...prev, stage: 'idle', instructionIndex: snapshot.state.registers.IP, tick: prev.tick + 1 }));
    setDebugStatus('Stepped back one state snapshot.');
  }, [debugSnapshots, traceLog]);

  const debugReset = useCallback(() => {
    const initialState = createInitialState();
    const initialPerf = createInitialPerformanceMetrics();
    setDebugState(initialState);
    setPreviousDebugState(null);
    setDebugOutput([]);
    setTraceLog([]);
    setPerformanceMetrics(initialPerf);
    setChangedMemoryWords([]);
    setPipelineState({ ...DEFAULT_PIPELINE_STATE, instructionIndex: 0 });
    setDebugSnapshots([createSnapshot(initialState, [], 0, initialPerf)]);
    setDebugStatus('CPU state reset.');
  }, []);

  const debugRunToEnd = useCallback(() => {
    if (!debugProgram || debugState.halted || isStepping) {
      return;
    }

    let currentState = debugState;
    let previousState = previousDebugState;
    let currentOutput = [...debugOutput];
    let currentTrace = [...traceLog];
    let currentPerf = performanceMetrics;
    const currentSnapshots = [...debugSnapshots];
    let lastMemoryChanges: number[] = [];
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
      currentSnapshots.push(createSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
      steps++;

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
      currentSnapshots.push(createSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
    }

    setPreviousDebugState(previousState);
    setDebugState(currentState);
    setDebugOutput(currentOutput);
    setTraceLog(currentTrace);
    setPerformanceMetrics(currentPerf);
    setChangedMemoryWords(lastMemoryChanges);
    setDebugSnapshots(currentSnapshots);
    setPipelineState((prev) => ({ ...prev, stage: 'idle', instructionIndex: currentState.registers.IP, tick: prev.tick + 1 }));

    if (currentState.halted) {
      setDebugStatus(currentState.error ? `Execution halted: ${currentState.error}` : `Program halted after ${steps} step(s).`);
    } else if (!breakpoints.has(currentState.registers.IP)) {
      setDebugStatus(`Run completed ${steps} step(s).`);
    }
  }, [
    breakpoints,
    debugOutput,
    debugProgram,
    debugSnapshots,
    debugState,
    isStepping,
    performanceMetrics,
    previousDebugState,
    traceLog,
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
      initializeDebugSession(result.program, 'editor');
    }
  }, [initializeDebugSession, sourceCode]);

  // Home View
  if (viewMode === 'home') {
    return (
      <div className="min-h-screen bg-[#0b1110] bg-grid relative overflow-hidden">
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
                  className="p-4 rounded-xl bg-[#13201e] border border-[#1f2b29] hover:border-[#45d1a3]/50 transition-all text-left"
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
      <div className="min-h-screen bg-[#0b1110] flex flex-col">
        {/* Top Bar */}
        <div className="h-14 border-b border-[#1f2b29] bg-[#0f1716] flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode('home')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#1f2b29]" />
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
                    className="h-full bg-[#0d1513] rounded-lg border border-[#1f2b29] p-4 font-mono text-sm"
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
          <div className="w-80 border-l border-[#1f2b29] bg-[#0f1716] p-4 overflow-y-auto">
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
      setRunOutput(runAssemblySource(activeAsmCode));
    };

    const handleAsmDebug = () => {
      const program = assemble(activeAsmCode);
      const hardErrors = program.errors.filter((error) => error.type === 'error');
      if (hardErrors.length > 0) {
        setRunOutput(`Error:\n${hardErrors.map((error) => `Line ${error.line}: ${error.message}`).join('\n')}`);
        return;
      }
      initializeDebugSession(program, 'asm-editor');
    };

    const loadDemo = (source: string) => {
      setAsmCode(source);
    };

    const loadAndRunDemo = (source: string) => {
      setAsmCode(source);
      setRunOutput(runAssemblySource(source));
    };

    const loadAndDebugDemo = (source: string) => {
      setAsmCode(source);
      const program = assemble(source);
      const hardErrors = program.errors.filter((error) => error.type === 'error');
      if (hardErrors.length > 0) {
        setRunOutput(`Error:\n${hardErrors.map((error) => `Line ${error.line}: ${error.message}`).join('\n')}`);
        return;
      }
      initializeDebugSession(program, 'asm-editor');
    };

    return (
      <div className="min-h-screen bg-[#0b1110] flex flex-col">
        {/* Top Bar */}
        <div className="h-14 border-b border-[#1f2b29] bg-[#0f1716] flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode('home')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#1f2b29]" />
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
              onChange={setAsmCode}
              language="assembly"
              className="h-full"
            />
          </div>
          
          <div className="w-80 border-l border-[#1f2b29] bg-[#0f1716] p-4 overflow-y-auto">
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
                  onLoad={(demo) => loadDemo(demo.source)}
                  onLoadAndRun={(demo) => loadAndRunDemo(demo.source)}
                  onLoadAndDebug={(demo) => loadAndDebugDemo(demo.source)}
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
                  <div className="text-[#7ab6ff]">HLT, NOP, OUT, OUTC, CLC, STC, CMC</div>
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
    const sortedBreakpoints = Array.from(breakpoints).sort((a, b) => a - b);
    const canStep = !debugState.halted && !isStepping;
    
    return (
      <div className="min-h-screen bg-[#0b1110] flex flex-col">
        {/* Top Bar */}
        <div className="h-14 border-b border-[#1f2b29] bg-[#0f1716] flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode(debugOrigin)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#1f2b29]" />
            <div className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-[#f0b45b]" />
              <span className="font-semibold text-white">Debugger</span>
            </div>
            <Badge variant={debugState.halted ? 'error' : isStepping ? 'info' : 'success'} dot>
              {debugState.halted ? 'Halted' : isStepping ? 'Stepping' : 'Ready'}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
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
              disabled={debugSnapshots.length <= 1 || isStepping}
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
            <Card className="flex-1 min-h-0">
              <CardHeader title="Instructions" icon={<Code2 className="w-4 h-4" />} />
              <CardContent noPadding className="overflow-auto h-full">
                <div className="font-mono text-sm">
                  {debugProgram.instructions.map((instr, i) => {
                    const isCurrent = i === debugState.registers.IP;
                    const hasBreakpoint = breakpoints.has(i);
                    return (
                      <motion.div
                        key={i}
                        initial={false}
                        animate={isCurrent ? { backgroundColor: 'rgba(240, 180, 91, 0.12)' } : { backgroundColor: 'transparent' }}
                        className={cn(
                          'flex items-center px-3 py-1 border-l-2 transition-all',
                          isCurrent
                            ? 'border-[#f0b45b]'
                            : hasBreakpoint
                              ? 'border-[#e05d5d]/55'
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
                          {hasBreakpoint ? '●' : '○'}
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
              <CardHeader title="Execution Trace" icon={<Terminal className="w-4 h-4" />} />
              <CardContent className="h-[calc(100%-56px)]">
                <TraceLog entries={traceLog} />
              </CardContent>
            </Card>
          </div>

          {/* Side Panel */}
          <div className="w-96 border-l border-[#1f2b29] bg-[#0f1716] p-4 overflow-y-auto space-y-4">
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
                  <span className="text-gray-500">Steps Executed</span>
                  <span className="font-mono text-white">{debugSnapshots.length - 1}</span>
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
              : 'border-[#1f2b29] bg-[#0f1716] text-gray-400'
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
      className="p-6 rounded-2xl bg-[#13201e] border border-[#1f2b29] hover:border-[#45d1a3]/30 transition-all"
    >
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#45d1a3]/20 to-[#e0b56a]/20 flex items-center justify-center text-[#45d1a3] mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
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

