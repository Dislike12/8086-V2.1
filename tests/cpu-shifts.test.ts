import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { getFlags, runProgram } from '../src/emulator/cpu';

describe('CPU shift instructions', () => {
  it.each([
    { value: '0x4000', result: 0x8000, carry: false, overflow: true },
    { value: '0x8001', result: 0x0002, carry: true, overflow: true },
  ])('sets SHL result, carry, and one-bit overflow for $value', ({ value, result, carry, overflow }) => {
    const program = assemble(`MOV AX, ${value}\nSHL AX, 1\nHLT`);
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(result);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({ CF: carry, OF: overflow });
  });

  it.each([
    { opcode: 'SHR', result: 0x4000, overflow: true },
    { opcode: 'SAR', result: 0xC000, overflow: false },
  ])('$opcode shifts a negative word and reports its one-bit flags', ({ opcode, result, overflow }) => {
    const program = assemble(`MOV AX, 0x8001\n${opcode} AX, 1\nHLT`);
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(result);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({ CF: true, OF: overflow });
  });

  it.each([
    { label: 'immediate zero', count: '0' },
    { label: 'register count masked to zero', count: 'CX', setup: 'MOV CX, 32' },
  ])('preserves the destination and every flag when the effective count is zero ($label)', ({ count, setup = '' }) => {
    const program = assemble([
      'MOV AX, 0x7FFF',
      'ADD AX, 1',
      'STC',
      ...(setup ? [setup] : []),
      `SHL AX, ${count}`,
      'HLT',
    ].join('\n'));
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(0x8000);
    expect(getFlags(finalState.registers.FLAGS)).toEqual({
      CF: true,
      PF: true,
      AF: true,
      ZF: false,
      SF: true,
      OF: true,
    });
  });
});
