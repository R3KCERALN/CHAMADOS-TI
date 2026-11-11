'use client';
import { useState } from 'react';
import { UserLocationFields } from './user-location-fields';
import type { LocationCompany } from './location-fields';
import { roleLabels } from '@/lib/labels';
import { FieldError } from './form';
export function UserFields({
  departments,
  companies,
  teams,
  user,
}: {
  departments: { id: string; name: string }[];
  companies: LocationCompany[];
  teams: { id: string; name: string }[];
  user?: {
    name: string;
    username: string;
    role: string;
    departmentId: string;
    teamId?: string | null;
    active: boolean;
    primaryCompanyId: string | null;
    primaryUnitId: string | null;
    companyAccess?: { companyId: string }[];
    unitAccess?: { unitId: string }[];
  };
}) {
  const [role, setRole] = useState(user?.role || 'FUNCIONARIO');
  return (
    <>
      <div className="field">
        <label htmlFor="name">Nome completo</label>
        <input
          id="name"
          name="name"
          defaultValue={user?.name}
          minLength={2}
          maxLength={100}
          required
          autoComplete="name"
          aria-describedby="name-error"
        />
        <FieldError name="name" id="name-error" />
      </div>
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          defaultValue={user?.username}
          minLength={3}
          maxLength={40}
          required
          pattern="[a-z0-9._\-]+"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="username-hint username-error"
        />
        <p id="username-hint" className="field-hint">
          Único por pessoa. Use letras minúsculas, números, ponto, hífen ou sublinhado.
        </p>
        <FieldError name="username" id="username-error" />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="departmentId">Setor</label>
          <select
            id="departmentId"
            name="departmentId"
            defaultValue={user?.departmentId || ''}
            required
            aria-describedby="departmentId-error"
          >
            <option value="" disabled>
              Selecione um setor
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <FieldError name="departmentId" id="departmentId-error" />
        </div>
        <div className="field">
          <label htmlFor="role">Perfil de acesso</label>
          <select
            id="role"
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            required
            aria-describedby="role-error"
          >
            {Object.entries(roleLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <FieldError name="role" id="role-error" />
        </div>
      </div>
      {role === 'TI' && (
        <div className="field">
          <label htmlFor="teamId">Equipe</label>
          <select
            id="teamId"
            name="teamId"
            defaultValue={user?.teamId || ''}
            required
            aria-describedby="teamId-error"
          >
            <option value="" disabled>
              Selecione a equipe
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <FieldError name="teamId" id="teamId-error" />
        </div>
      )}
      <UserLocationFields companies={companies} user={user} />
      {user ? (
        <div className="field">
          <label htmlFor="active">Situação do acesso</label>
          <select id="active" name="active" defaultValue={String(user.active)}>
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </select>
          <p className="field-hint">
            Desativar bloqueia o acesso e preserva todos os registros anteriores.
          </p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="password">Senha temporária</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={6}
            maxLength={128}
            required
            autoComplete="new-password"
            aria-describedby="password-hint password-error"
          />
          <p id="password-hint" className="field-hint">
            Mínimo de 6 caracteres. A troca será obrigatória no primeiro login.
          </p>
          <FieldError name="password" id="password-error" />
        </div>
      )}
    </>
  );
}
