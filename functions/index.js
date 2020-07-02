"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const express = require("express");
const app = express();
const cors = require("cors")({ origin: true });
const client = require("twilio")(functions.config().twilio.sid, functions.config().twilio.auth);

app.use(cors);
app.use(express.json());
const validateFirebaseIdToken = async (req, res, next) => {
  console.log("START FIREBASE TOKEN AUTH");
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
    return false;
  }
};

app.use(cors);
app.use(validateFirebaseIdToken);
app.get("/servers", (req, res) => {
  console.log("GETTING SERVERS");
  client.tokens
    .create()
    .then((token) => {
      res.send(token);
    })
    .catch((error) => {
      console.log(error);
      res.status(500).send(error);
    });
  console.log("FINISHED SERVERS");
});

/*
JSON should have props:
{
  fromProfile, toUID, roomID
}
*/
app.post("/call", async (req, res) => {
  console.log("CALLING with body: " + req.body);
  if (
    !req.body.hasOwnProperty("fromProfile") ||
    !req.body.hasOwnProperty("toUID") ||
    !req.body.hasOwnProperty("roomID")
  ) {
    console.log("ERROR");
    return res.status(400).send("Wrong format");
  }

  let devicesToUser = await admin
    .database()
    .ref(`/users/${req.body.toUID}/devicesID/`)
    .once("value");
  if (!devicesToUser.hasChildren()) {
    return res.status(200).send("There are no notification tokens to send to.");
  }
  const tokens = Object.keys(devicesToUser.val());
  const tokensToRemove = [];
  const payload = {
    data: {
      type: "CALL",
      fromName: req.body.fromProfile.name,
      fromUsername: req.body.fromProfile.username,
      fromUID: req.body.fromProfile.uid,
      fromProfilePic: req.body.fromProfile.profilePic,
      roomID: req.body.roomID,
      toUID: req.body.toUID,
    },
  };
  const response = await admin.messaging().sendToDevice(tokens, payload);
  response.results.forEach((result, index) => {
    const error = result.error;
    if (error) {
      console.error("Failure sending notification to", tokens[index], error);
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        tokensToRemove.push(devices.ref.child(tokens[index]).remove());
      }
    }
  });
  console.log("FINISHED CALLING");
  await Promise.all(tokensToRemove);
  return res.status(200).send("Finished");
});

exports.app = functions.https.onRequest(app);

// exports.deleteRoom = functions.database
//   .ref("/rooms/{roomID}/users")
//   .onWrite(async (snap, context) => {
//     if (snap.after.val() == null) return false;
//     if (snap.after.val() <= 0) {
//       return admin.database().ref(`/rooms/${context.params.roomID}`).delete();
//     }
//   });

exports.sendFriendRequest = functions.database
  .ref("/users/{uid}/friendRequests/{pushID}")
  .onWrite(async (snap, context) => {
    // console.log(context.params.pushID);
    console.log("SEND FRIEND REQUEST");
    //Removed
    if (snap.after.val() == null) {
      return false;
    }
    //User containing UID, date sent, accepted value
    let request = snap.after.val();
    //Devices
    let devices = await admin
      .database()
      .ref(`/users/${context.params.uid}/devicesID/`)
      .once("value");

    if (!devices.hasChildren()) {
      return console.log("There are no notification tokens to send to.");
    }
    const tokens = Object.keys(devices.val());
    const tokensToRemove = [];

    const payload = {
      data: {
        type: "NOTIFICATION",
        title: "Friend Request",
        body: "You have a new friend request!",
        toUID: context.params.uid,
      },
    };

    const response = await admin.messaging().sendToDevice(tokens, payload);
    response.results.forEach((result, index) => {
      const error = result.error;
      if (error) {
        console.error("Failure sending notification to", tokens[index], error);
        if (
          error.code === "messaging/invalid-registration-token" ||
          error.code === "messaging/registration-token-not-registered"
        ) {
          tokensToRemove.push(devices.ref.child(tokens[index]).remove());
        }
      }
    });
    return Promise.all(tokensToRemove);
  });

// let ob = {"users":{"uid":{"friendRequestsSent": {"PUSHID":{"fromUID":"srihari2", "toUID":"SRIHARI"}}}}}
// {"fromUID":"sfklasdf", "toUID":"sflkajfl"}
