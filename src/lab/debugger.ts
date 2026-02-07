import { executeInstruction, getFlags, parseRegister, ProgramOutput } from '@/emulator/cpu';
import { CPUState, Instruction, Registers } from '@/types/cpu';
import { estimateInstructionCycles } from '@/lab/performance';
import { ExecuteStepParams, StepDiagnostics } from '@/lab/types';

const FLAG_NAMES: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'> = ['CF', 'PF', 'AF', 'ZF', 'SF', 'OF'];
const REGISTER_NAMES: (keyof Registers)[] = ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'SP', 'BP', 'IP', 'FLAGS'];
const MAX_MEMORY_WORD_CHANGES = 24;

function captureInstructionOutput(state: CPUState, instruction: Instruction): ProgramOutput[] {
  const opcode = instruction.opcode.toUpperCase();
  if (opcode !== 'OUT' && opcode !== 'OUTC') {
    return [];
  }

  const target = instruction.operands[0] ?? '';
  const register = parseRegister(target);
  if (!register) {
    return [];
  }

  if (opcode === 'OUT') {
    return [{ type: 'number', value: state.registers[register] }];
  }

  return [{ type: 'char', value: state.registers[register] & 0xff }];
}

function diffRegisters(previous: Registers, next: Registers): (keyof Registers)[] {
  return REGISTER_NAMES.filter((registerName) => previous[registerName] !== next[registerName]);
}

function diffFlags(previousFlagsValue: number, nextFlagsValue: number): Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'> {
  const previousFlags = getFlags(previousFlagsValue);
  const nextFlags = getFlags(nextFlagsValue);
  return FLAG_NAMES.filter((flagName) => previousFlags[flagName] !== nextFlags[flagName]);
}

function diffMemoryWords(previousMemory: Uint8Array, nextMemory: Uint8Array): number[] {
  const changedWords: number[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < previousMemory.length; i++) {
    if (previousMemory[i] === nextMemory[i]) {
      continue;
    }
    const wordAddress = i & ~1;
    if (seen.has(wordAddress)) {
      continue;
    }
    seen.add(wordAddress);
    changedWords.push(wordAddress);

    if (changedWords.length >= MAX_MEMORY_WORD_CHANGES) {
      break;
    }
  }

  return changedWords.sort((a, b) => a - b);
}

function formatInstruction(instruction: Instruction): string {
  const operands = instruction.operands.join(', ');
  return operands ? `${instruction.opcode} ${operands}` : instruction.opcode;
}

export function executeStepWithDiagnostics({
  state,
  instruction,
  labels,
  stepNumber,
  stepStartedAtMs,
}: ExecuteStepParams): StepDiagnostics {
  const output = captureInstructionOutput(state, instruction);
  const nextState = executeInstruction(state, instruction, labels);
  const changedRegisters = diffRegisters(state.registers, nextState.registers);
  const changedFlags = diffFlags(state.registers.FLAGS, nextState.registers.FLAGS);
  const changedMemoryWords = diffMemoryWords(state.memory, nextState.memory);
  const cycles = estimateInstructionCycles(instruction);

  return {
    nextState,
    output,
    changedRegisters,
    changedFlags,
    changedMemoryWords,
    cycles,
    traceEntry: {
      step: stepNumber,
      instructionAddress: state.registers.IP,
      instructionText: formatInstruction(instruction),
      ipBefore: state.registers.IP,
      ipAfter: nextState.registers.IP,
      changedRegisters,
      changedFlags,
      changedMemoryWords,
      output,
      cycles,
      timestampMs: stepStartedAtMs,
    },
  };
}
