'use client';
import { LocationFilter } from '@/components/location-fields';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { analyticsOptions } from '@/lib/analytics-service';
import { complexityLabels, statusLabels } from '@/lib/labels';
const presets = {
  hoje: 'Hoje',
  '7dias': 'Últimos 7 dias',
  '30dias': 'Últimos 30 dias',
  mes: 'Este mês',
  anterior: 'Mês anterior',
  personalizado: 'Personalizado',
};
function Apply() {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" disabled={pending}>
      {pending ? 'Aplicando…' : 'Aplicar filtros'}
    </button>
  );
}
export function ManagementFilters({
  options,
  values,
  lockedTechnician,
  lockedCompany,
}: {
  options: Awaited<ReturnType<typeof analyticsOptions>>;
  values: Record<string, string>;
  lockedTechnician?: string;
  lockedCompany?: string;
}) {
  const [period, setPeriod] = useState(values.periodo || '30dias');
  return (
    <form className="panel management-filters" method="get">
      <input type="hidden" name="carteira" value={values.carteira || ''} />
      <div className="filter-grid">
        <LocationFilter
          companies={options.companies}
          company={lockedCompany || values.company}
          unit={values.unit}
          locked={!!lockedCompany}
        />
        <div className="field">
          <label htmlFor="periodo">Período</label>
          <select
            id="periodo"
            name="periodo"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {Object.entries(presets).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {period === 'personalizado' && (
          <>
            <div className="field">
              <label htmlFor="inicio">Data inicial</label>
              <input id="inicio" name="inicio" type="date" required defaultValue={values.inicio} />
            </div>
            <div className="field">
              <label htmlFor="fim">Data final</label>
              <input id="fim" name="fim" type="date" required defaultValue={values.fim} />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="team">Equipe</label>
          <select id="team" name="team" defaultValue={values.team || ''}>
            <option value="">Todas as equipes</option>
            {options.teams.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="department">Setor solicitante</label>
          <select id="department" name="department" defaultValue={values.department || ''}>
            <option value="">Todos os setores</option>
            {options.departments.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        {lockedTechnician ? (
          <input type="hidden" name="technician" value={lockedTechnician} />
        ) : (
          <div className="field">
            <label htmlFor="technician">Técnico</label>
            <select id="technician" name="technician" defaultValue={values.technician || ''}>
              <option value="">Toda a equipe</option>
              {options.technicians.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                  {!t.active ? ' (inativo)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="category">Categoria</label>
          <select id="category" name="category" defaultValue={values.category || ''}>
            <option value="">Todas as categorias</option>
            <option value="none">Sem categoria</option>
            {options.categories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
                {!c.active ? ' (inativa)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="complexity">Complexidade</label>
          <select id="complexity" name="complexity" defaultValue={values.complexity || ''}>
            <option value="">Todas</option>
            <option value="none">Não classificada</option>
            {Object.entries(complexityLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Status atual</label>
          <select id="status" name="status" defaultValue={values.status || ''}>
            <option value="">Todos</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="filter-actions">
        <span>Período para movimentos; backlog é a posição atual.</span>
        <Apply />
      </div>
    </form>
  );
}
