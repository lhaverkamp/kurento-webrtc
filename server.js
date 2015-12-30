/* required libraries */
var path = require('path');
var express = require('express');
var minimist = require('minimist');
var url = require('url');
var ws = require('ws');
var kurento = require('kurento-client');

/* command line arguments */
var argv = minimist(process.argv.slice(2), {
	default: {
		asUri: 'https://localhost:8443',
		wsUri: 'ws://localhost:8888/kurento'
	}
});

/* application */
var app = express();
app.use(express.static(path.join(__dirname, 'static')));

/* Global Variables */
var kurentoClient = null;
var userRegistry = new UserRegistry();
var pipelines = {};
var idCounter = 0;

function nextUniqueId() {
	idCounter++;
	
	return idCounter.toString();
}

/** 
 * This class represents the caller and callee sessions
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

function CallMediaPipeline() {
	this._pipeline = null;
	this._callerWebRtcEndpoint = null;
	this._calleeWebRtcEndpoint = null;
};

CallMediaPipeline.prototype.createPipeline = function(callback) {
	var self = this;
	getKurentoClient(function(error, kurentoCLient) {
		if(error) {
			return callback(error);
		}
		
		kurentoClient.create('MediaPipeline', function(error, pipeline) {
			if(error) {
				return callback(error);
			}
			
			pipeline.create('WebRtcEndpoint', function(error, callerWebRtcEndpoint) {
				if(error) {
					pipeline.release();
					
					return callback(error);
				}
				
				pipeline.create('WebRtcEndpoint', function(error, calleeWebRtcEndpoint) {
					if(error) {
						pipeline.release();
						
						return callback(error);
					}
					
					callerWebRtcEndpoint.connect(calleeWebRtcEndpoint, function(error) {
						if(error) {
							pipeline.release();
							
							return callback(error);
						}

						calleeWebRtcEndpoint.connect(callerWebRtcEndpoint, function(error) {
							if(error) {
								pipeline.release();
								
								return callback(error);
							}
						});
						
						self._pipeline = pipeline;
						self._callerWebRtcEndpoint = callerWebRtcEndpoint;
						self._calleeWebRtcEndpoint = calleeWebRtcEndpoint;
					
						callback(null);
					});
				});
			});
		});
	});
};

CallMediaPipeline.prototype.generateSdpAnswerForCaller = function(sdpOffer, callback) {
	this._callerWebRtcEndpoint.processOffer(sdpOffer, callback);
};

CallMediaPipeline.prototype.generateSdpAnswerForCallee = function(sdpOffer, callback) {
	this._calleeWebRtcEndpoint.processOffer(sdpOffer, callback);
};

CallMediaPipeline.prototype.release = function() {
	if(this._pipeline) {
		this._pipeline.release();
	};
	
	this._pipeline = null;
};


var asUrl = url.parse(argv.asUri);
var port = asUrl.port;
var server = app.listen(port, function() {
	console.log('WebRTC Server Started');
	console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
	server : server,
	path : '/webrtc'
});

wss.on('connection', function(ws) {
	var sessionId = nextUniqueId();

	console.log('Connection received with sessionId ' + sessionId);

	ws.on('error', function(error) {
		console.log('Connection ' + sessionId + ' error');
		stop(sessionId);
	});

	ws.on('close', function() {
		console.log('Connection ' + sessionId + ' closed');		
		stop(sessionId);
		userRegistry.unregister(sessionId);
	});

	ws.on('message', function(_message) {
		var message = JSON.parse(_message);
		console.log('Connection ' + sessionId + ' received message ', message);

		switch (message.id) {
		case 'register':
			register(sessionId, message.name, ws);
			break;

		case 'call':
			call(sessionId, message.to, message.from, message.sdpOffer);
			break;

		case 'incomingCallResponse':
			incomingCallResponse(sessionId, message.from, message.callResponse, message.sdpOffer);
			break;
		
		case 'stop':
			stop(sessionId);
			break;

		default:
			ws.send(JSON.stringify({
				id : 'error',
				message : 'Invalid message ' + message
			}));
			break;
		}
	});
});

function register(id, name, ws, callback) {
	function onError(error) {
		console.log("Error processing register: " + error);
		
		ws.send(JSON.stringify({
			id: 'registerResponse',
			response: 'rejected',
			message: error
		}));
	};
	
	if(!name) {
		return onError("empty username");
	}
	
	if(userRegistry.getByName(name)) {
		return onError("username already registered");
	}
	
	userRegistry.register(new UserSession(id, name, ws));
	
	try {
		ws.send(JSON.stringify({
			id: 'registerResponse',
			response: 'accepted'
		}));
	} catch(exception) {
		onError(exception);
	}
};

function call(callerId, to, from, sdpOffer) {
	var caller = userRegistry.getById(callerId);
	var rejectCause = 'user ' + to + ' is not registered';
	
	if(userRegistry.getByName(to)) {
		var callee = userRegistry.getByName(to);
		caller.sdpOffer = sdpOffer;
		callee.peer = from;
		caller.peer = to;
		
		var message = {
			id: 'incomingCall',
			from: from
		};
		
		try {
			return callee.sendMessage(message);
		} catch(exception) {
			rejectCause = "Error " + exception;
		}
	}
	
	var message = {
		id: 'callResponse',
		response: 'rejected',
		message: rejectCause
	};
	
	caller.sendMessage(message);
};

function incomingCallResponse(calleeId, from, callResponse, calleeSdp) {
	function onError(callerReason, calleeReason) {
		if(pipeline) {
			pipeline.release();
		}
		
		if(caller) {
			var callerMessage = {
				id: 'callResponse',
				response: 'rejected'
			}
			
			if(callerReason) {
				callerMessage.message = callerReason;
			}
			
			caller.sendMessage(callerMessage);
		}
		
		var calleeMessage = {
			id: 'stopCommunication'
		};
		
		if(calleeReason) {
			calleeMessage.message = calleeReason;
		}
		callee.sendMessage(calleeMessage);
	}
	
	var callee = userRegistry.getById(calleeId);
	if(!from || !userRegistry.getByName(from)) {
		return onError(null, 'unknown from = ' + from);
	}
	var caller = userRegistry.getByName(from);
	
	if(callResponse === 'accept') {
		var pipeline = new CallMediaPipeline();

		pipeline.createPipeline(function(error) {
			if(error) {
				return onError(error, error);
			}
			
			pipeline.generateSdpAnswerForCaller(caller.sdpOffer, function(error, callerSdpAnswer) {
				if(error) {
					return onError(error, error);
				}
				
				pipeline.generateSdpAnswerForCallee(calleeSdp, function(error, calleeSdpAnswer) {
					if(error) {
						return onError(error, error);
					}
					
					pipelines[caller.id] = pipeline;
					pipelines[callee.id] = pipeline;
					
					var message = {
						id: 'startCommunication',
						sdpAnswer: calleeSdpAnswer
					};
					callee.sendMessage(message);
					
					message = {
						id: 'callResponse',
						response: 'accepted',
						sdpAnswer: callerSdpAnswer
					};
					caller.sendMessage(message);
				});
			});
		});
	} else {
		var decline = {
			id: 'callResponse',
			response: 'rejected',
			message: 'user declined'
		};
		
		caller.sendMessage(decline);
	}
};

function stop(sessionId) {
	var pipeline = pipelines[sessionId];

	if(pipeline) {
		delete pipelines[sessionId];
		pipeline.release();
		
		var stopperUser = userRegistry.getById(sessionId);
		var stoppedUser = userRegistry.getByName(stopperUser.peer);
		
		stopperUser.peer = null;
		
		if(stoppedUser){
			stoppedUser.peer = null;
			
			delete pipelines[stoppedUser.id];
			
			var message = {
				id: 'stopCommunication',
				message: 'remote user hanged up'
			};
			
			stoppedUser.sendMessage(message)
		}
	}
};

function getKurentoClient(callback) {
	if(kurentoClient !== null) {
		return callback(null, kurentoClient);
	}
	
	kurento(argv.wsUri, function(error, _kurentoClient) {
		if(error) {
			var message =
				"Unable to find media server at " + argv.wsUri;
			console.log(message);
			
			return callback(message + ".  Exiting with error " + error);
		}
		
		kurentoClient = _kurentoClient;
		callback(null, kurentoClient);
	});
};
