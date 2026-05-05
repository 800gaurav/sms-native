package com.smssender

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class SmsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "SmsModule"

    @ReactMethod
    fun hasSmsPermission(promise: Promise) {
        promise.resolve(SmsSender.hasPermission(reactApplicationContext))
    }

    @ReactMethod
    fun sendSms(phone: String, message: String, promise: Promise) {
        val sent = SmsSender.send(reactApplicationContext, phone, message)
        if (sent) {
            promise.resolve(true)
        } else {
            promise.reject("SMS_SEND_FAILED", "SMS could not be queued. Check permission, SIM, phone number and message.")
        }
    }
}
