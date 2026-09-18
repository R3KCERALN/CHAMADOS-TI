CREATE TYPE "Complexity" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA');
ALTER TYPE "EventType" ADD VALUE 'CATEGORIA_ALTERADA';
ALTER TYPE "EventType" ADD VALUE 'COMPLEXIDADE_ALTERADA';
CREATE TABLE "Category" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
CREATE UNIQUE INDEX "Category_name_normalized_key" ON "Category"(lower(trim("name")));
ALTER TABLE "Ticket" ADD COLUMN "categoryId" TEXT, ADD COLUMN "complexity" "Complexity";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketEvent" ADD COLUMN "previousCategoryId" TEXT, ADD COLUMN "nextCategoryId" TEXT,
  ADD COLUMN "previousComplexity" "Complexity", ADD COLUMN "nextComplexity" "Complexity";
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_previousCategoryId_fkey" FOREIGN KEY ("previousCategoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_nextCategoryId_fkey" FOREIGN KEY ("nextCategoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");
CREATE INDEX "Ticket_resolvedAt_idx" ON "Ticket"("resolvedAt");
CREATE INDEX "Ticket_categoryId_createdAt_idx" ON "Ticket"("categoryId", "createdAt");
CREATE INDEX "Ticket_complexity_createdAt_idx" ON "Ticket"("complexity", "createdAt");
CREATE INDEX "Ticket_departmentId_createdAt_idx" ON "Ticket"("departmentId", "createdAt");
CREATE INDEX "Ticket_assigneeId_resolvedAt_idx" ON "Ticket"("assigneeId", "resolvedAt");
CREATE INDEX "TicketEvent_ticketId_sequence_idx" ON "TicketEvent"("ticketId", "sequence");
CREATE INDEX "TicketEvent_targetUserId_type_createdAt_idx" ON "TicketEvent"("targetUserId", "type", "createdAt");
CREATE INDEX "TicketEvent_previousCategoryId_idx" ON "TicketEvent"("previousCategoryId");
CREATE INDEX "TicketEvent_nextCategoryId_idx" ON "TicketEvent"("nextCategoryId");
