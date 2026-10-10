import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/compiler';
import { createInitialState } from '../src/emulator/cpu';
import {
  buildSourceMapEntries,
  findInstructionForSourceLine,
  findSourceLineForInstruction,
} from '../src/lab/source-map';
import { runTestbenchAssertions } from '../src/lab/testbench';

describe('source map navigation', () => {
  it('maps generated instructions back to the originating source lines', () => {
    const compilation = compile('value = 1\nprint value\nprint 2');
    expect(compilation.success).toBe(true);
    expect(compilation.program).not.toBeNull();

    const sourceMap = buildSourceMapEntries(compilation.program!);

    expect(sourceMap.map(({ sourceLine }) => sourceLine)).toEqual([1, 2, 3]);
    expect(findInstructionForSourceLine(sourceMap, 2)).toBe(sourceMap[1].instructionStart);
    expect(findSourceLineForInstruction(sourceMap, sourceMap[0].instructionEnd)).toBe(1);
    expect(findSourceLineForInstruction(sourceMap, sourceMap[1].instructionStart)).toBe(2);
    expect(findSourceLineForInstruction(sourceMap, compilation.program!.instructions.length - 1)).toBe(3);
    expect(findSourceLineForInstruction(sourceMap, compilation.program!.instructions.length)).toBeNull();
    expect(findInstructionForSourceLine(sourceMap, 99)).toBeNull();
  });

  it('returns no mappings for assembly without source labels', () => {
    const compilation = compile('value = 1');
    expect(compilation.success).toBe(true);
    const sourceMap = buildSourceMapEntries({
      ...compilation.program!,
      labels: new Map([['LOOP', 0]]),
    });

    expect(sourceMap).toEqual([]);
    expect(findSourceLineForInstruction(sourceMap, 0)).toBeNull();
    expect(findInstructionForSourceLine(sourceMap, 1)).toBeNull();
  });
});

describe('CPU testbench assertions', () => {
  it('checks registers, little-endian memory words, numeric output, and halt state', () => {
    const state = createInitialState();
    state.registers.AX = 0x1234;
    state.memory[0x10] = 0x34;
    state.memory[0x11] = 0x12;
    state.halted = true;

    const results = runTestbenchAssertions(
      '# final-state checks\n\nREG AX = 1234h\nMEM [0x10] = 0x1234\nOUT 4660\nHALTED true',
      state,
      [{ type: 'number', value: 0x1234 }]
    );

    expect(results.map(({ line, passed }) => ({ line, passed }))).toEqual([
      { line: 3, passed: true },
      { line: 4, passed: true },
      { line: 5, passed: true },
      { line: 6, passed: true },
    ]);
  });

  it('rejects malformed halt-state assertions instead of treating them as false', () => {
    const state = createInitialState();
    const validFalse = runTestbenchAssertions('HALTED false', state, []);
    const invalidResults = runTestbenchAssertions('HALTED maybe\nHALTED true extra', state, []);

    expect(validFalse[0].passed).toBe(true);
    expect(invalidResults).toMatchObject([
      {
        line: 1,
        passed: false,
        message: 'Unsupported assertion syntax',
      },
      {
        line: 2,
        passed: false,
        message: 'Unsupported assertion syntax',
      },
    ]);
  });
});
