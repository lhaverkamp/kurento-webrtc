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

var httpRoutes = require('./app/routes/http');
var socketRoutes = require('./app/routes/sockets');

/* global variables */
var kurentoClient = null;
var userRegistry = UserRegistry;
var pipelines = {};
var candidatesQueue = require('./app/models/candidates-queue');
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
var app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./app/routes/http'));

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
		userRegistry.unregister(sessionId);
	});

	ws.on(Constants.WS_EVENT_MESSAGE, function(_message) {
		var message = JSON.parse(_message);
		console.log('Connection ' + sessionId + ' received message ', message);

		// TODO start, stop, onIceCandidate
		// register, call, incomingCallResponse should be replaced with start
		// logic in stop and onIceCandidate should be the same
		switch(message.id) {
		case 'start':
			start(sessionId, ws);
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

function start(id, ws, callback) {
	function onError(error) {
		console.log("Error processing start: " + error);
		
		ws.send(JSON.stringify({
			id: 'startResponse',
			response: 'rejected',
			message: error
		}));
	};
	
	// TODO register & call logic
}

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
		return onError("user " + name + " is already registered");
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
    require('./app/models/candidates-queue').clearCandidatesQueue(callerId);

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
	if(!from || !userRegistry.getByName(from)) {
		return onError(null, 'unknown from = ' + from);
	}
	var caller = userRegistry.getByName(from);
	
	if(callResponse === 'accept') {
		var pipeline = new CallMediaPipeline();
		pipelines[caller.id] = pipeline;
		pipelines[callee.id] = pipeline;

		pipeline.createPipeline(caller.id, callee.id, ws, function(error) {
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
		
		require('./app/models/candidates-queue').clearCandidatesQueue(sessionId);
	}
};

function onIceCandidate(sessionId, _candidate) {
    var candidate = kurento.register.complexTypes.IceCandidate(_candidate);
    var user = userRegistry.getById(sessionId);

    if (pipelines[user.id] && pipelines[user.id].webRtcEndpoint && pipelines[user.id].webRtcEndpoint[user.id]) {
        var webRtcEndpoint = pipelines[user.id].webRtcEndpoint[user.id];
        webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        if (!candidatesQueue[user.id]) {
            candidatesQueue[user.id] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}
