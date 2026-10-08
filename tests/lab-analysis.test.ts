import { describe, expect, it } from 'vitest';
import { analyzeBranchPrediction } from '../src/lab/branch-predictor';
import { simulateCache } from '../src/lab/cache-simulator';
import { analyzePipelineHazards } from '../src/lab/hazards';
import type { CacheConfig, TraceEntry } from '../src/lab/types';

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

describe('cache simulator', () => {
  it('counts read and write hits while treating addresses in one line as the same block', () => {
    const stats = simulateCache([
      traceEntry({ memoryReads: [0, 1], memoryWrites: [0] }),
    ], { policy: 'direct_mapped', lineCount: 2, lineSizeBytes: 2 });

    expect(stats).toEqual({
      accesses: 3,
      hits: 2,
      misses: 1,
      hitRate: 66.7,
      missesByType: { read: 1, write: 0 },
    });
  });

  it('evicts the least-recently-used line in a two-way set', () => {
    const config: CacheConfig = {
      policy: 'set_associative_2way',
      lineCount: 2,
      lineSizeBytes: 1,
    };
    const stats = simulateCache([
      traceEntry({ memoryReads: [0, 2, 0, 4, 0] }),
    ], config);

    expect(stats).toMatchObject({ accesses: 5, hits: 2, misses: 3, hitRate: 40 });
  });
});

describe('branch predictor', () => {
  it('updates a two-bit saturating predictor and reports per-opcode accuracy', () => {
    const stats = analyzeBranchPrediction([
      traceEntry({ instructionText: 'JNZ LOOP', instructionAddress: 4, ipBefore: 4, ipAfter: 5 }),
      traceEntry({ instructionText: 'JNZ LOOP', instructionAddress: 4, ipBefore: 4, ipAfter: 9 }),
      traceEntry({ instructionText: 'JNZ LOOP', instructionAddress: 4, ipBefore: 4, ipAfter: 9 }),
      traceEntry({ instructionText: 'JNZ LOOP', instructionAddress: 4, ipBefore: 4, ipAfter: 9 }),
      traceEntry({ instructionText: 'JMP END', instructionAddress: 8, ipBefore: 8, ipAfter: 12 }),
    ], 'two_bit');

    expect(stats).toEqual({
      mode: 'two_bit',
      evaluatedBranches: 4,
      correctPredictions: 2,
      incorrectPredictions: 2,
      accuracy: 50,
      byOpcode: [{ opcode: 'JNZ', total: 4, correct: 2, accuracy: 50 }],
    });
  });
});

describe('pipeline hazard analysis', () => {
  it('counts an adjacent data dependency, taken branch, and long-latency operation', () => {
    const stats = analyzePipelineHazards([
      traceEntry({ instructionText: 'MOV AX, 1', changedRegisters: ['AX'] }),
      traceEntry({ instructionText: 'ADD BX, AX', cycles: 10, changedRegisters: ['BX'] }),
      traceEntry({ instructionText: 'JNZ LOOP', ipBefore: 2, ipAfter: 0, changedRegisters: ['IP'] }),
    ]);

    expect(stats).toEqual({
      dataHazards: 1,
      controlHazards: 1,
      structuralHazards: 1,
      simulatedStalls: 3,
    });
  });
});
