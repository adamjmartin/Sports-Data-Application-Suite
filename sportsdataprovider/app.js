/* ****************************************************************************
 * File: 		app.js
 * Purpose: 	I am the main application file. I watch a specified directory
 *				and when files have been updated or added I create a job so the file 
 *				can be read then parsed and passed to the Transformer.js class which 
 *				generates front end ready JSON files and publishes data to the Faye
 *				server.
 *
 * Author: 		John Allen
 * Company: 	Fig Leaf Software
 *************************************************************************** */

/* *************************** Required Classes **************************** */

var fs = require('fs');
var path = require('path');
var chokidar = require('chokidar');
var Config = require('./Config');
var Transformer = require('./Transformer.js');
var ErrorHandler = require('./ErrorHandler');
var log = require('./Logger.js');
var utils = require('./Utils.js');
var Lookup = require('./Lookup.js');
var dom = require('xmldom').DOMParser;
var kue = require('kue');
var aggregateDataService = require('./AggregateDataService');

/* *************************** Constructor Code **************************** */

// light up the web based UI
// were nixing this cause it borks on production server
//kue.app.listen(3000);

// the configuration data
var config = Config.getConfig();

// the array of jobs Kue keeps track of
var jobs = kue.createQueue();

// set these defaults, they are overwritten in onApplicaitonStart and finaly
// in Transformer.js postTransform() during start up.
global = {
	isApplicaitonStarting : true,
	numberOfStartUpXMLFiles : 0,
	numberOfSartUpJobsCommited : 0
}

// write any lookup json files we need
Lookup.writeTeamLookUpJSON();

// write the squad and player file
preBuildSquadFile();

// only build the agg squad file if stuff was passed in e.g.: '$ node app.js false true'
// also kill the application right after so we don't reprocess everthing..
if(process.argv[3] != undefined && process.argv[3] === 'true'){
	
	// chill out, the lookup and squad files need to be written first.
	setTimeout(function() { 
		aggregateDataService.buildAggregateTeamJSON();
		log.log('we build the aggregate squad file.')
	}, 5000);
} else {

	// Light Up the Application!
	onApplicationStart('Seems the Application started as normal');
}


/* *************************** Public Methods ****************************** */

/**
 * I start the application. I kick off the file watcher which in turn kicks
 * off the job que (the Kue lib). Job que then starts the XML transformation
 * process. In a nut shell: we read the incoming/updated XML and create JSON
 * from that and write it to disk. After it's written to disk we then send a 
 * request to the Faye server with the JSON to update any clients which want
 * to see the updates.
 *
 * Arguments:
 * @param {String} message - a message to log when I am called
 * @return {void}
 */
function onApplicationStart( message ){

	var howLongToWaitAfterChange = 5000;
	var howMayJobAttempts = 1;

	// set these so we can keep track during startup and NOT broadcast
	// to Faye the JSON were building during the startup process. The directory
	// watcher by default will fire off 'add' actions on the dir it's watcing
	// for each file in the directory.
	global = {
		isApplicaitonStarting : true,
		numberOfStartUpXMLFiles : getNumberOfStartUpXMLFiles(),
		numberOfSartUpJobsCommited : 0
	}

	var watcher = chokidar.watch(config.FPTDirectory, { 
		persistent: true,
		interval: howLongToWaitAfterChange
	});

	// we want the watcher to create jobs instead of having all the code rely
	// on the watcher itself. Better seperation of concerns and allows
	// for more fault tolerance becaue Kue will attempt to process any failed
	// job another time intstead of just borking the application. Why
	// would code fail after the watcher? Because SFTP file transfers might be
	// held up for some reason and be taking a long time. We want to allow the
	// files to be written before we react to them. 
	watcher
		.on('add', function( path ) {

			var extension = path.split('.').pop();

			if (extension === 'xml'){

				jobs.create('processJSON', {
					action : 'add',
					path: path
				}).attempts( howMayJobAttempts ).save();
			}
		})
		.on('change', function( path ) {

			var extension = path.split('.').pop();

			if (extension === 'xml'){

				jobs.create('processJSON', {
					action : 'change',
					path: path
				}).attempts( howMayJobAttempts ).save();
			}

		})
		.on('unlink', function( path ) {
			//do nothing, we don't care if files have been deleted
		})
		.on('error', function( error ) {
			ErrorHandler.handleError( 'The watcher borked', error );
		});

	log.application( 'onApplicationStart() happened.', message );

	global.isApplicaitonStarting = false;
}


/**
 * I restart the applicaiton. 
 *
 * Arguments:
 * @param {Numeric} millisecondsToWait - how long I should sleep before calling 
 										 onApplicationStart()
 * @return {void}
 */
function restartApplication( millisecondsToWait ){

	// Lets chill out before we restart the application. Something has gone
	// wrong with the SFTP, which is the only reason why we are here.
	setTimeout(
		function(){
			onApplicationStart(
				'restartApplication() fired the onApplicationStart() method.'
			)
		},  
		millisecondsToWait
	);
}


/* *************************** Private Methods ***************************** */

/**
 * I process all the jobs in the que. I am the consumer of the Kue.
 *
 * Arguments:
 * @param {String} 'processJSON' - I am the string to look at the job que for to
 								   process things.
 * @param {Function} callback - I am teh call back funciton.
 * @return {void}
 */
jobs.process('processJSON', function( job, done ){
	
	// give everybody 9 more seconds just in case the SFTP transfer was super slow
	setTimeout(
		function(){ 
			afterWatcher( job.data.action, job.data.path );
		}, 6000 );

	done();
});


/**
 * I am the function called after the watcher sees a change. I read the file 
 * make the  JSON and then pass the results to the front controller
 *
 * Arguments:
 * @param {String} action - what action the watcher performed
 * @param {String} path - the path of the file
 * @return {void}
 */
function afterWatcher( action, path ){

	fs.readFile( path, function( err, data ) {

		// log that we read a file.
		log.application('read the file: ' + path);

		// parse the XML
		try {

			var xmlDoc = new dom().parseFromString( data.toString() );

		} catch( error ) {

			//log.log('Error From app.js in afterWatcher. Problem reading the XML data.', arguments);
			
			
			ErrorHandler.handleError( 
				'Error From app.js in afterWatcher. Problem reading the XML data.', 
				arguments 
			);
			
			restartApplication( 5000 );
		}

		// turn the XML into a JSON object
		try {
			
			var json = utils.xmlToJson( xmlDoc );

		} catch( error ) {
			
			//log.log('Error From app.js in afterWatcher. Problem reading the XML data.', arguments);

			
			ErrorHandler.handleError( 
				'Error From afterWatcher. Utils.xmlToJson failed.', 
				arguments 
			);
			
			// the file probally hasn't fully written to disk so try to recover.
			restartApplication( 5000 );
		}

		var feedType = getFeedType( path );

		if ( ( typeof json != 'undefined' ) && ( feedType.length ) ){

			if( isInSeason( feedType, json ) ){
				handleAction( action, feedType, json, path );	
			}
		}
	});
}


/**
 * I handle what to do after the parser and watcher
 *
 * Arguments:
 * @param {String} action - what action the watcher performed
 * @param {String} feedType - what type of feed this is
 * @param {Object} data - the JSON data from the XML feed
 * @return {void}
 */
function handleAction( action, feedType, data, path ){

	var doAction = '';

	// ******************* DETERMINE WHAT ACTION TO TAKE ******************* //

	// SCHEDULE - I build the JSON for the schedule
	if ( (action === 'add') && ( feedType === 'f1' ) ){
		doAction = 'buildSchedule';
	}
	if ( (action === 'change') && ( feedType === 'f1' ) ){
		doAction = 'buildSchedule';
	}

	// GAME FILE - I build a games JSON information
	if ( (action === 'add') && ( feedType === 'f9' ) ){
		doAction = 'buildGameFile';
	}
	if ( (action === 'change') && ( feedType === 'f9' ) ){
		doAction = 'buildGameFile';
	}

	// COMMENT - I build a games JSON information and rebuild it when changed
	if ( (action === 'add') && ( feedType === 'f13' ) ){
		doAction = 'buildCommentFile';
	}
	if ( (action === 'change') && ( feedType === 'f13' ) ){
		doAction = 'buildCommentFile';
	}

	if ( (action === 'add') && ( feedType === 'f40' ) ){
		doAction = 'buildSquadFile';
	}


	if ( (action === 'add') && ( feedType === 'f30' ) ){
		doAction = 'buildSeasonStats';
	}
	if ( (action === 'change') && ( feedType === 'f30' ) ){
		doAction = 'buildSeasonStats';
	}


	// ******* FRONT CONTROLLER / DISPATCHER (call it what you will) ******* //
	switch( doAction ){

		case 'buildSchedule':
			
			Transformer.buildSchedule( data );
			break;

		case 'buildGameFile':
			
			Transformer.buildGameFile( data );
			Transformer.updateCurrentGameFile( data );
			break;

		case 'buildCommentFile':
			
			Transformer.buildCommentFile( data );
			break;

		case 'buildSquadFile':
			
			Transformer.buildSquadFile( data );
			break;

		case 'buildSeasonStats':
			
			Transformer.buildSeasonStats(  );
			break;

		default:
			/*
			ErrorHandler.handleError( 
				'Error From app.js handleAction(). No action "doAction" determined.', 
				[action, feedType, path] 
			);
			*/
	}
}

/**
 * I read the squads XML file and build the squad and player JSON. They are
 * by lots of other file writes so build them here at application start.
 * @param {String} path - path to the file

 * @return {string}
 */
function preBuildSquadFile() {
	

	try{

	var squadsFilePath = config.FPTDirectory + "/" + config.squadFileName;
	var rawSquadBinnaryData = fs.readFileSync( squadsFilePath );
	var xmlDoc = new dom().parseFromString( rawSquadBinnaryData.toString() );
	var json = utils.xmlToJson( xmlDoc );

	Transformer.buildSquadFile( json );

	} catch(e){
		// log and let the app continue. this can happen in testing a lot
		log.application("preBuildSquadFile borked casue the file was not there", "nope", e);
		log.error("preBuildSquadFile borked casue the file was not there", "nope", e);
		log.log("preBuildSquadFile borked casue the file was not there");
	}
}


/**
 * I return the type of feed based on the file name.
 * @param {String} path - path to the file

 * @return {string}
 */
function getFeedType( path ){
	
	var feedKeyObject = config.feedTypeStringID;
	var result = '';
	
	for (var property in feedKeyObject) {
		if (path.indexOf(feedKeyObject[property]) > 0) {
			result = property;
		}
	}

	return result;
}


/**
 * I return the type of feed based on the file name.
 *
 * @return {Numeric} I am the number of XML files in the FTP directory
 */
function getNumberOfStartUpXMLFiles(){

	var count = 0;
	var files = fs.readdirSync(config.FPTDirectory);
	
	for ( var i = files.length - 1; i >= 0; i-- ) {
		
		var ext = path.extname( config.FPTDirectory + files[i] );
		
		if ( ext === '.xml' ){

			count++;
		}
	};

	return count;
}


/**
 * I return true for false if the json is for the 2014 world cup.
 * @param {json} json - i am the json data to check.
 *
 * @return {boolean} True if it is the 2014 world cup. False if not.
 */
function isInSeason(feedType, json){

	var result = false;

	// check F1
	if( feedType === 'f1' ){
		if (json.SoccerFeed.SoccerDocument['@attributes']['season_name'] === config.seasonName
			&& json.SoccerFeed.SoccerDocument['@attributes']['competition_id'] === config.competitionID
		){
			result = true;
		}
	}

	// check F9
	if ( feedType === 'f9' ) {

		var statArray = json.SoccerFeed.SoccerDocument.Competition.Stat;
		var seasonID = '';
		var seasonName = '';

		// get the properties we want to check
		for (var i = 0; i < statArray.length; i++) {
			
			if ( statArray[i]['@attributes']['Type'] === 'season_id' ){
				seasonID = statArray[i]['#text'];
			}

			if ( statArray[i]['@attributes']['Type'] === 'season_name' ){
				seasonName = statArray[i]['#text'];
			}
		};

		// now check the properties are correct
		if(seasonID === config.seasonID && seasonName === config.seasonName){
			result = true;
		}
	}

	// check F13
	if ( feedType === 'f13' ) {
		if (json.Commentary['@attributes']['season'] === config.season){
			result = true;
		}
	}

	// check F40
	if ( feedType === 'f40' ) {
		if ( 
				json.SoccerFeed.SoccerDocument['@attributes']['season_name'] === config.seasonName 
				&&
				json.SoccerFeed.SoccerDocument['@attributes']['competition_id'] === config.competitionID 
			){
			result = true;
		}
	}

	// check F30
	if ( feedType === 'f30' ) {
		if (
			json.SeasonStatistics['@attributes']['competition_name'] === config.competitionName
			&&
			json.SeasonStatistics['@attributes']['season_name'] === config.seasonName
			){
			result = true;
		}

	}

	// log a failed file for testing....
	if(result === false){
		log.application(feedType + ' was a non world cup file.');
		log.log(feedType + ' was a non world cup file.');
	}

	return result;
}