/**
 * This class represents the registrar of users.
 */
function UserRegistry() {
	this.ids = {};
	this.names = {};
};

UserRegistry.prototype.register = function(user) {
	this.ids[user.id] = user;
	this.names[user.name] = user;
};

UserRegistry.prototype.unregister = function(id) {
	var user = this.getById(id);
	
	if(user) {
		delete this.ids[id];
	}
	
	if(user && this.getByName(user.name)) {
		delete this.names[user.name];
	}
};

UserRegistry.prototype.getById = function(id) {
	return this.ids[id];
};

UserRegistry.prototype.getByName = function(name) {
	return this.names[name];
};

// TODO need to adjust usage in other parts so 'new' isn't required here
// this is to make this a singleton across the entire application
module.exports = new UserRegistry();