-- Item 32: room labels for devices
ALTER TABLE ha_devices ADD COLUMN room TEXT NOT NULL DEFAULT '';
ALTER TABLE smart_devices ADD COLUMN room TEXT NOT NULL DEFAULT '';
