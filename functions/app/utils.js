/**
 * Sends a notification to all devices of a user
 * @param {string} uid       The UID of the target user
 * @param {Object} payload   The JSON object payload to send to each user
 */
async function sendNotification(uid, payload) {
  const admin = require("firebase-admin");

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
    //Check if there was an error
    if (error) {
      console.error("Failure sending notification to", tokens[index], error);
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        //Token is invalid: delete it
        tokensToRemove.push(devices.ref.child(tokens[index]).remove());
      }
    } else {
      console.log(`Sent notification to ${tokens[index]}`);
    }
  });
  return Promise.all(tokensToRemove);
}
const _sendNotification = sendNotification;
exports.sendNotification = _sendNotification;
