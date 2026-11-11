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
test('migration de estoque aplica CHECKs, triggers de organização e origem única do push', async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/central_test_/);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = 'migration_fixture_' + randomBytes(6).toString('hex');
  const insert = (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    return client.query(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(row),
    );
  };
  const rejectsWith = (code: string, query: Promise<unknown>) => assert.rejects(query, { code });
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const directories = (await readdir('prisma/migrations')).filter((n) => /^\d/.test(n)).sort();
    assert.ok(directories.includes('202611110001_stock'));
    for (const name of directories)
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    const org = 'initial-organization';
    const now = new Date();
    await client.query(`INSERT INTO "Organization"(id,name,"updatedAt") VALUES ('org-b','B',CURRENT_TIMESTAMP);
      INSERT INTO "Department"(id,name,"organizationId") VALUES ('dept','Geral','${org}'),('dept-b','Geral','org-b');`);
    const teamOf = async (o: string) =>
      (await client.query(`SELECT id FROM "Team" WHERE "organizationId"=$1 AND key='TI'`, [o]))
        .rows[0].id as string;
    const ti = await teamOf(org);
    const tiB = await teamOf('org-b');
    const user = (id: string, role: string, extra: Record<string, unknown> = {}) =>
      insert('User', {
        id,
        name: id,
        username: id,
        passwordHash: 'hash-fixture',
        departmentId: extra.departmentId ?? 'dept',
        organizationId: extra.organizationId ?? org,
        role,
        teamId: role === 'TI' ? ti : null,
        updatedAt: now,
        ...(extra.stockKeeper === undefined ? {} : { stockKeeper: extra.stockKeeper }),
      });
    await user('tech', 'TI');
    await user('func-b', 'FUNCIONARIO', { organizationId: 'org-b', departmentId: 'dept-b' });
    // Só técnico pode ser responsável de estoque.
    await rejectsWith('23514', user('func-keeper', 'FUNCIONARIO', { stockKeeper: true }));
    await user('tech-keeper', 'TI', { stockKeeper: true });
    await insert('Ticket', {
      id: 'ticket',
      description: 'Chamado de fixture.',
      impact: 'BAIXO',
      requesterName: 'Maria',
      organizationId: org,
      teamId: ti,
      updatedAt: now,
    });

    const item = (row: Record<string, unknown>) =>
      insert('StockItem', { organizationId: org, teamId: ti, updatedAt: now, ...row });
    await rejectsWith('23514', item({ id: 'x1', kind: 'FERRAMENTA', name: 'x1', unit: 'UNIDADE' }));
    await rejectsWith('23514', item({ id: 'x2', kind: 'FERRAMENTA', name: 'x2', minimum: '1' }));
    await rejectsWith('23514', item({ id: 'x3', kind: 'MATERIAL', name: 'x3' }));
    await rejectsWith(
      '23514',
      item({ id: 'x4', kind: 'MATERIAL', name: 'x4', unit: 'METRO', minimum: '-1' }),
    );
    await rejectsWith(
      '23514',
      item({
        id: 'x5',
        kind: 'MATERIAL',
        name: 'x5',
        unit: 'METRO',
        holderId: 'tech',
        heldSince: now,
      }),
    );
    await rejectsWith(
      '23514',
      item({ id: 'x6', kind: 'FERRAMENTA', name: 'x6', holderId: 'tech' }),
    );
    await rejectsWith('23514', item({ id: 'x7', kind: 'FERRAMENTA', name: 'x7', teamId: tiB }));
    await item({ id: 'cabo', kind: 'MATERIAL', name: 'Cabo', unit: 'METRO', minimum: '0' });
    await item({
      id: 'alicate',
      kind: 'FERRAMENTA',
      name: 'Alicate',
      holderId: 'tech',
      heldSince: now,
    });
    await insert('StockItem', {
      id: 'cabo-b',
      organizationId: 'org-b',
      teamId: tiB,
      kind: 'MATERIAL',
      name: 'Cabo',
      unit: 'METRO',
      updatedAt: now,
    });

    const alert = (id: string, organizationId: string, itemId: string) =>
      insert('StockAlert', { id, organizationId, itemId });
    await alert('alert-1', org, 'cabo');
    await rejectsWith('23505', alert('alert-2', org, 'cabo'));
    await client.query(`UPDATE "StockAlert" SET "closedAt"=CURRENT_TIMESTAMP WHERE id='alert-1'`);
    await alert('alert-2', org, 'cabo');
    await alert('alert-b', 'org-b', 'cabo-b');
    await rejectsWith('23514', alert('alert-x', org, 'cabo-b'));

    const movement = (row: Record<string, unknown>) =>
      insert('StockMovement', {
        organizationId: org,
        itemId: 'cabo',
        actorId: 'tech',
        itemTeamId: ti,
        actorTeamId: ti,
        quantity: '1',
        delta: '1',
        balanceAfter: '1',
        ...row,
      });
    const tool = { itemId: 'alicate', quantity: null, delta: null, balanceAfter: null };
    await movement({ id: 'entrada', type: 'ENTRADA' });
    await rejectsWith('23514', movement({ id: 'm1', type: 'ENTRADA', quantity: '0' }));
    await rejectsWith('23514', movement({ id: 'm2', type: 'ESTORNO', reason: 'erro' }));
    await rejectsWith('23514', movement({ id: 'm3', type: 'AJUSTE' }));
    await rejectsWith('23514', movement({ id: 'm4', type: 'USO_CHAMADO', delta: '-1' }));
    await rejectsWith('23514', movement({ ...tool, id: 'm5', type: 'RETIRADA', quantity: '1' }));
    await rejectsWith('23514', movement({ id: 'm6', type: 'ENTRADA', actorId: 'func-b' }));
    await movement({
      id: 'uso',
      type: 'USO_CHAMADO',
      ticketId: 'ticket',
      ticketTeamId: ti,
      delta: '-1',
    });
    await movement({
      id: 'estorno',
      type: 'ESTORNO',
      reversesId: 'entrada',
      reason: 'erro',
      delta: '-1',
    });
    await movement({ id: 'ajuste', type: 'AJUSTE', reason: 'contagem', quantity: '0', delta: '0' });
    await movement({ id: 'avulso', type: 'USO_AVULSO', delta: '-1' });
    await movement({ ...tool, id: 'retirada', type: 'RETIRADA' });

    const photo = (movementId: string, mime = 'image/webp') =>
      insert('StockPhoto', {
        movementId,
        organizationId: org,
        mime,
        size: 3,
        data: Buffer.from('abc'),
      });
    await rejectsWith('23514', photo('entrada'));
    await rejectsWith('23514', photo('avulso', 'image/png'));
    await photo('avulso');

    const review = (id: string, outcome: string, note: string | null) =>
      insert('StockReview', {
        id,
        organizationId: org,
        movementId: 'avulso',
        actorId: 'tech',
        outcome,
        note,
      });
    await rejectsWith('23514', review('r1', 'QUESTIONADA', null));
    await review('r2', 'QUESTIONADA', 'sem assinatura');
    await review('r3', 'CONFERIDA', null);
    await insert('StockItemAudit', {
      id: 'a1',
      organizationId: org,
      itemId: 'cabo',
      actorId: 'tech',
      action: 'CRIADO',
    });

    await client.query(`INSERT INTO "TicketEvent"(id,"ticketId",type,"actorId") VALUES ('event','ticket','CRIADO','tech');
      INSERT INTO "PushSubscription"(id,"userId","organizationId",endpoint,"endpointHash",p256dh,auth,"sessionHash","updatedAt")
      VALUES ('sub','tech','${org}','https://push.example.invalid/1','hash-1','p','a','s',CURRENT_TIMESTAMP);`);
    const delivery = (id: string, eventId: string | null, stockAlertId: string | null) =>
      insert('PushDelivery', { id, eventId, stockAlertId, subscriptionId: 'sub' });
    await rejectsWith('23514', delivery('d1', 'event', 'alert-2'));
    await rejectsWith('23514', delivery('d2', null, null));
    await rejectsWith('23514', delivery('d3', null, 'alert-b'));
    await delivery('d4', 'event', null);
    await delivery('d5', null, 'alert-2');
    await rejectsWith('23505', delivery('d6', null, 'alert-2'));
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
test('grants deixam o histórico de estoque somente de acréscimo', async () => {
  const source = await readFile('ops/database.mjs', 'utf8');
  const revoke = source
    .split('\n')
    .find((line) => line.includes('REVOKE UPDATE, DELETE, TRUNCATE'));
  assert.ok(revoke);
  for (const table of [
    'TicketEvent',
    'UserAudit',
    'TicketComment',
    'StockMovement',
    'StockReview',
    'StockItemAudit',
  ])
    assert.ok(revoke.includes(`"${table}"`), table);
  assert.ok(!revoke.includes('StockPhoto'));
  assert.ok(!revoke.includes('StockAlert'));
});
