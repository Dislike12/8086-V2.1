import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { getFlags, runProgram } from '../src/emulator/cpu';

describe('CPU unsigned multiply and divide', () => {
  it('clears carry and overflow when MUL fits in AX', () => {
    const program = assemble('MOV AX, 0x1234\nSTC\nMUL 2\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers).toMatchObject({ AX: 0x2468, DX: 0 });
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({ CF: false, OF: false });
  });

  it('stores a wide MUL result in DX:AX and sets carry and overflow', () => {
    const program = assemble('MOV AX, 0xFFFF\nMUL 2\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers).toMatchObject({ AX: 0xFFFE, DX: 1 });
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({ CF: true, OF: true });
  });

  it('divides an unsigned DX:AX dividend above the signed 32-bit boundary', () => {
    const program = assemble('MOV DX, 0x8000\nMOV AX, 0\nDIV 0x8001\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers).toMatchObject({ AX: 0xFFFE, DX: 2 });
  });

  it('accepts the largest quotient representable in AX', () => {
    const program = assemble('MOV DX, 0xFFFE\nMOV AX, 0xFFFF\nDIV 0xFFFF\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers).toMatchObject({ AX: 0xFFFF, DX: 0xFFFE });
  });

  it('halts on quotient overflow without partially updating DX:AX', () => {
    const program = assemble('MOV DX, 1\nMOV AX, 0\nDIV 1\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.halted).toBe(true);
    expect(finalState.error).toBe('Division overflow');
    expect(finalState.registers).toMatchObject({ AX: 0, DX: 1, IP: 2 });
  });
});
