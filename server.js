/* required libraries */
var path = require('path');
var express = require('express');
var ws = require('ws');
var url = require('url');
var kurento = require('kurento-client');
var fs = require('fs');
var https = require('https');

/* include objects */
var Constants = require('./app/constants');
var UserSession = require('./app/models/user-session');
var UserRegistry = require('./app/models/user-registry');
var CallMediaPipeline = require('./app/models/call-media-pipeline');
var Room = require('./app/models/room');

var httpRoutes = require('./app/routes/http');
var socketRoutes = require('./app/routes/sockets');

/* global variables */
var kurentoClient = null;
var userRegistry = UserRegistry;
var pipelines = {};
var candidatesQueue = require('./app/models/candidates-queue');
var rooms = {};
var idCounter = 0;

function nextUniqueId() {
	idCounter++;
	
	return idCounter.toString();
}

/* command line arguments */
var argv = require('./app/config/argv');

/* ssl certificates -- these should be replaced with real ones */
var options = {
	key: fs.readFileSync('keys/server.key'),
	cert: fs.readFileSync('keys/server.crt')
};

/* server startup */
var routes = require('./app/routes/http');
var app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(routes);

var asUrl = url.parse(argv.asUri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function() {
	console.log('WebRTC Server Started');
	console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
	server : server,
	path : '/webrtc'
});

// TODO move to sockets controller
// TODO request vs connection
wss.on('connection', function(ws) {
	var sessionId = nextUniqueId();
	console.log('Connection received with sessionId ' + sessionId);

	ws.on(Constants.WS_EVENT_ERROR, function(error) {
		console.log('Connection ' + sessionId + ' error');
		stop(sessionId);
	});

	ws.on(Constants.WS_EVENT_CLOSE, function() {
		console.log('Connection ' + sessionId + ' closed');		
		stop(sessionId);
		
		var user = userRegistry.getById(sessionId);
		userRegistry.unregister(sessionId);
		
		// TODO refactor to remove user from room they are in
		Object.keys(rooms).forEach(function(key, index) {
			var room = rooms[key];
			room.remove(user);
			
			if(room.size() == 0) {
				delete rooms[key];
			}
		});
	});

	ws.on(Constants.WS_EVENT_MESSAGE, function(_message) {
		var message = JSON.parse(_message);
		console.log('Connection ' + sessionId + ' received message ', message);
		
		switch(message.id) {
		case 'join':
			join(sessionId, message.room, ws);
			break;

		case 'call':
			call(sessionId, message.to, message.sdpOffer);
			break;

		case 'incomingCallResponse':
			incomingCallResponse(sessionId, message.to, message.callResponse, message.sdpOffer);
			break;

		case 'stop':
			stop(sessionId);
			break;

		case 'onIceCandidate':
			onIceCandidate(sessionId, message.candidate);
			break;

		default:
			ws.send(JSON.stringify({
				id: 'error',
				message: 'Invalid message ' + message
			}));
			break;
		}
	});
});

function getRoom(name) {
	if(!rooms[name]) {
		rooms[name] = new Room(name);
	}
	
	return rooms[name];
};

/**
 * This adds a user to the virtual room.
 * 
 * @param id identifier of the user
 * @param name name of the room
 * @param ws websocket of the user
 */
function join(id, name, ws) {
	function onError(error) {
		console.log("Error joining room " + error);
		
		ws.send(JSON.stringify({
			id: 'joinResponse',
			response: 'rejected',
			message: error
		}));
	};
	
	if(!name) {
		return onError("empty room name");
	}
	
	var caller = new UserSession(id, ws);
	var room = getRoom(name);
	
	userRegistry.register(caller);
	room.add(caller);
	
	// TODO handle when room is full
	// notify everyone in the room that a new user has joined
	for(var i=0;i<room.size();i++) {
		var callee = room.user(i);
		
		callee.sendMessage({
			id: 'joinResponse',
			response: 'accepted',
			from: caller.id,
			to: callee.id
		});
	}
};

function call(callerId, calleeId, sdpOffer) {
    require('./app/models/candidates-queue').clearCandidatesQueue(callerId);

	var caller = userRegistry.getById(callerId);
	var rejectCause = 'waiting for users to join room';
	
	if(userRegistry.getById(calleeId)) {
		var callee = userRegistry.getById(calleeId);
		caller.sdpOffer = sdpOffer;
		callee.peer = callerId;
		caller.peer = calleeId;
		
		var message = {
			id: 'incomingCall',
			from: callerId
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

function incomingCallResponse(calleeId, callerId, callResponse, calleeSdp) {
	require('./app/models/candidates-queue').clearCandidatesQueue(calleeId);

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
	if(!callerId || !userRegistry.getById(callerId)) {
		return onError(null, 'unknown user = ' + callerId);
	}
	var caller = userRegistry.getById(callerId);
	
	if(callResponse === 'accept') {
		var pipeline = new CallMediaPipeline();
		pipelines[caller.id] = pipeline;
		pipelines[callee.id] = pipeline;

		pipeline.createPipeline(caller.id, callee.id, function(error) {
			if(error) {
				return onError(error, error);
			}
			
			pipeline.generateSdpAnswer(caller.id, caller.sdpOffer, function(error, callerSdpAnswer) {
				if(error) {
					return onError(error, error);
				}
				
				pipeline.generateSdpAnswer(callee.id, calleeSdp, function(error, calleeSdpAnswer) {
					if(error) {
						return onError(error, error);
					}
					
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
		var stoppedUser = userRegistry.getById(stopperUser.peer);
		
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
		
		require('./app/models/candidates-queue').clearCandidatesQueue(sessionId);
	}
};

function onIceCandidate(sessionId, _candidate) {
    var candidate = kurento.register.complexTypes.IceCandidate(_candidate);
    var user = userRegistry.getById(sessionId);

    if(pipelines[user.id] && pipelines[user.id].webRtcEndpoint && pipelines[user.id].webRtcEndpoint[user.id]) {
        var webRtcEndpoint = pipelines[user.id].webRtcEndpoint[user.id];
        webRtcEndpoint.addIceCandidate(candidate);
    } else {
    	if(!candidatesQueue[user.id]) {
    		candidatesQueue[user.id] = [];
    	}
    	candidatesQueue[sessionId].push(candidate);
    }
};
