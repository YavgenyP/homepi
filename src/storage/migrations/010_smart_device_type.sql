-- Add device_type column to smart_devices for UI widget selection
ALTER TABLE smart_devices ADD COLUMN device_type TEXT NOT NULL DEFAULT 'switch';
