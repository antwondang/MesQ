import { FileText, Clock3, AlertCircle } from 'lucide-react';
import {
  subjectLabels,
  type GuideDetail as Detail,
  type JobStatus,
} from '../../../packages/shared/contracts.js';
import { duration, timeLabel } from './api.js';

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`badge status-${status}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}

export function GuideDetail({ guide, loading, error }: { guide?: Detail; loading: boolean; error?: string }) {
  if (loading)
    return (
      <section className="detail-panel empty-state" aria-busy="true">
        <div className="loading-line" />
        <p>Opening guide…</p>
      </section>
    );
  if (!guide)
    return (
      <section className="detail-panel empty-state">
        <FileText size={32} />
        <h2>{error ? 'Guide unavailable' : 'Your next lightbulb moment.'}</h2>
        <p>{error ?? 'Choose a guide to revisit your notes, explore concepts, and test yourself.'}</p>
      </section>
    );
  const result = guide.result;
  return (
    <section className="detail-panel" aria-label="Study guide details">
      <header className="detail-heading">
        <div className="detail-meta">
          <span className="mono">SF-{guide.id.slice(0, 8).toUpperCase()}</span>
          <span>Saved {timeLabel(guide.createdAt)}</span>
        </div>
        <h2>{guide.title}</h2>
        <div className="badges">
          <StatusBadge status={guide.status} />
          <span className="badge category">{subjectLabels[guide.subject]}</span>
          <span className="badge">{guide.mode === 'notes' ? 'From notes' : 'Topic explanation'}</span>
          {guide.provider === 'mock' && <span className="badge simulated">Mock example</span>}
        </div>
      </header>
      {error && (
        <div className="error-box" role="alert">
          Updates paused. {error}
        </div>
      )}
      <div className="detail-content">
        <details className="source-notes">
          <summary>{guide.mode === 'notes' ? 'Your source notes' : 'Your focus / context'}</summary>
          <p className="customer-message">{guide.body || 'General topic explanation requested.'}</p>
        </details>
        {result ? (
          <>
            <section className="summary-box">
              <div className="section-label">
                <span className="tiny-mark">✦</span>
                <h3>At a glance</h3>
              </div>
              <p>{result.summary}</p>
              <p className="field-note">
                {guide.provider === 'mock'
                  ? 'Fixed mock content; not an AI analysis of your material.'
                  : 'Generated with Gemini. Check explanations against your course material.'}
              </p>
            </section>
            <section>
              <div className="section-label">
                <h3>Key concepts</h3>
                <span className="small muted">Build your understanding</span>
              </div>
              <dl className="concept-list">
                {result.concepts.map((concept, index) => (
                  <div key={index}>
                    <dt>
                      {concept.term}
                      <span className="basis">
                        {concept.basis === 'source' ? 'From your notes' : 'Additional explanation'}
                      </span>
                    </dt>
                    <dd>{concept.explanation}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <div className="section-label">
                <h3>Test yourself</h3>
                <span className="small muted">{result.questions.length} practice questions</span>
              </div>
              <ol className="practice-list">
                {result.questions.map((item, index) => (
                  <li key={index}>
                    <p className="practice-question">{item.question}</p>
                    <details>
                      <summary>Reveal answer</summary>
                      <div className="practice-answer">
                        <p>
                          <strong>{item.answer}</strong>
                        </p>
                        <p>{item.explanation}</p>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </section>
            {result.gaps.length > 0 && (
              <section className="gaps-box">
                <h3>Gaps & things to check</h3>
                <ul>
                  {result.gaps.map((gap, index) => (
                    <li key={index}>{gap}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <section
            className={`processing-box ${guide.status === 'failed' ? 'failed-box' : ''}`}
            role="status"
          >
            {guide.status === 'failed' ? <AlertCircle size={22} /> : <Clock3 size={22} />}
            <div>
              <h3>
                {guide.status === 'failed'
                  ? 'This guide needs attention'
                  : guide.status === 'retrying'
                    ? 'Another attempt is scheduled'
                    : guide.status === 'processing'
                      ? 'Preparing your study guide'
                      : 'Waiting for a worker'}
              </h3>
              <p>
                {guide.status === 'failed'
                  ? 'Processing stopped. See the history below, then submit a new request when the issue is resolved.'
                  : guide.nextAttemptAt
                    ? `Next attempt is due at ${timeLabel(guide.nextAttemptAt)}.`
                    : 'Your request is saved. You can keep studying while it processes.'}
              </p>
              {guide.lastError && <code>{guide.lastError}</code>}
            </div>
          </section>
        )}
        <section className="history-section">
          <div className="section-label">
            <h3>Processing history</h3>
            <span className="small muted">
              {guide.attempts} application {guide.attempts === 1 ? 'attempt' : 'attempts'}
            </span>
          </div>
          {guide.history.length === 0 ? (
            <p className="muted small">No attempts yet. The request is durably stored.</p>
          ) : (
            <ol className="history-list">
              {guide.history.map((attempt) => (
                <li key={attempt.id}>
                  <span className={`history-dot ${attempt.outcome}`} />
                  <div>
                    <strong>
                      Attempt {attempt.generation}
                      <span>{attempt.outcome}</span>
                    </strong>
                    <p>
                      {attempt.workerId} · {timeLabel(attempt.startedAt)}
                      {attempt.durationMs !== null && ` · ${duration(attempt.durationMs)}`}
                      {attempt.tokens !== null && ` · ${attempt.tokens} tokens`}
                    </p>
                    {attempt.errorCode && <code>{attempt.errorCode}</code>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {guide.crashCount > 0 && (
            <p className="field-note">Worker interruptions recovered: {guide.crashCount}</p>
          )}
        </section>
      </div>
    </section>
  );
}
