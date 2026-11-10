import { z } from 'zod';

export const subjects = ['computer-science', 'mathematics', 'science', 'other'] as const;
export const subjectLabels: Record<(typeof subjects)[number], string> = {
  'computer-science': 'Computer science',
  mathematics: 'Mathematics',
  science: 'Science',
  other: 'Other',
};
export const statuses = ['pending', 'queued', 'processing', 'retrying', 'completed', 'failed'] as const;
export const demoScenarios = ['normal', 'transient', 'permanent', 'exhausted', 'slow'] as const;
export const guideInputSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    mode: z.enum(['notes', 'topic']),
    subject: z.enum(subjects).default('other'),
    body: z.string().trim().max(8000).default(''),
    demoScenario: z.enum(demoScenarios).default('normal'),
  })
  .strict()
  .refine((input) => input.mode !== 'notes' || input.body.length >= 20, {
    message: 'Paste at least 20 characters of notes.',
    path: ['body'],
  });
const text = (max: number) => z.string().trim().min(1).max(max);
export const studyResultSchema = z
  .object({
    summary: text(1500),
    concepts: z
      .array(
        z
          .object({ term: text(120), explanation: text(1200), basis: z.enum(['source', 'additional']) })
          .strict(),
      )
      .min(3)
      .max(6),
    questions: z
      .array(z.object({ question: text(600), answer: text(1000), explanation: text(1000) }).strict())
      .min(3)
      .max(5),
    gaps: z.array(text(500)).max(5),
  })
  .strict();
export const messageSchema = z
  .object({
    schemaVersion: z.literal(2),
    guideId: z.uuid(),
    generation: z.number().int().positive(),
  })
  .strict();
export const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(statuses).optional(),
    subject: z.enum(subjects).optional(),
    q: z.string().trim().max(100).default(''),
  })
  .strict();
export type GuideInput = z.infer<typeof guideInputSchema>;
export type StudyResult = z.infer<typeof studyResultSchema>;
export type JobMessage = z.infer<typeof messageSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type JobStatus = (typeof statuses)[number];
export type ProviderName = 'mock' | 'gemini';
export interface Guide {
  id: string;
  title: string;
  body: string;
  mode: GuideInput['mode'];
  subject: GuideInput['subject'];
  demoScenario: GuideInput['demoScenario'];
  status: JobStatus;
  generation: number;
  attempts: number;
  crashCount: number;
  result: StudyResult | null;
  provider: ProviderName | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  firstStartedAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
}
export interface Attempt {
  id: string;
  generation: number;
  fence: number;
  workerId: string;
  startedAt: string;
  endedAt: string | null;
  outcome: string;
  errorCode: string | null;
  durationMs: number | null;
  tokens: number | null;
}
export interface GuideDetail extends Guide {
  history: Attempt[];
}
export interface GuidePage {
  items: Guide[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AppConfig {
  provider: ProviderName;
  model: string;
  transport: 'rabbitmq' | 'preview';
  maxAttempts: number;
}
export interface Metrics {
  counts: Record<JobStatus, number>;
  total: number;
  pendingPublications: number;
  p50CompletionMs: number | null;
  p95CompletionMs: number | null;
  averageProcessingMs: number | null;
  subjects: { subject: string; count: number }[];
}
