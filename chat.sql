CREATE TABLE users (
	device_address CHAR(33) PRIMARY KEY,
	name,
	current_room INTEGER DEFAULT 0, -- 0 is the administration room
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
);

CREATE TABLE rooms (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name,
	admin CHAR(33),
	pairing_secret CHAR(20)
);

CREATE TABLE allowed_access (
	room INTEGER,
	device_address CHAR(33),
	UNIQUE(room, device_address),
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
);