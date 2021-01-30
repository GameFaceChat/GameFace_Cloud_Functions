/**
 * Middleware for Protected Endpoint
 * Checks to make sure that the request is coming from
 * and authenticated user
 * @param {*} req
 * @param {*} res
 * @param {*} next
 */
async function validateFirebaseIdToken(req, res, next) {
  const admin = require("firebase-admin");

  console.log("START FIREBASE TOKEN AUTH");
  if (
    (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ")) &&
    !(req.cookies && req.cookies.__session)
  ) {
    console.error("No Firebase ID token");
    return res.status(401).send("Unauthorized");
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    idToken = req.headers.authorization.split("Bearer ")[1];
  } else {
    console.log("ID Token Error");
    return res.status(401).send("Unauthorized");
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
}

exports.validateFirebaseIdToken = validateFirebaseIdToken;
