-- Stock of tools and maintenance materials. Movements, reviews and item audit are append-only history;
-- the current balance lives on the item and changes in the same transaction as each movement.
BEGIN;
CREATE TYPE "StockItemKind" AS ENUM ('FERRAMENTA','MATERIAL');
CREATE TYPE "StockUnit" AS ENUM ('UNIDADE','METRO','ROLO','CAIXA','PACOTE');
CREATE TYPE "StockMovementType" AS ENUM ('ENTRADA','USO_CHAMADO','USO_AVULSO','AJUSTE','ESTORNO','RETIRADA','DEVOLUCAO');
CREATE TYPE "StockReviewOutcome" AS ENUM ('CONFERIDA','QUESTIONADA','ENCERRADA');

ALTER TABLE "User" ADD COLUMN "stockKeeper" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "User_stock_keeper_technician" CHECK (NOT "stockKeeper" OR role='TI');

CREATE TABLE "StockItem" (
 "id" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "teamId" TEXT NOT NULL REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "kind" "StockItemKind" NOT NULL,
 "name" TEXT NOT NULL,
 "unit" "StockUnit",
 "minimum" DECIMAL(12,3),
 "balance" DECIMAL(12,3) NOT NULL DEFAULT 0,
 "needsCount" BOOLEAN NOT NULL DEFAULT false,
 "holderId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "heldSince" TIMESTAMP(3),
 "active" BOOLEAN NOT NULL DEFAULT true,
 "deactivatedReason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "StockItem_tool_fields" CHECK ("kind"<>'FERRAMENTA' OR ("unit" IS NULL AND "minimum" IS NULL)),
 CONSTRAINT "StockItem_material_fields" CHECK ("kind"<>'MATERIAL' OR ("unit" IS NOT NULL AND "holderId" IS NULL)),
 CONSTRAINT "StockItem_minimum_nonnegative" CHECK ("minimum" IS NULL OR "minimum">=0),
 CONSTRAINT "StockItem_holder_since" CHECK (("holderId" IS NULL) = ("heldSince" IS NULL))
);
CREATE UNIQUE INDEX "StockItem_organizationId_name_key" ON "StockItem"("organizationId","name");
CREATE INDEX "StockItem_organizationId_kind_active_idx" ON "StockItem"("organizationId","kind","active");

CREATE TABLE "StockMovement" (
 "id" TEXT NOT NULL,
 "sequence" SERIAL NOT NULL,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "itemId" TEXT NOT NULL REFERENCES "StockItem"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "type" "StockMovementType" NOT NULL,
 "quantity" DECIMAL(12,3),
 "delta" DECIMAL(12,3),
 "balanceAfter" DECIMAL(12,3),
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "targetUserId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "ticketId" TEXT REFERENCES "Ticket"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "reversesId" TEXT REFERENCES "StockMovement"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "reason" TEXT,
 "note" TEXT,
 "requestId" TEXT,
 "itemTeamId" TEXT NOT NULL REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorTeamId" TEXT REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "ticketTeamId" TEXT REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"),
 -- Tool movements carry no quantity; material movements always carry quantity, delta and the resulting balance.
 -- AJUSTE stores the counted quantity, which may be zero; every other material movement is strictly positive.
 CONSTRAINT "StockMovement_quantity" CHECK (CASE
   WHEN "type" IN ('RETIRADA','DEVOLUCAO') THEN "quantity" IS NULL AND "delta" IS NULL AND "balanceAfter" IS NULL
   WHEN "type"='AJUSTE' THEN "quantity">=0 AND "delta" IS NOT NULL AND "balanceAfter" IS NOT NULL
   ELSE "quantity">0 AND "delta" IS NOT NULL AND "balanceAfter" IS NOT NULL END),
 CONSTRAINT "StockMovement_ticket_use" CHECK (("type"='USO_CHAMADO') = ("ticketId" IS NOT NULL)),
 CONSTRAINT "StockMovement_reversal" CHECK (("type"='ESTORNO') = ("reversesId" IS NOT NULL)),
 CONSTRAINT "StockMovement_reason" CHECK ("type" NOT IN ('AJUSTE','ESTORNO') OR "reason" IS NOT NULL)
);
CREATE UNIQUE INDEX "StockMovement_sequence_key" ON "StockMovement"("sequence");
CREATE UNIQUE INDEX "StockMovement_reversesId_key" ON "StockMovement"("reversesId");
CREATE UNIQUE INDEX "StockMovement_organizationId_requestId_key" ON "StockMovement"("organizationId","requestId");
CREATE INDEX "StockMovement_organizationId_createdAt_idx" ON "StockMovement"("organizationId","createdAt");
CREATE INDEX "StockMovement_itemId_sequence_idx" ON "StockMovement"("itemId","sequence");
CREATE INDEX "StockMovement_ticketId_idx" ON "StockMovement"("ticketId");

CREATE TABLE "StockPhoto" (
 "movementId" TEXT NOT NULL REFERENCES "StockMovement"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "mime" TEXT NOT NULL,
 "size" INTEGER NOT NULL,
 "data" BYTEA NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StockPhoto_pkey" PRIMARY KEY ("movementId"),
 CONSTRAINT "StockPhoto_mime" CHECK ("mime"='image/webp'),
 CONSTRAINT "StockPhoto_size" CHECK ("size" BETWEEN 1 AND 2097152)
);

CREATE TABLE "StockReview" (
 "id" TEXT NOT NULL,
 "sequence" SERIAL NOT NULL,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "movementId" TEXT NOT NULL REFERENCES "StockMovement"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "outcome" "StockReviewOutcome" NOT NULL,
 "note" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StockReview_pkey" PRIMARY KEY ("id"),
 -- Questioning and closing a question always carry the reviewer's note.
 CONSTRAINT "StockReview_note" CHECK ("outcome"='CONFERIDA' OR "note" IS NOT NULL)
);
CREATE UNIQUE INDEX "StockReview_sequence_key" ON "StockReview"("sequence");
CREATE INDEX "StockReview_movementId_sequence_idx" ON "StockReview"("movementId","sequence");

CREATE TABLE "StockAlert" (
 "id" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "itemId" TEXT NOT NULL REFERENCES "StockItem"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "openedByMovementId" TEXT REFERENCES "StockMovement"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "closedAt" TIMESTAMP(3),
 "closedByMovementId" TEXT REFERENCES "StockMovement"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestedById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestedAt" TIMESTAMP(3),
 CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);
-- At most one open alert per item: the minimum-stock warning fires once until the item is restocked.
CREATE UNIQUE INDEX "StockAlert_open_item" ON "StockAlert"("itemId") WHERE "closedAt" IS NULL;

CREATE TABLE "StockItemAudit" (
 "id" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "itemId" TEXT NOT NULL REFERENCES "StockItem"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "action" TEXT NOT NULL,
 "metadata" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StockItemAudit_pkey" PRIMARY KEY ("id")
);

-- Web Push outbox now has exactly one origin: a ticket event or a stock alert.
ALTER TABLE "PushDelivery" ALTER COLUMN "eventId" DROP NOT NULL;
ALTER TABLE "PushDelivery" ADD COLUMN "stockAlertId" TEXT REFERENCES "StockAlert"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_single_source" CHECK (num_nonnulls("eventId","stockAlertId") = 1);
CREATE UNIQUE INDEX "PushDelivery_stockAlertId_subscriptionId_key" ON "PushDelivery"("stockAlertId","subscriptionId");

CREATE OR REPLACE FUNCTION enforce_organization_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT; parent_company TEXT; other_org TEXT; category_team TEXT; movement_type TEXT;
BEGIN
 IF TG_TABLE_NAME IN ('User','Ticket','Category','Department','Company','Team',
   'StockItem','StockMovement','StockPhoto','StockReview','StockAlert','StockItemAudit') THEN
  org:=NEW."organizationId";
  IF TG_OP='UPDATE' AND OLD."organizationId" IS DISTINCT FROM org THEN
   RAISE EXCEPTION 'Organization is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='User' THEN
  PERFORM assert_org_reference(org,'Department',NEW."departmentId");
  PERFORM assert_org_reference(org,'Company',NEW."primaryCompanyId");
  PERFORM assert_org_reference(org,'Team',NEW."teamId");
  IF NEW."primaryUnitId" IS NOT NULL THEN
   SELECT "companyId" INTO parent_company FROM "Unit" WHERE id=NEW."primaryUnitId";
   IF parent_company IS DISTINCT FROM NEW."primaryCompanyId" THEN RAISE EXCEPTION 'Unit/company mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='Category' THEN
  PERFORM assert_org_reference(org,'Team',NEW."teamId");
  IF TG_OP='UPDATE' AND NEW."teamId" IS DISTINCT FROM OLD."teamId" THEN
   RAISE EXCEPTION 'Category team is immutable' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='Ticket' THEN
  PERFORM assert_org_reference(org,'User',NEW."requesterId");
  PERFORM assert_org_reference(org,'User',NEW."openedByUserId");
  PERFORM assert_org_reference(org,'User',NEW."assigneeId");
  PERFORM assert_org_reference(org,'Department',NEW."departmentId");
  PERFORM assert_org_reference(org,'Category',NEW."categoryId");
  PERFORM assert_org_reference(org,'Company',NEW."companyId");
  PERFORM assert_org_reference(org,'Team',NEW."teamId");
  IF NEW."categoryId" IS NOT NULL THEN
   SELECT "teamId" INTO category_team FROM "Category" WHERE id=NEW."categoryId";
   IF category_team IS DISTINCT FROM NEW."teamId" THEN RAISE EXCEPTION 'Team/category mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW."unitId" IS NOT NULL THEN
   SELECT "companyId" INTO parent_company FROM "Unit" WHERE id=NEW."unitId";
   IF parent_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'Unit/company mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='Unit' THEN
  IF TG_OP='UPDATE' AND NEW."companyId"<>OLD."companyId" THEN
   RAISE EXCEPTION 'Unit company is immutable; deactivate and create another unit' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME IN ('TicketEvent','TicketComment','TicketParticipant') THEN
  SELECT "organizationId" INTO org FROM "Ticket" WHERE id=NEW."ticketId";
  IF TG_TABLE_NAME='TicketEvent' THEN
   PERFORM assert_org_reference(org,'User',NEW."actorId");
   PERFORM assert_org_reference(org,'User',NEW."targetUserId");
   PERFORM assert_org_reference(org,'Category',NEW."previousCategoryId");
   PERFORM assert_org_reference(org,'Category',NEW."nextCategoryId");
  ELSIF TG_TABLE_NAME='TicketComment' THEN PERFORM assert_org_reference(org,'User',NEW."authorId");
  ELSE PERFORM assert_org_reference(org,'User',NEW."userId"); END IF;
 ELSIF TG_TABLE_NAME IN ('UserCompanyAccess','UserUnitAccess') THEN
  SELECT "organizationId" INTO org FROM "User" WHERE id=NEW."userId";
  IF TG_TABLE_NAME='UserCompanyAccess' THEN parent_company:=NEW."companyId";
  ELSE SELECT "companyId" INTO parent_company FROM "Unit" WHERE id=NEW."unitId"; END IF;
  PERFORM assert_org_reference(org,'Company',parent_company);
 ELSIF TG_TABLE_NAME='UserAudit' THEN
  SELECT "organizationId" INTO org FROM "User" WHERE id=NEW."actorId";
  PERFORM assert_org_reference(org,'User',NEW."subjectId");
 ELSIF TG_TABLE_NAME='StockItem' THEN
  PERFORM assert_org_reference(org,'Team',NEW."teamId");
  PERFORM assert_org_reference(org,'User',NEW."holderId");
 ELSIF TG_TABLE_NAME='StockMovement' THEN
  PERFORM assert_org_reference(org,'StockItem',NEW."itemId");
  PERFORM assert_org_reference(org,'User',NEW."actorId");
  PERFORM assert_org_reference(org,'User',NEW."targetUserId");
  PERFORM assert_org_reference(org,'Ticket',NEW."ticketId");
  PERFORM assert_org_reference(org,'StockMovement',NEW."reversesId");
  PERFORM assert_org_reference(org,'Team',NEW."itemTeamId");
  PERFORM assert_org_reference(org,'Team',NEW."actorTeamId");
  PERFORM assert_org_reference(org,'Team',NEW."ticketTeamId");
 ELSIF TG_TABLE_NAME IN ('StockPhoto','StockReview') THEN
  SELECT "organizationId", "type"::TEXT INTO other_org, movement_type FROM "StockMovement" WHERE id=NEW."movementId";
  IF other_org IS DISTINCT FROM org THEN RAISE EXCEPTION 'Organizational reference mismatch' USING ERRCODE='23514'; END IF;
  -- Authorization photos and their reviews exist only for off-ticket use.
  IF movement_type IS DISTINCT FROM 'USO_AVULSO' THEN
   RAISE EXCEPTION 'Stock authorization requires off-ticket use' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='StockReview' THEN PERFORM assert_org_reference(org,'User',NEW."actorId"); END IF;
 ELSIF TG_TABLE_NAME='StockAlert' THEN
  PERFORM assert_org_reference(org,'StockItem',NEW."itemId");
  PERFORM assert_org_reference(org,'StockMovement',NEW."openedByMovementId");
  PERFORM assert_org_reference(org,'StockMovement',NEW."closedByMovementId");
  PERFORM assert_org_reference(org,'User',NEW."requestedById");
 ELSIF TG_TABLE_NAME='StockItemAudit' THEN
  PERFORM assert_org_reference(org,'StockItem',NEW."itemId");
  PERFORM assert_org_reference(org,'User',NEW."actorId");
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "StockItem_organization_boundary" BEFORE INSERT OR UPDATE ON "StockItem" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "StockMovement_organization_boundary" BEFORE INSERT OR UPDATE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "StockPhoto_organization_boundary" BEFORE INSERT OR UPDATE ON "StockPhoto" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "StockReview_organization_boundary" BEFORE INSERT OR UPDATE ON "StockReview" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "StockAlert_organization_boundary" BEFORE INSERT OR UPDATE ON "StockAlert" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "StockItemAudit_organization_boundary" BEFORE INSERT OR UPDATE ON "StockItemAudit" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();

CREATE OR REPLACE FUNCTION enforce_push_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT; other_org TEXT;
BEGIN
 IF TG_TABLE_NAME='PushSubscription' THEN
  PERFORM assert_org_reference(NEW."organizationId",'User',NEW."userId");
  IF TG_OP='UPDATE' AND (NEW."organizationId"<>OLD."organizationId" OR NEW."userId"<>OLD."userId") THEN
   RAISE EXCEPTION 'Subscription owner is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW."eventId" IS NOT NULL THEN
   SELECT t."organizationId" INTO org FROM "TicketEvent" e JOIN "Ticket" t ON t.id=e."ticketId" WHERE e.id=NEW."eventId";
  ELSE
   SELECT "organizationId" INTO org FROM "StockAlert" WHERE id=NEW."stockAlertId";
  END IF;
  SELECT "organizationId" INTO other_org FROM "PushSubscription" WHERE id=NEW."subscriptionId";
  IF org IS DISTINCT FROM other_org THEN RAISE EXCEPTION 'Cross-organization push' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
