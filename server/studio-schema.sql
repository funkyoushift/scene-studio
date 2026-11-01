CREATE TABLE IF NOT EXISTS studio_auth (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, proof TEXT NOT NULL, identity TEXT, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS studio_auth_expiry ON studio_auth(expires);
CREATE TABLE IF NOT EXISTS channel_scenes (channel TEXT PRIMARY KEY, revision INTEGER NOT NULL, scene TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS channel_scene_history (channel TEXT NOT NULL, revision INTEGER NOT NULL, scene TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(channel, revision));
CREATE TRIGGER IF NOT EXISTS channel_scene_insert AFTER INSERT ON channel_scenes BEGIN
 INSERT INTO channel_scene_history VALUES (NEW.channel, NEW.revision, NEW.scene, NEW.updated);
END;
CREATE TRIGGER IF NOT EXISTS channel_scene_update AFTER UPDATE ON channel_scenes BEGIN
 INSERT INTO channel_scene_history VALUES (NEW.channel, NEW.revision, NEW.scene, NEW.updated);
 DELETE FROM channel_scene_history WHERE channel=NEW.channel AND revision <= NEW.revision-20;
END;
