const functions = require('firebase-functions');
const sdkConfig = require('./firebase-sdk.json');
var admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(sdkConfig),
  databaseURL: "",
});
const db = admin.database();
const REQUEST_PROMISE = require('request-promise');
const { error } = require('firebase-functions/lib/logger');
const { topic } = require('firebase-functions/lib/providers/pubsub');
const customerRef = db.ref("customer");
const messagesRef = db.ref("messages");
const topicsRef = db.ref("topics");
const customerMessages = db.ref("customerMessages")
const dayLimit = 30;
const AuthToken = "rawan";
// const sdkConfig = require('./firebase-sdk.json');
// const storageConfig = require('./cloud-storage.json');
// const fetch = require('node-fetch');
// admin.initializeApp({
//   credential: admin.credential.cert(sdkConfig),
//   databaseURL: "https://nejree-notifications.firebaseio.com/",
// });
// const { Storage } = require('@google-cloud/storage');
// const storage = new Storage({ keyFilename: storageConfig });
const notificationPayload = {
  notifications: {
    title: "",
    body: "",
    image: ""
  },
  data: { link: "" },
  android: {
    notification: {
      title: "",
      body: "",
      image: ""
    },
  },
  apns: {
    payload: {
      aps: {
        alert: {
          title: "",
          body: "",
          "mutable-content": 1
        },
        badge: 1,
        sound: "default",
      },
    },
    fcm_options: {
      image: ""
    },
  }
}
var messageDatabaseObj = {
  title: "",
  body: "",
  image: "",
  addDate: "",
  endDate: "",
  validDate: "",
  tokens: ""
}
var topicMessageObje = {
  data: {
    endDate: "",
    addDate: "",
    validDate: "",
    body: "",
    title: "",
  },
  topic: "",
  android: {
    notification: {
      title: "",
      body: "",
      image: ""
    },
  },
  apns: {
    payload: {
      aps: {
        alert: {
          title: "",
          body: "",
          "mutable-content": 1
        },
        badge: 1,
        sound: "default",
      },
    },
    fcm_options: {
      image: ""
    },
  }
}
function checkAuth(reqBody) {
  if (reqBody === AuthToken)
  return true
  else
  return false
}
//Update customer date  
exports.setToken = functions.https.onRequest((req, res) => {
  token = req.headers['user-auth']
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }

  let validationMessage = "";
  if (!req.body.token || typeof (req.body.token) !== "string") {
    validationMessage = "token is not sent or no token";
  }

  if (!req.body.hasOwnProperty("customerId") || isNaN(req.body.customerId))
    validationMessage = "customerId is not sent or no customer id";

  if (!req.body.hasOwnProperty("deviceOs") || !/ios|android/gi.test(req.body.deviceOs))
    validationMessage = "deviceOs is not sent or device is not any of (ios|IOS|android|Android)";

  if (!req.body.hasOwnProperty("language") || !/ar|en/gi.test(req.body.language))
    validationMessage = "language is not sent or language is not any of (EN|en|AR|ar)";

  if (!(req.body.hasOwnProperty("mobileNumber") && RegExp(/^05\d{8}$/).test(req.body.mobileNumber)))
    validationMessage = "mobileNumber is not sent or mobile is not in the format of 05********" + req.body.mobileNumber;

  if (!req.body.hasOwnProperty("version"))
    validationMessage = "version is not sent";

  if (validationMessage) return res.status(400).send(validationMessage);

  let response = {
    status: true,
    messages: [],
    message: "Customer saved",
  }

  try {

    return customerRef.child(req.body.customerId).once("value", snapshot => {
      return snapshot.ref.update({
        deviceOs: req.body.deviceOs,
        language: req.body.language,
        mobileNumber: req.body.mobileNumber,
        version: req.body.version,
        token: req.body.token,
        lastLoginDate: Date.now()
      }).then(() => {
        if (snapshot.exists()) {
          getUserMessages(req.body.customerId).then((userMessages) => {
            return response.messages.push(userMessages);

          }).catch(error => { throw error });
          return getTopicMessages(req.body.token).then(dataArray => {

            dataArray.forEach(data => {
              response.messages.push(data);
            });
            return res.status(200).send(response);
          }).catch(error => { throw error });
        }
        return res.status(200).send(response);
      }).catch((err) => {
        console.error(err);
        return res.status(400).send(err);
      });
    });
  }catch (error) {
    return res.status(400).send(error);
  }
});

//Retrive messages for a specific user 
function getUserMessages(customerId) {
  var userMessages = 1;
  return db.ref(`customerMessages/${customerId}`).orderByChild("addDate").startAt(getDayLimit())
    .once("value").then((snapshot) => {
      userMessages = snapshot.val();
      return userMessages;

    })
    .catch(error => console.error("here is error", error));
}

function getFcmTokenInfo(fcmToken) {
  const options = {
    uri: `https://iid.googleapis.com/iid/info/${fcmToken}`,
    headers:
    {
      Authorization: "key=AAAAc7CjBpA:APA91bGjjJzAkEetCDmjWzT8BPT49nIZJKs46au-1YREzbm8usc-MabHoMdCPqZN38cJ13kKyy_fNGH66FQzRnShW-67xT6x7JCg4ZFur6a_aj2AayPK1KC0oZElcF58qG3Azf30fFf9",
    },
    json: true,
    qs: {
      details: true
    },
  };
  return REQUEST_PROMISE(options).then((result) => {
    return result;
  }).catch((error) => {
    console.error(error.message);
    return error.message;
  });
}

function getTopicMessages(fcmToken) {
  customerTopics = [];
  var promises = [];
  var fcmTokenResult;
   return getFcmTokenInfo(fcmToken).then((data) => {
    fcmTokenResult = data;
    Object.keys(fcmTokenResult.rel.topics).forEach((key) => {
      customerTopics.push(key);
    });
    customerTopics.forEach(topic => {
      promises.push(
        db.ref(`topicsMessages/${topic}`).orderByChild("addDate").startAt(getDayLimit())
          .ref.once("value").then((snapshot) => {
            return snapshot.val();
          }).catch(error => console.error(error, "here isssss the isssueee"))
      )
    })
    return Promise.all(promises).then((data) => {
      return data;
    }).catch(error => console.error(error));
  })
}

//Send messages with topic
exports.sendTopicMessages = functions.https.onRequest((req, res) => {
  token = req.headers['user-auth'];
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  if (!isValidTopicMessage(req.body)) { return res.status(400).send("invalid data or object"); }
  //let notification = getNotification(req.body);
  admin.messaging().send(req.body).then(() => {
    let topicMessagesRef = db.ref("topicsMessages").child(req.body.topic);
    topicMessagesRef.push(messageDatabaseObj, function (err) {
      if (err) { res.status(400).send(err) }
      else { res.status(200).send("Topic Message Saved"); }
    });
    return res.status(200).send('Successfully sent message')
  }).catch((error) => { console.log("Error sending message: ", error); });
})

//sned messages to multiple devices 
exports.sendMultiMessages = functions.https.onRequest((req, res) => {
  token = req.headers['user-auth']
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  if (!isValid(req.body)) return res.status(400).send("invalid data , Date format is DD-MM-YYYY");
  console.log("notificationPayload", notificationPayload);
  admin.messaging().sendMulticast(notificationPayload).then(() => {
    messagesRef.push(messageDatabaseObj, function (err) {
      if (err) { res.status(400).send(err); }
      else { res.status(200); }
    })
    return res.status(200).send('Successfully sent message');
  })
    .catch((error) => { console.log("Error sending message", error); });
})

//triggers
exports.pushMessageToUserObject = functions.database.ref('/messages/{messagesUid}')
  .onCreate((snap) => {
    tokenObj = snap.child("tokens").val();
    tokenObj.forEach((value) => {
      customerRef.orderByChild("token").equalTo(value).once("value", function (snapshot) {
        if (snapshot.val()) {
          documents = Object.keys(snapshot.val());
          console.log(documents[0],"documenkkkkkkkkkkkkkkkkkkkkkkkkknnnnts");
          let update_ref = admin.database().ref("customerMessages").child(documents[0]);
          update_ref.push(snap.val(), function (err) {
            if (err) {
              return err
            }
            else {
              return
            }
          })
        }
      });
    })
  });

//Subscribe topic by firebase and push it to database 
exports.subscribeToTopics = functions.https.onRequest((req, res) => {
  var validationMessage;
  token = req.headers['user-auth'];
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  if (!req.body.hasOwnProperty("tokens") && !Array.isArray(req.body.tokens))
    validationMessage = "Tokens is not sent or not array";
  if (!req.body.hasOwnProperty("topic") || typeof (req.body.topic) !== "string" || req.body.topic === "")
    validationMessage = "Topic is not sent or not string";
  if (validationMessage) return res.status(400).send(validationMessage);

  admin.messaging().subscribeToTopic(req.body.tokens, req.body.topic)
    .then(
      function () {
        topicsRef.child(req.body.topic).set({
          tokens: req.body.tokens,
          addDate: Date.now()
        }).then(() => {
          return res.status(200).send("done")
        }).catch((err) => {
          res.send(err)
        })
        return res.status(200).send("Successfully subscribed to topic");
      }).catch(function (error) {
        return res.status(400).send("Error subscribing to topic", error);
      });
})

//unsubscribe topic
exports.unsubscribeToTopics = functions.https.onRequest((req, res) => {
  var validationMessage; var tokenArr; var index;
  token = req.headers['user-auth'];
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  if (!req.body.hasOwnProperty("tokens") && !Array.isArray(req.body.tokens))
    validationMessage = "Tokens is not sent or not array";
  if (!req.body.hasOwnProperty("topic") || typeof (req.body.topic) !== "string" || req.body.topic === "")
    validationMessage = "Topic is not sent or not string";
  if (validationMessage) return res.status(400).send(validationMessage);

  var oldToken = admin.database().ref("topics").child(req.body.topic).child("tokens");
  oldToken.once("value", function (snapshot) {
    tokenArr = req.body.tokens;
    tokenArray = snapshot.val();
    if (!snapshot.exists()) return res.status(404).send("Topic is not exist or no token to be removed");

    tokenArr.forEach((value) => {
      index = tokenArray.indexOf(value);
      if (!(index > -1))
        return res.send("one of tokens is not exit in tokens list").status(404);
      tokenArray.splice(index, 1);
    })
    admin.messaging().unsubscribeFromTopic(req.body.tokens, req.body.topic)
      .then(function () {
        topicsRef.child(req.body.topic).update({
          "tokens": tokenArray
        }).then(() => { return res.status(200).send("Successfully unsubscribed to topic") }).catch((err) => { res.send(err) })
        return res.status(200).send("Done");
      }).catch(function () { return res.status(200).send("Error unsubscribing to topic") })
  }, function () {
    return res.status(501).send("The read failed");
  })
});

// exports.main = functions.https.onRequest((req, res) => {

//   const bucketName = "nejree-notifications.appspot.com";
//   const filename = "/images/img.png";
//   async function uploadFile() {

//     console.log( );
//     await storage.bucket(bucketName).upload(`${__dirname}${filename}`, {
//       // Support for HTTP requests made with `Accept-Encoding: gzip`
//       gzip: true,
//       // By setting the option `destination`, you can change the name of the
//       // object you are uploading to a bucket.
//       metadata: {
//         // Enable long-lived HTTP caching headers
//         // Use only if the contents of the file will never change
//         // (If the contents will change, use cacheControl: 'no-cache')
//         cacheControl: 'public, max-age=31536000',
//       },
//     });

//     console.log(`${filename} uploaded to ${bucketName}.`, "yeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeees");
//     return res.status(200).send("kk");
//   }

//   uploadFile().catch(console.error
//   );
//   res.status(400).send("kk");
//   // [END storage_upload_file]
// })


// //do
// exports.downloadImages = functions.https.onRequest((req, res) => {
//   const storage = new Storage();
// const bucket = storage.bucket("nejree-notifications.appspot.com");
// const file = bucket.file('Sunflower_from_Silesia2.jpg');
// const writeStream = file.createWriteStream({
//   metadata: {
//     contentType: 'image/jpg',
//     metadata: {
//       custom: 'metadata'
//     }
//   }});


// fetch('https://upload.wikimedia.org/wikipedia/commons/4/41/Sunflower_from_Silesia2.jpg')
//   .then(res => {
//     return res.body.pipe(writeStream).send("h").status(200);
//   }).catch((err)=>{return res.send(err);})

// })


// //====================functions============================
function isValidTopicMessage(reqObj) {
  var rgexDate = new RegExp(/^(0?[1-9]|[12][0-9]|3[01])[-](0?[1-9]|1[012])[-]\d{4} (\d{2}):(\d{2}):(\d{2})$/);
  var resEnddate = rgexDate.test(reqObj.data.endDate);
  var resValidDate = rgexDate.test(reqObj.data.validDate);
  if (resEnddate && resValidDate) {
    newEnd = new Date(reqObj.data.endDate).getTime();
    newValid = new Date(reqObj.data.validDate).getTime();
    if (reqObj.hasOwnProperty("topic") && reqObj.hasOwnProperty("data")) {
      if (reqObj.data.body === "" || Date.now() > newEnd || Date.now() > newValid) {
        return false;
      }
      Object.entries(reqObj).forEach(([key, value]) => {
        for (var i in value) {
          if (key === "data" && i !== "addDate" && i !== "endDate" && i !== "validDate") {
            var temp = reqObj[key];
            messageDatabaseObj[i] = temp[i];
          }
        }
      })
      topicMessageObje.data.endDate = JSON.stringify(newEnd);
      topicMessageObje.data.validDate = JSON.stringify(newValid);
      topicMessageObje.data.addDate = JSON.stringify(Date.now());
      topicMessageObje.data.body = reqObj.data.body;
      topicMessageObje.data.title = reqObj.data.title;
      topicMessageObje.data.image = reqObj.data.image;
      topicMessageObje.topic = reqObj.topic;
      messageDatabaseObj.endDate = newEnd;
      messageDatabaseObj.validDate = newValid;
      messageDatabaseObj.addDate = Date.now();
      topicMessageObje.apns.fcm_options.image = reqObj.data.image;
      topicMessageObje.android.notification.image = reqObj.data.image;
      topicMessageObje.android.notification.title = reqObj.data.title;
      topicMessageObje.android.notification.body = reqObj.data.body;
      topicMessageObje.apns.payload.aps.alert.title = reqObj.data.title;
      topicMessageObje.apns.payload.aps.alert.body = reqObj.data.body;

      delete messageDatabaseObj['tokens'];
      console.log("messageDateBaseObject", messageDatabaseObj);
      console.log("messagetopicObject", topicMessageObje);
      return true;
    }

    return false;
  }
}
function isValid(reqObj) {
  var validFlag = 1;
  var rgexDate = new RegExp(/^(0?[1-9]|[12][0-9]|3[01])[-](0?[1-9]|1[012])[-]\d{4} (\d{2}):(\d{2}):(\d{2})$/);
  var endDateCheck = rgexDate.test(reqObj.data.endDate);
  var validDateCheck = rgexDate.test(reqObj.data.validDate);
  if (!endDateCheck && !validDateCheck) return false;
  endDate = new Date(reqObj.data.endDate).getTime();
  validDate = new Date(reqObj.data.validDate).getTime();
  if ((reqObj.notifications.body !== "") && (Date.now() < endDate) && (Date.now() < validDate && (Array.isArray(reqObj.tokens)))) {
    Object.entries(reqObj).forEach(([key, value]) => {
      for (var i in value) {
        if (key === "data" && i !== "addDate" && i !== "endDate" && i !== "validDate") {
          var temp = reqObj[key];
          messageDatabaseObj[i] = temp[i];
        }
        else if (i === "body" || i === "title") {
          var tempNoti = reqObj[key];
          messageDatabaseObj[i] = tempNoti[i];
        }
        else if (i === "image" && reqObj.notifications.image !== "") {
          downloadImage(reqObj.notifications.image);
        }
        else if (key === "tokens") {
          var tempTokens = reqObj[key];
          if ((typeof (tempTokens[i]) !== "string")) { validFlag = 0; }
        }
        else if (key === "topic") {
          if (reqObj.topic !== "") {
            messageDatabaseObj.topic = reqObj.topic;
            notificationPayload.topic = reqObj.topic;
          }
        }
      }
    })
    console.log("assignations");
    notificationPayload.android.notification.title = reqObj.notifications.title;
    notificationPayload.android.notification.body = reqObj.notifications.body;
    notificationPayload.apns.payload.aps.alert.title = reqObj.notifications.title;
    notificationPayload.apns.payload.aps.alert.body = reqObj.notifications.body;
    messageDatabaseObj.tokens = reqObj.tokens;
    notificationPayload.tokens = reqObj.tokens;
    notificationPayload.data.endDate = JSON.stringify(endDate);
    notificationPayload.data.validDate = JSON.stringify(validDate);
    messageDatabaseObj.endDate = endDate;
    messageDatabaseObj.validDate = validDate;
    notificationPayload.data.addDate = JSON.stringify(Date.now());
    messageDatabaseObj.addDate = Date.now();
    notificationPayload.apns.fcm_options.image = reqObj.notifications.image;
    notificationPayload.notifications.image = reqObj.notifications.image;
    notificationPayload.android.notification.image = reqObj.notifications.image;
    return validFlag;
  }
}
function getDayLimit() {
  const today = new Date();
  today.setDate(today.getDate() - dayLimit);
  console.log(today);
  return today.getTime();
}
// function getTopicNotification(reqObj){

// }

// function checkAuth(token) {
//   if (token !== AuthToken)
//     return false;
//   else
//     return true;
// }

// function isValidNotificationMessage(reqObj) {
// }

// function downloadImage(image) {
//   options = {
//     url: "",
//     dest: './images'
//   }
//   options.url = image;
//   download.image(options)
//     .then(({ filename }) => {
//       console.log('Saved to', filename);
//       return
//     })
//     .catch((err) => {
//       console.error(err);
//       return;
//     }
//     )
// }
// function getDayLimit(){
//   const today = new Date();
//   return today.setDate(today.getDate() - dayLimit).getTime();
// }
// //Retrive messages for a specific user 
// function getUserMessages(customerId) {
//   console.log("getDayLimit()", getDayLimit());
//   // return db.ref(`customer/${customerId}/messages/`).orderByChild("addedDate").startAt(getDayLimit())
//   // .ref.on("value", snapshot => { 
//   //   console.log(snapshot.val());
//   //   return snapshot.val(); 
//   // }).catch(error => console.error(error));
// }
// //Get topic
// function getTopicMessages(token) {
//   var tokenss = [];
//   var messagesObj = [];
//   var ref = db.ref("topics");
//   ref.on("value", function (snapshot) {
//     snapshot.forEach(function (childSnapshot) {
//       tokenss = snapshot.child("tokens").val();
//       if (!tokenss.includes(token)) {
//         console.log("insideIF", tokenss.includes(token));
//         return;
//       }
//       childSnapshot.forEach(function (lowChild) {
//         let addedDate = lowChild.child("addedDate").val();
//         diffDays = computeDateDifference(addedDate);
//         if (diffDays <= 30) {
//           var message = lowChild.val();
//           messagesObj.push(message);
//           console.log("messsssages", messagesObj);
//         }
//       })
//     })
//   })
//   return messagesObj;
// }
// function computeDateDifference(addedDate) {
//   let today = new Date().getTime();
//   var diffTime = Math.abs(today - addedDate);
//   var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
//   return diffDays;
// }

// /*send message with Conditions
// exports.sendConditionalMessage = functions.https.onRequest((req, res) => {
//   messageObj = req.body;
//   messageObj.tokens = req.body.tokens;
//   admin.messaging().sendMulticast(messageObj).then(() => {
//     messagesRef.push(messageObj, function (err) {
//       if (err) { res.status(400).send(err) }
//       else { res.status(200); }
//     })
//     return res.status(200).send('Successfully sent message:')
//   })
//     .catch((error) => { console.log("Error sending message: ", error); });
// })*/
