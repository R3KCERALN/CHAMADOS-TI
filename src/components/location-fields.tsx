'use client';
import { useState } from 'react';
import { organizationLabels as labels } from '@/lib/organization-labels';
import { FieldError } from './form';
export type LocationCompany = {
  id: string;
  displayName: string;
  active?: boolean;
  units: { id: string; name: string; active?: boolean }[];
};
export function LocationFields({
  companies,
  initialCompanyId = '',
  initialUnitId = '',
  compact = false,
  companyName = 'companyId',
  unitName = 'unitId',
  optional = false,
  onCompanyChange,
}: {
  companies: LocationCompany[];
  initialCompanyId?: string | null;
  initialUnitId?: string | null;
  compact?: boolean;
  companyName?: string;
  unitName?: string;
  optional?: boolean;
  onCompanyChange?: (id: string) => void;
}) {
  const [company, setCompany] = useState(
    companies.some((c) => c.id === initialCompanyId)
      ? initialCompanyId!
      : compact && companies.length === 1
        ? companies[0].id
        : '',
  );
  const [unit, setUnit] = useState(initialUnitId || '');
  const units = companies.find((c) => c.id === company)?.units || [];
  return (
    <>
      {compact && companies.length === 1 ? (
        <input type="hidden" name={companyName} value={company} />
      ) : (
        <div className="field">
          <label htmlFor={companyName}>
            {compact ? 'Onde está o problema?' : labels.company}
            {optional ? ' (opcional)' : ''}
          </label>
          <select
            id={companyName}
            name={companyName}
            value={company}
            required={!optional}
            aria-describedby={`${companyName}-error`}
            onChange={(e) => {
              setCompany(e.target.value);
              setUnit('');
              onCompanyChange?.(e.target.value);
            }}
          >
            <option value="">
              {optional ? 'Sem vínculo principal' : `Selecione a ${labels.company.toLowerCase()}`}
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.active === false ? ' (inativa)' : ''}
              </option>
            ))}
          </select>
          <FieldError name={companyName} id={`${companyName}-error`} />
        </div>
      )}
      {units.length > 0 ? (
        <div className="field">
          <label htmlFor={unitName}>{labels.unit} (opcional)</label>
          <select
            id={unitName}
            name={unitName}
            value={unit}
            aria-describedby={`${unitName}-error`}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="">{labels.noUnit}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.active === false ? ' (inativa)' : ''}
              </option>
            ))}
          </select>
          <FieldError name={unitName} id={`${unitName}-error`} />
        </div>
      ) : (
        <input type="hidden" name={unitName} value="" />
      )}
      {!companies.length && !optional && (
        <p className="notice error">
          Nenhuma localização disponível. Peça ao administrador para configurar seu cadastro.
        </p>
      )}
    </>
  );
}
export function LocationFilter({
  companies,
  company = '',
  unit = '',
  companyName = 'company',
  unitName = 'unit',
  locked = false,
}: {
  companies: LocationCompany[];
  company?: string;
  unit?: string;
  companyName?: string;
  unitName?: string;
  locked?: boolean;
}) {
  const [selected, setSelected] = useState(company);
  const [selectedUnit, setSelectedUnit] = useState(unit);
  const units = companies
    .filter((c) => !selected || c.id === selected)
    .flatMap((c) => c.units.map((u) => ({ ...u, label: `${u.name} — ${c.displayName}` })));
  return (
    <>
      {locked ? (
        <input type="hidden" name={companyName} value={company} />
      ) : (
        <div className="field">
          <label htmlFor={companyName}>{labels.company}</label>
          <select
            id={companyName}
            name={companyName}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setSelectedUnit('');
            }}
          >
            <option value="">Todas</option>
            <option value="none">{labels.noCompany}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.active === false ? ' (inativa)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {units.length > 0 && (
        <div className="field">
          <label htmlFor={unitName}>{labels.unit}</label>
          <select
            id={unitName}
            name={unitName}
            value={selectedUnit}
            onChange={(e) => setSelectedUnit(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="none">{labels.noUnit}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
