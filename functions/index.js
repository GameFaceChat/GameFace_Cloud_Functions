"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cors = require("cors")({ origin: true });
const client = require("twilio")(functions.config().twilio.sid, functions.config().twilio.auth);

app.use(cors);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const validateFirebaseIdToken = async (req, res, next) => {
  if (
    (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ")) &&
    !(req.cookies && req.cookies.__session)
  ) {
    console.error("No Firebase ID token");
    res.status(403).send("Unauthorized");
    return;
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    idToken = req.headers.authorization.split("Bearer ")[1];
  } else {
    console.log("ID Token Error");
    res.status(403).send("Unauthorized");
    return;
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedIdToken;
    console.log("Decoded ID Token", decodedIdToken);
    next();
  } catch (error) {
    console.log("ERROR: " + error);
    res.status(403).send("Unauthorized");
  }
};

app.use(cors);
// app.use(validateFirebaseIdToken);
app.get("/servers", (req, res) => {
  client.tokens
    .create()
    .then((token) => {
      res.send(token);
    })
    .catch((error) => {
      console.log(error);
      res.status(500).send(error);
    });
});

/*
JSON should have props:
{
  fromUID, toUID, fromDevice 
}
*/
app.post("/call", async (req, res) => {
  if (
    !req.body.hasOwnProperty("fromUID") ||
    !req.body.hasOwnProperty("toUID") ||
    !req.body.hasOwnProperty("fromDevice")
  ) {
    return res.status(400).send("Wrong format");
  }
  let profile = await admin.database().ref(`profiles/${req.body.fromUID}/`).once("value");
  if (!profile.exists()) return res.status(404).send("User not found");
  let fromUser = profile.val();
  let devicesToUser = await admin
    .database()
    .ref(`/users/${req.body.toUID}/devicesID/`)
    .once("value");

  devicesToUser.forEach((device) => {
    messages.push({
      data: {
        type: "CALL",
        fromName: fromUser.name,
        fromUsername: fromUser.username,
        fromUID: fromUser.uid,
        fromDevice: req.body.fromDevice,
      },
      token: device.val(),
    });
  });

  return admin
    .messaging()
    .sendAll(messages)
    .then((response) => {
      console.log(response.successCount + " messages were sent");
    })
    .catch((error) => {
      console.error(error);
    });
  // res.send("HERE is data: " + req.body.param1);
});

app.post("/accept", (req, res) => {
  if (!req.body.hasOwnProperty("roomID")) {
    return res.status(400).message("No RoomID");
  }
});

exports.app = functions.https.onRequest(app);

exports.deleteRoom = functions.database
  .ref("/rooms/{roomID}/users")
  .onWrite(async (snap, context) => {
    if (snap.after.val() == null) return false;
    if (snap.after.val() <= 0) {
      return admin.database().ref(`/rooms/${context.params.roomID}`).delete();
    }
  });

exports.sendFriendRequest = functions.database
  .ref("/users/{uid}/friendRequests/{pushID}")
  .onWrite(async (snap, context) => {
    // console.log(context.params.pushID);
    //Removed
    if (snap.after.val() == null) {
      return false;
    }
    //User containing UID, date sent, accepted value
    let user = snap.after.val();
    //Devices
    let devices = await admin
      .database()
      .ref(`/users/${context.params.uid}/devicesID/`)
      .once("value");

    const messages = [];

    devices.forEach((a) => {
      messages.push({
        data: {
          type: "NOTIFICATION",
          title: "Friend Request",
          body: "You have a new friend request!",
        },
        token: a.val(),
      });
    });

    return admin
      .messaging()
      .sendAll(messages)
      .then((response) => {
        console.log(response.successCount + " messages were sent");
      })
      .catch((error) => {
        console.error(error);
      });
  });

// let ob = {"users":{"uid":{"friendRequestsSent": {"PUSHID":{"fromUID":"srihari2", "toUID":"SRIHARI"}}}}}
// {"fromUID":"sfklasdf", "toUID":"sflkajfl"}
