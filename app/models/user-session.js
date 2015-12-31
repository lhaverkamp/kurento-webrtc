/**
 * This class represents the caller and callee sessions
 * 
 * @param id
 * @param name
 * @param ws
 */
function UserSession(id, name, ws) {
	this.id = id;
	this.name = name;
	this.ws = ws;
	this.peer = null;
	this.sdpOffer = null;
};

UserSession.prototype.sendMessage = function(message) {
	this.ws.send(JSON.stringify(message));
};

module.exports = UserSession;