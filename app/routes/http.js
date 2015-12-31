var express = require('express');
var router = express.Router();

// TODO refactor to use global configuration
router.get('/:room', function(req, res) {
	res.sendFile('room.html', { root : './public' });
});

module.exports = router;