import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import { stockFixture } from './stock-fixtures';
import { createItem, recordOffTicketUse, authorizationPhoto } from '../src/lib/stock-service';
import { MAX_PHOTO_BYTES, detectImageType, processAuthorizationPhoto } from '../src/lib/stock-photo';
let f: Awaited<ReturnType<typeof stockFixture>>;
before(async () => { f = await stockFixture(); });
after(() => db.$disconnect());
async function photo() { return processAuthorizationPhoto(await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer()); }
async function use() {
  const { item } = await createItem(f.keeper, { kind: 'MATERIAL', name: randomUUID(), teamId: f.ti, unit: 'METRO', initialQuantity: '10', requestId: randomUUID() });
  return recordOffTicketUse(f.tech, { itemId: item.id, quantity: '1', note: 'Autorizado', requestId: randomUUID() }, await photo());
}
test('foto válida vira WebP sem metadados e no máximo 1600 px', async () => {
  const input = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: 'red' } }).withMetadata({ exif: { IFD0: { Copyright: 'x' } } }).jpeg().toBuffer();
  assert.equal(detectImageType(input), 'image/jpeg');
  const result = await processAuthorizationPhoto(input);
  const meta = await sharp(result.data).metadata();
  assert.equal(meta.format, 'webp'); assert.equal(meta.width, 1600); assert.equal(meta.exif, undefined);
  assert.equal(result.size, result.data.length);
});
test('arquivo disfarçado, grande demais ou gigante em pixels é recusado', async () => {
  for (const input of [Buffer.from('<html>'), Buffer.from('<svg/>')])
    await assert.rejects(processAuthorizationPhoto(input), { message: 'Envie uma imagem JPEG, PNG ou WebP.' });
  await assert.rejects(processAuthorizationPhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1)), { message: 'A foto passa de 5 MB. Tire um print menor ou reduza a imagem.' });
  const giant = await sharp({ limitInputPixels: false, create: { width: 30000, height: 30000, channels: 3, background: 'black' } }).png({ compressionLevel: 9 }).toBuffer();
  await assert.rejects(processAuthorizationPhoto(giant), { message: 'Não foi possível ler esta imagem.' });
  await assert.rejects(processAuthorizationPhoto(Buffer.from([255,216,255,0])), { message: 'Não foi possível ler esta imagem.' });
});
test('uso fora de chamado grava movimento e foto juntos; foto só para gestor, ADMIN e autor', async () => {
  const m = await use();
  for (const id of [f.tech, f.manager, f.admin]) assert.equal((await authorizationPhoto(id, m.id)).mime, 'image/webp');
  for (const id of [f.other, f.employee]) await assert.rejects(authorizationPhoto(id, m.id), { status: 404 });
  for (const id of [f.manager, f.employee]) await assert.rejects(recordOffTicketUse(id, { itemId: m.itemId, quantity: '1', requestId: randomUUID() }, await photo()));
  const org = await db.organization.create({ data: { name: 'Alheia' } });
  const team = await db.team.findFirstOrThrow({ where: { organizationId: org.id } });
  const item = await db.stockItem.create({ data: { organizationId: org.id, teamId: team.id, name: 'Alheio', kind: 'MATERIAL', unit: 'METRO' } });
  await assert.rejects(recordOffTicketUse(f.tech, { itemId: item.id, quantity: '1', requestId: randomUUID() }, await photo()), { status: 404 });
  assert.equal(await db.stockMovement.count({ where: { itemId: item.id } }), 0);
  assert.equal(await db.stockPhoto.count({ where: { movementId: m.id } }), 1);
  assert.equal(m.type, 'USO_AVULSO');
});
