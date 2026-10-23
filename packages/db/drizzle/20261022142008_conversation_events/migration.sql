-- Live conversation events (D25): every write of a person's message or a
-- run's status, from any process or job, notifies `conversation_events` on
-- commit. The web process LISTENs and forwards each one to the chat's open
-- `GET /conversations/{id}/events` streams. The payload is
-- `{ conversationId, event }`, with `event` a contract `ConversationEvent`.
CREATE FUNCTION "notify_conversation_event"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'message' THEN
    PERFORM pg_notify('conversation_events', json_build_object(
      'conversationId', NEW.conversation_id,
      'event', json_build_object('type', 'message', 'messageId', NEW.id, 'authorId', NEW.author_id)
    )::text);
  ELSE
    PERFORM pg_notify('conversation_events', json_build_object(
      'conversationId', NEW.conversation_id,
      'event', json_build_object('type', 'run', 'runId', NEW.id, 'status', NEW.status)
    )::text);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "message_conversation_event" AFTER INSERT ON "message"
  FOR EACH ROW WHEN (NEW.role = 'user') EXECUTE FUNCTION "notify_conversation_event"();--> statement-breakpoint
CREATE TRIGGER "run_conversation_event_insert" AFTER INSERT ON "run"
  FOR EACH ROW EXECUTE FUNCTION "notify_conversation_event"();--> statement-breakpoint
CREATE TRIGGER "run_conversation_event_status" AFTER UPDATE OF "status" ON "run"
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION "notify_conversation_event"();
