import {
  reviewAuthorization,
  authorizationList,
  purgeExpiredPhotos,
} from '../src/lib/stock-review';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import { stockFixture } from './stock-fixtures';
import { createItem, recordOffTicketUse, authorizationPhoto } from '../src/lib/stock-service';
import {
  MAX_PHOTO_BYTES,
  detectImageType,
  processAuthorizationPhoto,
} from '../src/lib/stock-photo';
let f: Awaited<ReturnType<typeof stockFixture>>;
before(async () => {
  f = await stockFixture();
});
after(() => db.$disconnect());
async function photo() {
  return processAuthorizationPhoto(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toBuffer(),
  );
}
async function use() {
  const { item } = await createItem(f.keeper, {
    kind: 'MATERIAL',
    name: randomUUID(),
    teamId: f.ti,
    unit: 'METRO',
    initialQuantity: '10',
    requestId: randomUUID(),
  });
  return recordOffTicketUse(
    f.tech,
    { itemId: item.id, quantity: '1', note: 'Autorizado', requestId: randomUUID() },
    await photo(),
  );
}
test('foto válida vira WebP sem metadados e no máximo 1600 px', async () => {
  const input = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: 'red' },
  })
    .withMetadata({ exif: { IFD0: { Copyright: 'x' } } })
    .jpeg()
    .toBuffer();
  assert.equal(detectImageType(input), 'image/jpeg');
  const result = await processAuthorizationPhoto(input);
  const meta = await sharp(result.data).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 1600);
  assert.equal(meta.exif, undefined);
  assert.equal(result.size, result.data.length);
});
test('arquivo disfarçado, grande demais ou gigante em pixels é recusado', async () => {
  for (const input of [Buffer.from('<html>'), Buffer.from('<svg/>')])
    await assert.rejects(processAuthorizationPhoto(input), {
      message: 'Envie uma imagem JPEG, PNG ou WebP.',
    });
  await assert.rejects(processAuthorizationPhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1)), {
    message: 'A foto passa de 5 MB. Tire um print menor ou reduza a imagem.',
  });
  const giant = await sharp({
    limitInputPixels: false,
    create: { width: 30000, height: 30000, channels: 3, background: 'black' },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await assert.rejects(processAuthorizationPhoto(giant), {
    message: 'Não foi possível ler esta imagem.',
  });
  await assert.rejects(processAuthorizationPhoto(Buffer.from([255, 216, 255, 0])), {
    message: 'Não foi possível ler esta imagem.',
  });
});
test('uso fora de chamado grava movimento e foto juntos; foto só para gestor, ADMIN e autor', async () => {
  const m = await use();
  for (const id of [f.tech, f.manager, f.admin])
    assert.equal((await authorizationPhoto(id, m.id)).mime, 'image/webp');
  for (const id of [f.other, f.employee])
    await assert.rejects(authorizationPhoto(id, m.id), { status: 404 });
  for (const id of [f.manager, f.employee])
    await assert.rejects(
      recordOffTicketUse(
        id,
        { itemId: m.itemId, quantity: '1', requestId: randomUUID() },
        await photo(),
      ),
    );
  const org = await db.organization.create({ data: { name: 'Alheia' } });
  const team = await db.team.findFirstOrThrow({ where: { organizationId: org.id } });
  const item = await db.stockItem.create({
    data: {
      organizationId: org.id,
      teamId: team.id,
      name: 'Alheio',
      kind: 'MATERIAL',
      unit: 'METRO',
    },
  });
  await assert.rejects(
    recordOffTicketUse(
      f.tech,
      { itemId: item.id, quantity: '1', requestId: randomUUID() },
      await photo(),
    ),
    { status: 404 },
  );
  assert.equal(await db.stockMovement.count({ where: { itemId: item.id } }), 0);
  assert.equal(await db.stockPhoto.count({ where: { movementId: m.id } }), 1);
  assert.equal(m.type, 'USO_AVULSO');
});

test('conferência só por gestor ou ADMIN; questionada exige observação e só sai por encerramento', async () => {
  const m = await use();
  for (const id of [f.tech, f.keeper, f.employee])
    await assert.rejects(reviewAuthorization(id, m.id, { outcome: 'CONFERIDA' }));
  await assert.rejects(reviewAuthorization(f.manager, m.id, { outcome: 'QUESTIONADA' }), {
    message: 'Escreva uma observação.',
  });
  await reviewAuthorization(f.manager, m.id, {
    outcome: 'QUESTIONADA',
    note: 'Falta identificação',
  });
  await assert.rejects(reviewAuthorization(f.admin, m.id, { outcome: 'CONFERIDA' }), {
    status: 409,
  });
  await assert.rejects(reviewAuthorization(f.admin, m.id, { outcome: 'ENCERRADA' }), {
    message: 'Escreva uma observação.',
  });
  await reviewAuthorization(f.admin, m.id, {
    outcome: 'ENCERRADA',
    note: 'Autorização confirmada',
  });
  const list = await authorizationList(f.manager, { state: 'ENCERRADA' });
  assert.equal(list.rows.find((r) => r.id === m.id)?.state, 'ENCERRADA');
  await assert.rejects(authorizationList(f.tech, {}), { status: 403 });
});
test('duas conferências simultâneas: só uma vale', async () => {
  const m = await use();
  const results = await Promise.allSettled([
    reviewAuthorization(f.manager, m.id, { outcome: 'CONFERIDA' }),
    reviewAuthorization(f.admin, m.id, { outcome: 'QUESTIONADA', note: 'Conferir' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await db.stockReview.count({ where: { movementId: m.id } }), 1);
});
test('foto conferida há mais de 1 ano é apagada; questionada não; encerrada vence 1 ano depois do encerramento', async () => {
  const old = new Date('2024-01-01T00:00:00Z'),
    now = new Date('2026-01-01T00:00:00Z');
  const confirmed = await use(),
    questioned = await use(),
    closed = await use();
  const c = await reviewAuthorization(f.manager, confirmed.id, { outcome: 'CONFERIDA' });
  const q = await reviewAuthorization(f.manager, questioned.id, {
    outcome: 'QUESTIONADA',
    note: 'Conferir',
  });
  const qc = await reviewAuthorization(f.manager, closed.id, {
    outcome: 'QUESTIONADA',
    note: 'Conferir',
  });
  await db.stockReview.updateMany({
    where: { id: { in: [c.id, q.id, qc.id] } },
    data: { createdAt: old },
  });
  const end = await reviewAuthorization(f.manager, closed.id, {
    outcome: 'ENCERRADA',
    note: 'Conferido',
  });
  await db.stockReview.update({
    where: { id: end.id },
    data: { createdAt: new Date('2025-06-01T00:00:00Z') },
  });
  await purgeExpiredPhotos(now);
  await assert.rejects(authorizationPhoto(f.admin, confirmed.id), {
    status: 404,
    message: 'Foto removida após o prazo de guarda.',
  });
  assert.ok(await authorizationPhoto(f.admin, questioned.id));
  assert.ok(await authorizationPhoto(f.admin, closed.id));
  await purgeExpiredPhotos(new Date('2026-06-01T00:00:00Z'));
  await assert.rejects(authorizationPhoto(f.admin, closed.id), { status: 404 });
  assert.ok(await db.stockMovement.findUnique({ where: { id: confirmed.id } }));
  assert.equal(await db.stockReview.count({ where: { movementId: closed.id } }), 2);
});

test('replay avulso recusa requestId de outro item e repete foto após desativação', async () => {
  const first = await use();
  const second = await use();
  const requestId = randomUUID();
  const original = await recordOffTicketUse(
    f.tech,
    { itemId: first.itemId, quantity: '1', requestId },
    await photo(),
  );
  await assert.rejects(
    recordOffTicketUse(f.tech, { itemId: second.itemId, quantity: '1', requestId }, await photo()),
    { status: 409 },
  );
  await db.stockItem.update({ where: { id: first.itemId }, data: { active: false } });
  assert.equal(
    (
      await recordOffTicketUse(
        f.tech,
        { itemId: first.itemId, quantity: '1', requestId },
        await photo(),
      )
    ).id,
    original.id,
  );
  assert.equal(await db.stockPhoto.count({ where: { movementId: original.id } }), 1);
});
test('PNG válido abaixo de 5 MB com transparência cabe no limite de guarda após conversão', async () => {
  const side = 1600,
    raw = Buffer.alloc(side * side * 4, 255);
  let seed = 0x12345678;
  for (let i = 0; i < side * side; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    raw[i * 4 + 3] = seed >>> 24;
  }
  const png = await sharp(raw, { raw: { width: side, height: side, channels: 4 } })
    .png()
    .toBuffer();
  assert.ok(png.length < MAX_PHOTO_BYTES);
  const processed = await processAuthorizationPhoto(png);
  assert.ok(processed.size <= 2 * 1024 * 1024, `WebP ficou com ${processed.size} bytes`);
  const { item } = await createItem(f.keeper, {
    kind: 'MATERIAL',
    name: randomUUID(),
    teamId: f.ti,
    unit: 'METRO',
    initialQuantity: '2',
    requestId: randomUUID(),
  });
  const movement = await recordOffTicketUse(
    f.tech,
    { itemId: item.id, quantity: '1', requestId: randomUUID() },
    processed,
  );
  assert.ok(await authorizationPhoto(f.admin, movement.id));
});
