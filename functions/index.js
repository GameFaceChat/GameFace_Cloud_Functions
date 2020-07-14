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

/*
  Development
*/
function deleteUser(uid) {
  return admin
    .auth()
    .deleteUser(uid)
    .then(function () {
      console.log("Successfully deleted user", uid);
    })
    .catch(function (error) {
      console.log("Error deleting user:", error);
    });
}

function deleteAllUsers(nextPageToken) {
  let promises = [];

  promises.push(
    admin
      .auth()
      .listUsers(250, nextPageToken)
      .then(function (listUsersResult) {
        listUsersResult.users.forEach(function (userRecord) {
          let uid = userRecord.toJSON().uid;
          promises.push(deleteUser(uid));
        });
      })
      .catch(function (error) {
        console.log("Error listing users:", error);
      })
  );

  promises.push(admin.database().ref("/users").remove());
  promises.push(admin.database().ref("/profiles").remove());

  admin.storage().bucket("gs://gameface-chat.appspot.com/").delete();

  return promises;
}

app.get("/deleteAll", async (req, res) => {
  try {
    await Promise.all(deleteAllUsers());
    res.status(200).send("ALL SENT");
    return;
  } catch (error) {
    res.status(500).send("ERROR WHEN DELETING" + error.toString());
    return;
  }
});

/* 
Production
*/
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

exports.app = functions.https.onRequest(app);

// exports.deleteRoom = functions.database
//   .ref("/rooms/{roomID}/users")
//   .onWrite(async (snap, context) => {
//     if (snap.after.val() == null) return false;
//     if (snap.after.val() <= 0) {
//       return admin.database().ref(`/rooms/${context.params.roomID}`).delete();
//     }
//   });

// The location should have:
// Member status
// roomID
// timestamp
async function sendNotification(uid, payload) {
  let devicesToUser = await admin.database().ref(`/users/${uid}/devicesID/`).once("value");
  if (!devicesToUser.hasChildren()) {
    return console.log("There are no notification tokens to send to.");
  }
  //Device Tokens
  const tokens = Object.keys(devicesToUser.val());
  const tokensToRemove = [];
  //Wait to see if everything sent
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
    } else {
      console.log(`Sent notification to ${tokens[index]}`);
    }
  });
  return Promise.all(tokensToRemove);
}

exports.call = functions.database
  .ref("/rooms/{roomID}/members/{uid}")
  .onWrite(async (snap, context) => {
    console.log("CALLING with body: " + JSON.stringify(snap.after.val()));
    if (snap.after.val() == null) return console.log("MEMBER Deleted?");
    let member = snap.after.val();
    if (member.memberStatus != "CALLING") return console.log("User not in calling");

    //Send this to each device
    const payload = {
      data: {
        type: "CALL",
        roomID: member.roomID,
        toUID: context.params.uid,
      },
    };

    return sendNotification(context.params.uid, payload);
  });

exports.sendFriendRequest = functions.database
  .ref("/users/{uid}/friendRequests/{pushID}")
  .onWrite(async (snap, context) => {
    // console.log(context.params.pushID);
    console.log(`SEND FRIEND REQUEST to: ${context.params.uid}`);
    //Removed
    if (snap.after.val() == null) {
      return false;
    }
    //User containing UID, date sent, accepted value
    let request = snap.after.val();

    const payload = {
      data: {
        type: "NOTIFICATION",
        title: "Friend Request",
        body: "You have a new friend request!",
        toUID: context.params.uid,
      },
    };
    return sendNotification(context.params.uid, payload);
  });

// let ob = {"users":{"uid":{"friendRequestsSent": {"PUSHID":{"fromUID":"srihari2", "toUID":"SRIHARI"}}}}}
// {"fromUID":"sfklasdf", "toUID":"sflkajfl"}
