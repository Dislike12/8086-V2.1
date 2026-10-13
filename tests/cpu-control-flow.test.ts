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
