"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const express = require("express");
const { database } = require("firebase-admin");
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
    res.status(401).send("Unauthorized");
    return;
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    idToken = req.headers.authorization.split("Bearer ")[1];
  } else {
    console.log("ID Token Error");
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedIdToken;
    next();
  } catch (error) {
    console.log("ERROR: " + error);
    res.status(401).send("Unauthorized");
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

app.post("/purchasePack", async (req, res) => {
  console.log(`Handling Purchase Request...${req.body.packID} ${req.body.packType}`);
  if (!req.body.hasOwnProperty("packID") || !req.body.hasOwnProperty("packType")) {
    return res.status(400).send("Does not have required fields");
  }

  //Fetch the ShopItem
  const _shopItemData = await admin
    .database()
    .ref(`/store/${req.body.packType}/${req.body.packID}/`)
    .once("value");

  if (!_shopItemData.exists()) {
    console.log(`PACK NOT FOUND: ${req.body.packID} and ${req.body.packType}`);
    return res.status(404).send("Pack not found");
  }
  const shopItem = _shopItemData.val();

  //Fetch the content
  const _contentData = await admin.database().ref(`/content/${req.body.packID}/`).once("value");
  if (!_contentData.exists()) return res.status(500).send("Could not find content");

  const contentToSend = _contentData.val();
  contentToSend["packID"] = req.body.packID;
  contentToSend["packType"] = req.body.packType;
  contentToSend["version_number"] = shopItem.version;
  contentToSend["name"] = shopItem.name;

  //Check if the user already has the pack
  const owned_packs = await admin
    .database()
    .ref(`/owned_packs/${req.user.uid}/${req.body.packID}`)
    .once("value");
  if (owned_packs.exists()) {
    return res.contentType("application/json").status(200).send(contentToSend);
  }

  //Fetch the user data to get their money
  const _money = await admin.database().ref(`/users/${req.user.uid}/money/`).once("value");
  let money = _money.val() || 0;

  //user does not have enough money
  if (shopItem.price > money) {
    return res.status(400).send("User does not have enough money");
  }

  //Increase shop installs
  await _shopItemData.ref.child("installs").transaction((curr_number) => {
    return (curr_number || 0) + 1;
  });

  //Add to owned packs of user
  await admin.database().ref(`/owned_packs/${req.user.uid}/packs`).child(req.body.packID).set({
    id: req.body.packID,
    type: req.body.packType,
    purchasedDate: admin.database.ServerValue.TIMESTAMP,
  });
  await admin
    .database()
    .ref(`/owned_packs/${req.user.uid}/number/`)
    .transaction((oldValue) => {
      return (oldValue || 0) + 1;
    });

  //Subtract money from user
  money -= shopItem.price;
  await _money.ref.transaction((oldValue) => {
    return (oldValue || 0) - shopItem.price;
  });

  return res.status(200).send(contentToSend);
});

exports.app = functions.https.onRequest(app);

exports.deleteRoom = functions.database
  .ref("/rooms/{roomID}/memberCount")
  .onWrite(async (snap, context) => {
    if (snap.after.val() == null) return false;
    if (snap.before.val() > 0 && snap.after.val() == 0) {
      return admin.database().ref(`/rooms/${context.params.roomID}`).remove();
    }
  });

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

exports.observeMembers = functions.database
  .ref("/rooms/{roomID}/members/{uid}")
  .onWrite(async (snap, context) => {
    if (snap.after.val() == null) {
      //Deleted Room
      console.log("ROOM DELETE");
      return admin
        .database()
        .ref(`users/${context.params.uid}/rooms/${context.params.roomID}`)
        .remove();
    }
    if (snap.before.val() == null) {
      //Member added
      console.log("MEMBER ADDED");
      await admin
        .database()
        .ref(`/users/${context.params.uid}/rooms/${context.params.roomID}/`)
        .set(true);
    }
    let member = snap.after.val();
    switch (member.memberStatus) {
      case "CALLING":
        //Send this to each device
        console.log("CALLING with body: " + JSON.stringify(snap.after.val()));
        const payload = {
          data: {
            type: "CALL",
            roomID: context.params.roomID,
            toUID: context.params.uid,
          },
        };
        return sendNotification(context.params.uid, payload);
      case "UNAVAILABLE":
        console.log("UNAVAILABLE");
        if (snap.before.val() != null && snap.before.val().memberStatus == "ACCEPTED") {
          console.log("MEMBER LEFT");
          return admin
            .database()
            .ref(`rooms/${context.params.roomID}/memberCount/`)
            .transaction((old) => {
              if (old == null) return 0;
              return old - 1;
            });
        }
        break;
      case "ACCEPTED":
        console.log("ACCEPTED");
        if (snap.before.val() == null || snap.before.val().memberStatus != "ACCEPTED") {
          return admin
            .database()
            .ref(`rooms/${context.params.roomID}/memberCount/`)
            .transaction((old) => {
              return (old || 0) + 1;
            });
        }
        break;
      case "RECEIVED":
        console.log("RECEIVED");
        break;
      default:
        return console.log("UNKNOWN COMMAND");
    }
    return true;
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
