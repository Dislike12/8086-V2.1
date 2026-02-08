// Virtual 8086 CPU Emulator - Complete Implementation
import { CPUState, Registers, Flags, Instruction, AssembledProgram } from '../types/cpu';

const MEMORY_SIZE = 4096;
const STACK_START = 4094; // Top of stack
const IO_PORT_BASE = 0x0300;
const IO_PORT_COUNT = 128;

export function createInitialState(): CPUState {
  return {
    registers: {
      AX: 0,
      BX: 0,
      CX: 0,
      DX: 0,
      SI: 0,
      DI: 0,
      SP: STACK_START,
      BP: 0,
      IP: 0,
      FLAGS: 0,
    },
    memory: new Uint8Array(MEMORY_SIZE),
    halted: false,
    error: null,
  };
}

// Flag bit positions (Intel 8086 style)
const FLAG_CF = 0x0001;  // Carry Flag
const FLAG_PF = 0x0004;  // Parity Flag
const FLAG_AF = 0x0010;  // Auxiliary Carry Flag
const FLAG_ZF = 0x0040;  // Zero Flag
const FLAG_SF = 0x0080;  // Sign Flag
const FLAG_OF = 0x0800;  // Overflow Flag

const WORD_MASK = 0xFFFF;

function mask16(value: number): number {
  return value & WORD_MASK;
}

function hasEvenParity(byteValue: number): boolean {
  let parity = byteValue & 0xFF;
  parity ^= parity >> 4;
  parity ^= parity >> 2;
  parity ^= parity >> 1;
  return (parity & 1) === 0;
}

function baseResultFlags(result16: number): number {
  let flags = 0;
  const res = result16 & WORD_MASK;

  if (res === 0) {
    flags |= FLAG_ZF;
  }
  if ((res & 0x8000) !== 0) {
    flags |= FLAG_SF;
  }
  if (hasEvenParity(res & 0xFF)) {
    flags |= FLAG_PF;
  }

  return flags;
}

function setFlagsAdd(a: number, b: number, result: number): number {
  const res16 = mask16(result);
  let flags = baseResultFlags(res16);

  if (result > WORD_MASK) {
    flags |= FLAG_CF;
  }
  if (((a ^ b ^ res16) & 0x10) !== 0) {
    flags |= FLAG_AF;
  }

  const signA = (a & 0x8000) !== 0;
  const signB = (b & 0x8000) !== 0;
  const signR = (res16 & 0x8000) !== 0;
  if (signA === signB && signR !== signA) {
    flags |= FLAG_OF;
  }

  return flags;
}

function setFlagsSub(a: number, b: number, result: number): number {
  const res16 = mask16(result);
  let flags = baseResultFlags(res16);

  if ((a & WORD_MASK) < (b & WORD_MASK)) {
    flags |= FLAG_CF;
  }
  if (((a ^ b ^ res16) & 0x10) !== 0) {
    flags |= FLAG_AF;
  }

  const signA = (a & 0x8000) !== 0;
  const signB = (b & 0x8000) !== 0;
  const signR = (res16 & 0x8000) !== 0;
  if (signA !== signB && signR !== signA) {
    flags |= FLAG_OF;
  }

  return flags;
}

function setFlagsLogic(result16: number): number {
  return baseResultFlags(result16);
}

function setFlagsShift(result16: number, carry: boolean, overflow: boolean | null, previousFlags: number): number {
  let flags = baseResultFlags(result16);

  if (carry) {
    flags |= FLAG_CF;
  }
  if (overflow === true) {
    flags |= FLAG_OF;
  } else if (overflow === null && (previousFlags & FLAG_OF)) {
    flags |= FLAG_OF;
  }

  return flags;
}

export function getFlags(flags: number): Flags {
  return {
    CF: (flags & FLAG_CF) !== 0,
    PF: (flags & FLAG_PF) !== 0,
    AF: (flags & FLAG_AF) !== 0,
    ZF: (flags & FLAG_ZF) !== 0,
    SF: (flags & FLAG_SF) !== 0,
    OF: (flags & FLAG_OF) !== 0,
  };
}

export function setFlags(a: number, b: number, result: number, isSubtraction: boolean = false): number {
  return isSubtraction ? setFlagsSub(a, b, result) : setFlagsAdd(a, b, result);
}

export function parseRegister(operand: string): keyof Registers | null {
  const upper = operand.toUpperCase().trim();
  const validRegs = ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'SP', 'BP'];
  if (validRegs.includes(upper)) {
    return upper as keyof Registers;
  }
  return null;
}

export function parseImmediate(operand: string): number | null {
  const trimmed = operand.trim();
  if (!trimmed) return null;

  const sign = trimmed.startsWith('-') ? -1 : 1;
  const normalized = trimmed.replace(/^[+-]/, '');

  // Decimal number
  if (/^\d+$/.test(normalized)) {
    return sign * parseInt(normalized, 10);
  }

  // Hex with 0x prefix
  if (/^0x[0-9A-Fa-f]+$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(2), 16);
  }

  // Hex with h suffix
  if (/^[0-9A-Fa-f]+h$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(0, -1), 16);
  }

  // Binary with 0b prefix
  if (/^0b[01]+$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(2), 2);
  }

  return null;
}

function parseMemoryOperand(operand: string, registers: Registers): number | null {
  const trimmed = operand.trim();
  const match = trimmed.match(/^\[(.+)\]$/);
  if (!match) return null;

  const inner = match[1].replace(/\s+/g, '');
  if (!inner) return null;

  // Register or register +/- offset
  const regMatch = inner.match(/^([A-Za-z]{2})([+-].+)?$/);
  if (regMatch) {
    const reg = parseRegister(regMatch[1]);
    if (!reg) return null;
    let offset = 0;
    if (regMatch[2]) {
      const parsed = parseImmediate(regMatch[2]);
      if (parsed === null) return null;
      offset = parsed;
    }
    return mask16(registers[reg] + offset);
  }

  // Direct address
  const imm = parseImmediate(inner);
  if (imm === null) return null;
  return mask16(imm);
}

function readWord(state: CPUState, address: number): number {
  if (address < 0 || address + 1 >= state.memory.length) {
    throw new Error(`Memory read out of bounds: 0x${address.toString(16).toUpperCase()}`);
  }
  return state.memory[address] | (state.memory[address + 1] << 8);
}

function writeWord(state: CPUState, address: number, value: number): void {
  if (address < 0 || address + 1 >= state.memory.length) {
    throw new Error(`Memory write out of bounds: 0x${address.toString(16).toUpperCase()}`);
  }
  const val = mask16(value);
  state.memory[address] = val & 0xFF;
  state.memory[address + 1] = (val >> 8) & 0xFF;
}

function resolveJumpTarget(
  targetOperand: string,
  labels: Map<string, number>,
  _state: CPUState
): number {
  const normalized = targetOperand.trim().toUpperCase();
  const labelAddress = labels.get(normalized);
  if (labelAddress !== undefined) {
    return labelAddress;
  }

  const immediate = parseImmediate(targetOperand);
  if (immediate !== null) {
    return immediate;
  }

  throw new Error(`Unknown jump/call target: ${targetOperand}`);
}

function resolveInterruptTarget(
  vectorOperand: string,
  labels: Map<string, number>,
  state: CPUState
): number {
  const immediate = parseImmediate(vectorOperand);
  if (immediate === null) {
    return resolveJumpTarget(vectorOperand, labels, state);
  }

  const vector = immediate & 0xFF;
  const vectorLabelCandidates = [
    `ISR_${vector}`,
    `INT_${vector}`,
    `ISR${vector}`,
    `INT${vector}`,
  ];
  for (const candidate of vectorLabelCandidates) {
    const target = labels.get(candidate);
    if (target !== undefined) {
      return target;
    }
  }

  const tableAddress = vector * 2;
  const mappedAddress = readWord(state, tableAddress);
  return mappedAddress;
}

function getPortAddress(portValue: number): number {
  const port = portValue & 0xFF;
  if (port >= IO_PORT_COUNT) {
    throw new Error(`Invalid I/O port: ${port}`);
  }
  return IO_PORT_BASE + port * 2;
}

function resolveValue(state: CPUState, operand: string): number {
  const reg = parseRegister(operand);
  if (reg) {
    return state.registers[reg];
  }
  const memAddr = parseMemoryOperand(operand, state.registers);
  if (memAddr !== null) {
    return readWord(state, memAddr);
  }
  const imm = parseImmediate(operand);
  if (imm !== null) {
    return imm;
  }
  throw new Error(`Invalid operand: ${operand}`);
}

export function executeInstruction(
  state: CPUState,
  instruction: Instruction,
  labels: Map<string, number>
): CPUState {
  // Deep copy state
  const newState: CPUState = {
    registers: { ...state.registers },
    memory: new Uint8Array(state.memory),
    halted: state.halted,
    error: state.error,
  };
  
  const { opcode, operands } = instruction;
  
  try {
    switch (opcode.toUpperCase()) {
      case 'MOV': {
        const destReg = parseRegister(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        const srcReg = parseRegister(operands[1]);
        const srcMem = parseMemoryOperand(operands[1], newState.registers);
        const srcImm = srcReg || srcMem !== null ? null : parseImmediate(operands[1]);

        if (!destReg && destMem === null) {
          throw new Error(`Invalid destination: ${operands[0]}`);
        }
        if (!srcReg && srcMem === null && srcImm === null) {
          throw new Error(`Invalid source: ${operands[1]}`);
        }
        if (destMem !== null && srcMem !== null) {
          throw new Error('Memory to memory MOV is not supported');
        }

        let value: number;
        if (srcReg) {
          value = newState.registers[srcReg];
        } else if (srcMem !== null) {
          value = readWord(newState, srcMem);
        } else {
          value = srcImm as number;
        }

        if (destReg) {
          newState.registers[destReg] = mask16(value);
        } else if (destMem !== null) {
          writeWord(newState, destMem, value);
        }
        newState.registers.IP++;
        break;
      }
      
      case 'ADD': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const a = newState.registers[dest];
        const b = value & WORD_MASK;
        const result = a + b;
        newState.registers[dest] = mask16(result);
        newState.registers.FLAGS = setFlagsAdd(a, b, result);
        newState.registers.IP++;
        break;
      }

      case 'ADC': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);

        const value = resolveValue(newState, operands[1]);
        const carry = (newState.registers.FLAGS & FLAG_CF) ? 1 : 0;
        const a = newState.registers[dest];
        const b = (value & WORD_MASK) + carry;
        const result = a + b;
        newState.registers[dest] = mask16(result);
        newState.registers.FLAGS = setFlagsAdd(a, b, result);
        newState.registers.IP++;
        break;
      }
      
      case 'SUB': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const a = newState.registers[dest];
        const b = value & WORD_MASK;
        const result = a - b;
        newState.registers[dest] = mask16(result);
        newState.registers.FLAGS = setFlagsSub(a, b, result);
        newState.registers.IP++;
        break;
      }

      case 'SBB': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);

        const value = resolveValue(newState, operands[1]);
        const borrow = (newState.registers.FLAGS & FLAG_CF) ? 1 : 0;
        const a = newState.registers[dest];
        const b = (value & WORD_MASK) + borrow;
        const result = a - b;
        newState.registers[dest] = mask16(result);
        newState.registers.FLAGS = setFlagsSub(a, b, result);
        newState.registers.IP++;
        break;
      }
      
      case 'MUL': {
        // MUL src - Unsigned multiply AX * src, result in DX:AX
        const value = resolveValue(newState, operands[0]) & WORD_MASK;
        const result = (newState.registers.AX & WORD_MASK) * value;
        newState.registers.AX = result & WORD_MASK;
        newState.registers.DX = (result >>> 16) & WORD_MASK;
        // Only CF and OF are defined for MUL
        const upper = newState.registers.DX;
        let flags = newState.registers.FLAGS & ~(FLAG_CF | FLAG_OF);
        if (upper !== 0) {
          flags |= FLAG_CF | FLAG_OF;
        }
        newState.registers.FLAGS = flags;
        newState.registers.IP++;
        break;
      }
      
      case 'DIV': {
        // DIV src - Unsigned divide DX:AX by src, quotient in AX, remainder in DX
        const divisor = resolveValue(newState, operands[0]) & WORD_MASK;
        if (divisor === 0) {
          throw new Error('Division by zero');
        }

        const dividend = (((newState.registers.DX & WORD_MASK) << 16) | (newState.registers.AX & WORD_MASK)) >>> 0;
        const quotient = Math.floor(dividend / divisor);
        const remainder = dividend % divisor;
        if (quotient > WORD_MASK) {
          throw new Error('Division overflow');
        }
        newState.registers.AX = quotient & WORD_MASK;
        newState.registers.DX = remainder & WORD_MASK;
        newState.registers.IP++;
        break;
      }
      
      case 'MOD': {
        // MOD src - Custom instruction for modulo
        const divisor = resolveValue(newState, operands[0]) & WORD_MASK;
        if (divisor === 0) {
          throw new Error('Division by zero');
        }

        const dividend = newState.registers.AX & WORD_MASK;
        newState.registers.AX = dividend % divisor;
        newState.registers.IP++;
        break;
      }
      
      case 'NEG': {
        // NEG dest - Two's complement negation
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const val = newState.registers[dest];
        const result = -val;
        newState.registers[dest] = mask16(result);
        newState.registers.FLAGS = setFlagsSub(0, val, result);
        newState.registers.IP++;
        break;
      }
      
      case 'AND': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const result = (newState.registers[dest] & value) & WORD_MASK;
        newState.registers[dest] = result;
        newState.registers.FLAGS = setFlagsLogic(result);
        newState.registers.IP++;
        break;
      }
      
      case 'OR': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const result = (newState.registers[dest] | value) & WORD_MASK;
        newState.registers[dest] = result;
        newState.registers.FLAGS = setFlagsLogic(result);
        newState.registers.IP++;
        break;
      }
      
      case 'XOR': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const result = (newState.registers[dest] ^ value) & WORD_MASK;
        newState.registers[dest] = result;
        newState.registers.FLAGS = setFlagsLogic(result);
        newState.registers.IP++;
        break;
      }
      
      case 'NOT': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        newState.registers[dest] = mask16(~newState.registers[dest]);
        newState.registers.IP++;
        break;
      }
      
      case 'SHL':
      case 'SAL': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        let count = 1;
        if (operands.length > 1) {
          const srcReg = parseRegister(operands[1]);
          if (srcReg) {
            count = newState.registers[srcReg] & 0x1F;
          } else {
            const imm = parseImmediate(operands[1]);
            if (imm !== null) count = imm & 0x1F;
          }
        }

        count &= 0x1F;
        if (count === 0) {
          newState.registers.IP++;
          break;
        }

        const value = newState.registers[dest] & WORD_MASK;
        const shift = Math.min(count, 16);
        const carry = ((value >> (16 - shift)) & 1) !== 0;
        const result = mask16(value << shift);
        const overflow = count === 1 ? (((result ^ value) & 0x8000) !== 0) : null;
        newState.registers[dest] = result;
        newState.registers.FLAGS = setFlagsShift(result, carry, overflow, newState.registers.FLAGS);
        newState.registers.IP++;
        break;
      }
      
      case 'SHR': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        let count = 1;
        if (operands.length > 1) {
          const srcReg = parseRegister(operands[1]);
          if (srcReg) {
            count = newState.registers[srcReg] & 0x1F;
          } else {
            const imm = parseImmediate(operands[1]);
            if (imm !== null) count = imm & 0x1F;
          }
        }

        count &= 0x1F;
        if (count === 0) {
          newState.registers.IP++;
          break;
        }

        const value = newState.registers[dest] & WORD_MASK;
        const shift = Math.min(count, 16);
        const carry = ((value >> (shift - 1)) & 1) !== 0;
        const result = (value >>> shift) & WORD_MASK;
        const overflow = count === 1 ? ((value & 0x8000) !== 0) : null;
        newState.registers[dest] = result;
        newState.registers.FLAGS = setFlagsShift(result, carry, overflow, newState.registers.FLAGS);
        newState.registers.IP++;
        break;
      }

      case 'SAR': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);

        let count = 1;
        if (operands.length > 1) {
          const srcReg = parseRegister(operands[1]);
          if (srcReg) {
            count = newState.registers[srcReg] & 0x1F;
          } else {
            const imm = parseImmediate(operands[1]);
            if (imm !== null) count = imm & 0x1F;
          }
        }

        count &= 0x1F;
        if (count === 0) {
          newState.registers.IP++;
          break;
        }

        const value = newState.registers[dest] & WORD_MASK;
        const signed = (value & 0x8000) ? (value | ~WORD_MASK) : value;
        const shift = Math.min(count, 16);
        const carry = ((value >> (shift - 1)) & 1) !== 0;
        const result = mask16(signed >> shift);
        const overflow = count === 1 ? false : null;
        newState.registers[dest] = result;
        newState.registers.FLAGS = setFlagsShift(result, carry, overflow, newState.registers.FLAGS);
        newState.registers.IP++;
        break;
      }
      
      case 'CMP': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const a = newState.registers[dest];
        const b = value & WORD_MASK;
        const result = a - b;
        newState.registers.FLAGS = setFlagsSub(a, b, result);
        newState.registers.IP++;
        break;
      }
      
      case 'INC': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const a = newState.registers[dest];
        const result = a + 1;
        newState.registers[dest] = mask16(result);
        // INC doesn't affect CF
        const oldCF = newState.registers.FLAGS & FLAG_CF;
        newState.registers.FLAGS = (setFlagsAdd(a, 1, result) & ~FLAG_CF) | oldCF;
        newState.registers.IP++;
        break;
      }
      
      case 'DEC': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const a = newState.registers[dest];
        const result = a - 1;
        newState.registers[dest] = mask16(result);
        // DEC doesn't affect CF
        const oldCF = newState.registers.FLAGS & FLAG_CF;
        newState.registers.FLAGS = (setFlagsSub(a, 1, result) & ~FLAG_CF) | oldCF;
        newState.registers.IP++;
        break;
      }
      
      case 'PUSH': {
        const srcReg = parseRegister(operands[0]);
        const srcMem = parseMemoryOperand(operands[0], newState.registers);
        if (!srcReg && srcMem === null) throw new Error(`Invalid source: ${operands[0]}`);

        const value = srcReg ? newState.registers[srcReg] : readWord(newState, srcMem as number);
        const nextSp = newState.registers.SP - 2;
        if (nextSp < 0) throw new Error('Stack overflow');
        newState.registers.SP = nextSp;
        writeWord(newState, nextSp, value);
        newState.registers.IP++;
        break;
      }
      
      case 'POP': {
        const destReg = parseRegister(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && destMem === null) throw new Error(`Invalid destination: ${operands[0]}`);

        const sp = newState.registers.SP;
        if (sp < 0 || sp + 1 >= newState.memory.length) {
          throw new Error('Stack underflow');
        }
        const val = readWord(newState, sp);
        if (destReg) {
          newState.registers[destReg] = val;
        } else if (destMem !== null) {
          writeWord(newState, destMem, val);
        }
        newState.registers.SP += 2;
        newState.registers.IP++;
        break;
      }

      case 'CALL': {
        const target = resolveJumpTarget(operands[0], labels, newState);
        const nextSp = newState.registers.SP - 2;
        if (nextSp < 0) throw new Error('Stack overflow');
        writeWord(newState, nextSp, newState.registers.IP + 1);
        newState.registers.SP = nextSp;
        newState.registers.IP = target;
        break;
      }

      case 'RET': {
        const sp = newState.registers.SP;
        if (sp < 0 || sp + 1 >= newState.memory.length) {
          throw new Error('Stack underflow');
        }
        const returnAddress = readWord(newState, sp);
        newState.registers.SP = sp + 2;
        newState.registers.IP = returnAddress;
        break;
      }

      case 'INT': {
        if (operands.length < 1) {
          throw new Error('INT requires vector operand');
        }

        const target = resolveInterruptTarget(operands[0], labels, newState);

        const pushSp1 = newState.registers.SP - 2;
        const pushSp2 = pushSp1 - 2;
        if (pushSp2 < 0) throw new Error('Stack overflow during INT');

        // Save FLAGS then return IP for IRET.
        writeWord(newState, pushSp1, newState.registers.FLAGS);
        writeWord(newState, pushSp2, newState.registers.IP + 1);
        newState.registers.SP = pushSp2;
        newState.registers.IP = target;
        break;
      }

      case 'IRET': {
        const sp = newState.registers.SP;
        if (sp < 0 || sp + 3 >= newState.memory.length) {
          throw new Error('Stack underflow during IRET');
        }
        const returnIp = readWord(newState, sp);
        const restoredFlags = readWord(newState, sp + 2);
        newState.registers.SP = sp + 4;
        newState.registers.IP = returnIp;
        newState.registers.FLAGS = restoredFlags;
        break;
      }

      case 'IN': {
        const dest = parseRegister(operands[0]);
        if (!dest) throw new Error(`Invalid destination register: ${operands[0]}`);
        const portValue = parseImmediate(operands[1]);
        if (portValue === null) throw new Error(`Invalid input port: ${operands[1]}`);
        const portAddress = getPortAddress(portValue);
        newState.registers[dest] = readWord(newState, portAddress);
        newState.registers.IP++;
        break;
      }

      case 'OUTP': {
        const portValue = parseImmediate(operands[0]);
        if (portValue === null) throw new Error(`Invalid output port: ${operands[0]}`);
        const src = parseRegister(operands[1]);
        if (!src) throw new Error(`Invalid source register: ${operands[1]}`);
        const portAddress = getPortAddress(portValue);
        writeWord(newState, portAddress, newState.registers[src]);
        newState.registers.IP++;
        break;
      }
      
      case 'JMP': {
        newState.registers.IP = resolveJumpTarget(operands[0], labels, newState);
        break;
      }
      
      case 'JE':
      case 'JZ': {
        const flags = getFlags(newState.registers.FLAGS);
        if (flags.ZF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JNE':
      case 'JNZ': {
        const flags = getFlags(newState.registers.FLAGS);
        if (!flags.ZF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JL':
      case 'JNGE': {
        const flags = getFlags(newState.registers.FLAGS);
        // SF != OF
        if (flags.SF !== flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JG':
      case 'JNLE': {
        const flags = getFlags(newState.registers.FLAGS);
        // ZF = 0 and SF = OF
        if (!flags.ZF && flags.SF === flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JLE':
      case 'JNG': {
        const flags = getFlags(newState.registers.FLAGS);
        // ZF = 1 or SF != OF
        if (flags.ZF || flags.SF !== flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JGE':
      case 'JNL': {
        const flags = getFlags(newState.registers.FLAGS);
        // SF = OF
        if (flags.SF === flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JC':
      case 'JB':
      case 'JNAE': {
        const flags = getFlags(newState.registers.FLAGS);
        if (flags.CF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JNC':
      case 'JAE':
      case 'JNB': {
        const flags = getFlags(newState.registers.FLAGS);
        if (!flags.CF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JS': {
        const flags = getFlags(newState.registers.FLAGS);
        if (flags.SF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JNS': {
        const flags = getFlags(newState.registers.FLAGS);
        if (!flags.SF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JO': {
        const flags = getFlags(newState.registers.FLAGS);
        if (flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JNO': {
        const flags = getFlags(newState.registers.FLAGS);
        if (!flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'HLT': {
        newState.halted = true;
        break;
      }
      
      case 'NOP': {
        newState.registers.IP++;
        break;
      }
      
      case 'OUT': {
        // Virtual output instruction - stores value for display
        // The actual output is handled by the caller
        newState.registers.IP++;
        break;
      }
      
      case 'OUTC': {
        // Virtual output character instruction
        newState.registers.IP++;
        break;
      }
      
      case 'CLC': {
        newState.registers.FLAGS &= ~FLAG_CF;
        newState.registers.IP++;
        break;
      }
      
      case 'STC': {
        newState.registers.FLAGS |= FLAG_CF;
        newState.registers.IP++;
        break;
      }
      
      case 'CMC': {
        newState.registers.FLAGS ^= FLAG_CF;
        newState.registers.IP++;
        break;
      }
      
      default:
        throw new Error(`Unknown instruction: ${opcode}`);
    }
  } catch (e) {
    newState.error = e instanceof Error ? e.message : 'Unknown error';
    newState.halted = true;
  }
  
  return newState;
}

export interface ProgramOutput {
  type: 'number' | 'char';
  value: number;
}

export function runProgram(
  program: AssembledProgram,
  maxSteps: number = 10000
): { finalState: CPUState; history: CPUState[]; output: ProgramOutput[] } {
  let state = createInitialState();
  const history: CPUState[] = [state];
  const output: ProgramOutput[] = [];
  let steps = 0;
  
  while (!state.halted && steps < maxSteps) {
    const ip = state.registers.IP;
    if (ip < 0 || ip >= program.instructions.length) {
      state = { ...state, halted: true, error: 'IP out of bounds' };
      history.push(state);
      break;
    }
    
    const instruction = program.instructions[ip];
    
    // Check for OUT/OUTC instruction to capture output
    if (instruction.opcode.toUpperCase() === 'OUT') {
      const reg = parseRegister(instruction.operands[0]);
      if (reg) {
        output.push({ type: 'number', value: state.registers[reg] });
      }
    } else if (instruction.opcode.toUpperCase() === 'OUTC') {
      const reg = parseRegister(instruction.operands[0]);
      if (reg) {
        output.push({ type: 'char', value: state.registers[reg] & 0xFF });
      }
    }
    
    state = executeInstruction(state, instruction, program.labels);
    history.push(state);
    steps++;
  }
  
  if (steps >= maxSteps && !state.halted) {
    state = { ...state, error: 'Maximum steps exceeded (infinite loop?)', halted: true };
    history.push(state);
  }
  
  return { finalState: state, history, output };
}
