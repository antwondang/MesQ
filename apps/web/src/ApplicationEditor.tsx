import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowUpRight, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import {
  applicationInputSchema,
  localToday,
  statusLabels,
  statuses,
  type ApplicationDetail,
  type ApplicationInput,
} from '../../../packages/shared/contracts.js';
import { createRequestKey, fetchJson } from './api.js';

// Required strings start empty in the form, before validation at save time.
const blank: ApplicationInput = {
  company: '',
  role: '',
  location: '',
  url: '',
  status: 'saved',
  appliedDate: null,
  deadline: null,
  nextAction: '',
  nextActionDate: null,
  notes: '',
  archived: false,
};
export function ApplicationEditor({
  id,
  onClose,
  onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmationCancel = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState<ApplicationInput>(blank);
  const [original, setOriginal] = useState<ApplicationInput>(blank);
  const [detail, setDetail] = useState<ApplicationDetail>();
  const [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [key] = useState(createRequestKey);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  useEffect(() => {
    if (confirmDelete || confirmClose) confirmationCancel.current?.focus();
  }, [confirmDelete, confirmClose]);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const modal = dialog.current!;
    modal.showModal();
    return () => {
      modal.close();
      trigger?.focus();
    };
  }, []);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void fetchJson<ApplicationDetail>(`/api/applications/${id}`, { signal: controller.signal })
      .then((value) => {
        const input = applicationInputSchema.parse(
          Object.fromEntries(
            Object.keys(blank).map((field) => [field, value[field as keyof ApplicationInput]]),
          ),
        );
        setDetail(value);
        setForm(input);
        setOriginal(input);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : 'Could not load this application.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [id]);
  function change<K extends keyof ApplicationInput>(field: K, value: ApplicationInput[K]) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setConfirmDelete(false);
    setConfirmClose(false);
  }
  function close() {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const parsed = applicationInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      await fetchJson(`/api/applications${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(id ? { ...parsed.data, version: detail!.version } : parsed.data),
      });
      onSaved(id ? 'Application updated.' : 'Application added.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      await fetchJson(`/api/applications/${detail.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: detail.version }),
      });
      onSaved('Application deleted.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not delete this application.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="editor"
      aria-labelledby="editor-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="editor-heading">
        <div>
          <span className="eyebrow">{id ? 'APPLICATION DETAILS' : 'ONE MORE OPPORTUNITY'}</span>
          <h2 id="editor-title">{id ? 'Edit application' : 'Add an internship'}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          disabled={busy}
          aria-label="Close application"
        >
          <X size={20} />
        </button>
      </div>
      {loading ? (
        <p className="editor-loading" role="status">
          Loading application…
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            void save(event);
          }}
        >
          {error && (
            <p role="alert" className="error form-error">
              {error}
            </p>
          )}
          {(!id || detail) && (
            <>
              <fieldset disabled={busy} className="editor-fields">
                <div className="form-grid">
                  <label>
                    Company{' '}
                    <span className="required" aria-hidden="true">
                      *
                    </span>
                    <input
                      autoFocus={!id}
                      required
                      maxLength={120}
                      value={form.company}
                      onChange={(e) => change('company', e.target.value)}
                      placeholder="e.g. Acme"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Role{' '}
                    <span className="required" aria-hidden="true">
                      *
                    </span>
                    <input
                      required
                      maxLength={160}
                      value={form.role}
                      onChange={(e) => change('role', e.target.value)}
                      placeholder="e.g. Software engineering intern"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Status
                    <select
                      value={form.status}
                      onChange={(e) => {
                        const status = e.target.value as ApplicationInput['status'];
                        setForm((previous) => ({
                          ...previous,
                          status,
                          appliedDate:
                            status === 'applied' && !previous.appliedDate
                              ? localToday()
                              : previous.appliedDate,
                        }));
                      }}
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {statusLabels[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Location
                    <input
                      maxLength={160}
                      value={form.location}
                      onChange={(e) => change('location', e.target.value)}
                      placeholder="City, hybrid, or remote"
                    />
                  </label>
                  <label className="span-two">
                    Job link <span className="optional">optional</span>
                    <div className="input-with-link">
                      <input
                        type="url"
                        maxLength={2000}
                        value={form.url}
                        onChange={(e) => change('url', e.target.value)}
                        placeholder="https://…"
                      />
                      {form.url && applicationInputSchema.shape.url.safeParse(form.url).success && (
                        <a href={form.url} target="_blank" rel="noreferrer" aria-label="Open job posting">
                          <ArrowUpRight size={18} />
                        </a>
                      )}
                    </div>
                  </label>
                  <label>
                    Date applied
                    <input
                      type="date"
                      value={form.appliedDate ?? ''}
                      onChange={(e) => change('appliedDate', e.target.value || null)}
                    />
                  </label>
                  <label>
                    Application deadline
                    <input
                      type="date"
                      value={form.deadline ?? ''}
                      onChange={(e) => change('deadline', e.target.value || null)}
                    />
                  </label>
                </div>
                <div className="form-section">
                  <h3>Keep the next step clear</h3>
                  <div className="form-grid next-fields">
                    <label>
                      Next action
                      <input
                        maxLength={240}
                        value={form.nextAction}
                        onChange={(e) => change('nextAction', e.target.value)}
                        placeholder="e.g. Prepare for the technical interview"
                      />
                    </label>
                    <label>
                      Action date
                      <input
                        type="date"
                        value={form.nextActionDate ?? ''}
                        onChange={(e) => change('nextActionDate', e.target.value || null)}
                      />
                    </label>
                  </div>
                  <label className="notes-label">
                    Notes
                    <textarea
                      rows={4}
                      maxLength={12000}
                      value={form.notes}
                      onChange={(e) => change('notes', e.target.value)}
                      placeholder="Interview notes, recruiter details, or things to remember…"
                    />
                  </label>
                </div>
                {id && (
                  <label className="archive-toggle">
                    <input
                      type="checkbox"
                      checked={form.archived}
                      onChange={(e) => change('archived', e.target.checked)}
                    />
                    <Archive size={16} />
                    <span>
                      Move to archive <small>Keep the record, clear your active list.</small>
                    </span>
                  </label>
                )}
              </fieldset>
              {detail && (
                <details className="activity">
                  <summary>
                    Activity <span>{detail.history.length}</span>
                  </summary>
                  <ol>
                    {detail.history.map((event) => (
                      <li key={event.id}>
                        <span>{event.description}</span>
                        <time dateTime={event.createdAt}>
                          {new Date(event.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </time>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {confirmDelete && (
                <div className="confirm-panel" role="alert">
                  <strong>Delete this application?</strong>
                  <p>This permanently removes {form.company} and its notes.</p>
                  <div className="button-row">
                    <button
                      className="danger"
                      type="button"
                      onClick={() => {
                        void remove();
                      }}
                      disabled={busy}
                    >
                      Delete permanently
                    </button>
                    <button
                      type="button"
                      className="button"
                      ref={confirmationCancel}
                      onClick={() => setConfirmDelete(false)}
                      disabled={busy}
                    >
                      Keep application
                    </button>
                  </div>
                </div>
              )}
              {confirmClose && (
                <div className="confirm-panel" role="alert">
                  <strong>You have unsaved changes.</strong>
                  <div className="button-row">
                    <button type="button" className="button" onClick={onClose} disabled={busy}>
                      Discard changes
                    </button>
                    <button
                      type="button"
                      className="button"
                      ref={confirmationCancel}
                      disabled={busy}
                      onClick={() => setConfirmClose(false)}
                    >
                      Keep editing
                    </button>
                  </div>
                </div>
              )}
              <div className="editor-footer">
                <div>
                  {id && (
                    <button
                      className="delete-button"
                      type="button"
                      onClick={() => {
                        setConfirmDelete(true);
                        setConfirmClose(false);
                      }}
                      disabled={busy}
                    >
                      <Trash2 size={16} />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
                <div className="button-row">
                  <button className="button" type="button" onClick={close} disabled={busy}>
                    Cancel
                  </button>
                  <button className="primary" type="submit" disabled={busy}>
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : form.archived && !original.archived ? (
                      <Archive size={16} />
                    ) : !form.archived && original.archived ? (
                      <RotateCcw size={16} />
                    ) : null}
                    {busy ? 'Saving…' : id ? 'Save changes' : 'Add application'}
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      )}
    </dialog>
  );
}
