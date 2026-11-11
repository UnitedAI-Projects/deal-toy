-- Which model answered each built-in agent turn (src/shared/agent-models.ts); NULL before 0014.
ALTER TABLE agent_turns ADD COLUMN model TEXT;
