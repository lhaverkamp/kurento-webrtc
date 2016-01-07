function Room(name) {
	this.name = name;
	this.users = [];
};

Room.prototype.add = function(user) {
	this.users.push(user);
};

Room.prototype.remove = function(user) {
	if(this.users && this.users[user]) {
		delete this.users[user];
	}
};

Room.prototype.user = function(i) {
	return this.users[i];
};

Room.prototype.size = function() {
	return this.users.length;
};

module.exports = Room;