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
  outputAddedCount: number;
  traceLength: number;
  perf: PerformanceMetrics;
}

export interface ExecuteStepParams {
  state: CPUState;
  instruction: Instruction;
  labels: Map<string, number>;
  stepNumber: number;
  stepStartedAtMs: number;
}
