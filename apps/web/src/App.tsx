import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  localToday,
  nextDue,
  statusLabels,
  statuses,
  type Application,
  type ApplicationList,
  type Status,
  type Summary,
  type View,
} from '../../../packages/shared/contracts.js';
import { ApplicationEditor } from './ApplicationEditor.js';
import { dateLabel, fetchJson, useDebounced, usePoll } from './api.js';

const viewNames: Record<View, string> = {
  applications: 'All applications',
  upcoming: 'Upcoming',
  archive: 'Archive',
};
function NextStep({ application }: { application: Application }) {
  const due = nextDue(application);
  const today = localToday();
  const late = due && due.date < today;
  return (
    <div className="next-step">
      <span>{due?.label ?? (application.nextAction || 'No next step yet')}</span>
      {due ? (
        <span className={`due ${late ? 'overdue' : due.date === today ? 'today' : ''}`}>
          <CalendarDays size={12} />
          {late
            ? `Overdue · ${dateLabel(due.date, true)}`
            : due.date === today
              ? 'Today'
              : dateLabel(due.date, true)}
        </span>
      ) : (
        <span className="secondary">
          {application.archived
            ? 'Archived'
            : ['rejected', 'withdrawn'].includes(application.status)
              ? 'Closed'
              : 'Add a date when you’re ready'}
        </span>
      )}
    </div>
  );
}
export function App() {
  const [view, setView] = useState<View>('applications');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<{ id: string | null } | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const query = new URLSearchParams({
    view,
    q,
    page: String(page),
    pageSize: '20',
    ...(status ? { status } : {}),
  });
  const result = usePoll<ApplicationList>(`/api/applications?${query}`, refresh);
  const summary = usePoll<Summary>('/api/summary', refresh);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (result.value && page > 1 && !result.value.items.length)
      setPage(Math.max(1, Math.ceil(result.value.total / 20)));
  }, [result.value, page]);
  function switchView(value: View) {
    setView(value);
    setPage(1);
    setStatus('');
    setSearch('');
  }
  function updated(message: string) {
    setEditor(null);
    setRefresh((value) => value + 1);
    setNotice(message);
    setActionError('');
    // The edited row may disappear after archive/delete; keep keyboard focus usable.
    requestAnimationFrame(() => {
      addButton.current?.focus();
    });
  }
  async function changeStatus(application: Application, next: Status) {
    setUpdating(application.id);
    setActionError('');
    try {
      await fetchJson(`/api/applications/${application.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: next,
          version: application.version,
          ...(next === 'applied' && !application.appliedDate ? { appliedDate: localToday() } : {}),
        }),
      });
      setRefresh((value) => value + 1);
      setNotice(`Moved ${application.company} to ${statusLabels[next]}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not change the status.');
      setRefresh((value) => value + 1);
    } finally {
      setUpdating(null);
    }
  }
  async function exportCsv() {
    setExporting(true);
    setActionError('');
    try {
      const response = await fetch(`/api/applications/export.csv?${query}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Could not export applications. Please try again.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'internship-applications.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('CSV downloaded for the current view and filters.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }
  const items = result.value?.items ?? [];
  const filtered = Boolean(q || status);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to applications
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a href="/" className="brand" aria-label="Internship Log home">
            <span className="brand-mark">
              <BriefcaseBusiness size={19} strokeWidth={1.7} />
            </span>
            Internship <span className="brand-light">Log</span>
          </a>
          <span className="workspace-label">
            <span />
            Personal workspace
          </span>
        </div>
      </header>
      <main id="main" className="workspace">
        <section className="page-heading">
          <div>
            <span className="eyebrow">A PLACE FOR YOUR NEXT CHAPTER</span>
            <h1>
              Your applications<span className="title-dot">.</span>
            </h1>
            <p>A simple space to keep opportunities moving.</p>
          </div>
          <div className="heading-actions">
            <button
              className="button export-button"
              onClick={() => {
                void exportCsv();
              }}
              disabled={exporting || result.loading}
            >
              <ArrowDownToLine size={16} />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button ref={addButton} className="primary" onClick={() => setEditor({ id: null })}>
              <Plus size={18} />
              Add application
            </button>
          </div>
        </section>
        <section className="summary-strip" aria-label="Application summary">
          <div>
            <strong>{summary.value?.total ?? '—'}</strong>
            <span>applications</span>
          </div>
          <div>
            <strong>{summary.value?.active ?? '—'}</strong>
            <span>in progress</span>
          </div>
          <div>
            <strong>{summary.value?.interviews ?? '—'}</strong>
            <span>interviews</span>
          </div>
          <div>
            <strong className="offer-count">{summary.value?.offers ?? '—'}</strong>
            <span>offers</span>
          </div>
          <p>
            Small steps. New possibilities.
            <ArrowUpRight size={18} />
          </p>
        </section>
        <nav className="view-tabs" aria-label="Application views">
          {(Object.keys(viewNames) as View[]).map((value) => (
            <button
              key={value}
              aria-current={view === value ? 'page' : undefined}
              onClick={() => switchView(value)}
            >
              {viewNames[value]}
              {value === 'applications' && summary.value ? (
                <span>{summary.value.total}</span>
              ) : value === 'archive' && summary.value?.archived ? (
                <span>{summary.value.archived}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <section className="application-section" aria-label={viewNames[view]}>
          <div className="filter-row">
            <div className="search-field">
              <Search size={17} />
              <input
                type="search"
                aria-label="Search applications"
                placeholder="Search company, role, or location…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <label className="status-filter">
              <span>Status</span>
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {statuses.map((item) => (
                  <option value={item} key={item}>
                    {statusLabels[item]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {view === 'upcoming' && (
            <p className="view-hint">
              <CalendarDays size={15} />
              Next actions and deadlines for saved roles, earliest first. Overdue items stay here until you
              update them.
            </p>
          )}
          {view === 'archive' && (
            <p className="view-hint">
              Your archived applications are saved here. Open one and uncheck “Move to archive” to restore it.
            </p>
          )}
          {(result.error || summary.error || actionError) && (
            <div className="error list-error" role="alert">
              {actionError || result.error || summary.error}
              <button
                className="text-button"
                onClick={() => {
                  setActionError('');
                  setRefresh((value) => value + 1);
                }}
              >
                Refresh
              </button>
            </div>
          )}
          {result.loading ? (
            <div className="empty-state" role="status">
              <span className="loading-line" />
              <p>Loading your applications…</p>
            </div>
          ) : items.length ? (
            <>
              <div className="table-wrap">
                <table className="applications-table">
                  <thead>
                    <tr>
                      <th scope="col">Company & role</th>
                      <th scope="col">Status</th>
                      <th scope="col">Applied</th>
                      <th scope="col">Next step</th>
                      <th scope="col">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((application) => (
                      <tr key={application.id}>
                        <td className="company-cell">
                          <span className="company-avatar" aria-hidden="true">
                            {application.company.slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <button
                              className="company-button"
                              onClick={() => setEditor({ id: application.id })}
                            >
                              {application.company}
                            </button>
                            <span className="role-label">{application.role}</span>
                            <span className="location-label">
                              {application.location || 'Location not added'}
                            </span>
                          </div>
                        </td>
                        <td data-label="Status" className="stage-cell">
                          <div className={`stage stage-${application.status}`}>
                            <span className="stage-dot" />
                            <select
                              aria-label={`Status for ${application.company}`}
                              value={application.status}
                              disabled={Boolean(updating)}
                              onChange={(event) => {
                                void changeStatus(application, event.target.value as Status);
                              }}
                            >
                              {statuses.map((item) => (
                                <option key={item} value={item}>
                                  {statusLabels[item]}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td data-label="Applied" className="applied-cell">
                          {dateLabel(application.appliedDate, true)}
                        </td>
                        <td data-label="Next step" className="next-cell">
                          <NextStep application={application} />
                        </td>
                        <td className="open-cell">
                          <button
                            className="icon-button"
                            aria-label={`Edit ${application.company} application`}
                            onClick={() => setEditor({ id: application.id })}
                          >
                            <ArrowUpRight size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-footer">
                <span>
                  {(page - 1) * 20 + 1}–{Math.min(page * 20, result.value!.total)} of {result.value!.total}{' '}
                  {result.value!.total === 1 ? 'application' : 'applications'}
                </span>
                <div className="pagination">
                  <button
                    className="icon-button"
                    disabled={page === 1}
                    aria-label="Previous page"
                    onClick={() => setPage((value) => value - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>Page {page}</span>
                  <button
                    className="icon-button"
                    disabled={page * 20 >= result.value!.total}
                    aria-label="Next page"
                    onClick={() => setPage((value) => value + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            !result.error && (
              <div className="empty-state">
                <span className="empty-icon">
                  {view === 'upcoming' ? (
                    <CalendarDays size={27} strokeWidth={1.4} />
                  ) : (
                    <BriefcaseBusiness size={27} strokeWidth={1.4} />
                  )}
                </span>
                <h2>
                  {filtered
                    ? 'No matches this time.'
                    : view === 'archive'
                      ? 'A little room to move on.'
                      : view === 'upcoming'
                        ? 'A clear schedule.'
                        : 'Every opportunity starts somewhere.'}
                </h2>
                <p>
                  {filtered
                    ? 'Try another search or clear your filters.'
                    : view === 'archive'
                      ? 'Archived applications will live here, with all your notes intact.'
                      : view === 'upcoming'
                        ? 'Add a deadline or a date for your next action to see it here.'
                        : 'Save a role you like. Track your progress. Keep the next step in sight.'}
                </p>
                {filtered ? (
                  <button
                    className="button"
                    onClick={() => {
                      setSearch('');
                      setStatus('');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </button>
                ) : view === 'applications' ? (
                  <button className="text-button empty-action" onClick={() => setEditor({ id: null })}>
                    Add your first application
                    <ArrowRight size={16} />
                  </button>
                ) : null}
              </div>
            )
          )}
        </section>
        <footer className="page-footer">
          <span>One application at a time.</span>
          <span>Saved on this app’s server · Export a CSV to keep a copy.</span>
        </footer>
      </main>
      <div className={`toast ${notice ? 'visible' : ''}`} role="status" aria-live="polite">
        {notice && (
          <>
            <Check size={16} />
            {notice}
          </>
        )}
      </div>
      {editor && <ApplicationEditor id={editor.id} onClose={() => setEditor(null)} onSaved={updated} />}
    </>
  );
}
