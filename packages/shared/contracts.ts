import { z } from 'zod';

export const statuses = [
  'saved',
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const;
export type Status = (typeof statuses)[number];
export const statusLabels: Record<Status, string> = {
  saved: 'Saved',
  applied: 'Applied',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.');
const optionalDate = dateSchema.nullable();
const applicationFields = z
  .object({
    company: z.string().trim().min(1, 'Company is required.').max(120),
    role: z.string().trim().min(1, 'Role is required.').max(160),
    location: z.string().trim().max(160),
    url: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => {
        if (!value) return true;
        try {
          return ['https:', 'http:'].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, 'Use a complete http:// or https:// job link.'),
    status: z.enum(statuses),
    appliedDate: optionalDate,
    deadline: optionalDate,
    nextAction: z.string().trim().max(240),
    nextActionDate: optionalDate,
    notes: z.string().trim().max(12000),
    archived: z.boolean(),
  })
  .strict();
export const applicationInputSchema = applicationFields.extend({
  location: applicationFields.shape.location.default(''),
  url: applicationFields.shape.url.default(''),
  status: applicationFields.shape.status.default('saved'),
  appliedDate: optionalDate.default(null),
  deadline: optionalDate.default(null),
  nextAction: applicationFields.shape.nextAction.default(''),
  nextActionDate: optionalDate.default(null),
  notes: applicationFields.shape.notes.default(''),
  archived: applicationFields.shape.archived.default(false),
});
// Patch fields intentionally have no defaults: changing a stage must retain notes and dates.
export const updateSchema = applicationFields
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
export const listQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  status: z.enum(statuses).optional(),
  view: z.enum(['applications', 'upcoming', 'archive']).default('applications'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ApplicationInput = z.infer<typeof applicationInputSchema>;
export type ApplicationPatch = z.infer<typeof updateSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type View = ListQuery['view'];
export interface Application extends ApplicationInput {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface Activity {
  id: string;
  description: string;
  createdAt: string;
}
export interface ApplicationDetail extends Application {
  history: Activity[];
}
export interface ApplicationList {
  items: Application[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Summary {
  total: number;
  active: number;
  interviews: number;
  offers: number;
  archived: number;
}
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function nextDue(application: ApplicationInput): { date: string; label: string } | null {
  if (application.archived || ['rejected', 'withdrawn'].includes(application.status)) return null;
  const dates: { date: string; label: string }[] = [];
  if (application.nextActionDate)
    dates.push({ date: application.nextActionDate, label: application.nextAction || 'Next action' });
  if (application.deadline && application.status === 'saved')
    dates.push({ date: application.deadline, label: 'Application deadline' });
  return dates.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}
