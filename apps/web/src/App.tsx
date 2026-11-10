import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Inbox,
  Plus,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import type {
  AppConfig,
  Metrics,
  GuideDetail as Detail,
  GuidePage,
} from '../../../packages/shared/contracts.js';
import { subjects, subjectLabels } from '../../../packages/shared/contracts.js';
import { sampleGuides } from '../../../packages/shared/samples.js';
import { duration, fetchJson, timeLabel, useDebounced, usePoll } from './api.js';
import { NewGuide } from './NewGuide.js';
import { StatusBadge, GuideDetail } from './GuideDetail.js';

export function App() {
  const [status, setStatus] = useState('');
  const [subject, setSubject] = useState('');
  const [search, setSearch] = useState('');
  const query = useDebounced(search);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState('');
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '12',
    ...(status ? { status } : {}),
    ...(subject ? { subject } : {}),
    ...(query ? { q: query } : {}),
  });
  const guides = usePoll<GuidePage>(`/api/guides?${params}`, revision);
  const metrics = usePoll<Metrics>('/api/metrics', revision);
  const config = usePoll<AppConfig>('/api/config');
  const selectedId = selected ?? guides.value?.items[0]?.id;
  const detail = usePoll<Detail>(selectedId ? `/api/guides/${selectedId}` : null, revision);
  const counts = metrics.value?.counts;
  function filter(nextStatus: string) {
    setStatus(nextStatus);
    setPage(1);
    setSelected(null);
  }
  async function loadSamples() {
    setSeeding(true);
    setSeedError('');
    try {
      for (const [index, guide] of sampleGuides.entries())
        await fetchJson('/api/guides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `study-sample-v2-${index}` },
          body: JSON.stringify(guide),
        });
      filter('');
      setSubject('');
      setSearch('');
      setRevision((value) => value + 1);
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : 'Unable to load samples.');
    } finally {
      setSeeding(false);
    }
  }
  const inProgress = counts ? counts.pending + counts.queued + counts.processing + counts.retrying : null;
  const offline = guides.error || metrics.error || config.error;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="StudyFlow home">
          <span className="brand-mark">
            <Activity size={20} />
          </span>
          StudyFlow<span className="brand-period">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">S</span>
          <div>
            <strong>My study space</strong>
            <span>Local project</span>
          </div>
        </div>
        <p className="eyebrow nav-label">WORKSPACE</p>
        <nav aria-label="Guide views">
          <button className={status === '' ? 'nav-item active' : 'nav-item'} onClick={() => filter('')}>
            <Inbox size={18} />
            All guides<span>{metrics.value?.total ?? '—'}</span>
          </button>
          <button
            className={status === 'processing' ? 'nav-item active' : 'nav-item'}
            onClick={() => filter('processing')}
          >
            <Activity size={18} />
            Processing<span>{counts?.processing ?? '—'}</span>
          </button>
          <button
            className={status === 'completed' ? 'nav-item active' : 'nav-item'}
            onClick={() => filter('completed')}
          >
            <CheckCheck size={18} />
            Completed<span>{counts?.completed ?? '—'}</span>
          </button>
          <button
            className={status === 'failed' ? 'nav-item active' : 'nav-item'}
            onClick={() => filter('failed')}
          >
            <TriangleAlert size={18} />
            Needs attention<span>{counts?.failed ?? '—'}</span>
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">
            <CircleHelp size={18} />
          </span>
          <strong>Practice before peeking.</strong>
          <p>
            Try each question before revealing the answer. Return to your course notes to check the details.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">SF</span>
          <div>
            <strong>StudyFlow project</strong>
            <span>RabbitMQ + Gemini</span>
          </div>
          <span className="version">v0.1</span>
        </div>
      </aside>
      <main className="main-content">
        <div className="topline">
          <span>
            Workspace <span className="slash">/</span> Study library
          </span>
          <span className={`connection ${offline ? 'offline' : ''}`}>
            <span />
            {offline ? 'Connection interrupted' : 'Updates every 2 seconds'}
          </span>
        </div>
        <header className="page-heading">
          <div>
            <p className="eyebrow">MAKE ROOM FOR UNDERSTANDING.</p>
            <h1>Study library</h1>
            <p>Turn your notes into concepts you understand.</p>
          </div>
          <button className="button primary" onClick={() => setCreating(true)}>
            <Plus size={18} />
            New guide
          </button>
        </header>
        <div className="mode-banner">
          <span className="mode-dot" />
          <strong>
            {config.value?.provider === 'gemini'
              ? 'Gemini mode'
              : config.value
                ? 'Mock AI mode'
                : 'Connecting…'}
          </strong>
          <span>
            {config.value?.transport === 'preview'
              ? 'Fixed examples and study templates. No live AI calls.'
              : config.value
                ? 'Your requests are saved and processed in the background.'
                : 'Loading application configuration.'}
          </span>
          {config.value?.provider === 'mock' && (
            <button
              className="text-button"
              disabled={seeding}
              onClick={() => {
                void loadSamples();
              }}
            >
              <ArrowDownToLine size={14} />
              {seeding ? 'Loading…' : 'Load sample guides'}
            </button>
          )}
        </div>
        {(offline || seedError) && (
          <div role="alert" className="error-box">
            {seedError || `Updates are paused. ${offline} The page will retry automatically.`}
          </div>
        )}
        <section className="metrics-row" aria-label="Queue overview">
          <div className="metric">
            <span>
              Total guides
              <Inbox size={16} />
            </span>
            <strong>{metrics.value?.total ?? '—'}</strong>
            <small>All saved requests</small>
          </div>
          <div className="metric">
            <span>
              In progress
              <Activity size={16} />
            </span>
            <strong>
              {inProgress ?? '—'}
              <i className="live-pip" />
            </strong>
            <small>Waiting, processing, or retrying</small>
          </div>
          <div className="metric">
            <span>
              Completed
              <CheckCheck size={16} />
            </span>
            <strong>{counts?.completed ?? '—'}</strong>
            <small>Ready to study</small>
          </div>
          <div className="metric">
            <span>
              Typical turnaround
              <ArrowUpRight size={16} />
            </span>
            <strong>{duration(metrics.value?.p50CompletionMs)}</strong>
            <small>Median time to a saved guide</small>
          </div>
        </section>
        <div className="inbox-layout">
          <section className="guide-panel" aria-label="Study library">
            <div className="list-heading">
              <h2>
                {status === 'failed'
                  ? 'Needs attention'
                  : status
                    ? `${status[0].toUpperCase()}${status.slice(1)} guides`
                    : 'All guides'}
                <span>{guides.value?.total ?? '—'}</span>
              </h2>
              <span className="small muted">Newest first</span>
            </div>
            <div className="list-filters">
              <label className="search-box">
                <Search size={16} />
                <input
                  type="search"
                  aria-label="Search guides"
                  placeholder="Search guides…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                    setSelected(null);
                  }}
                />
              </label>
              <div className="filter-row">
                <select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(event) => filter(event.target.value)}
                >
                  <option value="">All statuses</option>
                  {['pending', 'queued', 'processing', 'retrying', 'completed', 'failed'].map((value) => (
                    <option key={value} value={value}>
                      {value[0].toUpperCase() + value.slice(1)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by subject"
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value);
                    setPage(1);
                    setSelected(null);
                  }}
                >
                  <option value="">All subjects</option>
                  {subjects.map((value) => (
                    <option key={value} value={value}>
                      {subjectLabels[value]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {guides.loading ? (
              <div className="list-loading" role="status">
                <div className="loading-line" />
                <div className="loading-line" />
                <div className="loading-line" />
                <p>Loading guides…</p>
              </div>
            ) : guides.value?.items.length ? (
              <ul className="guide-list">
                {guides.value.items.map((guide) => (
                  <li key={guide.id}>
                    <button
                      className={`guide-row ${guide.id === selectedId ? 'selected' : ''}`}
                      aria-pressed={guide.id === selectedId}
                      onClick={() => setSelected(guide.id)}
                    >
                      <div className="guide-row-top">
                        <span className="mono">SF-{guide.id.slice(0, 6).toUpperCase()}</span>
                        <time dateTime={guide.createdAt}>{timeLabel(guide.createdAt)}</time>
                      </div>
                      <h3>{guide.title}</h3>
                      <p>{guide.body}</p>
                      <div className="guide-row-bottom">
                        <StatusBadge status={guide.status} />
                        <span className="list-subject">{subjectLabels[guide.subject]}</span>
                        <span className="attempt-count">
                          {guide.attempts} {guide.attempts === 1 ? 'attempt' : 'attempts'}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state list-empty">
                <Inbox size={30} />
                <h3>{guides.error ? 'Library unavailable' : 'No guides here yet'}</h3>
                <p>
                  {guides.error
                    ? 'Check the API and database, then try again.'
                    : status || subject || query
                      ? 'Try a different filter or search.'
                      : 'Create your first guide or load the samples to watch the workflow.'}
                </p>
                <button className="button secondary" onClick={() => setCreating(true)}>
                  <Plus size={16} />
                  Create a guide
                </button>
              </div>
            )}
            <div className="pagination">
              <span>
                {guides.value?.total ? `Page ${page} of ${Math.ceil(guides.value.total / 12)}` : '0 guides'}
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label="Previous page"
                  disabled={page === 1}
                  onClick={() => {
                    setPage((value) => value - 1);
                    setSelected(null);
                  }}
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next page"
                  disabled={!guides.value || page * 12 >= guides.value.total}
                  onClick={() => {
                    setPage((value) => value + 1);
                    setSelected(null);
                  }}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </section>
          <GuideDetail key={selectedId} guide={detail.value} loading={detail.loading} error={detail.error} />
        </div>
        <footer className="page-footer">
          <span>A little clarity, one topic at a time.</span>
          <span>
            {config.value?.provider === 'mock'
              ? 'Mock examples · not generated from your notes'
              : 'AI-generated · verify against your course material'}
          </span>
        </footer>
      </main>
      {creating && (
        <NewGuide
          config={config.value}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            filter('');
            setSubject('');
            setSearch('');
            setSelected(id);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
