import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/emulator/cpu';
import { buildExecutionAnalytics } from '../src/lab/analytics';
import { createInitialPerformanceMetrics } from '../src/lab/performance';
import {
  compareCPUStates,
  createExecutionSnapshot,
  restoreExecutionSnapshot,
} from '../src/lab/snapshots';
import type { TraceEntry } from '../src/lab/types';

function traceEntry(overrides: Partial<TraceEntry> = {}): TraceEntry {
  return {
    step: 1,
    instructionAddress: 0,
    instructionText: 'NOP',
    ipBefore: 0,
    ipAfter: 1,
    changedRegisters: [],
    changedFlags: [],
    changedMemoryWords: [],
    memoryReads: [],
    memoryWrites: [],
    output: [],
    cycles: 1,
    timestampMs: 0,
    ...overrides,
  };
}

describe('execution analytics', () => {
  it('returns zeroed analytics for an empty trace', () => {
    expect(buildExecutionAnalytics([])).toEqual({
      totalSteps: 0,
      totalCycles: 0,
      averageCycles: 0,
      maxCycles: 0,
      minCycles: 0,
      instructionFrequency: [],
      timeline: [],
    });
  });

  it('aggregates instruction frequency and builds a cumulative signal timeline', () => {
    const analytics = buildExecutionAnalytics([
      traceEntry({ step: 1, instructionText: 'mov AX, 1', cycles: 2, changedRegisters: ['AX'] }),
      traceEntry({ step: 2, instructionText: 'ADD AX, 2', cycles: 4, changedRegisters: ['AX'], changedFlags: ['ZF'] }),
      traceEntry({ step: 3, instructionText: 'MOV BX, AX', cycles: 1, changedRegisters: ['BX'] }),
    ]);

    expect(analytics).toEqual({
      totalSteps: 3,
      totalCycles: 7,
      averageCycles: 7 / 3,
      maxCycles: 4,
      minCycles: 1,
      instructionFrequency: [
        { opcode: 'MOV', count: 2, cycles: 3, percentage: 66.7 },
        { opcode: 'ADD', count: 1, cycles: 4, percentage: 33.3 },
      ],
      timeline: [
        { step: 1, opcode: 'MOV', cycles: 2, cumulativeCycles: 2, changedSignals: 1 },
        { step: 2, opcode: 'ADD', cycles: 4, cumulativeCycles: 6, changedSignals: 2 },
        { step: 3, opcode: 'MOV', cycles: 1, cumulativeCycles: 7, changedSignals: 1 },
      ],
    });
  });
});

describe('execution snapshots', () => {
  it('deep-copies CPU state, memory, output, and performance metrics', () => {
    const state = createInitialState();
    state.registers.AX = 7;
    state.memory[8] = 0x34;
    const output = [{ type: 'number' as const, value: 7 }];
    const perf = { ...createInitialPerformanceMetrics(), instructionsExecuted: 1, totalCycles: 2 };
    const snapshot = createExecutionSnapshot(state, output, 3, perf, 500);

    state.registers.AX = 9;
    state.memory[8] = 0xFF;
    output[0].value = 9;
    perf.totalCycles = 8;

    expect(snapshot).toMatchObject({
      state: { registers: { AX: 7 }, halted: false, error: null },
      output: [{ type: 'number', value: 7 }],
      traceLength: 3,
      perf: { instructionsExecuted: 1, totalCycles: 2 },
      createdAtMs: 500,
    });
    expect(snapshot.state.memory[8]).toBe(0x34);
  });

  it('restores an independent snapshot and compares register, flag, and word-level memory changes', () => {
    const before = createInitialState();
    const after = createInitialState();
    after.registers.AX = 1;
    after.registers.FLAGS = 0x0041;
    after.memory[2] = 1;
    after.memory[3] = 2;
    after.memory[4] = 3;

    const comparison = compareCPUStates(before, after, 1);
    expect(comparison).toEqual({
      registerDiffs: [
        { register: 'AX', before: 0, after: 1 },
        { register: 'FLAGS', before: 0, after: 0x0041 },
      ],
      flagDiffs: [
        { flag: 'CF', before: false, after: true },
        { flag: 'ZF', before: false, after: true },
      ],
      memoryDiffCount: 2,
      memoryDiffSample: [2],
    });

    const snapshot = createExecutionSnapshot(after, [], 4, createInitialPerformanceMetrics(), 700);
    const restored = restoreExecutionSnapshot(snapshot);
    restored.state.registers.AX = 99;
    restored.state.memory[2] = 99;

    expect(snapshot.state.registers.AX).toBe(1);
    expect(snapshot.state.memory[2]).toBe(1);
    expect(restored.createdAtMs).toBe(700);
  });
});
