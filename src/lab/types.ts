import { ProgramOutput } from '@/emulator/cpu';
import { CPUState, Instruction, Registers } from '@/types/cpu';

export type PipelineStage = 'idle' | 'fetch' | 'decode' | 'execute';

export interface PipelineState {
  stage: PipelineStage;
  instructionIndex: number | null;
  tick: number;
}

export interface PerformanceMetrics {
  instructionsExecuted: number;
  totalCycles: number;
  elapsedMs: number;
  simulatedLoad: number;
  startedAtMs: number | null;
  lastStepAtMs: number | null;
}

export interface TraceEntry {
  step: number;
  instructionAddress: number;
  instructionText: string;
  ipBefore: number;
  ipAfter: number;
  changedRegisters: (keyof Registers)[];
  changedFlags: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'>;
  changedMemoryWords: number[];
  output: ProgramOutput[];
  cycles: number;
  timestampMs: number;
}

export interface StepDiagnostics {
  nextState: CPUState;
  output: ProgramOutput[];
  changedRegisters: (keyof Registers)[];
  changedFlags: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'>;
  changedMemoryWords: number[];
  cycles: number;
  traceEntry: TraceEntry;
}

export interface DemoProgram {
  id: string;
  title: string;
  description: string;
  source: string;
}

export interface ExecutionSnapshot {
  state: CPUState;
  output: ProgramOutput[];
  traceLength: number;
  perf: PerformanceMetrics;
  createdAtMs: number;
}

export interface SavedSnapshot {
  id: string;
  label: string;
  createdAtMs: number;
  step: number;
  state: CPUState;
  output: ProgramOutput[];
  traceLength: number;
  perf: PerformanceMetrics;
}

export interface SnapshotComparison {
  registerDiffs: Array<{
    register: keyof Registers;
    before: number;
    after: number;
  }>;
  flagDiffs: Array<{
    flag: 'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF';
    before: boolean;
    after: boolean;
  }>;
  memoryDiffCount: number;
  memoryDiffSample: number[];
}

export interface InstructionInspectorData {
  opcode: string;
  operands: string[];
  category: string;
  summary: string;
  educationalNote: string;
  registerReads: string[];
  registerWrites: string[];
  flagBehavior: string;
  virtualEncodingHex: string;
  virtualEncodingBinary: string;
  lastObservedEffects: {
    changedRegisters: (keyof Registers)[];
    changedFlags: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'>;
    changedMemoryWords: number[];
  } | null;
}

export interface ExecutionAnalytics {
  totalSteps: number;
  totalCycles: number;
  averageCycles: number;
  maxCycles: number;
  minCycles: number;
  instructionFrequency: Array<{
    opcode: string;
    count: number;
    cycles: number;
    percentage: number;
  }>;
  timeline: Array<{
    step: number;
    opcode: string;
    cycles: number;
    cumulativeCycles: number;
    changedSignals: number;
  }>;
}

export interface GuidedLearningContent {
  title: string;
  explanation: string;
  hints: string[];
  tutorialCheckpoint?: string;
}

export interface ExecuteStepParams {
  state: CPUState;
  instruction: Instruction;
  labels: Map<string, number>;
  stepNumber: number;
  stepStartedAtMs: number;
}
