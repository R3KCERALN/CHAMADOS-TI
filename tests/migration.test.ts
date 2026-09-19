import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
test('migration organizacional preserva registros V1, recupera openedBy do evento e não inventa filial', async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_/);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = 'migration_fixture_' + randomBytes(6).toString('hex');
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const directories = (await readdir('prisma/migrations')).filter((n) => /^\d/.test(n)).sort();
    const boundary = directories.indexOf('202609190001_organization_locations');
    assert.ok(boundary >= 0);
    for (const name of directories.slice(0, boundary))
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    await client.query(`INSERT INTO "Department"(id,name) VALUES ('legacy-dept','Legado');
      INSERT INTO "User"(id,name,username,"passwordHash","departmentId",role,"updatedAt") VALUES ('legacy-user','Maria Antiga','legacy.maria','hash-fixture','legacy-dept','FUNCIONARIO',CURRENT_TIMESTAMP),('legacy-tech','Carlos Técnico','legacy.carlos','hash-fixture','legacy-dept','TI',CURRENT_TIMESTAMP);
      INSERT INTO "Ticket"(id,description,impact,"requesterId","departmentId","updatedAt",origin,status,"assigneeId","startedAt") VALUES ('legacy-ticket','Registro existente antes da migração.','BAIXO','legacy-user','legacy-dept',CURRENT_TIMESTAMP,'ATENDIMENTO_RAPIDO','EM_ATENDIMENTO','legacy-tech',CURRENT_TIMESTAMP);
      INSERT INTO "TicketEvent"(id,"ticketId",type,"actorId","toStatus") VALUES ('legacy-event','legacy-ticket','CRIADO','legacy-tech','EM_ATENDIMENTO');`);
    for (const name of directories.slice(boundary))
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    assert.equal((await client.query('SELECT count(*) FROM "PushDelivery"')).rows[0].count, '0');
    const row = (await client.query('SELECT * FROM "Ticket" WHERE id=$1', ['legacy-ticket']))
      .rows[0];
    assert.equal(row.organizationId, 'initial-organization');
    assert.equal(row.requesterName, 'Maria Antiga');
    assert.equal(row.openedByUserId, 'legacy-tech');
    assert.equal(row.requesterId, 'legacy-user');
    assert.equal(row.companyId, null);
    assert.equal(row.unitId, null);
    assert.equal((await client.query('SELECT count(*) FROM "Company"')).rows[0].count, '0');
    assert.equal((await client.query('SELECT count(*) FROM "TicketEvent"')).rows[0].count, '1');
    assert.equal(
      (
        await client.query('SELECT count(*) FROM "User" WHERE "organizationId"=$1', [
          'initial-organization',
        ])
      ).rows[0].count,
      '2',
    );
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
