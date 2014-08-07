/*!
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.osedu.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var fs = require('fs');
var util = require('util');

var AuthorManager = require('ep_etherpad-lite/node/db/AuthorManager');
var DB = require('ep_etherpad-lite/node/db/DB').db;
var PadManager = require('ep_etherpad-lite/node/db/PadManager');
var PadMessageHandler = require('ep_etherpad-lite/node/handler/PadMessageHandler');

var RecentAuthors = require('./lib/RecentAuthors');

var APIKEY = null;
try {
    APIKEY = fs.readFileSync('./APIKEY.txt', 'utf8');
} catch (err) {
    console.error('Could not read the APIKEY: ', err);
}

/**
 * The `handleMessage` hook
 *
 * @param  {String}     hook        The hook name (in this case `expressCreateServer`)
 * @param  {Object}     args        The arguments to this hook. In this case it's the express `app` object
 * @param  {Function}   callback    Standard etherpad callback function
 */
exports.expressCreateServer = function(hook, args, callback) {
    /*!
     * Registers a simple endpoint that sets the sessionID as a cookie and redirects
     * the user to the pad.
     * We use an endpoint rather than some middleware as we cannot guarantee the order
     * in which plugins get loaded and thus cannot be sure that our middleware gets picked
     * up before Etherpad's session middleware.
     * If a language has been specified, we'll set it in a cookie as well.
     */
    args.app.get('/oae/:padId', function(req, res) {
        if (!req.query.sessionID || 
            !req.query.pathPrefix ||
            !req.query.authorId ||
            !req.query.userId ||
            !req.query.contentId) {
            res.send(401, 'Unauthorized');
            return;
        }

        // Set the session cookie
        req.cookies.sessionID = req.query.sessionID;
        res.cookie('sessionID', req.query.sessionID);

        // Set the language (if one is specified)
        if (req.query.language) {
            req.cookies.language = req.query.language;
            res.cookie('language', req.query.language);
        }

        // Keep track of which pad the author joined
        RecentAuthors.join(req.params.padId, req.query.authorId, req.query.userId, req.query.contentId);

        // Redirect to the pad
        res.redirect(req.query.pathPrefix + '/p/' + req.params.padId);
    });

    return callback();
};

/**
 * The `handleMessage` hook.
 * It takes care of dropping username updates as those are not allowed.
 *
 * @param  {String}   hook     The hook name (in this case `handleMessage`).
 * @param  {Object}   args     The arguments to this hook. In this case it's a `client` socket.io object and a `message` object.
 * @param  {Function} callback Standard etherpad callback function
 */
exports.handleMessage = function(hook, args, callback) {
    if (args.message && args.message.data) {
        // Username updates appear in USERINFO_UPDATE messages
        if (args.message.data.type === 'USERINFO_UPDATE') {
            // Unfortunately color and IP updates also appear in USERINFO_UPDATE messages
            // and there is no way to distinct between the two. We need to fetch the original
            // author name and compare it with the name in the message object.
            // If it's the same we let the update flow through, otherwise we deny it.
            AuthorManager.getAuthor(args.message.data.userInfo.userId, function(err, user) {
                if (err) {
                    return callback(err);

                // If the user tries to update his name, drop the message
                } else if (user.name !== args.message.data.userInfo.name) {
                    // The documentation mentions we should be doing callback(null)
                    // but that gets normalized to callback([]) which would not drop the message
                    return callback([null]);

                // Otherwise, pass it on
                } else {
                    return callback();
                }
            });

        // Somebody made a change to a document
        } else if (args.message.data.type === 'USER_CHANGES') {
            var apool = args.message.data.apool;
            if (apool && apool.nextNum !== 0 && apool.numToAttrib && apool.numToAttrib['0'] && apool.numToAttrib['0'].length === 2 && apool.numToAttrib['0'][0] === 'author') {
                // Get the ID of the author who made the change
                var authorId = args.message.data.apool.numToAttrib["0"][1];

                // Get the pad Id
                var padId = PadMessageHandler.sessioninfos[args.client.id].padId;
                RecentAuthors.madeEdit(padId, authorId);
            }
            return callback();
        } else {
            return callback();
        }
    } else {
        return callback();
    }
};
