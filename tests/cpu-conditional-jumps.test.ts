import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { runProgram } from '../src/emulator/cpu';

const equal = 'MOV AX, 7\nCMP AX, 7';
const less = 'MOV AX, 0xFFFF\nCMP AX, 1';
const unsignedLess = 'MOV AX, 0\nCMP AX, 1';
const greater = 'MOV AX, 2\nCMP AX, 1';
// 0x8000 - 1 wraps to 0x7FFF: OF is set while SF and CF are clear.
const signedOverflow = 'MOV AX, 0x8000\nCMP AX, 1';

interface BranchCase {
  opcode: string;
  setup: string;
  taken: boolean;
}

function cases(opcodes: string[], setup: string, taken: boolean): BranchCase[] {
  return opcodes.map((opcode) => ({ opcode, setup, taken }));
}

const branchCases: BranchCase[] = [
  ...cases(['JE', 'JZ'], equal, true),
  ...cases(['JE', 'JZ'], less, false),
  ...cases(['JNE', 'JNZ'], equal, false),
  ...cases(['JNE', 'JNZ'], greater, true),

  ...cases(['JL', 'JNGE'], less, true),
  ...cases(['JL', 'JNGE'], signedOverflow, true),
  ...cases(['JG', 'JNLE'], greater, true),
  ...cases(['JG', 'JNLE'], signedOverflow, false),
  ...cases(['JLE', 'JNG'], equal, true),
  ...cases(['JLE', 'JNG'], greater, false),
  ...cases(['JLE', 'JNG'], signedOverflow, true),
  ...cases(['JGE', 'JNL'], less, false),
  ...cases(['JGE', 'JNL'], signedOverflow, false),

  ...cases(['JC', 'JB', 'JNAE'], unsignedLess, true),
  ...cases(['JC', 'JB', 'JNAE'], signedOverflow, false),
  ...cases(['JNC', 'JAE', 'JNB'], unsignedLess, false),
  ...cases(['JNC', 'JAE', 'JNB'], signedOverflow, true),

  ...cases(['JS'], less, true),
  ...cases(['JS'], greater, false),
  ...cases(['JS'], signedOverflow, false),
  ...cases(['JNS'], less, false),
  ...cases(['JNS'], greater, true),
  ...cases(['JNS'], signedOverflow, true),
  ...cases(['JO'], signedOverflow, true),
  ...cases(['JO'], less, false),
  ...cases(['JNO'], signedOverflow, false),
  ...cases(['JNO'], less, true),
];

describe('CPU conditional jumps', () => {
  it.each(branchCases)('$opcode branches as expected for its flag condition', ({ opcode, setup, taken }) => {
    const program = assemble([
      setup,
      `${opcode} target`,
      'MOV BX, 1',
      'JMP done',
      'target: MOV BX, 2',
      'done: HLT',
    ].join('\n'));
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.halted).toBe(true);
    expect(finalState.registers.BX).toBe(taken ? 2 : 1);
  });
});
