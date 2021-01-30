const functions = require("firebase-functions");
const { DataSnapshot } = require("firebase-functions/lib/providers/database");

const client = require("twilio")(functions.config().twilio.sid, functions.config().twilio.auth);
const { sendNotification } = require("./utils");

/**
 * Gets the STUN and TURN Servers from Twilio to return to the user
 * @param {Request} req
 * @param {Response} res
 */
const getServers = (req, res) => {
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
};
exports.getServers = getServers;

/**
 * Observes the members of rooms to perform various actions
 * depending on the status of the members.
 * @param {DataSnapshot} snap
 * @param {*} context
 * @param {*} admin
 */
async function observeMembers(snap, context) {
  const admin = require("firebase-admin");

  //Deleted Room
  if (snap.after.val() == null) {
    console.log("ROOM DELETE");
    //Remove the room from the members' rooms list
    return admin
      .database()
      .ref(`users/${context.params.uid}/rooms/${context.params.roomID}`)
      .remove();
  }
  //Member added
  if (snap.before.val() == null) {
    console.log("MEMBER ADDED");
    //Add the room to the member's rooms list
    await admin
      .database()
      .ref(`/users/${context.params.uid}/rooms/${context.params.roomID}/`)
      .set(true);
  }
  //The member status has been updated
  let member = snap.after.val();
  switch (member.memberStatus) {
    case "CALLING":
      //Send this to each device for a call
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
      //User could not be reached
      console.log("UNAVAILABLE");
      //Check if the user left the room
      if (snap.before.val() != null && snap.before.val().memberStatus == "ACCEPTED") {
        console.log("MEMBER LEFT");
        //Decrement the member count
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
      //User has accepted the call and should be in the room
      console.log("ACCEPTED");
      //User joined
      if (snap.before.val() == null || snap.before.val().memberStatus != "ACCEPTED") {
        //Increment the member count
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
}
const _observeMembers = observeMembers;
exports.observeMembers = _observeMembers;

/**
 * Deletes a room (called when there are zero members in a room)
 * @param {*} snap
 * @param {*} context
 * @param {*} admin
 */
const deleteRoom = (snap, context) => {
  const admin = require("firebase-admin");

  if (snap.after.val() == null) return false;
  if (snap.before.val() > 0 && snap.after.val() == 0) {
    return admin.database().ref(`/rooms/${context.params.roomID}`).remove();
  }
};
exports.deleteRoom = deleteRoom;
