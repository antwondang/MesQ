import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { subjects, subjectLabels } from '../../../packages/shared/contracts.js';
import { sampleGuides } from '../../../packages/shared/samples.js';
import type { AppConfig, GuideInput } from '../../../packages/shared/contracts.js';
import { createRequestKey, fetchJson } from './api.js';

export function NewGuide({
  config,
  onClose,
  onCreated,
}: {
  config?: AppConfig;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef({ fingerprint: '', key: '' });
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<GuideInput['mode']>('notes');
  const [subject, setSubject] = useState<GuideInput['subject']>('computer-science');
  const [body, setBody] = useState('');
  const [scenario, setScenario] = useState<GuideInput['demoScenario']>('normal');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const modal = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal?.showModal();
    return () => {
      modal?.close();
      trigger?.focus();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSending(true);
    const input = { title: title.trim(), body: body.trim(), mode, subject, demoScenario: scenario };
    const fingerprint = JSON.stringify(input);
    try {
      if (request.current.fingerprint !== fingerprint)
        request.current = { fingerprint, key: createRequestKey() };
      const result = await fetchJson<{ id: string }>('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.current.key },
        body: fingerprint,
      });
      onCreated(result.id);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to submit guide.');
    } finally {
      setSending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        if (sending) event.preventDefault();
        else onClose();
      }}
      aria-labelledby="new-title"
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">NEW REQUEST</p>
          <h2 id="new-title">What are you studying?</h2>
        </div>
        <button className="icon-button" aria-label="Close new guide" disabled={sending} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <p className="muted">
        Paste lecture notes or choose a topic. Get a summary, key concepts, and questions to practice.
      </p>
      <div className="sample-choices">
        <span>Try a sample</span>
        {sampleGuides.slice(0, 3).map((guide, index) => (
          <button
            key={guide.title}
            type="button"
            disabled={sending}
            onClick={() => {
              setTitle(guide.title);
              setBody(guide.body);
              setMode(guide.mode);
              setSubject(guide.subject);
              setScenario('normal');
            }}
          >
            {['MIPS', 'Red-black trees', 'Probability'][index]}
          </button>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="input-mode" role="group" aria-label="Study input mode">
          <button
            type="button"
            disabled={sending}
            aria-pressed={mode === 'notes'}
            onClick={() => setMode('notes')}
          >
            Paste notes
          </button>
          <button
            type="button"
            disabled={sending}
            aria-pressed={mode === 'topic'}
            onClick={() => setMode('topic')}
          >
            Explain a topic
          </button>
        </div>
        <label htmlFor="subject">Subject</label>
        <select
          id="subject"
          value={subject}
          disabled={sending}
          onChange={(e) => setSubject(e.target.value as GuideInput['subject'])}
        >
          {subjects.map((value) => (
            <option key={value} value={value}>
              {subjectLabels[value]}
            </option>
          ))}
        </select>
        <label htmlFor="guide-title">
          Title or topic <span>{title.length}/160</span>
        </label>
        <input
          autoFocus
          id="guide-title"
          required
          minLength={2}
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. MIPS registers and memory"
          disabled={sending}
        />
        <label htmlFor="guide-body">
          {mode === 'notes' ? 'Lecture notes' : 'Focus or context (optional)'} <span>{body.length}/8000</span>
        </label>
        <textarea
          id="guide-body"
          required={mode === 'notes'}
          minLength={mode === 'notes' ? 20 : undefined}
          maxLength={8000}
          rows={6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            mode === 'notes'
              ? 'Paste the material you want to understand…'
              : 'What would you like to focus on?'
          }
          disabled={sending}
        />
        {config?.provider === 'mock' && (
          <>
            <label htmlFor="scenario">Processing scenario</label>
            <select
              id="scenario"
              value={scenario}
              onChange={(event) => setScenario(event.target.value as GuideInput['demoScenario'])}
              disabled={sending}
            >
              <option value="normal">Normal completion</option>
              <option value="transient">Temporary failure, then recovery</option>
              <option value="permanent">Permanent failure</option>
              <option value="exhausted">Exhaust all retry attempts</option>
              <option value="slow">Slow job for worker recovery demo</option>
            </select>
            <p className="field-note">Mock scenarios make retries and failures visible without API usage.</p>
          </>
        )}
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          <span className="muted small">Generated explanations need review.</span>
          <button type="submit" className="button primary" disabled={sending || !config}>
            {sending ? 'Submitting…' : 'Create guide'}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
