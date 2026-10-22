import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { getFlags, runProgram } from '../src/emulator/cpu';

const boundaryCases = [
  { opcode: 'INC', initial: '0x7FFF', result: 0x8000, overflow: true, sign: true },
  { opcode: 'INC', initial: '0xFFFF', result: 0x0000, overflow: false, sign: false },
  { opcode: 'DEC', initial: '0x8000', result: 0x7FFF, overflow: true, sign: false },
  { opcode: 'DEC', initial: '0x0000', result: 0xFFFF, overflow: false, sign: true },
].flatMap((testCase) => [false, true].map((carryIn) => ({ ...testCase, carryIn })));

describe('CPU INC and DEC flags', () => {
  it.each(boundaryCases)(
    '$opcode $initial updates arithmetic flags while preserving CF=$carryIn',
    ({ opcode, initial, result, overflow, sign, carryIn }) => {
      const carryInstruction = carryIn ? 'STC' : 'CLC';
      const program = assemble(`MOV AX, ${initial}\n${carryInstruction}\n${opcode} AX\nHLT`);
      const { finalState } = runProgram(program);

      expect(program.errors).toEqual([]);
      expect(finalState.error).toBeNull();
      expect(finalState.halted).toBe(true);
      expect(finalState.registers.AX).toBe(result);
      expect(getFlags(finalState.registers.FLAGS)).toMatchObject({
        CF: carryIn,
        PF: true,
        AF: true,
        ZF: result === 0,
        SF: sign,
        OF: overflow,
      });
    }
  );
});
