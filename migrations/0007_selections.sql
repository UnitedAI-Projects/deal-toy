-- What each member has selected in a model's viewer, so the agent's summary can name it.
CREATE TABLE selections (
  model_id TEXT NOT NULL REFERENCES models(id),
  member TEXT NOT NULL,
  refs TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(model_id, member)
);
