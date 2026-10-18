import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { runProgram } from '../src/emulator/cpu';

describe('CPU memory and stack behavior', () => {
  it('stores and reloads words through register-relative addresses in little-endian order', () => {
    const program = assemble([
      'MOV BX, 0x100',
      'MOV AX, 0xABCD',
      'MOV [BX + 1], AX',
      'MOV DX, [0x101]',
      'HLT',
    ].join('\n'));
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.DX).toBe(0xABCD);
    expect(Array.from(finalState.memory.slice(0x101, 0x103))).toEqual([0xCD, 0xAB]);
  });

  it('pushes a memory word, pops it to another effective address, and restores SP', () => {
    const program = assemble([
      'MOV BX, 0x100',
      'MOV AX, 0xABCD',
      'MOV [BX], AX',
      'PUSH [BX]',
      'MOV [BX], 0',
      'POP [BX + 2]',
      'MOV DX, [BX + 2]',
      'HLT',
    ].join('\n'));
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers).toMatchObject({ DX: 0xABCD, SP: 4094 });
    expect(Array.from(finalState.memory.slice(0x102, 0x104))).toEqual([0xCD, 0xAB]);
  });

  it('allows a word read and write at the final valid memory address', () => {
    const program = assemble('MOV AX, 0xCAFE\nMOV [4094], AX\nMOV DX, [4094]\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.DX).toBe(0xCAFE);
    expect(Array.from(finalState.memory.slice(4094, 4096))).toEqual([0xFE, 0xCA]);
  });

  it('reports an out-of-bounds word write without modifying the last memory byte', () => {
    const program = assemble('MOV AX, 0x1234\nMOV [4095], AX\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.halted).toBe(true);
    expect(finalState.error).toBe('Memory write out of bounds: 0xFFF');
    expect(finalState.registers.IP).toBe(1);
    expect(finalState.memory[4095]).toBe(0);
  });

  it('reports stack overflow without decrementing SP or advancing IP', () => {
    const program = assemble('MOV SP, 1\nMOV AX, 0x1234\nPUSH AX\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.halted).toBe(true);
    expect(finalState.error).toBe('Stack overflow');
    expect(finalState.registers).toMatchObject({ AX: 0x1234, SP: 1, IP: 2 });
  });

  it('reports stack underflow without consuming an invalid word or changing the destination', () => {
    const program = assemble('MOV SP, 4095\nMOV BX, 0xBEEF\nPOP AX\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.halted).toBe(true);
    expect(finalState.error).toBe('Stack underflow');
    expect(finalState.registers).toMatchObject({ AX: 0, BX: 0xBEEF, SP: 4095, IP: 2 });
  });
});
