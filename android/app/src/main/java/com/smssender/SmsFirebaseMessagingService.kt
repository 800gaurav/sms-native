package com.smssender

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class SmsFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        val data = remoteMessage.data
        val type = data["type"]
        val phone = data["phone"]
        val message = data["message"]

        if (type == "send_sms" && !phone.isNullOrBlank() && !message.isNullOrBlank()) {
            val sent = SmsSender.send(applicationContext, phone, message)
            Log.d("SmsFirebaseMessaging", "Background SMS request handled. queued=$sent")
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d("SmsFirebaseMessaging", "FCM token refreshed")
    }
}
