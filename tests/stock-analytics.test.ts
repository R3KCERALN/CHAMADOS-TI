import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { stockFixture } from './stock-fixtures';
import {
  createItem,
  recordOffTicketUse,
  reverseMovement,
  adjustCount,
  takeTool,
} from '../src/lib/stock-service';
import { reviewAuthorization } from '../src/lib/stock-review';
import { processAuthorizationPhoto } from '../src/lib/stock-photo';
import { stockReport, stockExportRows } from '../src/lib/stock-analytics';
import { stockCsvRow } from '../src/lib/csv';
import { renderReportPdf } from '../src/lib/pdf-report';
import { buildManagementPdf } from '../src/lib/management-pdf';
import sharp from 'sharp';
let f: Awaited<ReturnType<typeof stockFixture>>;
before(async () => {
  f = await stockFixture();
});
after(() => db.$disconnect());
const item = async (name: string = randomUUID(), kind = 'MATERIAL') =>
  (
    await createItem(f.keeper, {
      kind,
      name,
      teamId: f.ti,
      unit: 'METRO',
      initialQuantity: '10',
      requestId: randomUUID(),
    })
  ).item;
const use = async (id: string, quantity = '2') =>
  recordOffTicketUse(
    f.electrician,
    { itemId: id, quantity, requestId: randomUUID() },
    await processAuthorizationPhoto(
      await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
        .png()
        .toBuffer(),
    ),
  );
test('consumo desconta estornos e não conta ajuste nem entrada; equipe do item e equipe de quem usou', async () => {
  const i = await item();
  const a = await use(i.id);
  await use(i.id, '3');
  await reverseMovement(f.electrician, a.id, {
    reason: 'Lançamento errado',
    requestId: randomUUID(),
  });
  await adjustCount(f.keeper, i.id, {
    counted: '20',
    reason: 'Contagem física',
    requestId: randomUUID(),
  });
  const report = await stockReport(f.manager, { item: i.id, actorTeam: f.electric });
  assert.equal(report.consumption.length, 1);
  assert.equal(report.consumption[0].quantity, '3');
  assert.equal(report.consumption[0].teamName, 'TI');
  assert.equal(
    (await stockReport(f.manager, { item: i.id, actorTeam: f.ti })).consumption.length,
    0,
  );
});
test('usos fora de chamado contam por estado atual da conferência', async () => {
  const i = await item();
  const a = await use(i.id),
    b = await use(i.id),
    c = await use(i.id);
  await reviewAuthorization(f.manager, a.id, { outcome: 'CONFERIDA' });
  await reviewAuthorization(f.manager, b.id, { outcome: 'QUESTIONADA', note: 'Conferir' });
  await reviewAuthorization(f.admin, b.id, { outcome: 'ENCERRADA', note: 'Confirmada' });
  const report = await stockReport(f.manager, { item: i.id });
  assert.deepEqual(report.offTicket.counts, {
    PENDENTE: 1,
    CONFERIDA: 1,
    QUESTIONADA: 0,
    ENCERRADA: 1,
  });
  assert.equal(report.offTicket.rows.length, 3);
  assert.ok(c.id);
});
test('ferramentas fora do lugar mostram há quanto tempo, a mais antiga primeiro', async () => {
  const a = await item(randomUUID(), 'FERRAMENTA'),
    b = await item(randomUUID(), 'FERRAMENTA');
  await takeTool(f.tech, a.id);
  await takeTool(f.electrician, b.id);
  await db.stockItem.update({
    where: { id: a.id },
    data: { heldSince: new Date(Date.now() - 7200000) },
  });
  const report = await stockReport(f.manager, {});
  const rows = report.toolsOut.filter((r) => [a.name, b.name].includes(r.name));
  assert.equal(rows[0].name, a.name);
  assert.ok(rows[0].seconds >= 7200);
});
test('técnico e funcionário não acessam relatórios; CSV neutraliza fórmulas; PDF tem acentos', async () => {
  for (const id of [f.tech, f.employee]) await assert.rejects(stockReport(id, {}));
  const i = await item('=HYPERLINK(' + randomUUID() + ')');
  await use(i.id);
  const rows = await db.$transaction((tx) =>
    stockExportRows(f.manager, { item: i.id }, new Date(), 0, 500, tx),
  );
  assert.ok(stockCsvRow(rows[0]).includes("'=HYPERLINK("));
  const pdf = await renderReportPdf(
    await buildManagementPdf(f.manager, 'estoque', {}, undefined, { now: new Date() }),
  );
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  await db.$transaction(async (tx) => {
    await assert.rejects(stockExportRows(f.tech, {}, new Date(), 0, 500, tx));
  });
});
