'use client';
import { useState } from 'react';
export function RequesterPicker({
  users,
}: {
  users: { id: string; name: string; department: { name: string } }[];
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const filtered = users.filter((u) =>
    `${u.name} ${u.department.name}`
      .toLocaleLowerCase('pt-BR')
      .includes(query.toLocaleLowerCase('pt-BR')),
  );
  return (
    <fieldset className="picker">
      <legend>Quem precisa de ajuda?</legend>
      <label htmlFor="requester-search" className="muted small">
        Busque pelo nome ou setor e selecione a pessoa
      </label>
      <input
        id="requester-search"
        type="search"
        placeholder="Buscar funcionário…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />
      <div className="picker-results">
        {filtered.slice(0, 30).map((user) => (
          <label
            key={user.id}
            className={`person-option ${selected === user.id ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="requesterId"
              value={user.id}
              checked={selected === user.id}
              onChange={() => setSelected(user.id)}
              required
            />
            <span>
              <strong>{user.name}</strong>
              <small>{user.department.name}</small>
            </span>
          </label>
        ))}
        {filtered.length === 0 && <p className="muted">Nenhum funcionário encontrado.</p>}
      </div>
      {selected && !filtered.slice(0, 30).some((u) => u.id === selected) && (
        <p className="muted">Selecione novamente após ajustar a busca.</p>
      )}
    </fieldset>
  );
}
