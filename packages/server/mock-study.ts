import type { GuideInput, StudyResult } from '../shared/contracts.js';

type Lesson = {
  match: RegExp;
  summary: string;
  concepts: [string, string][];
  questions: [string, string, string][];
};
const lessons: Lesson[] = [
  {
    match: /\bmips\b/i,
    summary:
      'MIPS separates computation in registers from access to memory. Understanding registers, load/store instructions, and byte offsets helps you translate simple programs into assembly.',
    concepts: [
      [
        'Load/store architecture',
        'Arithmetic instructions operate on registers. Use lw to load a word from memory and sw to store a word from a register.',
      ],
      [
        'Registers',
        'Registers hold values close to the processor. In MIPS, $zero always reads as 0; writing to it does not change that value.',
      ],
      [
        'Byte offsets',
        'A MIPS word is 4 bytes. For an array of words, the address of element i is base + 4 × i. Word accesses normally require 4-byte alignment.',
      ],
    ],
    questions: [
      [
        'What does lw $t0, 8($s0) do?',
        'Loads the word at address $s0 + 8 into $t0.',
        'The immediate offset is in bytes. Offset 8 reaches the third element of a zero-indexed word array.',
      ],
      [
        'How can you add two values stored in memory?',
        'Load them into registers, add the registers, then store the result if needed.',
        'Ordinary MIPS arithmetic does not directly add two memory operands.',
      ],
      [
        'What is read from $zero after an instruction writes to it?',
        '0.',
        'The architecture fixes the value of the zero register.',
      ],
    ],
  },
  {
    match: /red[ -]?black/i,
    summary:
      'A red-black tree is a binary search tree whose color invariants limit its height. Rotations and recoloring restore those invariants after updates, supporting O(log n) search, insertion, and deletion.',
    concepts: [
      [
        'Color invariants',
        'Nodes are red or black; the root and NIL leaves are black. A red node cannot have a red child. Every path from a node to a descendant NIL leaf has the same number of black nodes.',
      ],
      [
        'Height bound',
        'Equal black height and the absence of adjacent red nodes imply that the longest root-to-leaf path is at most twice the shortest. Height is O(log n).',
      ],
      [
        'Rotations',
        'A rotation changes local parent-child relationships while preserving the binary-search ordering. Recoloring and rotations repair balance after an update.',
      ],
    ],
    questions: [
      [
        'Why are two consecutive red nodes disallowed?',
        'They would violate the red-parent invariant.',
        'Together with equal black height, this restriction bounds how much longer one path can be than another.',
      ],
      [
        'Does a rotation change the sorted order of the keys?',
        'No.',
        'A valid rotation preserves the inorder traversal of a binary search tree.',
      ],
      [
        'What is the worst-case search complexity?',
        'O(log n).',
        'Search follows a single path whose length is bounded by the balanced height.',
      ],
    ],
  },
  {
    match: /probability|bayes/i,
    summary:
      'Conditional probability restricts attention to outcomes where a condition holds. Independence means the condition does not change the probability; mutually exclusive events cannot occur together.',
    concepts: [
      [
        'Conditional probability',
        'P(A | B) = P(A ∩ B) / P(B), provided P(B) > 0. The denominator changes the sample space to B.',
      ],
      [
        'Independence',
        'A and B are independent if P(A ∩ B) = P(A)P(B). When P(B) > 0, this implies P(A | B) = P(A).',
      ],
      [
        'Mutual exclusion',
        'Mutually exclusive events have an empty intersection. If both have positive probability, they cannot be independent.',
      ],
    ],
    questions: [
      [
        'If P(A ∩ B) = 0.2 and P(B) = 0.5, what is P(A | B)?',
        '0.4.',
        'Divide the intersection probability by the probability of the condition: 0.2 / 0.5.',
      ],
      [
        'Can mutually exclusive events with positive probabilities be independent?',
        'No.',
        'Their intersection has probability 0 but the product of their positive probabilities is greater than 0.',
      ],
      [
        'Is P(A | B) always equal to P(B | A)?',
        'No.',
        'The denominators generally differ: P(B) versus P(A).',
      ],
    ],
  },
];

export function mockStudy(input: GuideInput): StudyResult {
  const lesson = lessons.find((item) => item.match.test(`${input.title} ${input.body}`));
  if (lesson)
    return {
      summary:
        input.mode === 'notes'
          ? `Excerpt from your notes: ${input.body.slice(0, 1100)}${input.body.length > 1100 ? '…' : ''}`
          : lesson.summary,
      concepts: lesson.concepts.map(([term, explanation]) => ({ term, explanation, basis: 'additional' })),
      questions: lesson.questions.map(([question, answer, explanation]) => ({
        question,
        answer,
        explanation,
      })),
      gaps: [
        input.mode === 'notes'
          ? 'Mock mode shows a source excerpt plus a fixed practice example. It does not analyze your notes or verify that the example matches them.'
          : 'This is a fixed mock example, not a Gemini response. Check it against your course material.',
      ],
    };
  // Unknown subjects stay honest: supply a study template, never pretend to explain them.
  return {
    summary:
      input.mode === 'notes'
        ? `Excerpt from your notes: ${input.body.slice(0, 1100)}${input.body.length > 1100 ? '…' : ''}`
        : `Study template for “${input.title}”. Enable Gemini to generate a topic-specific explanation.`,
    concepts: [
      {
        term: 'Recall',
        explanation: 'Read your material, close it, and explain the central idea in your own words.',
        basis: 'additional',
      },
      {
        term: 'Apply',
        explanation: 'Find a worked example in your course and try to solve it before checking the solution.',
        basis: 'additional',
      },
      {
        term: 'Review',
        explanation: 'Compare your answer with the source. Mark any assumptions you could not justify.',
        basis: 'additional',
      },
    ],
    questions: [
      {
        question: 'What is the central idea of your material?',
        answer: 'Write a one-sentence explanation, then compare it with your notes.',
        explanation: 'This mock template has no topic-specific answer key.',
      },
      {
        question: 'Can you apply the idea to a concrete example?',
        answer: 'Choose an example from your course and work through each step.',
        explanation: 'Check your steps against the course solution.',
      },
      {
        question: 'Which point still needs clarification?',
        answer: 'Record a specific gap or an assumption you could not explain.',
        explanation: 'Use that gap as the focus of your next study request.',
      },
    ],
    gaps: [
      'Mock mode cannot generate an explanation for arbitrary material. Try the MIPS, red-black tree, or probability samples, or configure Gemini.',
    ],
  };
}
