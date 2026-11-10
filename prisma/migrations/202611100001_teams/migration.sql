-- Additive migration. Every organization gets the TI and Elétrica teams; legacy technicians stay in TI.
BEGIN;
CREATE TABLE "Team" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "key" TEXT NOT NULL CHECK ("key" IN ('TI','ELETRICA')), "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","key")
);
INSERT INTO "Team" (id,"organizationId","key",name)
SELECT 'team_' || md5(o.id || ':' || t.key), o.id, t.key, t.name
FROM "Organization" o CROSS JOIN (VALUES ('TI','TI'),('ELETRICA','Elétrica')) AS t(key,name);
CREATE FUNCTION create_organization_teams() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "Team" (id,"organizationId","key",name)
 SELECT 'team_' || md5(NEW.id || ':' || t.key), NEW.id, t.key, t.name
 FROM (VALUES ('TI','TI'),('ELETRICA','Elétrica')) AS t(key,name);
 RETURN NEW;
END $$;
CREATE TRIGGER "Organization_create_teams" AFTER INSERT ON "Organization" FOR EACH ROW EXECUTE FUNCTION create_organization_teams();
ALTER TABLE "User" ADD COLUMN "teamId" TEXT REFERENCES "Team"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_teamId_idx" ON "User"("teamId");
UPDATE "User" u SET "teamId"='team_' || md5(u."organizationId" || ':TI') WHERE u.role='TI';
ALTER TABLE "User" ADD CONSTRAINT "User_technician_team" CHECK ((role='TI') = ("teamId" IS NOT NULL));
CREATE OR REPLACE FUNCTION enforce_organization_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT; parent_company TEXT; other_org TEXT;
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
CREATE TRIGGER "Team_organization_boundary" BEFORE INSERT OR UPDATE ON "Team" FOR EACH ROW EXECUTE FUNCTION enforce_organization_boundary();
COMMIT;
