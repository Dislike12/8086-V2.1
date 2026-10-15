import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { getFlags, runProgram } from '../src/emulator/cpu';

describe('CPU control flow and stack', () => {
  it('returns from a subroutine after balanced PUSH/POP operations', () => {
    const program = assemble([
      'MOV AX, 7',
      'CALL increment',
      'MOV BX, AX',
      'HLT',
      'increment: PUSH AX',
      'ADD AX, 1',
      'POP DX',
      'RET',
    ].join('\n'));

    expect(program.errors).toEqual([]);
    const { finalState } = runProgram(program);

    expect(finalState.error).toBeNull();
    expect(finalState.halted).toBe(true);
    expect(finalState.registers).toMatchObject({ AX: 8, BX: 8, DX: 7, SP: 4094 });
  });

  it('restores the interrupted instruction pointer and flags with IRET', () => {
    const program = assemble([
      'MOV AX, 4',
      'STC',
      'INT 33',
      'MOV BX, AX',
      'HLT',
      'ISR_33: CLC',
      'INC AX',
      'IRET',
    ].join('\n'));

    expect(program.errors).toEqual([]);
    const { finalState } = runProgram(program);

    expect(finalState.error).toBeNull();
    expect(finalState.halted).toBe(true);
    expect(finalState.registers).toMatchObject({ AX: 5, BX: 5, SP: 4094 });
    expect(getFlags(finalState.registers.FLAGS).CF).toBe(true);
  });
});

describe('CPU arithmetic with carry and borrow', () => {
  it('computes ADC signed overflow from the original source and carry-in', () => {
    const program = assemble('MOV AX, 0x8000\nSTC\nADC AX, 0x7FFF\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(0);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({ CF: true, AF: true, OF: false, ZF: true });
  });

  it('computes SBB signed overflow from the original source and borrow-in', () => {
    const program = assemble('MOV AX, 0x8000\nSTC\nSBB AX, 0x7FFF\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(0);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({ CF: false, AF: true, OF: true, ZF: true });
  });

  it('keeps ADC carry and auxiliary carry when both 16-bit operands wrap', () => {
    const program = assemble('MOV AX, 0xFFFF\nSTC\nADC AX, 0xFFFF\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(0xFFFF);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({
      CF: true, PF: true, AF: true, ZF: false, SF: true, OF: false,
    });
  });

  it('keeps SBB borrow and auxiliary borrow when the source plus borrow wraps', () => {
    const program = assemble('MOV AX, 0\nSTC\nSBB AX, 0xFFFF\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(0);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({
      CF: true, PF: true, AF: true, ZF: true, SF: false, OF: false,
    });
  });
});
