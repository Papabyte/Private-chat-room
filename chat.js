/*jslint node: true */
"use strict";
const async = require('async');
const eventBus = require('byteballcore/event_bus.js');
const headlessWallet = require('headless-byteball');
const conf = require('byteballcore/conf.js');
const randomCryptoString = require('./modules/random-crypto-string');
const db = require('byteballcore/db.js');

var assocPeers = [];


eventBus.on('paired', function(from_address, pairing_secret) {

	db.query("SELECT id FROM rooms WHERE pairing_secret=?", [pairing_secret], function(rooms) {

		db.takeConnectionFromPool(function(conn) {
			var arrQueries = [];
			conn.addQuery(arrQueries, "BEGIN");
			conn.addQuery(arrQueries, "INSERT OR REPLACE INTO users (device_address, name, current_room) VALUES (?,(SELECT name FROM correspondent_devices WHERE device_address=?),?)", [from_address, from_address, (rooms[0] ? rooms[0].id : 0)]);
			if (rooms[0])
				conn.addQuery(arrQueries, "INSERT OR IGNORE INTO allowed_access (device_address,room) VALUES (?,?)", [from_address, rooms[0].id]);
			conn.addQuery(arrQueries, "COMMIT");
			async.series(arrQueries, function() {
				conn.release();
				if (rooms[0]) {
					var device = require('byteballcore/device.js');
					db.query("SELECT device_address,(SELECT name FROM users WHERE device_address=?) AS name FROM users WHERE current_room = ? AND device_address!=?", [from_address, rooms[0].id,from_address], function(rows) {
						rows.forEach(function(row) {
							device.sendMessageToDevice(row.device_address, 'text', row.name + " has joined your room");
						});
					});

				}

				return returnHelpMenu(from_address, (rooms[0] ? rooms[0].id : 0));
			});
		});

	});

});


eventBus.on('text', function(from_address, text) {
	processTxt(from_address, text);
});

function returnHelpMenu(from_address, currentRoom) {
	var device = require('byteballcore/device.js');
	var returnedTxt = "Welcome to the private room chat bot.";

	db.query("SELECT rooms.id AS room_id, rooms.name AS room_name FROM rooms WHERE id=?", [currentRoom], function(rows) {
		if (rows[0] && currentRoom > 0) {
			returnedTxt += "\nYou are actually connected to room " + rows[0].room_name + " (id " + currentRoom + ")";
			returnedTxt += "\nThe text that you type will be sent to every member of this room.";
		} else {
			returnedTxt += "\nYou are not connected to any room.";
		}

		db.query("SELECT rooms.name AS name,rooms.id AS id FROM allowed_access INNER JOIN rooms ON rooms.id = allowed_access.room  WHERE device_address=?", [from_address], function(rooms) {

			if (rooms.length > 1)
				returnedTxt += "\n\nYou can connect to these rooms:"
			rooms.forEach(function(room) {
				if (room.id != currentRoom)
					returnedTxt += "\n " + room.name + " ➡ " + getTxtCommandButton("connect", "connect_" + room.id);
			});

			returnedTxt += "\n\nAt any time:"
			returnedTxt += "\nType " + getTxtCommandButton("help") + " to return to this menu";
			returnedTxt += "\nType " + getTxtCommandButton("changeName") + " to change your name";
			returnedTxt += "\nType " + getTxtCommandButton("createRoom") + " to create a new room";

			returnedTxt += "\nThe bot operator has the technical possibility to see your conversation. To converse privately with your friend, better run the bot by yourself.\nhttps://github.com/Papabyte/Private-chat-room \nFork it and improve it!";
			device.sendMessageToDevice(from_address, 'text', returnedTxt);
		});

	});

}


function processTxt(from_address, text) {
	text = text.trim();
	if (!assocPeers[from_address]) {
		assocPeers[from_address] = {
			step: "home"
		};
	}

	db.query("SELECT * FROM users WHERE device_address=?", [from_address], function(users) {

		if (text == "help" || !users[0])
			return returnHelpMenu(from_address, (users[0] ? users[0].current_room : 0));

		if (text == "createRoom" || assocPeers[from_address].step == "waitingForRoomName") {
			return createRoom(from_address, text);
		}

		if (text == "changeName" || assocPeers[from_address].step == "waitingForName") {
			return changeName(from_address, text, users[0].name, users[0].current_room);
		}

		if (text.indexOf("connect_") > -1) {

			return connectToRoom(from_address, Number(text.split("_")[1]));

		}

		if (users[0].current_room === 0 || text == "administrationMenu" || assocPeers[from_address].administrationMenu)
			return returnAdministrationMenu(from_address);

		if (users[0].current_room > 0)
			return sendToRoom(from_address, users[0].current_room, users[0].name, text);

	});
}

function connectToRoom(from_address, roomID) {
	var device = require('byteballcore/device.js');

	db.query("SELECT rooms.name AS room_name FROM allowed_access INNER JOIN rooms ON allowed_access.room=rooms.id WHERE device_address=? AND room=?", [from_address, roomID], function(rows) {
		if (rows[0]) {
			db.query("UPDATE users SET current_room=? WHERE device_address=?", [roomID, from_address], function() {
				return device.sendMessageToDevice(from_address, 'text', "You switched to room " + rows[0].room_name);
			});
		} else {
			return device.sendMessageToDevice(from_address, 'text', "You're not allowed to access this room");
		}
	});

}


function changeName(from_address, text, previousName, currentRoom) {
	var device = require('byteballcore/device.js');

	if (assocPeers[from_address].step == "waitingForName") {
		if (text.length <= 20) {
			db.query("UPDATE users SET name=? WHERE device_address=?", [text, from_address], function() {
				db.query("SELECT device_address FROM users WHERE current_room = ?", [currentRoom], function(rows) {
					rows.forEach(function(row) {
						device.sendMessageToDevice(row.device_address, 'text', previousName + " changed name for " + text);
					});
				});

				return assocPeers[from_address].step = "home";
			});
		} else {
			return device.sendMessageToDevice(from_address, 'text', "Max 20 characters, try again");
		}
		return;
	}
	device.sendMessageToDevice(from_address, 'text', "Enter your new name");
	return assocPeers[from_address].step = "waitingForName";


}

function createRoom(from_address, text) {
	var device = require('byteballcore/device.js');
	if (assocPeers[from_address].step == "waitingForRoomName") {
		var pairingSecret = randomCryptoString.generateByLengthSync(20);
		db.takeConnectionFromPool(function(conn) {
			var arrQueries = [];
			conn.addQuery(arrQueries, "BEGIN");
			conn.addQuery(arrQueries, "INSERT INTO rooms (name, admin, pairing_secret) VALUES (?,?,?)", [text, from_address, pairingSecret]);
			conn.addQuery(arrQueries, "INSERT INTO allowed_access (room, device_address) VALUES ((SELECT MAX(id) FROM rooms),?)", [from_address]);
			conn.addQuery(arrQueries, "INSERT INTO pairing_secrets (pairing_secret, is_permanent, expiry_date) VALUES (?,1, '2100-01-01 00:00:0')", [pairingSecret]);
			conn.addQuery(arrQueries, "UPDATE users SET current_room=(SELECT MAX(id) FROM rooms) WHERE device_address=?", [from_address]);
			conn.addQuery(arrQueries, "COMMIT");
			async.series(arrQueries, function() {
				conn.release();
				device.sendMessageToDevice(from_address, 'text', "Room created, you are now connected to it. Invite people to this room by giving them this pairing code: " + device.getMyDevicePubKey() + "@" + conf.hub + "#" + pairingSecret);
				return assocPeers[from_address].step = "home";
			});
		});
		return;
	}
	device.sendMessageToDevice(from_address, 'text', "Enter a name for your private chat room");
	return assocPeers[from_address].step = "waitingForRoomName";

}


function sendToRoom(from_address, roomId, name, text) {
	var device = require('byteballcore/device.js');

	db.query("SELECT device_address FROM users WHERE current_room = ?", [roomId], function(rows) {
		rows.forEach(function(row) {
			device.sendMessageToDevice(row.device_address, 'text', name + " (" + from_address.slice(0, 5) + "): " + text);
		});

	});


}

function getTxtCommandButton(label, command) {
	var text = "";
	var _command = command ? command : label;
	text += "[" + label + "]" + "(command:" + _command + ")";
	return text;
}