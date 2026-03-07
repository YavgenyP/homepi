-- Item: explicit remote entity ID for HA devices (avoids fragile media_player.* → remote.* derivation)
ALTER TABLE ha_devices ADD COLUMN remote_entity_id TEXT NOT NULL DEFAULT '';
