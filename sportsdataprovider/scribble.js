/* ****************************************************************************
 * File: 		
 * Purpose: 	
 * Author: 		John Allen
 * Company: 	Fig Leaf Software
 *************************************************************************** */
/* *************************** Required Classes **************************** */
var Config = require('./Config');
var log = require('./Logger.js');
var ErrorHandler = require('./ErrorHandler');
var fs = require('fs');

/* *************************** Constructor Code **************************** */
var config = Config.getConfig();

log.dump(process.argv);


//buildAggregateTeamJSON();

/* *************************** Public Methods ****************************** */

/**
 * I build the write aggregate data for teams. I am really a refactor of other
 * code and just here to create a file that is easer for the display code to
 * use. I sort the data 'correctly', buy group then points then goal difference.
 * If there was a data base in this application I would NOT be needed.
 *
 * @return {void}
 */
function buildAggregateTeamJSON(){

	var scheduleJSONForGroupLookUp = getSchedualJSON();
	var teamLookUpJSON = getLookUpData();

	var jsonDirectory = config.JSONDirectory;
	var teamJSONDirectory = jsonDirectory + '/team/';
	var filter = '.json';

	var squadPath = config.JSONDirectory + '/squad.json';
	var squadBinary = fs.readFileSync( squadPath );
	var squadJSON = JSON.parse(squadBinary.toString());

	var result = [];

	for (var i = squadJSON.length - 1; i >= 0; i--) {

		var teamID = squadJSON[i]['id'];

		var team = getTeamEntry();
		var teamLookUpData = getTeamLookUpData( teamID );
		var teamAggregateData = getTeamAggregateDataJSON( teamID );

		team.id = teamID;
		team.abbreviation = teamLookUpData.abbreviation;
		team.country = teamLookUpData.country;
		team.group = getTeamGroup( teamID );
		team.coach = squadJSON[i]['manager'];
		team.win = teamAggregateData.win;
		team.loss = teamAggregateData.loss;
		team.draw =  teamAggregateData.draw;
  		team.goalDifference = teamAggregateData.goalDifference;
  		team.points = teamAggregateData.points;

  		result.push(team);	
	}

	result = sortAggData(result);

	var aggregateJSONData = JSON.stringify( result );
	var fileWritePath = config.JSONDirectory + '/squad-results-sorted.json';
	fs.writeFileSync(fileWritePath, aggregateJSONData);

	/********************** HELPER FUNCTIONS *************************/

	/**
	 * I return a teams group number.
	 *
	 * @param {string} id - I am the ID of the team.
	 * @return {string}
	 */
	function getTeamGroup(IDTeam){
		var schedule = scheduleJSONForGroupLookUp;
		var result = '';	
		
	 	for (var i = schedule.length - 1; i >= 0; i--) {
	 		
	 		if(schedule[i]['homeTeam']['ID'] === IDTeam){
	 			result = schedule[i]['group'];
				break;
	 		}
	 		if(schedule[i]['awayTeam']['ID'] === IDTeam){
	 			result = schedule[i]['group'];
				break;
	 		}
	 	};

		return result;
	}


	/**
	 * I return the schdeuld JSON file as a js object.
	 *
	 * @return {object}
	 */
	function getSchedualJSON(){
		var path = config.JSONDirectory + '/schedule.json';
		var binary = fs.readFileSync( path );
		var json = JSON.parse(binary.toString());
		return json;
	}


	/**
	 * I return the team lookup JSON file as a js object.
	 *
	 * @return {object}
	 */
	function getLookUpData(){
		var path = config.JSONDirectory + '/teamlookup.json';
		var binary = fs.readFileSync( path );
		var json = JSON.parse(binary.toString());
		return json;
	}

	/**
	 * I return an empty object that defines an entry for the agg data.
	 *
	 * @return {object}
	 */
	function getTeamEntry(){
		var teamEntry = {
			'id' : '',
			'abbreviation' : '',
			'country' : '',
			'group' : '',
			'coach' : '',
			'win' : 0,
			'loss' : 0,
			'draw' : 0,
			'goalDifference' : '',
			'points' : ''
		} 
		return teamEntry;
	}

	/**
	 * I return an a teams lookup data by its id
	 *
	 * @param {string} id - I am ID of the team to look up.
	 *
	 * @return {object}
	 */
	function getTeamLookUpData( id ){

		var lookupJSON = teamLookUpJSON;
		var result = '';

		for (var i = lookupJSON.length - 1; i >= 0; i--) {
			if(lookupJSON[i]['optaid'] === id){
				result = lookupJSON[i];
				break;
			}
		};

		return result;
	}

	/**
	 * I return the aggregate JSON file as a JS object. This file is generated
	 * by another process
	 *
	 * @param {string} id - I am ID of the team to get the JSON of.
	 *
	 * @return {object}
	 */
	function getTeamAggregateDataJSON( id ){
		var path = config.JSONDirectory + '/team/' + id + '.json';
		var binary = fs.readFileSync( path );
		var json = JSON.parse(binary.toString());
		return json;
	}

	function sortAggData ( data ) {
		
		//TODO: this should be made more generic and put in the Utils class
		/* multi key sort from: 
		stackoverflow.com/questions/6913512/how-to-sort-an-array-of-objects-by-multiple-fields
		*/
		var sort_by;

		(function() {
		    // utility functions
		    var default_cmp = function(a, b) {
		            if (a == b) return 0;
		            return a < b ? -1 : 1;
		        },
		        getCmpFunc = function(primer, reverse) {
		            var dfc = default_cmp, // closer in scope
		                cmp = default_cmp;
		            if (primer) {
		                cmp = function(a, b) {
		                    return dfc(primer(a), primer(b));
		                };
		            }
		            if (reverse) {
		                return function(a, b) {
		                    return -1 * cmp(a, b);
		                };
		            }
		            return cmp;
		        };

		    // actual implementation
		    sort_by = function() {
		        var fields = [],
		            n_fields = arguments.length,
		            field, name, reverse, cmp;

		        // preprocess sorting options
		        for (var i = 0; i < n_fields; i++) {
		            field = arguments[i];
		            if (typeof field === 'string') {
		                name = field;
		                cmp = default_cmp;
		            }
		            else {
		                name = field.name;
		                cmp = getCmpFunc(field.primer, field.reverse);
		            }
		            fields.push({
		                name: name,
		                cmp: cmp
		            });
		        }

		        // final comparison function
		        return function(A, B) {
		            var a, b, name, result;
		            for (var i = 0; i < n_fields; i++) {
		                result = 0;
		                field = fields[i];
		                name = field.name;

		                result = field.cmp(A[name], B[name]);
		                if (result !== 0) break;
		            }
		            return result;
		        }
		    }
		}());

		// TODO: this should be passed in as arguments!
		return data.sort( sort_by( 'group', 'points', 'goalDifference' ) );
	}
}


/* ************************ Exported Public Methods ************************ */