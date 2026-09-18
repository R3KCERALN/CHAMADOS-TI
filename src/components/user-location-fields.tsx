'use client';
import { LocationFields, type LocationCompany } from './location-fields';
import { organizationLabels as labels } from '@/lib/organization-labels';
export function UserLocationFields({
  companies,
  user,
}: {
  companies: LocationCompany[];
  user?: {
    primaryCompanyId: string | null;
    primaryUnitId: string | null;
    companyAccess?: { companyId: string }[];
    unitAccess?: { unitId: string }[];
  };
}) {
  return (
    <>
      <LocationFields
        companies={companies}
        initialCompanyId={user?.primaryCompanyId}
        initialUnitId={user?.primaryUnitId}
        companyName="primaryCompanyId"
        unitName="primaryUnitId"
        optional
      />
      <p className="field-hint">
        {labels.company} principal obrigatória para funcionário. TI atende toda a organização.
      </p>
      <details className="additional-locations">
        <summary>Outras localizações autorizadas</summary>
        <fieldset>
          <legend>{labels.companies} adicionais</legend>
          {companies.map((c) => (
            <label className="access-option" key={c.id}>
              <input
                type="checkbox"
                name="additionalCompanyIds"
                value={c.id}
                defaultChecked={user?.companyAccess?.some((a) => a.companyId === c.id)}
              />
              {c.displayName}
            </label>
          ))}
        </fieldset>
        {companies.some((c) => c.units.length) && (
          <fieldset>
            <legend>{labels.units} autorizadas</legend>
            <p className="field-hint">
              Sem seleção em uma filial: todas as suas unidades. Se houver unidade principal ou
              seleção, o acesso nessa filial limita-se às unidades indicadas.
            </p>
            {companies.flatMap((c) =>
              c.units.map((u) => (
                <label className="access-option" key={u.id}>
                  <input
                    type="checkbox"
                    name="additionalUnitIds"
                    value={u.id}
                    defaultChecked={user?.unitAccess?.some((a) => a.unitId === u.id)}
                  />
                  {u.name} — {c.displayName}
                </label>
              )),
            )}
          </fieldset>
        )}
      </details>
    </>
  );
}
