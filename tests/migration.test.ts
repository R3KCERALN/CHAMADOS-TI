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
test('migration de equipes cria TI/Elétrica por organização e coloca técnicos legados na TI', async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_/);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = 'migration_fixture_' + randomBytes(6).toString('hex');
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const directories = (await readdir('prisma/migrations')).filter((n) => /^\d/.test(n)).sort();
    const boundary = directories.indexOf('202611100001_teams');
    assert.ok(boundary >= 0);
    for (const name of directories.slice(0, boundary))
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    await client.query(`INSERT INTO "Organization"(id,name,"updatedAt") VALUES ('org-segunda','Segunda',CURRENT_TIMESTAMP);
      INSERT INTO "Department"(id,name,"organizationId") VALUES ('legacy-dept','Legado','initial-organization');
      INSERT INTO "User"(id,name,username,"passwordHash","departmentId","organizationId",role,"updatedAt") VALUES ('legacy-user','Maria Antiga','legacy.maria','hash-fixture','legacy-dept','initial-organization','FUNCIONARIO',CURRENT_TIMESTAMP),('legacy-tech','Carlos Técnico','legacy.carlos','hash-fixture','legacy-dept','initial-organization','TI',CURRENT_TIMESTAMP);`);
    for (const name of directories.slice(boundary))
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    const teams = await client.query(
      'SELECT "organizationId", key, name FROM "Team" ORDER BY "organizationId", key',
    );
    assert.deepEqual(teams.rows.map((r) => [r.key, r.name]).slice(0, 2), [
      ['ELETRICA', 'Elétrica'],
      ['TI', 'TI'],
    ]);
    assert.equal(teams.rowCount, 4);
    const tech = (
      await client.query(
        'SELECT t.key FROM "User" u JOIN "Team" t ON t.id=u."teamId" WHERE u.id=$1',
        ['legacy-tech'],
      )
    ).rows[0];
    assert.equal(tech.key, 'TI');
    assert.equal(
      (await client.query('SELECT "teamId" FROM "User" WHERE id=$1', ['legacy-user'])).rows[0]
        .teamId,
      null,
    );
    await client.query(
      `INSERT INTO "Organization"(id,name,"updatedAt") VALUES ('org-nova','Nova',CURRENT_TIMESTAMP)`,
    );
    assert.equal(
      (await client.query(`SELECT count(*) FROM "Team" WHERE "organizationId"='org-nova'`)).rows[0]
        .count,
      '2',
    );
    await assert.rejects(
      client.query(`UPDATE "User" SET "teamId"=NULL WHERE id='legacy-tech'`),
      /User_technician_team/,
    );
    const foreignTeam = (
      await client.query(`SELECT id FROM "Team" WHERE "organizationId"='org-nova' AND key='TI'`)
    ).rows[0].id;
    await assert.rejects(
      client.query(`UPDATE "User" SET "teamId"=$1 WHERE id='legacy-tech'`, [foreignTeam]),
      /Organizational reference mismatch/,
    );
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
test('migration de chamados põe legado e categorias na TI e exige equipe', async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_/);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = 'migration_fixture_' + randomBytes(6).toString('hex');
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const directories = (await readdir('prisma/migrations')).filter((n) => /^\d/.test(n)).sort();
    const boundary = directories.indexOf('202611100002_ticket_teams');
    assert.ok(boundary >= 0);
    for (const name of directories.slice(0, boundary))
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    await client.query(`INSERT INTO "Department"(id,name,"organizationId") VALUES ('legacy-dept','Legado','initial-organization');
      INSERT INTO "Category"(id,name,"organizationId") VALUES ('legacy-category','Rede','initial-organization');
      INSERT INTO "Ticket"(id,description,impact,"requesterName","organizationId","departmentId","updatedAt") VALUES ('legacy-ticket','Registro existente antes das equipes.','BAIXO','Maria Antiga','initial-organization','legacy-dept',CURRENT_TIMESTAMP);`);
    for (const name of directories.slice(boundary))
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    const ticket = (
      await client.query(
        'SELECT t.key FROM "Ticket" k JOIN "Team" t ON t.id=k."teamId" WHERE k.id=$1',
        ['legacy-ticket'],
      )
    ).rows[0];
    const category = (
      await client.query(
        'SELECT t.key FROM "Category" c JOIN "Team" t ON t.id=c."teamId" WHERE c.id=$1',
        ['legacy-category'],
      )
    ).rows[0];
    assert.equal(ticket.key, 'TI');
    assert.equal(category.key, 'TI');
    await assert.rejects(
      client.query(`UPDATE "Ticket" SET "teamId"=NULL WHERE id='legacy-ticket'`),
      /null value/,
    );
    const electrical = (
      await client.query(
        `SELECT id FROM "Team" WHERE "organizationId"='initial-organization' AND key='ELETRICA'`,
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO "Category"(id,name,"organizationId","teamId") VALUES ('eletrica-category','Rede','initial-organization',$1)`,
      [electrical],
    );
    await assert.rejects(
      client.query(`UPDATE "Ticket" SET "categoryId"='eletrica-category' WHERE id='legacy-ticket'`),
      /Team\/category mismatch/,
    );
    await assert.rejects(
      client.query(`UPDATE "Category" SET "teamId"=$1 WHERE id='legacy-category'`, [electrical]),
      /Category team is immutable/,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "Category"(id,name,"organizationId","teamId") VALUES ('duplicada','rede ','initial-organization',$1)`,
        [electrical],
      ),
      /Category_teamId_name_normalized_key/,
    );
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
