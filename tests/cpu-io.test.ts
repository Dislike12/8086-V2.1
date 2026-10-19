import { describe, expect, it } from 'vitest';
import { assemble } from '../src/emulator/assembler';
import { runProgram } from '../src/emulator/cpu';

const FIRST_IO_PORT_ADDRESS = 0x0300;
const LAST_IO_PORT_ADDRESS = FIRST_IO_PORT_ADDRESS + 127 * 2;

describe('CPU port I/O', () => {
  it('round-trips words through the first and last supported ports', () => {
    const program = assemble([
      'MOV AX, 0xBEEF',
      'OUTP 0, AX',
      'MOV BX, 0x1234',
      'OUTP 127, BX',
      'MOV AX, 0',
      'MOV BX, 0',
      'IN AX, 0',
      'IN BX, 127',
      'HLT',
    ].join('\n'));
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers).toMatchObject({ AX: 0xBEEF, BX: 0x1234 });
    expect(Array.from(finalState.memory.slice(FIRST_IO_PORT_ADDRESS, FIRST_IO_PORT_ADDRESS + 2)))
      .toEqual([0xEF, 0xBE]);
    expect(Array.from(finalState.memory.slice(LAST_IO_PORT_ADDRESS, LAST_IO_PORT_ADDRESS + 2)))
      .toEqual([0x34, 0x12]);
  });

  it.each([128, 256])('rejects OUTP port %i without writing to an I/O port', (port) => {
    const program = assemble(`MOV AX, 0xCAFE\nOUTP ${port}, AX\nHLT`);
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.halted).toBe(true);
    expect(finalState.error).toBe(`Invalid I/O port: ${port}`);
    expect(finalState.registers).toMatchObject({ AX: 0xCAFE, IP: 1 });
    expect(Array.from(finalState.memory.slice(FIRST_IO_PORT_ADDRESS, FIRST_IO_PORT_ADDRESS + 2)))
      .toEqual([0, 0]);
  });

  it('rejects IN from an unsupported port without changing its destination', () => {
    const program = assemble('MOV AX, 0xBEEF\nIN AX, 128\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.halted).toBe(true);
    expect(finalState.error).toBe('Invalid I/O port: 128');
    expect(finalState.registers).toMatchObject({ AX: 0xBEEF, IP: 1 });
  });
});
