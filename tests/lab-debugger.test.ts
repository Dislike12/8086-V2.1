import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/emulator/cpu';
import { executeStepWithDiagnostics } from '../src/lab/debugger';
import { evaluateWatchExpressions } from '../src/lab/watch';
import type { Instruction } from '../src/types/cpu';

function instruction(opcode: string, operands: string[], address = 0): Instruction {
  return {
    opcode,
    operands,
    address,
    raw: [opcode, ...operands].join(' '),
  };
}

describe('watch expressions', () => {
  it('evaluates registers, case-insensitive flags, immediates, and register-relative memory', () => {
    const current = createInitialState();
    current.registers.AX = 0x1234;
    current.registers.BX = 0x10;
    current.registers.FLAGS = 0x0040;
    current.memory[0x12] = 0xCD;
    current.memory[0x13] = 0xAB;

    const previous = createInitialState();
    previous.registers.AX = 0x1200;
    previous.registers.BX = 0x10;
    previous.memory[0x12] = 0x00;
    previous.memory[0x13] = 0x00;

    const values = evaluateWatchExpressions([
      { id: 'register', expression: 'ax' },
      { id: 'flag', expression: 'zf' },
      { id: 'immediate', expression: '0x2a' },
      { id: 'memory', expression: '[ BX + 2 ]' },
    ], current, previous);

    expect(values).toMatchObject([
      { id: 'register', ok: true, value: 0x1234, hexValue: '1234', changed: true },
      { id: 'flag', ok: true, value: 1, hexValue: '0001', changed: true },
      { id: 'immediate', ok: true, value: 42, hexValue: '002A', changed: false },
      { id: 'memory', ok: true, value: 0xABCD, hexValue: 'ABCD', changed: true },
    ]);
  });

  it('rejects inherited object properties and reports out-of-bounds memory safely', () => {
    const state = createInitialState();
    const values = evaluateWatchExpressions([
      { id: 'prototype', expression: 'toString' },
      { id: 'memory', expression: '[0xFFF]' },
    ], state, null);

    expect(values).toMatchObject([
      { id: 'prototype', ok: false, value: null, hexValue: '----', changed: false, error: 'Unsupported watch expression' },
      { id: 'memory', ok: false, value: null, hexValue: '----', changed: false, error: 'Memory out of bounds at FFF' },
    ]);
  });
});

describe('debugger step diagnostics', () => {
  it('reports memory writes and reads, state changes, cycle cost, and OUT output', () => {
    const initial = createInitialState();
    initial.registers.AX = 0x1234;

    const write = executeStepWithDiagnostics({
      state: initial,
      instruction: instruction('MOV', ['[0x10]', 'AX']),
      labels: new Map(),
      stepNumber: 1,
      stepStartedAtMs: 100,
    });

    expect(write.nextState.memory.slice(0x10, 0x12)).toEqual(new Uint8Array([0x34, 0x12]));
    expect(write.changedMemoryWords).toEqual([0x10]);
    expect(write.memoryReads).toEqual([]);
    expect(write.memoryWrites).toEqual([0x10]);
    expect(write.traceEntry).toMatchObject({
      step: 1,
      instructionAddress: 0,
      instructionText: 'MOV [0x10], AX',
      ipBefore: 0,
      ipAfter: 1,
      cycles: 2,
      timestampMs: 100,
    });

    const read = executeStepWithDiagnostics({
      state: write.nextState,
      instruction: instruction('MOV', ['BX', '[0x10]'], 1),
      labels: new Map(),
      stepNumber: 2,
      stepStartedAtMs: 125,
    });
    expect(read.nextState.registers.BX).toBe(0x1234);
    expect(read.memoryReads).toEqual([0x10]);
    expect(read.memoryWrites).toEqual([]);

    const output = executeStepWithDiagnostics({
      state: read.nextState,
      instruction: instruction('OUT', ['BX'], 2),
      labels: new Map(),
      stepNumber: 3,
      stepStartedAtMs: 150,
    });
    expect(output.output).toEqual([{ type: 'number', value: 0x1234 }]);
    expect(output.traceEntry.output).toEqual(output.output);
    expect(output.nextState.registers.IP).toBe(3);
  });
});
