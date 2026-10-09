import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/emulator/cpu';
import {
  createExecutionSnapshot,
  createSavedSnapshot,
} from '../src/lab/snapshots';
import {
  createReplaySession,
  parseReplaySession,
  serializeReplaySession,
} from '../src/lab/replay';
import { createInitialPerformanceMetrics } from '../src/lab/performance';
import type { TraceEntry } from '../src/lab/types';

function makeTraceEntry(overrides: Partial<TraceEntry> = {}): TraceEntry {
  return {
    step: 1,
    instructionAddress: 0,
    instructionText: 'MOV AX, 4660',
    ipBefore: 0,
    ipAfter: 1,
    changedRegisters: ['AX'],
    changedFlags: [],
    changedMemoryWords: [],
    memoryReads: [],
    memoryWrites: [],
    output: [],
    cycles: 2,
    timestampMs: 25,
    ...overrides,
  };
}

describe('replay sessions', () => {
  it('round-trips trace, snapshots, breakpoints, source, and typed memory', () => {
    const state = createInitialState();
    state.registers.AX = 0x1234;
    state.memory[10] = 0x78;
    state.memory[11] = 0x56;
    const output = [{ type: 'number' as const, value: 0x1234 }];
    const perf = { ...createInitialPerformanceMetrics(), instructionsExecuted: 1, totalCycles: 2 };
    const snapshot = createExecutionSnapshot(state, output, 1, perf, 100);
    const session = createReplaySession({
      trace: [makeTraceEntry()],
      snapshots: [snapshot],
      savedSnapshots: [createSavedSnapshot(' Before output ', 1, snapshot)],
      breakpoints: [2, 5],
      sourceCode: 'print 4660',
      asmCode: 'MOV AX, 4660\nOUT AX',
    });

    const restored = parseReplaySession(serializeReplaySession(session));

    expect(restored).toEqual(session);
    expect(restored.snapshots[0].state.memory).toBeInstanceOf(Uint8Array);
    expect(restored.snapshots[0].state.memory.slice(10, 12)).toEqual(new Uint8Array([0x78, 0x56]));
  });

  it('drops invalid trace/output entries and normalizes partial snapshot data', () => {
    const restored = parseReplaySession(JSON.stringify({
      trace: [null, {
        step: 1,
        changedRegisters: ['AX', 'NOT_A_REGISTER'],
        changedFlags: ['ZF', 'INVALID'],
        memoryReads: [4, 'not-a-number'],
      }],
      snapshots: [null, {
        state: {
          registers: { AX: 0x12345, IP: 'invalid' },
          memory: [1, 256, -1],
        },
        output: [
          { type: 'number', value: 70000 },
          { type: 'invalid', value: 2 },
        ],
      }],
      breakpoints: [4, 'invalid', -1],
    }));

    expect(restored.trace).toHaveLength(1);
    expect(restored.trace[0].changedRegisters).toEqual(['AX']);
    expect(restored.trace[0].changedFlags).toEqual(['ZF']);
    expect(restored.trace[0].memoryReads).toEqual([4]);
    expect(restored.snapshots).toHaveLength(1);
    expect(restored.snapshots[0].state.registers).toMatchObject({ AX: 0x2345, IP: 0 });
    expect(restored.snapshots[0].state.memory).toEqual(new Uint8Array([1, 0, 255]));
    expect(restored.snapshots[0].output).toEqual([{ type: 'number', value: 70000 & 0xFFFF }]);
    expect(restored.breakpoints).toEqual([4, 0xFFFF]);
    expect(restored.savedSnapshots).toEqual([]);
  });

  it('rejects payloads missing the required replay collections', () => {
    expect(() => parseReplaySession('{}')).toThrow('Replay missing trace/snapshots');
    expect(() => parseReplaySession('{"trace":[],"snapshots":[]}')).toThrow('Replay missing breakpoints');
  });
});
