/*
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the GNU Lesser General Public License
 * (LGPL) version 2.1 which accompanies this distribution, and is available at
 * http://www.gnu.org/licenses/lgpl-2.1.html
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 */
var ws = new WebSocket('wss://' + location.host + '/webrtc');

var videoInput;
var videoOutput; // TODO multiple outputs
var webRtcPeer;

const NO_CALL = 0;
const INITIALIZING_CALL = 1;
const PROCESSING_CALL = 2;
const CONNECTING_CALL = 3;
const IN_CALL = 4;
var callState = null

function setCallState(nextState) {
	switch (nextState) {
	case NO_CALL:
		$('#start').attr('disabled', false);
		$('#stop').attr('disabled', true);
		
		// TODO message click start to rejoin call
		break;

	case INITIALIZING_CALL:
		$('#start').attr('disabled', true);
		$('#stop').attr('disabeld', true);
		
		// TODO connecting to server; preparing
		break;

	case PROCESSING_CALL:
		$('#start').attr('disabled', true);
		$('#stop').attr('disabled', true);
		
		// TODO Invite someone by sending the link to them
		// waiting for other people
		break;
		
	case CONNECTING_CALL:
		$('#start').attr('disabled', true);
		$('#stop').attr('disabled', true);
		
		// TODO Invite someone by sending the link to them
		// waiting for other people
		break;
	
	case IN_CALL:
		$('#start').attr('disabled', true);
		$('#stop').attr('disabled', false);
		break;
		
	default:
		return;
	}
	
	callState = nextState;
}

window.onload = function() {
	console = new Console();

	setCallState(NO_CALL);
	
	var drag = new Draggabilly(document.getElementById('videoSmall'));
	videoInput = document.getElementById('videoInput');
	videoOutput = document.getElementById('videoOutput');

	document.getElementById('start').addEventListener('click', function() {
		join();
	});
	document.getElementById('stop').addEventListener('click', function() {
		stop();
	});
};

window.onbeforeunload = function() {
	ws.close();
};

ws.onopen = function() {
	join();
};

ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);
	
	switch(parsedMessage.id) {
	case 'joinResponse':
		joinResponse(parsedMessage);
		break;
		
	case 'callResponse':
		callResponse(parsedMessage);
		break;
		
	case 'incomingCall':
		incomingCall(parsedMessage);
		break;
		
	case 'startCommunication':
		startCommunication(parsedMessage);
		break;
		
	case 'stopCommunication':
		console.info("Communication ended by remote peer");
		stop(true);
		break;

	case 'iceCandidate':
		webRtcPeer.addIceCandidate(parsedMessage.candidate)
		break;
		
	default:
		console.error('Unrecognized message', parsedMessage);
	}
};

function join() {
	var room = window.location.pathname;
	if(room == '') {
		window.alert("You must join a room.");
		return; // TODO redirect back to index page
	}
	
	setCallState(INITIALIZING_CALL);
	
	var message = {
		id: 'join',
		room: room
	};
	
	sendMessage(message);
};

function joinResponse(message) {
	if(message.response != 'accepted') {
		setCallState(NO_CALL);
		
		var errorMessage = 
			message.message ? message.message : 
				'Unknown reason for join rejection.';
		console.log(errorMessage);
		alert('Error joining call. See console for further information.');
		
		// TODO
		// Sorry the room is too crowded
		// please try again later.
	} else {
		setCallState(PROCESSING_CALL);
		
		// it wasn't myself that joined, attempt to start the call
		if(message.from != message.to) {
			call(message.from);
		}
		
		// TODO
		// Invite someone by sending the link to them!
		// Waiting for other people...
	}
};

/**
 * This method is initiated by the client whenever a new individual joins.
 * @param userId
 */
function call(userId) {
	setCallState(CONNECTING_CALL);
	showSpinner(videoInput, videoOutput);
	
	var options = {
		localVideo: videoInput,
		remoteVideo: videoOutput,
		onicecandidate: onIceCandidate
	};
		
	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error) {
		if(error) {
			console.error(error);
			setCallState(PROCESSING_CALL);
		}
		
		this.generateOffer(function(error, sdpOffer) {
			if(error) {
				console.error(error);
				setCallState(PROCESSING_CALL);
			}

			var message = {
				id: 'call',
				to: userId,
				sdpOffer : sdpOffer
			};
			
			sendMessage(message);
		});
	});
};

/** 
 * This method is executed in reply to an incoming call.
 * 
 * @param message
 */
function incomingCall(message) {
	if(callState != PROCESSING_CALL) {
		var response = {
			id: 'incomingCallResponse',
			to: message.from,
			callResponse: 'reject',
			message: 'busy'
		};
		
		return sendMessage(response);
	}
	
	setCallState(CONNECTING_CALL);
	showSpinner(videoInput, videoOutput);

	var options = {
		localVideo : videoInput,
		remoteVideo : videoOutput,
		onicecandidate : onIceCandidate
	}

	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error) {
		if(error) {
			console.error(error);
			setCallState(PROCESSING_CALL);
		}
		
		this.generateOffer(function(error, sdpOffer) {
			if(error) {
				console.error(error);
				setCallState(PROCESSING_CALL);
			}
			
			var response = {
				id: 'incomingCallResponse',
				to: message.from,
				callResponse: 'accept',
				sdpOffer: sdpOffer
			};
			
			sendMessage(response);
		});
	});
};

/**
 * This method is used if I initiated the connection.
 * 
 * @param message
 */
function callResponse(message) {
	if(message.response != 'accepted') {
		console.info('Call not accepted by peer.  Closing call.');
		
		var errorMessage =
			message.message ? message.message :
			'Unknown reason for call rejection.';
		console.log(errorMessage);
		
		stop(true);
	} else {
		setCallState(IN_CALL);
		
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
};

/**
 * This method is used if a peer initiated the connection.
 * 
 * @param message
 */
function startCommunication(message) {
	setCallState(IN_CALL);
	
	webRtcPeer.processAnswer(message.sdpAnswer);
};

function stop(message) {
	setCallState(NO_CALL);
	
	if(webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;

		if(!message) {
			var message = {
				id : 'stop'
			}
			
			sendMessage(message);
		}
	}
	
	hideSpinner(videoInput, videoOutput);
};

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	if(message.id != 'onIceCandidate') {
		console.log('Sending message: ' + jsonMessage);
	}
	
	ws.send(jsonMessage);
};

function onIceCandidate(candidate) {
	console.log('Local candidate' + JSON.stringify(candidate));

	var message = {
		id : 'onIceCandidate',
		candidate : candidate
	}
	
	sendMessage(message);
};

function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
};

function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
};

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});
