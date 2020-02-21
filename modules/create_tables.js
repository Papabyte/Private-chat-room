/*jslint node: true */
"use strict";
const db = require('ocore/db.js');


db.query("CREATE TABLE IF NOT EXISTS users (  \n\
	device_address CHAR(33) PRIMARY KEY, \n\
	name, \n\
	current_room INTEGER DEFAULT 0, -- 0 is the administration room \n\
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address) \n\
);");

db.query("CREATE TABLE IF NOT EXISTS rooms (\n\
	id INTEGER PRIMARY KEY AUTOINCREMENT,\n\
	name,\n\
	admin CHAR(33),\n\
	pairing_secret CHAR(20)\n\
);");

db.query("CREATE TABLE IF NOT EXISTS allowed_access ( \n\
	room INTEGER, \n\
	device_address CHAR(33), \n\
	UNIQUE(room, device_address), \n\
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address) \n\
);");



