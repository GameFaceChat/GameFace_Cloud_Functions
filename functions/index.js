"use strict";

//Set up functions
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

//Require
const express = require("express");
const cors = require("cors")({ origin: true });

//Handlers for functions
const verify = require("./app/verify");
const room = require("./app/room.handler");
const store = require("./app/store.handler");
const users = require("./app/users.handler");

//Create Express app
const app = express();
app.use(cors);
app.use(express.json());

//Validate the bearer token
app.use(verify.validateFirebaseIdToken);

/**
 * Gets the STUN/TURN servers from Twilio
 */
app.get("/servers", room.getServers);

/**
 * Purchase a pack from the store for a given user and pack ID
 */
app.post("/purchasePack", async (req, res) => {
  return store.purchase(req, res);
});

/**
 * Serve on HTTPS only
 */
exports.app = functions.https.onRequest(app);

/**
 * Deletes room if the member count is 0
 */
exports.deleteRoom = functions.database
  .ref("/rooms/{roomID}/memberCount")
  .onWrite(async (snap, context) => {
    return room.deleteRoom(snap, context);
  });

/**
 * Observes the member status of each room to update
 * accordingly
 */
exports.observeMembers = functions.database
  .ref("/rooms/{roomID}/members/{uid}")
  .onWrite(async (snap, context) => {
    return room.observeMembers(snap, context);
  });

/**
 * sends a friend request when there is a new friend request
 * sent by a user.
 */
exports.sendFriendRequest = functions.database
  .ref("/users/{uid}/friendRequests/{pushID}")
  .onWrite(async (snap, context) => {
    return users.sendFriendRequest(snap, context);
  });
