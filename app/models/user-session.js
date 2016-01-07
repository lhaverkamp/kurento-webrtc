var WebSocket = require('ws');

/**
 * This class represents the caller and callee sessions
 * 
 * @param id
 * @param ws
 */
function UserSession(id, ws) {
	this.id = id;
	this.ws = ws;
	this.peer = null;
	this.sdpOffer = null;
};

UserSession.prototype.sendMessage = function(message) {
	// TODO this shouldn't be handled here
	if(this.ws.readyState == WebSocket.OPEN) {
		this.ws.send(JSON.stringify(message));
	}
};

module.exports = UserSession;