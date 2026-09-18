-- Additive migration. Existing locations remain unknown; no companies are guessed.
BEGIN;
ALTER TYPE "EventType" ADD VALUE 'LOCALIZACAO_ALTERADA';
CREATE TABLE "Organization" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('initial-organization','Organização inicial',CURRENT_TIMESTAMP);
CREATE TABLE "Company" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "displayName" TEXT NOT NULL, "legalName" TEXT, "cnpj" TEXT NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
 "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Unit" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "name" TEXT NOT NULL, "code" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT, ADD COLUMN "primaryCompanyId" TEXT REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "primaryUnitId" TEXT REFERENCES "Unit"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Department" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Category" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "organizationId" TEXT, ADD COLUMN "companyId" TEXT REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "unitId" TEXT REFERENCES "Unit"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "openedByUserId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "requesterName" TEXT, ALTER COLUMN "requesterId" DROP NOT NULL, ALTER COLUMN "departmentId" DROP NOT NULL;
UPDATE "User" SET "organizationId"='initial-organization';
UPDATE "Department" SET "organizationId"='initial-organization';
UPDATE "Category" SET "organizationId"='initial-organization';
UPDATE "Ticket" t SET "organizationId"='initial-organization', "requesterName"=u.name FROM "User" u WHERE u.id=t."requesterId";
UPDATE "Ticket" t SET "openedByUserId"=(SELECT e."actorId" FROM "TicketEvent" e WHERE e."ticketId"=t.id AND e.type='CRIADO' ORDER BY e.sequence LIMIT 1);
ALTER TABLE "Ticket" ALTER COLUMN "requesterName" SET NOT NULL,
 ADD CONSTRAINT "Ticket_requester_identity" CHECK (length(trim("requesterName"))>0),
 ADD CONSTRAINT "Ticket_unit_requires_company" CHECK ("unitId" IS NULL OR "companyId" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_unit_requires_company" CHECK ("primaryUnitId" IS NULL OR "primaryCompanyId" IS NOT NULL);
CREATE TABLE "UserCompanyAccess" (
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 PRIMARY KEY ("userId","companyId")
);
CREATE TABLE "UserUnitAccess" (
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "unitId" TEXT NOT NULL REFERENCES "Unit"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 PRIMARY KEY ("userId","unitId")
);
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL, ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Department" ALTER COLUMN "organizationId" SET NOT NULL, ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Category" ALTER COLUMN "organizationId" SET NOT NULL, ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ALTER COLUMN "organizationId" SET NOT NULL, ADD CONSTRAINT "Ticket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Company_organizationId_cnpj_key" ON "Company"("organizationId","cnpj");
CREATE UNIQUE INDEX "Unit_companyId_name_key" ON "Unit"("companyId","name");
CREATE UNIQUE INDEX "Category_organizationId_name_key" ON "Category"("organizationId","name");
CREATE UNIQUE INDEX "Department_organizationId_name_key" ON "Department"("organizationId","name");
DROP INDEX "Category_name_key";
DROP INDEX "Category_name_normalized_key";
DROP INDEX "Department_name_key";
CREATE UNIQUE INDEX "Category_name_normalized_key" ON "Category"("organizationId",lower(trim(name)));
CREATE INDEX "Company_organizationId_active_idx" ON "Company"("organizationId","active");
CREATE INDEX "UserCompanyAccess_companyId_idx" ON "UserCompanyAccess"("companyId");
CREATE INDEX "UserUnitAccess_unitId_idx" ON "UserUnitAccess"("unitId");
CREATE INDEX "User_organizationId_role_active_idx" ON "User"("organizationId","role","active");
CREATE INDEX "User_primaryCompanyId_idx" ON "User"("primaryCompanyId");
CREATE INDEX "User_primaryUnitId_idx" ON "User"("primaryUnitId");
CREATE INDEX "Ticket_organizationId_createdAt_idx" ON "Ticket"("organizationId","createdAt");
CREATE INDEX "Ticket_organizationId_resolvedAt_idx" ON "Ticket"("organizationId","resolvedAt");
CREATE INDEX "Ticket_organizationId_status_idx" ON "Ticket"("organizationId","status");
CREATE INDEX "Ticket_companyId_createdAt_idx" ON "Ticket"("companyId","createdAt");
CREATE INDEX "Ticket_unitId_createdAt_idx" ON "Ticket"("unitId","createdAt");
CREATE INDEX "Ticket_openedByUserId_idx" ON "Ticket"("openedByUserId");
-- Tenant boundaries are also enforced for direct writes, without duplicating tenant IDs on child tables.
CREATE FUNCTION assert_org_reference(org TEXT, target_table TEXT, target_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE target_org TEXT;
BEGIN
 IF target_id IS NULL THEN RETURN; END IF;
 EXECUTE format('SELECT "organizationId" FROM %I WHERE id=$1',target_table) INTO target_org USING target_id;
 IF target_org IS DISTINCT FROM org THEN RAISE EXCEPTION 'Organizational reference mismatch' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION enforce_organization_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT; parent_company TEXT; other_org TEXT;
BEGIN
 IF TG_TABLE_NAME IN ('User','Ticket','Category','Department','Company') THEN
  org:=NEW."organizationId";
  IF TG_OP='UPDATE' AND OLD."organizationId" IS DISTINCT FROM org THEN
   RAISE EXCEPTION 'Organization is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='User' THEN
  PERFORM assert_org_reference(org,'Department',NEW."departmentId");
  PERFORM assert_org_reference(org,'Company',NEW."primaryCompanyId");
  IF NEW."primaryUnitId" IS NOT NULL THEN
   SELECT "companyId" INTO parent_company FROM "Unit" WHERE id=NEW."primaryUnitId";
   IF parent_company IS DISTINCT FROM NEW."primaryCompanyId" THEN RAISE EXCEPTION 'Unit/company mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='Ticket' THEN
  PERFORM assert_org_reference(org,'User',NEW."requesterId");
  PERFORM assert_org_reference(org,'User',NEW."openedByUserId");
  PERFORM assert_org_reference(org,'User',NEW."assigneeId");
  PERFORM assert_org_reference(org,'Department',NEW."departmentId");
  PERFORM assert_org_reference(org,'Category',NEW."categoryId");
  PERFORM assert_org_reference(org,'Company',NEW."companyId");
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
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "User_organization_boundary" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "Ticket_organization_boundary" BEFORE INSERT OR UPDATE ON "Ticket" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "Category_organization_boundary" BEFORE INSERT OR UPDATE ON "Category" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "Department_organization_boundary" BEFORE INSERT OR UPDATE ON "Department" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "Company_organization_boundary" BEFORE INSERT OR UPDATE ON "Company" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "Unit_organization_boundary" BEFORE INSERT OR UPDATE ON "Unit" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "TicketEvent_organization_boundary" BEFORE INSERT OR UPDATE ON "TicketEvent" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "TicketComment_organization_boundary" BEFORE INSERT OR UPDATE ON "TicketComment" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "TicketParticipant_organization_boundary" BEFORE INSERT OR UPDATE ON "TicketParticipant" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "UserCompanyAccess_organization_boundary" BEFORE INSERT OR UPDATE ON "UserCompanyAccess" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "UserUnitAccess_organization_boundary" BEFORE INSERT OR UPDATE ON "UserUnitAccess" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
CREATE TRIGGER "UserAudit_organization_boundary" BEFORE INSERT OR UPDATE ON "UserAudit" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
COMMIT;
