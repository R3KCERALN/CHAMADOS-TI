-- Tickets and categories belong to exactly one team. Legacy rows move to the organization's TI team.
BEGIN;
ALTER TYPE "EventType" ADD VALUE 'EQUIPE_ALTERADA';
ALTER TABLE "Ticket" ADD COLUMN "teamId" TEXT REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Category" ADD COLUMN "teamId" TEXT REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE "Ticket" SET "teamId"='team_' || md5("organizationId" || ':TI');
UPDATE "Category" SET "teamId"='team_' || md5("organizationId" || ':TI');
ALTER TABLE "Ticket" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "teamId" SET NOT NULL;
CREATE INDEX "Ticket_teamId_status_idx" ON "Ticket"("teamId", status);
CREATE INDEX "Ticket_teamId_createdAt_idx" ON "Ticket"("teamId", "createdAt");
CREATE INDEX "Category_teamId_idx" ON "Category"("teamId");
DROP INDEX "Category_organizationId_name_key";
DROP INDEX "Category_name_normalized_key";
CREATE UNIQUE INDEX "Category_teamId_name_key" ON "Category"("teamId", name);
CREATE UNIQUE INDEX "Category_teamId_name_normalized_key" ON "Category"("teamId", lower(trim(name)));
CREATE OR REPLACE FUNCTION enforce_organization_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT; parent_company TEXT; other_org TEXT; category_team TEXT;
BEGIN
 IF TG_TABLE_NAME IN ('User','Ticket','Category','Department','Company','Team') THEN
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
 END IF;
 RETURN NEW;
END $$;
COMMIT;
