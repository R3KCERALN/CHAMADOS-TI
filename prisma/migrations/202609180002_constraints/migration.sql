ALTER TABLE "User" ADD CONSTRAINT "username_normalized" CHECK ("username" ~ '^[a-z0-9._-]{3,40}$');
ALTER TABLE "Ticket" ADD CONSTRAINT "waiting_reason_matches_status" CHECK (("status" = 'AGUARDANDO' AND "waitingReason" IS NOT NULL) OR ("status" <> 'AGUARDANDO' AND "waitingReason" IS NULL AND "waitingNote" IS NULL));
ALTER TABLE "Ticket" ADD CONSTRAINT "assignment_matches_status" CHECK (("status" = 'NOVO' AND "assigneeId" IS NULL AND "startedAt" IS NULL) OR ("status" <> 'NOVO' AND "assigneeId" IS NOT NULL AND "startedAt" IS NOT NULL));
ALTER TABLE "Ticket" ADD CONSTRAINT "resolution_matches_status" CHECK (("status" = 'RESOLVIDO' AND "resolvedAt" IS NOT NULL) OR ("status" <> 'RESOLVIDO' AND "resolvedAt" IS NULL));
ALTER TABLE "Ticket" ADD CONSTRAINT "description_length" CHECK (length(trim("description")) BETWEEN 5 AND 5000);
ALTER TABLE "TicketComment" ADD CONSTRAINT "comment_length" CHECK (length(trim("content")) BETWEEN 1 AND 3000);
