import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/compiler';
import { assemble } from '../src/emulator/assembler';
import { getFlags, runProgram } from '../src/emulator/cpu';

describe('assembler', () => {
  it('resolves labels, keeps instruction addresses, and ignores inline comments', () => {
    const program = assemble([
      'start: MOV AX, 10 ; initialize',
      'ADD AX, 2',
      'JMP done',
      'MOV AX, 99',
      'done: HLT',
    ].join('\n'));

    expect(program.errors).toEqual([]);
    expect(program.labels.get('START')).toBe(0);
    expect(program.labels.get('DONE')).toBe(4);
    expect(program.instructions.map(({ opcode }) => opcode)).toEqual([
      'MOV', 'ADD', 'JMP', 'MOV', 'HLT',
    ]);
  });

  it('reports duplicate labels with a source line', () => {
    const program = assemble('again: NOP\nagain: NOP');

    expect(program.errors).toContainEqual({
      line: 2,
      message: 'Duplicate label: AGAIN',
      type: 'error',
    });
  });
});

describe('virtual CPU', () => {
  it('wraps 16-bit addition and sets carry and zero flags', () => {
    const program = assemble('MOV AX, 65535\nADD AX, 1\nHLT');
    const { finalState } = runProgram(program);

    expect(program.errors).toEqual([]);
    expect(finalState.error).toBeNull();
    expect(finalState.registers.AX).toBe(0);
    expect(getFlags(finalState.registers.FLAGS)).toMatchObject({ CF: true, ZF: true });
  });

  it('captures numeric output from OUT instructions', () => {
    const program = assemble('MOV AX, 42\nOUT AX\nHLT');
    const { output, finalState } = runProgram(program);

    expect(finalState.error).toBeNull();
    expect(output).toEqual([{ type: 'number', value: 42 }]);
  });

  it('halts safely on division by zero and returns a useful error', () => {
    const program = assemble('MOV AX, 1\nDIV 0\nHLT');
    const { finalState } = runProgram(program);

    expect(finalState.halted).toBe(true);
    expect(finalState.error).toBe('Division by zero');
  });
});

describe('compiler pipeline', () => {
  it('compiles a small source program and runs it in the virtual CPU', () => {
    const result = compile('value = 20\nprint value');

    expect(result.success).toBe(true);
    expect(result.program).not.toBeNull();
    const execution = runProgram(result.program!);
    expect(execution.finalState.error).toBeNull();
    expect(execution.output).toEqual([{ type: 'number', value: 20 }]);
  });

  it('returns a lexical error instead of producing a runnable program', () => {
    const result = compile('value = @');

    expect(result.success).toBe(false);
    expect(result.program).toBeNull();
    expect(result.errors.some(({ type }) => type === 'error')).toBe(true);
  });
});
