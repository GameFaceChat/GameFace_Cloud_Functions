const { sendNotification } = require("./utils");
function deleteUser(uid) {
  const admin = require("firebase-admin");

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
/*
  Development
*/

// Only for development purposes!

// function deleteAllUsers(app, nextPageToken) {
//   let promises = [];

//   promises.push(
//     admin
//       .auth()
//       .listUsers(250, nextPageToken)
//       .then(function (listUsersResult) {
//         listUsersResult.users.forEach(function (userRecord) {
//           let uid = userRecord.toJSON().uid;
//           promises.push(deleteUser(uid));
//         });
//       })
//       .catch(function (error) {
//         console.log("Error listing users:", error);
//       })
//   );

//   promises.push(admin.database().ref("/users").remove());
//   promises.push(admin.database().ref("/profiles").remove());

//   admin.storage().bucket("gs://gameface-chat.appspot.com/").delete();

//   return promises;
// }

async function sendFriendRequest(snap, context) {
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
}
exports.sendFriendRequest = sendFriendRequest;
