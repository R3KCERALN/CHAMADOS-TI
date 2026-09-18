ALTER TABLE "TicketEvent" ADD COLUMN "sequence" SERIAL NOT NULL;
CREATE UNIQUE INDEX "TicketEvent_sequence_key" ON "TicketEvent"("sequence");
