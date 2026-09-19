BEGIN;
ALTER TABLE "Organization" ADD COLUMN "ticketRevision" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "ticketRevision" BIGINT NOT NULL DEFAULT 0;
CREATE FUNCTION bump_ticket_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT; requester TEXT;
BEGIN
 SELECT "organizationId", "requesterId" INTO org, requester FROM "Ticket" WHERE id=NEW."ticketId";
 UPDATE "Organization" SET "ticketRevision"="ticketRevision"+1 WHERE id=org;
 UPDATE "User" SET "ticketRevision"="ticketRevision"+1 WHERE id=requester;
 RETURN NEW;
END $$;
CREATE TRIGGER "TicketEvent_revision" AFTER INSERT ON "TicketEvent" FOR EACH ROW EXECUTE FUNCTION bump_ticket_revision();
CREATE TABLE "PushSubscription" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT,
 "endpoint" TEXT NOT NULL, "endpointHash" TEXT NOT NULL UNIQUE,
 "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL, "sessionHash" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PushSubscription_organizationId_userId_active_idx" ON "PushSubscription"("organizationId","userId","active");
CREATE INDEX "PushSubscription_sessionHash_idx" ON "PushSubscription"("sessionHash");
CREATE TABLE "PushDelivery" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL REFERENCES "TicketEvent"(id) ON DELETE RESTRICT,
 "subscriptionId" TEXT NOT NULL REFERENCES "PushSubscription"(id) ON DELETE CASCADE,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENT','FAILED','CANCELLED')),
 "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts">=0),
 "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseToken" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "finishedAt" TIMESTAMP(3), "lastStatus" INTEGER,
 UNIQUE ("eventId","subscriptionId")
);
CREATE INDEX "PushDelivery_status_availableAt_idx" ON "PushDelivery"("status","availableAt");
CREATE INDEX "PushDelivery_createdAt_idx" ON "PushDelivery"("createdAt");
CREATE FUNCTION enforce_push_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT; other_org TEXT;
BEGIN
 IF TG_TABLE_NAME='PushSubscription' THEN
  PERFORM assert_org_reference(NEW."organizationId",'User',NEW."userId");
  IF TG_OP='UPDATE' AND (NEW."organizationId"<>OLD."organizationId" OR NEW."userId"<>OLD."userId") THEN
   RAISE EXCEPTION 'Subscription owner is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT t."organizationId" INTO org FROM "TicketEvent" e JOIN "Ticket" t ON t.id=e."ticketId" WHERE e.id=NEW."eventId";
  SELECT "organizationId" INTO other_org FROM "PushSubscription" WHERE id=NEW."subscriptionId";
  IF org IS DISTINCT FROM other_org THEN RAISE EXCEPTION 'Cross-organization push' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PushSubscription_boundary" BEFORE INSERT OR UPDATE ON "PushSubscription" FOR EACH ROW EXECUTE FUNCTION enforce_push_boundary();
CREATE TRIGGER "PushDelivery_boundary" BEFORE INSERT OR UPDATE ON "PushDelivery" FOR EACH ROW EXECUTE FUNCTION enforce_push_boundary();
COMMIT;
