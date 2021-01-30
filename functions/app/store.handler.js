/**
 * Purchases a pack for a given user
 * Called on POST request at purchasePack
 * @param {*} req  Should have packID and packType in the body
 * @param {*} res
 * @param {*} admin
 */
const purchasePack = async (req, res) => {
  const admin = require("firebase-admin");

  console.log(`Handling Purchase Request...${req.body.packID} ${req.body.packType}`);
  if (!req.body.hasOwnProperty("packID") || !req.body.hasOwnProperty("packType")) {
    return res.status(400).send("Does not have required fields");
  }

  //Fetch the ShopItem
  const _shopItemData = await admin
    .database()
    .ref(`/store/${req.body.packType}/${req.body.packID}/`)
    .once("value");

  //Check if that item exists in the shop with the ID packID
  if (!_shopItemData.exists()) {
    console.log(`PACK NOT FOUND: ${req.body.packID} and ${req.body.packType}`);
    return res.status(404).send("Pack not found");
  }
  const shopItem = _shopItemData.val();

  //Fetch the content of the pack from the database
  const _contentData = await admin.database().ref(`/content/${req.body.packID}/`).once("value");
  if (!_contentData.exists()) return res.status(500).send("Could not find content");

  //Configure the content to send pack to the user
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

  //Now we purchase the pack
  //Fetch the user data to get their money
  const _money = await admin.database().ref(`/users/${req.user.uid}/money/`).once("value");
  let money = _money.val() || 0;

  //If user does not have enough money
  if (shopItem.price > money) {
    return res.status(400).send("User does not have sufficient money");
  }

  //Increase the number of shop installs
  await _shopItemData.ref.child("installs").transaction((curr_number) => {
    return (curr_number || 0) + 1;
  });

  //Add to the owned packs of user
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

  //Subtract money from the user
  money -= shopItem.price;
  await _money.ref.transaction((oldValue) => {
    return (oldValue || 0) - shopItem.price;
  });

  return res.status(200).send(contentToSend);
};

exports.purchase = purchasePack;
