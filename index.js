const functions = require('firebase-functions');
const sdkConfig = require('./firebase-sdk.json');
const config_keys = require('./config_keys.json');
require('dotenv/config');
var admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(sdkConfig),
  databaseURL: config_keys.dataBaseUrl,
});
const db = admin.database();
const REQUEST_PROMISE = require('request-promise');
var request = require('request');
const { PubSub } = require('@google-cloud/pubsub');
const storageConfig = require('./cloud-storage.json');
const fetch = require('node-fetch');
const { Storage } = require('@google-cloud/storage');
const { ref } = require('firebase-functions/lib/providers/database');
const { object } = require('firebase-functions/lib/providers/storage');
const { error } = require('firebase-functions/lib/logger');
const storage = new Storage({ keyFilename: storageConfig });
const pubSubClient = new PubSub();
let queuRef = db.ref("queue");
var shortHash = require('short-hash');
const dayLimit = 30;
const Authorization = config_keys.Authorization;

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
const eventObj = {
  ADD_TO_CART: {
    eventMessage: "ADD_TO_CART",
    sendingAfter: 2
  },
  View: {
    eventMessage: "View",
    sendingAfter: 10
  },
  purchase: {
    eventMessage: "purchase",
    sendingAfter: 30
  }
}

exports.pushEvent = functions.https.onRequest((req, res) => {
  token = req.headers['authrization']
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  let validationMessage = "";
  let customerId;
  let response = {
    status: true,
    message: "",
  }
  req.body.customerId ? customerId = req.body.customerId : customerId = null;
  if (req.body.eventName) validationMessage = "Event name is required";
  if (!req.body.eventDetails) validationMessage = "eventDetails Id is required";
  if (!req.body.token) validationMessage = "token is required";
  if (validationMessage) return res.status(400).send(validationMessage);
  let hashedToken = shortHash(req.body.token);
  let key = req.body.eventName;
  if (!eventObj[key]) {
    response.status = false;
    response.message = "Event is not defined";
    return res.status(400).send(response);
  }
  let eventMessages = eventObj[key].eventMessage;
  let sendingDate = eventObj[key].sendingAfter;
  let newDate = new Date();
  let sendAt = newDate.setMinutes(newDate.getMinutes() + sendingDate);
  let customerEventRef = db.ref("customerEvent").child(hashedToken).child(req.body.eventName);
  return customerEventRef.once("value").then((snapshot) => {
    if (!snapshot.exists()) {
      return customerEventRef.push({
        "customerId": customerId,
        "eventName": req.body.eventName,
        "eventDetails": req.body.eventDetails,
        "message": eventMessages,
        "token": req.body.token,
        "sendingDate": sendAt,
        "arrivingDate": Date.now()
      }, (error) => { //check else if work
        if (error) { throw error }
        else {
          response.status = true;
          response.message = "Successful done"
          return res.status(200).send(response);
        }
      }).catch((error) => {
        throw error;
      })
    }
    else {
      var uid = Object.keys(snapshot.val());
      return customerEventRef.child(uid[0]).set({
        "eventName": req.body.eventName,
        "customerId": customerId,
        "eventDetails": req.body.eventDetails,
        "message": eventMessages,
        "token": req.body.token,
        "sendingDate": sendAt,
        "arrivingDate": Date.now()
      }).then(() => {
        response.status = true;
        response.message = "Successful done"
        return res.status(200).send(response);
      }).catch((error) => {
        console.log(error, "push event")
        throw error
      });
    }
  }).catch((error) => {
    response.status = false;
    response.message = "Something wrong";
    response.error = error.message;
    return res.status(400).send(response);
  })
})

exports.updateQueue = functions.database.ref('/customerEvent/{tokenUid}/{eventsUid}')
  .onWrite((change, context) => {
    if (!change.before.exists()) {
      return null;
    }
    if (!change.after.exists()) {
      var uids = Object.keys(change.before.val());
      queuRef.child(uids[0]).remove()
        .then(() => {
          console.log("Remove succeeded.")
          return;
        }).catch((error) => {
          console.log("Remove failed: " + error.message);
          return error;
        });

      return null;
    }
    var data = Object.values(change.after.val());
    var customerId;
    data[0].customerId ? customerId = data[0].customerId : customerId = null;
    var uid = Object.keys(change.after.val());
    queuRef.child(uid[0]).set({
      "message": data[0].message,
      "eventDetails": data[0].eventDetails,
      "eventName": data[0].eventName,
      "token": data[0].token,
      "customerId": customerId,
      "sendingDate": data[0].sendingDate,
      "arrivingDate": data[0].arrivingDate
    }).then(() => {
      console.log("Successfully Updated");
      return;
    }).catch((error) => {
      console.log("pushToQueueError", error.message);
      return error;
    })
    return null;
  });

exports.updateToken = functions.database.ref('/customer/{customerUid}/token')
  .onWrite((change, context) => {
    if (!change.before.exists()) { return; }
    let customerEventRef = db.ref("customerEvent");
    return customerEventRef.child(shortHash(change.before.val())).once("value").then((snapshot) => {
      return snapshot.ref.remove().then(() => {
        var newSnapshot = snapshot.val();
        Object.entries(newSnapshot).forEach((element) => {
          var test = Object.values(element[1])
          test[0].token = change.after.val()
          test[0].customerId = context.params.customerUid
        })
        return customerEventRef.child(shortHash(change.after.val())).set(
          newSnapshot).then(() => {
            return;
          }).catch((error) => {
            throw error;
          })
      }).catch((error) => {
        throw error;
      })
    }).catch((error) => {
      console.log("Update Token Error", error);
      return error;
    })
  })

exports.pushToQueue = functions.database.ref('/customerEvent/{tokenUid}/{eventUid}')
  .onCreate((snapshot) => {
    temp = Object.values(snapshot.val());
    var customerId;
    temp[0].customerId ? customerId = temp[0].customerId : customerId = null
    var uid = Object.keys(snapshot.val());
    queuRef.child(uid[0]).set({
      "message": temp[0].message,
      "eventDetails": temp[0].eventDetails,
      "eventName": temp[0].eventName,
      "token": temp[0].token,
      "customerId": customerId,
      "sendingDate": temp[0].sendingDate,
      "arrivingDate": temp[0].arrivingDate
    }).then((result) => {
      console.log("Successfully Done");
      return result;
    }).catch((error) => {
      console.log("pushToQueueError", error.message);
      return error;
    })
  })

exports.publishEventMessage = functions.pubsub.schedule("every 2 minutes")
  .timeZone('Asia/Riyadh')
  .onRun((context) => {
    return queuRef.orderByChild("sendingDate").endAt(new Date().getTime()).once("value").then(result => {
      if (!result.exists()) { return null; }
      Object.entries(result.val()).forEach((value) => {
        sendEventMessages(value);
      })
      return result.val();
    }).catch((error) => {
      console.log(error);
      return;
    })
  })


exports.setToken = functions.https.onRequest((req, res) => {
  token = req.headers['authrization']
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  let validationMessage = "";
  let allNotifications;
  let response = { status: true, messages: [], message: "Customer saved" }
  if (!req.body.token || typeof (req.body.token) !== "string")
    validationMessage = "token is not sent or no token";
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
  if (validationMessage) {
    response.status = false;
    response.message = validationMessage;
    return res.status(400).send(response);
  }
  return db.ref("customer").child(req.body.customerId).once("value").then((snapshot) => {
    return snapshot.ref.update({
      deviceOs: req.body.deviceOs,
      language: req.body.language,
      mobileNumber: req.body.mobileNumber,
      version: req.body.version,
      token: req.body.token,
      lastLoginDate: Date.now()
    }).then(() => {
      if (!snapshot.exists()) return res.status(200).send(response)
      return getUserMessages(req.body.customerId).then((userMessages) => {
        return getTopicMessages(req.body.token).then(dataArray => {
          dataArray.forEach(data => {
            allNotifications = Object.assign({}, allNotifications, data);
          });
          allNotifications = Object.assign({}, userMessages, allNotifications);
          response.messages = getMessagesObj(allNotifications);
          return res.status(200).send(response);
        }).catch((error) => {
          throw error;
        });
      });
    }).catch((error) => { throw error });
  }).catch((error) => {
    response.status = false;
    response.message = "something wrong"
    response.error = error.message;
    return res.status(400).send(response);
  });
});

exports.sendMultiMessages = functions.https.onRequest((req, res) => {
  token = req.headers['authrization']
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  if (!isValid(req.body)) return res.status(400).send("invalid request body");
  admin.messaging().sendMulticast(notificationPayload).then(() => {
    return db.ref("messages").push(messageDatabaseObj, function (error) {
      if (error) { throw error }
      else { return res.status(200).send('Successfully sent message'); }
    })
  }).catch((error) => {
    res.status(400).send(error);
    console.log("Error sending message", error);
  });
})

exports.sendTopicMessages = functions.https.onRequest((req, res) => {
  token = req.headers['authrization'];
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  if (!isValidTopicMessage(req.body)) { return res.status(400).send("invalid data or object"); }
  //let notification = getNotification(req.body);
  admin.messaging().send(req.body).then(() => {
    let topicMessagesRef = db.ref("topicsMessages").child(req.body.topic);
    return topicMessagesRef.push(messageDatabaseObj, function (error) {
      if (error) { throw error; }
      else { res.status(200).send("Topic Message Saved"); }
    });
  }).catch((error) => {
    console.log("Error sending message: ", error);
    return res.status(400).send("something wrong happened");
  });
})

exports.pushMessageToUserObject = functions.database.ref('/messages/{messagesUid}')
  .onCreate((snap) => {
    snap.child("tokens").val().forEach((value) => {
      db.ref("customer").orderByChild("token").equalTo(value).once("value", (snapshot) => {
        if (snapshot.val()) {
          documents = Object.keys(snapshot.val());
          let update_ref = db.ref("customerMessages").child(documents[0]);
          update_ref.push(snap.val(), (error) => {
            if (error) {
              return error
            }
            else {
              return
            }
          })
        }
      });
    })
  });

exports.subscribeToTopics = functions.https.onRequest((req, res) => {
  var validationMessage;
  let response = {
    status: true,
    message: "",
  }
  token = req.headers['authrization'];
  if (!checkAuth(token)) {
    response.message = "Unauthrized";
    response.status = false;
    return res.status(401).send(response);
  }
  if (!req.body.hasOwnProperty("tokens") && !Array.isArray(req.body.tokens))
    validationMessage = "Tokens is not sent or not array";
  if (!req.body.hasOwnProperty("topic") || typeof (req.body.topic) !== "string" || req.body.topic === "")
    validationMessage = "Topic is not sent or not string";
  response.message = validationMessage;
  response.status = false;
  if (validationMessage) return res.status(400).send(response);
  let topic = db.ref("topics").child(req.body.topic);
  admin.messaging().subscribeToTopic(req.body.tokens, req.body.topic)
    .then(() => {
      topic.child("tokens").once("value").then((snapshot) => {
        if (!snapshot.exists()) {
          return topic.set({
            tokens: req.body.tokens,
            addDate: Date.now()
          }).then(() => {
            return;
          }).catch((error) => {
            throw error;
          })
        }
        else {
          var token = snapshot.val();
          token.concat(req.body.tokens);
          var mySet = new Set(token);
          var tempArray = [...mySet];
          return topic.set({
            tokens: tempArray,
            addDate: Date.now()
          }).then(() => {
            return;
          }).catch((error) => {
            throw error;
          })
        }
      }).catch((error) => {
        throw error;
      })
      response.message = "Seccfully Subscribed";
      response.status = true
      return res.status(200).send(response);
    }).catch((error) => {
      response.message = error.message;
      response.status = false;
      return res.status(400).send(response);
    });
})

exports.unsubscribeToTopics = functions.https.onRequest((req, res) => {
  var validationMessage;
  token = req.headers['authrization'];
  if (!checkAuth(token)) { return res.status(401).send("Unauthrized"); }
  if (!req.body.hasOwnProperty("tokens") && !Array.isArray(req.body.tokens))
    validationMessage = "Tokens is not sent or not array";
  if (!req.body.hasOwnProperty("topic") || typeof (req.body.topic) !== "string" || req.body.topic === "")
    validationMessage = "Topic is not sent or not string";
  if (validationMessage) return res.status(400).send(validationMessage);
  let topics = db.ref("topics").child(req.body.topic);
  var tokenArr;
  return topics.child("tokens").once("value").then((snapshot) => {
    tokenArr = req.body.tokens;
    tokenArray = snapshot.val();
    if (!snapshot.exists()) return res.status(404).send("Topic is not exist or no token to be removed");
    var index;
    tokenArr.forEach((value) => {
      index = tokenArray.indexOf(value);
      if (!(index > -1))
        return res.status(404).send("one of tokens is not subscribed");
      tokenArray.splice(index, 1);
    })
    admin.messaging().unsubscribeFromTopic(req.body.tokens, req.body.topic)
      .then(() => {
        topics.update({
          "tokens": tokenArray
        }).then(() => { return; }).catch((error) => { throw error; })
        return res.status(200).send("Successfully unsubscribed to topic");
      }).catch((error) => { throw error; })
    return res.status(200).send("Successfully unsubscribed to topic");
  }).catch((error) => {
    console.log(error);
    return res.status(400).send("Error unsubscribing to topic")
  })
})

function downloadImages(reqUrl) {
  url = reqUrl;
  StorageUrl = config_keys.storageUrl;
  let filename = url.split('/').pop();
  const storage = new Storage();
  const bucket = storage.bucket(config_keys.bucketName);
  const file = bucket.file(filename);
  try {
    request
      .get(url)
      .on('response', function (response) {
        console.log(response.statusCode,)
        console.log(response.headers['content-type'])
      })
      .on('error', (error) => {
        console.log("error", error);
        return error;
      })
      .pipe(file.createWriteStream(filename))
    imageUrl = StorageUrl + filename;
    return imageUrl;
  }
  catch (error) {
    console.log("error", error);
    return error;
  }
}

function isValidTopicMessage(reqObj) {
  var rgexDate = new RegExp(/^(0?[1-9]|[12][0-9]|3[01])[-](0?[1-9]|1[012])[-]\d{4} (\d{2}):(\d{2}):(\d{2})$/);
  var resEnddate = rgexDate.test(reqObj.data.endDate);
  var resValidDate = rgexDate.test(reqObj.data.validDate);
  var validFlag;
  if (resEnddate && resValidDate) {
    newEnd = new Date(reqObj.data.endDate).getTime();
    newValid = new Date(reqObj.data.validDate).getTime();
    if (reqObj.hasOwnProperty("topic") && reqObj.hasOwnProperty("data")) {
      if (reqObj.data.body === "" || Date.now() > newEnd || Date.now() > newValid)
        return validFlag = 0;
      if (reqObj.data.image !== "") {
        let url = downloadImages(reqObj.data.image);
        if (url) return validFlag = 1;
        return validFlag = 0;
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
      return validFlag = 1;
    }

    return validFlag = 0;
  }
}
function isValid(reqObj) {
  var validFlag = 1;
  var url;
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
          url = downloadImages(reqObj.notifications.image)
          if (url) return validFlag = 0;
          notificationPayload.apns.fcm_options.image = url;
          notificationPayload.notifications.image = url;
          notificationPayload.android.notification.image = url;
          messageDatabaseObj.image = url;
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
    return validFlag;
  }
}
function getDayLimit() {
  const today = new Date();
  today.setDate(today.getDate() - dayLimit);
  return today.getTime();
}
function getUserMessages(customerId) {
  var userMessages;
  return db.ref(`customerMessages/${customerId}`).orderByChild("addDate").startAt(getDayLimit())
    .once("value").then((snapshot) => {
      userMessages = snapshot.val();
      return userMessages;
    })
    .catch((error) => console.error("error", error));
}
function getFcmTokenInfo(fcmToken) {
  const options = {
    uri: `https://iid.googleapis.com/iid/info/${fcmToken}`,
    headers:
    {
      Authorization: config_keys.serverKey,
    },
    json: true,
    qs: {
      details: true
    },
  };
  return REQUEST_PROMISE(options).then((result) => {
    return result;
  }).catch((error) => {
    throw error
  });
}
function getTopicMessages(fcmToken) {
  customerTopics = [];
  var promises = [];
  /*  customerTopics.forEach(topic => {
      promises.push(
        db.ref(`topicsMessages/${topic}`).orderByChild("addDate").startAt(getDayLimit())
          .ref.once("value").then((snapshot) => {
            return snapshot.val();
          }).catch(error => console.error(error))
      )
    })
    return Promise.all(promises).then((data) => {
      return data;
    }).catch(error => console.error(error));*/
  return getFcmTokenInfo(fcmToken).then((fcmTokenResult) => {
    Object.keys(fcmTokenResult.rel.topics).forEach((key) => {
      customerTopics.push(key);
    });
    customerTopics.forEach(topic => {
      promises.push(
        db.ref(`topicsMessages/${topic}`).orderByChild("addDate").startAt(getDayLimit())
          .ref.once("value").then((snapshot) => {
            return snapshot.val();
          }).catch((error) => {
            console.error(error);
            throw error;
          })
      )
    })
    return Promise.all(promises).then((data) => {
      return data;
    }).catch(error => {
      console.error(error)
      throw error;
    });
  }).catch((error) => {
    console.log(error, "catchError");
    throw error
  })
}
function checkAuth(reqBody) {
  if (reqBody === Authorization)
    return true
  else
    return false
}
function sendEventMessages(value) {
  let eventMessageObj = {
    notifications: {
      title: "",
      body: "",
    },
    android: {
      notification: {
        title: "",
        body: "",
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
    },
    tokens: []
  }
  let eventDatabaseObj = {
    body: "",
    token: "",
    sendingTime: "",
    eventName: "",
    arrivingDate: ""
  }
  eventMessageObj.notifications.body = value.message;
  eventMessageObj.android.notification.body = value.message;
  eventMessageObj.apns.payload.aps.alert.body = value.message;
  eventMessageObj.tokens.push(JSON.stringify(value.token));
  eventDatabaseObj.body = value.message;
  eventDatabaseObj.token = shortHash(value.token);
  eventDatabaseObj.sendingTime = Date.now();
  eventDatabaseObj.eventName = value.eventName;
  eventDatabaseObj.arrivingDate = value.arrivingDate;
  pushEventDetails(eventDatabaseObj).then(() => {
    admin.messaging().sendMulticast(eventMessageObj).then(() => {
      let hasedToken = shortHash(value.token);
      db.ref("customerEvent").child(hasedToken).child(value.eventName).remove()
        .then(() => {
          console.log("Remove succeeded."); return;
        }).catch((error) => { console.log("Remove failed: " + error.message); return; });
      return
    }).catch((error) => {
      console.log("Error sending message", error);
      return
    });
    return
  }).catch((error) => {
    console.log(error);
    return;
  });
}
function pushEventDetails(eventDatabaseObj) {
  let id;
  eventDatabaseObj.customerId ? id = eventDatabaseObj.customerId : id = eventDatabaseObj.token;
  return db.ref("eventDetails").child(id).push(eventDatabaseObj, (error) => {
    if (error) { return }
    else { return }
  })
}
function getMessagesObj(notifications) {
  let i = 0;
  Object.values(notifications).forEach((element) => {
    element.messageId = Object.keys(notifications)[i];
    delete element.tokens;
    i = +1;
  })
  let newNotifications;
  newNotifications = Object.values(notifications).sort((a, b) => { return a.addDate - b.addDate })
  return newNotifications;
}
