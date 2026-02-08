import { AssembledProgram, CPUState } from '@/types/cpu';
import { ProgramOutput } from '@/emulator/cpu';

export interface Challenge {
  id: string;
  title: string;
  description: string;
  starter: string;
  validator: (result: { finalState: CPUState; output: ProgramOutput[]; program: AssembledProgram }) => string | null;
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'sum1to10',
    title: 'Sum 1..10',
    description: 'Write assembly that outputs 55.',
    starter: `; Challenge: output sum of 1..10
    MOV AX, 10
    MOV BX, 0
LOOP:
    ADD BX, AX
    DEC AX
    JNZ LOOP
    OUT BX
    HLT`,
    validator: ({ output }) => {
      const numbers = output.filter((item) => item.type === 'number').map((item) => item.value);
      return numbers.includes(55) ? null : 'Expected numeric output 55.';
    },
  },
  {
    id: 'memoryswap',
    title: 'Swap Memory Words',
    description: 'Swap values at [0100h] and [0102h].',
    starter: `; Challenge: swap two words in memory
    MOV AX, 3
    MOV [0100h], AX
    MOV AX, 9
    MOV [0102h], AX
    ; TODO: swap values
    HLT`,
    validator: ({ finalState }) => {
      const a = finalState.memory[0x0100] | (finalState.memory[0x0101] << 8);
      const b = finalState.memory[0x0102] | (finalState.memory[0x0103] << 8);
      return a === 9 && b === 3 ? null : 'Expected [0100h]=9 and [0102h]=3 after swap.';
    },
  },
  {
    id: 'interrupt_roundtrip',
    title: 'Interrupt Roundtrip',
    description: 'Use INT/IRET with vector 1 and ensure AX=123 after return.',
    starter: `; Challenge: interrupt roundtrip
    MOV AX, ISR
    MOV [0002h], AX ; vector table entry for INT 1
    INT 1
    OUT AX
    HLT

ISR:
    MOV AX, 123
    IRET`,
    validator: ({ output }) => {
      const numbers = output.filter((item) => item.type === 'number').map((item) => item.value);
      return numbers.includes(123) ? null : 'Expected output 123 after returning from interrupt.';
    },
  },
];

export function getChallengeById(id: string): Challenge | null {
  return CHALLENGES.find((item) => item.id === id) ?? null;
}
