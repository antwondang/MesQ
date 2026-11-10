import type { GuideInput } from './contracts.js';
export const sampleGuides: GuideInput[] = [
  {
    title: 'MIPS: registers and memory',
    mode: 'notes',
    subject: 'computer-science',
    body: 'MIPS is a load/store architecture. Arithmetic operates on registers. lw loads a word from memory into a register; sw stores a register value in memory. A word is 4 bytes. The zero register always reads as zero.',
    demoScenario: 'normal',
  },
  {
    title: 'Red-black trees',
    mode: 'topic',
    subject: 'computer-science',
    body: 'Explain the invariants and why they keep search logarithmic.',
    demoScenario: 'normal',
  },
  {
    title: 'Conditional probability',
    mode: 'topic',
    subject: 'mathematics',
    body: 'Help me distinguish independence from mutually exclusive events.',
    demoScenario: 'normal',
  },
  {
    title: 'Active recall and spaced practice',
    mode: 'notes',
    subject: 'other',
    body: 'Active recall means trying to retrieve information before checking notes. Spaced practice spreads study across multiple sessions. Use feedback to identify errors and revisit difficult concepts.',
    demoScenario: 'normal',
  },
  {
    title: 'MIPS: retry demonstration',
    mode: 'topic',
    subject: 'computer-science',
    body: 'Mock example: a temporary failure followed by recovery.',
    demoScenario: 'transient',
  },
  {
    title: 'Probability: failure demonstration',
    mode: 'topic',
    subject: 'mathematics',
    body: 'Mock example: a permanent provider failure with saved history.',
    demoScenario: 'permanent',
  },
];
