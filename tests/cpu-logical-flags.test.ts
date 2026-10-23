import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { getFlags, runProgram } from '../src/emulator/cpu';

describe('CPU logical instruction flags', () => {
  it.each([
    { opcode: 'AND', initial: '0x8001', operand: '0x0001', result: 0x0001, sign: false, zero: false, parity: false },
    { opcode: 'OR', initial: '0x8000', operand: '0x0001', result: 0x8001, sign: true, zero: false, parity: false },
    { opcode: 'XOR', initial: '0x8001', operand: '0x8001', result: 0x0000, sign: false, zero: true, parity: true },
  ])('$opcode updates SF, ZF, and PF from the result and clears CF and OF', ({ opcode, initial, operand, result, sign, zero, parity }) => {
    const program = assemble([
      'MOV CX, 0x7FFF',
      'ADD CX, 1',
      'STC',
      `MOV AX, ${initial}`,
      `${opcode} AX, ${operand}`,
      'HLT',
    ].join('\n'));
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(result);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({
      CF: false,
      OF: false,
      SF: sign,
      ZF: zero,
      PF: parity,
    });
  });

  it.each([
    { initial: '0x0000', result: 0x0000, CF: false, PF: true, AF: false, ZF: true, SF: false, OF: false },
    { initial: '0x0001', result: 0xFFFF, CF: true, PF: true, AF: true, ZF: false, SF: true, OF: false },
    { initial: '0x8000', result: 0x8000, CF: true, PF: true, AF: false, ZF: false, SF: true, OF: true },
  ])('NEG $initial produces the expected boundary result and arithmetic flags', ({ initial, result, ...flags }) => {
    const program = assemble(`MOV AX, ${initial}\nNEG AX\nHLT`);
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(result);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject(flags);
  });

  it('NOT changes only the destination and preserves every modeled flag', () => {
    const program = assemble([
      'MOV AX, 0x7FFF',
      'ADD AX, 1',
      'STC',
      'NOT AX',
      'HLT',
    ].join('\n'));
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(0x7FFF);
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
