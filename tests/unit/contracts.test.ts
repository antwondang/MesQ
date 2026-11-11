import { describe, expect, it } from 'vitest';
import {
  applicationInputSchema,
  dateSchema,
  localToday,
  nextDue,
  updateSchema,
} from '../../packages/shared/contracts.js';
const input = () => applicationInputSchema.parse({ company: 'Northstar', role: 'Design intern' });
describe('application validation', () => {
  it('trims required fields and validates links without allowing executable URLs', () => {
    expect(applicationInputSchema.parse({ company: ' Acme ', role: ' Intern ' }).company).toBe('Acme');
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'not a link'])
      expect(applicationInputSchema.safeParse({ ...input(), url }).success).toBe(false);
    expect(applicationInputSchema.safeParse({ ...input(), company: ' ' }).success).toBe(false);
    expect(applicationInputSchema.safeParse({ ...input(), url: 'https://example.com/jobs' }).success).toBe(
      true,
    );
  });
  it('rejects impossible dates and accepts leap years', () => {
    for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '11/11/2026'])
      expect(dateSchema.safeParse(value).success).toBe(false);
    expect(dateSchema.parse('2028-02-29')).toBe('2028-02-29');
  });
  it('preserves omitted fields in partial edits', () => {
    expect(updateSchema.parse({ version: 1, status: 'interview' })).toEqual({
      version: 1,
      status: 'interview',
    });
    expect(updateSchema.safeParse({ status: 'interview' }).success).toBe(false);
    expect(updateSchema.safeParse({ version: 1, surprise: true }).success).toBe(false);
  });
  it('uses local calendar dates and picks actionable deadlines', () => {
    expect(localToday(new Date(2026, 0, 2, 1))).toBe('2026-01-02');
    const data = {
      ...input(),
      deadline: '2026-11-12',
      nextActionDate: '2026-11-14',
      nextAction: 'Follow up',
    };
    expect(nextDue(data)).toEqual({ date: '2026-11-12', label: 'Application deadline' });
    expect(nextDue({ ...data, status: 'applied' })).toEqual({ date: '2026-11-14', label: 'Follow up' });
    expect(nextDue({ ...data, status: 'rejected' })).toBeNull();
    expect(nextDue({ ...data, archived: true })).toBeNull();
  });
});
