import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { getFlags, runProgram } from '../src/emulator/cpu';

describe('CPU carry-control instructions', () => {
  it.each([
    { opcode: 'STC', setup: '', carry: true },
    { opcode: 'CLC', setup: 'STC\n', carry: false },
    { opcode: 'CMC', setup: '', carry: true },
    { opcode: 'CMC', setup: 'STC\n', carry: false },
  ])('$opcode changes carry to $carry and preserves the other flags', ({ opcode, setup, carry }) => {
    const program = assemble([
      'MOV AX, 0x7FFF',
      'ADD AX, 1',
      setup.trimEnd(),
      opcode,
      'HLT',
    ].filter(Boolean).join('\n'));
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(getFlags(finalState.registers.FLAGS)).toEqual({
      CF: carry,
      PF: true,
      AF: true,
      ZF: false,
      SF: true,
      OF: true,
    });
  });
});
