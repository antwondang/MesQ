import type { StudyResult } from '../packages/shared/contracts.js';
export const studyFixture: StudyResult = {
  summary: 'Registers hold operands; load and store move words between registers and memory.',
  concepts: [
    { term: 'Register', explanation: 'A processor storage location for operands.', basis: 'source' },
    { term: 'Load', explanation: 'Copies a value from memory into a register.', basis: 'source' },
    { term: 'Store', explanation: 'Copies a register value into memory.', basis: 'additional' },
  ],
  questions: [
    {
      question: 'Where does lw place its result?',
      answer: 'In a register.',
      explanation: 'It reads a word from memory.',
    },
    {
      question: 'What does sw write?',
      answer: 'A word from a register.',
      explanation: 'The destination is memory.',
    },
    { question: 'How many bytes are in a MIPS word?', answer: 'Four.', explanation: 'One word has 32 bits.' },
  ],
  gaps: ['Check alignment requirements in your course.'],
};
