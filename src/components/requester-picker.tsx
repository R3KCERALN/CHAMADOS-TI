'use client';
import { useEffect, useState } from 'react';
import { LocationFields, type LocationCompany } from './location-fields';
import { FieldError } from './form';
type Person = {
  id: string;
  name: string;
  department: { name: string };
  primaryCompanyId: string | null;
  primaryUnitId: string | null;
};
export function RequesterPicker({ companies }: { companies: LocationCompany[] }) {
  const [mode, setMode] = useState<'user' | 'name'>('user');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (mode !== 'user') return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/pessoas?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        setPeople(await response.json());
      } catch {
        if (!controller.signal.aborted) setError('Não foi possível buscar. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, mode]);
  const companyId = companies.some((c) => c.id === selected?.primaryCompanyId)
    ? selected?.primaryCompanyId
    : '';
  return (
    <>
      <input name="quick" type="hidden" value="true" />
      <fieldset className="picker">
        <legend>Quem pediu?</legend>
        <div className="quick-identity-tabs">
          <button
            type="button"
            className={`button ${mode === 'user' ? 'primary' : 'secondary'}`}
            aria-pressed={mode === 'user'}
            onClick={() => {
              setMode('user');
              setSelected(null);
            }}
          >
            Buscar pessoa cadastrada
          </button>
          <button
            type="button"
            className={`button ${mode === 'name' ? 'primary' : 'secondary'}`}
            aria-pressed={mode === 'name'}
            onClick={() => {
              setMode('name');
              setSelected(null);
            }}
          >
            Informar nome
          </button>
        </div>
        {mode === 'name' ? (
          <div className="field">
            <label htmlFor="requesterName">Nome de quem pediu</label>
            <input
              id="requesterName"
              name="requesterName"
              maxLength={150}
              required
              placeholder="João - Reposição"
              autoComplete="off"
              aria-describedby="requesterName-error"
            />
            <FieldError name="requesterName" id="requesterName-error" />
          </div>
        ) : selected ? (
          <div className="selected-person" aria-live="polite">
            <span>
              <strong>{selected.name}</strong>
              <small>{selected.department.name}</small>
            </span>
            <button type="button" className="button subtle" onClick={() => setSelected(null)}>
              Trocar
            </button>
            <input type="hidden" name="requesterId" value={selected.id} />
          </div>
        ) : (
          <>
            <label htmlFor="requester-search" className="muted small">
              Busque pelo nome ou setor e selecione a pessoa
            </label>
            <input
              id="requester-search"
              type="search"
              placeholder="Buscar usuário…"
              maxLength={100}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              autoComplete="off"
            />
            <input type="hidden" name="requesterId" value="" />
            <div className="picker-results" aria-busy={loading}>
              {people.map((person) => (
                <label key={person.id} className="person-option">
                  <input
                    type="radio"
                    name="personChoice"
                    onChange={() => setSelected(person)}
                    required
                  />
                  <span>
                    <strong>{person.name}</strong>
                    <small>{person.department.name}</small>
                  </span>
                </label>
              ))}
              {!loading && !people.length && (
                <p className="muted">
                  Nenhuma pessoa encontrada. Você também pode informar somente o nome.
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <FieldError name="requesterId" />
          </>
        )}
      </fieldset>
      <LocationFields
        key={`${mode}-${selected?.id || ''}`}
        companies={companies}
        initialCompanyId={companyId}
        initialUnitId={companyId ? selected?.primaryUnitId : ''}
      />
    </>
  );
}
