// Virtual 8086 Assembler
import { AssembledProgram, Instruction, CompilerError } from '../types/cpu';

const VALID_OPCODES = [
  'MOV', 'ADD', 'ADC', 'SUB', 'SBB', 'MUL', 'DIV', 'MOD', 'NEG',
  'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SAL', 'SHR', 'SAR',
  'CMP', 'JMP', 'JE', 'JZ', 'JNE', 'JNZ',
  'JL', 'JG', 'JLE', 'JGE', 'JNGE', 'JNLE', 'JNG', 'JNL',
  'JC', 'JNC', 'JB', 'JNB', 'JAE', 'JNAE',
  'JS', 'JNS', 'JO', 'JNO',
  'INC', 'DEC', 'PUSH', 'POP',
  'CALL', 'RET', 'INT', 'IRET',
  'IN', 'OUTP',
  'HLT', 'NOP', 'OUT', 'OUTC',
  'CLC', 'STC', 'CMC'
];

const VALID_REGISTERS = ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'SP', 'BP'];

export function assemble(source: string): AssembledProgram {
  const lines = source.split('\n');
  const instructions: Instruction[] = [];
  const labels = new Map<string, number>();
  const errors: CompilerError[] = [];
  
  // First pass: collect labels
  let instrIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines and comments
    if (!line || line.startsWith(';')) continue;
    
    // Check for label
    const labelMatch = line.match(/^(\w+):(.*)$/);
    if (labelMatch) {
      const labelName = labelMatch[1].toUpperCase();
      if (labels.has(labelName)) {
        errors.push({
          line: i + 1,
          message: `Duplicate label: ${labelName}`,
          type: 'error'
        });
      } else {
        labels.set(labelName, instrIndex);
      }
      
      // Check if there's an instruction after the label
      const afterLabel = labelMatch[2].trim();
      if (afterLabel && !afterLabel.startsWith(';')) {
        instrIndex++;
      }
    } else {
      instrIndex++;
    }
  }
  
  // Second pass: parse instructions
  instrIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip empty lines and comments
    if (!line || line.startsWith(';')) continue;
    
    // Remove label prefix if present
    const labelMatch = line.match(/^(\w+):(.*)$/);
    if (labelMatch) {
      line = labelMatch[2].trim();
      if (!line || line.startsWith(';')) continue;
    }
    
    // Remove inline comments
    const commentIndex = line.indexOf(';');
    if (commentIndex !== -1) {
      line = line.substring(0, commentIndex).trim();
    }
    
    if (!line) continue;
    
    // Parse instruction
    const parts = line.split(/\s+/);
    const opcode = parts[0].toUpperCase();
    
    if (!VALID_OPCODES.includes(opcode)) {
      errors.push({
        line: i + 1,
        message: `Unknown instruction: ${opcode}`,
        type: 'error'
      });
      instrIndex++;
      continue;
    }
    
    // Parse operands
    const operandStr = parts.slice(1).join(' ');
    const operands = operandStr ? operandStr.split(',').map(o => o.trim()) : [];
    
    // Validate operands
    const validation = validateInstruction(opcode, operands, i + 1);
    if (validation) {
      errors.push(validation);
    }
    
    instructions.push({
      opcode,
      operands,
      address: instrIndex,
      raw: line
    });
    
    instrIndex++;
  }
  
  // Add implicit HLT if not present
  if (instructions.length === 0 || 
      instructions[instructions.length - 1].opcode !== 'HLT') {
    instructions.push({
      opcode: 'HLT',
      operands: [],
      address: instrIndex,
      raw: 'HLT (implicit)'
    });
  }
  
  return {
    bytecode: [], // Not used in this virtual implementation
    labels,
    instructions,
    errors
  };
}

function validateInstruction(opcode: string, operands: string[], line: number): CompilerError | null {
  switch (opcode) {
    case 'MOV':
      if (operands.length !== 2) {
        return { line, message: `${opcode} requires 2 operands`, type: 'error' };
      }
      {
        const dest = operands[0];
        const src = operands[1];
        const destIsReg = isValidRegister(dest);
        const destIsMem = isValidMemoryOperand(dest);
        const srcIsReg = isValidRegister(src);
        const srcIsMem = isValidMemoryOperand(src);
        const srcIsImm = isValidImmediate(src);

        if (!destIsReg && !destIsMem) {
          return { line, message: `Invalid destination operand: ${dest}`, type: 'error' };
        }
        if (!srcIsReg && !srcIsMem && !srcIsImm) {
          return { line, message: `Invalid source operand: ${src}`, type: 'error' };
        }
        if (destIsMem && srcIsMem) {
          return { line, message: `MOV does not support memory to memory`, type: 'error' };
        }
      }
      break;

    case 'ADD':
    case 'ADC':
    case 'SUB':
    case 'SBB':
    case 'CMP':
    case 'AND':
    case 'OR':
    case 'XOR':
      if (operands.length !== 2) {
        return { line, message: `${opcode} requires 2 operands`, type: 'error' };
      }
      if (!isValidRegister(operands[0])) {
        return { line, message: `Invalid destination register: ${operands[0]}`, type: 'error' };
      }
      if (!isValidRegister(operands[1]) && !isValidImmediate(operands[1]) && !isValidMemoryOperand(operands[1])) {
        return { line, message: `Invalid source operand: ${operands[1]}`, type: 'error' };
      }
      break;
    
    case 'MUL':
    case 'DIV':
    case 'MOD':
      if (operands.length !== 1) {
        return { line, message: `${opcode} requires 1 operand`, type: 'error' };
      }
      if (!isValidRegister(operands[0]) && !isValidImmediate(operands[0]) && !isValidMemoryOperand(operands[0])) {
        return { line, message: `Invalid operand: ${operands[0]}`, type: 'error' };
      }
      break;
    
    case 'SHL':
    case 'SAL':
    case 'SHR':
    case 'SAR':
      if (operands.length < 1 || operands.length > 2) {
        return { line, message: `${opcode} requires 1 or 2 operands`, type: 'error' };
      }
      if (!isValidRegister(operands[0])) {
        return { line, message: `Invalid destination register: ${operands[0]}`, type: 'error' };
      }
      if (operands.length === 2 && !isValidRegister(operands[1]) && !isValidImmediate(operands[1])) {
        return { line, message: `Invalid shift count: ${operands[1]}`, type: 'error' };
      }
      break;
      
    case 'INC':
    case 'DEC':
    case 'NEG':
    case 'NOT':
    case 'OUT':
    case 'OUTC':
      if (operands.length !== 1) {
        return { line, message: `${opcode} requires 1 operand`, type: 'error' };
      }
      if (!isValidRegister(operands[0])) {
        return { line, message: `Invalid register: ${operands[0]}`, type: 'error' };
      }
      break;

    case 'PUSH':
    case 'POP':
      if (operands.length !== 1) {
        return { line, message: `${opcode} requires 1 operand`, type: 'error' };
      }
      if (!isValidRegister(operands[0]) && !isValidMemoryOperand(operands[0])) {
        return { line, message: `Invalid operand: ${operands[0]}`, type: 'error' };
      }
      break;

    case 'CALL':
      if (operands.length !== 1) {
        return { line, message: `${opcode} requires 1 operand (label/address)`, type: 'error' };
      }
      break;

    case 'RET':
    case 'IRET':
      if (operands.length !== 0) {
        return { line, message: `${opcode} takes no operands`, type: 'error' };
      }
      break;

    case 'INT':
      if (operands.length !== 1) {
        return { line, message: `${opcode} requires interrupt vector operand`, type: 'error' };
      }
      if (!isValidImmediate(operands[0]) && !/^\w+$/.test(operands[0])) {
        return { line, message: `Invalid interrupt vector: ${operands[0]}`, type: 'error' };
      }
      break;

    case 'IN':
      if (operands.length !== 2) {
        return { line, message: `${opcode} requires 2 operands`, type: 'error' };
      }
      if (!isValidRegister(operands[0])) {
        return { line, message: `Invalid destination register: ${operands[0]}`, type: 'error' };
      }
      if (!isValidImmediate(operands[1])) {
        return { line, message: `Invalid input port: ${operands[1]}`, type: 'error' };
      }
      break;

    case 'OUTP':
      if (operands.length !== 2) {
        return { line, message: `${opcode} requires 2 operands`, type: 'error' };
      }
      if (!isValidImmediate(operands[0])) {
        return { line, message: `Invalid output port: ${operands[0]}`, type: 'error' };
      }
      if (!isValidRegister(operands[1])) {
        return { line, message: `Invalid source register: ${operands[1]}`, type: 'error' };
      }
      break;
      
    case 'JMP':
    case 'JE':
    case 'JZ':
    case 'JNE':
    case 'JNZ':
    case 'JL':
    case 'JG':
    case 'JLE':
    case 'JGE':
    case 'JNGE':
    case 'JNLE':
    case 'JNG':
    case 'JNL':
    case 'JC':
    case 'JNC':
    case 'JB':
    case 'JNB':
    case 'JAE':
    case 'JNAE':
    case 'JS':
    case 'JNS':
    case 'JO':
    case 'JNO':
      if (operands.length !== 1) {
        return { line, message: `${opcode} requires 1 operand (label)`, type: 'error' };
      }
      break;
      
    case 'HLT':
    case 'NOP':
    case 'CLC':
    case 'STC':
    case 'CMC':
      if (operands.length !== 0) {
        return { line, message: `${opcode} takes no operands`, type: 'error' };
      }
      break;
  }
  
  return null;
}

function isValidRegister(operand: string): boolean {
  return VALID_REGISTERS.includes(operand.toUpperCase().trim());
}

function isValidMemoryOperand(operand: string): boolean {
  const trimmed = operand.trim();
  const match = trimmed.match(/^\[(.+)\]$/);
  if (!match) return false;

  const inner = match[1].replace(/\s+/g, '');
  if (!inner) return false;

  if (isValidRegister(inner)) return true;

  const regMatch = inner.match(/^([A-Za-z]{2})([+-].+)?$/);
  if (regMatch && isValidRegister(regMatch[1])) {
    if (!regMatch[2]) return true;
    return isValidImmediate(regMatch[2]);
  }

  return isValidImmediate(inner);
}

function isValidImmediate(operand: string): boolean {
  const trimmed = operand.trim();
  return /^[-+]?\d+$/.test(trimmed) || 
         /^[-+]?0x[0-9A-Fa-f]+$/i.test(trimmed) ||
         /^[-+]?[0-9A-Fa-f]+h$/i.test(trimmed) ||
         /^[-+]?0b[01]+$/i.test(trimmed);
}

export function formatAssembly(instructions: Instruction[]): string {
  return instructions.map((instr, i) => {
    const addr = i.toString().padStart(4, '0');
    const operandStr = instr.operands.join(', ');
    return `${addr}: ${instr.opcode} ${operandStr}`;
  }).join('\n');
}
