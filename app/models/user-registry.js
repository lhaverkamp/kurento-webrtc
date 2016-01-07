/**
 * This class represents the registrar of users.
 */
function UserRegistry() {
	this.ids = {};
};

UserRegistry.prototype.register = function(user) {
	this.ids[user.id] = user;
};

UserRegistry.prototype.unregister = function(id) {
	var user = this.getById(id);
	
	if(user) {
		delete this.ids[id];
	}
};

UserRegistry.prototype.getById = function(id) {
	return this.ids[id];
};

// TODO need to adjust usage in other parts so 'new' isn't required here
// this is to make this a singleton across the entire application
module.exports = new UserRegistry();